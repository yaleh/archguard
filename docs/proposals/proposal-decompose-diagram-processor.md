## Background

`src/cli/processors/diagram-processor.ts` is 492 lines and carries a change-risk score of 0.78 (CRITICAL) based on commit frequency, co-change breadth, and responsibility surface. It has been touched in 34 commits since its creation. Across those commits it co-changed with:

| Co-changed file | Shared commits |
|---|---|
| `src/cli/commands/analyze.ts` | 12 |
| `src/types/config.ts` | 7 |
| `src/cli/config-loader.ts` | 7 |
| `src/types/extensions.ts` | 5 |
| `src/cli/utils/diagram-index-generator.ts` | 5 |
| `src/types/index.ts` | 6 |

Every new language plugin, every new output format, and every new CLI flag touches this file alongside at least one of the above. The coupling is structural, not coincidental.

### Current responsibilities inside DiagramProcessor

1. **Worker pool lifecycle** — creates, sizes, starts, and terminates `MermaidRenderWorkerPool` in `processAll()`.
2. **Source-group scheduling** — `groupDiagramsBySource()` + `pMap` concurrency orchestration.
3. **Query-scope accumulation** — `queryScopes` map, `registerQueryScope()`, `getQuerySourceGroups()`.
4. **ArchJSON state tracking** — `_lastArchJson` field, `getLastArchJson()`, primary-role detection logic.
5. **Per-diagram lifecycle** — `processDiagramWithArchJSON()` owns aggregation, path resolution, metrics calculation, progress reporting, and result assembly.
6. **Test-coverage heatmap writing** — `generateTestCoverageHeatmap()` renders and writes `test/coverage-heatmap.md`.

`ArchJsonProvider` (617 lines) and `DiagramOutputRouter` (407 lines) were already extracted from earlier God-Class pressure. That extraction is complete and stable. The remaining six responsibilities above are the target of this proposal.

### What has already been extracted (out of scope)

- **ArchJSON acquisition** → `src/cli/processors/arch-json-provider.ts`
- **Output routing (json / Atlas / TS module graph / C++ package / default)** → `src/cli/processors/diagram-output-router.ts`

These two files are not touched by this proposal.

### Line budget of the current file

| Block | Lines |
|---|---|
| Imports (header comment + imports + re-export) | 35 |
| Type and interface definitions (`InternalQueryScope`, `DiagramProcessorOptions`, `DiagramResult`) | 60 |
| Class declaration + constructor | 45 |
| `processAll()` | 67 |
| `groupDiagramsBySource()` | 18 |
| `queryScopes` field + `registerQueryScope()` | 26 |
| `getQuerySourceGroups()` + `getLastArchJson()` | 18 |
| `processSourceGroup()` | 43 |
| `generateTestCoverageHeatmap()` (including JSDoc) | 36 |
| `processDiagramWithArchJSON()` | 123 |
| **Total** | **492** |

The type definitions (60 lines) and imports (35 lines) remain in `diagram-processor.ts` after extraction. The realistic post-extraction target is **~200 lines**, not 150, once imports and re-export stubs are included.

---

## Goals

After this refactor, `diagram-processor.ts` should be a thin orchestrator (~200 lines) that:

- Holds only the coordination logic: grouping, `pMap` scheduling, pool lifecycle.
- Delegates query-scope accumulation to a dedicated collector.
- Delegates ArchJSON state (last parsed result, primary-role tracking) to the same collector.
- Delegates per-diagram pipeline execution to a dedicated step runner.
- Delegates test-coverage heatmap writing out of the class entirely.

Callers in `src/cli/analyze/run-analysis.ts` must not change their import paths or method signatures.

---

## Caller surface (verified against run-analysis.ts)

`run-analysis.ts` calls four methods on `DiagramProcessor`:

| Method | Call site (run-analysis.ts line) |
|---|---|
| `processAll()` | line 86 |
| `getLastArchJson()` | line 90 |
| `generateTestCoverageHeatmap()` | line 148 |
| `getQuerySourceGroups()` | line 176 |

