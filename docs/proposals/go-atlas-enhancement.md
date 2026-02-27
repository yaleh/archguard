# Go Atlas Enhancement Proposals

> Status: Draft (rev 2)
> Branch: feat/go
> Scope: Static analysis improvements to the Go Atlas layer — no dependency violation detection

---

## Background

The Go Atlas currently produces four Mermaid diagrams:

| Layer | File | What it shows |
|-------|------|---------------|
| Package | `architecture-package.mmd` | Package dependency graph |
| Capability | `architecture-capability.mmd` | Interface/struct relationship graph |
| Goroutine | `architecture-goroutine.mmd` | Goroutine spawn topology |
| Flow | `architecture-flow.mmd` | HTTP handler call chains |

All four layers are type-safe via `GoAtlasExtension` in `src/types/extensions.ts` (ADR-002).
The capability diagram is rendered via `flowchart LR` (not `classDiagram`) by
`MermaidTemplates.renderCapabilityGraph()` in `src/plugins/golang/atlas/renderers/mermaid-templates.ts`.

The proposals below are grouped by what they change and where their output goes.

---

## Proposal 1 — Structural Metrics on the Capability Diagram

### Problem

The capability diagram shows _which_ interfaces/structs exist and _how_ they relate, but gives no
sense of size or coupling. A `store.Store` interface with 20 methods looks the same as a `Logger`
interface with 2 methods. A struct with 12 fields looks identical to one with 2. Type-level
coupling (how many nodes depend on or are depended upon by this type) is invisible.

### What to add

#### A. Node-level metrics

Extend `CapabilityNode` in `extensions.ts`:

```typescript
interface CapabilityNode {
  // existing fields ...
  methodCount?: number;  // directly-declared methods only (not promoted from embedded types)
                         //   interfaces: all interface methods
                         //   structs:    receiver methods declared in this package
  fieldCount?: number;   // exported struct fields; undefined for interfaces
}
```

**Scope boundary**: `methodCount` counts only methods that appear directly in `GoRawStruct.methods`
or `GoRawInterface.methods`. Methods promoted via struct embedding are excluded — they belong to the
embedded type's own node. This makes the metric unambiguous and consistent across packages.

Data is already available without any new parsing: `GoRawStruct.methods.length` /
`GoRawStruct.fields.filter(f => f.exported).length` and `GoRawInterface.methods.length`.
`CapabilityGraphBuilder.buildNodes()` populates these during the existing loop over packages.

#### B. Type-level coupling metrics (fanIn / fanOut)

These measure coupling within the capability graph, **not** at the package level (package-level
coupling is already visible in the package dependency graph).

- **fanIn** — number of distinct nodes that have an edge pointing _to_ this node
  (i.e., how many types implement or use this interface/struct)
- **fanOut** — number of distinct nodes this node has edges pointing _to_
  (i.e., how many types this struct depends on)

Store on `CapabilityNode`:

```typescript
interface CapabilityNode {
  // existing + A fields ...
  fanIn?: number;
  fanOut?: number;
}
```

Computed in a post-processing pass at the end of `CapabilityGraphBuilder.build()`, after
deduplication, over the final edge list.

#### C. Diagram output

`renderCapabilityGraph()` uses `flowchart LR`; node labels follow flowchart syntax. Metrics are
appended to the node label string:

```
// Interface node (hexagon shape)
storeStore{{"store.Store [20m | fi:5]"}}

// Struct node (rectangle)
hubServer["hub.Server [12f 8m | fo:3]"]
```

Legend: `Nm` = N directly-declared methods, `Nf` = N exported fields, `fi:N` = fanIn, `fo:N` = fanOut.
Metrics with value 0 or undefined are omitted to keep labels readable.

Nodes that cross configurable thresholds (e.g., `methodCount > 10`, `fanIn > 5`) receive a
`:::hotspot` CSS class. This requires adding a `classDef` to `renderCapabilityGraph()` — that
method currently has no `classDef` blocks, unlike `renderPackageGraph()`:

```
classDef hotspot fill:#ff7675,stroke:#d63031,stroke-width:2px
```

### Files affected

