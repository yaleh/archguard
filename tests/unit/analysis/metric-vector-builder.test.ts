import { describe, it, expect } from 'vitest';
import { buildMetricVector } from '@/analysis/metric-vector-builder.js';
import type { ArchJSON } from '@/types/index.js';
import type { PackageStatEntry } from '@/cli/query/query-engine.js';

// Minimal helpers
function makeArchJson(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  };
}

function makePackageStats(fileCounts: number[]): PackageStatEntry[] {
  return fileCounts.map((fileCount, i) => ({
    package: `pkg${i}`,
    fileCount,
    entityCount: 0,
    methodCount: 0,
    fieldCount: 0,
  }));
}

describe('buildMetricVector', () => {
  // Test 1: Minimal ArchJSON with fileStats inDegrees [0,2,10]
  it('computes correct vector fields for minimal ArchJSON with fileStats', () => {
    const archJson = makeArchJson({
      metrics: {
        level: 'class',
        entityCount: 3,
        relationCount: 2,
        inferredRelationRatio: 0.5,
        stronglyConnectedComponents: 3,
        relationTypeBreakdown: { inheritance: 2 },
        fileStats: [
          { file: 'a.ts', loc: 10, entityCount: 1, methodCount: 1, fieldCount: 0, inDegree: 0, outDegree: 1, cycleCount: 0 },
          { file: 'b.ts', loc: 20, entityCount: 1, methodCount: 1, fieldCount: 0, inDegree: 2, outDegree: 0, cycleCount: 0 },
          { file: 'c.ts', loc: 30, entityCount: 1, methodCount: 1, fieldCount: 0, inDegree: 10, outDegree: 3, cycleCount: 0 },
        ],
        cycles: [],
      },
    });
    const packageStats = makePackageStats([4, 6]);
    const vec = buildMetricVector(archJson, packageStats);

    expect(vec.schemaVersion).toBe(1);
    expect(vec.totalEntities).toBe(3);
    expect(vec.totalRelations).toBe(2);
    expect(vec.inferredRelationRatio).toBe(0.5);
    expect(vec.maxInDegree).toBe(10);
    expect(vec.maxOutDegree).toBe(3);
    expect(vec.packageCount).toBe(2);
    expect(vec.maxPackageSize).toBe(6);
    expect(vec.relationTypeBreakdown).toEqual({ inheritance: 2 });
  });

  // Test 2: No fileStats → maxInDegree=0, maxOutDegree=0, giniInDegree=0
  it('returns zero in/out degree metrics when fileStats is undefined', () => {
    const archJson = makeArchJson({
      metrics: {
        level: 'class',
        entityCount: 1,
        relationCount: 0,
        inferredRelationRatio: 0,
        stronglyConnectedComponents: 1,
        relationTypeBreakdown: {},
        cycles: [],
        // fileStats intentionally omitted
      },
    });
    const vec = buildMetricVector(archJson, []);

    expect(vec.maxInDegree).toBe(0);
    expect(vec.maxOutDegree).toBe(0);
    expect(vec.giniInDegree).toBe(0);
  });

  // Test 3: Empty packageStats → maxPackageSize=0, packageCount=0, giniPackageSize=0
  it('returns zero package metrics when packageStats is empty', () => {
    const archJson = makeArchJson({
      metrics: {
        level: 'class',
        entityCount: 0,
        relationCount: 0,
        inferredRelationRatio: 0,
        stronglyConnectedComponents: 0,
        relationTypeBreakdown: {},
        cycles: [],
      },
    });
    const vec = buildMetricVector(archJson, []);

    expect(vec.maxPackageSize).toBe(0);
    expect(vec.packageCount).toBe(0);
    expect(vec.giniPackageSize).toBe(0);
  });

  // Test 4: With testAnalysis extension → entityCoverageRatio=0.8
  it('reads entityCoverageRatio from testAnalysis extension', () => {
    const archJson = makeArchJson({
      extensions: {
        testAnalysis: {
          version: '1.1',
          patternConfigSource: 'auto',
          testFiles: [],
          coverageMap: [],
          issues: [],
          metrics: {
            entityCoverageRatio: 0.8,
            totalTestFiles: 5,
            byType: {} as Record<string, number>,
            assertionDensity: 2.0,
            skipRatio: 0,
            issueCount: {} as Record<string, number>,
          } as import('@/types/index.js').TestMetrics,
        },
      },
    });
    const vec = buildMetricVector(archJson, []);
    expect(vec.entityCoverageRatio).toBe(0.8);
  });

  // Test 5: Without testAnalysis extension → entityCoverageRatio=null
  it('returns null entityCoverageRatio when testAnalysis extension is absent', () => {
    const archJson = makeArchJson();
    const vec = buildMetricVector(archJson, []);
    expect(vec.entityCoverageRatio).toBeNull();
  });

  // Test 6: sccCount derived from cycles.length, NOT stronglyConnectedComponents
  it('derives sccCount from cycles.length, not stronglyConnectedComponents', () => {
    const archJson = makeArchJson({
      metrics: {
        level: 'class',
        entityCount: 5,
        relationCount: 5,
        inferredRelationRatio: 0,
        stronglyConnectedComponents: 99, // intentionally different
        relationTypeBreakdown: {},
        cycles: [
          { members: ['a', 'b'], size: 2 },
          { members: ['c', 'd', 'e'], size: 3 },
        ],
      },
    });
    const vec = buildMetricVector(archJson, []);
    // Should use cycles.length (2), NOT stronglyConnectedComponents (99)
    expect(vec.sccCount).toBe(2);
  });

  // Test 7: Known inDegree distribution [0,2,4,10] → Gini = 0.5
  it('computes correct Gini coefficient for inDegree distribution [0,2,4,10]', () => {
    // Hand calculation:
    // sorted = [0,2,4,10], n=4, sum=16
    // weightedSum = 1*0 + 2*2 + 3*4 + 4*10 = 0+4+12+40 = 56
    // G = (2*56)/(4*16) - (4+1)/4 = 112/64 - 1.25 = 1.75 - 1.25 = 0.5
    const archJson = makeArchJson({
      metrics: {
        level: 'class',
        entityCount: 4,
        relationCount: 0,
        inferredRelationRatio: 0,
        stronglyConnectedComponents: 4,
        relationTypeBreakdown: {},
        fileStats: [
          { file: 'a.ts', loc: 1, entityCount: 1, methodCount: 0, fieldCount: 0, inDegree: 0, outDegree: 0, cycleCount: 0 },
          { file: 'b.ts', loc: 1, entityCount: 1, methodCount: 0, fieldCount: 0, inDegree: 2, outDegree: 0, cycleCount: 0 },
          { file: 'c.ts', loc: 1, entityCount: 1, methodCount: 0, fieldCount: 0, inDegree: 4, outDegree: 0, cycleCount: 0 },
          { file: 'd.ts', loc: 1, entityCount: 1, methodCount: 0, fieldCount: 0, inDegree: 10, outDegree: 0, cycleCount: 0 },
        ],
      },
    });
    const vec = buildMetricVector(archJson, []);
    expect(vec.giniInDegree).toBeCloseTo(0.5, 5);
  });

  // Test 8: Known package sizes [5,5,5] → giniPackageSize=0 (perfect equality)
  it('computes giniPackageSize=0 for equal package sizes', () => {
    const archJson = makeArchJson();
    const packageStats = makePackageStats([5, 5, 5]);
    const vec = buildMetricVector(archJson, packageStats);
    expect(vec.giniPackageSize).toBe(0);
  });

  // Test 9: archJson.metrics is undefined → all global metrics default to 0, sccCount=0
  it('defaults all global metrics to 0 when archJson.metrics is undefined', () => {
    const archJson = makeArchJson(); // no metrics field
    const vec = buildMetricVector(archJson, []);

    expect(vec.totalEntities).toBe(0);
    expect(vec.totalRelations).toBe(0);
    expect(vec.inferredRelationRatio).toBe(0);
    expect(vec.sccCount).toBe(0);
    expect(vec.relationTypeBreakdown).toEqual({});
    expect(vec.maxInDegree).toBe(0);
    expect(vec.maxOutDegree).toBe(0);
    expect(vec.giniInDegree).toBe(0);
  });

  // Integration-style Test A: schemaVersion is always 1 regardless of input
  it('[integration] schemaVersion is always 1 for any realistic ArchJSON input', () => {
    const archJson = makeArchJson({
      entities: [
        { id: 'pkg.A', name: 'A', type: 'class', visibility: 'public', methods: [], fields: [], sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 50 } },
        { id: 'pkg.B', name: 'B', type: 'class', visibility: 'public', methods: [], fields: [], sourceLocation: { file: 'src/b.ts', startLine: 1, endLine: 30 } },
      ],
      relations: [
        { from: 'pkg.A', to: 'pkg.B', type: 'dependency' },
      ],
      metrics: {
        level: 'class',
        entityCount: 2,
        relationCount: 1,
        inferredRelationRatio: 0.0,
        stronglyConnectedComponents: 2,
        relationTypeBreakdown: { dependency: 1 },
        fileStats: [
          { file: 'src/a.ts', loc: 50, entityCount: 1, methodCount: 2, fieldCount: 1, inDegree: 0, outDegree: 1, cycleCount: 0 },
          { file: 'src/b.ts', loc: 30, entityCount: 1, methodCount: 1, fieldCount: 0, inDegree: 1, outDegree: 0, cycleCount: 0 },
        ],
        cycles: [],
      },
    });
    const packageStats = makePackageStats([2]);
    const vec = buildMetricVector(archJson, packageStats);

    expect(vec.schemaVersion).toBe(1);
    expect(vec.totalEntities).toBe(2);
    expect(vec.totalRelations).toBe(1);
    expect(vec.packageCount).toBe(1);
    expect(vec.maxInDegree).toBe(1);
  });

  // Integration-style Test B: empty fileStats + empty packageStats → all zeros, no crash
  it('[integration] empty fileStats and empty packageStats produce all-zero derived metrics without throwing', () => {
    const archJson = makeArchJson({
      metrics: {
        level: 'class',
        entityCount: 0,
        relationCount: 0,
        inferredRelationRatio: 0,
        stronglyConnectedComponents: 0,
        relationTypeBreakdown: {},
        fileStats: [],
        cycles: [],
      },
    });
    expect(() => buildMetricVector(archJson, [])).not.toThrow();
    const vec = buildMetricVector(archJson, []);

    expect(vec.schemaVersion).toBe(1);
    expect(vec.maxInDegree).toBe(0);
    expect(vec.maxOutDegree).toBe(0);
    expect(vec.maxPackageSize).toBe(0);
    expect(vec.packageCount).toBe(0);
    expect(vec.giniInDegree).toBe(0);
    expect(vec.giniPackageSize).toBe(0);
    expect(vec.sccCount).toBe(0);
  });

  // Integration-style Test C: metrics undefined → all zero defaults, schemaVersion still 1
  it('[integration] undefined archJson.metrics produces all-zero defaults and schemaVersion=1', () => {
    const archJson = makeArchJson({
      // metrics intentionally absent — simulates a freshly-parsed ArchJSON before MetricsCalculator runs
      entities: [
        { id: 'x.Foo', name: 'Foo', type: 'class', visibility: 'public', methods: [], fields: [], sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 } },
      ],
      relations: [],
    });
    const packageStats = makePackageStats([3, 5]);
    const vec = buildMetricVector(archJson, packageStats);

    expect(vec.schemaVersion).toBe(1);
    expect(vec.totalEntities).toBe(0);      // from metrics (undefined → 0)
    expect(vec.totalRelations).toBe(0);
    expect(vec.sccCount).toBe(0);
    expect(vec.maxInDegree).toBe(0);
    expect(vec.maxOutDegree).toBe(0);
    // packageStats are still used even without metrics
    expect(vec.packageCount).toBe(2);
    expect(vec.maxPackageSize).toBe(5);
    expect(vec.giniPackageSize).toBeGreaterThanOrEqual(0);
  });
});
