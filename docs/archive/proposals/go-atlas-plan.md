# Go Atlas Enhancement — Development Plan

> Source proposal: `docs/proposals/go-atlas-enhancement.md` (rev 2)
> Branch: `feat/go`
> Status: Draft (rev 2)

---

## Overview

Four proposals from the enhancement document are mapped to three delivery phases:

| Phase | Proposals | Nature | Rationale |
|-------|-----------|--------|-----------|
| Phase A | Proposal 2 | Bug fix | Standalone; no API surface changes; must be reviewable and rollbackable in isolation |
| Phase B | Proposals 1 + 3 | Feature | Share the same builder and renderer change surface (capability layer); combined to avoid two partial-state commits on the same files |
| Phase C | Proposal 4 | Feature | Independent of all others; touches only the goroutine layer |

Phases A, B, and C are **sequentially independent** — they touch different layers and different
types. Phase A should land first (or in a separate PR) to keep the bug fix clean. Phases B and C
can be developed in parallel once Phase A is merged.

### Version bump coordination

`GO_ATLAS_EXTENSION_VERSION` in `src/types/extensions.ts` is bumped from `'1.0'` to `'1.1'`
**once** — in whichever phase merges first among B and C. The other phase then rebases onto that
bump rather than bumping again.

**Important**: `src/plugins/golang/atlas/index.ts:185` currently hardcodes `version: '1.0'` as a
string literal and does **not** reference `GO_ATLAS_EXTENSION_VERSION`. The phase that performs
the bump must also change `index.ts` to reference the constant:

```typescript
// index.ts — change this:
version: '1.0',
// to:
version: GO_ATLAS_EXTENSION_VERSION,
```

Both files must be updated together or the Atlas JSON output will continue to report `"1.0"`.

---

## Phase A — Fix Cross-Package Same-Name Type Collision (Proposal 2)

### Objectives

- Eliminate false-positive and false-negative `uses` edges in the capability graph caused by
  short-name collisions across packages (e.g., two packages both named `"engine"`).
- No new API surface. No changes to `extensions.ts` or any renderer.

### Files changed

| File | Change |
|------|--------|
| `src/plugins/golang/atlas/builders/capability-graph-builder.ts` | Use `GoRawPackage.imports` to build a qualifier-to-fullPath map per package; prefer the unambiguous `"pkg/engine:Engine"` key; fall back to short-name lookup only when no import alias entry exists |
| `tests/plugins/golang/atlas/capability-graph-builder.test.ts` | Add tests covering the collision scenario |

### Stages

#### Stage A-1 — Failing tests for the collision scenario

Write tests in `capability-graph-builder.test.ts` that demonstrate the current incorrect
behaviour.

**Fixture note**: `GoImport.location` is a required (non-optional) field. Every `GoImport` in
test fixtures must include it:

```typescript
imports: [{
  path: 'github.com/test/project/pkg/engine',
  location: { file: 'engine.go', startLine: 0, endLine: 0 },
}]
```

Scenarios:

- Two packages with `pkg.name = "engine"` but different `fullName` values
  (`"pkg/engine"` and `"pkg/adapter/engine"`).
- A struct in a third package whose `imports` contains
  `{ path: 'github.com/test/project/pkg/engine', ... }` and holds a field `*engine.Engine`.
- Assert the `uses` edge resolves to `"pkg/engine.Engine"`, not `"pkg/adapter/engine.Engine"`.
- A separate struct whose `imports` contains `{ path: 'github.com/test/project/pkg/adapter/engine', ... }`
  with the same qualifier and assert it resolves to `"pkg/adapter/engine.Engine"`.
- A struct with no matching import for a qualifier → assert edge is absent (not a false positive).

Expected test count: 4–6 new tests. All must fail before the fix.

#### Stage A-2 — Implement qualifier resolution via imports

In `buildEdges()`, inside the per-package loop (after the `pkgTypeToNodeId` maps are built),
construct a qualifier-to-fullPath map from `pkg.imports`:

