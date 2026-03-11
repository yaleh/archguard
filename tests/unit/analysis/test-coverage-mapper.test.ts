import { describe, it, expect } from 'vitest';
import type { TestFileInfo, CoverageLink } from '@/types/extensions.js';
import type { ArchJSON } from '@/types/index.js';

function makeTestFile(id: string, coveredEntityIds: string[] = []): TestFileInfo {
  return {
    id,
    filePath: `/workspace/${id}`,
    frameworks: ['vitest'],
    testType: 'unit',
    testCaseCount: 2,
    assertionCount: 4,
    skipCount: 0,
    assertionDensity: 2,
    coveredEntityIds,
  };
}

function makeArchJson(entities: any[] = []): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: [],
    entities,
    relations: [],
    extensions: {},
  } as any;
}

describe('TestCoverageMapper', () => {
  it('creates CoverageLink for each covered entity', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [
      makeTestFile('foo.test.ts', ['entity-1', 'entity-2']),
      makeTestFile('bar.test.ts', ['entity-1']),
    ];
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'Entity1', type: 'class', sourceLocation: { file: 'src/entity1.ts', startLine: 1, endLine: 10 } },
      { id: 'entity-2', name: 'Entity2', type: 'class', sourceLocation: { file: 'src/entity2.ts', startLine: 1, endLine: 10 } },
    ]);

    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const entity1 = result.find((l: CoverageLink) => l.sourceEntityId === 'entity-1');
    expect(entity1).toBeDefined();
    expect(entity1!.coveredByTestIds).toContain('foo.test.ts');
    expect(entity1!.coveredByTestIds).toContain('bar.test.ts');
  });

  it('coverageScore is > 0 for covered entities', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('foo.test.ts', ['entity-1'])];
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'Entity1', type: 'class', sourceLocation: { file: 'src/entity1.ts', startLine: 1, endLine: 10 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    expect(result[0].coverageScore).toBeGreaterThan(0);
  });

  it('returns empty array when no test files', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const result = mapper.buildCoverageMap([], makeArchJson([]), '/workspace');
    expect(result).toHaveLength(0);
  });

  // Deviation 5: coverage map must include ALL entities (score=0 for uncovered ones)
  it('includes entities with no test coverage (score 0, empty coveredByTestIds)', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    const testFiles = [makeTestFile('foo.test.ts', ['entity-1'])];
    const archJson = makeArchJson([
      { id: 'entity-1', name: 'Covered', type: 'class', sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 5 } },
      { id: 'entity-2', name: 'Uncovered', type: 'class', sourceLocation: { file: 'src/b.ts', startLine: 1, endLine: 5 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const uncovered = result.find((l: CoverageLink) => l.sourceEntityId === 'entity-2');
    expect(uncovered).toBeDefined();
    expect(uncovered!.coverageScore).toBe(0);
    expect(uncovered!.coveredByTestIds).toHaveLength(0);
  });

  it('path-convention matching creates link for test with matching name', async () => {
    const { TestCoverageMapper } = await import('@/analysis/test-coverage-mapper.js');
    const mapper = new TestCoverageMapper();
    // foo.test.ts should match entity in foo.ts via path convention
    const testFiles = [makeTestFile('foo.test.ts', [])];
    const archJson = makeArchJson([
      { id: 'entity-foo', name: 'Foo', type: 'class', sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 } },
    ]);
    const result = mapper.buildCoverageMap(testFiles, archJson, '/workspace');
    const link = result.find((l: CoverageLink) => l.sourceEntityId === 'entity-foo');
    expect(link).toBeDefined();
    expect(link!.coveredByTestIds).toContain('foo.test.ts');
  });
});
