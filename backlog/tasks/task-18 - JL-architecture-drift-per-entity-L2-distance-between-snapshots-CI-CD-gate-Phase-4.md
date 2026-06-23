---
id: TASK-18
title: >-
  JL architecture drift: per-entity L2 distance between snapshots + CI/CD gate
  (Phase 4)
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 06:33'
labels:
  - 'kind:basic'
dependencies:
  - TASK-17
references:
  - docs/proposals/proposal-jl-architecture-drift.md
  - docs/proposals/proposal-jl-intrinsic-dimension.md
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Detect per-entity L2 distance between snapshots in adjacency matrix space. Report Top-K high-drift entities (stable/moderate/significant/critical categories). Supports cross-snapshot entity alignment via union coordinate system. CLI flag --drift-base HEAD~1 for CI/CD gate. MCP tool archguard_get_architecture_drift. Depends on JL intrinsic dimension infrastructure (TASK-17).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: JL Architecture Drift — Per-Entity L2 Distance Between Snapshots

## Background

ArchGuard already provides `archguard_get_change_risk`, which measures how frequently
files change. However, change frequency answers "where is the most churn" — not "do
these changes break the topology of the architecture."

A module can be heavily patched (high churn) while remaining architecturally stable
(same dependency graph). Conversely, a quiet refactor can silently add twenty new
cross-cutting dependencies — low LOC delta, but severe topological shift.

The proposal represents every entity as a row in the adjacency matrix (its full
"fingerprint" in the dependency graph). When the L2 distance between two snapshots'
row vectors exceeds a threshold, the entity has drifted in architecture-topology space.
This metric is highly complementary to change-risk: it detects structural displacement
that pure file-history metrics miss entirely.

## Goals

1. For every entity present in both snapshots, compute `drift(i) = ‖v_i(t1) − v_i(t2)‖₂`
   in the union coordinate system (E_union = E1 ∪ E2), using DIRECT mode when
   N_union < 1000 and JL projection mode otherwise.
2. Classify each drift score into four severity levels — stable (< 0.5), moderate
   (0.5–1.5), significant (1.5–3.0), critical (≥ 3.0) — and expose Top-K entities
   per level, with deltaFanIn / deltaFanOut / deltaCoverage auxiliary signals.
3. Expose drift results via a new MCP tool `archguard_get_architecture_drift` that
   accepts `fromCommit`, `toCommit`, `topK`, and `minLevel` parameters and returns a
   structured `DriftReport`.
4. Add `--drift-base <commit>` and `--drift-threshold <n>` CLI flags to `analyze`:
   exit code 1 when any entity meets or exceeds the threshold (CI/CD gate), exit
   code 2 on invalid commit reference, exit code 0 when no snapshot baseline exists
   (with an explanatory message).
5. Entity alignment is correct: entities present only in t1 appear in `removedEntities`,
   entities present only in t2 appear in `addedEntities`, and neither set contributes
   to drift scores.

## Proposed Approach

Build on the adjacency-matrix infrastructure introduced by TASK-17
(`src/analysis/jl/`). The new module `drift-calculator.ts` will:

1. **Entity alignment**: compute E_union = E1 ∪ E2, E_shared = E1 ∩ E2; zero-pad
   missing columns in each snapshot's adjacency matrix so both live in ℝ^|E_union|.
2. **Drift computation**: in DIRECT mode, compute plain L2 distance on aligned rows;
   in JL mode (N_union ≥ 1000), generate a deterministic Achlioptas matrix
   R ∈ ℝ^{k × N_union} (fixed seed per comparison pair) and compute L2 on projected
   rows. k = ⌈4 ln(N_union) / 0.09⌉ (ε = 0.3).
3. **Severity classification**: threshold table (0.5 / 1.5 / 3.0) with auxiliary
   delta signals read directly from adjacency rows (no separate analysis pass).
4. **History integration**: snapshots store only `entityIndex: string[]` (no full
   matrix rows), so file size stays O(n) rather than O(n²). Adjacency rows are
   recomputed on demand from the parsed ArchJSON of each commit.
5. **CLI gate**: after drift computation, if any entity's drift ≥ `--drift-threshold`,
   process exits with code 1.
6. **MCP tool**: thin adapter in `arch-health-tools.ts` that calls DriftCalculator
   and serialises the result.

## Trade-offs and Risks

**Not in scope**:
- Automatic good/bad drift classification (distinguishing intentional refactor from
  accidental coupling creep) — auxiliary signals are provided for human judgment only.
- GitHub Actions / PR-comment integration — this is a user-script concern.
- Rename detection — a renamed entity appears as removed + added; heuristic matching
  is deferred as it adds significant complexity.
- Drift history trending (multiple snapshots over time) — requires more data and
  a separate visualisation layer.

**Known risks**:
- Default thresholds (0.5 / 1.5 / 3.0) are derived analytically; they will need
  empirical calibration against real projects (ArchGuard self, llama.cpp, lmdeploy).
- For very large projects (N_union ≥ 5000), the on-demand re-parse of two commits
  may add ≥ 30 s to CI time; incremental/lazy parsing is a future optimisation.