```typescript
const qualifierToFullPath = new Map<string, string>();
for (const imp of pkg.imports) {
  const alias = imp.alias ?? imp.path.split('/').pop()!;
  qualifierToFullPath.set(alias, imp.path);
}
```

In the field resolution block, when `qualifier` is non-null, use this priority:

1. Look up `qualifier` in `qualifierToFullPath` to obtain the full import path.
2. If found, strip the module prefix to get the module-relative path:
   `fullPath.replace(rawData.moduleName + '/', '')` → e.g. `"pkg/engine"`.
   Then look up `pkgTypeToNodeId.get("pkg/engine:Engine")` — the unambiguous key.
3. Fall through to the existing `pkgTypeToNodeId.get("${qualifier}:${bareType}")` lookup only
   when step 2 yields no match. This fallthrough covers: (a) the import path does not start with
   `rawData.moduleName` (stdlib, external dependency), and (b) old fixtures without import data.
   These cases are intentional degraded-mode: best-effort resolution, same behaviour as before.

**Code budget**: `buildEdges()` change is ~20 lines added within the existing loop body.

#### Stage A-3 — Verify all existing tests still pass

```bash
npm test -- --reporter=verbose tests/plugins/golang/atlas/capability-graph-builder.test.ts
```

All previously passing tests must remain green. New tests from Stage A-1 must now pass.

### Acceptance criteria

- [ ] No existing capability-graph-builder tests regress.
- [ ] New collision-scenario tests pass (including the "no match → no edge" case).
- [ ] `npm test` total count does not decrease.
- [ ] No changes to `extensions.ts`, `mermaid-templates.ts`, or any other file.

---

## Phase B — Structural Metrics + Concrete Usage on the Capability Diagram (Proposals 1 + 3)

### Objectives

- Add `methodCount`, `fieldCount`, `fanIn`, `fanOut` to `CapabilityNode` (Proposal 1A/1B).
- Render metric labels and a `:::hotspot` CSS class in `renderCapabilityGraph()` (Proposal 1C).
- Add `concreteUsage` to `CapabilityRelation` and `ConcreteUsageRisk` / extend `CapabilityGraph`
  (Proposal 3A/3C).
- Render `==>|conc|` thick arrows for concrete-type `uses` edges (Proposal 3B).
- Bump `GO_ATLAS_EXTENSION_VERSION` to `'1.1'` and update `index.ts` to reference it
  (if Phase B merges first).

### Files changed

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Extend `CapabilityNode` (methodCount, fieldCount, fanIn, fanOut); add `ConcreteUsageRisk`; extend `CapabilityGraph` (concreteUsageRisks) |
| `src/plugins/golang/atlas/index.ts` | Reference `GO_ATLAS_EXTENSION_VERSION` constant instead of hardcoded `'1.0'` (if Phase B merges first) |
| `src/plugins/golang/atlas/builders/capability-graph-builder.ts` | Populate new node fields in `buildNodes()`; add fanIn/fanOut post-processing pass; set `concreteUsage` on `uses` edges; collect `concreteUsageRisks` |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Update `renderCapabilityGraph()`: metric label formatting, `:::hotspot` classDef, `==>|conc|` edge style |
| `tests/plugins/golang/atlas/capability-graph-builder.test.ts` | New tests for node metrics, fanIn/fanOut, concreteUsage, concreteUsageRisks |
| `tests/plugins/golang/atlas/mermaid-templates.test.ts` | New tests for metric labels, hotspot class, thick-arrow edges |
| `tests/plugins/golang/atlas/atlas-renderer.test.ts` | Update any existing assertions on capability diagram output that break due to new label format or edge style |

### Stages

These two sub-stages (B-types and B-render) can proceed in parallel after B-0.

#### Stage B-0 — ADR-002 type extensions (prerequisite for B-types and B-render)

Extend `src/types/extensions.ts` with backwards-compatible additions only. This is the only
stage that modifies `extensions.ts` in Phase B.

