---
id: TASK-65
title: "TASK-65: JL architecture drift — per-entity L2 distance between snapshots + CI/CD gate (Phase 4)"
status: todo
labels:
  - analysis
  - metric
  - cli
  - mcp
  - ci
parent: TASK-64
children: []
extra:
  schema: v1
  source: quay-tasks/TASK-18
---
# TASK-65: JL architecture drift — per-entity L2 distance between snapshots + CI/CD gate (Phase 4)

## Proposal

> source: quay-tasks/TASK-18（2026-08-05 经 git 历史核实为「真新」后搬入 tasks/，编号从 TASK-62 起；
> `src/analysis/jl/` 无任何实现。依赖 TASK-64（JL intrinsic dimension）的 `src/analysis/jl/` 基础设施，
> 故 parent=TASK-64，待其 done 后才可晋级）

Detect per-entity L2 distance between snapshots in adjacency matrix space. Report Top-K high-drift
entities (stable/moderate/significant/critical categories). Supports cross-snapshot entity alignment
via union coordinate system. CLI flag `--drift-base HEAD~1` for CI/CD gate. MCP tool
`archguard_get_architecture_drift`.

**Background**: `archguard_get_change_risk` measures how frequently files change, but change frequency
answers "where is the most churn" — not "do these changes break the topology of the architecture". A
module can be heavily patched while remaining architecturally stable (same dependency graph); a quiet
refactor can silently add twenty cross-cutting dependencies — low LOC delta, severe topological shift.
Representing every entity as a row in the adjacency matrix ("fingerprint" in the dependency graph),
L2 distance between two snapshots' row vectors measures drift in architecture-topology space — highly
complementary to change-risk.

**Goals**:
1. For every entity present in both snapshots, compute `drift(i) = ‖v_i(t1) − v_i(t2)‖₂` in the union
   coordinate system (E_union = E1 ∪ E2), DIRECT mode when N_union < 1000, JL projection otherwise.
2. Classify into four severity levels — stable (< 0.5), moderate (0.5–1.5), significant (1.5–3.0),
   critical (≥ 3.0) — and expose Top-K entities per level, with deltaFanIn / deltaFanOut /
   deltaCoverage auxiliary signals.
3. Expose `archguard_get_architecture_drift` MCP tool (`fromCommit`, `toCommit`, `topK`, `minLevel`)
   returning a structured `DriftReport`.
4. Add `--drift-base <commit>` and `--drift-threshold <n>` CLI flags to `analyze`: exit 1 when any
   entity meets/exceeds the threshold (CI/CD gate), exit 2 on invalid commit reference, exit 0 with
   explanatory message when no baseline snapshot exists.
5. Entity alignment correct: t1-only entities appear in `removedEntities`, t2-only in
   `addedEntities`, neither contributes to drift scores.

**Not in scope**: automatic good/bad drift classification (auxiliary signals are for human judgment);
GitHub Actions/PR-comment integration (user-script concern); rename detection (deferred); drift
history trending (separate visualization layer).

**Dependency**: builds on TASK-64's `src/analysis/jl/` (AdjacencyBuilder, JLProjector). Snapshots
store only `entityIndex: string[]` (O(n), not O(n²)); adjacency rows recomputed on demand.

## Plan

### Phase A: EntityAligner — union coordinate system across two snapshots

Tests first, in `tests/unit/analysis/jl/entity-aligner.test.ts`: identical sets → E_shared = both,
added/removed empty; t2 adds 5 → addedEntities has 5, E_union 5 larger; t1 extras → removedEntities;
`buildAlignedRow()` row length = |E_union|; missing column zero-padded; absent-in-one-snapshot column
→ 0.0.

Implementation: `src/analysis/jl/entity-aligner.ts` (`EntityAligner.align`, `buildAlignedRow`);
append `EntityDrift`, `DriftReport`, `AlignmentResult` to `src/analysis/jl/types.ts`.

DoD: `npm test -- --run tests/unit/analysis/jl/entity-aligner.test.ts`, `npm run type-check`.

### Phase B: DriftCalculator — L2 distance + severity thresholds

Tests first, in `tests/unit/analysis/jl/drift-calculator.test.ts`: identical snapshots → all 0;
entity gains 5 edges → drift ≈ √5 ≈ 2.236; added/removed entities excluded from drifts; boundary
values (0.499→stable, 0.5→moderate, 1.5→significant, 3.0→critical); DIRECT at N_union=999 vs JL at
1000; JL determinism; k = ⌈4·ln(N)/0.09⌉; deltaFanIn/deltaFanOut; drifts sorted descending.

Implementation: `src/analysis/jl/drift-calculator.ts` (`DriftCalculator.compare`, `classifyDrift`,
`computeK`); append `DriftOptions` to `src/analysis/jl/types.ts`.

DoD: `npm test -- --run tests/unit/analysis/jl/drift-calculator.test.ts`,
`npm test -- --run tests/unit/analysis/jl/`, `npm run type-check`.

### Phase C: CLI --drift-base and --drift-threshold flags

Tests first, in `tests/unit/cli/commands/analyze-drift.test.ts`: parseDriftOptions with/without flags;
determineDriftExitCode (0 critical → 0; 1 critical → 1; significant at 1.5 threshold → 1); no baseline
→ exit 0 + "no baseline available"; invalid commit sha → exit 2.

