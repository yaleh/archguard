# Proposal: Rendering Performance Optimization

**Status**: Draft
**Branch**: master
**Motivation**: Profiling the web-llm analysis run (5 diagrams, 188 entities) revealed that the current SVG/PNG rendering pipeline contains a critical double-render bug and lacks parallelism at the render layer.

> **Note**: The baseline (~213s) was measured on a run with an external-source-path bug (3/5 diagrams succeeded). A clean baseline must be re-established after that bug is fixed before comparing optimization results.

---

## Background

Running ArchGuard against `/home/yale/work/web-llm/src` (5 diagrams: overview/package, class/all-classes, method/core, method/openai_api_protocols, method/shared) produced the following **end-to-end per-diagram times** (parse + generate + validate + render + I/O combined):

| Diagram | Entities | Per-diagram wall time (end-to-end) |
|---------|----------|------------------------------------|
| overview/package | 7 | 58.58s |
| class/all-classes | 188 | 91.30s |
| method/core | 188 | 123.62s |
| method/openai_api_protocols | 38 | 95.68s |
| method/shared | 80 | 60.85s |
| **Total (sum)** | | **430.03s** |
| **Actual wall time** | | **~213s** |

> ⚠️ These per-diagram numbers are **total processing times**, not isolated render times. They cannot be used directly as `mermaid.render()` duration proxies. Actual render-phase isolation requires instrumentation (timestamps at `renderSVG()` entry/exit). All render-time estimates in this proposal are therefore approximate.

The execution model groups diagrams by source hash and runs groups concurrently via `pMap`. Group A (`src/`) contains 3 diagrams sharing one parse; Groups B and C run in parallel with A. Within each group, diagram rendering is also dispatched via `pMap`. Despite this, the actual wall time greatly exceeds what true parallelism would produce. The root causes are described below.

---

## Root Cause Analysis

### Issue 1 — Double `mermaid.render()` per diagram (confirmed bug, three sites)

The double-render pattern exists in **three locations**, not one:

**Site A** — `src/mermaid/renderer.ts`, `renderAndSave()`:
```typescript
const svg = await this.renderSVG(mermaidCode);   // render #1 → write .svg
await fs.writeFile(paths.svg, svg, 'utf-8');
await this.renderPNG(mermaidCode, paths.png);     // render #2 inside renderPNG ← bug

// renderPNG() internally:
async renderPNG(mermaidCode: string, outputPath: string): Promise<void> {
  const svg = await this.renderSVG(mermaidCode);  // ← redundant render
}
```

**Site B** — `src/cli/processors/diagram-processor.ts`, `generateTsModuleGraphOutput()`:
```typescript
const svg = await mermaidRenderer.renderSVG(mmdContent);     // render #1
await fs.writeFile(paths.paths.svg, svg, 'utf-8');
await mermaidRenderer.renderPNG(mmdContent, paths.paths.png); // render #2 ← bug
```

**Site C** — `src/cli/processors/diagram-processor.ts`, `generateAtlasOutput()`:
```typescript
const svg = await mermaidRenderer.renderSVG(result.content);
await fs.writeFile(layerPaths.svg, svg, 'utf-8');
await mermaidRenderer.renderPNG(result.content, layerPaths.png); // render #2 ← bug
```

Sites B and C bypass `renderAndSave()` entirely and will not be fixed by a `renderer.ts`-only change.

For web-llm: `overview/package` goes through Site B; `method/*` diagrams go through Site A. Five diagrams × 2 renders = **10 `mermaid.render()` calls; correct count is 5**.

### Issue 2 — `mermaid` likely serialises concurrent renders (hypothesis, not confirmed)

`isomorphic-mermaid` exports a single module-level instance. Dagre graph layout is CPU-intensive pure JavaScript. The hypothesis is that concurrent `mermaid.render()` calls effectively execute serially on the event loop because they compete on the same JS thread.

> ⚠️ This is an architectural inference, not a confirmed measurement. The actual concurrency behaviour of `isomorphic-mermaid`'s JSDOM-backed instance under `pMap` parallelism has not been profiled. Confirmation requires either source-level inspection of `isomorphic-mermaid` internals or instrumented benchmarks showing render calls overlap vs. serialise in practice.

Additionally, `src/mermaid/validation-pipeline.ts` calls `mermaid.parse(mermaidCode)` (via `MermaidParseValidator`) once per diagram before rendering. This is an additional mermaid API call per diagram that also occupies the singleton if the serialisation hypothesis holds.

### Issue 3 — File writes and sharp conversion are serialised unnecessarily

Within `renderAndSave()` (and Sites B/C), I/O operations run sequentially:

```
writeFile(.mmd) → renderSVG() → writeFile(.svg) → renderPNG() → sharp → toFile(.png)
```

`fs.writeFile` and `sharp` both delegate to libuv's thread pool and do not block the JS thread. They can overlap with each other and with other async work.

### Issue 4 — Redundant sub-module re-parsing

