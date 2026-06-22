# Proposal: Architecture Metrics Observatory

**Status**: Draft
**Date**: 2026-03-30
**Related**: proposal-coverage-fisher-information.md, proposal-jl-intrinsic-dimension.md, proposal-information-shape-smell-detection.md

---

## Background

The ArchGuard project invested significant effort in the GIT (Geometric Information Theory) framework, culminating in a Fisher Information Matrix (FIM) implementation (`src/analysis/fim/`) and a rigorous empirical validation experiment (`scripts/fim-per-test-coverage.mjs`). The experiment tested whether GIT's theoretical predictions hold in practice when grounded in real data.

### What the FIM experiment found

The experiment ran two independent FIM constructions on ArchGuard's own codebase (170 test files, 163 source files):

**Import-approximation FIM** (Phase 1):
- Mantel correlation with co-change matrix: r=0.77, p=0.01 (statistically significant)
- Appeared to validate the GIT prediction that co-change is a FIM proxy (P5)

**Per-test runtime coverage FIM** (ground truth, run 2026-03-30):
- 118 test suites x 175 source files, collected via individual `vitest --coverage` runs per test file
- Results stored in `.archguard/fim-runtime-result.json` (eigenvalues, condition numbers, diagonal)
- Mantel test against the same co-change matrix: **r=0.28, p=0.20 (NOT statistically significant)**
- The Mantel test is implemented in `scripts/fim-per-test-coverage.mjs` (lines 200-240) and was executed in a live experiment session. The terminal output showed `Mantel r = 0.2813, p-value = 0.2009`. The JSON result file does not include Mantel output (a gap in the script's serialization), but the numbers are reproducible by re-running the script.
- **P5 is therefore REFUTED when using runtime coverage data**: co-change is NOT a statistically significant proxy for runtime-coverage FIM at package level in this project.

Despite the Mantel test passing for the import approximation, that result is **unreliable at file level**. The cause: type-definition files (e.g., `src/types/config-cli.ts`, `src/types/config-diagram.ts`, `src/types/config-global.ts`) are imported by ~106 test files but execute zero runtime statements. The import-based FIM diagonal was dominated by these files (I_ii=106 each), inflating the first eigenvalue to 51% of total variance. The real runtime coverage shows the actual information hubs are logic-heavy files: `src/plugins/golang/tree-sitter-bridge.ts` (524 stmts), `src/plugins/golang/index.ts` (466 stmts), `src/mermaid/generator.ts` (456 stmts).

Additionally, GIT prediction P2 (refactoring improves FIM condition number) failed at package level because intra-package refactoring (the DiagramProcessor god class decomposition into 4 modules, all within `src/cli/processors/`) is invisible at package granularity.

Full experiment data: `docs/spikes/fim-experiment-report.md`

### What actually works in ArchGuard

ArchGuard's practical effectiveness comes from established software engineering heuristics that are already implemented:

- **Coupling metrics**: inDegree, outDegree per file (`FileStats` in `src/types/index.ts`)
- **Cycle detection**: Kosaraju SCC algorithm (`CycleInfo`, `ArchJSONMetrics.stronglyConnectedComponents`)
- **Package statistics**: fileCount, entityCount, methodCount, loc per package (`PackageStatEntry` in `src/cli/query/query-engine.ts`)
- **Global metrics**: entity/relation counts, inferred relation ratio, relation type breakdown (`ArchJSONMetrics`)
- **Test coverage analysis**: import-layer + path-convention coverage mapping (`src/analysis/test-coverage-mapper.ts`)
- **Co-change analysis**: git history-based co-change detection (`src/cli/git-history/`)

These metrics are concrete, interpretable, and actionable. They do not require GIT/FIM theory to justify their value.

---

## Problem Statement

Four gaps exist in ArchGuard's current architecture analysis capabilities:

### 1. FIM/GIT theoretical framework failed empirical validation

The core GIT prediction (P5: co-change correlates with FIM) appeared to pass with import-approximation FIM (Mantel r=0.77, p=0.01), but this result was a **false positive** driven by type-definition files inflating the FIM diagonal. When tested with ground-truth per-test runtime coverage (118 tests x 175 files, run 2026-03-30), the Mantel test yielded **r=0.28, p=0.20 — not statistically significant**. The earlier experiment report (`docs/spikes/fim-experiment-report.md`) rates P5 as "Pass: High confidence" based solely on the import approximation and is now superseded by the runtime coverage result. FIM eigenvalue features should not be presented as validated architecture indicators.

### 2. One-time snapshots with no temporal comparison

Every `analyze` run produces a fresh snapshot. There is no way to ask "did this refactoring actually improve coupling?" or "how has cycle count trended over the last 20 commits?" without manually re-running analysis and comparing output by eye.

### 3. No cross-project baselines

When ArchGuard reports that a file has inDegree=15 or that there are 3 non-trivial SCCs, the user has no frame of reference. Is that high? Normal? For a TypeScript project with 150 source files, what does a typical maxInDegree look like? There is no baseline data to answer these questions.

### 4. No architecture fitness functions

Users cannot encode architectural intent as automated checks. There is no mechanism to say "no cycles between packages A and B" or "maxInDegree must stay below 20" and have that verified in CI. Architecture constraints live in developers' heads, not in the toolchain.

---

## Goals

1. Define a standardized metric vector that every `analyze` run produces, using metrics ArchGuard already computes
2. Enable snapshot persistence and time-series comparison to track metric trends across commits
3. Lay the groundwork for cross-project baselines (future phase)
4. Provide architecture fitness functions for CI integration
5. Demote FIM analysis to experimental status and establish the empirically grounded path toward testing GIT's low-dimensional manifold hypothesis

---

## Design

### A. Standardized Metric Vector

Define a fixed-schema metric vector emitted by every `analyze` run. Most values are already computed by existing code paths. This component is primarily a schema standardization and persistence concern, with a small amount of new computation (aggregate max/Gini derivations).

**Per-package metrics** (source: `PackageStatEntry` from `src/cli/query/query-engine.ts`):
- `fileCount`: number of source files
- `entityCount`: classes, interfaces, structs, enums
- `methodCount`: total methods across entities
- `loc`: approximate line count (max endLine)

**Per-file metrics** (source: `FileStats` from `src/types/index.ts`):
- `inDegree`: incoming relation count (edges, not distinct neighbors)
- `outDegree`: outgoing relation count
- `cycleCount`: number of non-trivial SCCs containing entities from this file

**Global metrics** (source: `ArchJSONMetrics` from `src/types/index.ts`):
- `totalRelations`: `ArchJSONMetrics.relationCount` (existing)
- `inferredRelationRatio`: `ArchJSONMetrics.inferredRelationRatio` (existing)
- `sccCount`: number of non-trivial SCCs, i.e. `ArchJSONMetrics.cycles.length` (new derivation -- note: `stronglyConnectedComponents` counts ALL SCCs including trivial size-1 components; `cycles[]` contains only the non-trivial size>1 entries)
- `maxInDegree`: max(fileStats[].inDegree) (new derivation, trivial)
- `maxPackageSize`: max(packages[].fileCount) (new derivation, trivial)
- `giniInDegree`: Gini coefficient of inDegree distribution (new computation, ~10 lines)
- `giniPackageSize`: Gini coefficient of package size distribution (new computation, ~10 lines)
- `entityCoverageRatio`: from test analysis extensions (`TestMetrics.entityCoverageRatio` in `src/types/extensions/test-analysis.ts`) -- only present when `--include-tests` is used

The vector should be serialized as a JSON object alongside the existing `ArchJSON.metrics` field, either extending it or as a new `ArchJSON.metricVector` field.

### B. Snapshot Storage and Time-Series Diff

**Storage**:
- After each `analyze` run, persist the metric vector to `.archguard/snapshots/<commitSha>-<timestamp>.json`
- Include: commitSha (from `git rev-parse HEAD`), timestamp, branch name, metric vector, ArchGuard version
- Retention policy: keep last N snapshots (configurable, default 100)

**Diff**:
- `archguard diff [--from <sha>] [--to <sha>]` command
- Computes delta for every metric in the vector
- Highlights significant changes (configurable thresholds)
- Answers: "did this refactoring actually improve the metrics?"

**Schema evolution**:
- Each snapshot must include a `schemaVersion` field (starting at 1)
- When the metric vector schema changes (new fields added, fields renamed), bump the schema version
- The diff command must handle version mismatches: when comparing snapshots with different schema versions, only compare the intersection of fields and warn the user about incompatible fields
- New optional fields should use `null` (not absent) to distinguish "not computed" from "zero"

**Trend visualization** (future):
- Sparkline or table output showing metric trends over the last N snapshots
- Integration with the existing `.archguard/index.md` output

### C. Cross-Project Baselines (Future Phase)

This component requires data collection across many projects and is deferred to a future phase. The design intent:

- Collect anonymized metric vectors from open-source projects (via opt-in contributor runs)
- Segment by: language, project size (source file count), domain
- Establish percentile distributions: "for a TypeScript project with 100-200 source files, median maxInDegree is X (p25=Y, p75=Z)"
- Let users compare their project against baselines: `archguard baseline compare`
- Requires careful normalization: project size, language, monorepo vs single-package

### D. Architecture Fitness Functions

Inspired by Neal Ford's "Building Evolutionary Architectures", allow users to encode architectural constraints as automated checks. Existing tools in this space include ArchUnit (Java), NetArchTest (.NET), and dependency-cruiser (JavaScript/TypeScript). Dependency-cruiser is the closest competitor for TypeScript projects -- it validates dependency rules and detects circular dependencies in CI, but operates only on import-level dependency graphs without the structural metrics (coupling distributions, SCC analysis, test coverage) that ArchGuard provides. The fitness function design here builds on ArchGuard's richer metric surface.

**Configuration** (in `archguard.config.json`):
```json
{
  "fitness": {
    "rules": [
      { "metric": "sccCount", "op": "<=", "value": 0, "message": "No cyclic dependencies allowed" },
      { "metric": "maxInDegree", "op": "<", "value": 20, "message": "No god files" },
      { "metric": "entityCoverageRatio", "op": ">=", "value": 0.8, "message": "Test coverage must be at least 80%" },
      { "type": "no-dependency", "from": "src/parser/**", "to": "src/cli/**", "message": "Parser must not depend on CLI" }
    ],
    "failOnViolation": true
  }
}
```

**Rule types**:
- **Metric threshold rules**: compare a global metric against a threshold
- **Dependency constraint rules**: assert that no relation exists between specified package/file patterns
- **Trend rules** (requires snapshots): "metric X must not increase by more than Y% between snapshots"

**CLI integration**:
- `archguard check` command: run fitness functions against current snapshot
- Exit code 1 on violation when `failOnViolation: true` (CI-friendly)
- Human-readable violation report to stdout

---

## Relationship to GIT/FIM

### Demote FIM to experimental status

The existing FIM implementation (`src/analysis/fim/`) should be marked as experimental. Specifically:

- The `FIMBuilder`, `MantelTest`, `CochangeMatrixBuilder`, and related code remain available but are not surfaced in default analysis output
- Documentation should note that import-approximation FIM has a known systematic bias (type-file false positives) and that the per-test runtime coverage FIM has not yet been validated via Mantel test against co-change data
- FIM features should not be promoted as validated architecture health indicators

### The empirically grounded path to testing GIT's hypothesis

GIT posits that software architecture lives on a "low-dimensional manifold." This might be correct, but the FIM experiment showed that the dimensions are NOT FIM eigenvalues. The metric vector + PCA approach provides a concrete, falsifiable way to test this:

1. Collect standardized metric vectors from many projects (Component C above)
2. Apply PCA to the cross-project metric matrix
3. If 3-5 principal components explain >90% of variance, that validates the low-dimensionality claim
4. Crucially, the principal components would be **interpretable** -- linear combinations of concrete metrics like inDegree, sccCount, giniPackageSize -- unlike FIM eigenvalues which are abstract and empirically unreliable

This approach inverts the GIT methodology: instead of starting from theory and seeking empirical validation, start from empirical data and discover the actual structure. If the structure turns out to be low-dimensional, then GIT's intuition was directionally correct even if its specific FIM formalization was not.

**Prior work supporting this approach**: Multiple empirical studies have applied PCA to OO metrics. Tang & Kao ("An Empirical Study on Object-Oriented Metrics", METRICS 1999) applied PCA and correlation analysis to CK metrics and found that many measures capture similar dimensions. Mishra et al. ("Empirical analysis of object oriented metrics using dimensionality reduction techniques", IEEE 2014) applied PCA and PAF to 12 OO metrics and found they reduce to approximately 4 independent dimensions. Additionally, Subramanyam & Krishnan (IEEE TSE 2003) empirically validated that CK metrics are significantly associated with software defects even after controlling for size, establishing that these metrics capture meaningful structural properties. A representative finding across these studies is that software metric spaces are indeed lower-dimensional than naively expected. However, these studies used per-class CK metrics (WMC, DIT, NOC, CBO, RFC, LCOM), not the architecture-level metrics proposed here. Whether architecture-level metrics (coupling distributions, cycle counts, package size distributions) exhibit similar dimensional reduction is an open empirical question that this proposal aims to answer.

### What NOT to do

- Do NOT build additional FIM/eigenvalue features until per-test runtime coverage validation succeeds on at least 3 independent projects of different sizes and languages
- Do NOT claim theoretical backing from GIT for practical features -- ArchGuard's coupling metrics, cycle detection, and coverage analysis stand on their own merits as established SE practices
- Do NOT invest further in import-approximation FIM improvements at file level -- the type-file bias is systematic. However, at package level the import approximation showed r=0.77 (the experiment report rates this as high confidence), so package-level import FIM may still have value if validated on additional codebases

---

## Trade-offs

| Decision | Alternative | Rationale |
|----------|-------------|-----------|
| Fixed-schema metric vector | Extensible/plugin-defined metrics | Fixed schema enables cross-project comparison; extensibility can come later |
| File-based snapshot storage | Database (SQLite) | File-based is simpler, git-friendly, zero dependencies; migrate to DB if query patterns demand it |
| Gini coefficient for distribution metrics | Standard deviation, entropy | Gini is scale-invariant (works for projects of any size), bounded [0,1], interpretable |
| Fitness rules in config file | Dedicated rule DSL | Config file is familiar, low barrier; DSL is over-engineering for v1 |
| Demote FIM rather than remove it | Remove entirely | FIM code has educational value and may become useful if per-test runtime coverage matures; removal loses optionality |

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Metric vector schema needs iteration as we discover which metrics matter | Medium | Version the schema; maintain backward compatibility via optional fields |
| Cross-project baselines require careful normalization (size, language, domain) | High | Defer to future phase; start with same-project temporal comparison which needs no normalization |
| Fitness functions become noise if thresholds are poorly chosen | Medium | Provide sensible defaults; require explicit opt-in; clear violation messages |
| Snapshot storage accumulates disk usage over time | Low | Configurable retention limit; metric vectors are small (~1KB each) |
| PCA on metric vectors may reveal that architecture is NOT low-dimensional | Medium | This would be a valuable finding -- it would definitively refute GIT's core hypothesis with empirical evidence |

---

## Implementation Phases

**Phase 1: Metric Vector + Snapshots** (Components A + B)
- Define `MetricVector` type extending existing `ArchJSONMetrics`
- Add Gini coefficient computation (giniInDegree, giniPackageSize)
- Snapshot persistence after each `analyze` run
- `archguard diff` command

**Phase 2: Fitness Functions** (Component D)
- Fitness rule schema in `archguard.config.json`
- `archguard check` command with CI-friendly exit codes
- Metric threshold rules + dependency constraint rules

**Phase 3: Cross-Project Baselines** (Component C)
- Anonymous metric collection infrastructure
- Percentile distribution computation
- `archguard baseline compare` command

**Phase 4: GIT Hypothesis Test** (PCA analysis)
- Requires sufficient cross-project data from Phase 3
- PCA on standardized metric vectors
- Publish findings regardless of outcome

---

## References

- FIM experiment report: `docs/spikes/fim-experiment-report.md`
- FIM implementation: `src/analysis/fim/` (fim-builder.ts, mantel-test.ts, cochange-matrix-builder.ts, coverage-parser.ts, types.ts, fim-analysis.ts, fim-artifacts.ts, fim-snapshot.ts)
- Per-test coverage experiment: `scripts/fim-per-test-coverage.mjs`
- Runtime FIM results: `.archguard/fim-runtime-result.json`
- Core metric types: `src/types/index.ts` (ArchJSONMetrics, FileStats, CycleInfo)
- Package statistics: `src/cli/query/query-engine.ts` (PackageStatEntry, PackageStatsResult)
- Test coverage mapping: `src/analysis/test-coverage-mapper.ts`
- FIM proposal (predecessor): `docs/proposals/proposal-coverage-fisher-information.md`
- Neal Ford, "Building Evolutionary Architectures" (O'Reilly, 2017; 2nd ed. 2023) -- fitness function concept
- dependency-cruiser: https://github.com/sverweij/dependency-cruiser -- closest JS/TS competitor for dependency rule enforcement
- ArchUnit: https://www.archunit.org/ -- Java architecture testing (JUnit-based fitness functions)
- Tang & Kao, "An Empirical Study on Object-Oriented Metrics" (METRICS 1999) -- PCA and correlation analysis on CK metrics showing many measures capture similar dimensions
- Mishra et al., "Empirical analysis of object oriented metrics using dimensionality reduction techniques" (IEEE 2014) -- PCA/PAF on 12 OO metrics showing ~4 independent dimensions
- Subramanyam & Krishnan, "Empirical Analysis of CK Metrics for Object-Oriented Design Complexity: Implications for Software Defects" (IEEE TSE, Vol. 29, No. 4, pp. 297-310, 2003) -- validates CK metrics as defect predictors

---

## Review Notes (2026-03-30)

This section documents issues found during architectural review of the proposal, along with corrections applied.

### RN-1: Runtime FIM Mantel test results — verified as real (CORRECTED)

The architect review initially flagged the runtime Mantel test results (r=0.28, p=0.20) as "fabricated" because they were not found in saved files. This assessment was **incorrect**:

- `scripts/fim-per-test-coverage.mjs` **does** implement a Mantel test (lines 200-240: `mantelTest()` function, called at line ~240 with `mantelTest(fimSub, ccSub, 9999)`)
- The script was executed on 2026-03-30, running 118 unit test files individually with `vitest --coverage` (concurrency=6, ~3 minutes total)
- Terminal output clearly showed: `Mantel r = 0.2813`, `p-value = 0.2009`, `结论: ✗ Co-change is NOT a significant proxy (p >= 0.05)`
- The result JSON (`.archguard/fim-runtime-result.json`) does not include the Mantel output due to a serialization gap in the script — only eigenvalues and condition numbers were saved. This is a script bug, not evidence of data fabrication.
- The experiment is fully reproducible: `node scripts/fim-per-test-coverage.mjs --skip-run` will re-analyze from cached per-test coverage data in `.archguard/per-test-cov/`

The "failed validation" framing has been **restored** as the accurate characterization of the experimental outcome.

### RN-2: FIM file list incomplete (FIXED)

The References section listed 6 files in `src/analysis/fim/` but the directory contains 8 files. Missing: `fim-artifacts.ts` and `fim-snapshot.ts`. Fixed.

### RN-3: sccCount derivation was misleading (FIXED)

The original text said `sccCount` derives from "stronglyConnectedComponents where size > 1." In the actual type definition, `ArchJSONMetrics.stronglyConnectedComponents` is a count of ALL SCCs (including trivial size-1 components), while `ArchJSONMetrics.cycles[]` is the filtered array of non-trivial (size>1) SCCs. The correct derivation is `cycles.length`, not a filter on `stronglyConnectedComponents`. Fixed with clarifying note.

### RN-4: "All values are already computed" was inaccurate (FIXED)

The original text claimed the metric vector is "primarily a schema standardization and persistence concern, not new computation." In reality, `maxInDegree`, `maxPackageSize`, `giniInDegree`, and `giniPackageSize` are all new computations (ranging from trivial max() to ~10-line Gini implementations). The per-package metrics also require accessing `QueryEngine.getPackageStats()` which is currently only used in MCP query context, not in the standard analyze pipeline. Wiring the metric vector into the analyze command is non-trivial integration work.

### RN-5: entityCoverageRatio requires --include-tests flag (FIXED)

The `entityCoverageRatio` metric is only available when test analysis has been run (via `--include-tests`). It is not present in default `analyze` output. Added note.

### RN-6: Missing prior art for PCA on software metrics (FIXED)

The proposal's PCA approach for testing GIT's manifold hypothesis is methodologically sound, but the draft did not acknowledge existing empirical work. Multiple IEEE studies have applied PCA/PAF to OO metrics (CK suite) and found that 12 metrics reduce to ~4 independent dimensions. Added citations and distinguished class-level CK metrics from the architecture-level metrics proposed here.

### RN-7: Missing competitor analysis for fitness functions (FIXED)

The draft mentioned Neal Ford's book but did not compare against existing tools. dependency-cruiser is the direct competitor for TypeScript/JavaScript dependency rule enforcement in CI. ArchUnit is the standard for Java. Added comparison noting that ArchGuard's advantage is richer metric surface (coupling distributions, SCC analysis, test coverage) beyond pure dependency graph rules.

### RN-8: Snapshot schema evolution unaddressed (FIXED)

The original design for snapshot storage did not address what happens when the metric vector schema evolves between ArchGuard versions. Added schema versioning requirement and diff compatibility rules.

### RN-9: Package-level import FIM may still have value

The original "What NOT to do" section categorically rejected all import-approximation FIM work. However, the experiment report shows r=0.77 at package level, which the report itself calls a valid finding. The type-file bias primarily affects file-level analysis (individual type files dominate), but at package level these files are aggregated with logic files and the bias is attenuated. Softened the recommendation to preserve package-level import FIM as potentially useful pending cross-project validation.

### RN-10: Open question -- metric vector completeness

The metric vector omits several potentially valuable metrics that are derivable from existing ArchGuard output:
- **Orphan entity ratio**: entities with zero incoming AND zero outgoing edges (already computed by `QueryEngine.findOrphans()`)
- **Relation type distribution**: inheritance vs composition vs dependency ratios (available from `ArchJSONMetrics.relationTypeBreakdown`)
- **Average methods per entity**: derivable from entity member counts
- **Test type distribution**: unit/integration/debug/unknown ratios (from `TestMetrics.byType`)

These should be evaluated for inclusion in Phase 1 or deferred to schema v2.

### RN-11: Subramanyam & Krishnan citation was mischaracterized (FIXED)

The prior work section originally cited Subramanyam & Krishnan (IEEE TSE 2003) alongside Tang & Kao as examples of PCA on OO metrics showing ~4 independent dimensions. However, Subramanyam & Krishnan's paper is about empirical validation of CK metrics as defect predictors (using regression analysis, not PCA). The actual PCA dimensionality finding comes from Mishra et al. (IEEE 2014), "Empirical analysis of object oriented metrics using dimensionality reduction techniques." Fixed: added Mishra et al. citation, corrected Subramanyam & Krishnan's characterization, and updated References section with accurate descriptions.
