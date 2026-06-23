---
id: TASK-17
title: 'JL intrinsic dimension: adjacency matrix + SVD + arch-health-history (Phase 4)'
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 06:33'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
JL intrinsic dimension tracking — compute architecture intrinsic dimension (d_int) using adjacency matrix + SVD (adaptive: DIRECT mode for n<1000 entities, JL projection for n≥1000). Store time series in .archguard/arch-health-history.json. CLI flag --arch-health. MCP tool archguard_get_intrinsic_dimension. Mandatory performance spike before implementation: <200ms for 300×300 matrix.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: JL Intrinsic Dimension Tracking (Phase 4)

## Background

ArchGuard currently detects local structural problems — cycles, missing test coverage, change risk — but lacks a global metric that tracks how architectural complexity evolves over time. Without such a metric, teams cannot detect gradual structural decay before it becomes a crisis.

The core insight is that a healthy architecture has a low-rank dependency adjacency matrix: most entities' dependency patterns can be expressed as linear combinations of a small number of "basis directions" (e.g., many handlers all depend on the same service layer). A decaying architecture accumulates cross-cutting entanglements, making each entity's pattern unique and requiring more dimensions to represent — a phenomenon quantifiable as Intrinsic Dimension (d_int).

The Johnson-Lindenstrauss Lemma guarantees that for n high-dimensional vectors, a random linear projection preserves all pairwise distances within factor (1 ± ε) when projecting to k = O(ε⁻² log n) dimensions. For large n (≥1000), this enables efficient SVD without loss of structural signal. For small n (<1000, e.g., ArchGuard itself with ~312 entities), direct SVD is fast enough to be preferred.

`ml-matrix` is already present in package.json (^6.12.1), so no new runtime dependency is required.

## Goals

1. Build a weighted adjacency matrix from ArchJSON relations (6 relation types with calibrated weights: inheritance/implementation=2.0, composition=1.5, aggregation/dependency/association=1.0) and compute d_int via SVD on the normalized matrix.
2. Adaptive mode selection: DIRECT SVD for n<1000 entities, JL projection (Achlioptas matrix, ε=0.3, k=⌈4·ln(n)/ε²⌉) for n≥1000 — validated by a mandatory performance spike (gate: <200ms for 300×300 DIRECT, <500ms for 1000×307 JL, <2s for 5000×378 JL).
3. Persist each analysis result as a snapshot in `.archguard/arch-health-history.json` (schemaVersion=1), accumulating a time series for trend analysis.
4. Expose results via CLI flag `--arch-health` (prints mode, d_int, d_int_norm, previous snapshot, trend) and MCP tool `archguard_get_intrinsic_dimension` (returns current snapshot + history + trend string).
5. All existing tests continue to pass; `--arch-health` absent → zero impact on existing flows.

## Proposed Approach

New module `src/analysis/jl/` contains four pure-function files:
- `types.ts` — TypeScript interfaces: `JLConfig`, `IntrinsicDimensionResult`, `ArchHealthHistory`
- `adjacency-builder.ts` — builds n×n weighted adjacency matrix from ArchJSON; applies per-column z-score normalization (snapshot-local, not cross-snapshot, to avoid entity-index misalignment across snapshots); skips relations with unknown entity IDs; logs warnings for unknown relation types (defaults to weight 1.0)
- `jl-projector.ts` — generates Achlioptas sparse matrix R ∈ {+1,0,-1} with probabilities {1/6,4/6,1/6} using a seeded PRNG; computes projection P = (1/√k)·A·Rᵀ; only invoked when n≥1000
- `intrinsic-dimension.ts` — centres matrix, runs `new SVD(M)` from ml-matrix, computes cumulative variance, finds d_int = min{d: cumvar[d]≥0.95}; handles zero-matrix edge case (d_int=0, varianceExplained=[], noDependenciesWarning); outputs varianceExplained truncated to d_int+10 values with terminal 1.0
- `history-writer.ts` — reads/writes `.archguard/arch-health-history.json` with append semantics; enforces max-500-snapshot rolling window

CLI: `analyze.ts` gains `--arch-health` flag that runs the JL pipeline after ArchJSON is produced and prints a formatted summary. The arch-health path is decoupled from diagram-processor (no nesting).

MCP: `arch-health-tools.ts` implements `archguard_get_intrinsic_dimension` with `snapshotCount` input; registered in `server.ts`.

A performance spike (`docs/spikes/jl-performance-spike.mjs`) must exit 0 and log timings before any implementation phase begins.

## Trade-offs and Risks

