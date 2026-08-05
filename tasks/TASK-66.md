---
id: TASK-66
title: "TASK-66: JL cluster boundary — K-Means clustering + Boundary Alignment Score (Phase 4)"
status: todo
labels:
  - analysis
  - metric
  - mcp
  - clustering
parent: TASK-64
children: []
extra:
  schema: v1
  source: quay-tasks/TASK-19
---
# TASK-66: JL cluster boundary — K-Means clustering + Boundary Alignment Score (Phase 4)

## Proposal

> source: quay-tasks/TASK-19（2026-08-05 经 git 历史核实为「真新」后搬入 tasks/，编号从 TASK-62 起；
> `src/analysis/jl/` 无任何实现。依赖 TASK-64（JL intrinsic dimension）的 `src/analysis/jl/` 基础设施，
> 故 parent=TASK-64，待其 done 后才可晋级）

Apply K-Means clustering to entities in adjacency matrix space (DIRECT) or JL-projected space (JL
mode). Compare geometric clusters with declared package boundaries. Report Boundary Alignment Score
(BAS), split packages (purity < 0.5), cross-domain fusion, orphan entities. Single-snapshot analysis.
MCP tool `archguard_get_cluster_boundary`.

**Background**: In domain-driven design, a module's logical boundary (package/namespace/directory)
should align with its structural behaviour (dependency patterns, coupling). Over time these layers
diverge: classes in the same domain split into unrelated responsibilities while remaining in the same
package (structural split), and classes from different packages fuse into one structural cluster
(cross-domain fusion). `archguard_detect_cycles` only surfaces directed-cycle violations; it cannot
answer whether modules form natural structural communities or whether those match declared package
boundaries. This feature adds a geometry-based view: treat each entity's adjacency-matrix row (or
JL-projected coordinates) as its "structural position", cluster with K-Means, then compare to
declared package prefixes.

**Goals**:
1. `KMeansClusterer` accepts an n×d feature matrix, selects K via Silhouette Score over
   [K_init-2, K_init+3], runs Lloyd's Algorithm with K-Means++ initialisation and a fixed seed,
   returns deterministic assignments.
2. `BoundaryAlignmentScorer` computes per-package purity, coverage, BAS, plus system-level
   weighted-average globalBAS.
3. `SplitPackageDetector` (purity < 0.5, size ≥ 3), `CrossDomainFusionDetector` (cross-package ratio
   > 60% and dominant-package coverage < 0.5), and `OrphanDetector` (zero-row entities removed before
   clustering).
4. Expose `archguard_get_cluster_boundary` MCP tool returning `ClusterBoundaryReport` (globalBAS,
   silhouetteScore, packageScores, splitPackages, crossDomainFusions, orphanEntities, clusters).
5. All analyses run in a single snapshot; no history file written; no existing test or CLI behaviour
   changes when not invoked.

**Not implemented in this phase**: Mermaid visualization of cluster membership (Phase 2), BAS trend
over time, LLM-assisted refactoring suggestions.

**Dependency**: requires TASK-64's `adjacency-builder` and `jl-projector` as importable modules; if
not yet merged, Phase D includes an inline minimal adjacency-matrix builder so the task is unblocked.
No external npm packages added (K-Means is hand-written; `ml-matrix` already present may be used for
helpers).

## Plan

### Phase A: KMeansClusterer — Lloyd's Algorithm + K-Means++ + Silhouette K-selection

Tests first, in `tests/unit/analysis/jl/kmeans.test.ts`: two separated 2D clusters → Silhouette > 0.8
+ correct partition; uniform random points → Silhouette < 0.2 + "no clear cluster structure" warning;
determinism (bit-identical assignments with same seed); zero-rows → `orphanIndices` and excluded from
assignments; K-selection picks argmax Silhouette; maxIterations=100 guard → `converged: false` on
non-convergence; large-n (2500) sampled Silhouette deterministic.

Implementation: `src/analysis/jl/kmeans.ts` (`KMeansClusterer.cluster` with private kmeanspp /
lloydIterate / silhouette / selectK / detectOrphans); append KMeansResult / KMeansOptions /
ClusterBoundaryReport / PackageBASScore / SplitPackageIssue / CrossDomainFusion / ClusterSummary to
`src/analysis/jl/types.ts`.

DoD: `npm test -- --run tests/unit/analysis/jl/kmeans.test.ts`, `npm run type-check`.

### Phase B: BoundaryAlignmentScorer — purity, coverage, BAS per package + globalBAS

Tests first, in `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` (scorer section):
purity=1.0/BAS=1.0 when package dominates cluster; purity=0.25 when split evenly across K=4;
single-entity package not flagged; `minPackageSize=3` filter; globalBAS weighted average verified by
hand; all scores in [0,1]; package name extraction with packageDepth=1/2; clusterDistribution ratios
sum to 1.0.

