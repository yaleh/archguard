import { describe, it, expect } from 'vitest';
import { buildCoverageMatrixFromImports } from '@/analysis/fim/coverage-parser.js';

function makeImportGraph(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([key, values]) => [key, new Set(values)]));
}

describe('buildCoverageMatrixFromImports', () => {
  it('builds the expected binary coverage matrix for known imports', () => {
    const coverage = buildCoverageMatrixFromImports(
      ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'],
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
      makeImportGraph({
        'tests/a.test.ts': ['src/a.ts', 'src/b.ts'],
        'tests/b.test.ts': ['src/c.ts'],
        'tests/c.test.ts': ['src/e.ts'],
      })
    );

    expect(coverage.fileIds).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']);
    expect(coverage.matrix).toEqual([
      [1, 1, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1],
    ]);
  });

  it('excludes test files from source columns', () => {
    const coverage = buildCoverageMatrixFromImports(
      ['tests/a.test.ts'],
      ['tests/helper.test.ts', 'src/a.ts'],
      makeImportGraph({
        'tests/a.test.ts': ['tests/helper.test.ts', 'src/a.ts'],
      })
    );

    expect(coverage.fileIds).toEqual(['src/a.ts']);
    expect(coverage.matrix).toEqual([[1]]);
  });

  it('returns all-zero rows for tests with no imports', () => {
    const coverage = buildCoverageMatrixFromImports(
      ['tests/a.test.ts'],
      ['src/a.ts', 'src/b.ts'],
      makeImportGraph({})
    );

    expect(coverage.matrix).toEqual([[0, 0]]);
  });

  it('includes transitive imports up to depth 3', () => {
    const coverage = buildCoverageMatrixFromImports(
      ['tests/a.test.ts'],
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      makeImportGraph({
        'tests/a.test.ts': ['src/a.ts'],
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/c.ts'],
      })
    );

    expect(coverage.matrix).toEqual([[1, 1, 1]]);
  });

  it('does not loop forever on circular imports', () => {
    const coverage = buildCoverageMatrixFromImports(
      ['tests/a.test.ts'],
      ['src/a.ts', 'src/b.ts'],
      makeImportGraph({
        'tests/a.test.ts': ['src/a.ts'],
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/a.ts'],
      })
    );

    expect(coverage.matrix).toEqual([[1, 1]]);
  });

  it('honors the transitive depth limit', () => {
    const coverage = buildCoverageMatrixFromImports(
      ['tests/a.test.ts'],
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      makeImportGraph({
        'tests/a.test.ts': ['src/a.ts'],
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/c.ts'],
        'src/c.ts': ['src/d.ts'],
      })
    );

    expect(coverage.matrix).toEqual([[1, 1, 1, 0]]);
  });
});
