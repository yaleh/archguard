# Plan 50 — Coverage-Based Fisher Information Matrix

> Proposal: `docs/proposals/proposal-coverage-fisher-information.md` (v3)
> Spike: `scripts/fim-experiment.mjs`, `docs/spikes/fim-experiment-report.md`
> Status: Draft
> Priority: MEDIUM (new analytical capability, no existing functionality affected)
> Estimated total changes: ~720 lines source + ~530 lines test

---

## Overview

Construct a Fisher Information Matrix (FIM) from test coverage data and expose it
through CLI flags and MCP tools. The FIM provides mathematically grounded metrics
for architecture health: condition number kappa, effective dimension N_eff,
fragility hotspots (uncovered files), and Mantel test validation of co-change as
a FIM proxy.

The spike experiment (`docs/spikes/fim-experiment-report.md`) confirmed:
- P5: Co-change IS a statistically significant FIM proxy (Mantel r=0.77, p=0.01)
- Import approximation is reliable at package level but NOT at file level
- Phase 1 scope is therefore limited to package-level analysis

### Key design constraints from the proposal

- **File-level granularity for Phase 1**: Coverage matrix C is T x F (tests x files),
  binary. FIM I = C^T C is guaranteed positive semi-definite.
- **Import approximation only in Phase 1**: Reuses existing TestCoverageMapper import
  analysis. File-level FIM results must be clearly labeled as approximate.
- **Package-level aggregation**: C_pkg = clamp(C x G, 0, 1) where G is file-to-package
  indicator matrix. Package diagonal I_pkg[p][p] = number of tests covering at least
  one file in package p (not the sum of file-level I_ii).
- **ml-matrix dependency**: Required for SVD. Not currently installed.
- **Co-change full matrix**: Existing `buildCochangeIndex()` only stores top-10
  neighbors. Mantel test requires a full F x F Jaccard matrix rebuilt from commits.
- **`--fim` is opt-in**: Default behavior unchanged. No impact on existing workflows.

### Delivery phases

| Phase | Scope | Gate |
|-------|-------|------|
| **A** | Types + coverage matrix + FIM builder + snapshot | Unit tests pass; `computeFisherInformation` produces correct results on synthetic data |
| **B** | Mantel test + co-change full matrix builder | Mantel test passes on identical matrices (r=1), fails on random; co-change matrix builder produces symmetric Jaccard matrix |
| **C** | CLI integration (`--fim`, `--fim-validate`) + MCP tool | E2E: `--fim` produces `.archguard/query/fim/` output; MCP tool returns structured JSON |

---

## Phase A — Core FIM Infrastructure

**Depends on**: Nothing (greenfield)
**Estimated lines**: ~300 source + ~250 test
**Files**:
- `src/analysis/fim/types.ts` (new)
- `src/analysis/fim/coverage-parser.ts` (new)
- `src/analysis/fim/fim-builder.ts` (new)
- `src/analysis/fim/fim-snapshot.ts` (new)
- `tests/unit/analysis/fim/coverage-parser.test.ts` (new)
- `tests/unit/analysis/fim/fim-builder.test.ts` (new)
- `tests/unit/analysis/fim/fim-snapshot.test.ts` (new)
- `package.json` (modify: add `ml-matrix`)

### Stage A1 — Install ml-matrix and define types (~40 lines)

**File**: `package.json` — add `"ml-matrix": "^6.12.0"` to dependencies

**File**: `src/analysis/fim/types.ts` (new, ~40 lines)

Define all shared types:

```typescript
export interface CoverageMatrix {
  matrix: number[][];   // T x F binary (0 or 1)
  testIds: string[];    // length T
  fileIds: string[];    // length F
}

export interface FisherInformationResult {
  eigenvalues: number[];
  conditionNumber: number;
  effectiveDimension: number;
  fileCount: number;
  testCount: number;
  diagonal: { fileId: string; selfInfo: number }[];
  uncoveredFiles: string[];
  fragilityHotspots: { fileId: string; selfInfo: number; crb: number }[];
}

export interface FIMSnapshot {
  timestamp: string;
  commitSha?: string;
  source: 'import-approximation' | 'per-test-coverage' | 'mutation';
  fileCount: number;
  testCount: number;
  conditionNumber: number;
  effectiveDimension: number;
  topEigenvalueShares: number[];
  uncoveredFileCount: number;
  mantelCorrelation?: number;
  mantelPValue?: number;
}

export interface PackageFIM {
  matrix: number[][];
  packageNames: string[];
}
```

**Acceptance criteria**:
- Type-check passes (`npm run type-check`)
- `ml-matrix` installed and importable

---

### Stage A2 — Coverage matrix builder (~80 lines source + ~80 lines test)

**File**: `src/analysis/fim/coverage-parser.ts` (new)

