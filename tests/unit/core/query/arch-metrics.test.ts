/**
 * TDD tests for ArchMetrics (Phase 96)
 *
 * Tests the 7 public methods of ArchMetrics, extracted from QueryEngine.
 */
import { describe, it, expect } from 'vitest';
import { ArchMetrics } from '@/core/query/arch-metrics.js';
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

function makeMetrics(archJson: ArchJSON): ArchMetrics {
  const index = buildArchIndex(archJson);
  return new ArchMetrics(archJson, index);
}

// ---------------------------------------------------------------------------
// Test 1: getSummary
// ---------------------------------------------------------------------------

describe('ArchMetrics.getSummary', () => {
  it('returns entityCount, relationCount, topPackages, and other fields', () => {
    const entityA = makeEntity('pkg.A', 'A', {
      members: [makeMethod('doSomething'), makeMethod('doOther'), makeField('value')],
      sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 20 },
    });
    const entityB = makeEntity('pkg.B', 'B', {
      members: [makeMethod('run')],
      sourceLocation: { file: 'src/b.ts', startLine: 1, endLine: 15 },
    });
    const archJson = makeArchJson({
      entities: [entityA, entityB],
      relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
      sourceFiles: ['src/a.ts', 'src/b.ts'],
    });

    const metrics = makeMetrics(archJson);
    const summary = metrics.getSummary();

    expect(summary.entityCount).toBe(2);
    expect(summary.relationCount).toBe(1);
    expect(summary.topDependedOn).toBeDefined();
    expect(Array.isArray(summary.topDependedOn)).toBe(true);
    expect(summary.relationCountByType).toBeDefined();
    expect(summary.relationCountByType['dependency']).toBe(1);
    expect(summary.topByMethodCount).toBeDefined();
    expect(Array.isArray(summary.topByMethodCount)).toBe(true);
    expect(summary.topByMethodCount[0].methodCount).toBeGreaterThanOrEqual(2); // A has 2 methods
    expect(summary.topByOutDegree).toBeDefined();
    expect(summary.totalPackageCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(summary.topPackages)).toBe(true);
  });

  it('returns zero counts for empty ArchJSON', () => {
    const metrics = makeMetrics(makeArchJson());
    const summary = metrics.getSummary();

    expect(summary.entityCount).toBe(0);
    expect(summary.relationCount).toBe(0);
    expect(summary.topDependedOn).toEqual([]);
    expect(summary.topByMethodCount).toEqual([]);
    expect(summary.topByOutDegree).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 2: getPackageStats
// ---------------------------------------------------------------------------

describe('ArchMetrics.getPackageStats', () => {
  it('returns package entries with fileCount and entityCount', () => {
    const archJson = makeArchJson({
      entities: [
        makeEntity('pkg/sub.A', 'A', {
          sourceLocation: { file: 'pkg/sub/a.ts', startLine: 1, endLine: 10 },
        }),
        makeEntity('pkg/sub.B', 'B', {
          sourceLocation: { file: 'pkg/sub/b.ts', startLine: 1, endLine: 10 },
        }),
      ],
      sourceFiles: ['pkg/sub/a.ts', 'pkg/sub/b.ts'],
    });
    const metrics = makeMetrics(archJson);
    const result = metrics.getPackageStats(2);

    expect(result.packages.length).toBeGreaterThanOrEqual(1);
    expect(result.meta).toBeDefined();
    expect(result.meta.dataPath).toBeDefined();
  });

  it('returns empty packages array for empty ArchJSON', () => {
    const metrics = makeMetrics(makeArchJson());
    const result = metrics.getPackageStats();

    expect(result.packages).toEqual([]);
    expect(result.meta).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 3: getPackageCoverage
// ---------------------------------------------------------------------------

describe('ArchMetrics.getPackageCoverage', () => {
  it('returns empty array when no testAnalysis extension', () => {
    const archJson = makeArchJson({
      entities: [makeEntity('pkg.A', 'A')],
    });
    const metrics = makeMetrics(archJson);
    const result = metrics.getPackageCoverage();

    expect(result).toEqual([]);
  });

  it('returns package coverage buckets when testAnalysis present', () => {
    const entity = makeEntity('pkg.A', 'A', {
      sourceLocation: { file: 'src/core/a.ts', startLine: 1, endLine: 10 },
    });
    const archJson = makeArchJson({
      entities: [entity],
      extensions: {
        testAnalysis: {
          testFiles: [],
          coverageMap: [
            {
              sourceEntityId: 'pkg.A',
              coveredByTestIds: ['test-1'],
              coverageScore: 0.85,
            },
          ],
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
    const metrics = makeMetrics(archJson);
    const result = metrics.getPackageCoverage();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toHaveProperty('package');
    expect(result[0]).toHaveProperty('totalEntities');
    expect(result[0]).toHaveProperty('coveredEntities');
    expect(result[0]).toHaveProperty('coverageRatio');
  });
});

// ---------------------------------------------------------------------------
// Test 4: getEntityCoverage
// ---------------------------------------------------------------------------

describe('ArchMetrics.getEntityCoverage', () => {
  it('returns found=false with zero score when no testAnalysis', () => {
    const metrics = makeMetrics(makeArchJson({ entities: [makeEntity('pkg.A', 'A')] }));
    const result = metrics.getEntityCoverage('pkg.A');

    expect(result.found).toBe(false);
    expect(result.coverageScore).toBe(0);
    expect(result.coveredByTestIds).toEqual([]);
    expect(result.testFileDetails).toEqual([]);
  });

  it('returns coverage details when entity is covered', () => {
    const entity = makeEntity('pkg.A', 'A', {
      sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 10 },
    });
    const archJson = makeArchJson({
      entities: [entity],
      extensions: {
        testAnalysis: {
          testFiles: [
            {
              id: 'test-1',
              file: 'src/a.test.ts',
              testType: 'unit',
              testCaseCount: 3,
              assertionCount: 5,
              assertionDensity: 1.67,
              frameworks: ['vitest'],
            },
          ],
          coverageMap: [
            {
              sourceEntityId: 'pkg.A',
              coveredByTestIds: ['test-1'],
              coverageScore: 0.9,
            },
          ],
          issues: [],
          metrics: {
            totalTestFiles: 1,
            totalTestCases: 3,
            totalAssertions: 5,
            avgAssertionDensity: 1.67,
            testTypeBreakdown: {},
            frameworkBreakdown: {},
            entityCoverageRatio: 1.0,
          },
        } as any,
      },
    });
    const metrics = makeMetrics(archJson);
    const result = metrics.getEntityCoverage('pkg.A');

    expect(result.found).toBe(true);
    expect(result.coverageScore).toBe(0.9);
    expect(result.coveredByTestIds).toContain('test-1');
    expect(result.testFileDetails).toHaveLength(1);
    expect(result.testFileDetails[0].id).toBe('test-1');
  });
});

// ---------------------------------------------------------------------------
// Test 5: findHighCoupling
// ---------------------------------------------------------------------------

describe('ArchMetrics.findHighCoupling', () => {
  it('returns entities whose total edges >= threshold', () => {
    // A has 3 outgoing edges, B has 1 incoming (from A's deps)
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
      makeEntity('pkg.D', 'D'),
      makeEntity('pkg.Hub', 'Hub'),
    ];
    const relations: Relation[] = [
      { source: 'pkg.Hub', target: 'pkg.A', type: 'dependency' },
      { source: 'pkg.Hub', target: 'pkg.B', type: 'dependency' },
      { source: 'pkg.Hub', target: 'pkg.C', type: 'dependency' },
      { source: 'pkg.Hub', target: 'pkg.D', type: 'dependency' },
      { source: 'pkg.A', target: 'pkg.Hub', type: 'dependency' },
      { source: 'pkg.B', target: 'pkg.Hub', type: 'dependency' },
      { source: 'pkg.C', target: 'pkg.Hub', type: 'dependency' },
      { source: 'pkg.D', target: 'pkg.Hub', type: 'dependency' },
    ];
    const archJson = makeArchJson({ entities, relations });
    const metrics = makeMetrics(archJson);

    // Hub: 4 outgoing + 4 incoming = 8 edges, threshold=8 => included
    const highCoupled = metrics.findHighCoupling(8);
    expect(highCoupled.some((e) => e.name === 'Hub')).toBe(true);

    // threshold=9 => Hub is NOT included (8 < 9)
    const none = metrics.findHighCoupling(9);
    expect(none.some((e) => e.name === 'Hub')).toBe(false);
  });

  it('returns empty array for empty ArchJSON', () => {
    const metrics = makeMetrics(makeArchJson());
    expect(metrics.findHighCoupling()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 6: findOrphans
// ---------------------------------------------------------------------------

describe('ArchMetrics.findOrphans', () => {
  it('returns entities with zero incoming and outgoing edges', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.Orphan', 'Orphan'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
    });
    const metrics = makeMetrics(archJson);
    const orphans = metrics.findOrphans();

    expect(orphans).toHaveLength(1);
    expect(orphans[0].name).toBe('Orphan');
  });

  it('returns empty array when all entities have relations', () => {
    const entities = [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')];
    const archJson = makeArchJson({
      entities,
      relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
    });
    const metrics = makeMetrics(archJson);
    expect(metrics.findOrphans()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7: findInCycles
// ---------------------------------------------------------------------------

describe('ArchMetrics.findInCycles', () => {
  it('returns entities that participate in cycles', () => {
    const entities = [
      makeEntity('pkg.A', 'A'),
      makeEntity('pkg.B', 'B'),
      makeEntity('pkg.C', 'C'),
    ];
    const archJson = makeArchJson({
      entities,
      relations: [
        { source: 'pkg.A', target: 'pkg.B', type: 'dependency' },
        { source: 'pkg.B', target: 'pkg.A', type: 'dependency' }, // cycle A<->B
      ],
    });
    const metrics = makeMetrics(archJson);
    const inCycles = metrics.findInCycles();

    // A and B form a cycle
    expect(inCycles.some((e) => e.name === 'A')).toBe(true);
    expect(inCycles.some((e) => e.name === 'B')).toBe(true);
    // C is not in a cycle
    expect(inCycles.some((e) => e.name === 'C')).toBe(false);
  });

  it('returns empty array when no cycles exist', () => {
    const archJson = makeArchJson({
      entities: [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')],
      relations: [{ source: 'pkg.A', target: 'pkg.B', type: 'dependency' }],
    });
    const metrics = makeMetrics(archJson);
    expect(metrics.findInCycles()).toEqual([]);
  });
});