**Not in scope**: threshold alerting (requires validity study first), Mermaid visualization of d_int trend, cross-snapshot entity alignment (deferred to proposal-jl-architecture-drift.md), CI/CD integration scripts, hand-crafted feature vectors (v1 approach abandoned — JL on 10-dim vectors degenerates to identity).

**Downstream contracts**: `adjacency-builder.ts` and `jl-projector.ts` return plain `number[][]` (not `ml-matrix` Matrix objects) so downstream proposals (architecture-drift, cluster-boundary) can consume them without adding the ml-matrix dependency.

**Risk — ml-matrix SVD performance**: Pure-JS SVD may be too slow for 5000×378 matrices. The spike benchmarks this before code is written; if >2s, the plan pivots to truncated/randomized SVD (computing only the top-k singular values). This risk is mandatory-gated.

**Risk — d_int validity**: Rising d_int does not necessarily mean decay (healthy modular growth also raises it). The normalized metric d_int_norm = d_int/n is the primary signal. Validity studies (correlation with SCC count, human-annotated events) are deferred post-implementation.

**Risk — cross-language comparability**: History files are keyed per language; d_int_norm is the cross-project-comparable metric, but cross-language comparison is explicitly out of scope.

---

# Plan: JL Intrinsic Dimension Tracking (Phase 4)

Proposal: docs/proposals/proposal-jl-intrinsic-dimension.md

## Phase A: Performance Spike — ml-matrix SVD benchmark

### Tests (write first)
The spike IS the test. Write `docs/spikes/jl-performance-spike.mjs` that:
- Imports `ml-matrix` SVD via dynamic import (ESM)
- Benchmarks 4 matrix sizes:
  - 300×300 (ArchGuard DIRECT, must be <200ms)
  - 1000×307 (JL mode, must be <500ms)
  - 5000×378 (llama.cpp JL, must be <2000ms)
  - 5000×5000 (control group, record only)
- For each size: fills matrix with random values, runs `new SVD(matrix)`, measures wall-clock time
- Prints timing table
- Exits with code 1 if any gated case exceeds its threshold; exits 0 if all pass

### Implementation
- `docs/spikes/jl-performance-spike.mjs` — self-contained Node.js ESM script
  - Uses `performance.now()` for timing
  - Creates Matrix instances using `ml-matrix` Matrix class
  - Runs SVD; reads `svd.diagonal` to confirm result is valid (not lazy-evaluated)
  - Prints: `[PASS/FAIL] NxM: Xms (gate: Yms)`
  - If 5000×378 fails (<2s threshold): prints recommendation to use truncated SVD and exits 1

### DoD
- [ ] `node docs/spikes/jl-performance-spike.mjs`
- [ ] `node docs/spikes/jl-performance-spike.mjs` exits with code 0 (all gated thresholds met)

---

## Phase B: AdjacencyBuilder — entity→matrix row mapping

### Tests (write first)
File: `tests/unit/analysis/jl/adjacency-builder.test.ts`

Test cases:
- 3 entities, 2 `dependency` relations → 3×3 matrix with correct non-zero positions matching source/target indices
- `inheritance` relation weight = 2.0; `composition` = 1.5; `dependency` = 1.0; `association` = 1.0
- Multiple relations between same pair → weights accumulate (not overwritten)
- Relation referencing unknown entity ID → relation skipped, no error thrown
- Unknown relation type → weight defaults to 1.0, warning logged (spy on console.warn)
- Zero-entity ArchJSON → returns 0×0 matrix (empty array)
- Column normalization: after normalize(), each column has mean≈0 and std≈1 (test with 4+ entity matrix; columns with all-zero weights remain 0)
- Column with zero std (all same value) → std treated as 1, column remains unchanged

### Implementation
- `src/analysis/jl/types.ts` — new file with interfaces:
  - ProjectionMode, JLConfig, IntrinsicDimensionResult, ArchHealthHistory
- `src/analysis/jl/adjacency-builder.ts` — new file:
  - `buildAdjacencyMatrix(archJson)`: returns `{ matrix: number[][], entityIndex: Map<string, number> }`
  - Relation weights: inheritance/implementation=2.0, composition=1.5, aggregation/dependency/association=1.0, unknown→1.0 + console.warn
  - Skips relation if source or target not in entities set
  - `normalizeColumns(matrix: number[][]): number[][]` — snapshot-local per-column z-score
  - Returns plain `number[][]`, not ml-matrix Matrix

### DoD
- [ ] `npm test -- --run tests/unit/analysis/jl/adjacency-builder.test.ts`
- [ ] `npm run type-check`

---

## Phase C: JLProjector + SVD wrapper + d_int calculator

