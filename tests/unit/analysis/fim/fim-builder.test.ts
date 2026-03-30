import { describe, it, expect } from 'vitest';
import {
  aggregateToPackageLevel,
  computeFisherInformation,
  computeGramMatrix,
} from '@/analysis/fim/fim-builder.js';
import type { CoverageMatrix } from '@/analysis/fim/types.js';

function makeCoverageMatrix(matrix: number[][], fileIds: string[]): CoverageMatrix {
  return {
    matrix,
    testIds: matrix.map((_, index) => `test-${index}`),
    fileIds,
  };
}

describe('computeGramMatrix', () => {
  it('computes C^T C', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 0],
        [1, 1],
      ],
      ['src/a.ts', 'src/b.ts']
    );

    expect(computeGramMatrix(coverage)).toEqual([
      [2, 1],
      [1, 1],
    ]);
  });
});

describe('computeFisherInformation', () => {
  it('returns identity metrics for orthogonal coverage', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      ['src/a.ts', 'src/b.ts', 'src/c.ts']
    );

    const result = computeFisherInformation(coverage);

    expect(result.eigenvalues).toEqual([1, 1, 1]);
    expect(result.conditionNumber).toBe(1);
    expect(result.effectiveDimension).toBe(3);
  });

  it('reports rank-1 all-ones coverage with infinite condition number', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
      ['src/a.ts', 'src/b.ts', 'src/c.ts']
    );

    const result = computeFisherInformation(coverage);

    expect(result.eigenvalues[0]).toBeCloseTo(12, 8);
    expect(result.eigenvalues.slice(1)).toEqual([0, 0]);
    expect(result.conditionNumber).toBe(Number.POSITIVE_INFINITY);
    expect(result.effectiveDimension).toBeCloseTo(1, 8);
  });

  it('reports uncovered files when a column is all zeros', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 0],
        [1, 0],
      ],
      ['src/a.ts', 'src/b.ts']
    );

    const result = computeFisherInformation(coverage);

    expect(result.uncoveredFiles).toEqual(['src/b.ts']);
  });

  it('returns only non-negative eigenvalues', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 0],
      ],
      ['src/a.ts', 'src/b.ts', 'src/c.ts']
    );

    const result = computeFisherInformation(coverage);
    expect(result.eigenvalues.every((value) => value >= -1e-10)).toBe(true);
  });

  it('sets the diagonal to the test-count per file', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      ['src/a.ts', 'src/b.ts']
    );

    const result = computeFisherInformation(coverage);
    expect(result.diagonal).toEqual([
      { fileId: 'src/a.ts', selfInfo: 2 },
      { fileId: 'src/b.ts', selfInfo: 2 },
    ]);
  });

  it('finds fragility hotspots below the threshold and excludes stable files', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 1],
        [1, 0],
        [0, 0],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
      ['src/fragile.ts', 'src/stable.ts']
    );

    const result = computeFisherInformation(coverage, 3);
    expect(result.fragilityHotspots).toEqual([
      { fileId: 'src/fragile.ts', selfInfo: 2, crb: 0.5 },
    ]);
  });
});

describe('aggregateToPackageLevel', () => {
  it('aggregates files into package-level coverage and returns a 2x2 Gram matrix', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 0, 1, 0],
        [0, 1, 0, 1],
        [1, 1, 0, 0],
      ],
      ['src/pkg-a/a.ts', 'src/pkg-a/b.ts', 'src/pkg-b/c.ts', 'src/pkg-b/d.ts']
    );

    const pkg = aggregateToPackageLevel(coverage, coverage.fileIds, 2);

    expect(pkg.packageNames).toEqual(['src/pkg-a', 'src/pkg-b']);
    expect(pkg.matrix).toEqual([
      [3, 2],
      [2, 2],
    ]);
  });

  it('clamps package coverage before computing the diagonal', () => {
    const coverage = makeCoverageMatrix(
      [
        [1, 1, 0],
        [1, 0, 1],
      ],
      ['src/pkg-a/a.ts', 'src/pkg-a/b.ts', 'src/pkg-b/c.ts']
    );

    const pkg = aggregateToPackageLevel(coverage, coverage.fileIds, 2);

    expect(pkg.matrix[0][0]).toBe(2);
    expect(pkg.matrix[0][1]).toBe(1);
    expect(pkg.matrix[1][1]).toBe(1);
  });
});