Implementation: `src/analysis/jl/cluster-boundary-analyzer.ts` (`BoundaryAlignmentScorer.score`,
`globalBAS`, private `extractPackage`).

DoD: `npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`, `npm run type-check`.

### Phase C: Issue Detectors — SplitPackage + CrossDomainFusion + Orphan

Tests first, in `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` (detector section):
SplitPackageDetector purity/size guards; CrossDomainFusionDetector 50/30/20 cross-package cluster
flagged, 80% single-dominant not; OrphanDetector includeOrphans toggle; ClusterSummary
dominantPackageRatio in [0,1]; full ClusterBoundaryReport integration fixture (3 packages × 20
entities).

Implementation: add `ClusterBoundaryAnalyzer.analyze` to `cluster-boundary-analyzer.ts` with private
`detectSplitPackages`, `detectCrossDomainFusions`, `buildClusterSummaries`.

DoD: `npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`, `npm run type-check`.

### Phase D: MCP Tool — archguard_get_cluster_boundary

Tests first, in `tests/unit/cli/mcp/tools/arch-health-tools.test.ts`: tool name + parameter schema
(minPackageSize, splitThreshold, packageDepth, includeOrphans); ClusterBoundaryReport for a valid
fixture; error on <2 entities; minPackageSize forwarded (spy); includeOrphans=false → empty
orphanEntities; globalBAS in [0,1].

Implementation: `src/cli/mcp/tools/arch-health-tools.ts` (`registerClusterBoundaryTool`) with an
inline minimal adjacency-matrix builder as fallback (replaced by TASK-64's `adjacency-builder` once
available); call KMeansClusterer + ClusterBoundaryAnalyzer; register in `src/cli/mcp/server.ts`.

DoD: `npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts`, `npm run type-check`.

## Touches

- src/analysis/jl/kmeans.ts (new)
- src/analysis/jl/cluster-boundary-analyzer.ts (new)
- src/analysis/jl/types.ts (append cluster-boundary interfaces — created by TASK-64)
- src/cli/mcp/tools/arch-health-tools.ts (append cluster-boundary tool — created by TASK-64)
- src/cli/mcp/server.ts (register archguard_get_cluster_boundary)
- tests/unit/analysis/jl/kmeans.test.ts (new)
- tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts (new)
- tests/unit/cli/mcp/tools/arch-health-tools.test.ts (new)
- docs/proposals/proposal-jl-cluster-boundary.md (reference — exists)
- tasks/TASK-66.md

## Acceptance Criteria

- [ ] `KMeansClusterer` runs deterministic Lloyd's Algorithm with K-Means++ and Silhouette-based K selection; zero-rows → orphans
- [ ] `BoundaryAlignmentScorer` computes per-package purity/coverage/BAS + entity-count-weighted globalBAS (all in [0,1])
- [ ] SplitPackage / CrossDomainFusion / Orphan detectors emit the defined issue lists with the documented thresholds
- [ ] MCP tool `archguard_get_cluster_boundary` returns a structured `ClusterBoundaryReport`; errors on <2 entities
- [ ] Single-snapshot only — no history file written, no ArchJSON schema change, no CLI default behaviour change; depends on TASK-64 (`src/analysis/jl/` existing)

## Contract

measure kmeans = `npm test -- --run tests/unit/analysis/jl/kmeans.test.ts` passed-count, silhouette-0.8-0.2
measure cluster-scorer = `npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts` passed-count, purity-0.5, size-3
measure cluster-mcp = `npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts` passed-count, packageDepth-2
band all-green = `npm run type-check` exit-code-0
invariant 不加外部 npm 包（K-Means 手写）；packageDepth 默认 2；Silhouette < 0.2 非致命 warning；单快照、不写历史文件、不改 ArchJSON schema
invoke `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json`
control 若 src/analysis/jl/kmeans.ts 已存在实现 ⇒ 判定「已覆盖」而非「真新」（不得重复搬入）
resume 每完成一个 Phase 即跑该 Phase 的 DoD 命令落盘；被打断可从已通过的 Phase 续

## Dispatch review

reviewer: inner
at: 2026-08-05
changed: 由 quay-tasks/TASK-19 搬入 tasks/（TASK-66，parent=TASK-64）时写就；Contract 每 measure 行自带命令；AC 阈值（purity<0.5、size>=3、packageDepth 2）引用 measure 字段

## Definition of Done

- [ ] #1 npm test -- --run tests/unit/analysis/jl/kmeans.test.ts
- [ ] #2 npm test -- --run tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts
- [ ] #3 npm test -- --run tests/unit/cli/mcp/tools/arch-health-tools.test.ts
- [ ] #4 npm test
- [ ] #5 npm run type-check
- [ ] #6 ! grep -rn 'TODO\|FIXME\|HACK' src/analysis/jl/kmeans.ts src/analysis/jl/cluster-boundary-analyzer.ts src/cli/mcp/tools/arch-health-tools.ts