### Tests (write first)
Files:
- `tests/unit/analysis/jl/jl-projector.test.ts`
- `tests/unit/analysis/jl/intrinsic-dimension.test.ts`

Test cases for `jl-projector.test.ts`:
- n=100, ε=0.3 → mode=DIRECT, k=null, projection returns original matrix unchanged
- n=1000, ε=0.3 → k=307, projected matrix shape is 1000×307
- n=5000, ε=0.3 → k=378, projected matrix shape is 5000×378
- Same seed → identical Achlioptas matrix on two separate calls (determinism)
- Achlioptas matrix values are only in {+1, 0, -1} (sample 100 random entries)
- Custom directModeThreshold=500: n=600 → uses JL mode; n=400 → uses DIRECT mode

Test cases for `intrinsic-dimension.test.ts`:
- Hub graph (all entities depend on entity 0) → d_int=1
- Zero matrix → d_int=0, varianceExplained=[], noDependenciesWarning=true
- varianceExplained (when non-empty): monotonically non-decreasing, last value === 1.0 (|last-1.0|<1e-10)
- varianceExplained length = d_int+10 (or total singular values if fewer), last element clamped to 1.0
- dIntNormalized = dInt / entityCount, rounded to 4 decimal places
- entityCount < 3 → result valid, lowEntityCountWarning=true
- DIRECT mode: result.mode === 'direct', result.k === null, result.epsilon === null
- JL mode: result.mode === 'jl', result.k === 307 (for n=1000), result.epsilon === 0.3

### Implementation
- `src/analysis/jl/jl-projector.ts` — new file:
  - `computeMode(n, config)`: returns `{ mode: ProjectionMode; k: number | null }`
  - `computeK(n, epsilon)`: k = Math.ceil(4 * Math.log(n) / (epsilon * epsilon))
  - `buildAchlioptas(k, n, seed)`: seeded PRNG, values {+1,0,-1} with P={1/6,4/6,1/6}
  - `project(matrix, R, k)`: P = (1/√k) · A · Rᵀ; returns plain `number[][]`
- `src/analysis/jl/intrinsic-dimension.ts` — new file:
  - `computeIntrinsicDimension(matrix, entityCount, mode, config, commitSha?)`: IntrinsicDimensionResult
  - Imports `SVD` from `ml-matrix`
  - Centres columns, runs SVD, computes cumvar, finds d_int at 0.95 threshold
  - Zero-matrix: denominator=0 → d_int=0, varianceExplained=[], noDependenciesWarning=true
  - Truncates varianceExplained to d_int+10, appends 1.0 if needed
  - Sets featureVersion='1.0', timestamp=new Date().toISOString()

### DoD
- [ ] `npm test -- --run tests/unit/analysis/jl/`
- [ ] `npm run type-check`

---

## Phase D: ArchHealthHistory writer + CLI --arch-health flag

### Tests (write first)
Files:
- `tests/unit/analysis/jl/history-writer.test.ts`
- `tests/unit/cli/commands/analyze-arch-health.test.ts`

Test cases for `history-writer.test.ts` (use tmp dir, clean up in afterEach):
- First write to non-existent file → creates file with schemaVersion=1, snapshots=[result]
- Second write → snapshots array has 2 entries, order is chronological
- Snapshot count >500 → oldest snapshot is evicted; length stays at 500
- Existing file with wrong schemaVersion → preserves file, appends new snapshot (forward-compat)
- featureVersion change → new snapshot appended, old snapshots NOT cleared

Test cases for `analyze-arch-health.test.ts`:
- `--arch-health` flag absent → runArchHealth never called (spy on module)
- `--arch-health` flag present + archJson available → runArchHealth called once with archJson
- CLI output includes: 'Mode:', 'd_int:', 'd_int_norm:', 'Trend:'
- `--arch-health` with no prior history → 'Previous: none' in output, trend shown as 'STABLE'
- `--arch-health` with prior history → shows previous snapshot values and computed trend

### Implementation
- `src/analysis/jl/history-writer.ts` — new file:
  - `appendSnapshot(outputDir, language, result, maxSnapshots=500): Promise<void>`
  - Reads existing JSON or starts fresh ArchHealthHistory; appends result; trims to maxSnapshots; writes back
  - Uses `fs-extra` for atomic read/write
- `src/cli/commands/analyze.ts` — modify:
  - Add `.option('--arch-health', 'Compute and track architecture intrinsic dimension')` to commander
  - After ArchJSON is generated: if `options.archHealth`, call `runArchHealth(archJson, outputDir, language)`
  - `runArchHealth`: orchestrates AdjacencyBuilder → JLProjector → computeIntrinsicDimension → appendSnapshot → print summary
  - Trend: RISING if Δd_int_norm > 0.002, DECREASING if < -0.002, else STABLE

