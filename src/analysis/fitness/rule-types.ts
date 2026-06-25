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

export type FitnessRule = MetricThresholdRule | DependencyConstraintRule;

export interface FitnessConfig {
  rules: FitnessRule[];
  failOnViolation: boolean;
}

export interface RuleResult {
  rule: FitnessRule;
  passed: boolean;
  actual?: number | string;
  detail?: string;
}
