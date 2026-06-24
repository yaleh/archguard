# Proposal: Architecture Cleanup — QueryEngine Decomposition, src/cli Root Consolidation, and FIM Experimental Isolation

**Status**: Draft (architect-reviewed 2026-06-13)  
**Date**: 2026-06-13  
**Scope**: Three independent structural improvements that share a common theme: reducing false hotspots in ArchGuard's own self-analysis output.

---

## 1. Background

ArchGuard's 2026-06-13 self-analysis surfaces three structural issues in the codebase. All three cause noise in architecture metrics (high entity-count in wrong buckets, god-class smell) without reflecting real runtime coupling.

### 1.1 QueryEngine God Class (Problem 1)

`src/core/query/query-engine.ts` (999 lines, 73 method/property declarations, out-degree 16) mixes three distinct responsibility clusters:

| Cluster | Methods |
|---------|---------|
| **Entity lookup / graph traversal** | `findEntity`, `getDependencies`, `getDependents`, `findImplementers`, `findSubclasses`, `findByType`, `findByAttr`, `findByTypeAndAttr`, `getFileEntities`, `findCallers`, `getCycles`, `bfs` |
| **Metrics / summary** | `getSummary`, `getPackageStats`, `getKotlinPackageStats`, `findHighCoupling`, `findOrphans`, `findInCycles`, `getPackageCoverage`, `getEntityCoverage`, `aggregateEntityMetrics`, `buildTestPattern`, `toSummary` |
| **Output shaping (delegated but co-located)** | `applyOutputOptions`, `filterRelationsForScope` |

The metrics cluster alone accounts for roughly 450 lines (~45 % of the file). Its methods have no structural dependency on the entity-lookup methods — they access `this.archJson` and `this.index` directly and could operate identically on any `(ArchJSON, ArchIndex)` pair.

`output-scope-filter.ts` and `edge-list-serializer.ts` already exist as standalone modules for output shaping. `filterRelationsForScope` was added to `QueryEngine` instead of being placed there, creating a conceptual split: two of three output-shaping concerns live in dedicated files while the third lives in the god class.

**Caller audit (verified by grep):**

| Caller file | Methods called |
|-------------|---------------|
| `src/cli/commands/query.ts` | `getSummary`, `getPackageStats`, `findHighCoupling`, `findOrphans`, `findInCycles`, `findCallers`, `toSummary` |
| `src/cli/mcp/mcp-server.ts` | `getSummary`, `getPackageStats` |
| `src/cli/mcp/tools/test-analysis-tools.ts` | `getPackageCoverage`, `getEntityCoverage` |
| `src/cli/mcp/tools/call-graph-tools.ts` | `findCallers` |
| `src/cli/processors/diagram-pipeline-runner.ts` | `getPackageStats` |
| `src/cli/query/query-engine.ts` (shim) | re-exports class + types only; no method calls |

Note: `toSummary` is called in `query.ts` and `mcp-server.ts` — it sits in the metrics cluster by position in the file (line 806) but it is actually an **entity projection helper**, not an aggregate metric. It belongs on `QueryEngine` (entity-layer concern), not on `ArchMetrics`. See Section 3.1.1 for the corrected boundary.

### 1.2 src/cli Root Pseudo-Package (Problem 2)

Package stats for the ArchGuard self-analysis show:

| Package | Files | Entities |
|---------|-------|----------|
| `src/cli` (depth-3 root bucket) | 7 | 139 |
| `src/cli/commands` | 7 | 10 |
| `src/cli/processors` | 7 | 13 |

The root `src/cli/` directory holds seven non-entry files that do not belong there:

