/**
 * TDD tests for QueryEngine and buildArchIndex at the NEW location: @/core/query/
 *
 * These tests import from @/core/query/* — they fail until Step 3 (file move) is done.
 */
import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/core/query/query-engine.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity } from '@/types/index.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultScope: QueryScopeEntry = {
  key: 'core-test',
  label: 'core test',
  kind: 'parsed',
  sources: ['./src'],
  language: 'typescript',
  entityCount: 0,
  relationCount: 0,
  hasAtlasExtension: false,
};

function makeEntity(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: `src/${name.toLowerCase()}.ts`, startLine: 1, endLine: 10 },
    ...overrides,
  };
}

function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: buildArchIndex produces correct index for minimal fixture
// ---------------------------------------------------------------------------

describe('buildArchIndex (from @/core/query)', () => {
  it('indexes entities by name and file', () => {
    const entities = [
      makeEntity('src/foo.ts.Foo', 'Foo'),
      makeEntity('src/bar.ts.Bar', 'Bar'),
    ];
    const archJson = makeArchJson({ entities, sourceFiles: ['src/foo.ts', 'src/bar.ts'] });
    const index = buildArchIndex(archJson, 'test-hash-001');

    expect(index.nameToIds['Foo']).toEqual(['src/foo.ts.Foo']);
    expect(index.nameToIds['Bar']).toEqual(['src/bar.ts.Bar']);
    expect(index.idToName['src/foo.ts.Foo']).toBe('Foo');
    expect(index.archJsonHash).toBe('test-hash-001');
  });

  it('computes dependency edges from relations', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
    });
    const index = buildArchIndex(archJson, 'test-hash-002');

    expect(index.dependencies['pkg.A']).toContain('pkg.B');
    expect(index.dependents['pkg.B']).toContain('pkg.A');
  });
});

// ---------------------------------------------------------------------------
// Test 2: QueryEngine.findByType filters correctly
// ---------------------------------------------------------------------------

describe('QueryEngine.findByType (from @/core/query)', () => {
  it('returns only entities of the requested type', () => {
    const entities = [
      makeEntity('a.ClassA', 'ClassA', { type: 'class' }),
      makeEntity('b.InterfaceB', 'InterfaceB', { type: 'interface' }),
      makeEntity('c.ClassC', 'ClassC', { type: 'class' }),
    ];
    const archJson = makeArchJson({ entities });
    const index = buildArchIndex(archJson, 'hash-003');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const classes = engine.findByType('class');
    expect(classes).toHaveLength(2);
    expect(classes.map((e) => e.name)).toContain('ClassA');
    expect(classes.map((e) => e.name)).toContain('ClassC');

    const ifaces = engine.findByType('interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('InterfaceB');
  });
});

// ---------------------------------------------------------------------------
// Test 3: QueryEngine.getDependencies traverses correctly
// ---------------------------------------------------------------------------

describe('QueryEngine.getDependencies (from @/core/query)', () => {
  it('returns direct dependencies at depth 1', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [
        { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
        { source: 'pkg.B', target: 'pkg.C', type: 'dependency' },
      ],
    });
    const index = buildArchIndex(archJson, 'hash-004');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const deps = engine.getDependencies('A', 1);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('B');
  });

  it('traverses 2 levels when depth=2', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [
        { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
        { source: 'pkg.B', target: 'pkg.C', type: 'dependency' },
      ],
    });
    const index = buildArchIndex(archJson, 'hash-005');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const deps = engine.getDependencies('A', 2);
    expect(deps.map((e) => e.name)).toContain('B');
    expect(deps.map((e) => e.name)).toContain('C');
  });
});

// ---------------------------------------------------------------------------
// Test 4: QueryEngine.findByAttr (added in Plan 58) filters by attribute key/value
// NOTE: findByAttr is added in Plan 58 (Entity.attributes + QueryEngine attr methods).
// These tests are pending until Plan 58 is merged into this branch.
// ---------------------------------------------------------------------------

describe('QueryEngine.findByAttr (from @/core/query, Plan 58)', () => {
  it.todo('finds entities with a given attribute key (no value filter)');
  it.todo('finds entities matching a specific attribute value');
});
