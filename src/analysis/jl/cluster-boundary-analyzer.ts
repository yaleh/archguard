/**
 * Boundary Alignment Score (BAS) and cluster-boundary issue detection
 * (TASK-66 Phases B & C).
 *
 * Compares geometric clusters (from `KMeansClusterer`) with declared package
 * boundaries (dot-prefix of entity names). Per package it computes purity
 * (are the package's entities in one cluster?) and coverage (does the package
 * dominate that cluster?), combines them into BAS, and flags structural
 * splits / cross-domain fusions / orphans.
 *
 * @module analysis/jl/cluster-boundary-analyzer
 */

import { KMeansClusterer, detectOrphans } from './kmeans.js';
import { buildAchlioptas, computeK, computeMode, project } from './jl-projector.js';
import { DEFAULT_JL_CONFIG } from './types.js';
import type {
  ClusterBoundaryOptions,
  ClusterBoundaryReport,
  ClusterSummary,
  CrossDomainFusion,
  PackageBASScore,
  ProjectionMode,
  SplitPackageIssue,
} from './types.js';

const DEFAULT_MIN_PACKAGE_SIZE = 3;
const DEFAULT_SPLIT_THRESHOLD = 0.5;
const DEFAULT_PACKAGE_DEPTH = 2;
const DEFAULT_INCLUDE_ORPHANS = true;
const DEFAULT_CROSS_PACKAGE_THRESHOLD = 0.6;
const DEFAULT_DOMINANT_COVERAGE_THRESHOLD = 0.5;
const DEFAULT_SEED = 42;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export class BoundaryAlignmentScorer {
  /**
   * Extract a package prefix from an entity name.
   *
   * Entity names follow the dotted convention (language plugins provide the
   * package prefix through `entity.name`); the analysis layer only splits on
   * '.' and takes the first `depth` segments.
   *
   * @param entityName - e.g. "cli.commands.analyze.AnalyzeCommand".
   * @param depth - Package-prefix depth (default 2).
   */
  static extractPackage(entityName: string, depth: number): string {
    const parts = entityName.split('.').filter((p) => p.length > 0);
    if (parts.length === 0) return entityName;
    const prefix = parts.slice(0, depth).join('.');
    return prefix.length > 0 ? prefix : entityName;
  }

  /**
   * Compute per-package purity / coverage / BAS from cluster assignments.
   *
   * `entities[i]` is the name of the entity whose cluster is `assignments[i]`
   * (already the clustered, orphan-free subset). Packages with fewer than
   * `minPackageSize` entities are omitted.
   */
  static score(
    entities: string[],
    assignments: number[],
    options: ClusterBoundaryOptions = {}
  ): PackageBASScore[] {
    const depth = options.packageDepth ?? DEFAULT_PACKAGE_DEPTH;
    const minSize = options.minPackageSize ?? DEFAULT_MIN_PACKAGE_SIZE;

    const clusterCount = assignments.length > 0 ? Math.max(...assignments) + 1 : 0;
    const members: number[][] = Array.from({ length: clusterCount }, (): number[] => []);
    for (let i = 0; i < assignments.length; i++) members[assignments[i]].push(i);

    const pkgToEntities = new Map<string, number[]>();
    for (let i = 0; i < entities.length; i++) {
      const pkg = this.extractPackage(entities[i], depth);
      const list = pkgToEntities.get(pkg) ?? [];
      list.push(i);
      pkgToEntities.set(pkg, list);
    }

    const scores: PackageBASScore[] = [];
    for (const [pkg, entityIndices] of pkgToEntities) {
      if (entityIndices.length < minSize) continue;

      const clusterCounts = new Array<number>(clusterCount).fill(0);
      for (const i of entityIndices) clusterCounts[assignments[i]]++;

      let dominantCluster = 0;
      let maxCount = 0;
      for (let c = 0; c < clusterCount; c++) {
        if (clusterCounts[c] > maxCount) {
          maxCount = clusterCounts[c];
          dominantCluster = c;
        }
      }

      const purity = maxCount / entityIndices.length;
      const clusterSize = members[dominantCluster].length;
      const coverage = clusterSize > 0 ? maxCount / clusterSize : 0;
      const bas = (purity + coverage) / 2;

      scores.push({
        packageName: pkg,
        entityCount: entityIndices.length,
        purity: round4(purity),
        coverage: round4(coverage),
        bas: round4(bas),
        dominantCluster,
      });
    }

    scores.sort((a, b) => a.packageName.localeCompare(b.packageName));
    return scores;
  }

  /** Entity-count-weighted mean of per-package BAS. */
  static globalBAS(scores: PackageBASScore[]): number {
    let weighted = 0;
    let total = 0;
    for (const s of scores) {
      weighted += s.entityCount * s.bas;
      total += s.entityCount;
    }
    return total > 0 ? weighted / total : 0;
  }
}

