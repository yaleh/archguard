---
id: TASK-64
title: "TASK-64: JL intrinsic dimension — adjacency matrix + SVD + arch-health-history (Phase 4)"
status: todo
labels:
  - analysis
  - metric
  - cli
  - mcp
parent: null
children: []
extra:
  schema: v1
  source: quay-tasks/TASK-17
---
# TASK-64: JL intrinsic dimension — adjacency matrix + SVD + arch-health-history (Phase 4)

## Proposal

> source: quay-tasks/TASK-17（2026-08-05 经 git 历史核实为「真新」后搬入 tasks/，编号从 TASK-62 起；
> `src/analysis/jl/` 在 master 及所有分支均不存在 —— 仅 `docs/proposals/proposal-jl-intrinsic-dimension.md`
> 设计稿已审，实现未落地）

Compute architecture intrinsic dimension (d_int) using adjacency matrix + SVD, adaptive: DIRECT mode
for n<1000 entities, JL projection for n≥1000. Store a time series in
`.archguard/arch-health-history.json`. CLI flag `--arch-health`. MCP tool
`archguard_get_intrinsic_dimension`. Mandatory performance spike before implementation: <200ms for a
300×300 matrix.

**Background**: ArchGuard detects local structural problems (cycles, missing test coverage, change
risk) but lacks a global metric tracking how architectural complexity evolves. A healthy architecture
has a low-rank dependency adjacency matrix (entities' dependency patterns are linear combinations of
a few "basis directions"); a decaying architecture accumulates cross-cutting entanglements, raising
d_int. The Johnson-Lindenstrauss Lemma guarantees pairwise distances are preserved within (1 ± ε)
when projecting to k = O(ε⁻² log n) dimensions, enabling efficient SVD for large n. `ml-matrix`
(^6.12.1) is already in package.json — no new runtime dependency.

**Goals**:
1. Build a weighted adjacency matrix from ArchJSON relations (inheritance/implementation=2.0,
   composition=1.5, aggregation/dependency/association=1.0) and compute d_int via SVD on the
   normalized matrix.
2. Adaptive mode: DIRECT for n<1000, JL projection (Achlioptas matrix, ε=0.3, k=⌈4·ln(n)/ε²⌉) for
   n≥1000 — gated by a mandatory performance spike (<200ms 300×300 DIRECT, <500ms 1000×307 JL,
   <2s 5000×378 JL).
3. Persist each result as a snapshot in `.archguard/arch-health-history.json` (schemaVersion=1),
   accumulating a time series (max 500 snapshots).
4. Expose via CLI `--arch-health` (prints mode, d_int, d_int_norm, previous snapshot, trend) and MCP
   tool `archguard_get_intrinsic_dimension` (current snapshot + history + trend).
5. All existing tests pass; `--arch-health` absent → zero impact on existing flows.

**Downstream contract**: `adjacency-builder.ts` and `jl-projector.ts` return plain `number[][]` (not
ml-matrix Matrix) so the downstream proposals (architecture-drift → TASK-65, cluster-boundary →
TASK-66) can consume them without the ml-matrix dependency.

**Risks**: pure-JS SVD may be too slow for 5000×378 (spike is mandatory-gated; pivot to truncated SVD
if >2s); rising d_int does not necessarily mean decay — d_int_norm = d_int/n is the primary signal
(validity studies deferred); history files are keyed per language.

## Plan

### Phase A: Performance Spike — ml-matrix SVD benchmark

The spike IS the test: `docs/spikes/jl-performance-spike.mjs` imports ml-matrix SVD, benchmarks 4
matrix sizes (300×300 <200ms, 1000×307 <500ms, 5000×378 <2000ms, 5000×5000 control), prints a timing
table, exits 1 if any gated case exceeds its threshold.

DoD: `node docs/spikes/jl-performance-spike.mjs` exits 0 (all gated thresholds met).

### Phase B: AdjacencyBuilder — entity→matrix row mapping

Tests first, in `tests/unit/analysis/jl/adjacency-builder.test.ts`: correct non-zero positions for
3-entity/2-dependency fixture; relation weights (2.0/1.5/1.0); weight accumulation on repeated
relations; unknown entity IDs skipped; unknown relation type → weight 1.0 + console.warn; zero-entity
ArchJSON → 0×0 matrix; per-column z-score normalization (mean≈0, std≈1; all-zero column stays 0).

Implementation: `src/analysis/jl/types.ts` (ProjectionMode, JLConfig, IntrinsicDimensionResult,
ArchHealthHistory) and `src/analysis/jl/adjacency-builder.ts` (`buildAdjacencyMatrix`,
`normalizeColumns`; plain number[][]).

DoD: `npm test -- --run tests/unit/analysis/jl/adjacency-builder.test.ts`, `npm run type-check`.

### Phase C: JLProjector + SVD wrapper + d_int calculator

Tests first, in `tests/unit/analysis/jl/jl-projector.test.ts` (mode selection at n=100/1000/5000;
determinism with same seed; Achlioptas values ∈ {+1,0,-1}; custom directModeThreshold) and
`tests/unit/analysis/jl/intrinsic-dimension.test.ts` (hub graph → d_int=1; zero matrix → d_int=0 +
noDependenciesWarning; varianceExplained monotonic + terminal 1.0; dIntNormalized = dInt/entityCount;
DIRECT vs JL mode fields).

Implementation: `src/analysis/jl/jl-projector.ts` (`computeMode`, `computeK`, `buildAchlioptas`,
`project`) and `src/analysis/jl/intrinsic-dimension.ts` (`computeIntrinsicDimension` via ml-matrix
SVD, cumvar ≥ 0.95 threshold, truncated varianceExplained).

