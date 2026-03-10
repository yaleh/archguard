# Multi-Paradigm MCP Tools

> Status: Draft (rev 4)
> Scope: Extend MCP tools to support object-oriented and package-oriented design paradigms
>        without exceeding the token budget; inform Claude Code of the applicable paradigm
>        at the earliest possible point in the workflow.
> Depends on: proposal-go-atlas-mcp-query-awareness.md (Fix 1 + Fix 2 are prerequisites)

---

## Problem Statement

ArchGuard supports two structurally different architectural paradigms across its language
plugins:

| Paradigm | Languages | Primary unit | Relation type |
|---|---|---|---|
| Object-oriented (OO) | TypeScript, Java, C++, Python | class / interface | inheritance, implementation, composition |
| Package-oriented | Go | package | import dependency |

The current MCP tool set was designed around the OO paradigm. Eight of the nine query
tools operate on `arch.json.entities` and `arch.json.relations`, which for a Go project
contain only struct/interface-level data. Go's package dependency graph lives in
`extensions.goAtlas.layers.*` and is not accessible through any MCP tool.

This creates two independent problems:

**Problem 1 — Coverage gap**: No MCP tool can answer package-level queries for Go.
`archguard_get_dependencies("internal/query")` returns `[]`; the 19-edge package graph
is invisible.

**Problem 2 — Misleading availability**: Tools that are inapplicable to Go
(`archguard_find_subclasses`, `archguard_detect_cycles`) still appear in the tool list
with no indication that they will return meaningless results. An LLM agent has no signal
to avoid them without prior knowledge of Go's design constraints.

---

## Design Decisions

### Decision 1: Budget unit is tokens, not tool count

Claude Code warns when MCP tool definitions exceed **25,000 tokens** of context.
"≤ 15 tools" is a common approximation of that budget for tools with typical descriptions,
but the real constraint is token consumption. A tool with a 500-word description costs as
much as five tools with one-sentence descriptions. This proposal targets staying
well under 25,000 tokens while maximising information per tool.

Implication: description additions in this proposal are limited to **one sentence per
tool**. Multi-sentence applicability prose defeats the budget it is trying to respect.

### Decision 2: Paradigm routing via response content, not via tool list reshaping

The MCP specification's `notifications/tools/list_changed` mechanism is **not used**
in this proposal. Although the SDK supports `tool.disable()` / `tool.enable()` with
automatic debounced notification, and Claude Code handles the notification correctly,
applying it here would require per-`projectRoot` enable/disable state: a single MCP
server instance handles multiple projects simultaneously, and disabling `find_subclasses`
globally after analyzing a Go project would break a concurrent TypeScript query.
Introducing session state to track which tools are enabled per project is complex and
runs counter to the current stateless server design.

Paradigm guidance is instead embedded in **response content** at three layers
(see Decision 3). This achieves the same routing effect with no server-side state,
no protocol-level coordination, and full multi-project support.

### Decision 3: Paradigm information at three notification layers

Guidance is embedded at each natural interaction point so the signal reaches Claude Code
regardless of which entry path it takes:

| Layer | When | Mechanism |
|---|---|---|
| Static | MCP connection (before any call) | Tool `description` — one sentence per restricted tool |
| Early runtime | After `archguard_analyze` | Response text: `Paradigm:` section with applicable/limited lists |
| Structured runtime | After `archguard_summary` | Response JSON: `capabilities` object |

Each layer degrades gracefully if the previous one is missed.

### Decision 4: Atlas layer access belongs in QueryEngine, not mcp-server.ts

`QueryEngine.archJson` is **private**. The MCP handler cannot access
`archJson.extensions` directly. Adding a new public getter on `QueryEngine` follows the
existing pattern (all data access goes through the engine) and keeps `mcp-server.ts` as
a pure transport layer.

The new method is `QueryEngine.getAtlasLayer(layer)`, which returns the requested layer
object or `undefined` when absent.

### Decision 5: One new tool for Go package-layer access

`archguard_get_atlas_layer` is added as the sole new tool. All other coverage gaps are
addressed through paradigm guidance. Total: **10 tools**.

---

## Proposed Changes

### 1. Tool `description` fields — static paradigm hints (one sentence each)

