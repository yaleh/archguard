# Go Atlas MCP Query Awareness

> Status: Draft (rev 1)
> Scope: Fix misleading stats and blind query tools for Go Atlas projects
> Branch: `feat/go-atlas-mcp-query` (future)

---

## Problem Statement

When `archguard_analyze` is run against a Go project, it operates in **Atlas mode** by
default — generating a four-layer architecture diagram set from `extensions.goAtlas.layers.*`.
However, every MCP query tool and the analyze response summary reads from `arch.json.relations`
and `arch.json.entities`, which are populated by a different, narrower data path.

The result: an LLM agent that runs `archguard_analyze` on a Go project, reads the stdout
summary, and then calls `archguard_summary` or `archguard_get_dependencies` receives data
that is **quantitatively misleading and structurally incomplete**.

---

## Evidence

Running ArchGuard against `~/work/meta-cc` (a 14-package Go project):

| Data source | entities | relations | Meaning |
|---|---|---|---|
| `output/architecture.json` (top-level) | 11 | **0** | Package entities only; package deps in Atlas extension |
| `query/<hash>/arch.json.relations` | — | **7** | Interface implementation relations from gopls only |
| `extensions.goAtlas.layers.package` | 13 nodes | **19 edges** | Actual package dependency graph |
| `extensions.goAtlas.layers.capability` | 29 nodes | **23 edges** | implements / uses relations |
| `extensions.goAtlas.layers.goroutine` | 3 nodes | **2 edges** | Goroutine spawn topology |
| `architecture-package.mmd` | 13 nodes | **21 edges** | Rendered output (correct) |

### What each tool reports

| Tool | Returns | Accurate? |
|---|---|---|
| `archguard_analyze` stdout | "11 entities  0 relations" | No — Atlas edges not counted |
| `archguard_summary.relationCount` | 7 | No — only gopls interface impls |
| `archguard_get_dependencies(pkg)` | `[]` | No — index built from 7 relations, not Atlas edges |
| `archguard_detect_cycles` | `[]` (no cycles) | Result correct by coincidence; source is wrong |
| `.mmd` files | 21 package edges, full graph | **Yes** — reads Atlas extension correctly |

---

## Root Cause

Two independent code sites fail to account for the Atlas extension:

### Bug 1 — `diagram-processor.ts` stats: always 0 relations for Go

**File**: `src/cli/processors/diagram-processor.ts:401–405`

```typescript
const moduleGraph = aggregatedJSON.extensions?.tsAnalysis?.moduleGraph;
const usesModuleGraph = diagram.level === 'package' && !!moduleGraph;

stats: {
  entities: usesModuleGraph ? moduleGraph.nodes.length : aggregatedJSON.entities.length,
  relations: usesModuleGraph ? moduleGraph.edges.length : aggregatedJSON.relations.length,
  //                                                       ↑ for Go Atlas = 0
```

The TypeScript `moduleGraph` special-case exists because TypeScript's package-level
diagram reads from `extensions.tsAnalysis.moduleGraph` instead of `relations[]`. Go Atlas
does the same — its package data lives in `extensions.goAtlas.layers.package` — but no
equivalent case was added when Atlas mode was implemented. Go falls through to
`aggregatedJSON.relations.length = 0`, producing the "0 relations" in the analyze summary.

### Bug 2 — `query-engine.ts` `getSummary()`: relations count ignores Atlas layers

**File**: `src/cli/query/query-engine.ts:112`

```typescript
getSummary() {
  return {
    entityCount: this.archJson.entities.length,
    relationCount: this.archJson.relations.length,   // ← 7, not 44
    ...
  };
}
```

`getSummary()` reads only `arch.json.relations`, which for a Go Atlas project contains
solely the 7 gopls-derived interface implementation relations. The 44 edges distributed
across the Atlas layers (19 package + 23 capability + 2 goroutine) are invisible to it.

### Shared root cause

Both bugs share the same underlying design gap: the Go Atlas extension was implemented
as a rendering path (Atlas → .mmd) but was never wired back into the query data layer
(ArchIndex, QueryEngine) or the analysis summary (DiagramProcessor stats). Package-level
dependency information is structurally stranded inside `extensions.goAtlas.layers.*`
with no path to the tools that LLMs use to query it.

---

## Proposed Fix

Two targeted changes, one per bug site. No schema changes. No new files.

### Fix 1 — `diagram-processor.ts`: add Atlas package-layer stats case

Parallel to the existing `usesModuleGraph` branch, add `usesAtlas`:

