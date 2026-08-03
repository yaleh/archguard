/**
 * Unit tests for QualityMetrics (arch-metrics-quality).
 */

import { describe, it, expect } from 'vitest';
import { QualityMetrics } from '@/core/query/arch-metrics-quality.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import type { ArchJSON, Entity } from '@/types/index.js';

function makeEntity(
  id: string,
  name: string,
  file: string,
  overrides: Partial<Entity> = {}
): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
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

function makeQuality(archJson: ArchJSON): QualityMetrics {
  return new QualityMetrics(archJson, new ExtensionAccessor(archJson));
}

describe('QualityMetrics.getPackageCoverage', () => {
  it('returns [] when no test analysis extension is present', () => {
    expect(makeQuality(makeArchJson()).getPackageCoverage()).toEqual([]);
  });

  it('aggregates entity coverage into package buckets sorted ascending by ratio', () => {
    const archJson = makeArchJson({
      entities: [
        makeEntity('e1', 'E1', 'src/com/example/a/E1.java'),
        makeEntity('e2', 'E2', 'src/com/example/a/E2.java'),
        makeEntity('e3', 'E3', 'src/com/example/b/E3.java'),
      ],
      extensions: {
        testAnalysis: {
          version: '1.0',
          testFiles: [
            {
              id: 't1',
              testType: 'unit',
              testCaseCount: 2,
              assertionCount: 5,
              assertionDensity: 2.5,
              frameworks: ['junit5'],
            },
          ],
          coverageMap: [
            { sourceEntityId: 'e1', coveredByTestIds: ['t1'], coverageScore: 1 },
            { sourceEntityId: 'e2', coveredByTestIds: [], coverageScore: 0 },
          ],
        },
      },
    });
    const result = makeQuality(archJson).getPackageCoverage();
    // src/com/example/a: 1/2 covered, src/com/example/b: 0/1 covered
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      package: 'src/com/example/b',
      totalEntities: 1,
      coveredEntities: 0,
      coverageRatio: 0,
    });
    expect(result[1]).toMatchObject({
      package: 'src/com/example/a',
      totalEntities: 2,
      coveredEntities: 1,
      coverageRatio: 0.5,
    });
    expect(result[1].testFileIds).toEqual(['t1']);
  });

  it('treats entities without coverage links as uncovered', () => {
    const archJson = makeArchJson({
      entities: [makeEntity('e1', 'E1', 'pkg/E1.java')],
      extensions: {
        testAnalysis: { version: '1.0', testFiles: [], coverageMap: [] },
      },
    });
    const result = makeQuality(archJson).getPackageCoverage();
    expect(result[0]).toMatchObject({ package: 'pkg', totalEntities: 1, coveredEntities: 0 });
  });
});

describe('QualityMetrics.getEntityCoverage', () => {
  it('returns found:false when no test analysis is present', () => {
    const result = makeQuality(makeArchJson()).getEntityCoverage('e1');
    expect(result).toMatchObject({ entityId: 'e1', coverageScore: 0, found: false });
  });

  it('returns found:false when the entity has no link', () => {
    const archJson = makeArchJson({
      entities: [makeEntity('e1', 'E1', 'pkg/E1.java')],
      extensions: {
        testAnalysis: { version: '1.0', testFiles: [], coverageMap: [] },
      },
    });
    const result = makeQuality(archJson).getEntityCoverage('e1');
    expect(result.found).toBe(false);
  });

  it('returns full detail when the entity is covered', () => {
    const archJson = makeArchJson({
      entities: [makeEntity('e1', 'E1', 'pkg/E1.java')],
      extensions: {
        testAnalysis: {
          version: '1.0',
          testFiles: [
            {
              id: 't1',
              testType: 'unit',
              testCaseCount: 3,
              assertionCount: 7,
              assertionDensity: 2.33,
              frameworks: ['vitest'],
            },
          ],
          coverageMap: [{ sourceEntityId: 'e1', coveredByTestIds: ['t1'], coverageScore: 0.8 }],
        },
      },
    });
    const result = makeQuality(archJson).getEntityCoverage('e1');
    expect(result.found).toBe(true);
    expect(result.coverageScore).toBe(0.8);
    expect(result.coveredByTestIds).toEqual(['t1']);
    expect(result.testFileDetails).toHaveLength(1);
    expect(result.testFileDetails[0]).toMatchObject({
      id: 't1',
      testType: 'unit',
      frameworks: ['vitest'],
    });
  });

  it('returns empty detail when coveredByTestIds is empty', () => {
    const archJson = makeArchJson({
      entities: [makeEntity('e1', 'E1', 'pkg/E1.java')],
      extensions: {
        testAnalysis: {
          version: '1.0',
          testFiles: [],
          coverageMap: [{ sourceEntityId: 'e1', coveredByTestIds: [], coverageScore: 0.5 }],
        },
      },
    });
    const result = makeQuality(archJson).getEntityCoverage('e1');
    expect(result.found).toBe(true);
    expect(result.testFileDetails).toEqual([]);
  });
});
