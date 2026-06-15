/**
 * Coverage tests for QueryEngine methods not exercised in query-engine.test.ts:
 *   findByAttr, findByTypeAndAttr, findSubclasses, getFileEntities, getCycles,
 *   findHighCoupling/findOrphans/findInCycles (delegation), toSummary,
 *   getScopeEntry, BFS edge cases, extension delegation.
 */
import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@/core/query/query-engine.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultScope: QueryScopeEntry = {
  key: 'coverage-test',
  label: 'coverage test',
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

function makeEngine(archJson: ArchJSON, scope = defaultScope): QueryEngine {
  const index = buildArchIndex(archJson);
  return new QueryEngine({ archJson, archIndex: index, scopeEntry: scope });
}

// ---------------------------------------------------------------------------
// findByAttr (via QueryEngine — was .todo in query-engine.test.ts)
// ---------------------------------------------------------------------------

describe('QueryEngine.findByAttr', () => {
  const entities = [
    makeEntity('pkg.A', 'A', { attributes: { deprecated: true, module: 'core' } }),
    makeEntity('pkg.B', 'B', { attributes: { module: 'utils' } }),
    makeEntity('pkg.C', 'C'),
  ];
  const engine = makeEngine(makeArchJson({ entities }));

  it('finds entities with a given attribute key (key-only check)', () => {
    const result = engine.findByAttr('deprecated');
    expect(Array.isArray(result)).toBe(true);
    const names = (result as Entity[]).map((e) => e.name);
    expect(names).toContain('A');
    expect(names).not.toContain('B');
    expect(names).not.toContain('C');
  });

  it('finds entities matching a specific attribute value', () => {
    const result = engine.findByAttr('module', 'utils');
    expect(Array.isArray(result)).toBe(true);
    const names = (result as Entity[]).map((e) => e.name);
    expect(names).toContain('B');
    expect(names).not.toContain('A');
  });

  it('returns empty for unknown attribute key', () => {
    const result = engine.findByAttr('nonexistent');
    expect(result).toHaveLength(0);
  });

  it('returns empty when key exists but value does not match', () => {
    const result = engine.findByAttr('module', 'unknown');
    expect(result).toHaveLength(0);
  });

  it('respects outputScope option', () => {
    const result = engine.findByAttr('deprecated', undefined, { outputScope: 'class' });
    expect(Array.isArray(result)).toBe(true);
    const entities = result as Partial<Entity>[];
    expect(entities[0].members).toBeUndefined();
    expect(entities[0].name).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// findByTypeAndAttr (via QueryEngine)
// ---------------------------------------------------------------------------

describe('QueryEngine.findByTypeAndAttr', () => {
  const entities = [
    makeEntity('pkg.A', 'A', { type: 'class', attributes: { deprecated: true, module: 'core' } }),
    makeEntity('pkg.B', 'B', { type: 'interface', attributes: { module: 'utils' } }),
    makeEntity('pkg.C', 'C', { type: 'class' }),
  ];
  const engine = makeEngine(makeArchJson({ entities }));

  it('filters by type only when no attrKey given', () => {
    const result = engine.findByTypeAndAttr('class');
    expect((result as Entity[]).map((e) => e.name)).toEqual(expect.arrayContaining(['A', 'C']));
    expect((result as Entity[]).some((e) => e.name === 'B')).toBe(false);
  });

  it('filters by type + attrKey presence', () => {
    const result = engine.findByTypeAndAttr('class', 'deprecated');
    expect((result as Entity[])).toHaveLength(1);
    expect((result as Entity[])[0].name).toBe('A');
  });

  it('filters by type + attrKey + attrValue', () => {
    const result = engine.findByTypeAndAttr('class', 'module', 'core');
    expect((result as Entity[])).toHaveLength(1);
    expect((result as Entity[])[0].name).toBe('A');
  });

  it('returns empty when type matches but attr does not', () => {
    const result = engine.findByTypeAndAttr('class', 'module', 'nonexistent');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findSubclasses (via QueryEngine)
// ---------------------------------------------------------------------------

describe('QueryEngine.findSubclasses', () => {
  it('finds subclasses via inheritance relations', () => {
    const entities = [
      makeEntity('pkg.Base', 'Base', { type: 'class' }),
      makeEntity('pkg.Child', 'Child', { type: 'class' }),
      makeEntity('pkg.Other', 'Other', { type: 'class' }),
    ];
    const relations: Relation[] = [
      { source: 'pkg.Child', target: 'pkg.Base', type: 'inheritance' },
    ];
    const engine = makeEngine(makeArchJson({ entities, relations }));

    const result = engine.findSubclasses('Base');
    expect(Array.isArray(result)).toBe(true);
    expect((result as Entity[]).map((e) => e.name)).toContain('Child');
    expect((result as Entity[]).map((e) => e.name)).not.toContain('Other');
  });

  it('returns empty when no subclasses exist', () => {
    const entities = [makeEntity('pkg.Base', 'Base'), makeEntity('pkg.Solo', 'Solo')];
    const engine = makeEngine(makeArchJson({ entities }));
    expect(engine.findSubclasses('Base')).toHaveLength(0);
  });

  it('returns empty for unknown class name', () => {
    const engine = makeEngine(makeArchJson());
    expect(engine.findSubclasses('Unknown')).toHaveLength(0);
  });

  it('respects outputScope=class option', () => {
    const members = [{ name: 'run', type: 'method' as const, visibility: 'public' as const }];
    const entities = [
      makeEntity('pkg.Base', 'Base'),
      makeEntity('pkg.Child', 'Child', { members }),
    ];
    const engine = makeEngine(
      makeArchJson({
        entities,
        relations: [{ source: 'pkg.Child', target: 'pkg.Base', type: 'inheritance' }],
      })
    );
    const result = engine.findSubclasses('Base', { outputScope: 'class' });
    expect((result as Partial<Entity>[])[0].members).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getFileEntities (via QueryEngine)
// ---------------------------------------------------------------------------

describe('QueryEngine.getFileEntities', () => {
  it('returns all entities defined in a given file', () => {
    const entities = [
      makeEntity('pkg.A', 'A', { sourceLocation: { file: 'src/core.ts', startLine: 1, endLine: 10 } }),
      makeEntity('pkg.B', 'B', { sourceLocation: { file: 'src/core.ts', startLine: 12, endLine: 20 } }),
      makeEntity('pkg.C', 'C', { sourceLocation: { file: 'src/other.ts', startLine: 1, endLine: 5 } }),
    ];
    const engine = makeEngine(makeArchJson({ entities }));

    const result = engine.getFileEntities('src/core.ts');
    expect((result as Entity[]).map((e) => e.name)).toEqual(expect.arrayContaining(['A', 'B']));
    expect((result as Entity[]).map((e) => e.name)).not.toContain('C');
  });

  it('returns empty for an unknown file path', () => {
    const engine = makeEngine(makeArchJson({ entities: [makeEntity('pkg.A', 'A')] }));
    expect(engine.getFileEntities('src/nonexistent.ts')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getCycles (via QueryEngine)
// ---------------------------------------------------------------------------

describe('QueryEngine.getCycles', () => {
  it('returns cycle info for a 2-node cycle', () => {
    const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
    const relations: Relation[] = [
      { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
      { source: 'pkg.B', target: 'pkg.A', type: 'dependency' },
    ];
    const engine = makeEngine(makeArchJson({ entities, relations }));
    const cycles = engine.getCycles();

    expect(Array.isArray(cycles)).toBe(true);
    expect(cycles.length).toBeGreaterThan(0);
    const cycleIds = cycles.flatMap((c) => c.members);
    expect(cycleIds).toContain('pkg.A');
    expect(cycleIds).toContain('pkg.B');
  });

  it('returns empty array when no cycles exist', () => {
    const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
    const engine = makeEngine(
      makeArchJson({
        entities,
        relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
      })
    );
    expect(engine.getCycles()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Delegation: findHighCoupling, findOrphans, findInCycles (via QueryEngine)
// ---------------------------------------------------------------------------

describe('QueryEngine.findHighCoupling (delegation)', () => {
  it('returns entities with total edges >= threshold', () => {
    const entities = [
      makeEntity('pkg.Hub', 'Hub'),
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
    ];
    // Hub: 2 out + 2 in = 4 edges
    const relations: Relation[] = [
      { source: 'pkg.Hub', target: 'pkg.A', type: 'dependency' },
      { source: 'pkg.Hub', target: 'pkg.B', type: 'dependency' },
      { source: 'pkg.A', target: 'pkg.Hub', type: 'dependency' },
      { source: 'pkg.B', target: 'pkg.Hub', type: 'dependency' },
    ];
    const engine = makeEngine(makeArchJson({ entities, relations }));

    expect(engine.findHighCoupling(4).some((e) => e.name === 'Hub')).toBe(true);
    expect(engine.findHighCoupling(5)).toHaveLength(0);
  });
});

describe('QueryEngine.findOrphans (delegation)', () => {
  it('returns entities with no incoming or outgoing edges', () => {
    const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B'), makeEntity('pkg.Lone', 'Lone')];
    const engine = makeEngine(
      makeArchJson({
        entities,
        relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
      })
    );
    const orphans = engine.findOrphans();
    expect(orphans.map((e) => e.name)).toContain('Lone');
    expect(orphans.map((e) => e.name)).not.toContain('A');
  });
});

describe('QueryEngine.findInCycles (delegation)', () => {
  it('returns entities participating in any cycle', () => {
    const entities = [makeEntity('pkg.X', 'X'), makeEntity('pkg.Y', 'Y'), makeEntity('pkg.Z', 'Z')];
    const engine = makeEngine(
      makeArchJson({
        entities,
        relations: [
          { source: 'pkg.X', target: 'pkg.Y', type: 'dependency' },
          { source: 'pkg.Y', target: 'pkg.X', type: 'dependency' },
        ],
      })
    );
    const inCycles = engine.findInCycles();
    expect(inCycles.map((e) => e.name)).toContain('X');
    expect(inCycles.map((e) => e.name)).toContain('Y');
    expect(inCycles.map((e) => e.name)).not.toContain('Z');
  });
});

// ---------------------------------------------------------------------------
// toSummary
// ---------------------------------------------------------------------------

describe('QueryEngine.toSummary', () => {
  it('counts methods and fields from members array', () => {
    const entity = makeEntity('pkg.A', 'A', {
      members: [
        { name: 'run', type: 'method', visibility: 'public', returnType: 'void', parameters: [] },
        { name: 'init', type: 'constructor', visibility: 'public', returnType: 'void', parameters: [] },
        { name: 'count', type: 'field', visibility: 'private' },
        { name: 'label', type: 'property', visibility: 'public' },
      ],
    });
    const engine = makeEngine(makeArchJson({ entities: [entity] }));
    const summary = engine.toSummary(entity);

    expect(summary.name).toBe('A');
    expect(summary.id).toBe('pkg.A');
    expect(summary.type).toBe('class');
    expect(summary.methodCount).toBe(2); // method + constructor
    expect(summary.fieldCount).toBe(2);  // field + property
  });

  it('returns zero counts when members is empty', () => {
    const entity = makeEntity('pkg.Empty', 'Empty');
    const engine = makeEngine(makeArchJson({ entities: [entity] }));
    const summary = engine.toSummary(entity);

    expect(summary.methodCount).toBe(0);
    expect(summary.fieldCount).toBe(0);
    expect(summary.file).toBe('src/empty.ts');
  });
});

// ---------------------------------------------------------------------------
// getScopeEntry
// ---------------------------------------------------------------------------

describe('QueryEngine.getScopeEntry', () => {
  it('returns the scope entry passed to the constructor', () => {
    const scope: QueryScopeEntry = {
      ...defaultScope,
      key: 'my-scope',
      label: 'My Scope',
      kind: 'derived',
    };
    const engine = makeEngine(makeArchJson(), scope);
    expect(engine.getScopeEntry()).toBe(scope);
    expect(engine.getScopeEntry().key).toBe('my-scope');
    expect(engine.getScopeEntry().kind).toBe('derived');
  });
});

// ---------------------------------------------------------------------------
// BFS edge cases
// ---------------------------------------------------------------------------

describe('QueryEngine BFS edge cases', () => {
  const entities = [
    makeEntity('pkg.A', 'A'),
    makeEntity('pkg.B', 'B'),
    makeEntity('pkg.C', 'C'),
    makeEntity('pkg.D', 'D'),
    makeEntity('pkg.E', 'E'),
    makeEntity('pkg.F', 'F'),
  ];
  // A→B→C→D→E→F (chain of length 5)
  const relations: Relation[] = [
    { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
    { source: 'pkg.B', target: 'pkg.C', type: 'dependency' },
    { source: 'pkg.C', target: 'pkg.D', type: 'dependency' },
    { source: 'pkg.D', target: 'pkg.E', type: 'dependency' },
    { source: 'pkg.E', target: 'pkg.F', type: 'dependency' },
  ];
  const engine = makeEngine(makeArchJson({ entities, relations }));

  it('getDependencies returns [] for unknown entity', () => {
    expect(engine.getDependencies('NonExistent', 1)).toHaveLength(0);
  });

  it('getDependents returns [] for unknown entity', () => {
    expect(engine.getDependents('NonExistent', 1)).toHaveLength(0);
  });

  it('depth 0 is clamped to 1 (returns direct deps only)', () => {
    const result = engine.getDependencies('A', 0) as Entity[];
    expect(result.map((e) => e.name)).toEqual(['B']);
  });

  it('depth 10 is clamped to 5 (returns at most 5 hops)', () => {
    // Chain A→B→C→D→E→F; clamped depth=5 from A reaches B,C,D,E,F
    const result = engine.getDependencies('A', 10) as Entity[];
    const names = result.map((e) => e.name);
    expect(names).toContain('B');
    expect(names).toContain('F'); // 5th hop
  });

  it('getDependents traverses reverse direction at depth 2', () => {
    // F is depended on by E (depth 1), E by D (depth 2)
    const result = engine.getDependents('F', 2) as Entity[];
    const names = result.map((e) => e.name);
    expect(names).toContain('E');
    expect(names).toContain('D');
    expect(names).not.toContain('C'); // depth 3, not reached
  });

  it('BFS does not revisit already-visited nodes', () => {
    // Diamond: A→B, A→C, B→D, C→D — D should appear only once
    const diamondEntities = [
      makeEntity('d.A', 'A'),
      makeEntity('d.B', 'B'),
      makeEntity('d.C', 'C'),
      makeEntity('d.D', 'D'),
    ];
    const diamondEngine = makeEngine(
      makeArchJson({
        entities: diamondEntities,
        relations: [
          { source: 'd.A', target: 'd.B', type: 'dependency' },
          { source: 'd.A', target: 'd.C', type: 'dependency' },
          { source: 'd.B', target: 'd.D', type: 'dependency' },
          { source: 'd.C', target: 'd.D', type: 'dependency' },
        ],
      })
    );
    const result = diamondEngine.getDependencies('A', 2) as Entity[];
    const dCount = result.filter((e) => e.name === 'D').length;
    expect(dCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Extension delegation: hasTestAnalysis, getTestAnalysis
// ---------------------------------------------------------------------------

describe('QueryEngine extension delegation — testAnalysis', () => {
  it('hasTestAnalysis() returns false when no extension', () => {
    const engine = makeEngine(makeArchJson());
    expect(engine.hasTestAnalysis()).toBe(false);
  });

  it('getTestAnalysis() returns undefined when no extension', () => {
    const engine = makeEngine(makeArchJson());
    expect(engine.getTestAnalysis()).toBeUndefined();
  });

  it('hasTestAnalysis() returns true when testAnalysis extension is present', () => {
    const archJson = makeArchJson({
      extensions: {
        testAnalysis: {
          testFiles: [],
          coverageMap: [],
          issues: [],
          metrics: {
            totalTestFiles: 0,
            totalTestCases: 0,
            totalAssertions: 0,
            avgAssertionDensity: 0,
            testTypeBreakdown: {},
            frameworkBreakdown: {},
            entityCoverageRatio: 0,
          },
        } as any,
      },
    });
    const engine = makeEngine(archJson);
    expect(engine.hasTestAnalysis()).toBe(true);
    expect(engine.getTestAnalysis()).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Delegation smoke tests: getPackageCoverage, getEntityCoverage, getPackageStats
// ---------------------------------------------------------------------------

describe('QueryEngine delegation smoke tests', () => {
  it('getPackageCoverage() returns [] when no testAnalysis', () => {
    const engine = makeEngine(makeArchJson({ entities: [makeEntity('pkg.A', 'A')] }));
    expect(engine.getPackageCoverage()).toEqual([]);
  });

  it('getEntityCoverage() returns found=false for uncovered entity', () => {
    const engine = makeEngine(makeArchJson({ entities: [makeEntity('pkg.A', 'A')] }));
    const result = engine.getEntityCoverage('pkg.A');
    expect(result.found).toBe(false);
    expect(result.coverageScore).toBe(0);
  });

  it('getPackageStats() returns empty packages for empty ArchJSON', () => {
    const engine = makeEngine(makeArchJson());
    const result = engine.getPackageStats();
    expect(result.packages).toEqual([]);
  });

  it('getPackageStats(depth) partitions entities by path depth', () => {
    const entities = [
      makeEntity('a', 'A', { sourceLocation: { file: 'src/parser/ast.ts', startLine: 1, endLine: 5 } }),
      makeEntity('b', 'B', { sourceLocation: { file: 'src/mermaid/gen.ts', startLine: 1, endLine: 5 } }),
    ];
    const engine = makeEngine(makeArchJson({ entities, sourceFiles: ['src/parser/ast.ts', 'src/mermaid/gen.ts'] }));
    const result = engine.getPackageStats(2);
    expect(result.packages.length).toBe(2);
    const pkgNames = result.packages.map((p) => p.package);
    expect(pkgNames).toContain('src/parser');
    expect(pkgNames).toContain('src/mermaid');
  });
});
