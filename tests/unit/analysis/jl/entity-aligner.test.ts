/**
 * Unit tests for entity-aligner.ts (TASK-65 Phase A).
 */

import { describe, it, expect } from 'vitest';
import { EntityAligner } from '@/analysis/jl/entity-aligner.js';

describe('EntityAligner.align', () => {
  it('identical entity sets → E_shared is both, added/removed empty', () => {
    const result = EntityAligner.align(['A', 'B', 'C'], ['A', 'B', 'C']);
    expect(result.entityIndex).toEqual(['A', 'B', 'C']);
    expect(result.shared).toEqual(['A', 'B', 'C']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('t2 adds 5 entities → addedEntities has 5, E_union 5 larger', () => {
    const e1 = ['A', 'B', 'C'];
    const e2 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const result = EntityAligner.align(e1, e2);
    expect(result.added).toHaveLength(5);
    expect(result.added).toEqual(['D', 'E', 'F', 'G', 'H']);
    expect(result.entityIndex).toHaveLength(e1.length + 5);
    expect(result.shared).toEqual(['A', 'B', 'C']);
    expect(result.removed).toEqual([]);
  });

  it('t1 extras → removedEntities', () => {
    const result = EntityAligner.align(['A', 'B', 'C', 'X', 'Y'], ['A', 'B', 'C']);
    expect(result.removed).toEqual(['X', 'Y']);
    expect(result.added).toEqual([]);
    expect(result.shared).toEqual(['A', 'B', 'C']);
  });

  it('deduplicates the union and preserves first-seen order', () => {
    const result = EntityAligner.align(['A', 'B'], ['B', 'C']);
    expect(result.entityIndex).toEqual(['A', 'B', 'C']);
    expect(result.shared).toEqual(['B']);
    expect(result.added).toEqual(['C']);
  });
});

describe('EntityAligner.buildAlignedRow', () => {
  it('aligned row length equals |E_union|', () => {
    const aligned = EntityAligner.buildAlignedRow([1, 2], ['A', 'B'], ['A', 'B', 'C']);
    expect(aligned).toHaveLength(3);
  });

  it('zero-pads columns the source snapshot does not contain', () => {
    const aligned = EntityAligner.buildAlignedRow([1, 2], ['A', 'B'], ['A', 'B', 'C']);
    expect(aligned).toEqual([1, 2, 0]);
  });

  it('absent-in-one-snapshot column maps to 0.0', () => {
    const aligned = EntityAligner.buildAlignedRow([3], ['C'], ['A', 'B', 'C']);
    expect(aligned).toEqual([0, 0, 3]);
  });

  it('reorders columns into the union coordinate system', () => {
    const aligned = EntityAligner.buildAlignedRow([1, 2], ['B', 'A'], ['A', 'B']);
    expect(aligned).toEqual([2, 1]);
  });
});
