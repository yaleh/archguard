/**
 * Unit tests for KMeansClusterer (TASK-66 Phase A).
 *
 * Determinism contract: same input + same seed ⇒ bit-identical assignments.
 */

import { describe, it, expect } from 'vitest';
import { KMeansClusterer, detectOrphans } from '@/analysis/jl/kmeans.js';
import { mulberry32 } from '@/analysis/jl/jl-projector.js';

const A_OFFSETS: Array<[number, number]> = [
  [-0.5, -0.3], [0.2, -0.4], [-0.1, 0.5], [0.4, 0.1], [-0.3, 0.2],
  [0.5, -0.2], [-0.4, -0.1], [0.1, 0.4], [-0.2, 0.3], [0.3, -0.5],
];

function clusterAround(center: [number, number], offsets: Array<[number, number]>): number[][] {
  return offsets.map(([dx, dy]) => [center[0] + dx, center[1] + dy]);
}

/** 10 points near (0,0) and 10 near (10,10) — two well-separated 2D clusters. */
function twoSeparatedClusters(): number[][] {
  return [
    ...clusterAround([0, 0], A_OFFSETS),
    ...clusterAround([10, 10], A_OFFSETS),
  ];
}

/**
 * n uniform pseudo-random points in [0,1]^d (deterministic rng). Adjacency
 * rows live in a high-dimensional space, so "no structure" is asserted in 10D
 * where uniform points genuinely carry no cluster structure (silhouette < 0.2).
 */
function uniformPoints(n: number, d: number, seed: number): number[][] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => Array.from({ length: d }, () => rng()));
}

describe('KMeansClusterer', () => {
  it('two separated 2D clusters → Silhouette > 0.8 and correct partition', () => {
    const matrix = twoSeparatedClusters();
    const result = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 42 });
    expect(result.silhouetteScore).toBeGreaterThan(0.8);
    expect(result.k).toBe(2);

    // First 10 points (group A) share one cluster; last 10 (group B) share the other.
    const a = result.assignments[0];
    const b = result.assignments[10];
    expect(a).not.toBe(b);
    for (let i = 0; i < 10; i++) expect(result.assignments[i]).toBe(a);
    for (let i = 10; i < 20; i++) expect(result.assignments[i]).toBe(b);
  });

  it('uniform random points → Silhouette < 0.2 + "no clear cluster structure" warning', () => {
    const matrix = uniformPoints(60, 10, 12345);
    const result = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 7 });
    expect(result.silhouetteScore).toBeLessThan(0.2);
    expect(result.warning).toBe('no clear cluster structure detected');
  });

  it('determinism: bit-identical assignments for the same input and seed', () => {
    const matrix = twoSeparatedClusters();
    const r1 = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 42 });
    const r2 = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 42 });
    expect(r2.assignments).toEqual(r1.assignments);
    expect(r2.centroids).toEqual(r1.centroids);
    expect(r2.silhouetteScore).toBe(r1.silhouetteScore);
    expect(r2.k).toBe(r1.k);
  });

  it('zero-rows → orphanIndices and excluded from assignments', () => {
    const matrix = [...twoSeparatedClusters(), [0, 0], [0, 0]];
    const result = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 42 });
    expect(result.orphanIndices).toEqual([20, 21]);
    expect(result.assignments).toHaveLength(20);
    expect(result.entityIndices).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('detectOrphans returns zero-row indices (fan-in + fan-out zero)', () => {
    const matrix = [
      [1, 0],
      [0, 0],
      [0, 2],
    ];
    expect(detectOrphans(matrix)).toEqual([1]);
  });

  it('K-selection picks the argmax-Silhouette K (3 well-separated clusters → k=3)', () => {
    const matrix = [
      ...clusterAround([0, 0], A_OFFSETS),
      ...clusterAround([10, 0], A_OFFSETS),
      ...clusterAround([0, 10], A_OFFSETS),
    ];
    const result = KMeansClusterer.cluster(matrix, { kInit: 3, seed: 42 });
    expect(result.k).toBe(3);
    // Each cluster holds exactly one group of 10.
    const counts = new Map<number, number>();
    for (const a of result.assignments) counts.set(a, (counts.get(a) ?? 0) + 1);
    expect(counts.size).toBe(3);
    for (const c of counts.values()) expect(c).toBe(10);
  });

  it('maxIterations guard → converged: false with a 1-iteration cap, true by default', () => {
    const matrix = twoSeparatedClusters();
    const capped = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 42, maxIterations: 1 });
    expect(capped.converged).toBe(false);
    expect(capped.iterations).toBe(1);

    const full = KMeansClusterer.cluster(matrix, { kInit: 2, seed: 42 });
    expect(full.converged).toBe(true);
  });

  it('huge kInit relative to n does not crash (K window clamped)', () => {
    // NB: [0,0] would be an orphan (zero row) — use a small non-zero first point.
    const matrix = [
      [0.1, 0],
      [10, 0],
      [0, 10],
    ];
    const result = KMeansClusterer.cluster(matrix, { kInit: 100, seed: 42 });
    expect(result.k).toBe(3);
    expect(result.assignments).toHaveLength(3);
    expect(new Set(result.assignments).size).toBe(3);
  });

  it('large-n (2500) sampled Silhouette is deterministic across two runs', () => {
    const centers: Array<[number, number]> = [
      [0, 0], [20, 0], [0, 20], [20, 20], [10, -15],
    ];
    const matrix: number[][] = [];
    for (const center of centers) {
      for (let i = 0; i < 500; i++) {
        matrix.push([center[0] + (i % 5) * 0.1, center[1] + (i % 7) * 0.1]);
      }
    }
    const r1 = KMeansClusterer.cluster(matrix, { kInit: 5, seed: 42 });
    const r2 = KMeansClusterer.cluster(matrix, { kInit: 5, seed: 42 });
    expect(r1.k).toBe(r2.k);
    expect(r1.silhouetteScore).toBe(r2.silhouetteScore);
    expect(r2.assignments).toEqual(r1.assignments);
    expect(r1.k).toBe(5);
  });
});