| Tool | Sentence to append |
|---|---|
| `archguard_find_subclasses` | `"Only applicable to OO languages; Go has no class inheritance and will always return empty."` |
| `archguard_find_implementers` | `"For Go, finds struct types satisfying an interface via implicit structural typing."` |
| `archguard_get_dependencies` | `"Operates at entity (class/struct) level; for Go package-level dependencies use archguard_get_atlas_layer."` |
| `archguard_get_dependents` | `"Operates at entity (class/struct) level; for Go package-level reverse dependencies use archguard_get_atlas_layer."` |
| `archguard_detect_cycles` | `"For Go: the compiler prevents import cycles, so this tool will return empty for any valid Go project."` |

---

### 2. `archguard_analyze` response — early runtime paradigm declaration

Extend `formatAnalyzeResponse()` in `src/cli/mcp/analyze-tool.ts`.

For OO languages (TypeScript, Java, C++, Python) the existing output is unchanged.

For Go Atlas, append a `Paradigm:` block after the `Diagrams:` section:

```
Paradigm: package (Go Atlas)
  Applicable:  archguard_summary, archguard_find_entity, archguard_get_file_entities,
               archguard_find_implementers, archguard_get_atlas_layer
  Limited:     archguard_get_dependencies / get_dependents (entity-level only;
               use get_atlas_layer for package deps)
  Not useful:  archguard_find_subclasses (no inheritance), archguard_detect_cycles
               (compiler-enforced; always empty)
  Package graph: .archguard/output/architecture-package.mmd

Next step: call archguard_summary or archguard_get_atlas_layer.
```

The applicable/limited/not-useful lists are **static strings keyed by language**. No
dynamic introspection is required.

**Language detection**: `RunAnalysisResult.config` has no `language` field. The language
is available per-diagram in `result.diagrams[n].language` (optional). Use:

```typescript
const language = result.diagrams.find(d => d.language)?.language;
const isGo = language === 'go';
```

If `diagrams` is empty (json-format-only run with no diagrams generated), `language` is
undefined and the `Paradigm:` block is omitted. This is the correct fallback: no diagrams
means the language was not determined, so no paradigm guidance can be given.

---

### 3. `archguard_summary` response — structured capability declaration

Extend `getSummary()` in `src/cli/query/query-engine.ts`.

#### 3a. New return fields

```typescript
getSummary(): {
  // existing fields unchanged
  entityCount: number;
  relationCount: number;
  language: string;
  kind: 'parsed' | 'derived';
  topDependedOn: Array<{ name: string; dependentCount: number }>;  // see 3b
  // new fields
  capabilities: {
    classHierarchy: boolean;          // find_subclasses applicable: language supports inheritance
    interfaceImplementation: boolean; // find_implementers applicable: implementation data present
    packageGraph: boolean;            // get_atlas_layer available: goAtlas.layers.package present
    cycleDetection: boolean;          // detect_cycles applicable: language paradigm supports it
  };
}
```

The `paradigm: 'oo' | 'package'` field originally proposed is **dropped**: it would
need maintenance as languages are added, and LLMs can derive the same information from
`capabilities` without a separate categorical field.

#### 3b. Derivation logic

All four capability flags share one semantics: **"will this tool return useful results for
this project?"** Flags derived from language paradigm answer "structurally possible";
flags derived from data answer "actually present". Using both within the same object
would be inconsistent. The chosen semantics is **language paradigm** for structural
constraints (inheritance, cycles) and **data presence** for data-dependent features
(implementations, package graph):

```typescript
const hasImplementation = (this.index.relationsByType['implementation']?.length ?? 0) > 0;
const hasAtlas = !!this.archJson.extensions?.goAtlas?.layers?.package;

const capabilities = {
  // Go has no class inheritance; find_subclasses is always empty for Go.
  // Use language check, not data check: a TypeScript project with no inheritance
  // still supports the concept — find_subclasses is applicable but returns empty.
  classHierarchy: this.archJson.language !== 'go',

  // All languages can produce implementation relations (Go via gopls,
  // TypeScript via structural typing, Java/C++ via explicit declarations).
  // Use data presence: if no implementations exist in this project,
  // find_implementers will return empty.
  interfaceImplementation: hasImplementation,

  // Available only when the Atlas extension is present.
  packageGraph: hasAtlas,

  // Go's compiler prevents import cycles regardless of Atlas mode; detect_cycles
  // returns empty for all valid Go code. Use language check, not hasAtlas:
  // standard-mode Go (no Atlas extension) also has compiler-enforced acyclicity.
  // A healthy OO project with no current cycles still benefits from cycle
  // detection tooling.
  cycleDetection: this.archJson.language !== 'go',
};
```

The mixed semantics is intentional and documented: structural impossibilities use
language checks; data availability uses data checks. The two cases do not overlap.

#### 3c. `topDependedOn` for non-OO paradigms