DoD: `npm test -- --run tests/unit/analysis/jl/`, `npm run type-check`.

### Phase D: ArchHealthHistory writer + CLI --arch-health flag

Tests first, in `tests/unit/analysis/jl/history-writer.test.ts` (first write creates schemaVersion=1;
chronological append; max-500 eviction; forward-compat on wrong schemaVersion; featureVersion change
does not clear old snapshots) and `tests/unit/cli/commands/analyze-arch-health.test.ts` (flag absent →
runArchHealth never called; present → called once; output includes Mode/d_int/d_int_norm/Trend;
no prior history → 'Previous: none' + STABLE).

Implementation: `src/analysis/jl/history-writer.ts` (`appendSnapshot`, fs-extra atomic write); modify
`src/cli/commands/analyze.ts` (`--arch-health` option; `runArchHealth` orchestrates AdjacencyBuilder →
JLProjector → computeIntrinsicDimension → appendSnapshot → print; trend: RISING if Δd_int_norm >
0.002, DECREASING if < -0.002, else STABLE).

DoD: `npm test -- --run tests/unit/analysis/jl/history-writer.test.ts`,
`npm test -- --run tests/unit/cli/commands/analyze-arch-health.test.ts`, `npm run type-check`,
`npm run build && node dist/cli/index.js analyze --arch-health -f json`.

### Phase E: MCP tool archguard_get_intrinsic_dimension

Tests first, in `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`: tool name; snapshotCount slicing;
empty history → `{current:null, history:[], trend:'stable'}`; rising/decreasing/stable trend logic;
`grep -q 'archguard_get_intrinsic_dimension' src/cli/mcp/server.ts`.

Implementation: `src/cli/mcp/tools/arch-health-tools.ts` (handleGetIntrinsicDimension) and register in
`src/cli/mcp/server.ts`.

DoD: `npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts`,
`grep -q 'archguard_get_intrinsic_dimension' src/cli/mcp/server.ts`, `npm run type-check`.

## Touches

- src/analysis/jl/types.ts (new)
- src/analysis/jl/adjacency-builder.ts (new)
- src/analysis/jl/jl-projector.ts (new)
- src/analysis/jl/intrinsic-dimension.ts (new)
- src/analysis/jl/history-writer.ts (new)
- src/cli/commands/analyze.ts (add --arch-health option + runArchHealth)
- src/cli/mcp/tools/arch-health-tools.ts (new)
- src/cli/mcp/server.ts (register archguard_get_intrinsic_dimension)
- docs/spikes/jl-performance-spike.mjs (new)
- tests/unit/analysis/jl/adjacency-builder.test.ts (new)
- tests/unit/analysis/jl/jl-projector.test.ts (new)
- tests/unit/analysis/jl/intrinsic-dimension.test.ts (new)
- tests/unit/analysis/jl/history-writer.test.ts (new)
- tests/unit/cli/commands/analyze-arch-health.test.ts (new)
- tests/unit/cli/mcp/tools/arch-health-tools.test.ts (new)
- docs/proposals/proposal-jl-intrinsic-dimension.md (reference — exists)
- tasks/TASK-64.md

## Acceptance Criteria

- [ ] Weighted adjacency matrix built from ArchJSON relations; per-column z-score normalization; plain `number[][]` output
- [ ] Adaptive mode: DIRECT (n<1000) vs JL projection (n≥1000) with Achlioptas matrix + seeded determinism
- [ ] Performance spike `docs/spikes/jl-performance-spike.mjs` passes all gated thresholds (300×300 <200ms, 1000×307 <500ms, 5000×378 <2s)
- [ ] Snapshots persisted to `.archguard/arch-health-history.json` (max 500); CLI `--arch-health` prints mode/d_int/d_int_norm/trend
- [ ] MCP tool `archguard_get_intrinsic_dimension` registered; `--arch-health` absent → zero behavior change
- [ ] `adjacency-builder` / `jl-projector` return plain `number[][]` (downstream TASK-65/66 contract)

## Contract

measure jl-spike = `node docs/spikes/jl-performance-spike.mjs` exit-code, 200ms / 500ms / 2000ms-gates
measure jl-adjacency = `npm test -- --run tests/unit/analysis/jl/adjacency-builder.test.ts` passed-count
measure jl-core = `npm test -- --run tests/unit/analysis/jl/` passed-count
measure jl-history = `npm test -- --run tests/unit/analysis/jl/history-writer.test.ts` passed-count
measure jl-cli = `npm test -- --run tests/unit/cli/commands/analyze-arch-health.test.ts` passed-count
measure jl-mcp = `npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts` passed-count
band all-green = `npm run type-check` exit-code-0, `npm run lint` exit-code-0
invariant --arch-health 必须完全可选（缺席零影响）；adjacency-builder/jl-projector 返回 number[][] 而非 Matrix；快照上限 500
invoke `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json`
control 若 src/analysis/jl/ 已存在实现 ⇒ 判定「已覆盖」而非「真新」（不得重复搬入）
resume Phase A spike 先过再进 B-E；每 Phase 跑 DoD 落盘；被打断可从已通过的 Phase 续

## Dispatch review

reviewer: inner
at: 2026-08-05
changed: 由 quay-tasks/TASK-17 搬入 tasks/（TASK-64）时写就；Contract 每 measure 行自带命令；AC 阈值（200ms/500ms/2s）引用 jl-spike 字段

## Definition of Done

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
