import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryEngineOptions } from '@/cli/query/query-engine.js';
import type { ArchJSON, Entity } from '@/types/index.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { PackageGraph, PackageCoverage, TestAnalysis } from '@/types/extensions.js';

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
  relations: [{ id: 'r1', type: 'inheritance', source: 'C', target: 'A' }],
});

// Go Atlas fixture (package layer only)
const goAtlasArchJson: ArchJSON = {
  version: '1.0',
  language: 'go',
  timestamp: '2026-01-01T00:00:00Z',
  sourceFiles: [],
  entities: [],
  relations: [],
  extensions: {
    goAtlas: {
      version: '2.0',
      layers: {
        package: {
          nodes: [
            { id: 'github.com/example/app/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 3 },
            { id: 'github.com/example/app/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 2 },
          ],
          edges: [
            { from: 'github.com/example/app/pkg/hub', to: 'github.com/example/app/pkg/store', strength: 4 },
          ],
          cycles: [],
        },
      },
      metadata: {
        generatedAt: '2024-01-01T00:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          detectedFrameworks: [],
          followIndirectCalls: false,
          goplsEnabled: false,
        },
        completeness: { package: 1.0, capability: 0, goroutine: 0, flow: 0 },
        performance: { fileCount: 5, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
      },
    },
  },
};

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
      const ids = results.map((e) => e.id);
      expect(ids).toContain('B');
      expect(ids).toContain('C');
      expect(ids).not.toContain('A'); // does not include self
    });

    it('returns two-hop dependencies with depth=2', () => {
      const engine = createEngine(twoHopArchJson);
      // A → B → C, D is disconnected
      const results = engine.getDependencies('Alpha', 2);
      const ids = results.map((e) => e.id);
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
      const ids = results.map((e) => e.id);
      expect(ids).toContain('B');
      expect(ids).toContain('C');
      expect(results.length).toBe(2); // just B and C, not duplicates
    });

    it('clamps depth to maximum of 5', () => {
      const engine = createEngine(twoHopArchJson);
      // depth=100 should be clamped to 5 — still finds B and C
      const results = engine.getDependencies('Alpha', 100);
      const ids = results.map((e) => e.id);
      expect(ids).toContain('B');
      expect(ids).toContain('C');
    });

    it('clamps depth to minimum of 1', () => {
      const engine = createEngine(twoHopArchJson);
      const results = engine.getDependencies('Alpha', 0);
      // depth clamped to 1, should find B only (one hop)
      const ids = results.map((e) => e.id);
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
      const ids = results.map((e) => e.id);
      expect(ids).toContain('A');
      expect(ids).toContain('C');
    });

    it('returns multi-hop dependents with depth=2', () => {
      const engine = createEngine(twoHopArchJson);
      // A → B → C; dependents of Gamma (C): B at hop 1, A at hop 2
      const results = engine.getDependents('Gamma', 2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain('B'); // hop 1
      expect(ids).toContain('A'); // hop 2
    });
  });

  describe('findImplementers', () => {
    it('returns only entities with implementation relation', () => {
      const engine = createEngine(baseArchJson);
      const results = engine.findImplementers('Beta');
      const ids = results.map((e) => e.id);
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
      const ids = results.map((e) => e.id);
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
      const betaEntry = summary.topDependedOn.find((e) => e.name === 'Beta');
      expect(betaEntry).toBeDefined();
      expect(betaEntry.dependentCount).toBe(2);
    });

    it('Go Atlas ArchJSON: relationCount sums all Atlas layer edges', () => {
      // package layer: 19 edges, capability layer: 23 edges, goroutine layer: 2 edges
      // FlowGraph has no .edges, so flow layer contributes 0
      const goAtlasArchJson = makeArchJson({
        language: 'go',
        relations: [], // empty — Atlas edges should take priority
        extensions: {
          goAtlas: {
            version: '2.0',
            layers: {
              package: {
                nodes: [],
                edges: Array.from({ length: 19 }, (_, i) => ({
                  from: `pkg${i}`,
                  to: `pkg${i + 1}`,
                  strength: 1,
                })),
                cycles: [],
              } as any,
              capability: {
                nodes: [],
                edges: Array.from({ length: 23 }, (_, i) => ({
                  id: `r${i}`,
                  type: 'uses',
                  source: `s${i}`,
                  target: `t${i}`,
                  confidence: 1,
                })),
              } as any,
              goroutine: {
                nodes: [],
                edges: [
                  { from: 'main', to: 'spawn-1', spawnType: 'go-stmt' },
                  { from: 'main', to: 'spawn-2', spawnType: 'go-stmt' },
                ],
                channels: [],
                channelEdges: [],
              } as any,
              flow: {
                // FlowGraph has no .edges — contributes 0
                entryPoints: [],
                callChains: [],
              } as any,
            },
            metadata: {
              generatedAt: new Date().toISOString(),
              generationStrategy: {
                functionBodyStrategy: 'none',
                detectedFrameworks: [],
                followIndirectCalls: false,
                goplsEnabled: false,
              },
              completeness: { package: 1, capability: 1, goroutine: 1, flow: 0 },
              performance: { fileCount: 10, parseTime: 50, totalTime: 100, memoryUsage: 2048 },
            },
          },
        },
      });

      const engine = createEngine(goAtlasArchJson);
      const summary = engine.getSummary();
      // 19 + 23 + 2 + 0 (flow has no .edges) = 44
      expect(summary.relationCount).toBe(44);
    });

    it('TypeScript ArchJSON (no Atlas extension): relationCount equals relations.length', () => {
      // Existing behaviour: no goAtlas extension → fall through to relations.length
      const engine = createEngine(baseArchJson);
      const summary = engine.getSummary();
      expect(summary.relationCount).toBe(baseArchJson.relations.length);
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
      const ids = results.map((e) => e.id);
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
      const ids = results.map((e) => e.id);
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
      const ids = results.map((e) => e.id);
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
      const ids = results.map((e) => e.id);
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

  // ---------------------------------------------------------------------------
  // Group A: getAtlasLayer() tests
  // ---------------------------------------------------------------------------

  describe('getAtlasLayer', () => {
    it('returns the PackageGraph when Atlas extension has a package layer', () => {
      const engine = createEngine(goAtlasArchJson);
      const layer = engine.getAtlasLayer('package');
      expect(layer).toBeDefined();
      expect((layer as PackageGraph).nodes).toHaveLength(2);
      expect((layer as PackageGraph).edges).toHaveLength(1);
    });

    it('returns undefined for a layer absent from the fixture (flow)', () => {
      const engine = createEngine(goAtlasArchJson);
      const layer = engine.getAtlasLayer('flow');
      expect(layer).toBeUndefined();
    });

    it('returns undefined when ArchJSON has no Atlas extension', () => {
      const engine = createEngine(baseArchJson); // TypeScript, no extensions
      const layer = engine.getAtlasLayer('package');
      expect(layer).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Group B: getSummary() capabilities tests
  // ---------------------------------------------------------------------------

  describe('getSummary capabilities', () => {
    it('Go Atlas project: classHierarchy false, packageGraph true, cycleDetection false', () => {
      const engine = createEngine(goAtlasArchJson);
      const summary = engine.getSummary();
      expect(summary.capabilities.classHierarchy).toBe(false);
      expect(summary.capabilities.packageGraph).toBe(true);
      expect(summary.capabilities.cycleDetection).toBe(false);
    });

    it('TypeScript project: classHierarchy true, packageGraph false, cycleDetection true', () => {
      const engine = createEngine(baseArchJson);
      const summary = engine.getSummary();
      expect(summary.capabilities.classHierarchy).toBe(true);
      expect(summary.capabilities.packageGraph).toBe(false);
      expect(summary.capabilities.cycleDetection).toBe(true);
    });

    it('project with implementation relations: interfaceImplementation true', () => {
      // baseArchJson has r2: implementation relation (C → B)
      const engine = createEngine(baseArchJson);
      const summary = engine.getSummary();
      expect(summary.capabilities.interfaceImplementation).toBe(true);
    });

    it('standard-mode Go project (no Atlas extension): cycleDetection false', () => {
      const standardGoArchJson = makeArchJson({ language: 'go' }); // no extensions
      const engine = createEngine(standardGoArchJson);
      const summary = engine.getSummary();
      expect(summary.capabilities.cycleDetection).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Group C: topDependedOn suppression tests
  // ---------------------------------------------------------------------------

  describe('getSummary topDependedOn suppression', () => {
    it('Go Atlas project: topDependedOn is empty array, topDependedOnNote is non-empty string', () => {
      const engine = createEngine(goAtlasArchJson);
      const summary = engine.getSummary();
      expect(summary.topDependedOn).toEqual([]);
      expect(typeof summary.topDependedOnNote).toBe('string');
      expect((summary.topDependedOnNote as string).length).toBeGreaterThan(0);
    });

    it('TypeScript project: topDependedOn is non-empty, topDependedOnNote is undefined', () => {
      const engine = createEngine(baseArchJson);
      const summary = engine.getSummary();
      expect(summary.topDependedOn.length).toBeGreaterThan(0);
      expect(summary.topDependedOnNote).toBeUndefined();
    });
  });

  describe('toSummary', () => {
    it('maps entity to EntitySummary with id, name, type, visibility, file', () => {
      const engine = createEngine(baseArchJson);
      const summary = engine.toSummary(entityA);
      expect(summary.id).toBe('A');
      expect(summary.name).toBe('Alpha');
      expect(summary.type).toBe('class');
      expect(summary.visibility).toBe('public');
      expect(summary.file).toBe('src/alpha.ts');
    });

    it('counts methods correctly', () => {
      const entity = makeEntity('X', 'Foo', {
        members: [
          { name: 'doWork', type: 'method', visibility: 'public' },
          { name: 'init', type: 'constructor', visibility: 'public' },
          { name: 'count', type: 'property', visibility: 'private' },
        ],
      });
      const engine = createEngine(makeArchJson({ entities: [entity] }));
      const summary = engine.toSummary(entity);
      expect(summary.methodCount).toBe(2); // method + constructor
      expect(summary.fieldCount).toBe(1); // property
    });

    it('counts fields correctly for field member type', () => {
      const entity = makeEntity('Y', 'Bar', {
        members: [
          { name: 'data', type: 'field', visibility: 'public' },
          { name: 'extra', type: 'field', visibility: 'private' },
        ],
      });
      const engine = createEngine(makeArchJson({ entities: [entity] }));
      const summary = engine.toSummary(entity);
      expect(summary.fieldCount).toBe(2);
      expect(summary.methodCount).toBe(0);
    });

    it('returns zero counts for entity with no members', () => {
      const engine = createEngine(baseArchJson);
      const summary = engine.toSummary(entityA); // members: []
      expect(summary.methodCount).toBe(0);
      expect(summary.fieldCount).toBe(0);
    });

    it('does not include members array in summary', () => {
      const engine = createEngine(baseArchJson);
      const summary = engine.toSummary(entityA);
      expect('members' in summary).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Fixtures for getPackageStats tests
  // ---------------------------------------------------------------------------

  const goAtlasWithEntitiesArchJson: ArchJSON = {
    version: '1.0',
    language: 'go',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['internal/query/engine.go', 'internal/query/index.go', 'cmd/main.go'],
    entities: [
      {
        id: 'internal/query/engine.go.QueryEngine',
        name: 'QueryEngine',
        type: 'struct',
        visibility: 'public',
        members: [
          { name: 'Find',    type: 'method',   visibility: 'public'  },
          { name: 'GetDeps', type: 'method',   visibility: 'public'  },
          { name: 'index',   type: 'field',    visibility: 'private' },
        ],
        sourceLocation: { file: 'internal/query/engine.go', startLine: 10, endLine: 80 },
      },
      {
        id: 'internal/query/index.go.ArchIndex',
        name: 'ArchIndex',
        type: 'interface',
        visibility: 'public',
        members: [
          { name: 'Build', type: 'method', visibility: 'public' },
        ],
        sourceLocation: { file: 'internal/query/index.go', startLine: 5, endLine: 20 },
      },
      {
        id: 'cmd/main.go.Server',
        name: 'Server',
        type: 'struct',
        visibility: 'public',
        members: [
          { name: 'Run',  type: 'method', visibility: 'public'  },
          { name: 'port', type: 'field',  visibility: 'private' },
        ],
        sourceLocation: { file: 'cmd/main.go', startLine: 8, endLine: 50 },
      },
    ],
    relations: [],
    extensions: {
      goAtlas: {
        version: '2.0',
        layers: {
          package: {
            nodes: [
              {
                id: 'github.com/example/app/internal/query',
                name: 'internal/query',
                type: 'internal',
                fileCount: 2,
                stats: { structs: 1, interfaces: 1, functions: 3 },
              },
              {
                id: 'github.com/example/app/cmd',
                name: 'cmd',
                type: 'cmd',
                fileCount: 1,
                stats: { structs: 1, interfaces: 0, functions: 1 },
              },
              {
                id: 'github.com/example/app/internal/query_test',
                name: 'internal/query_test',
                type: 'tests',
                fileCount: 3,
              },
            ],
            edges: [
              {
                from: 'github.com/example/app/cmd',
                to: 'github.com/example/app/internal/query',
                strength: 5,
              },
            ],
            cycles: [],
          },
        },
        metadata: {
          generatedAt: '2026-01-01T00:00:00Z',
          generationStrategy: {
            functionBodyStrategy: 'none',
            detectedFrameworks: [],
            followIndirectCalls: false,
            goplsEnabled: false,
          },
          completeness: { package: 1.0, capability: 0, goroutine: 0, flow: 0 },
          performance: { fileCount: 3, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
        },
      },
    },
  };

  const tsArchJson: ArchJSON = {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [
      'src/cli/engine.ts',
      'src/cli/loader.ts',
      'src/cli/engine.test.ts',
      'src/parser/index.ts',
    ],
    entities: [
      {
        id: 'src/cli/engine.ts.QueryEngine',
        name: 'QueryEngine',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'find',    type: 'method',   visibility: 'public'  },
          { name: 'index',   type: 'property', visibility: 'private' },
          { name: 'load',    type: 'method',   visibility: 'private' },
        ],
        sourceLocation: { file: 'src/cli/engine.ts', startLine: 5, endLine: 120 },
      },
      {
        id: 'src/cli/loader.ts.EngineLoader',
        name: 'EngineLoader',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'load', type: 'method', visibility: 'public' },
        ],
        sourceLocation: { file: 'src/cli/loader.ts', startLine: 3, endLine: 40 },
      },
      {
        id: 'src/parser/index.ts.Parser',
        name: 'Parser',
        type: 'interface',
        visibility: 'public',
        members: [
          { name: 'parse', type: 'method', visibility: 'public' },
        ],
        sourceLocation: { file: 'src/parser/index.ts', startLine: 1, endLine: 15 },
      },
    ],
    relations: [],
    extensions: {
      tsAnalysis: {
        version: '1.0',
        moduleGraph: {
          nodes: [
            {
              id: 'src/cli',
              name: 'src/cli',
              type: 'internal',
              fileCount: 3,
              stats: { classes: 2, interfaces: 0, functions: 0, enums: 0 },
            },
            {
              id: 'src/parser',
              name: 'src/parser',
              type: 'internal',
              fileCount: 1,
              stats: { classes: 0, interfaces: 1, functions: 0, enums: 0 },
            },
          ],
          edges: [
            { from: 'src/cli', to: 'src/parser', strength: 2, importedNames: ['Parser'] },
          ],
          cycles: [],
        },
      },
    },
  };

  const javaArchJson: ArchJSON = {
    version: '1.0',
    language: 'java',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [
      {
        id: 'com/example/service/OrderService.java.OrderService',
        name: 'OrderService',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'create',  type: 'method',   visibility: 'public'  },
          { name: 'delete',  type: 'method',   visibility: 'public'  },
          { name: 'orderId', type: 'field',    visibility: 'private' },
        ],
        sourceLocation: {
          file: 'com/example/service/OrderService.java',
          startLine: 5,
          endLine: 200,
        },
      },
      {
        id: 'com/example/service/UserService.java.UserService',
        name: 'UserService',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'find',   type: 'method', visibility: 'public'  },
          { name: 'userId', type: 'field',  visibility: 'private' },
        ],
        sourceLocation: {
          file: 'com/example/service/UserService.java',
          startLine: 3,
          endLine: 150,
        },
      },
      {
        id: 'com/example/service/OrderServiceTest.java.OrderServiceTest',
        name: 'OrderServiceTest',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'testCreate', type: 'method', visibility: 'public' },
        ],
        sourceLocation: {
          file: 'com/example/service/OrderServiceTest.java',
          startLine: 1,
          endLine: 60,
        },
      },
      {
        id: 'com/example/model/Order.java.Order',
        name: 'Order',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'id',    type: 'field', visibility: 'private' },
          { name: 'total', type: 'field', visibility: 'private' },
        ],
        sourceLocation: {
          file: 'com/example/model/Order.java',
          startLine: 1,
          endLine: 80,
        },
      },
    ],
    relations: [],
  };

  // ---------------------------------------------------------------------------
  // Group A: getPackageStats() — Go Atlas path
  // ---------------------------------------------------------------------------

  describe('getPackageStats — Go Atlas path', () => {
    it('returns 2 entries (filters out tests node)', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      expect(result.packages).toHaveLength(2);
    });

    it('first entry is internal/query (fileCount=2, sorted DESC)', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      expect(result.packages[0].package).toBe('internal/query');
      expect(result.packages[0].fileCount).toBe(2);
    });

    it('internal/query has methodCount=3 and fieldCount=1', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      const iq = result.packages.find((p) => p.package === 'internal/query');
      expect(iq).toBeDefined();
      expect(iq!.methodCount).toBe(3);
      expect(iq!.fieldCount).toBe(1);
    });

    it('internal/query has languageStats with structs/interfaces/functions', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      const iq = result.packages.find((p) => p.package === 'internal/query');
      expect(iq!.languageStats).toEqual({ structs: 1, interfaces: 1, functions: 3 });
    });

    it('internal/query has no loc field (loc === undefined)', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      const iq = result.packages.find((p) => p.package === 'internal/query');
      expect(iq!.loc).toBeUndefined();
    });

    it('cmd entry has methodCount=1 and fieldCount=1', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      const cmd = result.packages.find((p) => p.package === 'cmd');
      expect(cmd!.methodCount).toBe(1);
      expect(cmd!.fieldCount).toBe(1);
    });

    it('meta.dataPath is go-atlas and locAvailable is false', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats();
      expect(result.meta.dataPath).toBe('go-atlas');
      expect(result.meta.locAvailable).toBe(false);
    });

    it('topN=1 returns only 1 entry', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const result = engine.getPackageStats(2, 1);
      expect(result.packages).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Group B: getPackageStats() — TypeScript path
  // ---------------------------------------------------------------------------

  describe('getPackageStats — TypeScript path', () => {
    it('returns 2 entries (src/cli and src/parser)', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      expect(result.packages).toHaveLength(2);
    });

    it('src/cli has fileCount=3 (from TsModuleNode.fileCount, includes test file)', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      const cli = result.packages.find((p) => p.package === 'src/cli');
      expect(cli!.fileCount).toBe(3);
    });

    it('src/cli has testFileCount=1 (engine.test.ts absent from fileToIds but counted via sourceFiles)', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      const cli = result.packages.find((p) => p.package === 'src/cli');
      expect(cli!.testFileCount).toBe(1);
    });

    it('src/cli has entityCount=2, methodCount=3, fieldCount=1', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      const cli = result.packages.find((p) => p.package === 'src/cli');
      expect(cli!.entityCount).toBe(2);
      expect(cli!.methodCount).toBe(3);
      expect(cli!.fieldCount).toBe(1);
    });

    it('src/cli has languageStats with classes/interfaces/functions/enums', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      const cli = result.packages.find((p) => p.package === 'src/cli');
      expect(cli!.languageStats).toEqual({ classes: 2, interfaces: 0, functions: 0, enums: 0 });
    });

    it('src/cli has no loc field', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      const cli = result.packages.find((p) => p.package === 'src/cli');
      expect(cli!.loc).toBeUndefined();
    });

    it('meta.dataPath is ts-module-graph and locAvailable is false', () => {
      const engine = createEngine(tsArchJson);
      const result = engine.getPackageStats();
      expect(result.meta.dataPath).toBe('ts-module-graph');
      expect(result.meta.locAvailable).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Group C: getPackageStats() — OO Fallback path (Java)
  // ---------------------------------------------------------------------------

  describe('getPackageStats — OO Fallback path (Java)', () => {
    it('depth=3 returns 2 entries (com/example/service and com/example/model)', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const result = engine.getPackageStats(3);
      expect(result.packages).toHaveLength(2);
      const pkgNames = result.packages.map((p) => p.package);
      expect(pkgNames).toContain('com/example/service');
      expect(pkgNames).toContain('com/example/model');
    });

    it('com/example/service has fileCount=3, testFileCount=1, entityCount=3, methodCount=4, fieldCount=2, loc=410', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const result = engine.getPackageStats(3);
      const svc = result.packages.find((p) => p.package === 'com/example/service');
      expect(svc!.fileCount).toBe(3);
      expect(svc!.testFileCount).toBe(1);
      expect(svc!.entityCount).toBe(3);
      expect(svc!.methodCount).toBe(4);
      expect(svc!.fieldCount).toBe(2);
      expect(svc!.loc).toBe(410);
    });

    it('com/example/model has fileCount=1, testFileCount=0, entityCount=1, fieldCount=2, loc=80', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const result = engine.getPackageStats(3);
      const model = result.packages.find((p) => p.package === 'com/example/model');
      expect(model!.fileCount).toBe(1);
      expect(model!.testFileCount).toBe(0);
      expect(model!.entityCount).toBe(1);
      expect(model!.fieldCount).toBe(2);
      expect(model!.loc).toBe(80);
    });

    it('meta.dataPath is oo-derived, locAvailable is true, locBasis is maxEndLine', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const result = engine.getPackageStats(3);
      expect(result.meta.dataPath).toBe('oo-derived');
      expect(result.meta.locAvailable).toBe(true);
      expect(result.meta.locBasis).toBe('maxEndLine');
    });

    it('topN=1 with depth=3 returns the package with highest loc', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const result = engine.getPackageStats(3, 1);
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].package).toBe('com/example/service');
    });

    it('depth=2 merges service and model into com/example (1 entry)', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const result = engine.getPackageStats(2);
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].package).toBe('com/example');
    });
  });

  // ---------------------------------------------------------------------------
  // Group D: getSummary().topPackages
  // ---------------------------------------------------------------------------

  describe('getSummary topPackages', () => {
    it('Go Atlas engine: topPackages is present, length <= 10, first entry has fileCount', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const summary = engine.getSummary();
      expect(Array.isArray(summary.topPackages)).toBe(true);
      expect(summary.topPackages.length).toBeLessThanOrEqual(10);
      expect(summary.topPackages[0].fileCount).toBeGreaterThan(0);
    });

    it('Go Atlas engine: topPackages entries have no loc field', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const summary = engine.getSummary();
      for (const entry of summary.topPackages) {
        expect(entry.loc).toBeUndefined();
      }
    });

    it('TypeScript engine: topPackages has fileCount and languageStats', () => {
      const engine = createEngine(tsArchJson);
      const summary = engine.getSummary();
      expect(Array.isArray(summary.topPackages)).toBe(true);
      expect(summary.topPackages.length).toBeGreaterThan(0);
      const first = summary.topPackages[0];
      expect(first.fileCount).toBeGreaterThan(0);
      expect(first.languageStats).toBeDefined();
    });

    it('Java engine: topPackages has loc field', () => {
      const engine = createEngine(javaArchJson, { ...defaultScope, language: 'java' });
      const summary = engine.getSummary();
      expect(Array.isArray(summary.topPackages)).toBe(true);
      if (summary.topPackages.length > 0) {
        expect(summary.topPackages[0].loc).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Group E: getPackageStats() — OO Fallback path (Python) P0.4
  // ---------------------------------------------------------------------------

  const pythonWs = '/home/user/project';

  /**
   * A minimal Python ArchJSON fixture with workspaceRoot set.
   * Files: pytorch/engine/engine.py, pytorch/models/llama.py, serve/server.py
   */
  const pythonArchJson: ArchJSON = {
    version: '1.0',
    language: 'python',
    timestamp: '2026-01-01T00:00:00Z',
    workspaceRoot: pythonWs,
    sourceFiles: [
      `${pythonWs}/pytorch/engine/engine.py`,
      `${pythonWs}/pytorch/models/llama.py`,
      `${pythonWs}/serve/server.py`,
    ],
    entities: [
      {
        id: 'pytorch.engine.engine.Engine',
        name: 'Engine',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'run', type: 'method', visibility: 'public' },
          { name: 'stop', type: 'method', visibility: 'public' },
        ],
        sourceLocation: {
          file: `${pythonWs}/pytorch/engine/engine.py`,
          startLine: 1,
          endLine: 100,
        },
      },
      {
        id: 'pytorch.models.llama.LlamaModel',
        name: 'LlamaModel',
        type: 'class',
        visibility: 'public',
        members: [{ name: 'forward', type: 'method', visibility: 'public' }],
        sourceLocation: {
          file: `${pythonWs}/pytorch/models/llama.py`,
          startLine: 1,
          endLine: 80,
        },
      },
      {
        id: 'serve.server.APIServer',
        name: 'APIServer',
        type: 'class',
        visibility: 'public',
        members: [
          { name: 'start', type: 'method', visibility: 'public' },
          { name: 'port', type: 'property', visibility: 'public' },
        ],
        sourceLocation: {
          file: `${pythonWs}/serve/server.py`,
          startLine: 1,
          endLine: 60,
        },
      },
    ],
    relations: [],
  };

  describe('getPackageStats — Python (P0.4)', () => {
    it('returns meaningful package names (not home/yale/...) when workspaceRoot is set', () => {
      const engine = createEngine(pythonArchJson, { ...defaultScope, language: 'python' });
      const result = engine.getPackageStats(2);
      const pkgNames = result.packages.map((p) => p.package);
      // Must NOT start with filesystem path fragments
      for (const name of pkgNames) {
        expect(name).not.toMatch(/^home\//);
        expect(name).not.toMatch(/^\/home\//);
      }
    });

    it('depth=1 groups all pytorch files under "pytorch" and serve files under "serve"', () => {
      const engine = createEngine(pythonArchJson, { ...defaultScope, language: 'python' });
      const result = engine.getPackageStats(1);
      const pkgNames = result.packages.map((p) => p.package).sort();
      expect(pkgNames).toContain('pytorch');
      expect(pkgNames).toContain('serve');
    });

    it('depth=2 separates pytorch/engine and pytorch/models', () => {
      const engine = createEngine(pythonArchJson, { ...defaultScope, language: 'python' });
      const result = engine.getPackageStats(2);
      const pkgNames = result.packages.map((p) => p.package);
      expect(pkgNames).toContain('pytorch/engine');
      expect(pkgNames).toContain('pytorch/models');
      expect(pkgNames).toContain('serve');
    });

    it('entityCount is populated correctly for each package', () => {
      const engine = createEngine(pythonArchJson, { ...defaultScope, language: 'python' });
      const result = engine.getPackageStats(2);
      const enginePkg = result.packages.find((p) => p.package === 'pytorch/engine');
      expect(enginePkg).toBeDefined();
      expect(enginePkg!.entityCount).toBe(1);
      expect(enginePkg!.methodCount).toBe(2); // run + stop
    });

    it('meta.dataPath is oo-derived', () => {
      const engine = createEngine(pythonArchJson, { ...defaultScope, language: 'python' });
      const result = engine.getPackageStats(2);
      expect(result.meta.dataPath).toBe('oo-derived');
    });
  });

  // ---------------------------------------------------------------------------
  // Group F: getSummary().totalPackageCount
  // ---------------------------------------------------------------------------

  describe('getSummary totalPackageCount', () => {
    /**
     * Build an ArchJSON with >10 distinct top-level packages so topPackages gets truncated.
     * Each entity lives in a separate package (pkg00/ … pkg11/).
     */
    function makeManyPackageArchJson(count: number): ArchJSON {
      const ws = '/ws';
      const entities: Entity[] = Array.from({ length: count }, (_, i) => {
        const pkg = `pkg${String(i).padStart(2, '0')}`;
        return {
          id: `${pkg}.module.Cls${i}`,
          name: `Cls${i}`,
          type: 'class' as const,
          visibility: 'public' as const,
          members: [],
          sourceLocation: { file: `${ws}/${pkg}/module.py`, startLine: 1, endLine: 10 },
        };
      });
      return {
        version: '1.0',
        language: 'python',
        timestamp: '2026-01-01T00:00:00Z',
        workspaceRoot: ws,
        sourceFiles: entities.map((e) => e.sourceLocation.file),
        entities,
        relations: [],
      };
    }

    it('totalPackageCount equals topPackages.length when <= 10 packages exist', () => {
      const engine = createEngine(pythonArchJson, { ...defaultScope, language: 'python' });
      const summary = engine.getSummary();
      expect(summary.totalPackageCount).toBe(summary.topPackages.length);
    });

    it('totalPackageCount reflects the full package count when > 10 packages exist', () => {
      const archJson = makeManyPackageArchJson(12);
      const engine = createEngine(archJson, { ...defaultScope, language: 'python' });
      const summary = engine.getSummary();
      expect(summary.topPackages.length).toBeLessThanOrEqual(10);
      expect(summary.totalPackageCount).toBe(12);
      expect(summary.totalPackageCount).toBeGreaterThan(summary.topPackages.length);
    });

    it('totalPackageCount is present and a number for Go Atlas', () => {
      const engine = createEngine(goAtlasWithEntitiesArchJson, { ...defaultScope, language: 'go' });
      const summary = engine.getSummary();
      expect(typeof summary.totalPackageCount).toBe('number');
      expect(summary.totalPackageCount).toBeGreaterThan(0);
    });

    it('totalPackageCount is present and a number for TypeScript', () => {
      const engine = createEngine(tsArchJson);
      const summary = engine.getSummary();
      expect(typeof summary.totalPackageCount).toBe('number');
      expect(summary.totalPackageCount).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Fix A: OO Fallback fileCount includes entity-less source files (C++)
  // ---------------------------------------------------------------------------
  describe('getPackageStats — OO Fallback fileCount includes entity-less source files (C++)', () => {
    const cppWs = '/workspace';
    const cppArchJson: ArchJSON = {
      version: '1.0',
      language: 'cpp',
      timestamp: '2026-01-01T00:00:00Z',
      workspaceRoot: cppWs,
      // 3 source files: only sampling.cpp has an entity; the other two are impl-only
      sourceFiles: [
        `${cppWs}/src/sampling.cpp`,
        `${cppWs}/src/impl-detail.cpp`,
        `${cppWs}/src/helper-util.cpp`,
      ],
      entities: [
        {
          id: 'src.Sampler',
          name: 'Sampler',
          type: 'struct',
          visibility: 'public',
          members: [{ name: 'sample', type: 'method', visibility: 'public' }],
          sourceLocation: { file: `${cppWs}/src/sampling.cpp`, startLine: 5, endLine: 80 },
        },
      ],
      relations: [],
    };

    it('fileCount for src package is 3 (includes entity-less C++ files)', () => {
      const engine = createEngine(cppArchJson, { ...defaultScope, language: 'cpp' });
      const result = engine.getPackageStats(1);
      const src = result.packages.find((p) => p.package === 'src');
      expect(src).toBeDefined();
      expect(src!.fileCount).toBe(3);
    });

    it('entityCount for src package is still 1 (only entity-having file contributes)', () => {
      const engine = createEngine(cppArchJson, { ...defaultScope, language: 'cpp' });
      const result = engine.getPackageStats(1);
      const src = result.packages.find((p) => p.package === 'src');
      expect(src!.entityCount).toBe(1);
    });

    it('total fileCount across all packages equals sourceFiles.length (no double-counting)', () => {
      const engine = createEngine(cppArchJson, { ...defaultScope, language: 'cpp' });
      const result = engine.getPackageStats(1);
      const total = result.packages.reduce((s, p) => s + p.fileCount, 0);
      expect(total).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Stage 1.2: getPackageCoverage
  // ---------------------------------------------------------------------------
  describe('getPackageCoverage', () => {
    it('returns empty array when test analysis is absent', () => {
      const engine = createEngine(baseArchJson);
      expect(engine.getPackageCoverage()).toEqual([]);
    });

    it('groups entities by directory and computes coverage ratio', () => {
      const entityA = makeEntity('entity-a', 'EntityA', {
        sourceLocation: { file: 'src/utils/a.ts', startLine: 1, endLine: 10 },
      });
      const entityB = makeEntity('entity-b', 'EntityB', {
        sourceLocation: { file: 'src/utils/b.ts', startLine: 1, endLine: 10 },
      });
      const entityC = makeEntity('entity-c', 'EntityC', {
        sourceLocation: { file: 'src/core/c.ts', startLine: 1, endLine: 10 },
      });

      const testAnalysis: TestAnalysis = {
        version: '1.0',
        patternConfigSource: 'auto',
        testFiles: [],
        coverageMap: [
          { sourceEntityId: 'entity-a', coveredByTestIds: ['tests/a.test.ts'], coverageScore: 0.9 },
          { sourceEntityId: 'entity-b', coveredByTestIds: [], coverageScore: 0.0 },
          { sourceEntityId: 'entity-c', coveredByTestIds: ['tests/c.test.ts'], coverageScore: 0.7 },
        ],
        issues: [],
        metrics: {
          totalTestFiles: 2,
          byType: { unit: 2, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
          entityCoverageRatio: 0.67,
          assertionDensity: 3.0,
          skipRatio: 0,
          issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
        },
      };

      const engine = createEngine(
        makeArchJson({ entities: [entityA, entityB, entityC], extensions: { testAnalysis } })
      );

      const result = engine.getPackageCoverage();

      const utilsPkg = result.find((p) => p.package === 'src/utils');
      const corePkg = result.find((p) => p.package === 'src/core');

      expect(utilsPkg).toBeDefined();
      expect(utilsPkg!.totalEntities).toBe(2);
      expect(utilsPkg!.coveredEntities).toBe(1);
      expect(utilsPkg!.coverageRatio).toBeCloseTo(0.5);

      expect(corePkg).toBeDefined();
      expect(corePkg!.totalEntities).toBe(1);
      expect(corePkg!.coveredEntities).toBe(1);
      expect(corePkg!.coverageRatio).toBeCloseTo(1.0);
    });

    it('sorts results ascending by coverageRatio (worst-covered first)', () => {
      const entityA = makeEntity('entity-a', 'EntityA', {
        sourceLocation: { file: 'src/utils/a.ts', startLine: 1, endLine: 10 },
      });
      const entityB = makeEntity('entity-b', 'EntityB', {
        sourceLocation: { file: 'src/core/b.ts', startLine: 1, endLine: 10 },
      });
      const entityC = makeEntity('entity-c', 'EntityC', {
        sourceLocation: { file: 'src/models/c.ts', startLine: 1, endLine: 10 },
      });

      const testAnalysis: TestAnalysis = {
        version: '1.0',
        patternConfigSource: 'auto',
        testFiles: [],
        coverageMap: [
          { sourceEntityId: 'entity-a', coveredByTestIds: [], coverageScore: 0.0 },
          { sourceEntityId: 'entity-b', coveredByTestIds: ['tests/b.test.ts'], coverageScore: 0.5 },
          { sourceEntityId: 'entity-c', coveredByTestIds: ['tests/c.test.ts'], coverageScore: 1.0 },
        ],
        issues: [],
        metrics: {
          totalTestFiles: 2,
          byType: { unit: 2, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
          entityCoverageRatio: 0.67,
          assertionDensity: 3.0,
          skipRatio: 0,
          issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
        },
      };

      const engine = createEngine(
        makeArchJson({ entities: [entityA, entityB, entityC], extensions: { testAnalysis } })
      );

      const result = engine.getPackageCoverage();

      expect(result.length).toBe(3);
      expect(result[0].coverageRatio).toBeLessThanOrEqual(result[1].coverageRatio);
      expect(result[1].coverageRatio).toBeLessThanOrEqual(result[2].coverageRatio);
      expect(result[0].package).toBe('src/utils'); // 0.0
      expect(result[2].package).toBe('src/models'); // 1.0
    });

    it('accumulates testFileIds across entities in the same package', () => {
      const entityA = makeEntity('entity-a', 'EntityA', {
        sourceLocation: { file: 'src/utils/a.ts', startLine: 1, endLine: 10 },
      });
      const entityB = makeEntity('entity-b', 'EntityB', {
        sourceLocation: { file: 'src/utils/b.ts', startLine: 1, endLine: 10 },
      });

      const testAnalysis: TestAnalysis = {
        version: '1.0',
        patternConfigSource: 'auto',
        testFiles: [],
        coverageMap: [
          {
            sourceEntityId: 'entity-a',
            coveredByTestIds: ['tests/a.test.ts', 'tests/shared.test.ts'],
            coverageScore: 0.8,
          },
          {
            sourceEntityId: 'entity-b',
            coveredByTestIds: ['tests/b.test.ts', 'tests/shared.test.ts'],
            coverageScore: 0.6,
          },
        ],
        issues: [],
        metrics: {
          totalTestFiles: 3,
          byType: { unit: 3, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
          entityCoverageRatio: 1.0,
          assertionDensity: 3.0,
          skipRatio: 0,
          issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
        },
      };

      const engine = createEngine(
        makeArchJson({ entities: [entityA, entityB], extensions: { testAnalysis } })
      );

      const result = engine.getPackageCoverage();

      expect(result).toHaveLength(1);
      const utilsPkg = result[0];
      expect(utilsPkg.package).toBe('src/utils');
      expect(utilsPkg.testFileIds).toHaveLength(3); // deduplicated: a, b, shared
      expect(utilsPkg.testFileIds).toContain('tests/a.test.ts');
      expect(utilsPkg.testFileIds).toContain('tests/b.test.ts');
      expect(utilsPkg.testFileIds).toContain('tests/shared.test.ts');
    });
  });

  // Stage 1.3: getEntityCoverage
  // ---------------------------------------------------------------------------
  describe('getEntityCoverage', () => {
    const coveredEntity = makeEntity('entity-covered', 'Covered', {
      sourceLocation: { file: 'src/covered.ts', startLine: 1, endLine: 20 },
    });
    const uncoveredEntity = makeEntity('entity-uncovered', 'Uncovered', {
      sourceLocation: { file: 'src/uncovered.ts', startLine: 1, endLine: 10 },
    });

    const testAnalysis: TestAnalysis = {
      version: '1.0',
      patternConfigSource: 'auto',
      testFiles: [
        {
          id: 'tests/covered.test.ts',
          filePath: '/ws/tests/covered.test.ts',
          frameworks: ['vitest'],
          testType: 'unit',
          testCaseCount: 3,
          assertionCount: 9,
          skipCount: 0,
          assertionDensity: 3.0,
          coveredEntityIds: ['entity-covered'],
        },
      ],
      coverageMap: [
        { sourceEntityId: 'entity-covered', coveredByTestIds: ['tests/covered.test.ts'], coverageScore: 0.85 },
        { sourceEntityId: 'entity-uncovered', coveredByTestIds: [], coverageScore: 0.0 },
      ],
      issues: [],
      metrics: {
        totalTestFiles: 1,
        byType: { unit: 1, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
        entityCoverageRatio: 0.5,
        assertionDensity: 3.0,
        skipRatio: 0,
        issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
      },
    };

    function createEntityCoverageEngine(): QueryEngine {
      return createEngine(
        makeArchJson({
          entities: [coveredEntity, uncoveredEntity],
          extensions: { testAnalysis },
        })
      );
    }

    it('returns found=false with empty arrays when no test analysis is present', () => {
      const engine = createEngine(baseArchJson);
      const result = engine.getEntityCoverage('entity-covered');
      expect(result.found).toBe(false);
      expect(result.coverageScore).toBe(0);
      expect(result.coveredByTestIds).toEqual([]);
      expect(result.testFileDetails).toEqual([]);
    });

    it('returns found=false for an entity ID not in the coverage map', () => {
      const engine = createEntityCoverageEngine();
      const result = engine.getEntityCoverage('entity-does-not-exist');
      expect(result.found).toBe(false);
      expect(result.coverageScore).toBe(0);
      expect(result.coveredByTestIds).toEqual([]);
      expect(result.testFileDetails).toEqual([]);
    });

    it('returns found=true, coverageScore=0, empty testFileDetails for zero-coverage entity', () => {
      const engine = createEntityCoverageEngine();
      const result = engine.getEntityCoverage('entity-uncovered');
      expect(result.found).toBe(true);
      expect(result.coverageScore).toBe(0);
      expect(result.coveredByTestIds).toEqual([]);
      expect(result.testFileDetails).toEqual([]);
    });

    it('returns found=true, coverageScore, and testFileDetails for a covered entity', () => {
      const engine = createEntityCoverageEngine();
      const result = engine.getEntityCoverage('entity-covered');
      expect(result.found).toBe(true);
      expect(result.entityId).toBe('entity-covered');
      expect(result.coverageScore).toBeCloseTo(0.85);
      expect(result.coveredByTestIds).toContain('tests/covered.test.ts');
      expect(result.testFileDetails).toHaveLength(1);
      expect(result.testFileDetails[0].id).toBe('tests/covered.test.ts');
      expect(result.testFileDetails[0].testType).toBe('unit');
      expect(result.testFileDetails[0].assertionCount).toBe(9);
      expect(result.testFileDetails[0].assertionDensity).toBeCloseTo(3.0);
    });
  });
});
