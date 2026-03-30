import type { MetricThresholdRule, FitnessRule, RuleResult } from './rule-types.js';
import type { MetricVector } from '@/types/metric-vector.js';
import type { Relation } from '@/types/index.js';
import { checkDependencyConstraint } from './dependency-checker.js';

const KNOWN_METRIC_KEYS = new Set<string>([
  'schemaVersion',
  'totalEntities',
  'totalRelations',
  'inferredRelationRatio',
  'sccCount',
  'maxInDegree',
  'maxOutDegree',
  'maxPackageSize',
  'giniInDegree',
  'giniPackageSize',
  'packageCount',
  'entityCoverageRatio',
]);

function compare(actual: number, op: MetricThresholdRule['op'], threshold: number): boolean {
  switch (op) {
    case '<':  return actual < threshold;
    case '<=': return actual <= threshold;
    case '>':  return actual > threshold;
    case '>=': return actual >= threshold;
    case '==': return actual === threshold;
    case '!=': return actual !== threshold;
  }
}

export function evaluateMetricRule(rule: MetricThresholdRule, vector: MetricVector): RuleResult {
  if (!KNOWN_METRIC_KEYS.has(rule.metric)) {
    return {
      rule,
      passed: false,
      detail: `Unknown metric: '${rule.metric}'`,
    };
  }

  const raw = (vector as unknown as Record<string, unknown>)[rule.metric];

  if (raw === null || raw === undefined) {
    return {
      rule,
      passed: false,
      detail: `Metric '${rule.metric}' is not available (did you run with --include-tests?)`,
    };
  }

  const actual = raw as number;
  const passed = compare(actual, rule.op, rule.value);
  return { rule, passed, actual };
}

export function evaluateAllRules(rules: FitnessRule[], vector: MetricVector, relations: Relation[]): RuleResult[] {
  return rules.map((rule) => {
    if (rule.type === 'no-dependency') {
      return checkDependencyConstraint(rule, relations);
    }
    return evaluateMetricRule(rule as MetricThresholdRule, vector);
  });
}
