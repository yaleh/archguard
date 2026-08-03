/**
 * Unit tests for buildArchIndex() — a pure function that constructs an ArchIndex
 * from an ArchJSON snapshot. No I/O, no network, no process spawns.
 */

import { describe, it, expect } from 'vitest';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import { ARCH_INDEX_VERSION } from '@/core/query/arch-index.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Minimal factory helpers
// ---------------------------------------------------------------------------

function makeEntity(id: string, name: string, file = 'src/foo.ts'): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

function makeRelation(
  id: string,
  source: string,
  target: string,
  type: Relation['type'] = 'dependency'
): Relation {
  return { id, type, source, target };
}

function makeArchJson(
  entities: Entity[],
  relations: Relation[],
  overrides: Partial<ArchJSON> = {}
): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2024-01-01T00:00:00.000Z',
    sourceFiles: [],
    entities,
    relations,
    ...overrides,
  };
}

const HASH = 'abc123';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildArchIndex()', () => {
  it('sets version, archJsonHash, and language from inputs', () => {
    const archJson = makeArchJson([], []);
    const index = buildArchIndex(archJson, HASH);

    expect(index.version).toBe(ARCH_INDEX_VERSION);
    expect(index.archJsonHash).toBe(HASH);
    expect(index.language).toBe('typescript');
  });

  it('populates nameToIds, idToName, idToFile for each entity', () => {
    const entities = [
      makeEntity('pkg/A', 'Alpha', 'src/alpha.ts'),
      makeEntity('pkg/B', 'Beta', 'src/beta.ts'),
    ];
    const index = buildArchIndex(makeArchJson(entities, []), HASH);

    expect(index.nameToIds['Alpha']).toEqual(['pkg/A']);
    expect(index.nameToIds['Beta']).toEqual(['pkg/B']);
    expect(index.idToName['pkg/A']).toBe('Alpha');
    expect(index.idToName['pkg/B']).toBe('Beta');
    expect(index.idToFile['pkg/A']).toBe('src/alpha.ts');
    expect(index.idToFile['pkg/B']).toBe('src/beta.ts');
  });

  it('builds fileToIds grouping multiple entities from the same file', () => {
    const entities = [
      makeEntity('pkg/A', 'Alpha', 'src/shared.ts'),
      makeEntity('pkg/B', 'Beta', 'src/shared.ts'),
      makeEntity('pkg/C', 'Gamma', 'src/other.ts'),
    ];
    const index = buildArchIndex(makeArchJson(entities, []), HASH);

    expect(index.fileToIds['src/shared.ts']).toHaveLength(2);
    expect(index.fileToIds['src/shared.ts']).toContain('pkg/A');
    expect(index.fileToIds['src/shared.ts']).toContain('pkg/B');
    expect(index.fileToIds['src/other.ts']).toEqual(['pkg/C']);
  });

  it('populates forward and reverse adjacency (dependencies / dependents)', () => {
    const entities = [makeEntity('id/A', 'A', 'src/a.ts'), makeEntity('id/B', 'B', 'src/b.ts')];
    // A → B (A depends on B)
    const relations = [makeRelation('r1', 'id/A', 'id/B')];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    expect(index.dependencies['id/A']).toContain('id/B');
    expect(index.dependents['id/B']).toContain('id/A');
    // Reverse direction should be empty
    expect(index.dependencies['id/B']).toEqual([]);
    expect(index.dependents['id/A']).toEqual([]);
  });

  it('indexes relations by type in relationsByType', () => {
    const entities = [
      makeEntity('id/A', 'A', 'src/a.ts'),
      makeEntity('id/B', 'B', 'src/b.ts'),
      makeEntity('id/C', 'C', 'src/c.ts'),
    ];
    const relations = [
      makeRelation('r1', 'id/A', 'id/B', 'inheritance'),
      makeRelation('r2', 'id/A', 'id/C', 'dependency'),
      makeRelation('r3', 'id/B', 'id/C', 'dependency'),
    ];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    expect(index.relationsByType['inheritance']).toHaveLength(1);
    expect(index.relationsByType['dependency']).toHaveLength(2);
    expect(index.relationsByType['inheritance']?.[0]).toEqual(['id/A', 'id/B']);
  });

  it('drops external relations where one endpoint is not a known entity ID', () => {
    const entities = [makeEntity('id/A', 'A', 'src/a.ts')];
    // Target 'id/External' is not in entities
    const relations = [makeRelation('r1', 'id/A', 'id/External')];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    expect(index.dependencies['id/A']).toEqual([]);
    expect(index.relationsByType['dependency']).toBeUndefined();
  });

  it('resolves bare name references to entity IDs when unambiguous', () => {
    const entities = [
      makeEntity('pkg/Alpha', 'Alpha', 'src/alpha.ts'),
      makeEntity('pkg/Beta', 'Beta', 'src/beta.ts'),
    ];
    // Source uses bare name 'Alpha', target uses full ID 'pkg/Beta'
    const relations = [makeRelation('r1', 'Alpha', 'pkg/Beta', 'dependency')];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    // Should resolve 'Alpha' → 'pkg/Alpha' and include the internal relation
    expect(index.dependencies['pkg/Alpha']).toContain('pkg/Beta');
    expect(index.dependents['pkg/Beta']).toContain('pkg/Alpha');
  });

  it('does NOT resolve bare name when multiple entities share the same name', () => {
    const entities = [
      makeEntity('pkg1/Alpha', 'Alpha', 'src/a1.ts'),
      makeEntity('pkg2/Alpha', 'Alpha', 'src/a2.ts'),
      makeEntity('pkg/Beta', 'Beta', 'src/beta.ts'),
    ];
    // 'Alpha' is ambiguous → should not resolve → relation dropped
    const relations = [makeRelation('r1', 'Alpha', 'pkg/Beta', 'dependency')];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    expect(index.dependencies['pkg1/Alpha']).toEqual([]);
    expect(index.dependencies['pkg2/Alpha']).toEqual([]);
    expect(index.dependents['pkg/Beta']).toEqual([]);
  });

  it('detects a simple two-node cycle and returns it in cycles[]', () => {
    const entities = [makeEntity('id/A', 'A', 'src/a.ts'), makeEntity('id/B', 'B', 'src/b.ts')];
    // A → B and B → A forms a cycle
    const relations = [
      makeRelation('r1', 'id/A', 'id/B', 'dependency'),
      makeRelation('r2', 'id/B', 'id/A', 'dependency'),
    ];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    expect(index.cycles).toHaveLength(1);
    expect(index.cycles[0].size).toBe(2);
    expect(index.cycles[0].members).toContain('id/A');
    expect(index.cycles[0].members).toContain('id/B');
  });

  it('returns no cycles for a DAG', () => {
    const entities = [
      makeEntity('id/A', 'A', 'src/a.ts'),
      makeEntity('id/B', 'B', 'src/b.ts'),
      makeEntity('id/C', 'C', 'src/c.ts'),
    ];
    // A → B → C (strict DAG, no back-edges)
    const relations = [
      makeRelation('r1', 'id/A', 'id/B', 'dependency'),
      makeRelation('r2', 'id/B', 'id/C', 'dependency'),
    ];
    const index = buildArchIndex(makeArchJson(entities, relations), HASH);

    expect(index.cycles).toHaveLength(0);
  });

  it('normalises C++ absolute paths to relative when workspaceRoot is set', () => {
    const entity = makeEntity('pkg/Foo', 'Foo', '/home/user/project/src/foo.cpp');
    const archJson = makeArchJson([entity], [], { workspaceRoot: '/home/user/project' });
    const index = buildArchIndex(archJson, HASH);

    expect(index.idToFile['pkg/Foo']).toBe('src/foo.cpp');
  });

  it('falls back to "unknown" language when archJson.language is absent', () => {
    // Craft an ArchJSON whose language field is missing at runtime
    const archJson = makeArchJson([], []) as unknown as ArchJSON;
    // @ts-expect-error intentionally removing language for test
    delete (archJson as Record<string, unknown>).language;
    const index = buildArchIndex(archJson, HASH);

    expect(index.language).toBe('unknown');
  });

  it('handles empty entities and relations without throwing', () => {
    const index = buildArchIndex(makeArchJson([], []), HASH);

    expect(index.cycles).toEqual([]);
    expect(index.nameToIds).toEqual({});
    expect(index.idToFile).toEqual({});
    expect(index.dependencies).toEqual({});
    expect(index.dependents).toEqual({});
  });
});