| File | Lines | Concern | Correct location |
|------|-------|---------|-----------------|
| `progress.ts` | 255 | `ProgressReporter` class + `ProgressReporterLike`, `Stage`, `ProgressSummary` interfaces, `StderrReporter`, `NoopReporter` | `src/cli/progress/` (subdirectory already exists, contains `parallel-progress.ts`) |
| `cache-manager.ts` | 261 | `CacheManager` (SHA-256 file hashing, cache read/write) | `src/cli/cache/` — directory does not yet exist; would mirror the pattern of `mcp/`, `progress/`, `analyze/` |
| `types.ts` | 47 | `CLIConfig`, `Config`, `AnalyzeOptions` interfaces | `src/cli/analyze/` (where its consumers live) or consolidated into `src/types/config.ts` (already used for `DiagramConfig`/`GlobalConfig`) |
| `config-loader.ts` | 528 | `ConfigLoader` class | `src/cli/config/` new subdirectory — mirrors the `analyze/` split |
| `error-handler.ts` | 202 | `ErrorHandler` formatting | `src/cli/errors/` new subdirectory alongside `errors.ts` |
| `errors.ts` | 48 | Custom error classes | `src/cli/errors/` |
| `index.ts` | 54 | CLI entry point (commander setup) | **stays** — true entry point |

`mcp-server.ts` referenced in the background is already at `src/cli/mcp/mcp-server.ts` (the `src/cli/mcp/` subdirectory). No action needed there.

### 1.3 src/analysis/fim Experimental Orphan (Problem 3)

`src/analysis/fim/` (8 files, ~35 entities, 0 method-level relations from the main analysis graph) is a research/historical module:

- `README.md` states: *"experimental (research/historical use only)"*; the `--fim` CLI flag was already removed from `archguard analyze`
- No TypeScript file outside `src/analysis/fim/` imports from it (confirmed by grep — zero cross-module imports)
- `fim-analysis.ts` line 7 JSDoc claims: *"remains accessible via the `archguard_get_fim` MCP tool"*

**CRITICAL FINDING — `archguard_get_fim` does not exist in the codebase.**  
Grep of `src/cli/mcp/mcp-server.ts` (595 lines, listing 14 registered tools) shows no `archguard_get_fim` entry. Grep of all `src/cli/` `.ts` files returns zero hits for `archguard_get_fim`, `get_fim`, or `getFim`. The JSDoc claim in `fim-analysis.ts` is stale — the MCP tool was never implemented (or was removed along with the `--fim` CLI flag). The module is effectively dead code with a misleading comment claiming otherwise.

This changes the FIM isolation strategy: adding a barrel `index.ts` alone is insufficient — without an actual importer the module will continue to appear as a zero-relation orphan. The proposal in Section 3.3 must either (a) also implement the missing `archguard_get_fim` MCP tool, or (b) acknowledge the module as dead code and propose deletion rather than isolation.

---

## 2. Goals

1. **QueryEngine decomposition**: extract the metrics cluster into a dedicated `ArchMetrics` class; move `filterRelationsForScope` into `output-scope-filter.ts`; keep `QueryEngine` as a pure entity-lookup and graph-traversal object.
2. **src/cli root consolidation**: eliminate the pseudo-package by moving non-entry files into appropriate subdirectories; `src/cli/index.ts` becomes the sole root-level file.
3. **FIM experimental isolation**: `archguard_get_fim` MCP tool does not exist — the JSDoc claim is stale. Revised goal: implement the missing MCP tool (or delete the module); add a barrel `src/analysis/fim/index.ts` as the entry point in either case.

---

## 3. Proposed Design

### 3.1 QueryEngine Decomposition

#### 3.1.1 Extract ArchMetrics

New file: `src/core/query/arch-metrics.ts`

**Corrected method boundary:** `toSummary` is an entity projection helper (maps one `Entity` → compact `EntitySummary`); it has no dependency on aggregate metrics and is called in `mcp-server.ts` and `query.ts` alongside graph-traversal results. It must stay on `QueryEngine`, not migrate to `ArchMetrics`. Moving it would force callers to import from two separate classes for what is logically a single query result projection.

**Constructor parameter note:** `QueryEngineOptions` (line 59–63 of `query-engine.ts`) provides `archJson: ArchJSON`, `archIndex: ArchIndex`, and `scopeEntry: QueryScopeEntry`. `ArchMetrics` needs only the first two. The `scopeEntry` field is not needed by metrics; do not pass it.

