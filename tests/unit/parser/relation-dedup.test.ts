/**
 * Unit tests for the shared relation deduplication helper.
 *
 * Regression: gap-call-edge-dedup-collapses-method-edges — the historical
 * class-level key `${type}:${source}:${target}` collapsed method-level call
 * edges, so two methods calling the same target method produced one edge.
 */
import { describe, it, expect } from 'vitest';
import { deduplicateRelations, relationDedupKey } from '@/parser/relation-dedup.js';
import type { Relation } from '@/types/index.js';

function callEdge(overrides: Partial<Relation> = {}): Relation {
  return {
    id: 'call:src/a.ts.A.m1:src/b.ts.B.x',
    type: 'call',
    source: 'src/a.ts.A',
    target: 'src/b.ts.B',
    sourceMethod: 'm1',
    targetMethod: 'x',
    ...overrides,
  };
}

describe('relationDedupKey', () => {
  it('includes source/target method for call edges', () => {
    const m1 = callEdge({ sourceMethod: 'm1' });
    const m2 = callEdge({ sourceMethod: 'm2' });
    expect(relationDedupKey(m1)).not.toBe(relationDedupKey(m2));
  });

  it('keeps the class-level key for non-call relations', () => {
    const inheritance: Relation = {
      id: 'inheritance:src/a.ts.A:src/b.ts.Base',
      type: 'inheritance',
      source: 'src/a.ts.A',
      target: 'src/b.ts.Base',
    };
    expect(relationDedupKey(inheritance)).toBe('inheritance:src/a.ts.A:src/b.ts.Base');
  });
});

describe('deduplicateRelations', () => {
  it('keeps both call edges when two methods call the same target method', () => {
    const edges = [
      callEdge({ id: 'call:src/a.ts.A.m1:src/b.ts.B.x', sourceMethod: 'm1' }),
      callEdge({ id: 'call:src/a.ts.A.m2:src/b.ts.B.x', sourceMethod: 'm2' }),
    ];

    const unique = deduplicateRelations(edges);

    expect(unique).toHaveLength(2);
    expect(unique.map((r) => r.sourceMethod)).toEqual(['m1', 'm2']);
  });

  it('collapses exact duplicate call edges', () => {
    const edge = callEdge();
    expect(deduplicateRelations([edge, { ...edge }])).toHaveLength(1);
  });

  it('collapses duplicate non-call relations at class granularity (behavior unchanged)', () => {
    const dependency: Relation = {
      id: 'dependency:src/a.ts.A:src/b.ts.B',
      type: 'dependency',
      source: 'src/a.ts.A',
      target: 'src/b.ts.B',
    };
    const duplicate: Relation = {
      id: 'dependency:src/a.ts.A:src/b.ts.B#2',
      type: 'dependency',
      source: 'src/a.ts.A',
      target: 'src/b.ts.B',
    };

    expect(deduplicateRelations([dependency, duplicate])).toHaveLength(1);
  });

  it('preserves first-seen order', () => {
    const a = callEdge({ id: 'call:a', sourceMethod: 'a' });
    const b = callEdge({ id: 'call:b', sourceMethod: 'b' });
    const c = callEdge({ id: 'call:c', sourceMethod: 'c' });

    expect(deduplicateRelations([b, a, c, b]).map((r) => r.id)).toEqual([
      'call:b',
      'call:a',
      'call:c',
    ]);
  });
});
