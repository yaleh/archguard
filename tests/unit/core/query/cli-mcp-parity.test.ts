/**
 * CLI/MCP parity tests (Phase 88)
 *
 * These tests verify that QueryEngine produces equivalent results regardless of
 * whether it is called from the CLI or MCP path. Both paths instantiate
 * QueryEngine directly in-process, so we verify the shared output-options logic
 * exhaustively here.
 */
import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/core/query/query-engine.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity } from '@/types/index.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { EdgeListOutput } from '@/core/query/query-engine.js';

// ---------------------------------------------------------------------------
// Helpers (copied from query-engine.test.ts)
// ---------------------------------------------------------------------------

const defaultScope: QueryScopeEntry = {
  key: 'parity-test',
  label: 'parity test',
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
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

function makeMethod(name: string) {
  return {
    name,
    type: 'method' as const,
    visibility: 'public' as const,
    parameters: [{ name: 'x', type: 'string' }],
    returnType: 'void',
  };
}

function makeField(name: string) {
  return { name, type: 'field' as const, visibility: 'private' as const };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
// Entity A: 2 methods + 1 field
// Entity B: 1 method
// Entity C: no members
// Relations: A depends on B, B depends on C

const entityA = makeEntity('pkg.A', 'A', {
  members: [makeMethod('doSomething'), makeMethod('doOther'), makeField('value')],
});
const entityB = makeEntity('pkg.B', 'B', {
  members: [makeMethod('run')],
});
const entityC = makeEntity('pkg.C', 'C', {
  members: [],
  // no sourceLocation override: uses default src/c.ts
});

function makeFixtureEngine() {
  const archJson = makeArchJson({
    entities: [entityA, entityB, entityC],
    relations: [
      { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
      { source: 'pkg.B', target: 'pkg.C', type: 'dependency' },
    ],
  });
  const index = buildArchIndex(archJson, 'hash-phase88-parity');
  return new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI/MCP parity (Phase 88)', () => {
  it('outputScope=method: result contains members[]', () => {
    const engine = makeFixtureEngine();
    const result = engine.findEntity('A', { outputScope: 'method' });
    expect(Array.isArray(result)).toBe(true);
    const entities = result as Entity[];
    expect(entities).toHaveLength(1);
    expect(entities[0].members).toBeDefined();
    expect(entities[0].members.length).toBe(3); // 2 methods + 1 field
  });

  it('outputScope=package: result does NOT contain members or visibility', () => {
    const engine = makeFixtureEngine();
    const result = engine.findEntity('A', { outputScope: 'package' });
    expect(Array.isArray(result)).toBe(true);
    const entities = result as Partial<Entity>[];
    expect(entities).toHaveLength(1);
    expect(entities[0].members).toBeUndefined();
    expect(entities[0].visibility).toBeUndefined();
    // id, name, type and sourceLocation.file are still present
    expect(entities[0].id).toBe('pkg.A');
    expect(entities[0].name).toBe('A');
    expect(entities[0].type).toBe('class');
    expect(entities[0].sourceLocation).toBeDefined();
  });

  it('queryFormat=edge-list: result has { entities, relations } top-level structure', () => {
    const engine = makeFixtureEngine();
    const result = engine.applyOutputOptions(engine.relationQueryService.getDependencies('A', 2), {
      queryFormat: 'edge-list',
    });
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('relations');
    const edgeList = result as EdgeListOutput;
    // A depends on B and B depends on C (depth 2)
    expect(edgeList.entities.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(edgeList.relations)).toBe(true);
  });

  it('queryFormat=edge-list + outputScope=method: methods[] is populated', () => {
    const engine = makeFixtureEngine();
    // Depth 1: A → B; B has 1 method
    const result = engine.applyOutputOptions(engine.relationQueryService.getDependencies('A', 1), {
      outputScope: 'method',
      queryFormat: 'edge-list',
    });
    const edgeList = result as EdgeListOutput;
    expect(edgeList.entities).toHaveLength(1);
    const entityBOut = edgeList.entities[0];
    expect(entityBOut.id).toBe('pkg.B');
    expect(Array.isArray(entityBOut.methods)).toBe(true);
    expect(entityBOut.methods.length).toBe(1);
    expect(entityBOut.methods[0].name).toBe('run');
  });

  it('queryFormat=edge-list + outputScope=class: methods[] is empty []', () => {
    const engine = makeFixtureEngine();
    const result = engine.applyOutputOptions(engine.relationQueryService.getDependencies('A', 1), {
      outputScope: 'class',
      queryFormat: 'edge-list',
    });
    const edgeList = result as EdgeListOutput;
    expect(edgeList.entities).toHaveLength(1);
    // scope=class → methods[] stripped (empty)
    expect(edgeList.entities[0].methods).toEqual([]);
  });

  it('no options: result equals original Entity[] (backward compat)', () => {
    const engine = makeFixtureEngine();
    const result = engine.findEntity('A');
    expect(Array.isArray(result)).toBe(true);
    const entities = result as Entity[];
    expect(entities).toHaveLength(1);
    // Full entity returned — members should be intact
    expect(entities[0].members).toBeDefined();
    expect(entities[0].members.length).toBe(3);
    expect(entities[0].visibility).toBe('public');
  });

  it('edge-list relations: source→from, target→to mapping correct', () => {
    const engine = makeFixtureEngine();
    const result = engine.applyOutputOptions(engine.relationQueryService.getDependencies('A', 1), {
      queryFormat: 'edge-list',
    });
    const edgeList = result as EdgeListOutput;
    // The relation in the fixture is { source: 'pkg.A', target: 'pkg.B', type: 'dependency' }
    // Serialized it should be { from: 'pkg.A', to: 'pkg.B', type: 'dependency' }
    const rel = edgeList.relations.find((r) => r.from === 'pkg.A' && r.to === 'pkg.B');
    expect(rel).toBeDefined();
    expect(rel.type).toBe('dependency');
  });

  it('edge-list sourceFile fallback: entity without sourceLocation gets "unknown"', () => {
    // Simulate a Partial<Entity> that has no sourceLocation (e.g. derived or stripped entity)
    const entityNoFile = makeEntity('pkg.X', 'X');
    // Force sourceLocation to be absent by casting (simulates edge case in derived data)
    (entityNoFile as Partial<Entity>).sourceLocation =
      undefined as unknown as Entity['sourceLocation'];

    const archJson = makeArchJson({
      entities: [entityNoFile],
      relations: [],
    });
    const index = buildArchIndex(archJson, 'hash-phase88-noloc');
    const engine = new QueryEngine({ archJson, archIndex: index, scopeEntry: defaultScope });

    const result = engine.findEntity('X', { queryFormat: 'edge-list' });
    const edgeList = result as EdgeListOutput;
    expect(edgeList.entities).toHaveLength(1);
    // sourceLocation is undefined → serializer falls back to 'unknown'
    expect(edgeList.entities[0].sourceFile).toBe('unknown');
  });
});