```typescript
/**
 * ArchMetrics — package-level and entity-level metrics computed over an ArchJSON scope.
 *
 * Stateless with respect to query routing; depends only on (ArchJSON, ArchIndex).
 */
export class ArchMetrics {
  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex
  ) {}

  getSummary(): { entityCount: number; relationCount: number; ... } { ... }
  getPackageStats(depth?: number, topN?: number): PackageStatsResult { ... }
  getPackageCoverage(): PackageCoverage[] { ... }
  getEntityCoverage(entityId: string): { ... } { ... }
  findHighCoupling(threshold?: number): Entity[] { ... }
  findOrphans(): Entity[] { ... }
  findInCycles(): Entity[] { ... }

  // private helpers (stay private; not exposed by delegation wrappers)
  private getKotlinPackageStats(...) { ... }
  private aggregateEntityMetrics(...) { ... }
  private buildTestPattern(): RegExp { ... }
}
```

**`toSummary` stays on `QueryEngine`** (entity projection, not a metric):
```typescript
// Remains on QueryEngine — NOT delegated to ArchMetrics
toSummary(entity: Entity): EntitySummary { ... }
```

Extracted interfaces (`PackageStatEntry`, `PackageStatMeta`, `PackageStatsResult`) move to `arch-metrics.ts`; `EntitySummary` stays in `query-engine.ts` (it is the return type of `toSummary`). `QueryEngine` re-exports the metrics interfaces for backward compatibility.

`QueryEngine` delegates to `ArchMetrics` via a private field:

```typescript
export class QueryEngine {
  private readonly metrics: ArchMetrics;

  constructor(options: QueryEngineOptions) {
    ...
    this.metrics = new ArchMetrics(options.archJson, options.archIndex);
    // scopeEntry NOT passed — ArchMetrics does not need it
  }

  // Delegating wrappers on QueryEngine for API stability:
  getSummary() { return this.metrics.getSummary(); }
  getPackageStats(depth?: number, topN?: number) { return this.metrics.getPackageStats(depth, topN); }
  getPackageCoverage() { return this.metrics.getPackageCoverage(); }
  getEntityCoverage(entityId: string) { return this.metrics.getEntityCoverage(entityId); }
  findHighCoupling(threshold?: number) { return this.metrics.findHighCoupling(threshold); }
  findOrphans() { return this.metrics.findOrphans(); }
  findInCycles() { return this.metrics.findInCycles(); }

  // toSummary stays here — entity projection, not aggregate metrics
  toSummary(entity: Entity): EntitySummary { ... }
}
```

This preserves the `QueryEngine` public API entirely — all callers (`src/cli/commands/query.ts`, `src/cli/mcp/mcp-server.ts`, `src/cli/mcp/tools/`, `src/cli/processors/diagram-pipeline-runner.ts`) require zero changes. The shim at `src/cli/query/query-engine.ts` re-exports the class and types only; it is not affected.

#### 3.1.2 Move filterRelationsForScope to output-scope-filter.ts

`filterRelationsForScope` has no dependency on `QueryEngine` state beyond `this.archJson.relations`, which is passed as a parameter already. It is logically part of the output-shaping layer alongside `narrowEntities`.

Move it to `src/core/query/output-scope-filter.ts` as a named export:

```typescript
export function filterRelationsForScope(relations: Relation[], scope: OutputScope): Relation[]
```

**`applyOutputOptions` stays on `QueryEngine`.** It is a private orchestrator that chains `narrowEntities` (already in `output-scope-filter.ts`) with `filterRelationsForScope` and `serialize` (from `edge-list-serializer.ts`), and it accesses `this.archJson.relations` directly. Migrating it would require passing `archJson` as a parameter and changing the call signature on every `return this.applyOutputOptions(...)` site within `QueryEngine` — high churn for no architectural gain. The single improvement here is extracting `filterRelationsForScope` so that `applyOutputOptions` can call it as a standalone import rather than as `this.filterRelationsForScope(...)`.

