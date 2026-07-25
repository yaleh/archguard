/**
 * Re-exports from src/types/fitness-rules.js to avoid breaking existing imports.
 *
 * The canonical definitions now live in src/types/ to break the types↔analysis
 * bidirectional dependency cycle (DIR-001). This file exists for backward
 * compatibility — new code should import from '@/types/fitness-rules.js'.
 */

export type {
  ComparisonOp,
  MetricThresholdRule,
  DependencyConstraintRule,
  GimLossType,
  GimLossRule,
  FitnessRule,
  FitnessConfig,
  RuleResult,
} from '@/types/fitness-rules.js';
