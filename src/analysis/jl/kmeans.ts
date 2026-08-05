/**
 * Deterministic K-Means clustering (TASK-66 Phase A).
 *
 * Hand-written Lloyd's Algorithm with K-Means++ initialisation and a fixed
 * seed — no external clustering dependency. K is selected by Silhouette Score
 * over the window `[max(2, kInit−2), kInit+3]`; zero rows (orphans) are
 * detected and excluded before clustering. Silhouette is computed exactly for
 * n ≤ 2000 and estimated on a fixed-seed sample of 500 rows above that.
 *
 * Determinism contract: identical input + same seed ⇒ bit-identical
 * `assignments` (the same seed drives K-Means++ and the silhouette sample for
 * every K in the window).
 *
 * @module analysis/jl/kmeans
 */

import { mulberry32 } from './jl-projector.js';
import type { KMeansOptions, KMeansResult } from './types.js';

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_CONVERGENCE_THRESHOLD = 0.001;
const DEFAULT_SEED = 42;
const DEFAULT_SAMPLE_SIZE = 500;
const DEFAULT_SAMPLE_THRESHOLD = 2000;

/**
 * All-zero rows — an entity with fan-in AND fan-out both zero (no structural
 * connections). These are excluded from clustering and reported as orphans.
 *
 * @param matrix - Row-major feature matrix.
 * @returns Original row indices that are all-zero, ascending.
 */
export function detectOrphans(matrix: number[][]): number[] {
  const orphans: number[] = [];
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    let zero = true;
    for (let j = 0; j < row.length; j++) {
      if (row[j] !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) orphans.push(i);
  }
  return orphans;
}

function euclidean(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function nearestCentroid(point: number[], centroids: number[][]): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = euclidean(point, centroids[c]);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = c;
    }
  }
  return bestIndex;
}

export class KMeansClusterer {
  /**
   * Cluster an n×d feature matrix, selecting K by Silhouette over the window
   * `[max(2, kInit−2), kInit+3]`.
   *
   * @param matrix - Row-major feature matrix (may contain all-zero orphan rows).
   * @param options - KMeansOptions.
   * @returns Deterministic KMeansResult.
   */
  static cluster(matrix: number[][], options: KMeansOptions = {}): KMeansResult {
    const seed = options.seed ?? DEFAULT_SEED;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const convergenceThreshold = options.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
    const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
    const sampleThreshold = options.sampleThreshold ?? DEFAULT_SAMPLE_THRESHOLD;

    const orphanSet = new Set(detectOrphans(matrix));
    const entityIndices: number[] = [];
    const clean: number[][] = [];
    for (let i = 0; i < matrix.length; i++) {
      if (!orphanSet.has(i)) {
        entityIndices.push(i);
        clean.push(matrix[i]);
      }
    }
    const orphanIndices = Array.from(orphanSet).sort((a, b) => a - b);

    const n = clean.length;
    if (n === 0) {
      return {
        k: 0,
        assignments: [],
        centroids: [],
        silhouetteScore: 0,
        converged: true,
        iterations: 0,
        orphanIndices,
        entityIndices,
      };
    }
    if (n === 1) {
      return {
        k: 1,
        assignments: [0],
        centroids: [clean[0]],
        silhouetteScore: 0,
        converged: true,
        iterations: 1,
        orphanIndices,
        entityIndices,
      };
    }

    const kInit = Math.max(2, options.kInit ?? 2);
    // Clamp so the window is never empty (defensive against a huge kInit on a
    // tiny matrix — e.g. direct callers passing kInit ≫ n).
    const minK = Math.min(Math.max(2, kInit - 2), n);
    const maxK = Math.min(kInit + 3, n);
    const kRange: number[] = [];
    for (let k = minK; k <= maxK; k++) kRange.push(k);

    const selected = this.selectK(clean, kRange, {
      maxIterations,
      convergenceThreshold,
      seed,
      sampleSize,
      sampleThreshold,
    });

    const base = {
      k: selected.k,
      assignments: selected.assignments,
      centroids: selected.centroids,
      silhouetteScore: selected.silhouetteScore,
      converged: selected.converged,
      iterations: selected.iterations,
      orphanIndices,
      entityIndices,
    };
    if (selected.silhouetteScore < 0.2) {
      return { ...base, warning: 'no clear cluster structure detected' };
    }
    return base;
  }

  /**
   * Run Lloyd's Algorithm once for each K in the window and return the K with
   * the highest Silhouette score. Ties resolve to the smaller K (first seen).
   */
  private static selectK(
    matrix: number[][],
    kRange: number[],
    options: {
      maxIterations: number;
      convergenceThreshold: number;
      seed: number;
      sampleSize: number;
      sampleThreshold: number;
    }
  ): {
    k: number;
    assignments: number[];
    centroids: number[][];
    silhouetteScore: number;
    converged: boolean;
    iterations: number;
  } {
    let best: {
      k: number;
      assignments: number[];
      centroids: number[][];
      silhouetteScore: number;
      converged: boolean;
      iterations: number;
    } | null = null;

    for (const k of kRange) {
      const run = this.runKMeans(matrix, k, options);
      const sil = this.silhouette(matrix, run.assignments, options);
      if (best === null || sil > best.silhouetteScore) {
        best = {
          k,
          assignments: run.assignments,
          centroids: run.centroids,
          silhouetteScore: sil,
          converged: run.converged,
          iterations: run.iterations,
        };
      }
    }
    // kRange is never empty here (n ≥ 2).
    return best as {
      k: number;
      assignments: number[];
      centroids: number[][];
      silhouetteScore: number;
      converged: boolean;
      iterations: number;
    };
  }

