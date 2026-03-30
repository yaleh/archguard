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

import { isProductionPackage, filterProductionPackages } from '@/analysis/fim/fim-builder.js';

describe('isProductionPackage', () => {
  it('returns false for "."', () => expect(isProductionPackage('.')).toBe(false));
  it('returns false for "examples"', () => expect(isProductionPackage('examples')).toBe(false));
  it('returns false for "templates/plugin-template"', () => expect(isProductionPackage('templates/plugin-template')).toBe(false));
  it('returns false for "scripts"', () => expect(isProductionPackage('scripts')).toBe(false));
  it('returns true for "src/cli"', () => expect(isProductionPackage('src/cli')).toBe(true));
  it('returns true for "src/analysis/fim"', () => expect(isProductionPackage('src/analysis/fim')).toBe(true));
  it('returns true for "lib/utils"', () => expect(isProductionPackage('lib/utils')).toBe(true));
  it('returns false for "tests/unit" (not src/lib/core)', () => expect(isProductionPackage('tests/unit')).toBe(false));
});

describe('filterProductionPackages', () => {
  it('removes zero-coverage non-production packages and recomputes metrics', () => {
    const result = computeFisherInformation(makeCoverageMatrix(
      [[1, 0, 0], [0, 1, 0]],
      ['src/a.ts', 'src/b.ts', 'examples/demo.ts']
    ));
    const filtered = filterProductionPackages(result);
    expect(filtered.diagonal.map(d => d.fileId)).not.toContain('examples/demo.ts');
    expect(filtered.fileCount).toBe(2);
  });

  it('keeps zero-coverage src/ package (legitimate gap)', () => {
    const result = computeFisherInformation(makeCoverageMatrix(
      [[1, 0, 0]],
      ['src/a.ts', 'src/uncovered.ts', 'examples/demo.ts']
    ));
    const filtered = filterProductionPackages(result);
    expect(filtered.diagonal.map(d => d.fileId)).toContain('src/uncovered.ts');
    expect(filtered.diagonal.map(d => d.fileId)).not.toContain('examples/demo.ts');
  });

  it('yields finite kappa when only zero eigenvalues removed were from non-production', () => {
    // src/a.ts covered; examples/x.ts zero coverage → rank-deficient → κ=Infinity
    const result = computeFisherInformation(makeCoverageMatrix(
      [[1, 0]],
      ['src/a.ts', 'examples/x.ts']
    ));
    expect(result.conditionNumber).toBe(Infinity);
    // After filtering out zero-coverage non-production package, only src/a.ts remains → κ finite
    const filtered = filterProductionPackages(result);
    expect(filtered.conditionNumber).not.toBe(Infinity);
    expect(filtered.fileCount).toBe(1);
  });
});