After extraction, `applyOutputOptions` calls:
```typescript
const filteredRelations = filterRelationsForScope(this.archJson.relations, scope);
```
`applyOutputOptions` remains private on `QueryEngine`. No callers outside `QueryEngine` currently use either method (both are private), so no other files change.

#### 3.1.3 File delta for Problem 1

| File | Change |
|------|--------|
| `src/core/query/arch-metrics.ts` | **New** — ~430 lines (metrics cluster minus `toSummary`) |
| `src/core/query/query-engine.ts` | Shrinks ~430 lines → ~570 lines; gains `ArchMetrics` field + 7 delegation wrappers; retains `toSummary` and `applyOutputOptions` |
| `src/core/query/output-scope-filter.ts` | Gains `filterRelationsForScope` export (~30 lines) |
| `src/core/query/index.ts` | Add `export * from './arch-metrics.js'`; existing re-exports of `QueryEngine` and types unchanged |

Acceptance size target: `query-engine.ts` ≤ 580 lines after extraction (was 999).

### 3.2 src/cli Root Consolidation

#### Priority ranking (effort vs. gain)

Each move is independent. They are listed highest-gain first:

**Move A — progress.ts → src/cli/progress/index.ts** (highest impact, subdirectory exists)

`progress.ts` (255 lines, 5 exported symbols) is the largest contributor to the inflated entity count. `src/cli/progress/parallel-progress.ts` already exists. Move `ProgressReporter`, `StderrReporter`, `NoopReporter`, and the associated interfaces into `src/cli/progress/index.ts`.

Current importers (7 files, confirmed by grep):
- `src/cli/mcp/analyze-tool.ts`: `import { StderrReporter } from '../progress.js'`
- `src/cli/analyze/run-analysis.ts`: `import type { ProgressReporterLike } from '../progress.js'`
- `src/cli/commands/analyze.ts`: `import { ProgressReporter } from '../progress.js'`
- `src/cli/processors/diagram-processor.ts`: `import type { ProgressReporterLike } from '@/cli/progress.js'`
- `src/cli/processors/diagram-output-router.ts`: `import type { ProgressReporterLike } from '@/cli/progress.js'`
- `src/cli/processors/diagram-pipeline-runner.ts`: `import type { ProgressReporterLike } from '@/cli/progress.js'`
- `src/mermaid/diagram-generator.ts`: `import { type IProgressReporter, NoopProgressReporter } from './progress.js'` — **this is `src/mermaid/progress.ts`, a different file; not affected**

**WARNING — `moduleResolution: "node"` does NOT silently redirect `.js` imports to `/index.js`.**

With `"moduleResolution": "node"` (confirmed in `tsconfig.json` line 7), TypeScript resolves `@/cli/progress.js` to `src/cli/progress.ts` (the `.js` → `.ts` substitution). Once `progress.ts` is deleted, all imports written as `@/cli/progress.js` or `'../progress.js'` will resolve to `src/cli/progress.js` — a file that does not exist — and break. Directory-index resolution (`progress/index.ts`) only applies when the import specifier has **no extension** (e.g., `@/cli/progress` without `.js`).

**Conclusion: all six importers must have their import paths updated.** This is still low-effort (6 one-line changes) but the claim of "zero import-path changes" in the rationale is incorrect.

Updated import paths after the move:

| Old import | New import |
|-----------|-----------|
| `'../progress.js'` (from `cli/mcp/`, `cli/analyze/`, `cli/commands/`) | `'./progress/index.js'` or `'../progress/index.js'` as appropriate |
| `'@/cli/progress.js'` (from `cli/processors/`) | `'@/cli/progress/index.js'` |

**Move B — cache-manager.ts → src/cli/cache/cache-manager.ts** (new subdirectory)

Only one importer: `src/cli/commands/cache.ts:7` (`import { CacheManager } from '../cache-manager.js'`). A `src/cli/cache/` directory mirrors the convention of every other subdirectory.

