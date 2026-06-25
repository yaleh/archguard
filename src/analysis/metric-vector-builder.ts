import { giniCoefficient } from './gini.js';
import type { ArchJSON } from '@/types/index.js';
import type { PackageStatEntry } from '@/cli/query/query-engine.js';
import type { MetricVector } from '@/types/metric-vector.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';

export function buildMetricVector(
  archJson: ArchJSON,
  packageStats: PackageStatEntry[]
): MetricVector {
  const metrics = archJson.metrics;
  const fileStats = metrics?.fileStats ?? [];

  // Compute inDegree distribution from fileStats (file-level)
  const fileInDegrees = fileStats.map((f) => f.inDegree);
  const fileMaxInDegree = fileInDegrees.length > 0 ? Math.max(...fileInDegrees) : 0;

  // When Go Atlas package graph is present, compute package-level inDegree distribution
  const accessor = new ExtensionAccessor(archJson);
  const packageGraph = accessor.getAtlasLayer('package');
  let atlasInDegrees: number[] | undefined;
  if (packageGraph && packageGraph.nodes.length > 0) {
    const inDegreeMap = new Map<string, number>();
    for (const node of packageGraph.nodes) inDegreeMap.set(node.id, 0);
    for (const edge of packageGraph.edges) {
      if (edge.source !== edge.target) {
        inDegreeMap.set(edge.target, (inDegreeMap.get(edge.target) ?? 0) + 1);
      }
    }
    atlasInDegrees = [...inDegreeMap.values()];
  }

  const effectiveInDegrees = atlasInDegrees ?? fileInDegrees;
  const effectiveMaxInDegree =
    atlasInDegrees !== undefined
      ? atlasInDegrees.length > 0
        ? Math.max(...atlasInDegrees)
        : 0
      : fileMaxInDegree;

  // Take the max of both when both are available
  const maxInDegree =
    atlasInDegrees !== undefined
      ? Math.max(effectiveMaxInDegree, fileMaxInDegree)
      : fileMaxInDegree;

  return {
    schemaVersion: 1,
    totalEntities: metrics?.entityCount ?? 0,
    totalRelations: metrics?.relationCount ?? 0,
    inferredRelationRatio: metrics?.inferredRelationRatio ?? 0,
    sccCount: (metrics?.cycles ?? []).length,
    relationTypeBreakdown: metrics?.relationTypeBreakdown ?? {},
    maxInDegree,
    maxOutDegree: fileStats.length > 0 ? Math.max(...fileStats.map((f) => f.outDegree)) : 0,
    maxPackageSize: packageStats.length > 0 ? Math.max(...packageStats.map((p) => p.fileCount)) : 0,
    giniInDegree: giniCoefficient(effectiveInDegrees),
    giniPackageSize: giniCoefficient(packageStats.map((p) => p.fileCount)),
    packageCount: packageStats.length,
    entityCoverageRatio: accessor.getTestAnalysis()?.metrics?.entityCoverageRatio ?? null,
  };
}
