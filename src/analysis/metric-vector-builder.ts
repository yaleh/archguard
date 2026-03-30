import { giniCoefficient } from './gini.js';
import type { ArchJSON } from '@/types/index.js';
import type { PackageStatEntry } from '@/cli/query/query-engine.js';
import type { MetricVector } from '@/types/metric-vector.js';

export function buildMetricVector(archJson: ArchJSON, packageStats: PackageStatEntry[]): MetricVector {
  const metrics = archJson.metrics;
  const fileStats = metrics?.fileStats ?? [];

  return {
    schemaVersion: 1,
    totalEntities: metrics?.entityCount ?? 0,
    totalRelations: metrics?.relationCount ?? 0,
    inferredRelationRatio: metrics?.inferredRelationRatio ?? 0,
    sccCount: (metrics?.cycles ?? []).length,
    relationTypeBreakdown: metrics?.relationTypeBreakdown ?? {},
    maxInDegree: fileStats.length > 0 ? Math.max(...fileStats.map(f => f.inDegree)) : 0,
    maxOutDegree: fileStats.length > 0 ? Math.max(...fileStats.map(f => f.outDegree)) : 0,
    maxPackageSize: packageStats.length > 0 ? Math.max(...packageStats.map(p => p.fileCount)) : 0,
    giniInDegree: giniCoefficient(fileStats.map(f => f.inDegree)),
    giniPackageSize: giniCoefficient(packageStats.map(p => p.fileCount)),
    packageCount: packageStats.length,
    entityCoverageRatio: archJson.extensions?.testAnalysis?.metrics?.entityCoverageRatio ?? null,
  };
}
