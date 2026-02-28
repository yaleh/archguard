import { describe, it, expect } from 'vitest';
import { generateEntityId, createRelation } from '@/plugins/shared/mapper-utils.js';
import type { Relation } from '@/types/index.js';

describe('generateEntityId', () => {
  it('joins packageName and entityName with a dot', () => {
    expect(generateEntityId('pkg', 'Foo')).toBe('pkg.Foo');
  });

  it('handles multi-segment package names', () => {
    expect(generateEntityId('com.example', 'Bar')).toBe('com.example.Bar');
  });

  it('handles empty packageName', () => {
    expect(generateEntityId('', 'Baz')).toBe('.Baz');
  });
});

describe('createRelation', () => {
  it('returns a Relation with the correct type, source, and target', () => {
    const rel = createRelation('inheritance', 'Child', 'Parent');
    expect(rel.type).toBe('inheritance');
    expect(rel.source).toBe('Child');
    expect(rel.target).toBe('Parent');
  });

  it('generates id as source_type_target', () => {
    const rel = createRelation('implementation', 'MyClass', 'IFoo');
    expect(rel.id).toBe('MyClass_implementation_IFoo');
  });

  it('result is assignable to Relation type', () => {
    const rel: Relation = createRelation('dependency', 'A', 'B');
    expect(rel).toBeDefined();
  });

  it('works for all relation types', () => {
    const types = ['inheritance', 'implementation', 'composition', 'dependency'] as const;
    for (const type of types) {
      const rel = createRelation(type, 'S', 'T');
      expect(rel.type).toBe(type);
      expect(rel.id).toBe(`S_${type}_T`);
    }
  });
});
