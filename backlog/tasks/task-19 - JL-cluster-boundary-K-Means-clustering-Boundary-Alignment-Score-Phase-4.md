---
id: TASK-19
title: 'JL cluster boundary: K-Means clustering + Boundary Alignment Score (Phase 4)'
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 06:33'
labels:
  - 'kind:basic'
dependencies: []
references:
  - docs/proposals/proposal-jl-cluster-boundary.md
  - docs/proposals/proposal-jl-intrinsic-dimension.md
  - src/cli/mcp/tools/test-analysis-tools.ts
  - src/analysis/test-issue-detector.ts
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Apply K-Means clustering to entities in adjacency matrix space (DIRECT) or JL-projected space (JL mode). Compare geometric clusters with declared package boundaries. Report Boundary Alignment Score (BAS), split packages (purity<0.5), cross-domain fusion, orphan entities. Single-snapshot analysis. MCP tool archguard_get_cluster_boundary. Depends on JL intrinsic dimension infrastructure.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: JL Cluster Boundary — K-Means Clustering + Boundary Alignment Score

## Background

In domain-driven design, a module's logical boundary (package/namespace/directory) should
align with its structural behaviour (dependency patterns, coupling). Over time these two
layers diverge: classes that started in the same domain split into unrelated responsibilities
while remaining in the same package (structural split), and classes from different packages
accumulate deep mutual coupling and fuse into one structural cluster (cross-domain fusion).

`archguard_detect_cycles` only surfaces directed-cycle violations; it cannot answer whether
modules form natural structural communities or whether those communities match declared
package boundaries. The existing `archguard_get_package_stats` provides raw counts but no
structural-cohesion signal.

This feature adds a geometry-based view: treat each entity's adjacency-matrix row (or
JL-projected coordinates) as its "structural position," cluster those positions with
K-Means, then compare the geometric clusters to declared package prefixes. The result is a
Boundary Alignment Score (BAS) per package and a system-level BAS, accompanied by lists of
split packages, cross-domain fusions, and orphan entities.

## Goals

1. Implement `KMeansClusterer` that accepts an n×d feature matrix (adjacency rows or JL
   projections), selects K via Silhouette Score over [K_init-2, K_init+3], runs Lloyd's
   Algorithm with K-Means++ initialisation and a fixed seed, and returns deterministic
   cluster assignments.
2. Implement `BoundaryAlignmentScorer` that computes per-package purity, coverage, and BAS,
   plus system-level weighted-average globalBAS, from cluster assignments and entity→package
   mappings.
3. Implement `SplitPackageDetector` (purity < 0.5, size >= 3), `CrossDomainFusionDetector`
   (cluster cross-package ratio > 60% and dominant-package coverage < 0.5), and
   `OrphanDetector` (zero adjacency-matrix row removed before clustering).
4. Expose `archguard_get_cluster_boundary` MCP tool returning a structured
   `ClusterBoundaryReport` (globalBAS, silhouetteScore, packageScores, splitPackages,
   crossDomainFusions, orphanEntities, clusters).
5. All analyses run in a single snapshot; no history file is written; no existing test or
   CLI behaviour changes when the feature is not invoked.

## Proposed Approach

The implementation is built on the intrinsic-dimension infrastructure (`src/analysis/jl/`):
the adjacency-matrix builder (DIRECT mode, n < 1000) or JL projector (JL mode, n >= 1000)
already produces the feature matrix M in R^{n x d} that this feature consumes.

**KMeansClusterer** (`src/analysis/jl/kmeans.ts`): hand-written Lloyd's Algorithm (~80
lines of core logic), K-Means++ initialisation, convergence threshold 0.001,
maxIterations 100. K selection iterates over K_range using Silhouette Score (O(n^2) exact
for n <= 2000, sampled 500 entities for larger inputs). Fixed seed ensures determinism.
Returns `{ assignments, centroids, silhouetteScore, k }`.

**ClusterBoundaryAnalyzer** (`src/analysis/jl/cluster-boundary-analyzer.ts`): extracts
package prefix from `entity.name` (configurable `packageDepth`, default 2), removes orphan
entities (zero-row vectors) before clustering, computes purity and coverage per package,
assembles `ClusterBoundaryReport`.

**MCP tool** (`src/cli/mcp/tools/arch-health-tools.ts` — new file): registers
`archguard_get_cluster_boundary` with parameters `minPackageSize`, `splitThreshold`,
`packageDepth`, `includeOrphans`. Loads ArchJSON via the existing query engine, builds the
adjacency matrix, calls KMeansClusterer and ClusterBoundaryAnalyzer, returns the report.

Types are added to `src/analysis/jl/types.ts` alongside existing JL types.

## Trade-offs and Risks

**Not implemented in this phase**: Mermaid visualisation of cluster membership (Phase 2),
BAS trend tracking over time, LLM-assisted refactoring suggestions.

