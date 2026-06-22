# Plan 52 — Architecture Metrics Observatory

> Proposal: `docs/proposals/proposal-architecture-metrics-observatory.md`
> Status: Draft
> Priority: MEDIUM (standardizes existing metrics, adds temporal comparison and CI fitness checks)
> Estimated total changes: ~680 lines source + ~500 lines test

---

## Overview

Standardize ArchGuard's existing architecture metrics into a fixed-schema metric
vector, persist snapshots for temporal comparison, and provide architecture fitness
functions for CI integration. This plan covers proposal Components A, B, and D.
Component C (cross-project baselines) and PCA analysis (proposal Phase 3-4) are deferred to a future plan.

**Component-to-Phase mapping** (proposal letter -> plan phase):
- Proposal Component A (Metric Vector) -> Plan Phase A
- Proposal Component B (Snapshots + Diff) -> Plan Phase B
- Proposal Component D (Fitness Functions) -> Plan Phase C
- Proposal Component C (Cross-Project Baselines) + PCA -> Plan Phase D (future)

The key insight from the FIM experiment (`docs/spikes/fim-experiment-report.md`) is
that ArchGuard's practical value comes from established SE heuristics already
implemented: coupling metrics, cycle detection, package statistics, and test coverage.
This plan standardizes their output and makes them actionable over time.

### Delivery phases

| Phase | Scope | Gate |
|-------|-------|------|
| **A** | Metric vector type + Gini utility + assembly from existing data + pipeline wiring | Unit tests pass; `analyze` emits `metricVector` in ArchJSON |
| **B** | Snapshot persistence + `archguard diff` command + schema versioning | Snapshots written/read correctly; diff computes deltas with version mismatch handling |
| **C** | Fitness rules in config + `archguard check` command + CI exit codes | Rules parsed; threshold and dependency constraint checks produce correct pass/fail; exit code 1 on violation |
| **D** | Future: cross-project baselines (Component C) + PCA for GIT hypothesis | Out of scope for this plan |

---

## Phase A — Metric Vector

**Depends on**: Nothing (uses existing types and data)
**Estimated lines**: ~250 source + ~200 test
**Files**:
- `src/types/metric-vector.ts` (new)
- `src/analysis/metric-vector-builder.ts` (new)
- `src/analysis/gini.ts` (new)
- `src/types/index.ts` (modify: add `metricVector` field to `ArchJSON`)
- `src/cli/commands/analyze.ts` (modify: wire metric vector into pipeline)
- `tests/unit/analysis/gini.test.ts` (new)
- `tests/unit/analysis/metric-vector-builder.test.ts` (new)

### Stage A1 — Gini coefficient utility (~20 lines source + ~40 lines test)

**File**: `src/analysis/gini.ts` (new, ~20 lines)

Implement `giniCoefficient(values: number[]): number`:
- Standard Gini formula: `G = (2 * sum(i * sorted[i])) / (n * sum(sorted)) - (n+1)/n`
- Returns 0 for empty or all-zero arrays
- Returns value in [0, 1]

**File**: `tests/unit/analysis/gini.test.ts` (new)

Tests (TDD):
1. All equal values -> Gini = 0
2. Single value -> Gini = 0
3. Empty array -> Gini = 0
4. Maximum inequality [0, 0, 0, 100] -> Gini close to 0.75 (3/4)
5. Known distribution [1, 2, 3, 4, 5] -> Gini = 0.2667 (verified by hand)
6. All zeros -> Gini = 0

**Acceptance criteria**:
- All 6 tests pass
- Function is pure, no side effects, no dependencies

---

### Stage A2 — MetricVector type definition (~50 lines source)

**File**: `src/types/metric-vector.ts` (new, ~50 lines)

Define the fixed-schema metric vector. This extends the proposal's metric list with
`totalEntities`, `maxOutDegree`, `relationTypeBreakdown`, and `packageCount` which
are trivially derivable from existing data and improve vector completeness (see
proposal RN-10):

