/**
 * Phase 83 TDD tests for the three new aggregate statistics fields in QueryEngine.getSummary():
 *   - relationCountByType
 *   - topByMethodCount
 *   - topByOutDegree
 */
import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/core/query/query-engine.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity } from '@/types/index.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';

// ---------------------------------------------------------------------------
// Helpers (copied from query-engine.test.ts)
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
// relationCountByType
// ---------------------------------------------------------------------------

describe('getSummary().relationCountByType', () => {
  it('returns correct counts for 2 inheritance + 1 composition', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
      makeEntity('pkg.D', 'D'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [
        { source: 'pkg.A', target: 'pkg.B', type: 'inheritance' },
        { source: 'pkg.C', target: 'pkg.D', type: 'inheritance' },
        { source: 'pkg.A', target: 'pkg.C', type: 'composition' },
      ],
    });
    const index = buildArchIndex(archJson, 'hash-rct-01');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    expect(summary.relationCountByType).toMatchObject({ inheritance: 2, composition: 1 });
  });

  it('returns {} when there are no relations', () => {
    const archJson = makeArchJson({ entities: [], relations: [] });
    const index = buildArchIndex(archJson, 'hash-rct-02');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    expect(summary.relationCountByType).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// topByMethodCount
// ---------------------------------------------------------------------------

describe('getSummary().topByMethodCount', () => {
  it('top result has the highest method+constructor count, sorted descending', () => {
    const entities = [
      makeEntity('pkg.A', 'A', {
        members: [
          { name: 'foo', type: 'method', visibility: 'public' },
          { name: 'bar', type: 'method', visibility: 'public' },
        ],
      }),
      makeEntity('pkg.B', 'B', {
        members: [
          { name: 'baz', type: 'method', visibility: 'public' },
          { name: 'qux', type: 'method', visibility: 'public' },
          { name: 'quux', type: 'method', visibility: 'public' },
        ],
      }),
      makeEntity('pkg.C', 'C', {
        members: [{ name: 'single', type: 'method', visibility: 'public' }],
      }),
    ];
    const archJson = makeArchJson({ entities });
    const index = buildArchIndex(archJson, 'hash-tmc-01');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    expect(summary.topByMethodCount[0].name).toBe('B');
    expect(summary.topByMethodCount[0].methodCount).toBe(3);
    expect(summary.topByMethodCount[1].name).toBe('A');
    expect(summary.topByMethodCount[1].methodCount).toBe(2);
  });

  it('counts constructor-type members as well as method-type', () => {
    const entities = [
      makeEntity('pkg.A', 'A', {
        members: [
          { name: 'foo', type: 'method', visibility: 'public' },
          { name: 'bar', type: 'method', visibility: 'public' },
          { name: 'ctor', type: 'constructor', visibility: 'public' },
        ],
      }),
      makeEntity('pkg.B', 'B', {
        members: [
          { name: 'x', type: 'method', visibility: 'public' },
          { name: 'y', type: 'method', visibility: 'public' },
        ],
      }),
    ];
    const archJson = makeArchJson({ entities });
    const index = buildArchIndex(archJson, 'hash-tmc-02');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    const aEntry = summary.topByMethodCount.find((e) => e.name === 'A');
    expect(aEntry).toBeDefined();
    expect(aEntry!.methodCount).toBe(3); // 2 methods + 1 constructor
  });

  it('entities with 0 methods still appear in top-10 (not filtered out)', () => {
    const entities = [
      makeEntity('pkg.A', 'A', {
        members: [{ name: 'foo', type: 'method', visibility: 'public' }],
      }),
      makeEntity('pkg.B', 'B', { members: [] }), // no methods
    ];
    const archJson = makeArchJson({ entities });
    const index = buildArchIndex(archJson, 'hash-tmc-03');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    const names = summary.topByMethodCount.map((e) => e.name);
    expect(names).toContain('B');
    const bEntry = summary.topByMethodCount.find((e) => e.name === 'B');
    expect(bEntry!.methodCount).toBe(0);
  });

  it('is capped at 10 entries even with more entities', () => {
    const entities = Array.from({ length: 15 }, (_, i) =>
      makeEntity(`pkg.E${i}`, `E${i}`, {
        members: [{ name: 'method', type: 'method', visibility: 'public' }],
      })
    );
    const archJson = makeArchJson({ entities });
    const index = buildArchIndex(archJson, 'hash-tmc-04');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    expect(summary.topByMethodCount.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// topByOutDegree
// ---------------------------------------------------------------------------

describe('getSummary().topByOutDegree', () => {
  it('top result has the most outgoing dependency edges', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
      makeEntity('pkg.D', 'D'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [
        { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
        { source: 'pkg.A', target: 'pkg.C', type: 'dependency' },
        { source: 'pkg.A', target: 'pkg.D', type: 'dependency' },
        { source: 'pkg.B', target: 'pkg.C', type: 'dependency' },
      ],
    });
    const index = buildArchIndex(archJson, 'hash-tod-01');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    expect(summary.topByOutDegree[0].name).toBe('A');
    expect(summary.topByOutDegree[0].outDegree).toBe(3);
  });

  it('entity with no deps has outDegree: 0', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
    });
    const index = buildArchIndex(archJson, 'hash-tod-02');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();
    const bEntry = summary.topByOutDegree.find((e) => e.name === 'B');
    expect(bEntry).toBeDefined();
    expect(bEntry!.outDegree).toBe(0);
  });

  it('is independent of topDependedOn (which counts INCOMING edges)', () => {
    // B is depended on by many (high in-degree), but has no outgoing edges
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
      makeEntity('pkg.D', 'D'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [
        { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
        { source: 'pkg.C', target: 'pkg.B', type: 'dependency' },
        { source: 'pkg.D', target: 'pkg.B', type: 'dependency' },
        // A has outgoing to C and D
        { source: 'pkg.A', target: 'pkg.C', type: 'dependency' },
        { source: 'pkg.A', target: 'pkg.D', type: 'dependency' },
      ],
    });
    const index = buildArchIndex(archJson, 'hash-tod-03');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const summary = engine.getSummary();

    // B tops the topDependedOn list (3 incoming)
    expect(summary.topDependedOn[0].name).toBe('B');

    // A tops the topByOutDegree list (3 outgoing: B, C, D)
    expect(summary.topByOutDegree[0].name).toBe('A');
    expect(summary.topByOutDegree[0].outDegree).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Regression: existing fields still present
// ---------------------------------------------------------------------------

describe('getSummary() — regression: existing fields still present', () => {
  it('entityCount, relationCount, language, kind are still returned', () => {
    const entities = [makeEntity('pkg.X', 'X'), makeEntity('pkg.Y', 'Y')];
    const archJson = makeArchJson({
      entities,
      language: 'typescript',
      relations: [{ source: 'pkg.X', target: 'pkg.Y', type: 'dependency' }],
    });
    const index = buildArchIndex(archJson, 'hash-reg-01');
    const engine = new QueryEngine({
      archJson,
      archIndex: index,
      scopeEntry: { ...defaultScope, kind: 'parsed' },
    });

    const summary = engine.getSummary();
    expect(summary.entityCount).toBe(2);
    expect(summary.relationCount).toBe(1);
    expect(summary.language).toBe('typescript');
    expect(summary.kind).toBe('parsed');
  });
});
