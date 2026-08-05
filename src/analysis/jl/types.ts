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
  /**
   * Ordered entity IDs for the analyzed scope (TASK-65). Persisted so the
   * drift pipeline can align snapshots across commits. Optional so snapshots
   * written before TASK-65 remain readable; the drift tool reports "no
   * baseline" when alignment data is absent. `adjacencyRows` are NEVER
   * persisted here — they are recomputed on demand.
   */
  entityIndex?: string[];
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

// ---------------------------------------------------------------------------
// TASK-65 — architecture drift (per-entity L2 distance between snapshots)
// ---------------------------------------------------------------------------

/** Drift severity class. */
export type DriftLevel = 'stable' | 'moderate' | 'significant' | 'critical';

/**
 * Severity thresholds in L2 distance space (shared constants — never hard-code
 * 0.5 / 1.5 / 3.0 in callers or tests).
 */
export const DRIFT_THRESHOLDS: Readonly<{
  moderate: number;
  significant: number;
  critical: number;
}> = {
  moderate: 0.5,
  significant: 1.5,
  critical: 3.0,
};

/** Default drift options (threshold for the CI/CD gate; topK/minLevel are optional). */
export const DEFAULT_DRIFT_OPTIONS: DriftOptions = {
  threshold: DRIFT_THRESHOLDS.critical,
};

/** One shared entity's drift between two snapshots. */
export interface EntityDrift {
  entityId: string;
  /** L2 distance of the entity's adjacency row between the two snapshots. */
  drift: number;
  level: DriftLevel;
  /** Column-sum delta (incoming edges) — to − from. Auxiliary signal for human judgment. */
  deltaFanIn: number;
  /** Row-sum delta (outgoing edges) — to − from. Auxiliary signal for human judgment. */
  deltaFanOut: number;
  /** Test-coverage delta — to − from. Placeholder 0 until TestCoverageMapper is wired (TASK-66). */
  deltaCoverage: number;
}

/**
 * In-memory representation of one architecture snapshot for drift comparison.
 * `adjacencyRows` are recomputed on demand (never persisted to history).
 */
export interface DriftSnapshot {
  timestamp: string;
  commitSha?: string;
  /** Ordered entity IDs; `adjacencyRows[i]` is the row for `entityIndex[i]`. */
  entityIndex: string[];
  /** Row-major weighted adjacency matrix. */
  adjacencyRows: number[][];
}

/** Structured drift comparison report (the MCP tool payload / CLI output). */
export interface DriftReport {
  fromSnapshot: { timestamp: string; commitSha?: string };
  toSnapshot: { timestamp: string; commitSha?: string };
  mode: ProjectionMode;
  /** |E_union| — the unified coordinate system size. */
  nUnion: number;
  /** JL projection dimension, null in DIRECT mode. */
  k: number | null;
  /** |E_shared| — entities present in both snapshots. */
  sharedEntityCount: number;
  addedEntities: string[];
  removedEntities: string[];
  /** Sorted by drift descending; honouring topK/minLevel when set in options. */
  drifts: EntityDrift[];
  summary: {
    critical: number;
    significant: number;
    moderate: number;
    stable: number;
  };
}

/** Options shared by the CLI drift gate, the MCP tool and DriftCalculator. */
export interface DriftOptions {
  /** CLI baseline commit (`--drift-base`). Not consumed by `compare()`. */
  base?: string;
  /** CI/CD gate threshold — exit 1 when any entity drift ≥ threshold. Default 3.0. */
  threshold: number;
  /** Truncate `report.drifts` to the top-K highest-drift entities. */
  topK?: number;
  /** Level floor for `report.drifts` (e.g. 'moderate' keeps moderate+significant+critical). */
  minLevel?: DriftLevel;
}

/** Result of aligning two snapshots' entity sets into a union coordinate system. */
export interface AlignmentResult {
  /** E_union — the unified coordinate system (ordered, deduped). */
  entityIndex: string[];
  /** E_shared = E1 ∩ E2 — entities that participate in drift scores. */
  shared: string[];
  /** E2 \ E1 — entities only in the later snapshot. */
  added: string[];
  /** E1 \ E2 — entities only in the earlier snapshot. */
  removed: string[];
}