  private static runKMeans(
    matrix: number[][],
    k: number,
    options: { maxIterations: number; convergenceThreshold: number; seed: number }
  ): { assignments: number[]; centroids: number[][]; converged: boolean; iterations: number } {
    const rng = mulberry32(options.seed);
    const initial = this.kmeanspp(matrix, k, rng);
    return this.lloydIterate(matrix, initial, options.maxIterations, options.convergenceThreshold);
  }

  /** K-Means++ initialisation (deterministic for a given rng stream). */
  private static kmeanspp(matrix: number[][], k: number, rng: () => number): number[][] {
    const n = matrix.length;
    const centroids: number[][] = [];
    const first = Math.floor(rng() * n);
    centroids.push([...matrix[first]]);

    const d2 = new Array<number>(n).fill(0);
    for (let c = 1; c < k; c++) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const nearest = nearestCentroid(matrix[i], centroids);
        d2[i] = euclidean(matrix[i], centroids[nearest]) ** 2;
        total += d2[i];
      }
      if (total === 0) {
        // Every point coincides with a centroid — pick uniformly.
        centroids.push([...matrix[Math.floor(rng() * n)]]);
      } else {
        let r = rng() * total;
        let idx = n - 1;
        for (let i = 0; i < n; i++) {
          r -= d2[i];
          if (r <= 0) {
            idx = i;
            break;
          }
        }
        centroids.push([...matrix[idx]]);
      }
    }
    return centroids;
  }

  /** Lloyd's iteration loop. Empty clusters are re-seeded to the point farthest
   *  from its current centroid (deterministic — no extra randomness). */
  private static lloydIterate(
    matrix: number[][],
    initialCentroids: number[][],
    maxIterations: number,
    convergenceThreshold: number
  ): { assignments: number[]; centroids: number[][]; converged: boolean; iterations: number } {
    const n = matrix.length;
    const k = initialCentroids.length;
    const dim = matrix[0].length;
    let centroids = initialCentroids.map((c) => [...c]);
    const assignments = new Array<number>(n).fill(0);
    let converged = false;
    let iterations = 0;

    for (let iter = 1; iter <= maxIterations; iter++) {
      iterations = iter;
      for (let i = 0; i < n; i++) assignments[i] = nearestCentroid(matrix[i], centroids);

      const counts = new Array<number>(k).fill(0);
      const sums: number[][] = Array.from({ length: k }, (): number[] =>
        new Array<number>(dim).fill(0)
      );
      for (let i = 0; i < n; i++) {
        const c = assignments[i];
        counts[c]++;
        const row = matrix[i];
        for (let d = 0; d < dim; d++) sums[c][d] += row[d];
      }

      const newCentroids: number[][] = new Array<number[]>(k);
      for (let c = 0; c < k; c++) {
        if (counts[c] === 0) {
          let farIndex = 0;
          let farDist = -1;
          for (let i = 0; i < n; i++) {
            const d = euclidean(matrix[i], centroids[assignments[i]]);
            if (d > farDist) {
              farDist = d;
              farIndex = i;
            }
          }
          newCentroids[c] = [...matrix[farIndex]];
        } else {
          newCentroids[c] = sums[c].map((s) => s / counts[c]);
        }
      }

      let maxShift = 0;
      for (let c = 0; c < k; c++) {
        const shift = euclidean(centroids[c], newCentroids[c]);
        if (shift > maxShift) maxShift = shift;
      }
      centroids = newCentroids;
      if (maxShift < convergenceThreshold) {
        converged = true;
        break;
      }
    }
    return { assignments, centroids, converged, iterations };
  }

  /**
   * Mean Silhouette coefficient. Exact over all n points when n ≤
   * `sampleThreshold`; otherwise estimated on a fixed-seed sample of
   * `sampleSize` points (n > 2000 default). Singleton clusters contribute 0.
   */
  private static silhouette(
    matrix: number[][],
    assignments: number[],
    options: { sampleSize: number; sampleThreshold: number; seed: number }
  ): number {
    const n = matrix.length;
    const k = assignments.length > 0 ? Math.max(...assignments) + 1 : 0;
    const members: number[][] = Array.from({ length: k }, (): number[] => []);
    for (let i = 0; i < n; i++) members[assignments[i]].push(i);

    let sample: number[];
    if (n > options.sampleThreshold) {
      const rng = mulberry32(options.seed);
      const size = Math.min(options.sampleSize, n);
      sample = new Array<number>(size);
      for (let s = 0; s < size; s++) sample[s] = Math.floor(rng() * n);
    } else {
      sample = Array.from({ length: n }, (_, i) => i);
    }

    let sum = 0;
    let count = 0;
    for (const i of sample) {
      const ci = assignments[i];
      const same = members[ci];
      let aSum = 0;
      let aCount = 0;
      for (const j of same) {
        if (j === i) continue;
        aSum += euclidean(matrix[i], matrix[j]);
        aCount++;
      }
      const a = aCount > 0 ? aSum / aCount : 0;

      let b = Infinity;
      for (let c = 0; c < k; c++) {
        if (c === ci) continue;
        const other = members[c];
        if (other.length === 0) continue;
        let bSum = 0;
        for (const j of other) bSum += euclidean(matrix[i], matrix[j]);
        const bMean = bSum / other.length;
        if (bMean < b) b = bMean;
      }

      const s = aCount === 0 || b === Infinity ? 0 : (b - a) / Math.max(a, b);
      sum += s;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }
}