```typescript
export interface MetricVector {
  /** Schema version for forward/backward compatibility */
  schemaVersion: 1;

  // --- Global metrics (from ArchJSONMetrics) ---
  totalEntities: number;
  totalRelations: number;
  inferredRelationRatio: number;
  /** Non-trivial SCCs (size > 1), i.e. ArchJSONMetrics.cycles.length */
  sccCount: number;
  /** Relation type breakdown (from ArchJSONMetrics.relationTypeBreakdown) */
  relationTypeBreakdown: Partial<Record<RelationType, number>>;

  // --- Derived global metrics (new computations) ---
  maxInDegree: number;
  maxOutDegree: number;
  maxPackageSize: number;
  giniInDegree: number;
  giniPackageSize: number;

  // --- Package summary ---
  packageCount: number;

  // --- Optional metrics (present only with --include-tests) ---
  entityCoverageRatio?: number | null;
}
```

**File**: `src/types/index.ts` (modify, ~3 lines)

Add `metricVector?: MetricVector` field to the `ArchJSON` interface.
Import and re-export `MetricVector` from `metric-vector.ts`.

**Acceptance criteria**:
- Type-check passes (`npm run type-check`)
- MetricVector importable from `@/types`

---

### Stage A3 — MetricVectorBuilder (~80 lines source + ~100 lines test)

**File**: `src/analysis/metric-vector-builder.ts` (new, ~80 lines)

Implement `buildMetricVector(archJson: ArchJSON, packageStats: PackageStatEntry[]): MetricVector`:
- Extract `totalEntities` from `archJson.metrics.entityCount`, `totalRelations` from `archJson.metrics.relationCount`, `inferredRelationRatio` from `archJson.metrics.inferredRelationRatio`
- Derive `sccCount` = `(archJson.metrics?.cycles ?? []).length` (non-trivial SCCs only; `cycles` is optional and contains only size>1 entries)
- Extract `relationTypeBreakdown` from `archJson.metrics.relationTypeBreakdown`
- Compute `maxInDegree` = max of `archJson.metrics.fileStats[].inDegree` (0 if no fileStats)
- Compute `maxOutDegree` = max of `archJson.metrics.fileStats[].outDegree` (0 if no fileStats)
- Compute `maxPackageSize` = max of `packageStats[].fileCount` (0 if empty)
- Compute `giniInDegree` = `giniCoefficient(fileStats.map(f => f.inDegree))` (0 if no fileStats)
- Compute `giniPackageSize` = `giniCoefficient(packageStats.map(p => p.fileCount))`
- Extract `entityCoverageRatio` from `archJson.extensions?.testAnalysis?.metrics?.entityCoverageRatio` (null if absent)
- Set `packageCount` = `packageStats.length`
- Set `schemaVersion` = 1

**Note**: `archJson.metrics` is optional (`metrics?: ArchJSONMetrics`) and `metrics.fileStats` is optional (`fileStats?: FileStats[]`). The builder must guard against both being undefined with sensible defaults (0 for counts, empty breakdown, etc.).

Sources of input data:
- `archJson.metrics` — existing `ArchJSONMetrics` from `src/types/index.ts` (optional, absent for non-json formats)
- `archJson.metrics.fileStats` — existing `FileStats[]` from `src/types/index.ts` (optional, absent at package level)
- `packageStats` — from `QueryEngine.getPackageStats()` in `src/cli/query/query-engine.ts`
- `archJson.extensions?.testAnalysis` — from `src/types/extensions/test-analysis.ts`

**File**: `tests/unit/analysis/metric-vector-builder.test.ts` (new)