Groups B and C re-parse subdirectories (`src/openai_api_protocols/`, `src/shared/`) that are fully contained within Group A's already-completed parse. Group A's ArchJSON holds all 188 entities including the 38 and 80 from the sub-modules. Re-parsing wastes `ParallelParser` time.

Note: ParallelParser operates without a TypeChecker, so it cannot resolve path aliases. For class/method-level diagrams where `tsAnalysis.moduleGraph` is not used, the practical quality difference is limited to cross-boundary import resolution — the claim that it "produces inferior results" applies only to that specific scenario.

---

## Proposed Solutions

### Layer 1 — Eliminate double render + parallelise I/O (low risk, high return)

**Target files**: `src/mermaid/renderer.ts`, `src/cli/processors/diagram-processor.ts`
**Estimated saving**: to be confirmed by instrumented measurement after fix

Refactor `renderAndSave()` into two parallel stages:

**Stage 1**: Write `.mmd` and render SVG concurrently (independent operations):
```typescript
const [svg] = await Promise.all([
  this.renderSVG(mermaidCode),           // one render only
  fs.writeFile(paths.mmd, mermaidCode),  // I/O, independent
]);
```

**Stage 2**: Write `.svg` and convert to PNG concurrently (sharp runs in libuv thread pool):
```typescript
await Promise.all([
  fs.writeFile(paths.svg, svg),
  this.convertSVGToPNG(svg, paths.png),  // new method: accepts svg string, no re-render
]);
```

New method `convertSVGToPNG(svg: string, outputPath: string)` extracts the existing viewBox/DPI/sharp logic from `renderPNG()` without calling `renderSVG()`. The existing `renderPNG(mermaidCode, path)` public signature is preserved by internally delegating to `renderSVG()` + `convertSVGToPNG()`.

Sites B and C in `diagram-processor.ts` must be updated to the same pattern:
```typescript
// Replace the two-call pattern at each site with:
const svg = await mermaidRenderer.renderSVG(content);
await Promise.all([
  fs.writeFile(paths.svg, svg, 'utf-8'),
  mermaidRenderer.convertSVGToPNG(svg, paths.png),
]);
```

### Layer 2 — Worker Thread render pool (medium complexity, requires feasibility spike)

**New file**: `src/mermaid/render-worker-pool.ts`
**Also modifies**: `src/cli/processors/diagram-processor.ts`
**Estimated saving**: significant if feasibility confirmed; depends on per-render time instrumentation

Each Node.js Worker Thread has an independent global scope and can hold its own `mermaid` instance. If feasibility is confirmed, a pool of N workers enables genuine concurrent Mermaid rendering:

```
Main thread          Worker Pool (N = min(cpuCount, diagramCount))
┌──────────────┐     ┌────────────────────────────────────────┐
│ RenderQueue  │─→ 1 │ Worker 1: own mermaid instance         │
│              │─→ 2 │ Worker 2: own mermaid instance         │
│              │─→ 3 │ Worker 3: own mermaid instance         │
└──────────────┘     └────────────────────────────────────────┘
```

Each worker receives `{ mermaidCode, paths, options }` via `postMessage` and performs the full render-and-save pipeline independently. Workers are created at startup and warmed up (mermaid initialised) before the first job.

Pool is only activated when `diagramCount ≥ 2`; single-diagram runs use the main thread directly to avoid worker startup overhead (~2–5s per worker).

> ⚠️ **Feasibility risk**: `isomorphic-mermaid` uses JSDOM which may have native addon constraints under Worker Threads. The viability of multiple independent `mermaid` instances in separate workers must be confirmed experimentally before committing to this layer.

### Layer 3 — Generate–render pipeline (low incremental complexity, requires Layer 2)

**Target**: `src/cli/processors/diagram-processor.ts`
**Estimated saving**: minor; generation is not the bottleneck

> **Context**: Diagrams within a source group are already dispatched concurrently via `pMap`. Layer 3 provides value only when combined with Layer 2 (worker pool), by overlapping main-thread `generateOnly()` with worker-thread rendering. Without Layer 2, there is no meaningful pipeline to add.

With a worker pool available, submit render jobs immediately after `generateOnly()` completes, without waiting for the previous render to finish:

```
With Layer 2:
[gen A]──[render A (worker 1)]
         [gen B]──[render B (worker 2)]
                  [gen C]──[render C (worker 3)]
```

Implementation: decouple `generateOnly()` from the render dispatch — submit to the pool as soon as Mermaid code is ready.

### Layer 4 — Sub-module ArchJSON derivation (medium complexity)

**Target**: `src/cli/processors/diagram-processor.ts`
**Estimated saving**: ~25–40s (parse phase, to be measured)

Before dispatching Group B or C to `ParallelParser`, check whether any cached ArchJSON covers a parent directory. If so, derive the sub-module ArchJSON by filtering `entities` and `relations` on `entity.filePath` prefix:

```typescript
function deriveSubModuleArchJSON(parent: ArchJSON, subPath: string): ArchJSON {
  const entities = parent.entities.filter(e => e.filePath?.startsWith(subPath));
  const ids = new Set(entities.map(e => e.id));
  const relations = parent.relations.filter(
    r => ids.has(r.source) && ids.has(r.target)
  );
  return { ...parent, entities, relations };
}
```