`topDependedOn` is an OO coupling metric (entity in-degree ranking). For Go, the index
only contains 7 interface-implementation edges; the result is trivial and architecturally
meaningless.

When `hasAtlas` is true, `topDependedOn` is set to `[]` and a `topDependedOnNote` field
is added:

```typescript
topDependedOn: hasAtlas ? [] : /* existing computation */,
topDependedOnNote: hasAtlas
  ? 'Not available for Go Atlas projects. Use archguard_get_atlas_layer({ layer: "package" }) to find the most-imported packages.'
  : undefined,
```

---

### 4. `QueryEngine.getAtlasLayer()` — new public method

Since `QueryEngine.archJson` is private, Atlas data must be exposed via a new public
method. This keeps `mcp-server.ts` as a pure transport layer and all data access through
the engine, consistent with the existing design.

```typescript
// src/cli/query/query-engine.ts

import type { GoAtlasLayers } from '@/types/extensions.js';

/** Return a named Go Atlas layer, or undefined if not present. */
getAtlasLayer<K extends keyof GoAtlasLayers>(layer: K): GoAtlasLayers[K] | undefined {
  return this.archJson.extensions?.goAtlas?.layers?.[layer];
}
```

The generic parameter ensures the return type is narrowed correctly:
- `getAtlasLayer('package')` → `PackageGraph | undefined`
- `getAtlasLayer('goroutine')` → `GoroutineTopology | undefined`

---

### 5. New tool: `archguard_get_atlas_layer`

**Description** (one sentence): "Query a named layer of the Go Atlas architecture graph;
returns nodes and edges for `package`, `capability`, `goroutine`, or call chains for
`flow`."

**Schema**:

```typescript
{
  projectRoot: projectRootParam,
  scope:       scopeParam,
  layer: z.enum(['package', 'capability', 'goroutine', 'flow'])
           .describe('Atlas layer to retrieve'),
  format: z.enum(['full', 'adjacency'])
            .default('full')
            .describe(
              'full: raw layer object as JSON (works for all layers). ' +
              'adjacency: simplified [{from, to, label}] edge list — ' +
              'not supported for the flow layer.'
            ),
}
```

**Format: `adjacency`** — available for `package`, `capability`, `goroutine` only.

The `flow` layer has a structurally different schema (`entryPoints` + `callChains`
instead of `nodes` + `edges`). Requesting `adjacency` for `flow` returns an error
directing the caller to use `full` instead.

```typescript
function toAdjacency(layer: 'package', data: PackageGraph): AdjacencyEdge[]
function toAdjacency(layer: 'capability', data: CapabilityGraph): AdjacencyEdge[]
function toAdjacency(layer: 'goroutine', data: GoroutineTopology): AdjacencyEdge[]

interface AdjacencyEdge { from: string; to: string; label?: string }
```

For `package`: `PackageDependency.from`/`to` are package IDs (full module paths, e.g.
`"github.com/example/app/pkg/hub"`), not short names. `from` and `to` in the adjacency
output must be resolved via `nodes.find(n => n.id === edge.from)?.name ?? edge.from` /
`nodes.find(n => n.id === edge.to)?.name ?? edge.to` to obtain `PackageNode.name` (short
path, e.g. `"internal/query"`). `label` = `"${strength} refs"`.

For `capability`: `CapabilityRelation` uses `source`/`target` fields (not `from`/`to`).
Both `source` and `target` are IDs. Must look up names via
`nodes.find(n => n.id === edge.source)?.name ?? edge.source` /
`nodes.find(n => n.id === edge.target)?.name ?? edge.target`.
`label` = `edge.type` (`"implements"` or `"uses"`).

For `goroutine`: `SpawnRelation.from`/`to` are function IDs (matching `GoroutineNode.id`),
not names. Must look up names via `nodes.find(n => n.id === edge.from)?.name ?? edge.from` /
`nodes.find(n => n.id === edge.to)?.name ?? edge.to`. No label.

**Format: `full`** — returns the raw layer object from `engine.getAtlasLayer(layer)`.

**Error responses**:

```
# No Atlas extension at all:
No Atlas data found. This tool requires a Go project analyzed with Atlas mode.
Run: archguard_analyze({ projectRoot: "...", lang: "go" })

# Layer present in schema but empty in this project:
Layer "flow" is empty for this project (no HTTP/gRPC entry points detected).

# adjacency requested for flow:
Layer "flow" does not support adjacency format. Use format="full" to retrieve
entryPoints and callChains.
```