Implementation: modify `src/cli/commands/analyze.ts` (`--drift-base`, `--drift-threshold`; resolve
baseline from `arch-health-history.json` by commitSha; call DriftCalculator.compare; apply exit code
logic); new `src/cli/utils/drift-reporter.ts` (`formatDriftReport`) and
`src/analysis/jl/drift-exit-code.ts` (`determineDriftExitCode`).

DoD: `npm test -- --run tests/unit/cli/commands/analyze-drift.test.ts`,
`npm test -- --run tests/unit/analysis/jl/`, `npm run type-check`.

### Phase D: MCP tool archguard_get_architecture_drift

Tests first, in `tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts`: tool name; topK/minLevel
forwarded; fromCommit snapshot lookup (not found → structured error); no history → 'no baseline
available'; hasBreakingDrift at critical; breakingEntities ≥ threshold; defaults (topK=10, minLevel='stable').

Implementation: append handler to `src/cli/mcp/tools/arch-health-tools.ts` (resolve from/to from
arch-health-history.json, call DriftCalculator.compare, return `{report, hasBreakingDrift,
breakingEntities}`); register `archguard_get_architecture_drift` in `src/cli/mcp/server.ts`.

DoD: `npm test -- --run tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts`,
`npm test -- --run tests/unit/analysis/jl/`, `npm run type-check`.

## Touches

- src/analysis/jl/entity-aligner.ts (new)
- src/analysis/jl/drift-calculator.ts (new)
- src/analysis/jl/drift-exit-code.ts (new)
- src/analysis/jl/types.ts (append drift interfaces — created by TASK-64)
- src/cli/commands/analyze.ts (add --drift-base / --drift-threshold)
- src/cli/utils/drift-reporter.ts (new)
- src/cli/mcp/tools/arch-health-tools.ts (append drift tool — created by TASK-64)
- src/cli/mcp/server.ts (register archguard_get_architecture_drift)
- tests/unit/analysis/jl/entity-aligner.test.ts (new)
- tests/unit/analysis/jl/drift-calculator.test.ts (new)
- tests/unit/cli/commands/analyze-drift.test.ts (new)
- tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts (new)
- docs/proposals/proposal-jl-architecture-drift.md (reference — exists)
- tasks/TASK-65.md

## Acceptance Criteria

- [ ] `EntityAligner` computes union/shared/added/removed entity sets and zero-pads aligned rows to |E_union|
- [ ] `DriftCalculator` computes per-entity L2 drift with the four severity classes (0.5/1.5/3.0), deltaFanIn/deltaFanOut, deterministic JL
- [ ] CLI `--drift-base`/`--drift-threshold` enforce the CI/CD gate (exit 1 on threshold breach, 2 on invalid commit, 0 with message on no baseline)
- [ ] MCP tool `archguard_get_architecture_drift` returns `{report, hasBreakingDrift, breakingEntities}`
- [ ] `adjacencyRows` never persisted to `arch-health-history.json` (only `entityIndex: string[]`); depends on TASK-64 (`src/analysis/jl/` existing)

## Contract

measure entity-aligner = `npm test -- --run tests/unit/analysis/jl/entity-aligner.test.ts` passed-count
measure drift-calculator = `npm test -- --run tests/unit/analysis/jl/drift-calculator.test.ts` passed-count, 0.5-1.5-3.0-thresholds
measure drift-cli = `npm test -- --run tests/unit/cli/commands/analyze-drift.test.ts` passed-count, exit-code-1-2-0
measure drift-mcp = `npm test -- --run tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts` passed-count
measure jl-core = `npm test -- --run tests/unit/analysis/jl/` passed-count
band all-green = `npm run type-check` exit-code-0
invariant 不持久化 adjacencyRows（只存 entityIndex）；阈值 0.5/1.5/3.0 用常量而非测试内硬编码；依赖 TASK-64 的 src/analysis/jl/
invoke `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json`
control 若 src/analysis/jl/drift-calculator.ts 已存在实现 ⇒ 判定「已覆盖」而非「真新」（不得重复搬入）
resume 每完成一个 Phase 即跑该 Phase 的 DoD 命令落盘；被打断可从已通过的 Phase 续

## Dispatch review

reviewer: inner
at: 2026-08-05
changed: 由 quay-tasks/TASK-18 搬入 tasks/（TASK-65，parent=TASK-64）时写就；Contract 每 measure 行自带命令；AC 阈值（0.5/1.5/3.0）引用 drift-calculator 字段

## Definition of Done

- [ ] #1 npm test -- --run tests/unit/analysis/jl/entity-aligner.test.ts
- [ ] #2 npm test -- --run tests/unit/analysis/jl/drift-calculator.test.ts
- [ ] #3 npm test -- --run tests/unit/cli/commands/analyze-drift.test.ts
- [ ] #4 npm test -- --run tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts
- [ ] #5 npm test -- --run tests/unit/analysis/jl/
- [ ] #6 npm run type-check
- [ ] #7 npm test
- [ ] #8 node dist/cli/index.js analyze --help | grep -q 'drift-base'
- [ ] #9 node dist/cli/index.js analyze --help | grep -q 'drift-threshold'
