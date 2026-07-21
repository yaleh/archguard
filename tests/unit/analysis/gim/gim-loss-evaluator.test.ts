import { describe, it, expect } from 'vitest';
import { evaluateGimLossRule, computeAllLosses } from '@/analysis/gim/gim-loss-evaluator.js';
import type { GimLossRule } from '@/analysis/fitness/rule-types.js';
import type { MetricVector } from '@/types/metric-vector.js';

function makeVector(overrides: Partial<MetricVector> = {}): MetricVector {
  return {
    schemaVersion: 1,
    totalEntities: 514,
    totalRelations: 370,
    inferredRelationRatio: 0.12,
    sccCount: 0,
    relationTypeBreakdown: {},
    maxInDegree: 196,
    maxOutDegree: 95,
    maxPackageSize: 50,
    giniInDegree: 0.776,
    giniPackageSize: 0.5,
    packageCount: 33,
    ...overrides,
  };
}

function gimLossRule(loss: GimLossRule['loss'], op: GimLossRule['op'], value: number): GimLossRule {
  return { type: 'gim-loss', loss, op, value, message: `${loss} check` };
}

describe('evaluateGimLossRule', () => {
  it('feasibility: sccCount=0 passes == 0', () => {
    const result = evaluateGimLossRule(gimLossRule('feasibility', '==', 0), makeVector({ sccCount: 0 }));
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(0);
  });

  it('feasibility: sccCount=3 fails == 0', () => {
    const result = evaluateGimLossRule(gimLossRule('feasibility', '==', 0), makeVector({ sccCount: 3 }));
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(3);
  });

  it('consistency: inferredRelationRatio=0.12 passes <= 0.3', () => {
    const result = evaluateGimLossRule(gimLossRule('consistency', '<=', 0.3), makeVector({ inferredRelationRatio: 0.12 }));
    expect(result.passed).toBe(true);
  });

  it('consistency: inferredRelationRatio=0.5 fails <= 0.3', () => {
    const result = evaluateGimLossRule(gimLossRule('consistency', '<=', 0.3), makeVector({ inferredRelationRatio: 0.5 }));
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(0.5);
  });

  it('description-length: 514+370=884 passes <= 1500', () => {
    const result = evaluateGimLossRule(gimLossRule('description-length', '<=', 1500), makeVector({ totalEntities: 514, totalRelations: 370 }));
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(884);
  });

  it('generation-alignment: giniInDegree=0.776 fails <= 0.5', () => {
    const result = evaluateGimLossRule(gimLossRule('generation-alignment', '<=', 0.5), makeVector({ giniInDegree: 0.776 }));
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(0.776);
  });

  it('computeAllLosses: healthy vector → all statuses with proxy:true', () => {
    const losses = computeAllLosses(makeVector({ sccCount: 0, inferredRelationRatio: 0.1, giniInDegree: 0.4 }));
    expect(losses.feasibility.proxy).toBe(true);
    expect(losses.consistency.proxy).toBe(true);
    expect(['description-length' in losses]).toBeTruthy();
    expect(losses['generation-alignment'].proxy).toBe(true);
  });

  it('computeAllLosses: unhealthy vector → feasibility/alignment warning', () => {
    const losses = computeAllLosses(makeVector({ sccCount: 5, giniInDegree: 0.9 }));
    expect(losses.feasibility.status).toBe('warning');
    expect(losses['generation-alignment'].status).toBe('warning');
  });

  it('unknown loss type → fails with detail message', () => {
    const badRule = { type: 'gim-loss' as const, loss: 'stability' as GimLossRule['loss'], op: '==' as const, value: 0, message: 'bad' };
    const result = evaluateGimLossRule(badRule, makeVector());
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/unknown/i);
  });
});
