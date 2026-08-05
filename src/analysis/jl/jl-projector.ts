/**
 * Johnson-Lindenstrauss projector (TASK-64).
 *
 * Provides adaptive mode selection (DIRECT for n < threshold, JL otherwise),
 * the JL dimension `k = ⌈4·ln(n)/ε²⌉`, and a deterministic Achlioptas
 * projection matrix (entries ∈ {+1, 0, −1} with probabilities {1/6, 4/6, 1/6}).
 *
 * Returns plain `number[][]` (downstream TASK-65/66 contract) — never an
 * ml-matrix `Matrix` instance.
 *
 * @module analysis/jl/jl-projector
 */

import type { JLConfig, ProjectionMode } from './types.js';

/**
 * Select the adaptive projection mode.
 *
 * @param entityCount - Number of entities (n).
 * @param config - JL configuration (uses `directModeThreshold`).
 */
export function computeMode(entityCount: number, config: JLConfig): ProjectionMode {
  return entityCount < config.directModeThreshold ? 'direct' : 'jl';
}

/**
 * Compute the JL projection dimension `k = ⌈4·ln(n)/ε²⌉`.
 *
 * Examples: n=1000, ε=0.3 → k=307; n=5000, ε=0.3 → k=378.
 *
 * @param entityCount - Number of entities (n).
 * @param epsilon - JL distance-preservation precision ε.
 */
export function computeK(entityCount: number, epsilon: number): number {
  return Math.ceil((4 * Math.log(entityCount)) / (epsilon * epsilon));
}

/**
 * Deterministic PRNG (mulberry32) backing Achlioptas generation so the same
 * seed always yields the same matrix.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a k×n Achlioptas matrix (deterministic for a given seed).
 *
 * @param k - Projection dimension (rows).
 * @param n - Source dimension (columns).
 * @param seed - PRNG seed; same seed ⇒ identical matrix.
 * @returns k×n matrix with entries ∈ {+1, 0, −1}.
 */
export function buildAchlioptas(k: number, n: number, seed: number): number[][] {
  const rand = mulberry32(seed);
  const matrix: number[][] = new Array(k);
  for (let i = 0; i < k; i++) {
    const row = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      const r = rand();
      if (r < 1 / 6) row[j] = 1;
      else if (r < 2 / 6) row[j] = -1;
      else row[j] = 0;
    }
    matrix[i] = row;
  }
  return matrix;
}

/**
 * Project an n×d matrix into k dimensions: `P = (1/√k) · A · Rᵀ`,
 * where R is the k×d Achlioptas matrix. Result is n×k.
 *
 * @param matrix - Source row-major matrix (n rows × d columns).
 * @param achlioptas - k×d Achlioptas matrix.
 * @param k - Projection dimension.
 * @returns n×k projected matrix (plain number[][]).
 */
export function project(matrix: number[][], achlioptas: number[][], k: number): number[][] {
  const rows = matrix.length;
  const result: number[][] = new Array(rows);
  const invSqrtK = 1 / Math.sqrt(k);

  for (let i = 0; i < rows; i++) {
    const outRow = new Array<number>(k);
    for (let col = 0; col < k; col++) {
      let sum = 0;
      for (let j = 0; j < matrix[i].length; j++) {
        sum += matrix[i][j] * achlioptas[col][j];
      }
      outRow[col] = sum * invSqrtK;
    }
    result[i] = outRow;
  }
  return result;
}