Implement `buildCoverageMatrixFromImports()`:
- Accept test file list, source file list, and import graph (Map<string, Set<string>>)
- Produce binary CoverageMatrix where C[t][f] = 1 iff test t imports (directly or
  transitively) source file f
- Reuse import resolution logic pattern from TestCoverageMapper (import-layer)
- Test files must not appear in fileIds (column dimension)
- Transitive import depth capped at 3 (consistent with spike experiment)

**File**: `tests/unit/analysis/fim/coverage-parser.test.ts` (new)

Tests (TDD):
1. 3 tests, 5 sources, known imports -> exact C matrix match
2. Test file excluded from source columns
3. Test with no imports -> row is all zeros
4. Transitive imports: A imports B imports C -> A's row has 1 for both B and C
5. Circular imports do not cause infinite loop
6. Depth limit: import chain of depth 4 -> only first 3 hops included

**Acceptance criteria**:
- All 6 tests pass
- CoverageMatrix.matrix dimensions match T x F exactly
- No test file appears in fileIds

---

### Stage A3 — FIM builder with SVD (~130 lines source + ~120 lines test)

**File**: `src/analysis/fim/fim-builder.ts` (new)

Implement:
1. `computeGramMatrix(C: CoverageMatrix): number[][]` — I = C^T C
2. `computeFisherInformation(coverage: CoverageMatrix, fragilityThreshold?: number): FisherInformationResult`
   - Compute I = C^T C
   - Use `ml-matrix` SVD to extract eigenvalues (singular values squared)
   - Compute kappa = lambda_max / lambda_min (among non-zero eigenvalues)
   - Compute N_eff = (sum lambda)^2 / sum(lambda^2)
   - Extract diagonal (self-information per file)
   - Identify uncoveredFiles (I_ii = 0) and fragilityHotspots (0 < I_ii < threshold)
   - Default fragilityThreshold = 3
3. `aggregateToPackageLevel(coverage: CoverageMatrix, fileIds: string[], depth?: number): PackageFIM`
   - Build file-to-package indicator matrix G from fileIds (extract package from path)
   - Compute C_pkg = clamp(C x G, 0, 1) then I_pkg = C_pkg^T C_pkg
   - Requires the original coverage matrix C (not the FIM) for correct clamped aggregation

**File**: `tests/unit/analysis/fim/fim-builder.test.ts` (new)

Tests (TDD, matching proposal acceptance criteria 4-8, 12-13):
1. Identity C -> I = identity, kappa = 1, N_eff = F
2. All-ones C (T x F) -> rank-1 I, kappa = Infinity, N_eff = 1
3. Column of zeros -> that file in uncoveredFiles
4. All eigenvalues >= 0 (positive semi-definite)
5. diagonal[f] = L1 norm of column f in C
6. fragilityThreshold = 3: file with I_ii = 2 in fragilityHotspots, I_ii = 4 not
7. Package aggregation: 4 files in 2 packages -> 2x2 matrix
8. Package diagonal = tests covering at least one file in package (clamped, not summed)

**Acceptance criteria**:
- All 8 tests pass
- `ml-matrix` SVD produces correct eigenvalues on synthetic data
- Eigenvalues are all non-negative

---

### Stage A4 — Snapshot storage (~50 lines source + ~50 lines test)

**File**: `src/analysis/fim/fim-snapshot.ts` (new)

Implement:
1. `appendFIMSnapshot(outputDir: string, snapshot: FIMSnapshot): Promise<void>`
   - Read existing `fim-history.json` from `<outputDir>/query/fim/`
   - Append new snapshot
   - Write back (create directory if needed)
2. `readFIMHistory(outputDir: string): Promise<FIMSnapshot[]>`

**File**: `tests/unit/analysis/fim/fim-snapshot.test.ts` (new)

Tests:
1. Append to empty file -> creates file with 1 entry
2. Append to existing file -> file has 2 entries
3. Read from non-existent file -> returns empty array
4. source field preserved correctly

**Acceptance criteria**:
- All 4 tests pass
- File written to `.archguard/query/fim/fim-history.json`
- Proposal acceptance criteria 14-15 satisfied

---

## Phase B — Mantel Test and Co-Change Matrix

**Depends on**: Phase A (types only — A1 sufficient for B1 and B2)
**Estimated lines**: ~200 source + ~160 test
**Files**:
- `src/analysis/fim/mantel-test.ts` (new)
- `src/analysis/fim/cochange-matrix-builder.ts` (new)
- `tests/unit/analysis/fim/mantel-test.test.ts` (new)
- `tests/unit/analysis/fim/cochange-matrix-builder.test.ts` (new)

### Stage B1 — Mantel test implementation (~80 lines source + ~80 lines test)

**File**: `src/analysis/fim/mantel-test.ts` (new)

