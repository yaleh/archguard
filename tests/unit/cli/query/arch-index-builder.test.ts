import { describe, it, expect } from 'vitest';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import type { ArchIndex } from '@/cli/query/arch-index.js';
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
  id?: string
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
  overrides: Partial<ArchJSON> = {}
): ArchJSON {
  return {
    version: '1.1',
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
    expect(index.entityTypes).toEqual({});
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
    expect(index.entityTypes).toEqual({ Foo: 'class' });
    expect(index.cycles).toEqual([]);
  });

  it('builds dependencies and dependents for two entities with a relation', () => {
    const a = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
    const b = makeEntity({
      id: 'B',
      name: 'B',
      sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 },
    });
    const rel = makeRelation('A', 'B');

    const index = buildArchIndex(makeArchJson([a, b], [rel]), 'h');

    expect(index.dependencies['A']).toEqual(['B']);
    expect(index.dependents['B']).toEqual(['A']);
    // A has no dependents, B has no dependencies (seeded as empty arrays)
    expect(index.dependents['A']).toEqual([]);
    expect(index.dependencies['B']).toEqual([]);
  });

  it('detects a cycle for bidirectional dependency', () => {
    const a = makeEntity({
      id: 'A',
      name: 'Alpha',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
    const b = makeEntity({
      id: 'B',
      name: 'Beta',
      sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 },
    });
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
    const a = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
    // Relation to external entity "X" not in entities
    const rel = makeRelation('A', 'X');

    const index = buildArchIndex(makeArchJson([a], [rel]), 'h');

    // A exists but has no dependencies (seeded empty); X is external, truly undefined
    expect(index.dependencies['A']).toEqual([]);
    expect(index.dependents['X']).toBeUndefined();
    expect(index.relationsByType).toEqual({});
  });

  it('handles multiple entities with the same name', () => {
    const e1 = makeEntity({
      id: 'mod1.Foo',
      name: 'Foo',
      sourceLocation: { file: 'mod1/foo.ts', startLine: 1, endLine: 5 },
    });
    const e2 = makeEntity({
      id: 'mod2.Foo',
      name: 'Foo',
      sourceLocation: { file: 'mod2/foo.ts', startLine: 1, endLine: 5 },
    });

    const index = buildArchIndex(makeArchJson([e1, e2]), 'h');

    expect(index.nameToIds['Foo']).toEqual(['mod1.Foo', 'mod2.Foo']);
  });

  it('groups relationsByType correctly', () => {
    const a = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
    const b = makeEntity({
      id: 'B',
      name: 'B',
      sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 },
    });
    const c = makeEntity({
      id: 'C',
      name: 'C',
      sourceLocation: { file: 'c.ts', startLine: 1, endLine: 5 },
    });
    const r1 = makeRelation('A', 'B', 'inheritance');
    const r2 = makeRelation('A', 'C', 'dependency');
    const r3 = makeRelation('B', 'C', 'dependency');

    const index = buildArchIndex(makeArchJson([a, b, c], [r1, r2, r3]), 'h');

    expect(index.relationsByType['inheritance']).toEqual([['A', 'B']]);
    expect(index.relationsByType['dependency']).toEqual([
      ['A', 'C'],
      ['B', 'C'],
    ]);
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
    const e1 = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'shared.ts', startLine: 1, endLine: 5 },
    });
    const e2 = makeEntity({
      id: 'B',
      name: 'B',
      sourceLocation: { file: 'shared.ts', startLine: 10, endLine: 20 },
    });
    const e3 = makeEntity({
      id: 'C',
      name: 'C',
      sourceLocation: { file: 'other.ts', startLine: 1, endLine: 5 },
    });

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
    const a = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
    const b = makeEntity({
      id: 'B',
      name: 'B',
      sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 },
    });
    const c = makeEntity({
      id: 'C',
      name: 'C',
      sourceLocation: { file: 'c.ts', startLine: 1, endLine: 5 },
    });
    const d = makeEntity({
      id: 'D',
      name: 'D',
      sourceLocation: { file: 'd.ts', startLine: 1, endLine: 5 },
    });
    const e = makeEntity({
      id: 'E',
      name: 'E',
      sourceLocation: { file: 'e.ts', startLine: 1, endLine: 5 },
    });

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
    const a = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
    const b = makeEntity({
      id: 'B',
      name: 'B',
      sourceLocation: { file: 'b.ts', startLine: 1, endLine: 5 },
    });
    const rel = makeRelation('A', 'B');

    const index = buildArchIndex(makeArchJson([a, b], [rel]), 'h');

    expect(index.cycles).toEqual([]);
  });

  it('filters out relations where source is not in entity set', () => {
    const a = makeEntity({
      id: 'A',
      name: 'A',
      sourceLocation: { file: 'a.ts', startLine: 1, endLine: 5 },
    });
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
    const qe = makeEntity({
      id: 'src/query-engine.ts.QueryEngine',
      name: 'QueryEngine',
      sourceLocation: { file: 'src/query-engine.ts', startLine: 1, endLine: 10 },
    });
    const aj = makeEntity({
      id: 'types/index.ts.ArchJSON',
      name: 'ArchJSON',
      sourceLocation: { file: 'types/index.ts', startLine: 1, endLine: 5 },
    });
    // target is bare name "ArchJSON", not the full ID
    const rel = makeRelation('src/query-engine.ts.QueryEngine', 'ArchJSON');

    const index = buildArchIndex(makeArchJson([qe, aj], [rel]), 'h');

    // Relation should be resolved and included
    expect(index.dependencies['src/query-engine.ts.QueryEngine']).toEqual([
      'types/index.ts.ArchJSON',
    ]);
    expect(index.dependents['types/index.ts.ArchJSON']).toEqual([
      'src/query-engine.ts.QueryEngine',
    ]);
  });

  it('drops bare-name relation when name is ambiguous (multiple entities with same name)', () => {
    const a1 = makeEntity({
      id: 'mod1.Foo',
      name: 'Foo',
      sourceLocation: { file: 'mod1/foo.ts', startLine: 1, endLine: 5 },
    });
    const a2 = makeEntity({
      id: 'mod2.Foo',
      name: 'Foo',
      sourceLocation: { file: 'mod2/foo.ts', startLine: 1, endLine: 5 },
    });
    const b = makeEntity({
      id: 'Bar',
      name: 'Bar',
      sourceLocation: { file: 'bar.ts', startLine: 1, endLine: 5 },
    });
    // "Foo" is ambiguous — two entities with that name → should not resolve
    const rel = makeRelation('Bar', 'Foo');

    const index = buildArchIndex(makeArchJson([a1, a2, b], [rel]), 'h');

    expect(index.dependencies['Bar']).toEqual([]);
    expect(index.relationsByType).toEqual({});
  });

  describe('externalRelationsByType', () => {
    // Mirrors the real shapes that motivated the field:
    //   class A extends ExternalBase                          → inheritance, external target
    //   class B implements LocalInterface                     → internal (control)
    //   class C implements MobileTerminalSelectionManager     → implementation, target is a
    //                                                           type alias the parser never
    //                                                           turned into an entity
    const localInterface = makeEntity({
      id: 'src/iface.ts.LocalInterface',
      name: 'LocalInterface',
      type: 'interface',
      sourceLocation: { file: 'src/iface.ts', startLine: 1, endLine: 5 },
    });
    const classA = makeEntity({
      id: 'src/a.ts.A',
      name: 'A',
      sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 5 },
    });
    const classB = makeEntity({
      id: 'src/b.ts.B',
      name: 'B',
      sourceLocation: { file: 'src/b.ts', startLine: 1, endLine: 5 },
    });
    const classC = makeEntity({
      id: 'src/c.ts.C',
      name: 'C',
      sourceLocation: { file: 'src/c.ts', startLine: 1, endLine: 5 },
    });

    const extendsExternal = makeRelation('src/a.ts.A', 'ExternalBase', 'inheritance');
    const implementsLocal = makeRelation(
      'src/b.ts.B',
      'src/iface.ts.LocalInterface',
      'implementation'
    );
    const implementsTypeAlias = makeRelation(
      'src/c.ts.C',
      'shared/types.ts.MobileTerminalSelectionManager',
      'implementation'
    );

    const entities = [localInterface, classA, classB, classC];
    const relations = [extendsExternal, implementsLocal, implementsTypeAlias];

    it('keeps unresolvable inheritance/implementation endpoints with raw from/to and type', () => {
      const index = buildArchIndex(makeArchJson(entities, relations), 'h');

      expect(index.externalRelationsByType).toEqual({
        inheritance: [
          {
            from: 'src/a.ts.A',
            to: 'ExternalBase',
            sourceResolved: true,
            targetResolved: false,
          },
        ],
        implementation: [
          {
            from: 'src/c.ts.C',
            to: 'shared/types.ts.MobileTerminalSelectionManager',
            sourceResolved: true,
            targetResolved: false,
          },
        ],
      });
    });

    it('negative control: fully internal relations stay only in relationsByType', () => {
      const index = buildArchIndex(makeArchJson(entities, relations), 'h');

      expect(index.relationsByType['implementation']).toEqual([
        ['src/b.ts.B', 'src/iface.ts.LocalInterface'],
      ]);
      // The internal implementation edge must not leak into the external bucket.
      expect(index.externalRelationsByType?.['implementation']).toHaveLength(1);
      expect(index.externalRelationsByType?.['implementation']?.[0].to).toBe(
        'shared/types.ts.MobileTerminalSelectionManager'
      );
    });

    it('does not add external endpoints to the adjacency maps', () => {
      const index = buildArchIndex(makeArchJson(entities, relations), 'h');

      // A's only external edge is dropped from BFS adjacency.
      expect(index.dependencies['src/a.ts.A']).toEqual([]);
      expect(index.dependents['src/a.ts.A']).toEqual([]);
      // No ghost keys for unresolved endpoints.
      expect(index.dependencies['ExternalBase']).toBeUndefined();
      expect(index.dependents['ExternalBase']).toBeUndefined();
      expect(index.dependencies).not.toHaveProperty(
        'shared/types.ts.MobileTerminalSelectionManager'
      );
      // The internal control edge is still there.
      expect(index.dependencies['src/b.ts.B']).toEqual(['src/iface.ts.LocalInterface']);
    });

    it('records an unresolved source endpoint too', () => {
      const rel = makeRelation('UnknownBase', 'src/a.ts.A', 'inheritance');
      const index = buildArchIndex(makeArchJson([classA], [rel]), 'h');

      expect(index.externalRelationsByType?.['inheritance']).toEqual([
        {
          from: 'UnknownBase',
          to: 'src/a.ts.A',
          sourceResolved: false,
          targetResolved: true,
        },
      ]);
    });

    it('deduplicates by (type, from, to) and preserves arch.json order', () => {
      const first = makeRelation('src/a.ts.A', 'ExternalBase', 'inheritance');
      const duplicate = makeRelation('src/a.ts.A', 'ExternalBase', 'inheritance', 'different-id');
      const other = makeRelation('src/a.ts.A', 'OtherExternal', 'inheritance');
      const differentType = makeRelation('src/a.ts.A', 'ExternalBase', 'dependency');

      const index = buildArchIndex(
        makeArchJson([classA], [first, duplicate, other, differentType]),
        'h'
      );

      expect(index.externalRelationsByType?.['inheritance']?.map((e) => e.to)).toEqual([
        'ExternalBase',
        'OtherExternal',
      ]);
      expect(index.externalRelationsByType?.['dependency']?.map((e) => e.to)).toEqual([
        'ExternalBase',
      ]);
      expect(index.externalRelationsByType?.['inheritance']).toHaveLength(2);
    });

    it('omits the field entirely when every relation resolves', () => {
      const index = buildArchIndex(
        makeArchJson(entities, [implementsLocal]),
        'h'
      );

      expect(index.externalRelationsByType).toBeUndefined();
      expect('externalRelationsByType' in index).toBe(false);
    });
  });

  describe('entityTypes', () => {
    // Fixture deliberately covers all four built-in kinds a UML class diagram
    // needs to stereotype: class, interface, function, enum.
    const entities: Entity[] = [
      makeEntity({ id: 'src/a.ts.AClass', name: 'AClass', type: 'class' }),
      makeEntity({ id: 'src/b.ts.IThing', name: 'IThing', type: 'interface' }),
      makeEntity({ id: 'src/c.ts.doWork', name: 'doWork', type: 'function' }),
      makeEntity({ id: 'src/d.ts.Color', name: 'Color', type: 'enum' }),
    ];

    it('records the type of every entity, in arch.json order', () => {
      const archJson = makeArchJson(entities);
      const index = buildArchIndex(archJson, 'h');

      // Full comparison, not a sample: one entry per entity, same key set.
      expect(Object.keys(index.entityTypes ?? {})).toEqual(entities.map((e) => e.id));

      const expected = Object.fromEntries(entities.map((e) => [e.id, e.type]));
      expect(index.entityTypes).toEqual(expected);

      for (const entity of archJson.entities) {
        expect(index.entityTypes?.[entity.id]).toBe(entity.type);
      }
    });

    it('covers exactly the same entity set as idToName', () => {
      const index = buildArchIndex(makeArchJson(entities), 'h');

      expect(Object.keys(index.entityTypes ?? {}).sort()).toEqual(
        Object.keys(index.idToName).sort()
      );
    });

    it('is optional: an old index without entityTypes still reads as a valid ArchIndex', () => {
      const index = buildArchIndex(makeArchJson([makeEntity({ id: 'A', name: 'A' })]), 'h');

      // Simulate an arch-index.json written before the field existed.
      const legacy = { ...index } as Record<string, unknown>;
      delete legacy.entityTypes;

      const reloaded = legacy as unknown as ArchIndex;
      expect(reloaded.entityTypes).toBeUndefined();
      // Readers must treat a missing field as empty, not throw.
      expect(reloaded.entityTypes ?? {}).toEqual({});
      // Everything else is unchanged.
      expect(reloaded.idToName).toEqual({ A: 'A' });
    });
  });
});