### DoD
- [ ] `npm test -- --run tests/unit/analysis/jl/history-writer.test.ts`
- [ ] `npm test -- --run tests/unit/cli/commands/analyze-arch-health.test.ts`
- [ ] `npm run type-check`
- [ ] `npm run build && node dist/cli/index.js analyze --arch-health -f json`

---

## Phase E: MCP tool archguard_get_intrinsic_dimension

### Tests (write first)
File: `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`

Test cases:
- Tool name is `archguard_get_intrinsic_dimension`
- Input `{ snapshotCount: 5 }` with 10 snapshots → returns only last 5 in `history` array
- Input `{ snapshotCount: 1 }` → current = last snapshot; history = [last snapshot]
- Empty history file → returns `{ current: null, history: [], trend: 'stable' }` without error
- Trend 'rising': d_int_norm increased by >0.002 between last two snapshots
- Trend 'decreasing': d_int_norm decreased by >0.002 between last two snapshots
- Trend 'stable': Δd_int_norm within ±0.002
- `grep -q 'archguard_get_intrinsic_dimension' src/cli/mcp/server.ts` exits 0

### Implementation
- `src/cli/mcp/tools/arch-health-tools.ts` — new file:
  - Exports MCP tool definition for `archguard_get_intrinsic_dimension`
  - `handleGetIntrinsicDimension(args, outputDir, language)`: reads history, slices to snapshotCount, computes trend
  - Returns `{ current, history, trend }` where trend is 'stable'|'rising'|'decreasing'
- `src/cli/mcp/server.ts` — modify:
  - Import and register `archguard_get_intrinsic_dimension` tool

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts`
- [ ] `grep -q 'archguard_get_intrinsic_dimension' src/cli/mcp/server.ts`
- [ ] `npm run type-check`

---

## Constraints

- Phase A (spike) must exit 0 before any Phase B–E implementation begins. If 5000×378 >2s, pivot to truncated SVD before proceeding.
- `adjacency-builder.ts` and `jl-projector.ts` must return plain `number[][]`, not `ml-matrix` Matrix objects — downstream proposals (jl-architecture-drift, jl-cluster-boundary) depend on this contract.
- `--arch-health` flag must be entirely optional; its absence must produce zero change in existing behavior.
- Phase E (MCP tool) depends on Phase D (history-writer + CLI).
- This task is the infrastructure foundation for proposal-jl-architecture-drift.md and proposal-jl-cluster-boundary.md; those proposals must NOT be implemented here.
- Maximum 500 snapshots per history file; oldest evicted when limit exceeded.

## Acceptance Gate

- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `node docs/spikes/jl-performance-spike.mjs`
- [ ] `npm run build && node dist/cli/index.js analyze --arch-health -f json`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved (self-review passed all 5 criteria). Advancing to plan draft.

Plan review iteration 1: APPROVED
premise-ledger:
[E] goal coverage: 5 goals mapped to Phases A/B/C/D/E and Acceptance Gate
[E] TDD structure: every phase has Tests then Implementation sections
[E] TDD order: Phase A DoD[0]=node docs/spikes/jl-performance-spike.mjs; Phases B-E DoD[0]=npm test -- --run matching testCmd
[E] acceptance gate: first item is npm test matching testAll
[E] DoD executability: all items are shell commands; natural-language criteria in Constraints section
[C] file paths exist: src/analysis/jl/ (new, confirmed analysis/ dir exists), src/cli/commands/analyze.ts (confirmed exists), src/cli/mcp/server.ts (confirmed exists), docs/spikes/ (confirmed exists)
[H] DoD sufficiency: judgment that spike + per-phase test + type-check covers adequate quality gates
GCL-self-report: E=5 C=1 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node docs/spikes/jl-performance-spike.mjs
- [ ] #2 npm test -- --run tests/unit/analysis/jl/adjacency-builder.test.ts
- [ ] #3 npm test -- --run tests/unit/analysis/jl/
- [ ] #4 npm test -- --run tests/unit/analysis/jl/history-writer.test.ts
- [ ] #5 npm test -- --run tests/unit/cli/commands/analyze-arch-health.test.ts
- [ ] #6 npm run build && node dist/cli/index.js analyze --arch-health -f json
- [ ] #7 npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts
- [ ] #8 grep -q 'archguard_get_intrinsic_dimension' src/cli/mcp/server.ts
- [ ] #9 npm test
- [ ] #10 npm run type-check
- [ ] #11 npm run lint
<!-- DOD:END -->