```typescript
const moduleGraph = aggregatedJSON.extensions?.tsAnalysis?.moduleGraph;
const usesModuleGraph = diagram.level === 'package' && !!moduleGraph;

const atlasPackageLayer = aggregatedJSON.extensions?.goAtlas?.layers?.['package'];
const usesAtlas = !!atlasPackageLayer && !usesModuleGraph;

stats: {
  entities: usesModuleGraph ? moduleGraph.nodes.length
          : usesAtlas      ? atlasPackageLayer.nodes.length
          : aggregatedJSON.entities.length,
  relations: usesModuleGraph ? moduleGraph.edges.length
           : usesAtlas      ? atlasPackageLayer.edges.length
           : aggregatedJSON.relations.length,
  parseTime,
},
```

**Expected analyze output after fix** (meta-cc):
```
- architecture  ok  13 entities  19 relations  9.8s
```

### Fix 2 — `query-engine.ts` `getSummary()`: Atlas-aware relation count

When the ArchJSON has a `goAtlas` extension, sum edges across all Atlas layers:

```typescript
getSummary() {
  const atlasEdgeCount = Object.values(
    this.archJson.extensions?.goAtlas?.layers ?? {}
  ).reduce(
    // Note: FlowGraph has no .edges field (it has entryPoints + callChains).
    // The cast safely returns 0 for FlowGraph. FlowGraph call chains are not
    // counted here — they are not edges in the same sense as package/capability/goroutine.
    (sum, layer) => sum + ((layer as { edges?: unknown[] }).edges?.length ?? 0),
    0
  );

  return {
    entityCount: this.archJson.entities.length,
    relationCount: atlasEdgeCount > 0 ? atlasEdgeCount : this.archJson.relations.length,
    language: this.archJson.language,
    kind: this.scopeEntry.kind,
    topDependedOn,
  };
}
```

> **Note on `FlowGraph`**: `FlowGraph` does not have an `.edges` field — it has `entryPoints`
> and `callChains`. The `reduce` cast `(layer as { edges?: unknown[] })` safely evaluates to
> `undefined` for `FlowGraph`, contributing 0 to `atlasEdgeCount`. FlowGraph call chain count
> is intentionally excluded from `relationCount` because call chains are not dependency edges
> in the same structural sense as package imports, capability relations, or goroutine spawns.

**Expected `archguard_summary` output after fix** (meta-cc):
```json
{
  "entityCount": 138,
  "relationCount": 44,
  ...
}
```

---

## Out of Scope: `archguard_get_dependencies` for Package-Level Queries

The MCP query tools (`archguard_get_dependencies`, `archguard_get_dependents`) build their
traversal index from `arch.json.relations`, which for Go Atlas contains only entity-level
interface implementation relations. A call like `archguard_get_dependencies("internal/query")`
returns `[]` because `internal/query` is a **package**, not a struct or interface — its
dependencies live in `extensions.goAtlas.layers.package.edges`, not in `relations`.

Making these tools package-aware for Go Atlas would require:
1. Defining a package-level entity type in ArchJSON (or a separate package index)
2. Extending `ArchIndexBuilder` to populate `dependencies`/`dependents` maps from Atlas
   layer edges in addition to `relations`
3. Adding a `archguard_get_package_dependencies` tool (or overloading the existing ones
   with a scope selector)

This is a larger change and is deferred. For now, the correct workflow for package-level
Go analysis is:

```
archguard_analyze(projectRoot, lang="go")
→ Read .archguard/output/architecture-package.mmd   ← complete package dependency graph
→ archguard_summary                                  ← now reports accurate counts (after Fix 2)
→ archguard_find_entity / archguard_get_dependencies ← works for structs/interfaces only
```

---

## Files Changed

| File | Change |
|---|---|
| `src/cli/processors/diagram-processor.ts` | Add `usesAtlas` branch in stats computation (~5 lines) |
| `src/cli/query/query-engine.ts` | Atlas-aware `relationCount` in `getSummary()` (~6 lines) |
| `tests/unit/cli/processors/diagram-processor.test.ts` | Add test: Go Atlas project → stats show Atlas package layer counts |
| `tests/unit/cli/query/query-engine.test.ts` | Add test: `getSummary()` sums Atlas layer edges when extension present |

---

## Acceptance Criteria

1. `archguard_analyze` stdout for a Go Atlas project reports Atlas package layer node/edge
   counts (not `0 relations`)
2. `archguard_summary.relationCount` for a Go Atlas project returns the sum of edges across
   all Atlas layers (not `7` or `0`)
3. Existing TypeScript and non-Atlas Go tests are unaffected
4. No changes to ArchJSON schema, `.mmd` output, or rendering pipeline
