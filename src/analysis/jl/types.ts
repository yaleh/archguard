/**
 * Type definitions for the JL intrinsic-dimension analysis pipeline (TASK-64).
 *
 * Downstream contract (TASK-65 / TASK-66): `adjacency-builder.ts` and
 * `jl-projector.ts` return plain `number[][]` matrices so downstream proposals
 * do not need the `ml-matrix` runtime dependency.
 *
 * @module analysis/jl/types
 */

/** Adaptive projection mode. DIRECT for n < threshold, JL for n ≥ threshold. */
export type ProjectionMode = 'direct' | 'jl';

export interface JLConfig {
  /** Seeded PRNG seed for Achlioptas matrix generation (determinism). */
  seed: number;
  /** JL distance-preservation precision ε. Default 0.3. */
  epsilon: number;
  /** Adaptive mode-switch threshold on entity count. Default 1000. */
  directModeThreshold: number;
}

export const DEFAULT_JL_CONFIG: JLConfig = {
  seed: 42,
  epsilon: 0.3,
  directModeThreshold: 1000,
};

/** Feature-vector version recorded on every snapshot. */
export const FEATURE_VERSION = '1.0';

/** Current history schema version. */
export const HISTORY_SCHEMA_VERSION = 1;

/** Maximum snapshots retained in the history file (oldest evicted). */
export const MAX_SNAPSHOTS = 500;

/** Cumulative-variance threshold for d_int (explain ≥ 95% variance). */
export const VARIANCE_THRESHOLD = 0.95;

/** Trend delta threshold on d_int_normalized. */
export const TREND_DELTA_THRESHOLD = 0.002;

/**
 * One computed intrinsic-dimension snapshot.
 */
export interface IntrinsicDimensionResult {
  timestamp: string;
  commitSha?: string;
  entityCount: number;
  mode: ProjectionMode;
  featureVersion: string;
  k: number | null;
  dInt: number;
  dIntNormalized: number;
  /**
   * Cumulative variance-explained curve, truncated to the first dInt + 10
   * values and padded to end with 1.0. Empty array for a zero matrix.
   */
  varianceExplained: number[];
  epsilon: number | null;
}

/**
 * The persisted time-series file `.archguard/arch-health-history.json`.
 */
export interface ArchHealthHistory {
  schemaVersion: number;
  language: string;
  snapshots: IntrinsicDimensionResult[];
}

/** Result of a snapshot append operation. */
export interface AppendSnapshotResult {
  /** True when the snapshot was persisted. False on schema incompatibility. */
  ok: boolean;
  /** Reason for a refused write (schema mismatch), otherwise undefined. */
  reason?: string;
  /** The previous latest snapshot before this append (null when none). */
  previous: IntrinsicDimensionResult | null;
}