export class ClusterBoundaryAnalyzer {
  /**
   * Run the full single-snapshot cluster-boundary analysis: remove orphans,
   * (optionally) JL-project, cluster with K-Means, score packages, and detect
   * splits / fusions.
   *
   * @param matrix - Row-major weighted adjacency matrix (row i ↔ entityNames[i]).
   * @param entityNames - Entity names aligned with matrix rows.
   * @param options - ClusterBoundaryOptions.
   * @returns ClusterBoundaryReport (single snapshot, nothing persisted).
   */
  static analyze(
    matrix: number[][],
    entityNames: string[],
    options: ClusterBoundaryOptions = {}
  ): ClusterBoundaryReport {
    const includeOrphans = options.includeOrphans ?? DEFAULT_INCLUDE_ORPHANS;
    const depth = options.packageDepth ?? DEFAULT_PACKAGE_DEPTH;
    const seed = options.seed ?? DEFAULT_SEED;
    const splitThreshold = options.splitThreshold ?? DEFAULT_SPLIT_THRESHOLD;
    const crossPackageThreshold = options.crossPackageThreshold ?? DEFAULT_CROSS_PACKAGE_THRESHOLD;
    const dominantCoverageThreshold =
      options.dominantCoverageThreshold ?? DEFAULT_DOMINANT_COVERAGE_THRESHOLD;

    if (matrix.length !== entityNames.length) {
      throw new Error(
        `entity/matrix length mismatch: ${matrix.length} rows vs ${entityNames.length} names`
      );
    }

    // 1. Orphans (zero rows) are removed BEFORE clustering.
    const orphans = detectOrphans(matrix);
    const orphanSet = new Set(orphans);
    const cleanMatrix: number[][] = [];
    const cleanNames: string[] = [];
    for (let i = 0; i < matrix.length; i++) {
      if (!orphanSet.has(i)) {
        cleanMatrix.push(matrix[i]);
        cleanNames.push(entityNames[i]);
      }
    }
    const orphanEntities = orphans.map((i) => entityNames[i] ?? `#${i}`);

    if (cleanNames.length < 2) {
      throw new Error('fewer than 2 non-orphan entities: clustering is not meaningful');
    }

    // 2. Adaptive mode; JL-project the (orphan-free) feature matrix when large.
    const mode: ProjectionMode = computeMode(cleanNames.length, DEFAULT_JL_CONFIG);
    let featureMatrix = cleanMatrix;
    if (mode === 'jl') {
      const k = computeK(cleanNames.length, DEFAULT_JL_CONFIG.epsilon);
      const dim = cleanMatrix[0].length;
      const achlioptas = buildAchlioptas(k, dim, DEFAULT_JL_CONFIG.seed);
      featureMatrix = project(cleanMatrix, achlioptas, k);
    }

    // 3. K-init from the distinct package count (silhouette searches around it).
    const distinctPackages = new Set(
      cleanNames.map((n) => BoundaryAlignmentScorer.extractPackage(n, depth))
    );
    const kInit = Math.max(2, options.kInit ?? distinctPackages.size);

    // 4. Cluster. Orphans were already removed, so the clusterer finds none and
    //    `assignments[i]` aligns with `cleanNames[i]`.
    const km = KMeansClusterer.cluster(featureMatrix, { kInit, seed });
    const assignments = km.assignments;

    // 5. Per-package scores + system-level BAS.
    const packageScores = BoundaryAlignmentScorer.score(cleanNames, assignments, options);
    const globalBAS = BoundaryAlignmentScorer.globalBAS(packageScores);

    const report: ClusterBoundaryReport = {
      mode,
      globalBAS: round4(globalBAS),
      silhouetteScore: round4(km.silhouetteScore),
      clusterCount: km.k,
      entityCount: cleanNames.length,
      packageCount: distinctPackages.size,
      packageScores,
      splitPackages: this.detectSplitPackages(
        packageScores,
        assignments,
        cleanNames,
        depth,
        splitThreshold
      ),
      crossDomainFusions: this.detectCrossDomainFusions(
        assignments,
        cleanNames,
        depth,
        crossPackageThreshold,
        dominantCoverageThreshold
      ),
      orphanEntities: includeOrphans ? orphanEntities : [],
      clusters: this.buildClusterSummaries(assignments, cleanNames, depth),
    };
    if (km.warning !== undefined) report.warning = km.warning;
    return report;
  }

