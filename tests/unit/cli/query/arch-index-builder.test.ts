import { describe, it, expect } from 'vitest';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import type { ArchJSON, Entity, Relation, RelationType } from '@/types/index.js';

// ── helpers ──────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  return {
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: 'src/default.ts', startLine: 1, endLine: 10 },
    ...overrides,
  };
}

function makeRelation(
  source: string,
  target: string,
  type: RelationType = 'dependency',
  id?: string,
): Relation {
  return {
    id: id ?? `${source}->${target}`,
    type,
    source,
    target,
  };
}

function makeArchJson(
  entities: Entity[] = [],
  relations: Relation[] = [],
  overrides: Partial<ArchJSON> = {},
): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00.000Z',
    sourceFiles: [],
    entities,
    relations,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────

describe('buildArchIndex', () => {
  it('returns empty index for empty ArchJSON', () => {
    const index = buildArchIndex(makeArchJson(), 'abc123');

    expect(index.version).toBe('1.0');
    expect(index.archJsonHash).toBe('abc123');
    expect(index.language).toBe('typescript');
    expect(index.nameToIds).toEqual({});
    expect(index.idToFile).toEqual({});
    expect(index.idToName).toEqual({});
    expect(index.dependents).toEqual({});
    expect(index.dependencies).toEqual({});
    expect(index.relationsByType).toEqual({});
    expect(index.fileToIds).toEqual({});
    expect(index.cycles).toEqual([]);
    expect(index.generatedAt).toBeTruthy();
  });

  it('populates maps for a single entity', () => {
    const entity = makeEntity({
      id: 'Foo',
      name: 'Foo',
      sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 20 },
    });
    const index = buildArchIndex(makeArchJson([entity]), 'hash1');

    expect(index.idToName).toEqual({ Foo: 'Foo' });
    expect(index.idToFile).toEqual({ Foo: 'src/foo.ts' });
    expect(index.nameToIds).toEqual({ Foo: ['Foo'] });
    expect(index.fileToIds).toEqual({ 'src/foo.ts': ['Foo'] });
    expect(index.cycles).toEqual([]);
  });

  it('builds dependencies and dependents for two entities with a relation', () => {
    const a = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    const b = makeEntity({ id: 'B', name: 'B', sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } });
    const rel = makeRelation('A', 'B');

    const index = buildArchIndex(makeArchJson([a, b], [rel]), 'h');

    expect(index.dependencies['A']).toEqual(['B']);
    expect(index.dependents['B']).toEqual(['A']);
    // A has no dependents, B has no dependencies (seeded as empty arrays)
    expect(index.dependents['A']).toEqual([]);
    expect(index.dependencies['B']).toEqual([]);
  });

  it('detects a cycle for bidirectional dependency', () => {
    const a = makeEntity({ id: 'A', name: 'Alpha', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    const b = makeEntity({ id: 'B', name: 'Beta', sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } });
    const r1 = makeRelation('A', 'B');
    const r2 = makeRelation('B', 'A');

    const index = buildArchIndex(makeArchJson([a, b], [r1, r2]), 'h');

    expect(index.cycles).toHaveLength(1);
    expect(index.cycles[0].size).toBe(2);
    expect(index.cycles[0].members).toContain('A');
    expect(index.cycles[0].members).toContain('B');
    expect(index.cycles[0].memberNames).toContain('Alpha');
    expect(index.cycles[0].memberNames).toContain('Beta');
    expect(index.cycles[0].files).toContain('a.ts');
    expect(index.cycles[0].files).toContain('b.ts');
  });

  it('filters out relations where target is not in entity set', () => {
    const a = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    // Relation to external entity "X" not in entities
    const rel = makeRelation('A', 'X');

    const index = buildArchIndex(makeArchJson([a], [rel]), 'h');

    // A exists but has no dependencies (seeded empty); X is external, truly undefined
    expect(index.dependencies['A']).toEqual([]);
    expect(index.dependents['X']).toBeUndefined();
    expect(index.relationsByType).toEqual({});
  });

  it('handles multiple entities with the same name', () => {
    const e1 = makeEntity({ id: 'mod1.Foo', name: 'Foo', sourceLocation: { file: 'mod1/foo.ts', startLine: 1, endLine: 5 } });
    const e2 = makeEntity({ id: 'mod2.Foo', name: 'Foo', sourceLocation: { file: 'mod2/foo.ts', startLine: 1, endLine: 5 } });

    const index = buildArchIndex(makeArchJson([e1, e2]), 'h');

    expect(index.nameToIds['Foo']).toEqual(['mod1.Foo', 'mod2.Foo']);
  });

  it('groups relationsByType correctly', () => {
    const a = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    const b = makeEntity({ id: 'B', name: 'B', sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } });
    const c = makeEntity({ id: 'C', name: 'C', sourceLocation: { file: 'c.ts', startLine: 1, endLine: 5 } });
    const r1 = makeRelation('A', 'B', 'inheritance');
    const r2 = makeRelation('A', 'C', 'dependency');
    const r3 = makeRelation('B', 'C', 'dependency');

    const index = buildArchIndex(makeArchJson([a, b, c], [r1, r2, r3]), 'h');

    expect(index.relationsByType['inheritance']).toEqual([['A', 'B']]);
    expect(index.relationsByType['dependency']).toEqual([['A', 'C'], ['B', 'C']]);
  });

  it('maps entity to sourceLocation.file via idToFile', () => {
    const e = makeEntity({
      id: 'X',
      name: 'X',
      sourceLocation: { file: 'deep/nested/file.ts', startLine: 10, endLine: 30 },
    });
    const index = buildArchIndex(makeArchJson([e]), 'h');

    expect(index.idToFile['X']).toBe('deep/nested/file.ts');
  });

  it('maps file to all entity IDs via fileToIds', () => {
    const e1 = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'shared.ts', startLine: 1, endLine: 5 } });
    const e2 = makeEntity({ id: 'B', name: 'B', sourceLocation: { file: 'shared.ts', startLine: 10, endLine: 20 } });
    const e3 = makeEntity({ id: 'C', name: 'C', sourceLocation: { file: 'other.ts', startLine: 1, endLine: 5 } });

    const index = buildArchIndex(makeArchJson([e1, e2, e3]), 'h');

    expect(index.fileToIds['shared.ts']).toEqual(['A', 'B']);
    expect(index.fileToIds['other.ts']).toEqual(['C']);
  });

  it('stores archJsonHash correctly', () => {
    const hash = 'deadbeef1234567890abcdef';
    const index = buildArchIndex(makeArchJson(), hash);

    expect(index.archJsonHash).toBe(hash);
  });

  it('sorts cycles by size descending', () => {
    // Build a 3-node cycle (A→B→C→A) and a 2-node cycle (D↔E)
    const a = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    const b = makeEntity({ id: 'B', name: 'B', sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } });
    const c = makeEntity({ id: 'C', name: 'C', sourceLocation: { file: 'c.ts', startLine: 1, endLine: 5 } });
    const d = makeEntity({ id: 'D', name: 'D', sourceLocation: { file: 'd.ts', startLine: 1, endLine: 5 } });
    const e = makeEntity({ id: 'E', name: 'E', sourceLocation: { file: 'e.ts', startLine: 1, endLine: 5 } });

    const rels = [
      makeRelation('A', 'B'),
      makeRelation('B', 'C'),
      makeRelation('C', 'A'),
      makeRelation('D', 'E'),
      makeRelation('E', 'D'),
    ];

    const index = buildArchIndex(makeArchJson([a, b, c, d, e], rels), 'h');

    expect(index.cycles).toHaveLength(2);
    expect(index.cycles[0].size).toBe(3);
    expect(index.cycles[1].size).toBe(2);
  });

  it('does not include singleton SCCs in cycles', () => {
    // A→B (no cycle, just a linear dependency)
    const a = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    const b = makeEntity({ id: 'B', name: 'B', sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 } });
    const rel = makeRelation('A', 'B');

    const index = buildArchIndex(makeArchJson([a, b], [rel]), 'h');

    expect(index.cycles).toEqual([]);
  });

  it('filters out relations where source is not in entity set', () => {
    const a = makeEntity({ id: 'A', name: 'A', sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 } });
    // Relation from external "X" to internal "A"
    const rel = makeRelation('X', 'A');

    const index = buildArchIndex(makeArchJson([a], [rel]), 'h');

    // A exists but has no dependents (seeded empty); X is external, truly undefined
    expect(index.dependents['A']).toEqual([]);
    expect(index.dependencies['X']).toBeUndefined();
    expect(index.relationsByType).toEqual({});
  });

  it('resolves bare-name relation endpoints to full entity IDs (TypeScript parser mixed format)', () => {
    // Simulates the real-world case where the TypeScript parser emits relations like:
    //   source: "src/query-engine.ts.QueryEngine"  (full ID)
    //   target: "ArchJSON"                         (bare class name, not a full ID)
    // The index builder must resolve "ArchJSON" → "types/index.ts.ArchJSON" via nameToIds.
    const qe = makeEntity({ id: 'src/query-engine.ts.QueryEngine', name: 'QueryEngine', sourceLocation: { file: 'src/query-engine.ts', startLine: 1, endLine: 10 } });
    const aj = makeEntity({ id: 'types/index.ts.ArchJSON', name: 'ArchJSON', sourceLocation: { file: 'types/index.ts', startLine: 1, endLine: 5 } });
    // target is bare name "ArchJSON", not the full ID
    const rel = makeRelation('src/query-engine.ts.QueryEngine', 'ArchJSON');

    const index = buildArchIndex(makeArchJson([qe, aj], [rel]), 'h');

    // Relation should be resolved and included
    expect(index.dependencies['src/query-engine.ts.QueryEngine']).toEqual(['types/index.ts.ArchJSON']);
    expect(index.dependents['types/index.ts.ArchJSON']).toEqual(['src/query-engine.ts.QueryEngine']);
  });

  it('drops bare-name relation when name is ambiguous (multiple entities with same name)', () => {
    const a1 = makeEntity({ id: 'mod1.Foo', name: 'Foo', sourceLocation: { file: 'mod1/foo.ts', startLine: 1, endLine: 5 } });
    const a2 = makeEntity({ id: 'mod2.Foo', name: 'Foo', sourceLocation: { file: 'mod2/foo.ts', startLine: 1, endLine: 5 } });
    const b = makeEntity({ id: 'Bar', name: 'Bar', sourceLocation: { file: 'bar.ts', startLine: 1, endLine: 5 } });
    // "Foo" is ambiguous — two entities with that name → should not resolve
    const rel = makeRelation('Bar', 'Foo');

    const index = buildArchIndex(makeArchJson([a1, a2, b], [rel]), 'h');

    expect(index.dependencies['Bar']).toEqual([]);
    expect(index.relationsByType).toEqual({});
  });
});