> ⚠️ **Architecture constraint**: `archJsonCache` is currently keyed by `hashSources()` (SHA-256 of normalised source paths). Parent-path lookup by scanning hash keys is impossible. Layer 4 **requires** a path-to-key reverse index as a prerequisite:
>
> ```typescript
> // New: maintained alongside archJsonCache
> const archJsonPathIndex = new Map<string, string>(); // sourcePath → cacheKey
> // On cache write:
> archJsonPathIndex.set(normalizedSourcePath, cacheKey);
> ```
>
> Only then can `processSourceGroup()` look up parent entries by path prefix.

This eliminates `ParallelParser` invocations for Groups B and C. Cross-module relations from the TypeScriptPlugin parse are preserved (which ParallelParser without TypeChecker would miss for path-alias imports).

---

## Projected Impact (web-llm, 5 diagrams)

> All render-phase numbers are estimates pending instrumentation. Parse-phase numbers are based on observed timing patterns. Total wall times are rough projections.

| Phase | Baseline¹ | After L1 | After L1+L2² | After L1+L2+L3+L4 |
|-------|-----------|----------|--------------|-------------------|
| Parse (Group A: ts-morph) | ~90s | ~90s | ~90s | ~90s |
| Parse (Groups B+C: re-parse) | ~25s | ~25s | ~25s | **~0s** (derived) |
| Render (mermaid, estimated) | ~250s | ~125s | ~40s | ~40s |
| I/O / sharp | ~15s | **~5s** (parallel) | ~5s | ~5s |
| **Total wall time** | **~213s** | **~135s** | **~55s** | **~45s** |
| **Reduction** | — | **~37%** | **~74%** | **~79%** |

¹ Baseline from a run with an external-path bug; re-establish after bug fix.
² L2 reduction depends on feasibility spike confirming Worker Thread isolation.

---

## Implementation Plan

### Phase A: Layer 1 (recommended first)

1. Add `convertSVGToPNG(svg: string, outputPath: string): Promise<void>` to `IsomorphicMermaidRenderer`
2. Refactor `renderAndSave()` to use two-stage `Promise.all` pattern
3. Refactor `renderPNG()` to delegate to `renderSVG()` + `convertSVGToPNG()`
4. Fix Sites B and C in `diagram-processor.ts`: replace `renderSVG()` + `renderPNG(code)` pattern with `renderSVG()` + `convertSVGToPNG(svg)`
5. Add regression test: verify `mermaid.render` spy is called exactly once per diagram output invocation (covering all three sites)
6. Re-establish baseline: run web-llm analysis and record new wall time
7. Integration validation: re-run with Phase A applied and compare

**Files changed**: `src/mermaid/renderer.ts`, `src/cli/processors/diagram-processor.ts`, `tests/unit/mermaid/renderer.test.ts`
**Risk**: Low. No interface changes; internal refactor only.

### Phase B: Layer 4 (independent of Layer 2/3)

1. Add path-to-key reverse index (`archJsonPathIndex: Map<string, string>`) alongside `archJsonCache` in `diagram-processor.ts`
2. Populate the index on each cache write with the normalised source path
3. Add `deriveSubModuleArchJSON(parent, subPath)` utility
4. In `processSourceGroup()`, before `ParallelParser`, scan `archJsonPathIndex` for parent-path entries
5. Add unit tests for the derivation utility and path-index lookup
6. Integration validation: confirm Group B/C entity counts match previous output

**Files changed**: `src/cli/processors/diagram-processor.ts`, `tests/unit/cli/processors/diagram-processor.test.ts`
**Risk**: Low–medium. Path index adds bookkeeping; must verify entity ID consistency and normalisation edge cases.

### Phase C: Layer 2 + Layer 3 (after A and B)

1. **Feasibility spike**: verify that `isomorphic-mermaid` can be independently instantiated inside Node.js Worker Threads (JSDOM native addon constraints). If blocked, Layer 2 is not viable.
2. Design worker message protocol (`RenderJob`, `RenderResult`)
3. Implement `MermaidRenderWorkerPool` with fixed-size pool, warm-up, and graceful shutdown
4. Modify render call sites to submit to pool and await result
5. Implement pipeline dispatch (Layer 3): submit each job immediately after `generateOnly()`
6. Add tests for pool behaviour: concurrency, error isolation, fallback to main thread
7. Integration validation: confirm output files identical to Phase A output

**Files changed**: new `src/mermaid/render-worker-pool.ts`, `src/cli/processors/diagram-processor.ts`
**Risk**: Medium–high. Feasibility not confirmed. Worker Threads require serialisable message passing; error propagation across thread boundaries needs careful handling. Descope Layer 2/3 if spike fails.

---

## Non-Goals

- Caching full ArchJSON to disk (separate proposal; requires cache invalidation strategy)
- Eliminating the ts-morph project initialisation cost (~90s); this requires incremental compilation support
- Removing `method/core` deduplication (design question; needs user-facing decision on diagram semantics)
