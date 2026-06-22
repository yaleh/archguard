# Plan 34 — Decompose DiagramProcessor (God Class)

## Goal

Reduce `src/cli/processors/diagram-processor.ts` from 492 lines to ~200 lines by extracting four
responsibilities into dedicated modules. After extraction the class becomes a thin orchestrator that
groups diagrams, schedules `pMap` concurrency, manages the worker-pool lifecycle, and delegates
everything else.

The four callers of `DiagramProcessor` in `run-analysis.ts`
(`processAll`, `getLastArchJson`, `getQuerySourceGroups`, `generateTestCoverageHeatmap`)
must not change their call signatures or import path.

---

## New Files

| File | Lines (est.) | Responsibility |
|---|---|---|
| `src/cli/processors/test-coverage-writer.ts` | ~35–40 | Render + write `test/coverage-heatmap.md` |
| `src/cli/processors/worker-pool-factory.ts` | ~25–30 | Pool-sizing formula + `MermaidRenderWorkerPool` creation |
| `src/cli/processors/query-scope-collector.ts` | ~55–65 | `queryScopes` map, `_lastArchJson` field, primary-role logic |
| `src/cli/processors/diagram-pipeline-runner.ts` | ~115–125 | `processDiagramWithArchJSON` pipeline |

---

## Extraction Order and Rationale

| Step | Extract | Risk | Reason for ordering |
|---|---|---|---|
| A1 | `TestCoverageWriter` | Lowest | Zero field deps, called after `processAll()`, cannot break core loop |
| A2 | `WorkerPoolFactory` | Low | Pure function, no `this` references, independently testable |
| A3 | `QueryScopeCollector` | Medium | Stateful, but clearly bounded; A2 simplifies `processAll()` first |
| A4 | `DiagramPipelineRunner` | Highest | Largest, most coupled; all prior steps reduce the blast radius |

Each step produces a green test suite before the next step begins.

---

## Phase A1 — Extract TestCoverageWriter

### What moves

`DiagramProcessor.generateTestCoverageHeatmap(analysis, archJson, outputDir)` (lines 344–368 in
`diagram-processor.ts`) is a standalone function: it instantiates `TestCoverageRenderer`, builds
the markdown content, and writes `test/coverage-heatmap.md` with `fs.ensureDir` + `fs.writeFile`.
It references no `DiagramProcessor` fields.

### Stage A1.1 — Tests (≤200 lines)

**New file:** `tests/unit/cli/processors/test-coverage-writer.test.ts`

Tests to write (all new; none currently exist for this function in isolation):
- `generateTestCoverageHeatmap` calls `TestCoverageRenderer.render(analysis, archJson)` with the
  correct arguments.
- Writes file at `<outputDir>/test/coverage-heatmap.md`.
- File content wraps the mermaid code in a fenced block with a `# Test Coverage Heatmap` heading.
- Calls `fs.ensureDir` on `<outputDir>/test` before writing.
- Does not throw when `TestCoverageRenderer.render` returns an empty string.

Mocks required: `fs-extra` (default export), `@/mermaid/test-coverage-renderer.js`.

**Migrate from `diagram-processor.test.ts`:** the single existing
`generateTestCoverageHeatmap` integration-style assertion (search for
`generateTestCoverageHeatmap` in the test file) moves to this new file as a unit test.

### Stage A1.2 — Implementation (≤200 lines)

**New file:** `src/cli/processors/test-coverage-writer.ts`

Contents:
```typescript
// imports: fs-extra, path, TestCoverageRenderer, TestAnalysis, ArchJSON
export async function generateTestCoverageHeatmap(
  analysis: TestAnalysis,
  archJson: ArchJSON,
  outputDir: string
): Promise<void>
```

The body is a verbatim lift of the current `DiagramProcessor.generateTestCoverageHeatmap` method
body.

