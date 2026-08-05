/**
 * Weighted adjacency-matrix builder from ArchJSON relations (TASK-64).
 *
 * Every entity becomes one row/column; each relation adds its type weight to
 * `A[source][target]`. Relation weights follow the JL proposal v3 table:
 *
 *   inheritance / implementation = 2.0 (strongest coupling)
 *   composition                  = 1.5
 *   aggregation / dependency / association = 1.0
 *   unknown type                 = 1.0 + console.warn
 *
 * Relations referencing IDs outside `entities` are skipped (external deps do
 * not participate). Returns plain `number[][]` (downstream TASK-65/66 contract).
 *
 * @module analysis/jl/adjacency-builder
 */

import type { ArchJSON } from '@/types/index.js';

const RELATION_WEIGHTS: Readonly<Record<string, number>> = {
  inheritance: 2.0,
  implementation: 2.0,
  composition: 1.5,
  aggregation: 1.0,
  dependency: 1.0,
  association: 1.0,
  // `call` is a first-class RelationType (method-level calls) and is treated as
  // a general usage relation (weight 1.0) — known, so it does not spam the
  // unknown-type warning on every class-level `call` edge. Unknown types that
  // are NOT in the table still fall through to weight 1.0 + console.warn.
  call: 1.0,
};

const UNKNOWN_WEIGHT = 1.0;

/**
 * Resolve the weight for a relation type.
 *
 * @returns The weight and whether the type was a known table entry.
 */
export function weightForRelationType(type: string): {
  weight: number;
  known: boolean;
} {
  if (Object.prototype.hasOwnProperty.call(RELATION_WEIGHTS, type)) {
    return { weight: RELATION_WEIGHTS[type], known: true };
  }
  return { weight: UNKNOWN_WEIGHT, known: false };
}

/**
 * Build an n×n weighted adjacency matrix (plain number[][]) from ArchJSON.
 *
 * - Entity i ↔ row/column i, ordered by `archJson.entities`.
 * - Repeated relations accumulate weight on the same cell.
 * - Relations whose source/target is not a known entity ID are skipped.
 * - Unknown relation types use weight 1.0 and emit a console.warn.
 *
 * @param archJson - ArchJSON (only `entities` and `relations` are read).
 * @returns Row-major n×n matrix. A zero-entity ArchJSON yields a 0×0 matrix.
 */
export function buildAdjacencyMatrix(
  archJson: Pick<ArchJSON, 'entities' | 'relations'>
): number[][] {
  const n = archJson.entities.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));

  const indexById = new Map<string, number>();
  archJson.entities.forEach((entity, index) => {
    indexById.set(entity.id, index);
  });

  for (const relation of archJson.relations) {
    const sourceIndex = indexById.get(relation.source);
    const targetIndex = indexById.get(relation.target);
    if (sourceIndex === undefined || targetIndex === undefined) {
      // External dependency — skip, never fail.
      continue;
    }
    const { weight, known } = weightForRelationType(relation.type);
    if (!known) {
      console.warn(
        `[jl] unknown relation type "${String(relation.type)}" → weight ${UNKNOWN_WEIGHT}`
      );
    }
    matrix[sourceIndex][targetIndex] += weight;
  }

  return matrix;
}

/**
 * Per-column z-score normalization (snapshot-internal, no cross-snapshot baseline).
 *
 * For each column j: `A'[i][j] = (A[i][j] − μ[j]) / σ[j]`, where μ is the column
 * mean and σ the population standard deviation. A column with σ = 0 (including
 * an all-zero column) stays all zeros — it carries no variance information.
 *
 * @param matrix - Row-major matrix.
 * @returns Normalized matrix (plain number[][]).
 */
export function normalizeColumns(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;

  if (rows === 0 || cols === 0) return [];

  const means = new Array<number>(cols).fill(0);
  const stds = new Array<number>(cols).fill(0);

  for (let j = 0; j < cols; j++) {
    let sum = 0;
    for (let i = 0; i < rows; i++) sum += matrix[i][j];
    const mean = sum / rows;
    means[j] = mean;

    let squareSum = 0;
    for (let i = 0; i < rows; i++) {
      const diff = matrix[i][j] - mean;
      squareSum += diff * diff;
    }
    const std = Math.sqrt(squareSum / rows);
    stds[j] = std === 0 ? 0 : std;
  }

  return matrix.map((row) =>
    row.map((value, j) => {
      if (stds[j] === 0) return 0;
      return (value - means[j]) / stds[j];
    })
  );
}
