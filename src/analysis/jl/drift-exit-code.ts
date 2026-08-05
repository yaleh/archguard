/**
 * CI/CD drift-gate exit-code logic (TASK-65 Phase C).
 *
 * Exit codes:
 *   0 — gate passed (no entity meets/exceeds the threshold), or no baseline
 *       snapshot exists (explanatory message printed by the caller).
 *   1 — at least one entity's drift meets/exceeds the threshold (breach).
 *   2 — the `--drift-base` commit reference is invalid (not found in history).
 *
 * @module analysis/jl/drift-exit-code
 */

import type { DriftReport } from './types.js';

export type DriftGateStatus = 'ok' | 'no-baseline' | 'invalid-commit';

/**
 * Determine the process exit code for the drift gate.
 *
 * @param report - The drift report, or null when no comparison ran.
 * @param threshold - Gate threshold (default 3.0). Breach = drift ≥ threshold.
 * @param status - Baseline-resolution status.
 */
export function determineDriftExitCode(
  report: DriftReport | null,
  threshold: number,
  status: DriftGateStatus = 'ok'
): 0 | 1 | 2 {
  if (status === 'invalid-commit') return 2;
  if (status === 'no-baseline' || report === null) return 0;

  const breached = report.drifts.some((d) => d.drift >= threshold);
  return breached ? 1 : 0;
}