**K-Means limitations**: K-Means assumes spherical clusters and euclidean distance; highly
non-spherical dependency structures may yield low Silhouette Scores even on well-aligned
codebases. The "no clear cluster structure" warning (Silhouette < 0.2) informs the user
without blocking output.

**High-dimensional DIRECT mode**: with n up to ~1000 entities, feature vectors are
1000-dimensional. Convergence may be slow; a warning is emitted if iterations > 80.

**Dependency**: requires `adjacency-builder` and `jl-projector` from
proposal-jl-intrinsic-dimension to exist as importable modules. If that infrastructure is
not yet merged, Phase D must include an inline minimal adjacency-matrix builder.

**No ArchJSON schema change**: the report is produced on demand and not persisted;
backward compatibility is fully maintained.

---

# Plan: JL Cluster Boundary — K-Means Clustering + Boundary Alignment Score

Proposal: docs/proposals/proposal-jl-cluster-boundary.md

## Phase A: KMeansClusterer — Lloyd's Algorithm + K-Means++ + Silhouette K-selection

### Tests (write first)

File: `tests/unit/analysis/jl/kmeans.test.ts`

Test cases:
- `cluster()` with two clearly separated 2D clusters (10+10 points) and K=2 returns
  Silhouette Score > 0.8 and correct partition
- `cluster()` with uniformly random points (no structure) returns Silhouette Score < 0.2
  and sets `warning: "no clear cluster structure"` in result
- Two calls with identical input and same seed return bit-identical `assignments` arrays
  (determinism test)
- Zero-row vectors (all-zero feature rows) are identified and returned in `orphanIndices`
  before clustering; they do not appear in `assignments`
- K-selection: given K_init=3 and K_range [1..6], the returned `k` equals the value with
  highest Silhouette Score across known data
- `maxIterations=100` guard: function returns best result and sets `converged: false` on
  pathological non-converging data
- Large-n sampling: n=2500 entities triggers sampled Silhouette (sample size 500); result
  is deterministic across two runs with same seed

### Implementation

Files to create / modify:
- `src/analysis/jl/types.ts` — add `KMeansResult`, `KMeansOptions`, `ClusterBoundaryReport`,
  `PackageBASScore`, `SplitPackageIssue`, `CrossDomainFusion`, `ClusterSummary` interfaces
- `src/analysis/jl/kmeans.ts` — new file: `KMeansClusterer` class
  - `cluster(matrix: number[][], options: KMeansOptions): KMeansResult`
  - private `kmeanspp(matrix, k, rng)` — K-Means++ initialisation
  - private `lloydIterate(matrix, centroids)` — Lloyd's algorithm loop
  - private `silhouette(matrix, assignments, sample?)` — Silhouette Score (exact or sampled)
  - private `selectK(matrix, kRange, rng)` — iterate K_range, pick argmax Silhouette
  - private `detectOrphans(matrix)` — find all-zero rows

### DoD

- [ ] `npm test -- --run tests/unit/analysis/jl/kmeans.test.ts`
- [ ] `npm run type-check`

---

## Phase B: BoundaryAlignmentScorer — purity, coverage, BAS per package + globalBAS

### Tests (write first)

File: `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` (scorer section)

Test cases:
- Package where all entities fall in same cluster: purity=1.0, BAS=1.0 (when package
  dominates the cluster)
- Package where entities split evenly across K=4 clusters: purity=0.25
- Single-entity package: purity=1.0, not flagged as split
- `minPackageSize=3` filter: packages with fewer than 3 entities absent from `packageScores`
- `globalBAS` equals weighted average of per-package BAS (verified by hand calculation)
- `globalBAS` in [0,1], all per-package purity/coverage/bas in [0,1]
- Package name extraction: entity `"cli.commands.analyze.AnalyzeCommand"` with
  `packageDepth=2` yields package `"cli.commands"`; with `packageDepth=1` yields `"cli"`
- `clusterDistribution` ratio sum === 1.0 (within 1e-9 tolerance) for any split package

### Implementation

Files to create / modify:
- `src/analysis/jl/cluster-boundary-analyzer.ts` — new file: `BoundaryAlignmentScorer`
  class
  - `score(entities: string[], assignments: number[], options): PackageBASScore[]`
  - `globalBAS(scores: PackageBASScore[]): number` — entity-count weighted mean
  - private `extractPackage(entityName: string, depth: number): string`

### DoD

- [ ] `npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`
- [ ] `npm run type-check`

---

## Phase C: Issue Detectors — SplitPackage + CrossDomainFusion + Orphan

### Tests (write first)

File: `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` (detector section, appended)

Test cases:
- `SplitPackageDetector`: package with purity=0.38 and size=5 appears in `splitPackages`;
  same purity but size=2 does not (minPackageSize guard)
- `SplitPackageDetector`: returned `clusterDistribution` ratio arrays sum to 1.0
- `CrossDomainFusionDetector`: cluster with 50%/30%/20% from 3 packages and dominant
  coverage=0.40 appears in `crossDomainFusions`; single-dominant cluster (coverage=0.80)
  does not