All four must remain on the `DiagramProcessor` class (as direct implementations or pass-through delegates) until each is explicitly migrated.

---

## Solution Design

### Module breakdown

#### 1. `src/cli/processors/test-coverage-writer.ts` (new, ~35–40 lines)

**Migrated from DiagramProcessor:**
- `generateTestCoverageHeatmap(analysis, archJson, outputDir)` public method, which:
  - Instantiates `TestCoverageRenderer`
  - Builds the markdown file content
  - Writes `test/coverage-heatmap.md` with `fs.ensureDir` + `fs.writeFile`

**Cohesion rationale:** this method has no dependency on any other `DiagramProcessor` field. It uses `TestCoverageRenderer` and `fs-extra`. It is called from `run-analysis.ts` after `processAll()` completes, meaning it is not part of the core processing loop at all. Extracting it eliminates imports of `TestCoverageRenderer` and `TestAnalysis` from `diagram-processor.ts`, reducing the file's dependency surface.

**Public API preservation:** `DiagramProcessor.generateTestCoverageHeatmap()` remains as a pass-through delegate so `run-analysis.ts` does not need to change. A follow-up step (open question 2, resolved below) may remove the delegate and import directly from `test-coverage-writer.ts`.

#### 2. `src/cli/processors/worker-pool-factory.ts` (new, ~25–30 lines)

**Migrated from DiagramProcessor:**
- Pool sizing logic from `processAll()`:
  - Go Atlas effective-diagram-count heuristic (`isGoAtlas`, `atlasLayerCount`, `effectiveDiagramCount`)
  - `poolSize = Math.max(1, Math.min(os.cpus().length - 1, effectiveDiagramCount, 4))`
  - `pool = new MermaidRenderWorkerPool(poolSize, { theme, maxTextSize, transparentBackground })`

**Cohesion rationale:** the sizing formula has already grown once (to handle Go Atlas layer-count). It is likely to grow again when new multi-output languages are added. Isolating it makes the formula independently testable as a pure function with no async I/O.

**Public API preservation:** `processAll()` calls `createWorkerPool(diagrams, globalConfig)` and receives a fully configured pool. `MermaidRenderWorkerPool` is not exposed differently to callers.

#### 3. `src/cli/processors/query-scope-collector.ts` (new, ~55–65 lines)

**Migrated from DiagramProcessor:**
- `private queryScopes: Map<string, InternalQueryScope>` field
- `registerQueryScope(sources, archJson, kind, role?)` method
- `getQuerySourceGroups(): InternalQueryScope[]` method
- `private _lastArchJson: ArchJSON | null` field
- `getLastArchJson(): ArchJSON | null` method
- Primary-role detection logic (`groupHasPrimary`, first-write-wins guard) currently inlined in `processSourceGroup()`

**Important scoping note:** `processSourceGroup()` itself stays in `DiagramProcessor`. Only the two state mutations inside it move to the collector:
- `this.registerQueryScope(firstDiagram.sources, rawArchJSON, kind, firstDiagram.queryRole)` → `collector.register(...)`
- The `_lastArchJson` assignment block → `collector.setLastArchJson(rawArchJSON, groupHasPrimary)`

**Cohesion rationale:** all collected state exists solely to answer two post-processing questions asked by `run-analysis.ts`: "which source sets were parsed?" and "what is the primary ArchJSON?". They have no coupling to rendering or path resolution.

**Public API preservation:** `DiagramProcessor` exposes `getQuerySourceGroups()` and `getLastArchJson()` as pass-through delegates so `run-analysis.ts` imports remain unchanged.

#### 4. `src/cli/processors/diagram-pipeline-runner.ts` (new, ~115–125 lines)

**Migrated from DiagramProcessor:**
- `processDiagramWithArchJSON(diagram, rawArchJSON, pool)` private method (becomes a standalone function or a stateless class method)

This method's sub-steps:
- Aggregation via `ArchJSONAggregator`
- Output path resolution via `OutputPathResolver`
- Metrics calculation via `MetricsCalculator`
- Parallel/serial progress update calls
- Routing call to `DiagramOutputRouter.route()`
- Result assembly (`DiagramResult` construction for success and failure paths)