- `src/types/extensions.ts` — extend `CapabilityNode`
- `src/plugins/golang/atlas/builders/capability-graph-builder.ts` — populate new fields + fanIn/fanOut pass
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts` — render metric labels and hotspot classDef

---

## Proposal 2 — Fix Cross-Package Same-Name Type Collision in Capability Edges

### Problem

When two packages share the same short name (e.g., `pkg/engine` and `pkg/adapter/engine` both have
`pkg.name = "engine"`), a struct field typed `*engine.SomeType` resolves to whichever package
registered first — producing false-positive or false-negative edges in the capability graph.

### Root cause

`CapabilityGraphBuilder.buildEdges()` builds "uses" edges by scanning struct fields. For a field
like `*engine.Engine`, `extractTypeQualifier()` extracts the short qualifier `"engine"`, then
looks up `pkgTypeToNodeId.get("engine:Engine")`. The lookup map registers entries under both short
name and full path:

```typescript
pkgTypeToNodeId.set(`${pkg.name}:${iface.name}`, ...);     // "engine:Engine"
pkgTypeToNodeId.set(`${pkg.fullName}:${iface.name}`, ...);  // "pkg/engine:Engine"
```

The `"pkg/engine:Engine"` key already exists and is unambiguous. The problem is that
`extractTypeQualifier()` only knows the source-code token `"engine"` — it has no way to produce
`"pkg/engine"` from the field type string alone.

Note: this bug is entirely within `capability-graph-builder.ts`. The `GoCallExpr` structure and
`tree-sitter-bridge.ts` are not involved in capability edge construction; they serve the flow graph.

### Fix

During `buildEdges()`, for each struct's containing package, build a qualifier-to-fullPath map from
`GoRawPackage.imports` (already available, no new parsing):

```typescript
// Resolve import alias → full import path for this package's imports
const qualifierToFullPath = new Map<string, string>();
for (const imp of pkg.imports) {
  // imp.alias is the local name used in source (e.g. "engine")
  // imp.path is the full import path (e.g. "github.com/org/repo/pkg/engine")
  const alias = imp.alias ?? imp.path.split('/').pop()!;
  qualifierToFullPath.set(alias, imp.path);
}
```

When resolving a qualified field type (e.g., `*engine.Engine`):

1. Look up `qualifier → fullPath` via `qualifierToFullPath`
2. Convert the full import path to the module-relative form already used as key:
   `fullPath.replace(moduleName + '/', '')` → `"pkg/engine"`
3. Look up `pkgTypeToNodeId.get("pkg/engine:Engine")` — the unambiguous key

If no import alias entry exists for the qualifier (e.g., standard library, or an import the
builder doesn't track), fall through to the existing short-name lookup as a best-effort fallback.

This fix uses only `GoRawPackage.imports`, which is already populated by the tree-sitter bridge for
all packages. No changes to `GoCallExpr`, `GoRawData`, or `tree-sitter-bridge.ts` are needed.

### Files affected

- `src/plugins/golang/atlas/builders/capability-graph-builder.ts` — use imports for qualifier resolution

---

## Proposal 3 — Concrete vs Interface Type Usage on the Capability Diagram

### Problem

The capability graph shows a `uses` edge between two nodes but does not distinguish _how_ the
dependency is held:

- `hub.Server` holds a `*engine.Engine` field → concrete type, hard to mock
- `hub.Server` holds an `engine.Runner` field → interface, easily substitutable

Both appear as identical `uses` edges today. The difference matters for testability and for spotting
accidental coupling to implementation details.

### What to add

#### A. Extend `CapabilityRelation`

```typescript
interface CapabilityRelation {
  // existing fields ...
  concreteUsage?: boolean;  // true = field/param type is a concrete struct (not an interface)
                            // absent = unknown or not applicable (e.g., implements edges)
}
```

Populated in `CapabilityGraphBuilder.buildEdges()` where the target node is already resolved:
`concreteUsage = (targetNode.type === 'struct')`.

#### B. Diagram output

The current capability graph has two edge styles:

- `implements` → `-.->|impl|` (dashed)
- `uses` → `-->|uses|` (solid)

Adding interface-based `uses` as a third dashed variant would create visual ambiguity with
`implements`. Instead, use a thick arrow for concrete dependencies — Mermaid flowchart supports
`==>` for thick solid arrows:

```
// interface-based uses (unchanged)
hubServer -->|uses| engineRunner