Tests (TDD):
1. Minimal ArchJSON with 3 entities, 2 relations, known fileStats -> correct vector
2. No fileStats (package-level, `metrics.fileStats` undefined) -> maxInDegree = 0, giniInDegree = 0
3. Empty packageStats -> maxPackageSize = 0, packageCount = 0
4. With test analysis extension -> entityCoverageRatio populated
5. Without test analysis extension -> entityCoverageRatio = null
6. SccCount derived from `(metrics.cycles ?? []).length`, not stronglyConnectedComponents count
7. Known inDegree distribution [0, 2, 4, 10] -> correct Gini value
8. Known package sizes [5, 5, 5] -> Gini = 0
9. `archJson.metrics` is undefined -> all global metrics default to 0

**Acceptance criteria**:
- All 9 tests pass
- MetricVector matches expected values for hand-computed inputs
- No dependency on filesystem or CLI — pure function

---

### Stage A4 — Wire into analyze pipeline (~100 lines source + ~60 lines test)

**File**: `src/cli/commands/analyze.ts` (modify, ~60 lines)

After ArchJSON aggregation completes (post-MetricsCalculator), before output:
1. Instantiate `QueryEngine` from the aggregated ArchJSON (already done in some paths)
2. Call `queryEngine.getPackageStats()` to obtain `PackageStatEntry[]`
3. Call `buildMetricVector(archJson, packageStats)` to produce the vector
4. Attach to `archJson.metricVector = vector`
5. If `--verbose`, print a summary table to console (sccCount, maxInDegree, giniInDegree, giniPackageSize, packageCount)
6. MetricVector is included in JSON output automatically (it is on the ArchJSON object)

**File**: `src/cli/processors/diagram-processor.ts` (modify, ~40 lines)

In the ArchJSON aggregation path, ensure the metric vector is computed and attached
for each source group's ArchJSON before it is written to disk.

**Tests**: `tests/unit/analysis/metric-vector-builder.test.ts` (extend, ~60 lines)

Integration-style tests:
1. Synthetic ArchJSON through buildMetricVector -> all fields populated
2. schemaVersion is always 1
3. Pipeline wiring: mock analyze flow produces ArchJSON with metricVector present

**Acceptance criteria**:
- All tests pass
- `npm run build && node dist/cli/index.js analyze -f json -v` on ArchGuard self produces ArchJSON with `metricVector` field
- Existing tests unaffected (no regression)

---

## Phase B — Snapshot Storage & Diff

**Depends on**: Phase A (MetricVector type required)
**Estimated lines**: ~200 source + ~160 test
**Files**:
- `src/analysis/snapshot-store.ts` (new)
- `src/analysis/snapshot-diff.ts` (new)
- `src/cli/commands/diff.ts` (new)
- `src/cli/index.ts` (modify: register diff command)
- `tests/unit/analysis/snapshot-store.test.ts` (new)
- `tests/unit/analysis/snapshot-diff.test.ts` (new)
- `tests/unit/cli/commands/diff.test.ts` (new)

### Stage B1 — Snapshot persistence (~70 lines source + ~60 lines test)

**File**: `src/analysis/snapshot-store.ts` (new, ~70 lines)

Define `MetricSnapshot` interface:
```typescript
export interface MetricSnapshot {
  schemaVersion: number;
  commitSha: string | null;
  branch: string | null;
  timestamp: string;        // ISO 8601
  archguardVersion: string;
  metricVector: MetricVector;
}
```

Implement:
1. `saveSnapshot(outputDir: string, snapshot: MetricSnapshot): Promise<void>`
   - Write to `.archguard/snapshots/<commitSha>-<timestamp>.json`
   - If commitSha is null, use `unknown-<timestamp>.json`
   - Create directory if needed
2. `loadSnapshots(outputDir: string): Promise<MetricSnapshot[]>`
   - Read all `.json` files from `.archguard/snapshots/`
   - Sort by timestamp DESC
3. `pruneSnapshots(outputDir: string, maxCount: number): Promise<number>`
   - Keep only the most recent `maxCount` snapshots
   - Return count of deleted files