- The drift module depends on TASK-17 (`src/analysis/jl/`) being complete; it cannot
  be parallelised past the AdjacencyBuilder and JLStateManager interfaces.

---

# Plan: JL Architecture Drift — Per-Entity L2 Distance Between Snapshots + CI/CD Gate

Proposal: docs/proposals/proposal-jl-architecture-drift.md

## Constraints

- This task depends on TASK-17 (JL intrinsic dimension). `src/analysis/jl/` must
  exist and export `AdjacencyBuilder`, `JLStateManager`, and `JLProjector` before
  implementation begins.
- Default drift thresholds (0.5 / 1.5 / 3.0) are empirical starting values and must
  not be hardcoded in tests that verify specific output formatting; use constants.
- The `adjacencyRows` field must NOT be persisted to `arch-health-history.json`;
  only `entityIndex: string[]` is stored per snapshot.
- JL projection matrix R is generated per-comparison (not reused from jl-state.json).
- All new files go under `src/analysis/jl/` to co-locate with the intrinsic-dimension
  infrastructure.

---

## Phase A: EntityAligner — union coordinate system across two snapshots

### Tests (write first)

File: `tests/unit/analysis/jl/entity-aligner.test.ts`

Test cases:
- `alignEntities()` with identical entity sets → E_shared equals both sets,
  addedEntities=[], removedEntities=[]
- `alignEntities()` with t2 adding 5 entities → addedEntities has 5 IDs,
  E_union is 5 larger than E1
- `alignEntities()` with t1 having 3 extra entities → removedEntities has 3 IDs
- `buildAlignedRow()` for an entity in E_union: row length equals |E_union|
- `buildAlignedRow()` for an entity whose dependencies include a column not in its
  own snapshot → the column is present in the aligned row at correct index (zero-padded)
- `buildAlignedRow()` for a column absent in one snapshot → value is 0.0 at that index

### Implementation

Files to create/modify:
- `src/analysis/jl/entity-aligner.ts` (new): exports `EntityAligner` class
  - `align(entities1: string[], entities2: string[]): AlignmentResult`
    returns `{ eUnion, eShared, addedEntities, removedEntities, indexMap }`
  - `buildAlignedRow(adjacencyRow: Map<string, number>, indexMap: Map<string, number>, size: number): Float64Array`
    constructs a dense row vector of length |E_union|, zero for missing columns
- `src/analysis/jl/types.ts` (modify, once TASK-17 creates it): append
  `EntityDrift`, `DriftReport`, `AlignmentResult` interfaces

### DoD
- [ ] `npm test -- --run tests/unit/analysis/jl/entity-aligner.test.ts`
- [ ] `npm run type-check`

---

## Phase B: DriftCalculator — L2 distance + severity thresholds

### Tests (write first)

File: `tests/unit/analysis/jl/drift-calculator.test.ts`

Test cases:
- Two identical snapshots (same entities, same adjacency rows) → all drift scores = 0
- One entity gains 5 outgoing dependency edges (weight 1.0 each) →
  drift ≈ √5 ≈ 2.236 (within float tolerance 1e-6)
- Drift of a newly added entity (only in t2) → not in DriftReport.drifts;
  entity ID appears in addedEntities
- Drift of a removed entity (only in t1) → not in DriftReport.drifts;
  entity ID appears in removedEntities
- Boundary values: drift=0.499 → level='stable'; drift=0.5 → level='moderate';
  drift=1.499 → level='moderate'; drift=1.5 → level='significant';
  drift=2.999 → level='significant'; drift=3.0 → level='critical'
- DIRECT mode selected when N_union=999; JL mode selected when N_union=1000
- JL mode: same seed produces identical drift scores across two calls (determinism)
- JL mode: k = ceil(4 * ln(N_union) / 0.09) matches formula (spot-check N_union=1000)
- deltaFanIn = sum of column i in A2 minus sum of column i in A1
- deltaFanOut = sum of row i in A2 minus sum of row i in A1
- DriftReport.drifts is sorted by drift score descending

### Implementation

Files to create/modify:
- `src/analysis/jl/drift-calculator.ts` (new): exports `DriftCalculator` class
  - `compare(archJson1: ArchJSON, archJson2: ArchJSON, opts?: DriftOptions): DriftReport`
  - Internal: calls `EntityAligner.align()`, builds aligned adjacency rows for
    E_shared using `AdjacencyBuilder.buildAlignedRow()`, selects DIRECT/JL mode
    based on N_union threshold (1000), computes L2 distances, classifies severity,
    computes delta signals
  - `classifyDrift(score: number): DriftLevel` (exported for reuse)
  - `computeK(nUnion: number, epsilon: number): number` (exported, epsilon default 0.3)
- `src/analysis/jl/types.ts` (modify): add `DriftOptions` interface
  `{ topK?: number; minLevel?: DriftLevel; driftThresholds?: [number,number,number] }`