// concrete-type uses (thick arrow signals "tight coupling")
hubServer ==>|conc| engineEngine
```

This gives three visually distinct styles with clear semantics:
- `-.->` dashed = implements (IS-A)
- `-->` solid thin = uses via interface (HAS-A, loosely coupled)
- `==>` solid thick = uses concrete type (HAS-A, tightly coupled)

#### C. Supplementary data in GoAtlasExtension

Concrete-usage risks are stored as part of the capability layer's data — **not** emitted as a file
by the plugin. The CLI layer handles file output decisions.

Extend `CapabilityGraph` in `extensions.ts`:

```typescript
export interface CapabilityGraph {
  nodes: CapabilityNode[];
  edges: CapabilityRelation[];
  concreteUsageRisks?: ConcreteUsageRisk[];  // populated when any concrete cross-pkg deps exist
}

export interface ConcreteUsageRisk {
  owner: string;         // FQN of the struct holding the field, e.g. "pkg/hub.Server"
  fieldType: string;     // raw field type from source, e.g. "*engine.Engine"
  concreteType: string;  // FQN of the concrete target, e.g. "pkg/engine.Engine"
  location: string;      // "file:line"
}
```

The CLI `analyze` command can then serialize `atlas.layers.capability.concreteUsageRisks` to
`archguard/go-testability-risks.json` when the format includes capability data.

### Files affected

- `src/types/extensions.ts` — add `ConcreteUsageRisk`, extend `CapabilityGraph`
- `src/plugins/golang/atlas/builders/capability-graph-builder.ts` — populate `concreteUsage` on edges and `concreteUsageRisks` on graph
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts` — render `==>|conc|` for concrete edges

---

## Proposal 4 — Goroutine Lifecycle Completeness

### Problem

The goroutine topology diagram records where goroutines are _spawned_ but not whether they have a
_defined exit path_. A goroutine lacking a context cancellation check or a shutdown channel is a
potential goroutine leak.

Two static indicators are detectable:

1. **Context parameter** — does the spawned function accept a `context.Context` parameter?
2. **Cancellation check** — does the function body contain `<-ctx.Done()` or a `select` over a
   named stop channel?

### Selective extraction constraint

This is the key feasibility constraint the design must address.

Selective extraction (default mode) only extracts function bodies that contain `go_statement`,
`send_statement`, `receive_expression`, or HTTP handler patterns. This means the **spawning**
function's body is extracted, but the **spawned** function's body may not be — especially when
the spawned function is in a file with no goroutine or channel operations of its own.

Example:

```go
// server.go — contains go_statement → body IS extracted
func (s *Server) Start(ctx context.Context) {
    go s.handleConn(ctx)
}

// handler.go — no goroutine/channel ops → body NOT extracted in selective mode
func (s *Server) handleConn(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():  // ← needed for lifecycle detection, but body unavailable
            return
        }
    }
}
```

**Chosen strategy — two-tier coverage**:

- **Tier 1 (always available)**: Check the **function signature** of the spawn target. This requires
  only the parameter list, which is extracted in all modes (tree-sitter parses declarations without
  needing body extraction). `receivesContext` is always reliable.
- **Tier 2 (body-dependent)**: Check for `<-ctx.Done()` or stop-channel selects inside the function
  body. Only available when the spawned function's body was extracted. In selective mode, mark
  `cancellationCheckAvailable: false` and omit `hasCancellationCheck` for those goroutines.

For `functionBodyStrategy: 'full'`, both tiers are available for all goroutines.

### What to add

#### A. Extend `GoroutineTopology` with lifecycle data

Lifecycle data is colocated with the goroutine layer — it is not a separate layer:

```typescript
export interface GoroutineTopology {
  nodes: GoroutineNode[];
  edges: SpawnRelation[];
  channels: ChannelInfo[];
  channelEdges: ChannelEdge[];
  lifecycle?: GoroutineLifecycleSummary[];  // NEW: one entry per spawned GoroutineNode
}

export interface GoroutineLifecycleSummary {
  nodeId: string;                          // references GoroutineNode.id
  receivesContext: boolean;                // from function signature (always available)
  cancellationCheckAvailable: boolean;     // false when body was not extracted
  hasCancellationCheck?: boolean;          // only present when cancellationCheckAvailable=true
  cancellationMechanism?: 'context' | 'channel';  // classification when check found
  orphan: boolean;                         // true when receivesContext=false
                                           // AND (hasCancellationCheck=false OR body unavailable)
}
```

The `orphan` field is conservative: a goroutine is only marked as orphan when it has no context
parameter **and** either the cancellation check is confirmed absent or the body is unavailable.

#### B. Detection logic

Extend `GoroutineTopologyBuilder` with a lifecycle pass after the topology is built.