4. `resolveCommitSha(): Promise<string | null>` — shell out to `git rev-parse HEAD`
5. `resolveBranch(): Promise<string | null>` — shell out to `git rev-parse --abbrev-ref HEAD`

**File**: `tests/unit/analysis/snapshot-store.test.ts` (new)

Tests (TDD):
1. Save snapshot creates file in correct directory
2. Save snapshot with null commitSha uses `unknown-` prefix
3. Load snapshots returns sorted by timestamp DESC
4. Load from empty directory returns empty array
5. Load from non-existent directory returns empty array
6. Prune keeps only maxCount most recent, returns deleted count

**Acceptance criteria**:
- All 6 tests pass
- Snapshot files are valid JSON, round-trip correctly

---

### Stage B2 — Diff computation (~60 lines source + ~50 lines test)

**File**: `src/analysis/snapshot-diff.ts` (new, ~60 lines)

Define `MetricDiff` interface:
```typescript
export interface MetricDiffEntry {
  metric: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  percentChange: number | null;
}

export interface MetricDiffResult {
  fromCommit: string | null;
  toCommit: string | null;
  fromTimestamp: string;
  toTimestamp: string;
  schemaVersionMismatch: boolean;
  entries: MetricDiffEntry[];
  warnings: string[];
}
```

Implement `diffSnapshots(from: MetricSnapshot, to: MetricSnapshot): MetricDiffResult`:
- Compare every numeric field in MetricVector
- If schemaVersions differ, only compare the intersection of fields and add warning
- Compute delta (to - from) and percentChange ((to - from) / from * 100)
- Handle null/undefined fields: delta = null when either side is null
- Omit non-numeric fields (relationTypeBreakdown compared separately as string summary)

**File**: `tests/unit/analysis/snapshot-diff.test.ts` (new)

Tests (TDD):
1. Identical snapshots -> all deltas = 0
2. Known changes: sccCount 3->1, maxInDegree 15->12 -> correct deltas and percentChange
3. Schema version mismatch: v1 vs v2 -> schemaVersionMismatch = true, warning added
4. Field present in `to` but not `from` -> delta = null with warning
5. from value is 0 -> percentChange = null (avoid division by zero)

**Acceptance criteria**:
- All 5 tests pass
- Diff handles schema mismatches gracefully

---

### Stage B3 — `archguard diff` CLI command (~70 lines source + ~50 lines test)

**File**: `src/cli/commands/diff.ts` (new, ~70 lines)

Implement `archguard diff` command (Commander):
- Options: `--from <sha>`, `--to <sha>`, `--output-dir <dir>` (default `.archguard`)
- Behavior:
  1. Load snapshots from `.archguard/snapshots/`
  2. Resolve `--from` and `--to` to snapshots (by commitSha prefix match)
  3. If `--to` omitted, use most recent snapshot
  4. If `--from` omitted, use second most recent snapshot
  5. If fewer than 2 snapshots, print error and exit
  6. Call `diffSnapshots(from, to)` and print table to stdout
  7. Highlight metrics that changed by more than 10% (configurable threshold)

**File**: `src/cli/index.ts` (modify, ~5 lines)

Register the `diff` subcommand (add import + `program.addCommand(createDiffCommand())`).

**File**: `tests/unit/cli/commands/diff.test.ts` (new)

Tests:
1. Two snapshots available -> prints diff table
2. Fewer than 2 snapshots -> prints error message
3. `--from` resolves by SHA prefix
4. Schema version mismatch -> prints warning

**Acceptance criteria**:
- All 4 tests pass
- `node dist/cli/index.js diff` works after two analyze runs
- Human-readable table output

---

### Stage B4 — Auto-snapshot after analyze (~30 lines source, no new tests)

**File**: `src/cli/commands/analyze.ts` (modify, ~30 lines)