**CONFLICT: `src/cli/cache/` already exists** and contains `arch-json-disk-cache.ts`, `diagram-manifest.ts`, and `render-hash-cache.ts`. The directory exists; only the file needs to move. The import in `cache.ts` changes from `'../cache-manager.js'` to `'../cache/cache-manager.js'` (1 line).

**Move C — errors.ts + error-handler.ts → src/cli/errors/** (new subdirectory)

Two files are co-located concern: error classes and their formatter. Creating `src/cli/errors/` and adding `src/cli/errors/index.ts` re-exporting both allows `@/cli/errors` to remain a single import point.

Current importers (confirmed by grep):
- `src/cli/commands/init.ts`: imports `ErrorHandler` from `'../error-handler.js'`; imports `ValidationError` from `'../errors.js'`
- `src/cli/commands/analyze.ts`: imports `ErrorHandler` from `'../error-handler.js'`
- `src/cli/commands/cache.ts`: imports `ErrorHandler` from `'../error-handler.js'`
- `src/cli/error-handler.ts` itself: imports from `'./errors.js'` (internal to the pair — dissolves on move)
- `src/cli/errors.ts`: re-exports `ParseError` from `'@/parser/errors.js'` — this re-export must be preserved in the new barrel

**Note on `src/core/interfaces/errors.ts`:** This file contains plugin-specific error classes (e.g. `PluginError`). It has a JSDoc comment mentioning `@/cli/errors.js` but does **not** import from it — no runtime coupling; comment only. No change required.

**Defer: config-loader.ts**

`config-loader.ts` (528 lines) is imported by `commands/analyze.ts`, `commands/init.ts`, `commands/cache.ts`, `analyze/run-analysis.ts`, `analyze/normalize-to-diagrams.ts`, and the `__tests__/` tree. Moving it requires updating ~8 import paths. The gain is modest (one less file in root) and the rename risk is higher. Defer to a dedicated refactoring pass.

**Defer: types.ts**

`AnalyzeOptions` and `CLIConfig` are defined in `src/cli/types.ts` but `AnalyzeOptions` has zero external importers (confirmed by grep — only defined, never imported). `Config` is re-exported from `config-loader.ts` and used by several files. The safe action is to merge `types.ts` into `config-loader.ts` in the same pass as Move C above, but this is not urgent; defer.

#### File delta for Problem 2 (initial moves)

| File | Change |
|------|--------|
| `src/cli/progress/index.ts` | **New** (move content from `progress.ts`) |
| `src/cli/progress.ts` | **Delete** |
| `src/cli/mcp/analyze-tool.ts` | Update `'../progress.js'` → `'../progress/index.js'` |
| `src/cli/analyze/run-analysis.ts` | Update `'../progress.js'` → `'../progress/index.js'` |
| `src/cli/commands/analyze.ts` | Update `'../progress.js'` → `'../progress/index.js'` |
| `src/cli/processors/diagram-processor.ts` | Update `'@/cli/progress.js'` → `'@/cli/progress/index.js'` |
| `src/cli/processors/diagram-output-router.ts` | Update `'@/cli/progress.js'` → `'@/cli/progress/index.js'` |
| `src/cli/processors/diagram-pipeline-runner.ts` | Update `'@/cli/progress.js'` → `'@/cli/progress/index.js'` |
| `src/cli/cache/cache-manager.ts` | **New** (move content from root `cache-manager.ts`; `src/cli/cache/` directory already exists) |
| `src/cli/cache-manager.ts` | **Delete** |
| `src/cli/commands/cache.ts` | Update `'../cache-manager.js'` → `'../cache/cache-manager.js'` (1 line) |
| `src/cli/errors/` | **New directory** |
| `src/cli/errors/index.ts` | **New** barrel: re-exports from `errors.ts` + `error-handler.ts`; preserves `ParseError` re-export from `@/parser/errors.js` |
| `src/cli/errors.ts` | **Delete** (content in barrel) |
| `src/cli/error-handler.ts` | **Delete** (content in barrel) |
| `src/cli/commands/init.ts` | Update imports (2 lines: `ErrorHandler` + `ValidationError`) |
| `src/cli/commands/analyze.ts` | Update `ErrorHandler` import (1 line) |
| `src/cli/commands/cache.ts` | Update `ErrorHandler` import (1 line; already touched for Move B) |

Total changed import lines: **10 lines across 7 files** — not "zero-change" as originally described.

### 3.3 FIM Experimental Isolation

**Context correction (see Section 1.3):** `archguard_get_fim` is referenced in `fim-analysis.ts` JSDoc but the tool does not exist in `mcp-server.ts` or any tool file. The module is genuinely dead — no external importer, no MCP entry point. A barrel alone cannot fix the zero-relation problem because there is still no importer.

Two implementation options are presented:

#### Option A — Implement the missing MCP tool (recommended if FIM results are still useful)

1. Add `src/analysis/fim/index.ts` barrel:

```typescript
/**
 * @experimental
 *
 * Fisher Information Matrix analysis module.
 * Research/historical use only. Not part of the main analysis pipeline.
 * See README.md for FIM background and co-change correlation findings.
 */
