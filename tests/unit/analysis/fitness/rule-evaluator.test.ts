import { describe, it, expect } from 'vitest';
import { evaluateMetricRule, evaluateAllRules } from '@/analysis/fitness/rule-evaluator.js';
import type { MetricThresholdRule, FitnessRule } from '@/analysis/fitness/rule-types.js';
import type { MetricVector } from '@/types/metric-vector.js';
import type { Relation } from '@/types/index.js';

function makeVector(overrides: Partial<MetricVector> = {}): MetricVector {
  return {
    schemaVersion: 1,
    totalEntities: 10,
    totalRelations: 5,
    inferredRelationRatio: 0.1,
    sccCount: 0,
    relationTypeBreakdown: {},
    maxInDegree: 5,
    maxOutDegree: 5,
    maxPackageSize: 10,
    giniInDegree: 0.2,
    giniPackageSize: 0.3,
    packageCount: 3,
    ...overrides,
  };
}

describe('evaluateMetricRule', () => {
  it('test 1: sccCount <= 0, actual=0 → passed=true', () => {
    const rule: MetricThresholdRule = {
      metric: 'sccCount',
      op: '<=',
      value: 0,
      message: 'No cycles allowed',
    };
    const vector = makeVector({ sccCount: 0 });
    const result = evaluateMetricRule(rule, vector);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(0);
  });

  it('test 2: sccCount <= 0, actual=2 → passed=false, actual=2', () => {
    const rule: MetricThresholdRule = {
      metric: 'sccCount',
      op: '<=',
      value: 0,
      message: 'No cycles allowed',
    };
    const vector = makeVector({ sccCount: 2 });
    const result = evaluateMetricRule(rule, vector);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(2);
  });

  it('test 3: maxInDegree < 20, actual=15 → passed=true', () => {
    const rule: MetricThresholdRule = {
      metric: 'maxInDegree',
      op: '<',
      value: 20,
      message: 'Max in-degree too high',
    };
    const vector = makeVector({ maxInDegree: 15 });
    const result = evaluateMetricRule(rule, vector);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(15);
  });

  it('test 4: maxInDegree < 20, actual=25 → passed=false, actual=25', () => {
    const rule: MetricThresholdRule = {
      metric: 'maxInDegree',
      op: '<',
      value: 20,
      message: 'Max in-degree too high',
    };
    const vector = makeVector({ maxInDegree: 25 });
    const result = evaluateMetricRule(rule, vector);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(25);
  });

  it('test 5: all 6 comparison operators work correctly', () => {
    const base = makeVector({ sccCount: 5 });

    const lt: MetricThresholdRule = { metric: 'sccCount', op: '<', value: 10, message: '' };
    expect(evaluateMetricRule(lt, base).passed).toBe(true);
    const ltFail: MetricThresholdRule = { metric: 'sccCount', op: '<', value: 5, message: '' };
    expect(evaluateMetricRule(ltFail, base).passed).toBe(false);

    const lte: MetricThresholdRule = { metric: 'sccCount', op: '<=', value: 5, message: '' };
    expect(evaluateMetricRule(lte, base).passed).toBe(true);
    const lteFail: MetricThresholdRule = { metric: 'sccCount', op: '<=', value: 4, message: '' };
    expect(evaluateMetricRule(lteFail, base).passed).toBe(false);

    const gt: MetricThresholdRule = { metric: 'sccCount', op: '>', value: 4, message: '' };
    expect(evaluateMetricRule(gt, base).passed).toBe(true);
    const gtFail: MetricThresholdRule = { metric: 'sccCount', op: '>', value: 5, message: '' };
    expect(evaluateMetricRule(gtFail, base).passed).toBe(false);

    const gte: MetricThresholdRule = { metric: 'sccCount', op: '>=', value: 5, message: '' };
    expect(evaluateMetricRule(gte, base).passed).toBe(true);
    const gteFail: MetricThresholdRule = { metric: 'sccCount', op: '>=', value: 6, message: '' };
    expect(evaluateMetricRule(gteFail, base).passed).toBe(false);

    const eq: MetricThresholdRule = { metric: 'sccCount', op: '==', value: 5, message: '' };
    expect(evaluateMetricRule(eq, base).passed).toBe(true);
    const eqFail: MetricThresholdRule = { metric: 'sccCount', op: '==', value: 6, message: '' };
    expect(evaluateMetricRule(eqFail, base).passed).toBe(false);

    const neq: MetricThresholdRule = { metric: 'sccCount', op: '!=', value: 6, message: '' };
    expect(evaluateMetricRule(neq, base).passed).toBe(true);
    const neqFail: MetricThresholdRule = { metric: 'sccCount', op: '!=', value: 5, message: '' };
    expect(evaluateMetricRule(neqFail, base).passed).toBe(false);
  });

  it('test 6: unknown metric key → passed=false, detail includes "Unknown metric"', () => {
    const rule: MetricThresholdRule = {
      metric: 'nonExistentMetric',
      op: '<',
      value: 10,
      message: 'Should fail',
    };
    const vector = makeVector();
    const result = evaluateMetricRule(rule, vector);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Unknown metric');
  });

  it('test 7: null metric value (entityCoverageRatio=null) → passed=false, detail includes "not available"', () => {
    const rule: MetricThresholdRule = {
      metric: 'entityCoverageRatio',
      op: '>',
      value: 0.5,
      message: 'Coverage too low',
    };
    const vector = makeVector({ entityCoverageRatio: null });
    const result = evaluateMetricRule(rule, vector);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('not available');
  });
});

describe('evaluateAllRules', () => {
  it('evaluates metric rules and dependency rules together', () => {
    const metricRule: FitnessRule = {
      metric: 'sccCount',
      op: '<=',
      value: 0,
      message: 'No cycles',
    };
    const depRule: FitnessRule = {
      type: 'no-dependency',
      from: 'src/parser/**',
      to: 'src/cli/**',
      message: 'No parser→cli',
    };
    const vector = makeVector({ sccCount: 0 });
    const relations: Relation[] = [
      { id: 'r1', type: 'dependency', source: 'src/parser/foo', target: 'src/utils/bar' },
    ];
    const results = evaluateAllRules([metricRule, depRule], vector, relations);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(true);
  });
});
