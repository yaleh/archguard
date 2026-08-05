/**
 * Per-entity architecture-drift computation (TASK-65 Phase B).
 *
 * Every entity is a row of the weighted adjacency matrix — its full fingerprint
 * in the dependency graph. Drift between two snapshots is the L2 distance
 * between the entity's aligned row vectors (union coordinate system):
 *
 *   drift(i) = ‖v_i(t1) − v_i(t2)‖₂
 *
 * Adaptive mode mirrors TASK-64: DIRECT for |E_union| < 1000, JL projection
 * otherwise. The drift JL matrix R depends on N_union and is generated fresh
 * with a fixed seed (deterministic) — it deliberately does NOT reuse the
 * intrinsic-dimension matrix from jl-state.json.
 *
 * @module analysis/jl/drift-calculator
 */

import { EntityAligner } from './entity-aligner.js';
import { computeMode, computeK, buildAchlioptas, project } from './jl-projector.js';
import { DEFAULT_DRIFT_OPTIONS, DEFAULT_JL_CONFIG, DRIFT_THRESHOLDS } from './types.js';
import type { DriftLevel, DriftOptions, DriftReport, DriftSnapshot, EntityDrift } from './types.js';

const LEVEL_RANK: Record<DriftLevel, number> = {
  stable: 0,
  moderate: 1,
  significant: 2,
  critical: 3,
};

/**
 * Classify an L2 drift value into a severity class using the shared threshold
 * constants (0.5 / 1.5 / 3.0). Boundary values are inclusive on the upper
 * class: 0.499 → stable, 0.5 → moderate, 1.5 → significant, 3.0 → critical.
 */
export function classifyDrift(drift: number): DriftLevel {
  if (drift >= DRIFT_THRESHOLDS.critical) return 'critical';
  if (drift >= DRIFT_THRESHOLDS.significant) return 'significant';
  if (drift >= DRIFT_THRESHOLDS.moderate) return 'moderate';
  return 'stable';
}

function l2(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function rowSum(row: number[]): number {
  let sum = 0;
  for (const v of row) sum += v;
  return sum;
}

function columnSum(matrix: number[][], col: number): number {
  let sum = 0;
  for (const row of matrix) sum += row[col] ?? 0;
  return sum;
}

export class DriftCalculator {
  /**
   * Compare two in-memory snapshots and return a structured drift report.
   *
   * Only entities present in BOTH snapshots (E_shared) receive a drift score;
   * added/removed entities are reported in `addedEntities` / `removedEntities`
   * and excluded from scores. `summary` counts are computed over the full
   * shared set; `drifts` honours `topK` / `minLevel` when provided.
   *
   * @param from - Earlier snapshot.
   * @param to - Later snapshot.
   * @param options - DriftOptions (uses topK/minLevel; threshold is a CLI-gate concern).
   */
  static compare(
    from: DriftSnapshot,
    to: DriftSnapshot,
    options: Partial<DriftOptions> = {}
  ): DriftReport {
    const opts: DriftOptions = { ...DEFAULT_DRIFT_OPTIONS, ...options };
    const alignment = EntityAligner.align(from.entityIndex, to.entityIndex);
    const nUnion = alignment.entityIndex.length;
    const mode = computeMode(nUnion, DEFAULT_JL_CONFIG);
    const k = mode === 'jl' ? computeK(nUnion, DEFAULT_JL_CONFIG.epsilon) : null;

    // Express both snapshots' rows in the union coordinate system.
    const alignedFrom = from.entityIndex.map((_, i) =>
      EntityAligner.buildAlignedRow(
        from.adjacencyRows[i] ?? [],
        from.entityIndex,
        alignment.entityIndex
      )
    );
    const alignedTo = to.entityIndex.map((_, i) =>
      EntityAligner.buildAlignedRow(
        to.adjacencyRows[i] ?? [],
        to.entityIndex,
        alignment.entityIndex
      )
    );

    let dataFrom = alignedFrom;
    let dataTo = alignedTo;
    if (mode === 'jl') {
      // Drift-specific Achlioptas matrix: dimension depends on N_union, fixed
      // seed for determinism (never reuses jl-state.json's matrix).
      const achlioptas = buildAchlioptas(k, nUnion, DEFAULT_JL_CONFIG.seed);
      dataFrom = project(alignedFrom, achlioptas, k);
      dataTo = project(alignedTo, achlioptas, k);
    }

    const fromIndex = new Map<string, number>();
    from.entityIndex.forEach((id, i) => fromIndex.set(id, i));
    const toIndex = new Map<string, number>();
    to.entityIndex.forEach((id, i) => toIndex.set(id, i));

    const drifts: EntityDrift[] = [];
    for (const entityId of alignment.shared) {
      const fi = fromIndex.get(entityId);
      const ti = toIndex.get(entityId);
      if (fi === undefined || ti === undefined) continue;

      const drift = l2(dataFrom[fi], dataTo[ti]);
      const deltaFanOut = rowSum(to.adjacencyRows[ti] ?? []) - rowSum(from.adjacencyRows[fi] ?? []);
      const deltaFanIn = columnSum(to.adjacencyRows, ti) - columnSum(from.adjacencyRows, fi);

      drifts.push({
        entityId,
        drift,
        level: classifyDrift(drift),
        deltaFanIn,
        deltaFanOut,
        // TestCoverageMapper wiring is deferred (TASK-66); 0 is the honest default.
        deltaCoverage: 0,
      });
    }

    drifts.sort((a, b) => b.drift - a.drift);

    const summary = { critical: 0, significant: 0, moderate: 0, stable: 0 };
    for (const d of drifts) summary[d.level] += 1;

    let filtered = drifts;
    if (opts.minLevel !== undefined) {
      const minRank = LEVEL_RANK[opts.minLevel];
      filtered = filtered.filter((d) => LEVEL_RANK[d.level] >= minRank);
    }
    if (opts.topK !== undefined) {
      filtered = filtered.slice(0, opts.topK);
    }

    return {
      fromSnapshot: { timestamp: from.timestamp, commitSha: from.commitSha },
      toSnapshot: { timestamp: to.timestamp, commitSha: to.commitSha },
      mode,
      nUnion,
      k,
      sharedEntityCount: alignment.shared.length,
      addedEntities: alignment.added,
      removedEntities: alignment.removed,
      drifts: filtered,
      summary,
    };
  }
}