After metric vector is computed (Stage A4), automatically:
1. Resolve commitSha and branch via `resolveCommitSha()` / `resolveBranch()`
2. Build `MetricSnapshot` with current metricVector, timestamp, archguard version
3. Call `saveSnapshot(outputDir, snapshot)`
4. Call `pruneSnapshots(outputDir, retentionLimit)` with configurable limit (default 100)
5. If `--verbose`, print "Snapshot saved: <path>"

Tested via Stage B1 unit tests + manual E2E validation.

**Acceptance criteria**:
- After `analyze`, a snapshot file appears in `.archguard/snapshots/`
- Existing tests unaffected

---

## Phase C — Fitness Functions

**Depends on**: Phase A (MetricVector for threshold checks), Phase B (snapshot for trend rules, optional)
**Estimated lines**: ~200 source + ~140 test
**Files**:
- `src/analysis/fitness/rule-types.ts` (new)
- `src/analysis/fitness/rule-evaluator.ts` (new)
- `src/analysis/fitness/dependency-checker.ts` (new)
- `src/cli/commands/check.ts` (new)
- `src/cli/index.ts` (modify: register check command)
- `src/types/config-global.ts` (modify: add fitness config)
- `tests/unit/analysis/fitness/rule-evaluator.test.ts` (new)
- `tests/unit/analysis/fitness/dependency-checker.test.ts` (new)
- `tests/unit/cli/commands/check.test.ts` (new)

### Stage C1 — Fitness rule types and config schema (~40 lines source)

**File**: `src/analysis/fitness/rule-types.ts` (new, ~40 lines)

```typescript
export type ComparisonOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface MetricThresholdRule {
  type?: 'metric';       // default
  metric: string;        // key from MetricVector (e.g. 'sccCount', 'maxInDegree')
  op: ComparisonOp;
  value: number;
  message: string;
}

export interface DependencyConstraintRule {
  type: 'no-dependency';
  from: string;          // glob pattern (e.g. 'src/parser/**')
  to: string;            // glob pattern (e.g. 'src/cli/**')
  message: string;
}

export type FitnessRule = MetricThresholdRule | DependencyConstraintRule;

export interface FitnessConfig {
  rules: FitnessRule[];
  failOnViolation: boolean;
}

export interface RuleResult {
  rule: FitnessRule;
  passed: boolean;
  actual?: number | string;
  detail?: string;
}
```

**File**: `src/types/config-global.ts` (modify, ~5 lines)

Add optional `fitness?: FitnessConfig` to `GlobalConfig`.

**Acceptance criteria**:
- Type-check passes
- FitnessConfig importable from both `@/analysis/fitness/rule-types` and via config

---

### Stage C2 — Metric threshold evaluator (~50 lines source + ~50 lines test)

**File**: `src/analysis/fitness/rule-evaluator.ts` (new, ~50 lines)

Implement `evaluateMetricRule(rule: MetricThresholdRule, vector: MetricVector): RuleResult`:
- Look up `rule.metric` as a key on MetricVector
- If the key does not exist, return `{ passed: false, detail: 'Unknown metric' }`
- If the value is null (e.g. entityCoverageRatio without --include-tests), return `{ passed: false, detail: 'Metric not available' }`
- Apply comparison operator and return RuleResult

Implement `evaluateAllRules(rules: FitnessRule[], vector: MetricVector, relations: Relation[]): RuleResult[]`:
- Dispatch metric rules to `evaluateMetricRule`
- Dispatch dependency rules to `checkDependencyConstraint` (Stage C3)

**File**: `tests/unit/analysis/fitness/rule-evaluator.test.ts` (new)

Tests (TDD):
1. sccCount <= 0 with sccCount=0 -> passed
2. sccCount <= 0 with sccCount=2 -> failed, actual=2
3. maxInDegree < 20 with maxInDegree=15 -> passed
4. maxInDegree < 20 with maxInDegree=25 -> failed, actual=25
5. All 6 comparison operators work correctly
6. Unknown metric key -> failed with detail
7. Null metric value -> failed with detail

**Acceptance criteria**:
- All 7 tests pass
- Pure function, no side effects

