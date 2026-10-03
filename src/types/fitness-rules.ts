/**
 * Fitness rule types — lifted from src/analysis/fitness/ to src/types/
 * to break the types↔analysis bidirectional dependency cycle (DIR-001).
 *
 * These are pure type definitions with no runtime analysis dependencies;
 * they belong in the types layer alongside other config interfaces.
 */

export type ComparisonOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface MetricThresholdRule {
  type?: 'metric'; // default when omitted
  metric: string; // key from MetricVector (e.g. 'sccCount', 'maxInDegree')
  op: ComparisonOp;
  value: number;
  message: string;
}

export interface DependencyConstraintRule {
  type: 'no-dependency';
  from: string; // glob pattern (e.g. 'src/parser/**')
  to: string; // glob pattern (e.g. 'src/cli/**')
  message: string;
}

export type GimLossType =
  | 'feasibility'
  | 'consistency'
  | 'description-length'
  | 'generation-alignment';

export interface GimLossRule {
  type: 'gim-loss';
  loss: GimLossType;
  op: ComparisonOp;
  value: number;
  message: string;
}

export type FitnessRule = MetricThresholdRule | DependencyConstraintRule | GimLossRule;

export interface FitnessConfig {
  rules: FitnessRule[];
  failOnViolation: boolean;
}

export interface RuleResult {
  rule: FitnessRule;
  /**
   * Whether the rule's constraint held. Only meaningful when `evaluated` is
   * not `false`; a not-evaluated result must never be read as a pass.
   */
  passed: boolean;
  actual?: number | string;
  detail?: string;
  /**
   * Tri-state marker (A4): `false` means the rule could not be evaluated —
   * e.g. a `no-dependency` rule with no relation artifact available. Omitted
   * (or `true`) means it was evaluated normally. Callers must surface
   * not-evaluated results distinctly from both pass and fail.
   */
  evaluated?: boolean;
}
