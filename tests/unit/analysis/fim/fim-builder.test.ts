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
  it('returns true for Go "cmd/server"', () => expect(isProductionPackage('cmd/server')).toBe(true));
  it('returns true for Go "internal/auth"', () => expect(isProductionPackage('internal/auth')).toBe(true));
  it('returns true for Go "pkg/utils"', () => expect(isProductionPackage('pkg/utils')).toBe(true));
  it('returns true for Go "api/handler"', () => expect(isProductionPackage('api/handler')).toBe(true));
  it('returns false for Go "vendor/github.com/foo"', () => expect(isProductionPackage('vendor/github.com/foo')).toBe(false));
  it('returns true for Java "app/service"', () => expect(isProductionPackage('app/service')).toBe(true));
  it('returns true for Python "mypackage/utils"', () => expect(isProductionPackage('mypackage/utils')).toBe(true));
  it('returns false for "testdata/golden"', () => expect(isProductionPackage('testdata/golden')).toBe(false));
  it('returns false for "benchmark/suite"', () => expect(isProductionPackage('benchmark/suite')).toBe(false));
  it('returns false for "mocks/generated"', () => expect(isProductionPackage('mocks/generated')).toBe(false));
  it('returns false for "docs/api"', () => expect(isProductionPackage('docs/api')).toBe(false));
});

describe('filterProductionPackages', () => {
  it('removes zero-coverage non-production packages and recomputes metrics', () => {
    const coverage = makeCoverageMatrix(
      [[1, 0, 0], [0, 1, 0]],
      ['src/a.ts', 'src/b.ts', 'examples/demo.ts']
    );
    const filtered = filterProductionPackages(coverage);
    expect(filtered.diagonal.map(d => d.fileId)).not.toContain('examples/demo.ts');
    expect(filtered.fileCount).toBe(2);
  });

  it('keeps zero-coverage src/ package (legitimate gap)', () => {
    const coverage = makeCoverageMatrix(
      [[1, 0, 0]],
      ['src/a.ts', 'src/uncovered.ts', 'examples/demo.ts']
    );
    const filtered = filterProductionPackages(coverage);
    expect(filtered.diagonal.map(d => d.fileId)).toContain('src/uncovered.ts');
    expect(filtered.diagonal.map(d => d.fileId)).not.toContain('examples/demo.ts');
  });

  it('yields finite kappa when only zero eigenvalues removed were from non-production', () => {
    // src/a.ts covered; examples/x.ts zero coverage → rank-deficient → κ=Infinity
    const coverage = makeCoverageMatrix(
      [[1, 0]],
      ['src/a.ts', 'examples/x.ts']
    );
    const fullResult = computeFisherInformation(coverage);
    expect(fullResult.conditionNumber).toBe(Infinity);
    // After filtering out zero-coverage non-production package, only src/a.ts remains → κ finite
    const filtered = filterProductionPackages(coverage);
    expect(filtered.conditionNumber).not.toBe(Infinity);
    expect(filtered.fileCount).toBe(1);
  });

  it('uses SVD eigenvalues not selfInfo diagonals after filtering', () => {
    // src/a: covered by tests 0,1,2 (selfInfo=3)
    // src/b: covered by tests 1,2   (selfInfo=2)
    // examples/x: covered by test 0 (selfInfo=1, non-production)
    // test 0: covers src/a, examples/x
    // test 1: covers src/a, src/b
    // test 2: covers src/a, src/b
    const coverage = makeCoverageMatrix(
      [
        [1, 0, 1], // test 0: src/a, examples/x
        [1, 1, 0], // test 1: src/a, src/b
        [1, 1, 0], // test 2: src/a, src/b
      ],
      ['src/a', 'src/b', 'examples/x']
    );
    const filtered = filterProductionPackages(coverage);

    // After filtering: 2 production packages remain (src/a, src/b)
    expect(filtered.diagonal.map(d => d.fileId)).toEqual(['src/a', 'src/b']);
    expect(filtered.eigenvalues).toHaveLength(2);

    // The 2x2 Gram sub-matrix for [src/a, src/b] from tests that overlap them:
    // gram[0][0] = 3 (src/a covered by tests 0,1,2)
    // gram[1][1] = 2 (src/b covered by tests 1,2)
    // gram[0][1] = gram[1][0] = 2 (tests 1,2 cover both)
    // Gram = [[3,2],[2,2]]
    // eigenvalues: λ²-5λ+2=0 → λ = (5±√17)/2 ≈ 4.561, 0.439
    // κ = λ_max / λ_min ≈ 10.39
    // selfInfo-based (buggy) κ would be selfInfo[0]/selfInfo[1] = 3/2 = 1.5
    expect(filtered.eigenvalues[0]).toBeGreaterThan(filtered.eigenvalues[1]);
    expect(filtered.conditionNumber).toBeCloseTo(10.4, 0);
  });

  it('N_eff reflects true geometric coverage after SVD, not selfInfo sum-of-squares', () => {
    // Same 3-package setup as above
    const coverage = makeCoverageMatrix(
      [
        [1, 0, 1], // test 0: src/a, examples/x
        [1, 1, 0], // test 1: src/a, src/b
        [1, 1, 0], // test 2: src/a, src/b
      ],
      ['src/a', 'src/b', 'examples/x']
    );
    const filtered = filterProductionPackages(coverage);

    // SVD eigenvalues of [[3,2],[2,2]]: λ = (5±√17)/2 ≈ 4.561, 0.439
    // sum = 5, sum of squares = trace(A²) where A=[[3,2],[2,2]]
    // A² = [[3*3+2*2, 3*2+2*2],[2*3+2*2, 2*2+2*2]] = [[13,10],[10,8]], trace=21
    // N_eff = 5² / 21 ≈ 1.190
    //
    // selfInfo-based (buggy) N_eff = (3+2)²/(3²+2²) = 25/13 ≈ 1.923
    expect(filtered.effectiveDimension).toBeCloseTo(1.19, 1);
  });
});
