import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryEngineOptions } from '@/cli/query/query-engine.js';
import type { ArchJSON, Entity } from '@/types/index.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultScope: QueryScopeEntry = {
  key: 'test-scope',
  label: 'test',
  kind: 'parsed',
  sources: ['./src'],
  language: 'typescript',
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

function createEngine(archJson: ArchJSON, scope: QueryScopeEntry = defaultScope): QueryEngine {
  const archIndex = buildArchIndex(archJson, 'test-hash');
  return new QueryEngine({ archJson, archIndex, scopeEntry: scope });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const entityA = makeEntity('A', 'Alpha');
const entityB = makeEntity('B', 'Beta', { type: 'interface' });
const entityC = makeEntity('C', 'Gamma');
const entityD = makeEntity('D', 'Delta');
const entityE = makeEntity('E', 'Epsilon');

// A → B (dependency), C -impl→ B, A → C (dependency), D → E (dependency)
const baseArchJson = makeArchJson({
  entities: [entityA, entityB, entityC, entityD, entityE],
  relations: [
    { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
    { id: 'r2', type: 'implementation', source: 'C', target: 'B' },
    { id: 'r3', type: 'dependency', source: 'A', target: 'C' },
    { id: 'r4', type: 'dependency', source: 'D', target: 'E' },
  ],
});

// Cyclic: A → B → C → A
const cyclicArchJson = makeArchJson({
  entities: [entityA, entityB, entityC],
  relations: [
    { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
    { id: 'r2', type: 'dependency', source: 'B', target: 'C' },
    { id: 'r3', type: 'dependency', source: 'C', target: 'A' },
  ],
});

// Two-hop: A → B → C (no cycle)
const twoHopArchJson = makeArchJson({
  entities: [entityA, entityB, entityC, entityD],
  relations: [
    { id: 'r1', type: 'dependency', source: 'A', target: 'B' },
    { id: 'r2', type: 'dependency', source: 'B', target: 'C' },
  ],
});

// Inheritance: C -inherits→ A
const inheritanceArchJson = makeArchJson({
  entities: [entityA, entityC],
  relations: [
    { id: 'r1', type: 'inheritance', source: 'C', target: 'A' },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryEngine', () => {
  describe('findEntity', () => {
    it('returns matching entities by exact name', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findEntity('Alpha');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('A');
      expect(results[0].name).toBe('Alpha');
    });

    it('returns empty array for unknown name', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findEntity('NonExistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('getDependencies', () => {
    it('returns one-hop dependencies', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.getDependencies('Alpha');
      const ids = results.map(e => e.id);
      expect(ids).toContain('B');
      expect(ids).toContain('C');
      expect(ids).not.toContain('A'); // does not include self
    });

    it('returns two-hop dependencies with depth=2', () => {
      const engine = createEngine(twoHopArchJson);
      // A → B → C, D is disconnected
      const results = engine.getDependencies('Alpha', 2);
      const ids = results.map(e => e.id);
      expect(ids).toContain('B'); // hop 1
      expect(ids).toContain('C'); // hop 2
      expect(ids).not.toContain('D'); // disconnected
    });

    it('does not infinite loop with cycles', () => {
      const engine = createEngine(cyclicArchJson);
      // A → B → C → A (cycle), depth=5
      const results = engine.getDependencies('Alpha', 5);
      expect(Array.isArray(results)).toBe(true);
      // Should find B and C but not loop
      const ids = results.map(e => e.id);
      expect(ids).toContain('B');
      expect(ids).toContain('C');
      expect(results.length).toBe(2); // just B and C, not duplicates
    });

    it('clamps depth to maximum of 5', () => {
      const engine = createEngine(twoHopArchJson);
      // depth=100 should be clamped to 5 — still finds B and C
      const results = engine.getDependencies('Alpha', 100);
      const ids = results.map(e => e.id);
      expect(ids).toContain('B');
      expect(ids).toContain('C');
    });

    it('clamps depth to minimum of 1', () => {
      const engine = createEngine(twoHopArchJson);
      const results = engine.getDependencies('Alpha', 0);
      // depth clamped to 1, should find B only (one hop)
      const ids = results.map(e => e.id);
      expect(ids).toContain('B');
      expect(ids).not.toContain('C');
    });

    it('returns empty array for unknown entity name', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.getDependencies('NonExistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('getDependents', () => {
    it('returns reverse direction (who depends on entity)', () => {
      const engine = createEngine(baseArchJson);
      // B is depended on by A (dependency) and C (implementation)
      const results = engine.getDependents('Beta');
      const ids = results.map(e => e.id);
      expect(ids).toContain('A');
      expect(ids).toContain('C');
    });

    it('returns multi-hop dependents with depth=2', () => {
      const engine = createEngine(twoHopArchJson);
      // A → B → C; dependents of Gamma (C): B at hop 1, A at hop 2
      const results = engine.getDependents('Gamma', 2);
      const ids = results.map(e => e.id);
      expect(ids).toContain('B'); // hop 1
      expect(ids).toContain('A'); // hop 2
    });
  });

  describe('findImplementers', () => {
    it('returns only entities with implementation relation', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findImplementers('Beta');
      const ids = results.map(e => e.id);
      expect(ids).toContain('C'); // C implements B
      expect(ids).not.toContain('A'); // A has dependency on B, not implementation
    });

    it('returns empty for entity with no implementers', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findImplementers('Alpha');
      expect(results).toHaveLength(0);
    });
  });

  describe('findSubclasses', () => {
    it('returns only entities with inheritance relation', () => {
      const engine = createEngine(inheritanceArchJson);
      const results = engine.findSubclasses('Alpha');
      const ids = results.map(e => e.id);
      expect(ids).toContain('C'); // C inherits A
    });

    it('returns empty when no inheritance exists', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findSubclasses('Alpha');
      expect(results).toHaveLength(0);
    });
  });

  describe('getFileEntities', () => {
    it('returns entities defined in the given file', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.getFileEntities('src/alpha.ts');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('A');
    });

    it('returns empty for unknown file path', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.getFileEntities('nonexistent.ts');
      expect(results).toHaveLength(0);
    });
  });

  describe('getCycles', () => {
    it('returns cycles from the index', () => {
      const engine = createEngine(cyclicArchJson);
      const cycles = engine.getCycles();
      expect(cycles).toHaveLength(1);
      expect(cycles[0].size).toBe(3);
      expect(cycles[0].members).toContain('A');
      expect(cycles[0].members).toContain('B');
      expect(cycles[0].members).toContain('C');
    });

    it('returns empty array when no cycles exist', () => {
      const engine = createEngine(twoHopArchJson);
      const cycles = engine.getCycles();
      expect(cycles).toHaveLength(0);
    });
  });

  describe('getSummary', () => {
    it('includes entity/relation counts and topDependedOn', () => {
      const engine = createEngine(baseArchJson);
      const summary = engine.getSummary();
      expect(summary.entityCount).toBe(5);
      expect(summary.relationCount).toBe(4);
      expect(summary.language).toBe('typescript');
      expect(summary.kind).toBe('parsed');
      expect(summary.topDependedOn.length).toBeGreaterThan(0);
      // B should be in top depended-on (A depends on B, C implements B)
      const betaEntry = summary.topDependedOn.find(e => e.name === 'Beta');
      expect(betaEntry).toBeDefined();
      expect(betaEntry!.dependentCount).toBe(2);
    });
  });

  describe('findByType', () => {
    it('matches entities by type', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findByType('interface');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('B');
    });

    it('abstract_class also matches isAbstract class', () => {
      const archJson = makeArchJson({
        entities: [
          makeEntity('X', 'AbstractFoo', { type: 'abstract_class' }),
          makeEntity('Y', 'AbstractBar', { type: 'class', isAbstract: true }),
          makeEntity('Z', 'ConcreteClass', { type: 'class' }),
        ],
      });
      const engine = createEngine(archJson);
      const results = engine.findByType('abstract_class');
      const ids = results.map(e => e.id);
      expect(ids).toContain('X');
      expect(ids).toContain('Y');
      expect(ids).not.toContain('Z');
    });
  });

  describe('findHighCoupling', () => {
    it('returns entities with total edges >= threshold', () => {
      // B has 2 incoming (from A dependency, from C implementation) + 0 outgoing = 2
      // A has 0 incoming + 2 outgoing (to B, to C) = 2
      const engine = createEngine(baseArchJson);
      const results = engine.findHighCoupling(2);
      const ids = results.map(e => e.id);
      expect(ids).toContain('A'); // 2 outgoing
      expect(ids).toContain('B'); // 2 incoming
      expect(ids).toContain('C'); // 1 incoming (from A) + 1 outgoing (impl B) = 2
    });

    it('returns empty when no entity meets threshold', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findHighCoupling(100);
      expect(results).toHaveLength(0);
    });
  });

  describe('findOrphans', () => {
    it('returns entities with zero incoming and zero outgoing edges', () => {
      // In twoHopArchJson: D has no relations at all
      const engine = createEngine(twoHopArchJson);
      const results = engine.findOrphans();
      const ids = results.map(e => e.id);
      expect(ids).toContain('D');
      expect(ids).not.toContain('A');
      expect(ids).not.toContain('B');
      expect(ids).not.toContain('C');
    });
  });

  describe('findInCycles', () => {
    it('returns entities that appear in any cycle', () => {
      const engine = createEngine(cyclicArchJson);
      const results = engine.findInCycles();
      const ids = results.map(e => e.id);
      expect(ids).toContain('A');
      expect(ids).toContain('B');
      expect(ids).toContain('C');
    });

    it('returns empty when no cycles exist', () => {
      const engine = createEngine(twoHopArchJson);
      const results = engine.findInCycles();
      expect(results).toHaveLength(0);
    });
  });

  describe('getScopeEntry', () => {
    it('returns the scope entry passed at construction', () => {
      const engine = createEngine(baseArchJson);
      expect(engine.getScopeEntry()).toBe(defaultScope);
    });
  });
});