```typescript
// CapabilityNode additions (all optional)
interface CapabilityNode {
  // ... existing fields unchanged ...
  methodCount?: number;
  fieldCount?: number;
  fanIn?: number;   // count of distinct source nodes pointing to this node
  fanOut?: number;  // count of distinct target nodes this node points to
}

// CapabilityRelation addition (optional)
interface CapabilityRelation {
  // ... existing fields unchanged ...
  concreteUsage?: boolean;
}

// New top-level type
export interface ConcreteUsageRisk {
  owner: string;
  fieldType: string;
  concreteType: string;
  location: string;
}

// CapabilityGraph addition (optional field)
interface CapabilityGraph {
  nodes: CapabilityNode[];
  edges: CapabilityRelation[];
  concreteUsageRisks?: ConcreteUsageRisk[];
}
```

If Phase B merges before Phase C, also bump `GO_ATLAS_EXTENSION_VERSION = '1.1'` and update
`index.ts` as described in the Overview.

**Code budget**: ~30 lines added to `extensions.ts`, zero lines removed.

TypeScript type-check must pass: `npm run type-check`.

#### Stage B-types — Builder: node metrics, fanIn/fanOut, concreteUsage (parallel with B-render)

**Tests first** in `capability-graph-builder.test.ts`:

- `methodCount` on an interface node equals `iface.methods.length`.
- `methodCount` on a struct node equals `struct.methods.length` (directly-declared receiver
  methods only; embedded type promotions are not included since they do not appear in
  `GoRawStruct.methods`).
- `fieldCount` is the count of exported struct fields (`f.exported === true`); absent on interface
  nodes.
