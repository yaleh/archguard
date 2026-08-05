/**
 * Unit tests for jl-projector.ts (TASK-64 Phase C).
 */

import { describe, it, expect } from 'vitest';
import {
  computeMode,
  computeK,
  buildAchlioptas,
  project,
  mulberry32,
} from '@/analysis/jl/jl-projector.js';
import { DEFAULT_JL_CONFIG } from '@/analysis/jl/types.js';

describe('computeMode', () => {
  it('uses DIRECT for n < threshold', () => {
    expect(computeMode(100, DEFAULT_JL_CONFIG)).toBe('direct');
    expect(computeMode(999, DEFAULT_JL_CONFIG)).toBe('direct');
  });

  it('uses JL for n ≥ threshold', () => {
    expect(computeMode(1000, DEFAULT_JL_CONFIG)).toBe('jl');
    expect(computeMode(5000, DEFAULT_JL_CONFIG)).toBe('jl');
  });

  it('honours a custom directModeThreshold', () => {
    const config = { ...DEFAULT_JL_CONFIG, directModeThreshold: 500 };
    expect(computeMode(100, config)).toBe('direct');
    expect(computeMode(500, config)).toBe('jl');
    expect(computeMode(501, config)).toBe('jl');
  });
});

describe('computeK', () => {
  it('computes k = ceil(4·ln(n)/ε²)', () => {
    // ceil(4·ln(1000)/0.09) = ceil(307.011) = 308
    // ceil(4·ln(5000)/0.09) = ceil(378.542) = 379
    // (proposal examples 307/378 were off-by-one — they rounded, not ceiled)
    expect(computeK(1000, 0.3)).toBe(308);
    expect(computeK(5000, 0.3)).toBe(379);
  });

  it('grows with n and shrinks with larger ε', () => {
    const k1000 = computeK(1000, 0.3);
    const k5000 = computeK(5000, 0.3);
    expect(k5000).toBeGreaterThan(k1000);
    expect(computeK(1000, 0.5)).toBeLessThan(k1000);
  });
});

describe('buildAchlioptas', () => {
  it('produces a k×n matrix', () => {
    const matrix = buildAchlioptas(7, 100, 42);
    expect(matrix).toHaveLength(7);
    for (const row of matrix) {
      expect(row).toHaveLength(100);
    }
  });

  it('entries are ∈ {+1, 0, −1}', () => {
    const matrix = buildAchlioptas(20, 500, 7);
    for (const row of matrix) {
      for (const value of row) {
        expect([1, 0, -1]).toContain(value);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = buildAchlioptas(8, 200, 123);
    const b = buildAchlioptas(8, 200, 123);
    expect(a).toEqual(b);
  });

  it('differs for different seeds', () => {
    const a = buildAchlioptas(8, 200, 1);
    const b = buildAchlioptas(8, 200, 2);
    expect(a).not.toEqual(b);
  });

  it('approximately matches the Achlioptas sparsity (2/3 zeros)', () => {
    const matrix = buildAchlioptas(10, 3000, 99);
    let zeros = 0;
    let total = 0;
    for (const row of matrix) {
      for (const v of row) {
        if (v === 0) zeros++;
        total++;
      }
    }
    // P(0) = 4/6 ≈ 0.667; allow generous bounds for a fixed seed.
    const ratio = zeros / total;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.85);
  });
});

describe('project', () => {
  it('projects an n×d matrix to n×k', () => {
    const matrix = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    const achlioptas = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    const result = project(matrix, achlioptas, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(2);
    expect(result[1]).toHaveLength(2);
    // P = (1/√k)·A·Rᵀ: first row → [1/√2, 0], second row → [0, 1/√2]
    expect(result[0][0]).toBeCloseTo(1 / Math.sqrt(2), 10);
    expect(result[1][1]).toBeCloseTo(1 / Math.sqrt(2), 10);
  });

  it('returns plain number[][]', () => {
    const result = project(
      [[1, 2]],
      [
        [1, 0],
        [0, 1],
      ],
      2
    );
    expect(Array.isArray(result)).toBe(true);
    expect(Array.isArray(result[0])).toBe(true);
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const next = mulberry32(42);
    const first = next();
    const again = mulberry32(42)();
    expect(first).toBe(again);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });
});