**Edit `diagram-processor.ts`:**
- Add import: `import { generateTestCoverageHeatmap } from './test-coverage-writer.js';`
- Remove: `import { TestCoverageRenderer } from '@/mermaid/test-coverage-renderer.js';`
- Remove: `import type { TestAnalysis } from '@/types/extensions.js';`
- Replace method body with a one-line delegate:
  `return generateTestCoverageHeatmap(analysis, archJson, outputDir);`

**Edit `run-analysis.ts`:** no changes required (it calls `processor.generateTestCoverageHeatmap`
which is still present as a delegate).

**Open question resolution (proposal §Open Questions #2):** Keep the delegate on `DiagramProcessor`
for now. The delegate can be removed in a follow-up only after deciding whether `run-analysis.ts`
should import directly from `test-coverage-writer.ts`.

**Line budget after A1:** diagram-processor.ts ~450 lines (removed ~36 method+JSDoc lines + 2 import lines).

---

## Phase A2 — Extract WorkerPoolFactory

### What moves

The pool-sizing block from `processAll()` (lines 169–183 in `diagram-processor.ts`):
- Go Atlas effective-diagram-count heuristic (`isGoAtlas`, `atlasLayerCount`, `effectiveDiagramCount`)
- `poolSize = Math.max(1, Math.min(os.cpus().length - 1, effectiveDiagramCount, 4))`
- `pool = new MermaidRenderWorkerPool(poolSize, { theme, maxTextSize, transparentBackground, themeVariables: undefined })`

### Stage A2.1 — Tests (≤200 lines)

**New file:** `tests/unit/cli/processors/worker-pool-factory.test.ts`

Tests to write:
- Single non-Go diagram → `poolSize = Math.max(1, Math.min(cpus-1, 1, 4))`.
- Ten diagrams, 8 CPUs → `poolSize = Math.min(7, 10, 4) = 4`.
- Go Atlas diagram with 4 layers, 2 CPUs → `effectiveDiagramCount = 4`,
  `poolSize = Math.max(1, Math.min(1, 4, 4)) = 1`.
- Go Atlas diagram with 4 layers, 8 CPUs → `poolSize = Math.min(7, 4, 4) = 4`.
- `createWorkerPool` passes `theme`, `maxTextSize: 200000`, `transparentBackground` from
  `globalConfig.mermaid`, and `themeVariables: undefined` to `MermaidRenderWorkerPool`.
- `createWorkerPool` returns a `MermaidRenderWorkerPool` instance.

**Proposal §Open Questions #3 resolution:** `WorkerPoolFactory` is injected into `DiagramProcessor`
via an optional constructor field `poolFactory?: WorkerPoolFactory`. This makes pool construction
mockable in unit tests without module-level `vi.mock`. Default: `new WorkerPoolFactory()`.

Mocks required: `@/mermaid/render-worker-pool.js`, `os`.

### Stage A2.2 — Implementation (≤200 lines)

**New file:** `src/cli/processors/worker-pool-factory.ts`

Contents:
```typescript
// imports: os, MermaidRenderWorkerPool, DiagramConfig, GlobalConfig
export class WorkerPoolFactory {
  create(diagrams: DiagramConfig[], globalConfig: GlobalConfig): MermaidRenderWorkerPool
}
```

The `create` method body is a verbatim lift of the pool-sizing block from `processAll()`.

**Edit `diagram-processor.ts`:**
- Add import: `import { WorkerPoolFactory } from './worker-pool-factory.js';`
- Add optional field: `private readonly poolFactory: WorkerPoolFactory;`
- Add to `DiagramProcessorOptions`: `poolFactory?: WorkerPoolFactory;`
- Constructor: `this.poolFactory = options.poolFactory ?? new WorkerPoolFactory();`
- In `processAll()`: replace the 15-line sizing block with
  `const pool = this.poolFactory.create(this.diagrams, this.globalConfig);`

**Line budget after A2:** diagram-processor.ts ~435 lines (pool block -15, replaced by 1-line call; `MermaidRenderWorkerPool` import removed; `os` import stays — used by concurrency in `processAll` and `processSourceGroup`).

---

## Phase A3 — Extract QueryScopeCollector

### What moves

From `DiagramProcessor`:
- `private queryScopes: Map<string, InternalQueryScope>` field (line 245)
- `private registerQueryScope(sources, archJson, kind, role?)` method (lines 252–269)
- `public getQuerySourceGroups(): InternalQueryScope[]` method (lines 275–277)
- `private _lastArchJson: ArchJSON | null = null` field (line 126)
- `public getLastArchJson(): ArchJSON | null` method (lines 285–287)
- Primary-role detection logic inside `processSourceGroup()` (lines 314–317):
  ```typescript
  const groupHasPrimary = diagrams.some((d) => d.queryRole === 'primary');
  if (this._lastArchJson === null || groupHasPrimary) {
    this._lastArchJson = rawArchJSON;
  }
  ```

`processSourceGroup()` itself stays in `DiagramProcessor`; only the two state mutations move.

### Stage A3.1 — Tests (≤200 lines)

**New file:** `tests/unit/cli/processors/query-scope-collector.test.ts`

Tests to write (migrated from `diagram-processor-query-scopes.test.ts` + new unit tests):
- `getQuerySourceGroups()` returns `[]` before any `register()` call.
- `register()` with a non-empty ArchJSON adds exactly one scope.
- `register()` with an empty-entity ArchJSON adds no scope.
- `register()` with the same key twice does not overwrite (first-write-wins).
- Scope `key` is an 8-char hex string.
- Scope `sources` are resolved to absolute paths.
- `getLastArchJson()` returns `null` before any `setLastArchJson()` call.
- `setLastArchJson(archJson, false)` stores the value when last is `null`.
- `setLastArchJson(archJson2, false)` does NOT overwrite an already-stored value when
  `groupHasPrimary=false`.
- `setLastArchJson(archJson2, true)` DOES overwrite when `groupHasPrimary=true`.
- Two calls with `groupHasPrimary=true` → last value wins.

**Update `diagram-processor-query-scopes.test.ts`:** the existing 6 integration-style tests
(`DiagramProcessor query scope collection` describe block) remain but now verify the delegate
methods on `DiagramProcessor` still return the collector's values. Inject a spy collector so the
tests do not depend on `processAll()` round-trip.

### Stage A3.2 — Implementation (≤200 lines)

**New file:** `src/cli/processors/query-scope-collector.ts`

```typescript
// imports: path, ArchJSON, InternalQueryScope, hashSources (re-exported from arch-json-provider)
export class QueryScopeCollector {
  private queryScopes: Map<string, InternalQueryScope>;
  private _lastArchJson: ArchJSON | null;

  register(sources: string[], archJson: ArchJSON, kind: 'parsed'|'derived', role?: 'primary'|'secondary'): void
  setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void
  getQuerySourceGroups(): InternalQueryScope[]
  getLastArchJson(): ArchJSON | null
}
```

The four method bodies are verbatim lifts of the corresponding code in `DiagramProcessor`.

**Edit `diagram-processor.ts`:**
- Add import: `import { QueryScopeCollector } from './query-scope-collector.js';`
- Add field: `private readonly collector: QueryScopeCollector;`
- Add to `DiagramProcessorOptions`: `collector?: QueryScopeCollector;` (for injection in tests)
- Constructor: `this.collector = options.collector ?? new QueryScopeCollector();`
- Remove: `private queryScopes` field, `registerQueryScope`, `_lastArchJson` field.
- `getQuerySourceGroups()`: delegate to `this.collector.getQuerySourceGroups()`.
- `getLastArchJson()`: delegate to `this.collector.getLastArchJson()`.
- `processSourceGroup()`: replace two state-mutation blocks with:
  ```typescript
  this.collector.register(firstDiagram.sources, rawArchJSON, kind, firstDiagram.queryRole);
  const groupHasPrimary = diagrams.some((d) => d.queryRole === 'primary');
  this.collector.setLastArchJson(rawArchJSON, groupHasPrimary);
  ```

**Line budget after A3:** diagram-processor.ts ~415 lines (~29 lines removed for fields/methods/primary-role block; ~9 lines added for collector field, constructor wire, and two delegate stubs).

---

## Phase A4 — Extract DiagramPipelineRunner

### What moves

`DiagramProcessor.processDiagramWithArchJSON(diagram, rawArchJSON, pool)` in its entirety
(lines 377–491 in `diagram-processor.ts`). This is a 115-line method with a clear input/output
contract: `(DiagramConfig, ArchJSON, MermaidRenderWorkerPool) → DiagramResult`.

Sub-steps within the method:
1. Aggregation via `ArchJSONAggregator`
2. Output path resolution via `OutputPathResolver`
3. Metrics calculation via `MetricsCalculator`
4. Parallel/serial progress update calls
5. Routing call to `DiagramOutputRouter.route()`
6. Result assembly (`DiagramResult` for success and failure paths)

### Stage A4.1 — Tests (≤200 lines)

**New file:** `tests/unit/cli/processors/diagram-pipeline-runner.test.ts`

Tests to write (migrated from `diagram-processor.test.ts` pipeline-related groups):
- Successful run returns `DiagramResult` with `success: true`, correct `name`, and `stats`.
- Sets `metrics` on returned result.
- Routes format `'json'` → `resultPaths.json` is populated, `.mmd`/`.svg`/`.png` are not.
- Routes format `'mermaid'` → `resultPaths.mmd`, `.svg`, `.png` are populated.
- Uses `moduleGraph.nodes.length` for `stats.entities` when `level === 'package'` and
  `tsAnalysis.moduleGraph` is present.
- Uses `atlasPackageLayer.nodes.length` for `stats.entities` when Go Atlas package layer is present.
- When `DiagramOutputRouter.route()` throws → returns `DiagramResult` with `success: false` and the
  error message.
- Calls `parallelProgress.update(name, 50, 'Aggregating')` when a progress reporter is supplied.
- Calls `parallelProgress.complete(name)` on success.
- Calls `parallelProgress.fail(name)` on failure.

Mocks required: `ArchJSONAggregator`, `OutputPathResolver`, `MetricsCalculator`,
`DiagramOutputRouter`, `ParallelProgressReporter`.

**Update `diagram-processor.test.ts`:** remove tests that are now fully covered by
`diagram-pipeline-runner.test.ts`. Keep orchestration-level tests: `processAll()` returns the
correct number of results, `processAll()` isolates failures, concurrency limit is respected.

### Stage A4.2 — Implementation (≤200 lines)

**New file:** `src/cli/processors/diagram-pipeline-runner.ts`

```typescript
// imports: ArchJSONAggregator, MetricsCalculator, OutputPathResolver, DiagramOutputRouter,
//          ParallelProgressReporter, ProgressReporterLike, DiagramConfig, GlobalConfig,
//          ArchJSON, DiagramResult, MermaidRenderWorkerPool
export class DiagramPipelineRunner {
  constructor(
    private aggregator: ArchJSONAggregator,
    private metricsCalculator: MetricsCalculator,
    private router: DiagramOutputRouter,
    private globalConfig: GlobalConfig,
    private progress: ProgressReporterLike,
    private parallelProgress?: ParallelProgressReporter
  )

  async run(
    diagram: DiagramConfig,
    rawArchJSON: ArchJSON,
    pool: MermaidRenderWorkerPool
  ): Promise<DiagramResult>
}
```

The `run` method body is a verbatim lift of `processDiagramWithArchJSON`.
`DiagramResult` type is NOT moved — it stays in `diagram-processor.ts` and imported by the runner.

**Edit `diagram-processor.ts`:**
- Add import: `import { DiagramPipelineRunner } from './diagram-pipeline-runner.js';`
- Add field: `private readonly runner: DiagramPipelineRunner;`
- Add to `DiagramProcessorOptions`: `runner?: DiagramPipelineRunner;` (for injection in tests)
- Constructor: instantiate `DiagramPipelineRunner` (or use injected instance).
  Note: `parallelProgress` is set after construction in `processAll()`, so either pass it at
  construction time after initialization or expose a `setParallelProgress` setter on the runner.
  **Recommended:** Pass `parallelProgress` as an argument to `runner.run()` to keep the runner
  stateless:
  ```typescript
  async run(
    diagram: DiagramConfig,
    rawArchJSON: ArchJSON,
    pool: MermaidRenderWorkerPool,
    parallelProgress?: ParallelProgressReporter
  ): Promise<DiagramResult>
  ```
- Remove: `private processDiagramWithArchJSON` method, `private aggregator` field,
  `private metricsCalculator` field.
- `processSourceGroup()` calls:
  `runner.run(diagram, rawArchJSON, pool, this.parallelProgress)`

**Line budget after A4:** diagram-processor.ts ~200 lines (imports ~35, types ~78, class ~90).

---

## Resulting DiagramProcessor Structure

```typescript
export class DiagramProcessor {
  // Fields
  private diagrams: DiagramConfig[];
  private globalConfig: GlobalConfig;
  private progress: ProgressReporterLike;
  private parallelProgress?: ParallelProgressReporter;
  private readonly provider: ArchJsonProvider;
  private readonly router: DiagramOutputRouter;
  private readonly poolFactory: WorkerPoolFactory;       // new (A2)
  private readonly collector: QueryScopeCollector;       // new (A3)
  private readonly runner: DiagramPipelineRunner;        // new (A4)

  constructor(options: DiagramProcessorOptions) { ... }  // wires dependencies

  // Orchestration (stays)
  async processAll(): Promise<DiagramResult[]>
  private groupDiagramsBySource(): Map<string, DiagramConfig[]>
  private async processSourceGroup(...): Promise<DiagramResult[]>

  // Thin delegates (stays)
  public getQuerySourceGroups(): InternalQueryScope[]    // → collector
  public getLastArchJson(): ArchJSON | null               // → collector
  public generateTestCoverageHeatmap(...): Promise<void> // → test-coverage-writer
}
```

---

## Test Migration Map

| Existing test location | After extraction |
|---|---|
| `diagram-processor.test.ts` — `generateTestCoverageHeatmap` group | Move to `test-coverage-writer.test.ts` (A1.1) |
| `diagram-processor.test.ts` — pool-size groups | Move to `worker-pool-factory.test.ts` (A2.1) |
| `diagram-processor-query-scopes.test.ts` — all 6 tests | Move to `query-scope-collector.test.ts` (A3.1); keep slim delegate tests in original file |
| `diagram-processor.test.ts` — pipeline result/stats/format groups | Move to `diagram-pipeline-runner.test.ts` (A4.1) |
| `diagram-processor.test.ts` — `processAll` orchestration groups | Keep in `diagram-processor.test.ts` |

---

## Constraints and Conventions

- All new files under `src/cli/processors/` use `.js` extensions in import statements (ESM + tsc-alias).
- Intra-processor imports use relative paths: `import { X } from './x.js'`.
- Cross-package imports use `@/` aliases: `import type { ArchJSON } from '@/types/index.js'`.
- No new public API surfaces beyond the interfaces defined in this plan.
- `ILanguageProcessor` interface is deferred (proposal §Open Questions #1); revisit when a second
  language-specific pipeline variant is needed.
- Each Phase must produce a green test suite (`npm test`) before the next Phase begins.
- Each Stage is ≤200 lines of diff (tests or implementation, not both together).