export * from './fim-analysis.js';
export * from './fim-artifacts.js';
export * from './fim-snapshot.js';
export * from './types.js';
```

2. Add `archguard_get_fim` to `src/cli/mcp/mcp-server.ts`, importing via the barrel `@/analysis/fim`. This establishes the cross-module edge in the dependency graph and fixes the stale JSDoc claim.

3. Correct `fim-analysis.ts` line 7 JSDoc to reflect accurate state (tool exists after this change).

#### Option B — Delete the dead module (recommended if FIM is truly abandoned)

Delete `src/analysis/fim/` entirely. Remove the stale JSDoc reference in `fim-analysis.ts` (the file is gone). Update `CLAUDE.md` if FIM is mentioned. No barrel needed.

**Decision required:** Option B is the architecturally clean choice if FIM results are not being consumed. Option A is correct if there is intent to surface FIM results to MCP clients. The original proposal chose a middle path (barrel only) that achieves neither goal.

---

## 4. Trade-off Analysis

### 4.1 QueryEngine delegation vs. full extraction

**Option A (proposed): thin delegation wrappers on QueryEngine**  
- API surface unchanged; callers untouched  
- `ArchMetrics` is independently testable  
- `QueryEngine` retains method names for discoverability  
- Slight indirection (one extra call frame per metric query)

**Option B: remove metric methods from QueryEngine entirely**  
- Callers (`mcp-tools`, query shim) must be updated to use `ArchMetrics` directly  
- Cleaner graph (no delegation), but more import churn  
- Breaks any downstream code (e.g., MCP tools) that calls `engine.getSummary()`

Option A is preferred because the public API is stable and widely used through the MCP tool layer. Option B can be a follow-up once consumers are updated.

### 4.2 progress.ts move: index.ts vs. named file

Moving to `src/cli/progress/index.ts` is still the correct choice over a named file (e.g., `progress/progress.ts`), but the rationale must be corrected.

**Corrected rationale:** TypeScript `moduleResolution: "node"` does NOT auto-redirect `@/cli/progress.js` → `progress/index.ts` when the import has a `.js` extension. All six importers use the `.js`-suffixed form. Therefore all six import lines must be updated regardless. Moving to `index.ts` is preferable because: (a) it establishes a conventional barrel entry point for the directory, (b) it is consistent with how `src/cli/cache/` and `src/cli/mcp/` expose their top-level entry, and (c) future importers can write `@/cli/progress` (no extension) and benefit from directory-index resolution in editors and type-checkers that support it. The overhead is 6 one-line edits either way.

### 4.3 FIM: barrel+tool vs. deletion

A barrel `index.ts` alone cannot make the module visible to the dependency graph — there must be at least one importer. The original Option A (barrel only) was incomplete. The revised choice is between implementing the missing MCP tool (Option A) or deleting the module (Option B). See Section 3.3. A no-op JSDoc comment is not a valid option.

---

## 5. Risk Assessment

| Change | Risk | Mitigation |
|--------|------|-----------|
| ArchMetrics extraction | Medium — logic moves between files, tests must be re-pointed | Delegation wrappers keep external API stable; existing `query-engine` tests remain valid; `toSummary` stays on `QueryEngine` |
| `applyOutputOptions` stays on QueryEngine | Low — no change | Not migrated; `filterRelationsForScope` extracted as named import |
| `filterRelationsForScope` move | Low — private method, no external callers | Single caller (`applyOutputOptions`) updated in same PR to import from `output-scope-filter.ts` |
| `progress.ts` → `progress/index.ts` | Low — 6 import lines to update | **Directory-index auto-resolution does NOT apply** with `.js`-suffixed imports; all 6 importers must be updated manually; `npm run type-check` will catch any missed path |
| `cache-manager.ts` move | Low — single importer | `src/cli/cache/` already exists (no conflict); one import-path line change in `cache.ts` |
| `errors.ts` + `error-handler.ts` move | Low — 3 command files import them | `src/cli/errors/index.ts` barrel preserves `ParseError` re-export from `@/parser/errors.js`; 4 import-line changes across 3 files |
| FIM barrel (Option A) | Low — additive + 1 new MCP tool | Implement `archguard_get_fim` tool importing via `@/analysis/fim`; fix stale JSDoc |
| FIM deletion (Option B) | Very low — no importers exist | No downstream breaks; delete directory + update any CLAUDE.md/docs references |

**Test changes required:**
- Problem 1: Move metric-method test assertions from `query-engine.test.ts` to new `arch-metrics.test.ts`; add delegation-wrapper smoke tests on `QueryEngine`; `toSummary` tests stay in `query-engine.test.ts`
- Problem 2: No test changes (import paths only)
- Problem 3 Option A: Add MCP tool test; no changes to existing FIM tests
- Problem 3 Option B: Delete `tests/unit/analysis/fim/` (or move to an archive)

---

## 6. Out of Scope

- `DiagramProcessor` decomposition — covered by `proposal-decompose-diagram-processor.md` and `plan-34-decompose-diagram-processor.md`
- `config-loader.ts` move — deferred (high importer count, low entity-count gain)
- `types.ts` merge — deferred (zero active importers of `AnalyzeOptions`; no urgency)
- FIM computation re-integration into main pipeline — out of scope for this cleanup proposal; see `proposal-coverage-fisher-information.md`

---

## 7. Acceptance Criteria

1. **After Problem 1:** `src/core/query/query-engine.ts` is ≤ 580 lines; `ArchMetrics` class exists in `arch-metrics.ts` with all 7 metrics methods; `toSummary` remains on `QueryEngine`; `filterRelationsForScope` is exported from `output-scope-filter.ts`; `applyOutputOptions` remains private on `QueryEngine`; all existing tests pass; new `arch-metrics.test.ts` covers each extracted method.
2. **After Problem 2:** `src/cli/` root contains only `index.ts` + subdirectory entries (after deferring `config-loader.ts` and `types.ts`); all 10 updated import lines are correct; `npm run type-check` passes with zero errors; `npm test` passes with no regressions.
3. **After Problem 3 (either option):**
   - Option A: `src/analysis/fim/index.ts` exists with `@experimental` tag; `archguard_get_fim` tool is registered in `mcp-server.ts`; self-analysis shows at least one inbound edge to the FIM module; stale JSDoc in `fim-analysis.ts` is corrected.
   - Option B: `src/analysis/fim/` directory is deleted; all tests that reference it are removed or relocated; no dangling imports.
4. **Self-validation:** `node dist/cli/index.js analyze -v` produces clean output; `src/cli` no longer appears as the dominant entity bucket; `src/analysis/fim` does not appear as a zero-relation orphan.