**Cohesion rationale:** the method is already a well-defined pipeline with clear inputs (`DiagramConfig`, `ArchJSON`, `MermaidRenderWorkerPool`) and a clear output (`DiagramResult`). The only reason it lives in `DiagramProcessor` today is historical. Moving it to a named module makes the pipeline steps individually testable without constructing the full processor.

**Public API preservation:** `DiagramProcessor.processSourceGroup()` calls `DiagramPipelineRunner.run(diagram, archJson, pool)`. The return type `DiagramResult` is not moved — it stays in `diagram-processor.ts` and re-exported as today for backward compatibility.

---

### Resulting DiagramProcessor structure (after extraction)

`DiagramProcessor` retains:
- Constructor (wires `ArchJsonProvider`, `DiagramOutputRouter`, `QueryScopeCollector`, `DiagramPipelineRunner`)
- `processAll()`: grouping + `pMap` scheduling + pool creation/termination + collector delegation
- `groupDiagramsBySource()`: unchanged
- `getQuerySourceGroups()` / `getLastArchJson()` / `generateTestCoverageHeatmap()`: thin delegates
- Exported types: `DiagramProcessorOptions`, `DiagramResult`, `InternalQueryScope`

Estimated final size: ~190–210 lines (includes 35-line import block, 78-line type definitions, and delegate stubs).

---

## Option A — Incremental extraction (preferred)

Extract one responsibility per step. Each step is independently reviewable, testable, and releasable.

**Step A1 — Extract `TestCoverageWriter`**
Move `generateTestCoverageHeatmap` to `test-coverage-writer.ts`. Keep the delegating method on `DiagramProcessor`. This step is the safest first move: the extracted code has zero internal field dependencies and zero coupling to the processing loop. New test file: `tests/unit/cli/processors/test-coverage-writer.test.ts`. The existing test in `diagram-processor.test.ts` for `generateTestCoverageHeatmap` migrates here.

**Rationale for extracting this first:** `TestCoverageWriter` has no dependency on any `DiagramProcessor` field. It is called from `run-analysis.ts` *after* `processAll()` returns, not inside the processing loop. This makes it the lowest-risk extraction: moving it cannot break the core processing path. Establishing a working extraction pattern in this low-risk step builds confidence before tackling the more entangled responsibilities.

**Step A2 — Extract `WorkerPoolFactory`**
Move pool-sizing logic from `processAll()` to `worker-pool-factory.ts`. Replace inline block with `createWorkerPool(diagrams, globalConfig)`. This is a pure function and can be unit-tested without any async I/O. New test file: `tests/unit/cli/processors/worker-pool-factory.test.ts`.

**Rationale for this second:** the pool-sizing block is a pure function (no `this` references). Extracting it before the stateful pieces (QueryScopeCollector) keeps each step's risk profile low. The remaining `processAll()` body after extraction is noticeably simpler, making Step A3 easier to review.

**Step A3 — Extract `QueryScopeCollector`**
Move `queryScopes`, `registerQueryScope`, `getQuerySourceGroups`, `_lastArchJson`, `getLastArchJson`, and primary-role detection to `query-scope-collector.ts`. Wire into `DiagramProcessor` via constructor injection. Add delegating methods to `DiagramProcessor`. Update `processSourceGroup()` to call `this.collector.register(...)` and `this.collector.setLastArchJson(...)`. Update existing unit tests (`diagram-processor-query-scopes.test.ts`) to inject a real or spy collector.

**Step A4 — Extract `DiagramPipelineRunner`**
Move `processDiagramWithArchJSON` to `diagram-pipeline-runner.ts`. `DiagramProcessor.processSourceGroup()` calls `runner.run(diagram, archJson, pool)`. Existing tests for the pipeline steps migrate to `diagram-pipeline-runner.test.ts`.

Each step produces a green test suite before the next step begins.

---

## Option B — Big-bang rewrite (rejected)

Replace `DiagramProcessor` with a new module layout in a single PR. Rejected because:

- The class is called from `run-analysis.ts` via four distinct methods (`processAll`, `getLastArchJson`, `getQuerySourceGroups`, `generateTestCoverageHeatmap`). A simultaneous rewrite risks breaking the coordinator contract.
- `diagram-processor.test.ts` has tests for all current behaviors. Splitting the file in one pass makes it difficult to track which assertions have migrated and which have been silently dropped.
- The `ArchJsonProvider` / `DiagramOutputRouter` extraction (commit `448e8a6`) was itself a big-bang step and required subsequent fixup commits. Option A avoids that pattern.

---

## Tradeoff Analysis

| Concern | Option A (incremental) | Option B (big-bang) |
|---|---|---|
| Review risk per PR | Low — one boundary per PR | High — all boundaries at once |
| Regression surface | Narrow — one interface changes | Wide — all interfaces at once |
| Test continuity | Tests migrate with each step | Mass migration increases gaps |
| Time to first value | Available after Step A1 | Only after full rewrite |
| Merge conflict risk | Low — narrow diffs | High — whole-file rewrites |

---

## Risk Assessment

**Backward compatibility**

`DiagramProcessor` is the sole public API consumed by `run-analysis.ts`. The four consumed methods — `processAll()`, `getLastArchJson()`, `getQuerySourceGroups()`, `generateTestCoverageHeatmap()` — must remain on the class throughout extraction. All extracted modules are internal to the `src/cli/processors/` directory and are not imported by any other package boundary. No external API changes are required.

**ESM `.js` import extension requirement**

All new files must use `.js` extensions in import statements (the project uses `tsc-alias` with ESM output). The pattern is already established in the existing processors. New files in `src/cli/processors/` follow the same convention:
```typescript
import { QueryScopeCollector } from './query-scope-collector.js';
```

**Test impact**

`tests/unit/cli/processors/diagram-processor.test.ts` and `tests/unit/cli/processors/diagram-processor-query-scopes.test.ts` currently test the full processor. After each extraction step, affected test groups move to a new test file (e.g., `tests/unit/cli/processors/test-coverage-writer.test.ts`). The original test files retain integration-style tests for `processAll()` orchestration and the delegating methods. No test surface is lost — only relocated.

**Path alias consistency**

New files use `@/` aliases for cross-package imports (e.g., `@/types/config.js`, `@/analysis/test-analyzer.js`) consistent with the existing processors. Intra-processor imports use relative paths (e.g., `./query-scope-collector.js`).

---

## Open Questions

1. **`ILanguageProcessor` interface** — Should the incremental extraction define an interface for `DiagramPipelineRunner` (and future runners) now, or defer until a second language-specific runner is needed? Current consensus leans toward deferral: the interface would be premature given only one runner exists. This decision should be revisited when a language-specific pipeline variant is added (e.g., a specialized Java multi-module runner).

2. **Direct import of `TestCoverageWriter` from `run-analysis.ts`** — Step A1 leaves a delegating method on `DiagramProcessor` to avoid a change in `run-analysis.ts`. The delegate can be removed in a follow-up by importing `generateTestCoverageHeatmap` directly from `test-coverage-writer.ts` in `run-analysis.ts`. This is a two-line change with no correctness implication. **Decision (deferred):** keep the delegate on `DiagramProcessor` throughout the A1 PR so that `run-analysis.ts` requires no changes. Removing the delegate is a follow-up task once all four extraction phases are complete and the post-extraction `DiagramProcessor` public surface is audited holistically.

3. **Worker pool as an injected dependency** — `WorkerPoolFactory` could be injected into `DiagramProcessor` via the constructor, making it possible to mock the pool in unit tests without module-level patching. The current test suite already mocks `MermaidRenderWorkerPool` at the module level; injection would make that explicit and avoid reliance on `vi.mock`. **Recommendation:** inject via constructor in Step A2, adding a `poolFactory?: WorkerPoolFactory` optional parameter to `DiagramProcessorOptions` (defaults to the real factory). This is a low-cost improvement that pays off when testing pool-size edge cases.