For each `SpawnRelation`, identify the spawn target function name from the `GoSpawnStmt.call`.
Then in the raw data:

1. **Context check (Tier 1)**: find the matching `GoFunction` or `GoMethod` by name. Check
   `parameters` for a type containing `context.Context`.
2. **Cancellation check (Tier 2)**: if `func.body` is present:
   - `channelOps`: look for `receive` on a channel variable named `ctx`, `done`, `stop`, `quit`,
     or `cancel`
   - `calls`: look for `functionName === "Done"` (i.e., a call to `ctx.Done()`)
3. If `func.body` is absent: set `cancellationCheckAvailable: false`.

Anonymous goroutines (`spawnType === 'anonymous_func'`) cannot be matched to a named function;
they are given `receivesContext: false` and `cancellationCheckAvailable: false` unless the closure
body was captured in the spawning function's extracted body.

#### C. Goroutine topology diagram — lifecycle annotations

`MermaidTemplates.renderGoroutineTopology(topology: GoroutineTopology)` already receives the full
`GoroutineTopology`. After adding `lifecycle` to that type, the renderer can access lifecycle data
without signature changes.

Annotate node labels with lifecycle status:

```
// In renderGoroutineTopology, when building the label for a spawned node:
const lifecycleTag = getLifecycleTag(node.id, topology.lifecycle);

// where getLifecycleTag returns:
//   "✓ctx"      — receivesContext=true AND hasCancellationCheck=true
//   "ctx?"      — receivesContext=true, body unavailable (cannot confirm check)
//   "⚠ no exit" — orphan=true
//   ""           — no lifecycle data
```

Rendered output:

```
flowchart TB
  ...
  pkg_hub_Server_Start_spawn_88["handleConn (✓ctx)"]:::spawned
  pkg_hub_Server_Start_spawn_112["processEvents (⚠ no exit)"]:::spawned
```

#### D. Lifecycle data in GoAtlasExtension (for JSON consumers)

Since `lifecycle` is a field on `GoroutineTopology`, it is automatically included when the
goroutine layer is serialized to JSON (`--format json`). No additional file emission is needed.
The CLI layer can additionally write a standalone `go-goroutine-lifecycle.json` by extracting
`atlas.layers.goroutine.lifecycle` from the extension.

### Static analysis limitations

- **Anonymous goroutines with captured state**: a closure that captures a `done` channel via outer
  scope cannot have its cancellation check detected from the body alone (requires scope analysis).
  These are marked `cancellationCheckAvailable: false`.
- **Indirect cancellation**: a goroutine that calls a helper which checks context is not detected.
- **False negatives in selective mode**: spawned functions in files with no goroutine/channel
  operations have `cancellationCheckAvailable: false`, not `orphan: true` — avoiding false alarms.

### Files affected

- `src/types/extensions.ts` — add `GoroutineLifecycleSummary`, extend `GoroutineTopology`
- `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts` — add lifecycle detection pass
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts` — annotate goroutine node labels

---

## ADR-002 versioning note

Proposals 1, 3, and 4 all extend types in `src/types/extensions.ts`. All changes are
backwards-compatible additions (new optional fields). `GO_ATLAS_EXTENSION_VERSION` should be
bumped to `'1.1'` once any of these proposals is merged.

---

## Summary

| # | Title | Nature | Output | Diagram affected | New file |
|---|-------|--------|--------|------------------|----------|
| 1 | Structural metrics | Feature | Capability diagram labels + hotspot colors | `architecture-capability.mmd` | — |
| 2 | Fix qualifier resolution | Bug fix | Correct edges (no diagram format change) | `architecture-capability.mmd` | — |
| 3 | Concrete vs interface usage | Feature | Capability diagram thick arrows + GoAtlasExtension data | `architecture-capability.mmd` | `go-testability-risks.json` (CLI, conditional) |
| 4 | Goroutine lifecycle completeness | Feature | Goroutine diagram annotations + GoroutineTopology.lifecycle | `architecture-goroutine.mmd` | `go-goroutine-lifecycle.json` (CLI, optional) |

**Implementation grouping**:

- Proposal 2 (bug fix) should be a standalone PR — it changes one builder and has no API surface
  changes. Mixing it with feature work makes rollback harder and review less focused.
- Proposals 1 and 3 share the same builder and renderer change surface (capability layer) and are
  good candidates to implement together.
- Proposal 4 is independent of all others.
