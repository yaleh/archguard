/**
 * TDD tests for generateRelationLine returning null for call-type relations (Phase 90.2)
 */
import { describe, it, expect } from 'vitest';
import { generateRelationLine } from '@/mermaid/generator-formatting.js';
import type { Relation } from '@/types/index.js';

function makeRelation(overrides: Partial<Relation> & { type: Relation['type'] }): Relation {
  return {
    id: 'rel-1',
    source: 'pkg.A',
    target: 'pkg.B',
    ...overrides,
  };
}

const entityMap = new Map([
  ['pkg.A', 'A'],
  ['pkg.B', 'B'],
]);

describe('generateRelationLine — call type returns null', () => {
  it('returns null for type=call', () => {
    const relation = makeRelation({
      type: 'call',
      sourceMethod: 'doWork',
      targetMethod: 'process',
      callType: 'direct',
    });
    expect(generateRelationLine(relation, entityMap)).toBeNull();
  });
});

describe('generateRelationLine — non-call types return non-null strings', () => {
  it('returns a non-null string for type=dependency', () => {
    const relation = makeRelation({ type: 'dependency' });
    const result = generateRelationLine(relation, entityMap);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result).toContain('-->');
  });

  it('returns a non-null string for type=inheritance', () => {
    const relation = makeRelation({ type: 'inheritance' });
    const result = generateRelationLine(relation, entityMap);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result).toContain('<|--');
  });

  it('returns a non-null string for type=implementation', () => {
    const relation = makeRelation({ type: 'implementation' });
    const result = generateRelationLine(relation, entityMap);
    expect(result).not.toBeNull();
    expect(result).toContain('<|..');
  });

  it('returns a non-null string for type=composition', () => {
    const relation = makeRelation({ type: 'composition' });
    const result = generateRelationLine(relation, entityMap);
    expect(result).not.toBeNull();
    expect(result).toContain('*--');
  });

  it('returns a non-null string for type=aggregation', () => {
    const relation = makeRelation({ type: 'aggregation' });
    const result = generateRelationLine(relation, entityMap);
    expect(result).not.toBeNull();
    expect(result).toContain('o--');
  });
});
