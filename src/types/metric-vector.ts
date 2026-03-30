import type { RelationType } from './index.js';

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

  // --- Derived global metrics ---
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