---

### Stage C3 — Dependency constraint checker (~60 lines source + ~50 lines test)

**File**: `src/analysis/fitness/dependency-checker.ts` (new, ~60 lines)

Implement `checkDependencyConstraint(rule: DependencyConstraintRule, relations: Relation[]): RuleResult`:
- Use `micromatch` (already a project dependency) to test `rule.from` and `rule.to` globs
- For each relation in the ArchJSON, check if the relation's `source` entity ID matches `rule.from` AND the relation's `target` entity ID matches `rule.to`
- If any such relation exists, the rule fails
- Return RuleResult with detail listing the first violating relation (source -> target)

Source data: `ArchJSON.relations` from `src/types/index.ts` (each `Relation` has `source` and `target` entity IDs which encode file paths).

**File**: `tests/unit/analysis/fitness/dependency-checker.test.ts` (new)

Tests (TDD):
1. No matching relations -> passed
2. Relation from `src/parser/foo` to `src/cli/bar` with rule `no-dependency src/parser/** -> src/cli/**` -> failed
3. Relation within allowed boundary -> passed
4. Glob patterns with nested paths work correctly
5. Multiple violations -> detail mentions first one

**Acceptance criteria**:
- All 5 tests pass
- Uses existing micromatch for glob matching

---

### Stage C4 — `archguard check` CLI command (~50 lines source + ~40 lines test)

**File**: `src/cli/commands/check.ts` (new, ~50 lines)

Implement `archguard check` command (Commander):
- Options: `--config <path>` (default `archguard.config.json`), `--output-dir <dir>`
- Behavior:
  1. Load config file and extract `fitness.rules`
  2. If no fitness config, print "No fitness rules configured" and exit 0
  3. Load most recent snapshot from `.archguard/snapshots/` to get MetricVector
  4. If no snapshot exists, run metric vector computation from latest ArchJSON
  5. Load ArchJSON relations for dependency constraint checks
  6. Call `evaluateAllRules(rules, vector, relations)`
  7. Print results table: rule message, status (PASS/FAIL), actual value
  8. If any rule failed AND `failOnViolation: true`, exit with code 1
  9. Otherwise exit with code 0

**File**: `src/cli/index.ts` (modify, ~5 lines)

Register the `check` subcommand (add import + `program.addCommand(createCheckCommand())`).

**File**: `tests/unit/cli/commands/check.test.ts` (new)

Tests:
1. All rules pass -> exit 0
2. One rule fails with failOnViolation=true -> exit 1
3. One rule fails with failOnViolation=false -> exit 0
4. No fitness config -> exit 0 with informational message
5. Human-readable output includes rule message and actual value

**Acceptance criteria**:
- All 5 tests pass
- `node dist/cli/index.js check` works with configured fitness rules
- CI-friendly: exit code 1 on violation

---

## Phase D — Future (Out of Scope)

The following are deferred to a future plan (proposal Components C and GIT hypothesis testing):

- **Cross-project baselines**: anonymized metric collection, percentile distributions, `archguard baseline compare`
- **PCA analysis**: requires cross-project data; test whether 3-5 principal components explain >90% variance
- **Trend rules**: "metric X must not increase by more than Y% between snapshots" (requires Phase B maturity)
- **MCP tools for metric vector / fitness**: expose via MCP server for IDE integration

---

## Test Strategy

- **TDD**: All stages write tests before implementation
- **Coverage target**: >= 80% line coverage for `src/analysis/gini.ts`, `src/analysis/metric-vector-builder.ts`, `src/analysis/snapshot-store.ts`, `src/analysis/snapshot-diff.ts`, `src/analysis/fitness/`
- **Synthetic data**: Phases A-C use hand-crafted ArchJSON/MetricVector with known results
- **Self-validation**: After Phase A, `node dist/cli/index.js analyze -f json -v` on ArchGuard self must produce `metricVector`
- **Regression**: Existing 3141+ tests must continue passing
- **Determinism**: All unit tests are deterministic (no randomness, no filesystem race conditions)

