/**
 * Intrinsic-dimension (d_int) computation via SVD (TASK-64).
 *
 * Given a (already-normalized) feature matrix, centers each column, runs SVD,
 * and returns the number of singular directions needed to explain ≥ 95% of the
 * total variance (cumvar threshold). Pure function — no I/O.
 *
 * Edge cases:
 * - Zero matrix (no dependencies) → d_int = 0, varianceExplained = [],
 *   `noDependenciesWarning` emitted.
 * - entityCount < 3 → `lowEntityCountWarning` emitted; d_int still computed.
 *
 * @module analysis/jl/intrinsic-dimension
 */

import { SVD } from 'ml-matrix';
import type { IntrinsicDimensionResult, ProjectionMode } from './types.js';
import { FEATURE_VERSION, VARIANCE_THRESHOLD } from './types.js';

export interface ComputeIntrinsicDimensionInput {
  /** Feature matrix to run SVD on (already z-scored by the builder). */
  matrix: number[][];
  /** Number of entities (n) — used for the normalized d_int and warnings. */
  entityCount: number;
  /** Projection mode used to produce the matrix. */
  mode: ProjectionMode;
  /** JL projection dimension (null in DIRECT mode). */
  k: number | null;
  /** JL epsilon (null in DIRECT mode). */
  epsilon: number | null;
  /** Feature-vector version recorded on the snapshot. */
  featureVersion?: string;
  /** Optional timestamp; defaults to now (ISO-8601). */
  timestamp?: string;
  /** Optional git commit sha. */
  commitSha?: string;
  /** Cumulative-variance threshold (default 0.95). */
  varianceThreshold?: number;
}

/**
 * Round to 4 decimal places (AC: dIntNormalized precision).
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Center each column (subtract column mean) in place of a fresh matrix.
 */
function centerColumns(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;
  if (rows === 0 || cols === 0) return [];

  const means = new Array<number>(cols).fill(0);
  for (let j = 0; j < cols; j++) {
    let sum = 0;
    for (let i = 0; i < rows; i++) sum += matrix[i][j];
    means[j] = sum / rows;
  }

  return matrix.map((row) => row.map((value, j) => value - means[j]));
}

/**
 * Compute d_int and the truncated cumulative-variance curve.
 */
export function computeIntrinsicDimension(
  input: ComputeIntrinsicDimensionInput
): IntrinsicDimensionResult {
  const {
    matrix,
    entityCount,
    mode,
    k,
    epsilon,
    featureVersion = FEATURE_VERSION,
    timestamp = new Date().toISOString(),
    commitSha,
    varianceThreshold = VARIANCE_THRESHOLD,
  } = input;

  if (entityCount < 3) {
    console.warn(`[jl] low entity count (${entityCount} < 3): d_int is not meaningful`);
  }

  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;
  const isZeroMatrix = rows === 0 || cols === 0;

  let singularValues: number[] = [];
  if (!isZeroMatrix) {
    const centered = centerColumns(matrix);
    const svd = new SVD(centered);
    singularValues = Array.from(svd.diagonal);
  }

  const totalEnergy = singularValues.reduce((sum, s) => sum + s * s, 0);
  const noDependencies = isZeroMatrix || totalEnergy < 1e-12;

  let dInt: number;
  let varianceExplained: number[];

  if (noDependencies) {
    console.warn(
      '[jl] no dependencies detected (zero adjacency matrix): d_int = 0, varianceExplained = []'
    );
    dInt = 0;
    varianceExplained = [];
  } else {
    // Find the first d where cumvar ≥ threshold.
    let cumulative = 0;
    dInt = 0;
    for (let i = 0; i < singularValues.length; i++) {
      cumulative += singularValues[i] * singularValues[i];
      if (cumulative / totalEnergy >= varianceThreshold) {
        dInt = i + 1;
        break;
      }
    }
    if (dInt === 0) dInt = singularValues.length;

    // Truncate varianceExplained to the first dInt + 10 values; last === 1.0.
    const length = Math.min(dInt + 10, singularValues.length);
    varianceExplained = new Array<number>(length);
    cumulative = 0;
    for (let i = 0; i < length; i++) {
      cumulative += singularValues[i] * singularValues[i];
      varianceExplained[i] = cumulative / totalEnergy;
    }
    if (varianceExplained.length > 0) {
      varianceExplained[varianceExplained.length - 1] = 1.0;
    }
  }

  const dIntNormalized = entityCount > 0 ? round4(dInt / entityCount) : 0;

  return {
    timestamp,
    commitSha,
    entityCount,
    mode,
    featureVersion,
    k,
    dInt,
    dIntNormalized,
    varianceExplained,
    epsilon,
  };
}