**Implementation location**: `src/cli/mcp/mcp-server.ts`, using
`engine.getAtlasLayer(layer)` introduced in Change 4.

---

## Implementation Constraints

### `archJson.extensions` is private in QueryEngine

**Problem**: `QueryEngine.archJson` is declared `private`. Before this proposal,
`mcp-server.ts` handlers had no access to extensions.

**Resolution**: Change 4 (`getAtlasLayer`) solves this. No other changes require
accessing `archJson` directly from outside `QueryEngine`.

### `GoAtlasLayers` fields are all optional

`package?`, `capability?`, `goroutine?`, `flow?` — any subset may be absent if the
analysis was run with `--atlas-layers` filtering. The tool must check each layer for
existence before accessing it.

### FlowGraph has a different schema from the other three layers

`FlowGraph` does not have top-level `nodes` and `edges`. It has `entryPoints:
EntryPoint[]` and `callChains: CallChain[]`. The `adjacency` format is not applicable
and must be explicitly rejected.

---

## Files Changed

| File | Change |
|---|---|
| `src/cli/mcp/analyze-tool.ts` | `formatAnalyzeResponse()`: append `Paradigm:` block for Go |
| `src/cli/query/query-engine.ts` | Add `getAtlasLayer<K>()` method; extend `getSummary()` with `capabilities` + `topDependedOn` suppression |
| `src/cli/mcp/mcp-server.ts` | Register `archguard_get_atlas_layer`; append one-sentence hints to 5 existing tool descriptions |
| `tests/unit/cli/mcp/analyze-tool.test.ts` | Test: Go response has `Paradigm:` block; TypeScript response does not |
| `tests/unit/cli/query/query-engine.test.ts` | Test: `getSummary()` capabilities for Go Atlas vs TypeScript; `getAtlasLayer()` return types; `topDependedOn` suppression |
| `tests/unit/cli/mcp/mcp-server.test.ts` | Test: `archguard_get_atlas_layer` — adjacency/full formats; flow adjacency error; no-Atlas error; missing layer error |

---

## Out of Scope

**`notifications/tools/list_changed`**: Not used. The SDK and Claude Code both support
the mechanism, but applying it correctly requires per-`projectRoot` enable/disable state.
A single server instance handles multiple projects; `tool.disable()` is global and cannot
be scoped to a projectRoot without introducing session state management. This complexity
is incompatible with the stateless server design and is therefore excluded from this
proposal and any follow-up.

---

## Tool Budget

| # | Tool | Paradigm |
|---|---|---|
| 1 | `archguard_analyze` | All |
| 2 | `archguard_summary` | All |
| 3 | `archguard_find_entity` | All |
| 4 | `archguard_get_dependencies` | OO |
| 5 | `archguard_get_dependents` | OO |
| 6 | `archguard_find_implementers` | OO + Go (limited) |
| 7 | `archguard_find_subclasses` | OO only |
| 8 | `archguard_get_file_entities` | All |
| 9 | `archguard_detect_cycles` | OO |
| 10 | `archguard_get_atlas_layer` | Go only |

**Token budget**: A tool with 4-5 parameters and one-sentence descriptions costs
approximately 200–300 tokens when serialized as JSON schema in the LLM context
(measured from existing tool schemas in `mcp-server.ts`: `get_dependencies` ~105 tokens,
`find_entity` ~78 tokens, `summary` ~44 tokens). 10 tools estimated at **~2,000–3,000
tokens** total — well within the 25,000-token threshold, with ~8× headroom.

The one-sentence description constraint is essential: a 500-word description on a single
tool costs as much as 5 additional tools.

Remaining slots: **5** (budget for Java module graph, Python ABC topology, Rust crate
graph, or other language-specific tools).

---

## Acceptance Criteria

1. `archguard_analyze` on a Go project returns a response containing `Paradigm: package (Go Atlas)`.
2. `archguard_analyze` on a TypeScript project returns a response without a `Paradigm:` section.
3. `archguard_summary` returns a `capabilities` object for all languages, with `packageGraph: true` only for Go Atlas projects.
4. `archguard_summary` on a Go Atlas project returns `topDependedOn: []` and a non-empty `topDependedOnNote`.
5. `archguard_get_atlas_layer({ layer: 'package', format: 'adjacency' })` on a Go project returns an edge list with `from`/`to` using short package names.
6. `archguard_get_atlas_layer({ layer: 'flow', format: 'adjacency' })` returns an error directing the caller to use `full`.
7. `archguard_get_atlas_layer` on a non-Go project returns the no-Atlas error message.
8. All existing tests pass without modification.