  /** Packages with purity < threshold (and already size-filtered) → split issues. */
  private static detectSplitPackages(
    scores: PackageBASScore[],
    assignments: number[],
    entityNames: string[],
    depth: number,
    splitThreshold: number
  ): SplitPackageIssue[] {
    const issues: SplitPackageIssue[] = [];
    for (const s of scores) {
      if (s.purity >= splitThreshold) continue;

      const clusterCounts = new Map<number, number>();
      let total = 0;
      for (let i = 0; i < entityNames.length; i++) {
        if (BoundaryAlignmentScorer.extractPackage(entityNames[i], depth) !== s.packageName) {
          continue;
        }
        const c = assignments[i];
        clusterCounts.set(c, (clusterCounts.get(c) ?? 0) + 1);
        total++;
      }

      const distribution = Array.from(clusterCounts.entries())
        .map(([clusterId, count]) => ({ clusterId, ratio: count / total }))
        .sort((a, b) => b.ratio - a.ratio || a.clusterId - b.clusterId);
      issues.push({
        packageName: s.packageName,
        purity: s.purity,
        bas: s.bas,
        clusterDistribution: distribution,
      });
    }
    issues.sort((a, b) => a.packageName.localeCompare(b.packageName));
    return issues;
  }

  /**
   * A cluster is a cross-domain fusion when its entities come from multiple
   * packages: the non-dominant share is above `crossPackageThreshold` (>60%)
   * AND the dominant package holds less than `dominantCoverageThreshold` (<50%).
   */
  private static detectCrossDomainFusions(
    assignments: number[],
    entityNames: string[],
    depth: number,
    crossPackageThreshold: number,
    dominantCoverageThreshold: number
  ): CrossDomainFusion[] {
    const clusterCount = assignments.length > 0 ? Math.max(...assignments) + 1 : 0;
    const fusions: CrossDomainFusion[] = [];

    for (let c = 0; c < clusterCount; c++) {
      const memberIndices: number[] = [];
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === c) memberIndices.push(i);
      }
      if (memberIndices.length === 0) continue;

      const pkgCounts = new Map<string, number>();
      for (const i of memberIndices) {
        const pkg = BoundaryAlignmentScorer.extractPackage(entityNames[i], depth);
        pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
      }

      const total = memberIndices.length;
      const involvedPackages = Array.from(pkgCounts.entries())
        .map(([packageName, count]) => ({ packageName, ratio: count / total }))
        .sort((a, b) => b.ratio - a.ratio || a.packageName.localeCompare(b.packageName));

      const dominant = involvedPackages[0];
      if (dominant === undefined) continue;
      const crossPackageRatio = 1 - dominant.ratio;

      if (crossPackageRatio > crossPackageThreshold && dominant.ratio < dominantCoverageThreshold) {
        fusions.push({
          clusterId: c,
          involvedPackages,
          representativeEntities: memberIndices
            .map((i) => entityNames[i])
            .sort((a, b) => a.localeCompare(b)),
        });
      }
    }
    fusions.sort((a, b) => a.clusterId - b.clusterId);
    return fusions;
  }

  /** Per-cluster summary: size, dominant package, dominant share. */
  private static buildClusterSummaries(
    assignments: number[],
    entityNames: string[],
    depth: number
  ): ClusterSummary[] {
    const clusterCount = assignments.length > 0 ? Math.max(...assignments) + 1 : 0;
    const summaries: ClusterSummary[] = [];

    for (let c = 0; c < clusterCount; c++) {
      const memberIndices: number[] = [];
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === c) memberIndices.push(i);
      }
      if (memberIndices.length === 0) continue;

      const pkgCounts = new Map<string, number>();
      for (const i of memberIndices) {
        const pkg = BoundaryAlignmentScorer.extractPackage(entityNames[i], depth);
        pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
      }

      let dominantPackage = '';
      let maxCount = 0;
      for (const [pkg, count] of pkgCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominantPackage = pkg;
        }
      }

      summaries.push({
        clusterId: c,
        entityCount: memberIndices.length,
        dominantPackage,
        dominantPackageRatio: round4(maxCount / memberIndices.length),
      });
    }
    summaries.sort((a, b) => a.clusterId - b.clusterId);
    return summaries;
  }
}
