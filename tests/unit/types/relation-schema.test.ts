import type { Relation, RelationType } from '@/types/index.js';
import { describe, it, expect } from 'vitest';

describe('Relation schema — call edge fields (Phase 89)', () => {
  it('RelationType includes call', () => {
    const t: RelationType = 'call';
    expect(t).toBe('call');
  });

  it('Relation with type=call can have method-level fields', () => {
    const r: Relation = {
      id: 'call:A.foo:B.bar',
      type: 'call',
      source: 'A',
      target: 'B',
      sourceMethod: 'foo',
      targetMethod: 'bar',
      callType: 'direct',
      confidence: 0.85,
      inferenceSource: 'explicit',
    };
    expect(r.sourceMethod).toBe('foo');
    expect(r.targetMethod).toBe('bar');
    expect(r.callType).toBe('direct');
  });

  it('Relation with type=dependency has undefined method fields', () => {
    const r: Relation = {
      id: 'dep:A:B',
      type: 'dependency',
      source: 'A',
      target: 'B',
    };
    expect(r.sourceMethod).toBeUndefined();
    expect(r.targetMethod).toBeUndefined();
    expect(r.callType).toBeUndefined();
  });

  it('inferenceSource accepts call-aggregated', () => {
    const r: Relation = {
      id: 'agg:A:B',
      type: 'dependency',
      source: 'A',
      target: 'B',
      inferenceSource: 'call-aggregated',
    };
    expect(r.inferenceSource).toBe('call-aggregated');
  });

  it('callType accepts all three variants', () => {
    const variants: Array<'direct' | 'interface' | 'indirect'> = ['direct', 'interface', 'indirect'];
    for (const v of variants) {
      const r: Relation = { id: `call:${v}`, type: 'call', source: 'A', target: 'B', callType: v };
      expect(r.callType).toBe(v);
    }
  });
});