---

## Dependency Summary

```
Stage A1 (Gini utility)
  └→ Stage A2 (MetricVector type)
       └→ Stage A3 (MetricVectorBuilder) ──────────┐
            └→ Stage A4 (pipeline wiring) ─────────┤
                                                    ├→ B4 (auto-snapshot after analyze)
Stage B1 (snapshot persistence) ───────────────────┤
  └→ Stage B2 (diff computation) ──────────────────┤
       └→ Stage B3 (diff CLI command) ─────────────┘

Stage C1 (rule types + config) ────────────────────┐
  └→ Stage C2 (metric threshold evaluator) ────────┤
  └→ Stage C3 (dependency constraint checker) ─────┤
       └→ Stage C4 (check CLI command) ────────────┘

Phase A required by: Phase B (B4), Phase C (C2 uses MetricVector)
Phase B1-B2 required by: Phase C4 (loads snapshot)
```

Phases A, B (B1-B3), and C (C1-C3) are partially parallelizable. B4 depends on A4.
C4 depends on C2, C3, and B1 (snapshot loading).

---

## Line Budget Summary

| Stage | Source lines | Test lines | Total |
|-------|-------------|------------|-------|
| A1    | ~20         | ~40        | ~60   |
| A2    | ~50         | 0          | ~50   |
| A3    | ~80         | ~100       | ~180  |
| A4    | ~100        | ~60        | ~160  |
| B1    | ~70         | ~60        | ~130  |
| B2    | ~60         | ~50        | ~110  |
| B3    | ~70         | ~50        | ~120  |
| B4    | ~30         | 0          | ~30   |
| C1    | ~40         | 0          | ~40   |
| C2    | ~50         | ~50        | ~100  |
| C3    | ~60         | ~50        | ~110  |
| C4    | ~50         | ~40        | ~90   |
| **Total** | **~680** | **~500** | **~1180** |

Phase A: ~450 lines. Phase B: ~390 lines. Phase C: ~340 lines.
Each phase is within 500 lines. Each stage is well under 200 lines.

---

## References

- `docs/proposals/proposal-architecture-metrics-observatory.md` — source proposal
- `docs/spikes/fim-experiment-report.md` — FIM experiment results (P5 refuted with runtime coverage)
- `src/types/index.ts` — `ArchJSON`, `ArchJSONMetrics`, `FileStats`, `CycleInfo`
- `src/types/config-global.ts` — `GlobalConfig`, `ArchGuardConfig`
- `src/types/extensions/index.ts` — `ArchJSONExtensions`
- `src/types/extensions/test-analysis.ts` — `TestAnalysis`, `TestMetrics`
- `src/cli/query/query-engine.ts` — `PackageStatEntry`, `PackageStatsResult`, `QueryEngine.getPackageStats()`
- `src/cli/commands/analyze.ts` — analyze pipeline integration point
- `src/cli/processors/diagram-processor.ts` — ArchJSON aggregation
- `src/cli/index.ts` — CLI entry point, command registration
- `src/analysis/fim/` — existing FIM code (demoted to experimental, not modified by this plan)

---

## Review Notes (2026-03-30)

### RN-1: Relation field names were wrong (FIXED)

Stage C3 referenced `Relation.from` and `Relation.to` but the actual interface in `src/types/index.ts` uses `source` and `target`. Fixed in Stage C3 description.

### RN-2: Command registration file was wrong (FIXED)

Stages B3 and C4 referenced `src/cli/commands/index.ts` for command registration. No such file exists; commands are registered in `src/cli/index.ts` via `program.addCommand()`. Fixed in both stages and file lists.

### RN-3: MetricVector.relationTypeBreakdown type was imprecise (FIXED)

The MetricVector type definition used `Partial<Record<string, number>>` but the source type `ArchJSONMetrics.relationTypeBreakdown` uses `Partial<Record<RelationType, number>>`. Fixed to match.