- `OrphanDetector`: entities at orphan indices appear in `orphanEntities` when
  `includeOrphans=true`; empty when `includeOrphans=false` (still excluded from clustering)
- `ClusterSummary.dominantPackageRatio` in [0,1] for all clusters
- Full `ClusterBoundaryReport` integration: fixture with 3 packages x 20 entities produces
  expected `globalBAS`, correct `splitPackages` and `crossDomainFusions` counts

### Implementation

Files to create / modify:
- `src/analysis/jl/cluster-boundary-analyzer.ts` — add `ClusterBoundaryAnalyzer` class
  - `analyze(matrix, entities, options): ClusterBoundaryReport`
  - private `detectSplitPackages(scores, threshold): SplitPackageIssue[]`
  - private `detectCrossDomainFusions(assignments, entityPackages, clusters): CrossDomainFusion[]`
  - private `buildClusterSummaries(assignments, entityPackages): ClusterSummary[]`

### DoD

- [ ] `npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`
- [ ] `npm run type-check`

---

## Phase D: MCP Tool — archguard_get_cluster_boundary

### Tests (write first)

File: `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`

Test cases:
- Tool registers under name `archguard_get_cluster_boundary` with correct parameter schema
  (`minPackageSize`, `splitThreshold`, `packageDepth`, `includeOrphans`)
- Tool returns `ClusterBoundaryReport` shaped object for a valid fixture ArchJSON (entity
  list + relation list sufficient to build adjacency matrix)
- Tool returns error when ArchJSON has fewer than 2 entities (degenerate input guard)
- `minPackageSize` parameter is forwarded to scorer (verified via spy)
- `includeOrphans=false` causes `orphanEntities` to be empty array in response
- Tool response `globalBAS` in [0,1] for a non-trivial fixture

### Implementation

Files to create / modify:
- `src/cli/mcp/tools/arch-health-tools.ts` — new file
  - Export `registerClusterBoundaryTool(server: McpServer): void`
  - Inline minimal adjacency-matrix builder from ArchJSON relations (symmetric n x n, keyed
    by entity index); replace with JL infra `adjacency-builder` once available
  - Call `KMeansClusterer.cluster()` then `ClusterBoundaryAnalyzer.analyze()`
  - Return serialised `ClusterBoundaryReport`
- `src/cli/mcp/mcp-server.ts` — call `registerClusterBoundaryTool(server)` alongside
  existing tool registrations

### DoD

- [ ] `npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts`
- [ ] `npm run type-check`

---

## Constraints

- Depends on JL intrinsic-dimension infrastructure: `src/analysis/jl/adjacency-builder.ts`
  and `src/analysis/jl/jl-projector.ts` should exist when this task executes. Phase D
  includes an inline minimal adjacency-matrix builder as fallback so the task is unblocked.
- No external npm packages added; K-Means is hand-written; `ml-matrix` (^6.12.1) already
  present may be used for matrix arithmetic helpers.
- No ArchJSON schema changes; no history files written; no CLI default behaviour altered.
- `packageDepth` defaults to 2.
- Silhouette Score < 0.2 sets `ClusterBoundaryReport.warning: "no clear cluster structure
  detected"` (non-fatal).
- K-Means convergence > 80 iterations sets warning field (non-fatal); returns best result.

## Acceptance Gate

- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `! grep -rn 'TODO\|FIXME\|HACK' src/analysis/jl/kmeans.ts src/analysis/jl/cluster-boundary-analyzer.ts src/cli/mcp/tools/arch-health-tools.ts`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved (self-review passed all criteria). Starting plan draft.

Plan review iteration 1: APPROVED
premise-ledger:
[E] goal coverage: 5 goals mapped to Phase A/B/C/D and Acceptance Gate
[E] TDD structure: every Phase has Tests + Implementation sections in correct order
[E] TDD order: first DoD item in every Phase uses npm test -- --run
[E] Acceptance gate: first item is npm test
[E] DoD executability: all DoD and Acceptance Gate items are shell commands
[C] file paths exist: src/analysis/jl/* are new (will be created); src/cli/mcp/mcp-server.ts verified by ls
[C] absence check pattern: ! grep -rn used correctly (non-silent grep negated)
[H] DoD sufficiency baseline: type-check + absence-check adequacy judged from background knowledge
GCL-self-report: E=5 C=2 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/analysis/jl/kmeans.test.ts
- [ ] #2 npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts
- [ ] #3 npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts
- [ ] #4 npm test
- [ ] #5 npm run type-check
- [ ] #6 ! grep -rn 'TODO\|FIXME\|HACK' src/analysis/jl/kmeans.ts src/analysis/jl/cluster-boundary-analyzer.ts src/cli/mcp/tools/arch-health-tools.ts
<!-- DOD:END -->