Define `MantelTestResult` interface (co-located, not in types.ts since it's B1-specific):
```typescript
export interface MantelTestResult {
  observedCorrelation: number;
  permutations: number;
  pValue: number;
  isValidProxy: boolean;  // p < 0.05
}
```

Implement:
1. `normalizeMatrix(M: number[][]): number[][]` — row/column standardization
2. `upperTriCorrelation(A: number[][], B: number[][]): number` — Pearson correlation
   on strict upper-triangular elements (excluding diagonal)
3. `mantelTest(fimMatrix, cochangeMatrix, options?): MantelTestResult`
   - Default 999 permutations
   - Row+column simultaneous permutation of one matrix
   - p = (count(r_perm >= r_obs) + 1) / (N + 1)
   - Optional `seed` parameter for reproducibility
   - Return `MantelTestResult` with observedCorrelation, permutations, pValue, isValidProxy

Port the algorithm from `scripts/fim-experiment.mjs` (lines 194-248) into typed,
tested TypeScript. Use Spearman rank correlation (rank transform before Pearson)
as recommended by the proposal to handle value-range misalignment between
coverage FIM (integers) and Jaccard co-change ([0,1]).

**File**: `tests/unit/analysis/fim/mantel-test.test.ts` (new)

Tests (TDD, matching proposal acceptance criteria 9-11):
1. Identical matrices -> r = 1.0, p < 0.05
2. FIM vs random matrix -> p > 0.05 (with fixed seed for determinism)
3. Fixed seed produces identical p-value across two runs
4. Empty matrix (0x0) -> graceful handling (r = 0, p = 1)
5. Asymmetric input rejected (throw)
6. Mismatched dimensions rejected (throw)

**Acceptance criteria**:
- All 6 tests pass
- Mantel test on identical 5x5 matrices: r = 1.0, p < 0.002

---

### Stage B2 — Full co-change matrix builder (~120 lines source + ~80 lines test)

**File**: `src/analysis/fim/cochange-matrix-builder.ts` (new)

Implement `buildFullCochangeMatrix(commits, fileIds): number[][]`:
- Accept `CommitRecord[]` (from existing git history types) and a list of fileIds
  to define the matrix dimension and ordering
- For each pair (i, j), compute Jaccard similarity:
  joint(i,j) / (commits(i) + commits(j) - joint(i,j))
- Output symmetric F x F matrix with diagonal = 1
- No top-N truncation (unlike existing `buildCochangeIndex`)
- For package-level: accept a `packageNames` list and aggregate commits to package
  level before computing Jaccard

Also implement `buildPackageCochangeMatrix(commits, packageNames, fileToPackage): number[][]`
for direct package-level Jaccard computation.

**File**: `tests/unit/analysis/fim/cochange-matrix-builder.test.ts` (new)

Tests:
1. Two files always changed together -> Jaccard = 1.0
2. Two files never changed together -> Jaccard = 0.0
3. Known Jaccard: file A in 3 commits, file B in 5 commits, joint = 2 -> J = 2/6
4. Matrix is symmetric
5. Diagonal is 1.0 for all files with at least one commit
6. File with zero commits -> diagonal = 0 (or NaN guard)
7. Package-level aggregation: 4 files in 2 packages, known commit patterns

**Acceptance criteria**:
- All 7 tests pass
- Matrix is symmetric and all values in [0, 1]
- Consistent with Jaccard definition used in `history-aggregator.ts`

---

## Phase C — CLI and MCP Integration

**Depends on**: Phase A + Phase B
**Estimated lines**: ~220 source + ~120 test
**Files**:
- `src/cli/commands/analyze.ts` (modify)
- `src/cli/mcp/tools/fim-tools.ts` (new)
- `src/cli/mcp/mcp-server.ts` (modify)
- `tests/unit/analysis/fim/fim-integration.test.ts` (new)
- `tests/unit/cli/mcp/tools/fim-tools.test.ts` (new)

### Stage C1 — CLI flags + pipeline wiring (~120 lines source + ~60 lines test)

**File**: `src/cli/commands/analyze.ts` (modify)

Add `--fim` and `--fim-validate` option declarations (Commander `.option()` calls),
then wire the FIM computation into the analyze pipeline:

1. After standard analysis completes, if `--fim` is set:
   - Collect test files via plugin's `isTestFile()`
   - Build import graph from ArchJSON entities and relations
   - Call `buildCoverageMatrixFromImports()` with test files from plugin
   - Call `computeFisherInformation()` with the coverage matrix
   - Aggregate to package level via `aggregateToPackageLevel()`
   - Print summary to console (format per proposal CLI output example)
   - Append snapshot to `fim-history.json`
2. If `--fim-validate` is also set (requires `--fim`):
   - Load git history data (error gracefully if unavailable: print warning, skip Mantel)
   - Build full co-change matrix at package level via `buildFullCochangeMatrix()`
   - Run Mantel test: coverage FIM vs co-change
   - Print Mantel test result

**File**: `tests/unit/analysis/fim/fim-integration.test.ts` (new)

Tests:
1. FIM computation on synthetic ArchJSON with known entities/relations
2. Package-level aggregation matches expected dimensions
3. Snapshot written to correct path
4. `--fim` not specified -> no FIM output (regression test, proposal AC 16)

**Acceptance criteria**:
- All 4 tests pass
- CLI output matches proposal format
- Existing tests unaffected when `--fim` is not specified
- `node dist/cli/index.js analyze --fim` produces output on ArchGuard self
- `node dist/cli/index.js analyze --fim --fim-validate` produces Mantel test result
  (requires prior `archguard_analyze_git`)
- All existing tests pass (proposal AC 16)

---

### Stage C2 — MCP tool: archguard_get_fim (~100 lines source + ~60 lines test)

**File**: `src/cli/mcp/tools/fim-tools.ts` (new)

Implement and export `registerFIMTools(server: McpServer, defaultRoot: string): void`
following the existing pattern in `test-analysis-tools.ts` / `git-history-tools.ts`.

Register `archguard_get_fim` MCP tool:
- Input schema (Zod):
  - `level`: `'file' | 'package'` (default: `'package'`)
  - `includeMantel`: boolean (default: false)
  - `snapshotCount`: number (default: 5)
- Output: structured JSON per proposal specification
  - `current`: conditionNumber, effectiveDimension, fileCount, testCount,
    topEigenvalues, uncoveredFiles, fragilityHotspots
  - `mantel` (if includeMantel): observedCorrelation, pValue, isValidProxy
  - `history`: last N snapshots
  - `gitPredictions`: P1 (description length), P2 (condition number trend),
    P5 (co-change validity)

**File**: `src/cli/mcp/mcp-server.ts` (modify)

Import and call `registerFIMTools(server, defaultRoot)` alongside the existing
`registerTestAnalysisTools` / `registerGitHistoryTools` calls.

**File**: `tests/unit/cli/mcp/tools/fim-tools.test.ts` (new)

Tests:
1. Tool returns correct structure for package-level query
2. Tool returns correct structure for file-level query
3. includeMantel=false -> no mantel field
4. snapshotCount=2 -> at most 2 history entries
5. Tool registered in MCP server

**Acceptance criteria**:
- All 5 tests pass
- MCP tool queryable and returns valid JSON
- Tool description includes data source caveat (import-approximation)

---

## Test Strategy

- **TDD**: All stages write tests before implementation
- **Coverage target**: >= 80% line coverage for `src/analysis/fim/`
- **Synthetic data**: Phases A and B use hand-crafted matrices with known results
- **Self-validation**: Phase C tested against ArchGuard's own codebase
- **Regression**: Existing 3141+ tests must continue passing
- **Determinism**: Mantel test uses optional seed for reproducible results in tests

## Dependency Summary

```
Stage A1 (types + ml-matrix)
  ├→ Stage A2 (coverage matrix) → Stage A3 (FIM builder) → Stage A4 (snapshot) ──┐
  ├→ Stage B1 (Mantel test)  ──────────────────────────────────────────────────────┤
  └→ Stage B2 (co-change matrix) ─────────────────────────────────────────────────┤
                                                                                   ├→ C1 (CLI)
                                                                                   └→ C2 (MCP)
```

Phases A and B are partially parallelizable: B1 and B2 depend only on A1 (types).
Phase C depends on all of A and B. Within Phase A, A2→A3→A4 is sequential.

## Line Budget Summary

| Stage | Source lines | Test lines | Total |
|-------|-------------|------------|-------|
| A1    | ~40         | 0          | ~40   |
| A2    | ~80         | ~80        | ~160  |
| A3    | ~130        | ~120       | ~250  |
| A4    | ~50         | ~50        | ~100  |
| B1    | ~80         | ~80        | ~160  |
| B2    | ~120        | ~80        | ~200  |
| C1    | ~120        | ~60        | ~180  |
| C2    | ~100        | ~60        | ~160  |
| **Total** | **~720** | **~530** | **~1250** |

Phase A: ~550 lines. Phase B: ~360 lines. Phase C: ~340 lines.
All phases within the 500-line budget. Each stage is well under 200 lines.

## References

- `docs/proposals/proposal-coverage-fisher-information.md` (v3)
- `docs/spikes/fim-experiment-report.md` — spike results
- `scripts/fim-experiment.mjs` — reference implementation
- `src/analysis/test-coverage-mapper.ts` — existing import-layer coverage logic
- `src/cli/git-history/history-aggregator.ts` — existing co-change (top-10 only)
- `src/cli/git-history/git-log-reader.ts` — `CommitRecord` type (used by cochange-matrix-builder)