### DoD
- [ ] `npm test -- --run tests/unit/analysis/jl/drift-calculator.test.ts`
- [ ] `npm test -- --run tests/unit/analysis/jl/`
- [ ] `npm run type-check`

---

## Phase C: CLI --drift-base and --drift-threshold flags

### Tests (write first)

File: `tests/unit/cli/commands/analyze-drift.test.ts`

Test cases:
- `parseDriftOptions()` with `--drift-threshold 3.0` → `{ threshold: 3.0 }`
- `parseDriftOptions()` with no drift flags → `{ threshold: undefined, base: undefined }`
- `determineDriftExitCode(report, 3.0)` with 0 critical entities → returns 0
- `determineDriftExitCode(report, 3.0)` with 1 critical entity (drift=4.0) → returns 1
- `determineDriftExitCode(report, 1.5)` with significant entity (drift=2.0) → returns 1
- No baseline snapshot present → function returns `{ noBaseline: true }`,
  exit code 0, prints "no baseline available"
- Invalid commit sha (non-existent) → error result with exit code 2

### Implementation

Files to create/modify:
- `src/cli/commands/analyze.ts` (modify): add `--drift-base <commit>` and
  `--drift-threshold <number>` options to the analyze command; after `--arch-health`
  processing, if `driftBase` is set, resolve baseline snapshot from
  `arch-health-history.json` by commitSha, call `DriftCalculator.compare()`,
  print formatted drift report, apply exit code logic
- `src/cli/utils/drift-reporter.ts` (new): `formatDriftReport(report: DriftReport): string`
  — renders the CLI output table (Critical / Significant / Moderate sections, summary line)
- `src/analysis/jl/drift-exit-code.ts` (new): `determineDriftExitCode(report, threshold): number`

### DoD
- [ ] `npm test -- --run tests/unit/cli/commands/analyze-drift.test.ts`
- [ ] `npm test -- --run tests/unit/analysis/jl/`
- [ ] `npm run type-check`

---

## Phase D: MCP tool archguard_get_architecture_drift

### Tests (write first)

File: `tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts`

Test cases:
- Tool registered with name `archguard_get_architecture_drift`
- Input `{ topK: 5, minLevel: 'moderate' }` → calls DriftCalculator with correct opts;
  result contains `hasBreakingDrift`, `breakingEntities`, `report` keys
- Input `{ fromCommit: 'abc1234' }` → resolver looks up snapshot by commitSha;
  when not found → returns structured error `{ error: 'snapshot not found', commitSha }`
- Input `{ fromCommit: 'HEAD~1' }` with no history → returns
  `{ error: 'no baseline available' }`
- `hasBreakingDrift` is true when report has critical-level entities, false otherwise
- `breakingEntities` lists only entity IDs at or above default threshold (3.0)
- Schema validation: `topK` defaults to 10 when omitted; `minLevel` defaults to 'stable'

### Implementation

Files to create/modify:
- `src/cli/mcp/tools/arch-health-tools.ts` (modify, once TASK-17 creates it):
  append `archguard_get_architecture_drift` tool handler
  - Resolves `fromCommit` / `toCommit` from `arch-health-history.json` snapshots
  - Calls `DriftCalculator.compare()` with `topK` and `minLevel` options
  - Returns `{ report, hasBreakingDrift, breakingEntities }`
- `src/cli/mcp/server.ts` (modify): register `archguard_get_architecture_drift`
  alongside other arch-health tools

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts`
- [ ] `npm test -- --run tests/unit/analysis/jl/`
- [ ] `npm run type-check`

---

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `node dist/cli/index.js analyze --help | grep -q 'drift-base'`
- [ ] `node dist/cli/index.js analyze --help | grep -q 'drift-threshold'`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved after self-review. All 5 criteria passed. Proceeding to plan draft.

Plan self-review APPROVED (iteration 1). premise-ledger: [E] goal coverage: 5 goals mapped to Phase A/B/C/D; [E] TDD structure: each phase has Tests+Implementation+DoD in order; [E] DoD executability: all items are shell commands; [E] acceptance gate: first item is npm test; [C] file paths: src/cli/commands/analyze.ts and src/cli/mcp/ confirmed to exist; src/analysis/jl/ depends on TASK-17 (constraint documented); [H] threshold adequacy: 0.5/1.5/3.0 empirical, acknowledged in constraints. GCL-self-report: E=4 C=1 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/analysis/jl/entity-aligner.test.ts
- [ ] #2 npm test -- --run tests/unit/analysis/jl/drift-calculator.test.ts
- [ ] #3 npm test -- --run tests/unit/cli/commands/analyze-drift.test.ts
- [ ] #4 npm test -- --run tests/unit/cli/mcp/tools/arch-health-drift-tool.test.ts
- [ ] #5 npm test -- --run tests/unit/analysis/jl/
- [ ] #6 npm run type-check
- [ ] #7 npm test
- [ ] #8 node dist/cli/index.js analyze --help | grep -q 'drift-base'
- [ ] #9 node dist/cli/index.js analyze --help | grep -q 'drift-threshold'
<!-- DOD:END -->
