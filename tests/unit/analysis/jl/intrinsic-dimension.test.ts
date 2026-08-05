/**
 * Unit tests for intrinsic-dimension.ts (TASK-64 Phase C).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeIntrinsicDimension } from '@/analysis/jl/intrinsic-dimension.js';
import type { ComputeIntrinsicDimensionInput } from '@/analysis/jl/intrinsic-dimension.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeInput(
  overrides: Partial<ComputeIntrinsicDimensionInput> = {}
): ComputeIntrinsicDimensionInput {
  return {
    matrix: [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 0],
    ],
    entityCount: 3,
    mode: 'direct',
    k: null,
    epsilon: null,
    ...overrides,
  };
}

describe('computeIntrinsicDimension', () => {
  it('hub graph → d_int = 1', () => {
    // A and B both depend on the hub (entity index 2). Rank 1 after centering.
    const result = computeIntrinsicDimension(makeInput());
    expect(result.dInt).toBe(1);
  });

  it('zero matrix → d_int = 0, varianceExplained = [], noDependenciesWarning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = computeIntrinsicDimension(
      makeInput({
        matrix: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      })
    );
    expect(result.dInt).toBe(0);
    expect(result.varianceExplained).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no dependencies'));
  });

  it('varianceExplained is monotonic non-decreasing and terminates at 1.0', () => {
    const matrix = [
      [1, 2, 3, 4],
      [2, 3, 4, 5],
      [3, 4, 5, 6],
      [4, 5, 6, 7],
      [5, 6, 7, 8],
    ];
    const result = computeIntrinsicDimension(makeInput({ matrix, entityCount: 5 }));

    expect(result.varianceExplained.length).toBeGreaterThan(0);
    for (let i = 1; i < result.varianceExplained.length; i++) {
      expect(result.varianceExplained[i]).toBeGreaterThanOrEqual(
        result.varianceExplained[i - 1] - 1e-9
      );
    }
    expect(
      Math.abs(result.varianceExplained[result.varianceExplained.length - 1] - 1.0)
    ).toBeLessThan(1e-10);
    expect(result.dInt).toBeGreaterThanOrEqual(1);
  });

  it('dIntNormalized = round4(dInt / entityCount)', () => {
    const result = computeIntrinsicDimension(makeInput({ entityCount: 10 }));
    const expected = Math.round((result.dInt / 10) * 10000) / 10000;
    expect(result.dIntNormalized).toBe(expected);
  });

  it('populates DIRECT-mode fields', () => {
    const result = computeIntrinsicDimension(makeInput({ mode: 'direct', k: null, epsilon: null }));
    expect(result.mode).toBe('direct');
    expect(result.k).toBeNull();
    expect(result.epsilon).toBeNull();
  });

  it('populates JL-mode fields', () => {
    const result = computeIntrinsicDimension(makeInput({ mode: 'jl', k: 307, epsilon: 0.3 }));
    expect(result.mode).toBe('jl');
    expect(result.k).toBe(307);
    expect(result.epsilon).toBe(0.3);
  });

  it('carries featureVersion and entityCount', () => {
    const result = computeIntrinsicDimension(makeInput({ featureVersion: '1.0' }));
    expect(result.featureVersion).toBe('1.0');
    expect(result.entityCount).toBe(3);
  });

  it('warns on low entity count (< 3) but still computes d_int', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = computeIntrinsicDimension(makeInput({ entityCount: 2 }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('low entity count'));
    expect(typeof result.dInt).toBe('number');
  });

  it('uses provided timestamp/commitSha', () => {
    const result = computeIntrinsicDimension(
      makeInput({ timestamp: '2026-01-01T00:00:00Z', commitSha: 'abc123' })
    );
    expect(result.timestamp).toBe('2026-01-01T00:00:00Z');
    expect(result.commitSha).toBe('abc123');
  });
});
