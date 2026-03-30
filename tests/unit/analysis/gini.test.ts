import { describe, it, expect } from 'vitest';
import { giniCoefficient } from '@/analysis/gini.js';

describe('giniCoefficient', () => {
  it('returns 0 for all-equal values [3,3,3]', () => {
    expect(giniCoefficient([3, 3, 3])).toBe(0);
  });

  it('returns 0 for single value [5]', () => {
    expect(giniCoefficient([5])).toBe(0);
  });

  it('returns 0 for empty array []', () => {
    expect(giniCoefficient([])).toBe(0);
  });

  it('returns close to 0.75 for maximum inequality [0,0,0,100]', () => {
    expect(giniCoefficient([0, 0, 0, 100])).toBeCloseTo(0.75, 5);
  });

  it('returns approximately 0.2667 for known distribution [1,2,3,4,5]', () => {
    expect(giniCoefficient([1, 2, 3, 4, 5])).toBeCloseTo(0.2667, 4);
  });

  it('returns 0 for all zeros [0,0,0]', () => {
    expect(giniCoefficient([0, 0, 0])).toBe(0);
  });
});