- `fanIn` on node X equals the number of **distinct source nodes** with any edge pointing to X
  (not edge count — a struct that both `implements` and `uses` the same target contributes 1 to
  the target's `fanIn`, not 2).
- `fanOut` on node X equals the number of **distinct target nodes** X has edges pointing to.
- Add a test where a struct both `implements` and `uses` the same interface — assert that
  interface's `fanIn === 1` (not 2) and the struct's `fanOut === 1` (not 2).
- `concreteUsage: true` on a `uses` edge where the target node is a struct.
- `concreteUsage` absent on `uses` edges to interface nodes.
- `concreteUsage` absent on `implements` edges.
- `concreteUsageRisks` populated with one entry per cross-package concrete field, carrying the
  correct `owner`, `fieldType`, `concreteType`, `location`.
- Same-package concrete field → no entry in `concreteUsageRisks`.

Expected test count: 10–14 new tests.

**Implementation** changes to `capability-graph-builder.ts`:

1. In `buildNodes()`, after constructing each node, attach:
   - `methodCount = iface.methods.length` for interfaces.
   - `methodCount = struct.methods.length` for structs (`GoRawStruct.methods` is already scoped
     to this struct; no flatMap needed).
   - `fieldCount = struct.fields.filter(f => f.exported).length` for structs (omit for interfaces).

2. In `buildEdges()`, before returning, build a `nodeIdToType` map from the nodes array:
   ```typescript
   const nodeIdToType = new Map(allNodes.map(n => [n.id, n.type]));
   ```
   When pushing a `uses` edge, set:
   ```typescript
   concreteUsage: nodeIdToType.get(targetNodeId) === 'struct'
   ```

3. After edge deduplication in `build()`, add a fanIn/fanOut post-processing pass. Count
   **distinct** node IDs, not edge count:
   ```typescript
   const fanInSources = new Map<string, Set<string>>();  // targetId → Set of sourceIds
   const fanOutTargets = new Map<string, Set<string>>();  // sourceId → Set of targetIds
   for (const edge of edges) {
     if (!fanInSources.has(edge.target)) fanInSources.set(edge.target, new Set());
     fanInSources.get(edge.target)!.add(edge.source);
     if (!fanOutTargets.has(edge.source)) fanOutTargets.set(edge.source, new Set());
     fanOutTargets.get(edge.source)!.add(edge.target);
   }
   for (const node of nodes) {
     node.fanIn  = fanInSources.get(node.id)?.size  ?? 0;
     node.fanOut = fanOutTargets.get(node.id)?.size ?? 0;
   }
   ```

4. After the fanIn/fanOut pass, collect `concreteUsageRisks`. Use the node's `package` field
   (already on `CapabilityNode`) to determine cross-package, rather than string splitting:
   ```typescript
   const nodeIdToPackage = new Map(nodes.map(n => [n.id, n.package]));
   const risks: ConcreteUsageRisk[] = [];
   for (const edge of edges) {
     if (!edge.concreteUsage) continue;
     const sourcePackage = nodeIdToPackage.get(edge.source);
     const targetPackage = nodeIdToPackage.get(edge.target);
     if (sourcePackage && targetPackage && sourcePackage !== targetPackage) {
       risks.push({
         owner:        edge.source,
         fieldType:    edge.context?.usageLocations?.[0] ?? '',  // raw type from field
         concreteType: edge.target,
         location:     edge.context?.usageLocations?.[0] ?? '',
       });
     }
   }
   ```
   Note: `fieldType` should carry the raw field type string (e.g. `"*engine.Engine"`), not the
   location. The `edge.id` encodes it as `uses-${sourceId}-${rawFieldType}` — extract accordingly.

**Code budget**: `buildNodes()` delta ~15 lines; `buildEdges()` delta ~10 lines;
post-processing pass ~30 lines.

#### Stage B-render — Renderer: metric labels, hotspot, thick arrows (parallel with B-types)

**Tests first** in `mermaid-templates.test.ts`. Fixtures manually construct `CapabilityNode`
and `CapabilityRelation` objects with the new optional fields set — no dependency on the builder:

- A struct node with `methodCount=8, fieldCount=12` renders as `["hub.Server [12f 8m]"]`.
- An interface node with `methodCount=20, fanIn=5` renders as `{{"store.Store [20m | fi:5]"}}`.
- Zero/undefined metrics are omitted from the label (no `[0f]` or `[fi:0]`).
- A node with `methodCount > 10` receives `:::hotspot`.
- A node with `fanIn > 5` receives `:::hotspot`.
- A node below both thresholds does NOT receive `:::hotspot`.
- When no node qualifies for hotspot, `classDef hotspot` is absent from output.
- When at least one node qualifies, `classDef hotspot` is present.
- A `uses` edge with `concreteUsage: true` renders as `==>|conc|`.
- A `uses` edge with `concreteUsage: false` (or absent) renders as `-->|uses|`.
- An `implements` edge renders as `-.->|impl|` regardless of `concreteUsage`.

Check `tests/plugins/golang/atlas/atlas-renderer.test.ts` for any existing tests that assert
on capability diagram output (node labels or edge format). Update those assertions to match the
new format **in the same stage** — do not leave them failing.

Expected test count: 10–14 new tests in `mermaid-templates.test.ts`, plus updates to any
breaking assertions in `atlas-renderer.test.ts`.

**Implementation** changes to `renderCapabilityGraph()` in `mermaid-templates.ts`:

1. Node label helper `private static formatCapabilityLabel(node: CapabilityNode): string`:
   - Size parts: `fieldCount > 0` → `"${fieldCount}f"`, `methodCount > 0` → `"${methodCount}m"`.
   - Coupling parts: `fanIn > 0` → `"fi:${fanIn}"`, `fanOut > 0` → `"fo:${fanOut}"`.
   - Format: `"Name [sizeParts | couplingParts]"` — omit the bracket section entirely if all
     values are 0 or undefined. Omit the `|` separator if only one section is non-empty.
   - Hotspot: `(node.methodCount ?? 0) > 10 || (node.fanIn ?? 0) > 5`.

2. Update node rendering inside `renderCapNode`:
   ```typescript
   const label = MermaidTemplates.formatCapabilityLabel(node);
   const hotspot = isHotspot(node) ? ':::hotspot' : '';
   output += `${indent}  ${mId}[["${label}"]]${hotspot}\n`; // interface: {{...}}, struct: [...]
   ```
   Track whether any hotspot node was emitted (boolean flag before the loop).

3. Add `classDef hotspot fill:#ff7675,stroke:#d63031,stroke-width:2px` after all subgraphs and
   before edges, only when the hotspot flag is true.

4. Edge rendering: `edge.concreteUsage === true` → emit `==>|conc|`; otherwise existing
   `-->|uses|`.

**Code budget**: helper function ~25 lines; `renderCapabilityGraph()` modifications ~20 lines.

#### Stage B-3 — Integration smoke test

```bash
npm run build
node dist/cli/index.js analyze -s ./src --lang go --atlas --atlas-layers capability -v
```

Verify the rendered capability diagram contains metric labels and thick arrows on a real
(or fixture) Go codebase. This is a manual/visual check; no new automated test required.

### Acceptance criteria

- [ ] `npm run type-check` passes with zero errors after Stage B-0.
- [ ] All new builder tests pass (Stage B-types), including the `fanIn/fanOut distinct-node` test.
- [ ] All new renderer tests pass (Stage B-render).
- [ ] No previously passing tests regress (including `atlas-renderer.test.ts`).
- [ ] Atlas JSON output field `version` is `"1.1"` at runtime (not just the constant value in
  `extensions.ts` — verify via `--format json` that `index.ts` references the constant).
- [ ] `concreteUsageRisks` is populated on the `CapabilityGraph` object when concrete
  cross-package deps exist; absent or empty when none.
- [ ] `classDef hotspot` appears in capability diagram output when a threshold is crossed;
  absent when no node qualifies.
- [ ] `==>|conc|` appears in the diagram for concrete-type `uses` edges.
- [ ] `completeness.capability` in `GoAtlasMetadata` remains `0.85` (unchanged — the new fields
  are additive; the coverage of capability detection itself has not changed).

---

## Phase C — Goroutine Lifecycle Completeness (Proposal 4)

### Objectives

- Detect context parameter presence (Tier 1, always reliable) and cancellation checks
  (Tier 2, body-dependent) for each spawned goroutine.
- Annotate goroutine topology diagram nodes with lifecycle status tags.
- Expose lifecycle data via `GoroutineTopology.lifecycle` for JSON consumers.
- Bump `GO_ATLAS_EXTENSION_VERSION` to `'1.1'` and update `index.ts` if Phase C merges before
  Phase B.

### Files changed

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Add `GoroutineLifecycleSummary`; extend `GoroutineTopology` with `lifecycle?` |
| `src/plugins/golang/atlas/index.ts` | Reference `GO_ATLAS_EXTENSION_VERSION` constant instead of hardcoded `'1.0'` (if Phase C merges first) |
| `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts` | Add lifecycle detection inside `build()` using raw spawn data |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | Annotate spawned node labels with lifecycle tags |
| `tests/plugins/golang/atlas/goroutine-topology-builder.test.ts` | New tests for lifecycle detection |
| `tests/plugins/golang/atlas/mermaid-templates.test.ts` | New tests for lifecycle node annotations |
| `tests/plugins/golang/atlas/atlas-renderer.test.ts` | Update any existing assertions on goroutine diagram output that break due to new node label format |

### Stages

#### Stage C-0 — ADR-002 type extensions

Extend `src/types/extensions.ts`:

```typescript
export interface GoroutineLifecycleSummary {
  nodeId: string;                          // matches GoroutineNode.id (spawn-N format)
  spawnTargetName: string;                 // resolved target function name, e.g. "handleConn"
                                           // "<anonymous>" for closures
  receivesContext: boolean;                // from function parameter list (always available)
  cancellationCheckAvailable: boolean;     // false when function body was not extracted
  hasCancellationCheck?: boolean;          // only present when cancellationCheckAvailable=true
  cancellationMechanism?: 'context' | 'channel';
  orphan: boolean;
}

export interface GoroutineTopology {
  nodes: GoroutineNode[];
  edges: SpawnRelation[];
  channels: ChannelInfo[];
  channelEdges: ChannelEdge[];
  lifecycle?: GoroutineLifecycleSummary[];  // NEW: one entry per spawned GoroutineNode
}
```

If Phase C merges before Phase B, also bump `GO_ATLAS_EXTENSION_VERSION = '1.1'` and update
`index.ts` as described in the Overview.

`npm run type-check` must pass.

#### Stage C-1 — Builder: lifecycle detection inside `build()` (tests first)

**Architecture note**: `SpawnRelation.to` encodes the spawned goroutine's node ID in the format
`"${pkg.fullName}.${parentName}.spawn-${lineNum}"` (e.g. `"pkg/hub.Server.Start.spawn-88"`).
This ID does **not** encode the spawn target's function name. The target function name is only
available in `GoSpawnStmt.call.functionName` in the raw data. Therefore, lifecycle detection
**must** happen inside `build()` while iterating the raw `goSpawns` — it cannot be done as a
separate post-pass over the built `SpawnRelation[]`.

**Tests first** in `goroutine-topology-builder.test.ts`. All fixtures call `builder.build()` and
inspect `result.lifecycle`. The spawn node ID in `lifecycle[i].nodeId` must match the
corresponding `GoroutineNode.id` in `result.nodes`.

Scenarios to cover:

1. **Named function, `context.Context` param, body extracted, `ctx.Done()` call present**
   - Build fixture: function `handleConn(ctx context.Context)` with
     `body.calls = [{ functionName: 'Done', packageName: 'ctx', ... }]`
   - Expect: `receivesContext: true`, `cancellationCheckAvailable: true`,
     `hasCancellationCheck: true`, `cancellationMechanism: 'context'`, `orphan: false`.

2. **Named function, `context.Context` param, body extracted, no cancellation check**
   - Expect: `receivesContext: true`, `cancellationCheckAvailable: true`,
     `hasCancellationCheck: false`, `orphan: false`.

3. **Named function, no context param, body extracted, no cancellation check**
   - Expect: `receivesContext: false`, `cancellationCheckAvailable: true`,
     `hasCancellationCheck: false`, `orphan: true`.

4. **Named function, `context.Context` param, body NOT extracted (selective mode)**
   - Build fixture: function exists in raw data with correct parameters but `body: undefined`.
   - Expect: `receivesContext: true`, `cancellationCheckAvailable: false`,
     `hasCancellationCheck` absent, `orphan: false`.

5. **Named function, no context param, body NOT extracted**
   - Expect: `receivesContext: false`, `cancellationCheckAvailable: false`, `orphan: true`.

6. **Anonymous goroutine (`call.functionName === '<anonymous>'`)**
   - Expect: `receivesContext: false`, `cancellationCheckAvailable: false`, `orphan: true`,
     `spawnTargetName: '<anonymous>'`.

7. **Function with stop-channel select** (body has `channelOps` with `operation: 'receive'` on
   a channel named `done`, `stop`, `quit`, or `cancel`)
   - Expect: `cancellationMechanism: 'channel'`, `hasCancellationCheck: true`.

8. **Spawn target not found in rawData** (e.g. the call is to a function in another package)
   - Expect: `receivesContext: false`, `cancellationCheckAvailable: false`, `orphan: true`.

9. **No spawns in rawData — `lifecycle` is empty array or undefined**.

Expected test count: 9–11 new tests.

**Implementation** in `goroutine-topology-builder.ts`:

Add a private method called from within `build()`, **not** as a post-pass over
`SpawnRelation[]`:

```typescript
private buildLifecycle(rawData: GoRawData): GoroutineLifecycleSummary[]
```

This method iterates the same `pkg → functions/methods → goSpawns` loop used by
`extractGoroutineNodes()` and `buildSpawnRelations()`. For each `spawn`:

1. **Construct the node ID** using the same formula as `extractSpawnedNodes()`:
   `"${pkg.fullName}.${parentName}.spawn-${spawn.location.startLine}"` — this is the value to
   store in `lifecycle[i].nodeId`.

2. **Get the target function name** directly from `spawn.call.functionName` (available here,
   not available from `SpawnRelation`).

3. **Tier 1 — context parameter check**:
   - If `functionName === '<anonymous>'`: `receivesContext = false`, skip Tier 2.
   - Otherwise: search `pkg.functions` by name, then `pkg.structs[*].methods` by name.
   - Check `parameters` for a field whose `type` contains `context.Context`.
   - Set `receivesContext = true` if found; `false` if the function exists but has no context
     param; also `false` if the function is not found in this package (cross-package spawn).

4. **Tier 2 — cancellation check** (only when `func.body !== undefined`):
   - `ctx.Done()` detection: look for a call where `functionName === 'Done'` AND
     `packageName` matches the name of the context parameter variable identified in Tier 1.
     (`packageName` in `GoCallExpr` is the selector operand — for `ctx.Done()`, it is `"ctx"`.)
   - Stop-channel detection: look for `channelOps` with `operation === 'receive'` and
     `channelName` in `['done', 'stop', 'quit', 'cancel', 'stopCh', 'doneCh']`.
   - Set `cancellationCheckAvailable = true`, `hasCancellationCheck = true/false` accordingly.

5. If `func.body === undefined`: `cancellationCheckAvailable = false`, `hasCancellationCheck`
   omitted.

6. **`orphan`**: `receivesContext === false && (cancellationCheckAvailable === false || hasCancellationCheck === false)`.

The `build()` return value becomes:

```typescript
const lifecycle = this.buildLifecycle(rawData);
return Promise.resolve({ nodes, edges, channels, channelEdges, lifecycle });
```

**Code budget**: `buildLifecycle()` ~80 lines; `build()` delta ~3 lines.

#### Stage C-2 — Renderer: lifecycle node label annotations (tests first, parallel with C-1)

**Tests first** in `mermaid-templates.test.ts`. Fixtures manually construct `GoroutineTopology`
with `lifecycle` arrays pre-populated — no dependency on the builder output:

1. Spawned node with lifecycle `{ receivesContext: true, hasCancellationCheck: true, ... }` →
   node label contains `✓ctx`.
2. Spawned node with lifecycle `{ receivesContext: true, cancellationCheckAvailable: false, ... }` →
   label contains `ctx?`.
3. Spawned node with lifecycle `{ orphan: true, ... }` → label contains `⚠ no exit`.
4. Spawned node with no matching lifecycle entry → label unchanged.
5. Multiple spawned nodes in the same topology each render the correct individual tag.

Check `tests/plugins/golang/atlas/atlas-renderer.test.ts` for existing goroutine diagram tests.
Update any assertions that break due to the new label format in the same stage.

Expected test count: 5–7 new tests in `mermaid-templates.test.ts`, plus updates to breaking
assertions in `atlas-renderer.test.ts`.

**Implementation** in `mermaid-templates.ts`:

`renderGoroutineTopology(topology: GoroutineTopology)` already receives the full
`GoroutineTopology` object — no signature change required.

Add a private static helper:

```typescript
private static getLifecycleTag(
  nodeId: string,
  lifecycle: GoroutineLifecycleSummary[] | undefined
): string {
  const entry = lifecycle?.find(l => l.nodeId === nodeId);
  if (!entry) return '';
  if (entry.receivesContext && entry.hasCancellationCheck) return ' ✓ctx';
  if (entry.receivesContext && !entry.cancellationCheckAvailable) return ' ctx?';
  if (entry.orphan) return ' ⚠ no exit';
  return '';
}
```

In the spawned-node label construction inside `renderGoroutineTopology()`:

```typescript
const lifecycleTag = MermaidTemplates.getLifecycleTag(node.id, topology.lifecycle);
// ...
label: `${displayName}${patternLabel}${lifecycleTag}`,
```

**Code budget**: helper ~15 lines; `renderGoroutineTopology()` delta ~5 lines.

#### Stage C-3 — Full build and visual check

```bash
npm run build
node dist/cli/index.js analyze -s ./src --lang go --atlas --atlas-layers goroutine -v
```

Inspect the rendered goroutine diagram for lifecycle tags. Manual check only.

### Acceptance criteria

- [ ] `npm run type-check` passes after Stage C-0.
- [ ] All 9+ lifecycle detection tests pass (Stage C-1).
- [ ] All 5+ renderer annotation tests pass (Stage C-2).
- [ ] No previously passing tests regress (including `atlas-renderer.test.ts`).
- [ ] Atlas JSON output field `version` is `"1.1"` at runtime (if Phase C merges first).
- [ ] `lifecycle` array is present in `GoroutineTopology` in JSON output when
  `--format json` is used — no extra serialization step needed.
- [ ] Anonymous goroutines are never marked `orphan: true` due to a detection failure;
  they always have `cancellationCheckAvailable: false`.
- [ ] Spawns whose target function is not found in the current package produce
  `cancellationCheckAvailable: false`, not `hasCancellationCheck: false` (conservative, not
  false-alarm).
- [ ] `completeness.goroutine` in `GoAtlasMetadata` is updated to reflect lifecycle coverage:
  `full` body strategy → `0.8`, `selective` → `0.6` (revised from `0.7` / `0.5` to reflect
  the added lifecycle data). Update the hardcoded values in `index.ts`.

---

## Cross-Phase Constraints

### ADR-002 backwards compatibility

All `extensions.ts` changes across all phases are new optional fields on existing interfaces.
No field is removed or renamed. No existing field type is narrowed. JSON consumers reading a
`version: "1.0"` payload are unaffected; JSON consumers reading a `version: "1.1"` payload
receive new optional fields and must treat their absence as equivalent to their zero/undefined
value.

### No dependency violation detection

None of the phases implement dependency violation detection or enforcement. `concreteUsageRisks`
(Phase B) is a data collection feature only — no scoring, no threshold violations, no
build-breaking behaviour.

### Test budget

Each stage targets:
- Implementation code: <= 200 lines changed per stage
- New test code: <= 200 lines per stage

Stages that exceed this should be split.

### Running the full suite

```bash
npm test
```

Expected: >= 1308 passing (current baseline). The 7 pre-existing failures in
`tests/integration/mermaid/e2e.test.ts` are not caused by any phase in this plan.

---

## Dependency Graph

```
Phase A  (standalone, no deps)
    └── can be developed and merged independently

Phase B
    B-0  (extensions.ts + index.ts if first)
    ├── B-types  (builder)    — blocked by B-0
    └── B-render (renderer)  — blocked by B-0; parallel with B-types

Phase C
    C-0  (extensions.ts + index.ts if first)
    ├── C-1  (builder)    — blocked by C-0
    └── C-2  (renderer)   — blocked by C-0; parallel with C-1

Phase B and Phase C are independent of each other.
Phase A is independent of both B and C.
```

---

## File Change Summary

| File | Phase A | Phase B | Phase C |
|------|---------|---------|---------|
| `src/types/extensions.ts` | — | B-0 | C-0 |
| `src/plugins/golang/atlas/index.ts` | — | B-0 (if first) | C-0 (if first) |
| `src/plugins/golang/atlas/builders/capability-graph-builder.ts` | A-2 | B-types | — |
| `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts` | — | — | C-1 |
| `src/plugins/golang/atlas/renderers/mermaid-templates.ts` | — | B-render | C-2 |
| `tests/plugins/golang/atlas/capability-graph-builder.test.ts` | A-1 | B-types | — |
| `tests/plugins/golang/atlas/goroutine-topology-builder.test.ts` | — | — | C-1 |
| `tests/plugins/golang/atlas/mermaid-templates.test.ts` | — | B-render | C-2 |
| `tests/plugins/golang/atlas/atlas-renderer.test.ts` | — | B-render | C-2 |
