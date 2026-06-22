/**
 * TDD tests for RelationQueryService (Phase A extraction)
 *
 * Covers graph-traversal methods: getDependencies, getDependents,
 * findImplementers, findSubclasses, findCallers.
 * Imports RelationQueryService directly (no dependency on query-engine.ts).
 */
import { describe, it, expect } from 'vitest';
import { RelationQueryService } from '@/core/query/relation-query-service.js';
import { EntityQueryService } from '@/core/query/entity-query-service.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeRelation(from: string, to: string, type: Relation['type']): Relation {
  return { source: from, target: to, type } as Relation;
}

function makeCallRelation(
  from: string,
  to: string,
  sourceMethod?: string,
  targetMethod?: string
): Relation {
  return {
    source: from,
    target: to,
    type: 'call',
    sourceMethod,
    targetMethod,
    callType: 'direct',
  } as unknown as Relation;
}

function makeArchJson(
  entities: Entity[],
  relations: Relation[],
  overrides: Partial<ArchJSON> = {}
): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities,
    relations,
    ...overrides,
  };
}

function buildService(archJson: ArchJSON): RelationQueryService {
  const index = buildArchIndex(archJson);
  const entitySvc = new EntityQueryService(archJson, index);
  return new RelationQueryService(archJson, index, entitySvc);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const entityA = makeEntity('src/a.ts.A', 'A');
const entityB = makeEntity('src/b.ts.B', 'B');
const entityC = makeEntity('src/c.ts.C', 'C');
const entityD = makeEntity('src/d.ts.D', 'D');

const iface = makeEntity('src/iface.ts.IRepo', 'IRepo', { type: 'interface' });
const impl = makeEntity('src/impl.ts.RepoImpl', 'RepoImpl');
const base = makeEntity('src/base.ts.Base', 'Base');
const child = makeEntity('src/child.ts.Child', 'Child');

// ---------------------------------------------------------------------------
// getDependencies
// ---------------------------------------------------------------------------

describe('RelationQueryService — getDependencies', () => {
  it('returns direct dependencies at depth=1', () => {
    // A depends on B and C
    const archJson = makeArchJson(
      [entityA, entityB, entityC],
      [makeRelation('src/a.ts.A', 'src/b.ts.B', 'dependency'),
       makeRelation('src/a.ts.A', 'src/c.ts.C', 'dependency')]
    );
    const svc = buildService(archJson);
    const result = svc.getDependencies('A', 1);
    const names = result.map((e) => e.name).sort();
    expect(names).toEqual(['B', 'C']);
  });

  it('traverses to depth=2 when requested', () => {
    // A → B → C (chain)
    const archJson = makeArchJson(
      [entityA, entityB, entityC],
      [makeRelation('src/a.ts.A', 'src/b.ts.B', 'dependency'),
       makeRelation('src/b.ts.B', 'src/c.ts.C', 'dependency')]
    );
    const svc = buildService(archJson);
    const result = svc.getDependencies('A', 2);
    expect(result.map((e) => e.name)).toContain('C');
  });

  it('returns empty array for unknown entity', () => {
    const archJson = makeArchJson([entityA], []);
    const svc = buildService(archJson);
    expect(svc.getDependencies('Unknown', 1)).toHaveLength(0);
  });

  it('clamps depth to maximum of 5', () => {
    // A → B → C → D (3 hops) — requesting depth=99 should still find them all
    const archJson = makeArchJson(
      [entityA, entityB, entityC, entityD],
      [makeRelation('src/a.ts.A', 'src/b.ts.B', 'dependency'),
       makeRelation('src/b.ts.B', 'src/c.ts.C', 'dependency'),
       makeRelation('src/c.ts.C', 'src/d.ts.D', 'dependency')]
    );
    const svc = buildService(archJson);
    const result = svc.getDependencies('A', 99);
    expect(result.map((e) => e.name)).toContain('D');
  });

  it('does not revisit already-visited nodes (no infinite loop)', () => {
    // Cycle: A → B → A
    const archJson = makeArchJson(
      [entityA, entityB],
      [makeRelation('src/a.ts.A', 'src/b.ts.B', 'dependency'),
       makeRelation('src/b.ts.B', 'src/a.ts.A', 'dependency')]
    );
    const svc = buildService(archJson);
    const result = svc.getDependencies('A', 5);
    // Should only return B (A is the start and already in visited set)
    expect(result.map((e) => e.name)).toEqual(['B']);
  });
});

// ---------------------------------------------------------------------------
// getDependents
// ---------------------------------------------------------------------------

describe('RelationQueryService — getDependents', () => {
  it('returns entities that depend on the target at depth=1', () => {
    // A and B both depend on C → C's dependents are A, B
    const archJson = makeArchJson(
      [entityA, entityB, entityC],
      [makeRelation('src/a.ts.A', 'src/c.ts.C', 'dependency'),
       makeRelation('src/b.ts.B', 'src/c.ts.C', 'dependency')]
    );
    const svc = buildService(archJson);
    const result = svc.getDependents('C', 1);
    const names = result.map((e) => e.name).sort();
    expect(names).toEqual(['A', 'B']);
  });

  it('returns empty array when no one depends on entity', () => {
    const archJson = makeArchJson([entityA, entityB], [makeRelation('src/a.ts.A', 'src/b.ts.B', 'dependency')]);
    const svc = buildService(archJson);
    // A has no dependents
    expect(svc.getDependents('A', 1)).toHaveLength(0);
  });

  it('returns empty for unknown entity name', () => {
    const archJson = makeArchJson([entityA], []);
    const svc = buildService(archJson);
    expect(svc.getDependents('Ghost', 1)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findImplementers
// ---------------------------------------------------------------------------

describe('RelationQueryService — findImplementers', () => {
  it('returns entities with implementation relation to the interface', () => {
    const archJson = makeArchJson(
      [iface, impl],
      [makeRelation('src/impl.ts.RepoImpl', 'src/iface.ts.IRepo', 'implementation')]
    );
    const svc = buildService(archJson);
    const result = svc.findImplementers('IRepo');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('RepoImpl');
  });

  it('returns empty when interface has no implementers', () => {
    const archJson = makeArchJson([iface], []);
    const svc = buildService(archJson);
    expect(svc.findImplementers('IRepo')).toHaveLength(0);
  });

  it('returns empty for unknown interface name', () => {
    const archJson = makeArchJson([iface, impl], [makeRelation('src/impl.ts.RepoImpl', 'src/iface.ts.IRepo', 'implementation')]);
    const svc = buildService(archJson);
    expect(svc.findImplementers('IUnknown')).toHaveLength(0);
  });

  it('returns multiple implementers', () => {
    const impl2 = makeEntity('src/impl2.ts.RepoImpl2', 'RepoImpl2');
    const archJson = makeArchJson(
      [iface, impl, impl2],
      [makeRelation('src/impl.ts.RepoImpl', 'src/iface.ts.IRepo', 'implementation'),
       makeRelation('src/impl2.ts.RepoImpl2', 'src/iface.ts.IRepo', 'implementation')]
    );
    const svc = buildService(archJson);
    const result = svc.findImplementers('IRepo');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findSubclasses
// ---------------------------------------------------------------------------

describe('RelationQueryService — findSubclasses', () => {
  it('returns direct subclasses via inheritance relation', () => {
    const archJson = makeArchJson(
      [base, child],
      [makeRelation('src/child.ts.Child', 'src/base.ts.Base', 'inheritance')]
    );
    const svc = buildService(archJson);
    const result = svc.findSubclasses('Base');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Child');
  });

  it('returns empty when class has no subclasses', () => {
    const archJson = makeArchJson([base], []);
    const svc = buildService(archJson);
    expect(svc.findSubclasses('Base')).toHaveLength(0);
  });

  it('returns empty for unknown class name', () => {
    const archJson = makeArchJson(
      [base, child],
      [makeRelation('src/child.ts.Child', 'src/base.ts.Base', 'inheritance')]
    );
    const svc = buildService(archJson);
    expect(svc.findSubclasses('NonExistent')).toHaveLength(0);
  });

  it('returns multiple subclasses', () => {
    const child2 = makeEntity('src/child2.ts.Child2', 'Child2');
    const archJson = makeArchJson(
      [base, child, child2],
      [makeRelation('src/child.ts.Child', 'src/base.ts.Base', 'inheritance'),
       makeRelation('src/child2.ts.Child2', 'src/base.ts.Base', 'inheritance')]
    );
    const svc = buildService(archJson);
    const result = svc.findSubclasses('Base');
    expect(result).toHaveLength(2);
    const names = result.map((e) => e.name).sort();
    expect(names).toEqual(['Child', 'Child2']);
  });
});

// ---------------------------------------------------------------------------
// findCallers
// ---------------------------------------------------------------------------

describe('RelationQueryService — findCallers', () => {
  it('returns direct callers at depth=1', () => {
    // A calls B, C calls B → callers of B are A and C
    const archJson = makeArchJson(
      [entityA, entityB, entityC],
      [makeCallRelation('src/a.ts.A', 'src/b.ts.B', 'methodA', 'methodB'),
       makeCallRelation('src/c.ts.C', 'src/b.ts.B', 'methodC', 'methodB')]
    );
    const svc = buildService(archJson);
    const result = svc.findCallers('B', 1);
    const callerEntities = result.map((r) => r.callerEntity).sort();
    expect(callerEntities).toContain('src/a.ts.A');
    expect(callerEntities).toContain('src/c.ts.C');
  });

  it('returns empty array when no callers exist', () => {
    const archJson = makeArchJson([entityA, entityB], []);
    const svc = buildService(archJson);
    expect(svc.findCallers('A', 1)).toHaveLength(0);
  });

  it('returns empty array for unknown entity', () => {
    const archJson = makeArchJson([entityA], [makeCallRelation('src/a.ts.A', 'src/b.ts.B')]);
    const svc = buildService(archJson);
    expect(svc.findCallers('Ghost', 1)).toHaveLength(0);
  });

  it('filters by method name when "Class.method" syntax is used', () => {
    // A calls B.doWork; C calls B.doOther
    const archJson = makeArchJson(
      [entityA, entityB, entityC],
      [makeCallRelation('src/a.ts.A', 'src/b.ts.B', 'callA', 'doWork'),
       makeCallRelation('src/c.ts.C', 'src/b.ts.B', 'callC', 'doOther')]
    );
    const svc = buildService(archJson);
    const result = svc.findCallers('B.doWork', 1);
    expect(result).toHaveLength(1);
    expect(result[0].callerEntity).toBe('src/a.ts.A');
  });

  it('traverses multiple BFS levels for depth=2', () => {
    // D calls C, C calls B → callers of B at depth 2 include D
    const archJson = makeArchJson(
      [entityB, entityC, entityD],
      [makeCallRelation('src/c.ts.C', 'src/b.ts.B', 'methodC', 'methodB'),
       makeCallRelation('src/d.ts.D', 'src/c.ts.C', 'methodD', 'methodC')]
    );
    const svc = buildService(archJson);
    const result = svc.findCallers('B', 2);
    const depths = result.reduce<Record<string, number>>((acc, r) => {
      acc[r.callerEntity] = r.depth;
      return acc;
    }, {});
    expect(depths['src/c.ts.C']).toBe(1);
    expect(depths['src/d.ts.D']).toBe(2);
  });

  it('includes callType in results', () => {
    const archJson = makeArchJson(
      [entityA, entityB],
      [makeCallRelation('src/a.ts.A', 'src/b.ts.B')]
    );
    const svc = buildService(archJson);
    const result = svc.findCallers('B', 1);
    expect(result[0].callType).toBe('direct');
  });
});
