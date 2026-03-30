import { describe, expect, it } from 'vitest';
import {
  mantelTest,
  normalizeMatrix,
  upperTriCorrelation,
} from '@/analysis/fim/mantel-test.js';

function symmetric(values: number[][]): number[][] {
  return values.map((row) => [...row]);
}

describe('normalizeMatrix', () => {
  it('preserves dimensions and symmetry', () => {
    const matrix = symmetric([
      [1, 4, 2],
      [4, 1, 3],
      [2, 3, 1],
    ]);

    const normalized = normalizeMatrix(matrix);
    expect(normalized).toHaveLength(3);
    expect(normalized[0][1]).toBe(normalized[1][0]);
  });
});

describe('upperTriCorrelation', () => {
  it('returns 1.0 for identical upper triangles', () => {
    const matrix = symmetric([
      [1, 3, 2],
      [3, 1, 4],
      [2, 4, 1],
    ]);

    expect(upperTriCorrelation(matrix, matrix)).toBeCloseTo(1, 8);
  });
});

describe('mantelTest', () => {
  it('returns r=1 and p<0.05 for identical matrices', () => {
    const matrix = symmetric([
      [1, 10, 3, 8, 4],
      [10, 1, 7, 2, 6],
      [3, 7, 1, 9, 5],
      [8, 2, 9, 1, 11],
      [4, 6, 5, 11, 1],
    ]);

    const result = mantelTest(matrix, matrix, { permutations: 999, seed: 42 });

    expect(result.observedCorrelation).toBeCloseTo(1, 8);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it('does not validate a random proxy matrix', () => {
    const fim = symmetric([
      [1, 5, 4, 1, 2],
      [5, 1, 3, 2, 0],
      [4, 3, 1, 6, 1],
      [1, 2, 6, 1, 7],
      [2, 0, 1, 7, 1],
    ]);
    const randomProxy = symmetric([
      [1, 0.2, 0.8, 0.1, 0.9],
      [0.2, 1, 0.4, 0.7, 0.3],
      [0.8, 0.4, 1, 0.5, 0.6],
      [0.1, 0.7, 0.5, 1, 0.2],
      [0.9, 0.3, 0.6, 0.2, 1],
    ]);

    const result = mantelTest(fim, randomProxy, { permutations: 499, seed: 7 });

    expect(result.pValue).toBeGreaterThan(0.05);
    expect(result.isValidProxy).toBe(false);
  });

  it('is deterministic when a seed is provided', () => {
    const a = symmetric([
      [1, 2, 8, 4],
      [2, 1, 5, 7],
      [8, 5, 1, 3],
      [4, 7, 3, 1],
    ]);
    const b = symmetric([
      [1, 0.1, 0.9, 0.4],
      [0.1, 1, 0.6, 0.7],
      [0.9, 0.6, 1, 0.2],
      [0.4, 0.7, 0.2, 1],
    ]);

    const first = mantelTest(a, b, { permutations: 199, seed: 123 });
    const second = mantelTest(a, b, { permutations: 199, seed: 123 });

    expect(first).toEqual(second);
  });

  it('handles empty matrices gracefully', () => {
    const result = mantelTest([], [], { permutations: 99, seed: 1 });
    expect(result).toEqual({
      observedCorrelation: 0,
      permutations: 99,
      pValue: 1,
      isValidProxy: false,
    });
  });

  it('rejects asymmetric matrices', () => {
    expect(() =>
      mantelTest(
        [
          [1, 2],
          [0, 1],
        ],
        [
          [1, 2],
          [2, 1],
        ]
      )
    ).toThrow(/symmetric/i);
  });

  it('rejects mismatched dimensions', () => {
    expect(() =>
      mantelTest(
        [
          [1, 2],
          [2, 1],
        ],
        [[1]]
      )
    ).toThrow(/same dimensions/i);
  });
});

import { generateRandomPositiveDefiniteMatrix, mantelTestWithNullModel } from '@/analysis/fim/mantel-test.js';

describe('generateRandomPositiveDefiniteMatrix', () => {
  it('returns a square matrix of the requested size', () => {
    const m = generateRandomPositiveDefiniteMatrix(4);
    expect(m.length).toBe(4);
    m.forEach(row => expect(row.length).toBe(4));
  });

  it('is symmetric', () => {
    const m = generateRandomPositiveDefiniteMatrix(3, 42);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      expect(m[i][j]).toBeCloseTo(m[j][i], 10);
  });

  it('is deterministic with a seed', () => {
    const m1 = generateRandomPositiveDefiniteMatrix(3, 99);
    const m2 = generateRandomPositiveDefiniteMatrix(3, 99);
    expect(m1).toEqual(m2);
  });

  it('produces different matrices for different seeds', () => {
    const m1 = generateRandomPositiveDefiniteMatrix(3, 1);
    const m2 = generateRandomPositiveDefiniteMatrix(3, 2);
    expect(m1).not.toEqual(m2);
  });
});

describe('mantelTestWithNullModel', () => {
  const identity = (n: number) => Array.from({length: n}, (_, i) =>
    Array.from({length: n}, (_, j) => i === j ? 1 : 0));

  it('returns all MantelTestWithNullModelResult fields', () => {
    const m = identity(3);
    const result = mantelTestWithNullModel(m, m, { seed: 1, permutations: 9, nullModelIterations: 3 });
    expect(result).toHaveProperty('observedCorrelation');
    expect(result).toHaveProperty('nullModelMeanR');
    expect(result).toHaveProperty('nullModelMaxR');
    expect(result).toHaveProperty('nullModelStdR');
    expect(result).toHaveProperty('separationScore');
    expect(result).toHaveProperty('isSignificantOverNull');
  });

  it('nullModelMaxR >= nullModelMeanR', () => {
    const m = identity(4);
    const result = mantelTestWithNullModel(m, m, { seed: 7, permutations: 9, nullModelIterations: 5 });
    expect(result.nullModelMaxR).toBeGreaterThanOrEqual(result.nullModelMeanR);
  });

  it('is deterministic with a seed', () => {
    const m = identity(4);
    const r1 = mantelTestWithNullModel(m, m, { seed: 1, permutations: 9, nullModelIterations: 3 });
    const r2 = mantelTestWithNullModel(m, m, { seed: 1, permutations: 9, nullModelIterations: 3 });
    expect(r1.nullModelMeanR).toBeCloseTo(r2.nullModelMeanR, 10);
  });
});