### RN-4: ArchJSON.metrics is optional — builder must handle undefined (FIXED)

`archJson.metrics` is `metrics?: ArchJSONMetrics` (optional) and `metrics.fileStats` is `fileStats?: FileStats[]` (optional). The builder description and test list now account for both being undefined. Added test case 9.

### RN-5: sccCount derivation was underspecified (FIXED)

The builder step said "Extract `sccCount` from `archJson.metrics`" but there is no `sccCount` field on `ArchJSONMetrics`. The correct derivation is `(archJson.metrics?.cycles ?? []).length`. Note that `cycles` contains only non-trivial (size>1) SCCs, which is the intended semantics. Fixed.

### RN-6: Header line estimate inconsistent with budget table (FIXED)

Header said ~650 source lines, budget table totals ~680. Fixed header to match.

### RN-7: Proposal-to-plan component mapping was implicit (FIXED)

The proposal defines Components A-D and Phases 1-4. The plan uses Phases A-D with different letter assignments (proposal Component D = plan Phase C). Added explicit mapping table.

### RN-8: All code references verified against codebase

Verified the following exist and match documented signatures:
- `ArchJSONMetrics`, `FileStats`, `CycleInfo` in `src/types/index.ts` -- confirmed
- `PackageStatEntry`, `PackageStatsResult`, `QueryEngine.getPackageStats()` in `src/cli/query/query-engine.ts` -- confirmed
- `src/analysis/fim/` contains 8 files (fim-builder.ts, mantel-test.ts, cochange-matrix-builder.ts, coverage-parser.ts, types.ts, fim-analysis.ts, fim-artifacts.ts, fim-snapshot.ts) -- confirmed
- `GlobalConfig` in `src/types/config-global.ts` has no `fitness` field yet -- confirmed (to be added in Stage C1)
- `TestMetrics.entityCoverageRatio` in `src/types/extensions/test-analysis.ts` -- confirmed
- `ArchJSONExtensions.testAnalysis` in `src/types/extensions/index.ts` -- confirmed
- `Relation` interface has `source`/`target` (not `from`/`to`) -- confirmed and fixed above

### RN-9: Line count estimates are realistic

Compared against similar existing code:
- `gini.ts` at ~20 lines: comparable to single-function utilities in the codebase
- `metric-vector-builder.ts` at ~80 lines: similar scope to `test-coverage-mapper.ts` (130 lines), reasonable
- `snapshot-store.ts` at ~70 lines: similar to `cache.ts` CLI command (84 lines), reasonable
- `diff.ts` CLI at ~70 lines: similar to `init.ts` (43 lines) + more logic, reasonable
- `rule-evaluator.ts` at ~50 lines: pure evaluator, reasonable
- FIM files for reference: fim-builder.ts (262 lines), mantel-test.ts (267 lines) -- the plan stages are all well under these

### RN-10: Web search validation results

- **Architecture fitness functions**: Confirmed as established pattern. Key implementations: ArchUnit (Java), NetArchTest (.NET), dependency-cruiser (JS/TS). The proposal's design aligns with standard patterns (config-based rules, CI exit codes, metric thresholds + dependency constraints).
- **dependency-cruiser**: Confirmed at github.com/sverweij/dependency-cruiser. Validates and visualizes dependencies in JS/TS. Detects circular dependencies, orphans, missing package.json entries. Operates on import-level dependency graphs only -- proposal's characterization is accurate.
- **PCA on OO metrics**: IEEE 2014 paper (Mishra et al.) confirmed: 12 OO metrics reduce to ~4 dimensions via PCA/PAF. Tang & Kao (METRICS 1999) confirmed: PCA and correlation analysis on CK metrics. Subramanyam & Krishnan (IEEE TSE 2003) confirmed but is about defect prediction, NOT about PCA dimensionality -- proposal citation was corrected.
