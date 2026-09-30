/**
 * Architecture intrinsic-dimension (arch-health) computation and persistence.
 *
 * Shared by `runAnalysis` (CLI `--arch-health` and MCP `archguard_analyze`
 * `archHealth:true`) so both entry points write the same history file.
 *
 * @module cli/analyze/arch-health
 */

import path from 'path';
import { execa } from 'execa';
import { buildAdjacencyMatrix, normalizeColumns } from '@/analysis/jl/adjacency-builder.js';
import { computeMode, computeK, buildAchlioptas, project } from '@/analysis/jl/jl-projector.js';
import { computeIntrinsicDimension } from '@/analysis/jl/intrinsic-dimension.js';
import { appendSnapshot } from '@/analysis/jl/history-writer.js';
import { DEFAULT_JL_CONFIG, FEATURE_VERSION, TREND_DELTA_THRESHOLD } from '@/analysis/jl/types.js';
import type { IntrinsicDimensionResult, JLConfig } from '@/analysis/jl/types.js';
import type { ArchJSON } from '@/types/index.js';

/**
 * Resolve HEAD's full commit sha from `root`, or null when unavailable
 * (not a git repo, no commits yet, git missing). Duplicated from
 * `cli/utils/drift-baseline.ts` rather than imported from it: that module
 * imports `runAnalysis`, which imports `computeArchHealth` from this file —
 * importing back would create a require cycle.
 */
async function resolveHeadCommitSha(root: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Scope identity stamped on a snapshot (same field names as metrics-history, TASK-100). */
export interface ArchHealthScope {
  scopeKey?: string;
  sources?: string[];
}

export interface ArchHealthOutcome {
  result: IntrinsicDimensionResult;
  /** Latest snapshot before this append (null when none). */
  previous: IntrinsicDimensionResult | null;
  /** True when the snapshot reached `arch-health-history.json`. */
  persisted: boolean;
  /** Reason the snapshot was not persisted, when `persisted` is false. */
  reason?: string;
  /** Direct-mode threshold used (for display). */
  threshold: number;
}

/**
 * Orchestrate the JL intrinsic-dimension pipeline:
 *
 *   AdjacencyBuilder → JLProjector (adaptive) → computeIntrinsicDimension
 *     → appendSnapshot
 *
 * Writes `.archguard/arch-health-history.json`. Does not print anything, so it
 * is safe to call from the MCP stdio server.
 *
 * @param archJson - Parsed ArchJSON for the analyzed scope.
 * @param archguardDir - The `.archguard` work directory for the project.
 * @param config - JL configuration (defaults applied when omitted).
 * @param scope - Optional scope identity recorded on the snapshot.
 */
export async function computeArchHealth(
  archJson: ArchJSON,
  archguardDir: string,
  config: JLConfig = DEFAULT_JL_CONFIG,
  scope: ArchHealthScope = {}
): Promise<ArchHealthOutcome> {
  const matrix = buildAdjacencyMatrix(archJson);
  const normalized = normalizeColumns(matrix);
  const entityCount = archJson.entities.length;
  const mode = computeMode(entityCount, config);

  let data: number[][];
  let k: number | null = null;
  let epsilon: number | null = null;

  if (mode === 'jl') {
    epsilon = config.epsilon;
    k = computeK(entityCount, config.epsilon);
    const achlioptas = buildAchlioptas(k, entityCount, config.seed);
    data = project(normalized, achlioptas, k);
  } else {
    data = normalized;
  }

  // get_architecture_drift looks snapshots up by commitSha; without it every
  // snapshot from this (the only) production path was unreachable.
  const gitCwd = archJson.workspaceRoot ?? path.dirname(archguardDir);
  const commitSha = (await resolveHeadCommitSha(gitCwd)) ?? undefined;

  const result: IntrinsicDimensionResult = {
    ...computeIntrinsicDimension({
      matrix: data,
      entityCount,
      mode,
      k,
      epsilon,
      featureVersion: FEATURE_VERSION,
    }),
    // Persist entity IDs (O(n)) for cross-snapshot drift alignment (TASK-65).
    // adjacencyRows are never persisted (AC5).
    entityIndex: archJson.entities.map((e) => e.id),
    ...(commitSha !== undefined ? { commitSha } : {}),
    ...(scope.scopeKey !== undefined ? { scopeKey: scope.scopeKey } : {}),
    ...(scope.sources !== undefined ? { sources: scope.sources } : {}),
  };

  const append = await appendSnapshot(archguardDir, archJson.language, result);
  return {
    result,
    previous: append.previous,
    persisted: append.ok,
    reason: append.reason,
    threshold: config.directModeThreshold,
  };
}

/**
 * Compute, persist and print the arch-health report (CLI presentation).
 * Exported for scoped testing.
 */
export async function runArchHealth(
  archJson: ArchJSON,
  archguardDir: string,
  config: JLConfig = DEFAULT_JL_CONFIG,
  scope: ArchHealthScope = {}
): Promise<void> {
  const outcome = await computeArchHealth(archJson, archguardDir, config, scope);
  printArchHealth(outcome);
}

/** Print mode / d_int / d_int_norm / previous snapshot / trend. */
export function printArchHealth(outcome: ArchHealthOutcome): void {
  const { result, previous, threshold } = outcome;
  if (!outcome.persisted) {
    console.warn(`[arch-health] snapshot not persisted: ${outcome.reason ?? 'unknown reason'}`);
  }
  // eslint-disable-next-line no-console
  console.log('\nArchitecture Intrinsic Dimension');
  // eslint-disable-next-line no-console
  console.log(
    `  Mode:       ${result.mode.toUpperCase()} (n=${result.entityCount}, threshold=${threshold})`
  );
  // eslint-disable-next-line no-console
  console.log(`  d_int:      ${result.dInt} / ${result.entityCount} entities`);
  // eslint-disable-next-line no-console
  console.log(`  d_int_norm: ${result.dIntNormalized.toFixed(4)}`);

  if (previous) {
    const delta = result.dIntNormalized - previous.dIntNormalized;
    const trend =
      delta > TREND_DELTA_THRESHOLD
        ? 'RISING'
        : delta < -TREND_DELTA_THRESHOLD
          ? 'DECREASING'
          : 'STABLE';
    // eslint-disable-next-line no-console
    console.log(
      `  Previous:   ${previous.dInt} / ${previous.entityCount} entities  ` +
        `(d_int_norm: ${previous.dIntNormalized.toFixed(4)}, ${previous.timestamp})`
    );
    // eslint-disable-next-line no-console
    console.log(
      `  Trend:      ${trend} (Δd_int_norm = ${delta >= 0 ? '+' : ''}${delta.toFixed(4)})`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('  Previous:   none');
    // eslint-disable-next-line no-console
    console.log('  Trend:      STABLE');
  }
}
