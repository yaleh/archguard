/**
 * Baseline-snapshot reconstruction for the architecture-drift pipeline
 * (TASK-65). Drift distances need both snapshots' weighted adjacency rows, but
 * the history file persists ONLY `entityIndex` (never adjacency — the O(n²)
 * matrix is too large, AC5). This module bridges the gap by re-analyzing the
 * source tree at the two commits on demand:
 *
 *   1. `reanalyzeCommitSnapshot` — checks out a commit into a temporary git
 *      worktree, runs the standard analysis pipeline to ArchJSON, builds a
 *      `DriftSnapshot`, then removes the worktree.
 *   2. `resolveBaselineSnapshot` / `resolveDriftSnapshots` — resolve which
 *      commits to compare from `arch-health-history.json` and produce the two
 *      `DriftSnapshot` objects.
 *
 * @module cli/utils/drift-baseline
 */

import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { runAnalysis } from '../analyze/run-analysis.js';
import { ProgressReporter } from '../progress/index.js';
import { buildAdjacencyMatrix } from '@/analysis/jl/adjacency-builder.js';
import type { ArchHealthHistory, DriftSnapshot } from '@/analysis/jl/types.js';
import type { ArchJSON } from '@/types/index.js';

/**
 * Build an in-memory DriftSnapshot from an ArchJSON document.
 *
 * @param archJson - Parsed architecture JSON.
 * @param timestamp - Snapshot timestamp (ISO-8601).
 * @param commitSha - Optional commit sha this snapshot corresponds to.
 */
export function snapshotFromArchJson(
  archJson: ArchJSON,
  timestamp: string,
  commitSha?: string
): DriftSnapshot {
  return {
    timestamp,
    commitSha,
    entityIndex: archJson.entities.map((e) => e.id),
    adjacencyRows: buildAdjacencyMatrix(archJson),
  };
}

/**
 * Verify a commit reference exists and canonicalize it.
 *
 * @param root - Git repository root.
 * @param ref - Commit sha or ref.
 * @returns The full commit sha, or null when the reference is invalid.
 */
export async function resolveCommitShaOrNull(root: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['-C', root, 'rev-parse', '--verify', `${ref}^{commit}`]);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Re-analyze the source tree at a specific commit into a DriftSnapshot.
 *
 * Uses a temporary detached git worktree so the working tree of the host
 * project is never disturbed. Throws a descriptive error on invalid commits or
 * analysis failure.
 *
 * @param root - Git repository root.
 * @param commitSha - The commit to analyze.
 */
export async function reanalyzeCommitSnapshot(
  root: string,
  commitSha: string
): Promise<DriftSnapshot> {
  const resolved = await resolveCommitShaOrNull(root, commitSha);
  if (resolved === null) {
    throw new Error(`invalid commit reference: ${commitSha}`);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-drift-'));
  const worktreePath = path.join(tmpBase, 'wt');
  let created = false;

  try {
    await execa('git', ['-C', root, 'worktree', 'add', '--detach', worktreePath, resolved]);
    created = true;

    const result = await runAnalysis({
      sessionRoot: worktreePath,
      workDir: path.join(worktreePath, '.archguard'),
      cliOptions: { format: 'json', concurrency: 2 },
      reporter: new ProgressReporter(),
    });

    if (!result.lastArchJson) {
      throw new Error(`no ArchJSON produced for commit ${commitSha}`);
    }
    return snapshotFromArchJson(result.lastArchJson, new Date().toISOString(), resolved);
  } finally {
    if (created) {
      try {
        await execa('git', ['-C', root, 'worktree', 'remove', '--force', worktreePath]);
      } catch {
        // Best-effort cleanup; a leftover worktree is prunable by git.
      }
    }
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
}

export type BaselineResolution =
  | { kind: 'snapshot'; snapshot: DriftSnapshot }
  | { kind: 'no-baseline' }
  | { kind: 'invalid-commit'; commit: string };

/**
 * Resolve the baseline snapshot for the CLI drift gate.
 *
 * - No history file / empty history → `no-baseline`.
 * - `base` provided but not present in history → `invalid-commit` (exit 2).
 * - Otherwise the baseline commit is re-analyzed into a snapshot.
 *
 * @param base - The `--drift-base` commit sha.
 * @param history - Loaded history, or null when the file is absent.
 * @param root - Git repository root.
 * @param reanalyze - Snapshot reconstruction hook (overridable in tests).
 */
export async function resolveBaselineSnapshot(
  base: string | undefined,
  history: ArchHealthHistory | null,
  root: string,
  reanalyze: (commitSha: string, root: string) => Promise<DriftSnapshot> = reanalyzeCommitSnapshot
): Promise<BaselineResolution> {
  if (history === null || history.snapshots.length === 0) return { kind: 'no-baseline' };
  if (base === undefined) return { kind: 'no-baseline' };

  const match = history.snapshots.find((s) => s.commitSha === base);
  if (match === undefined || match.commitSha === undefined) {
    return { kind: 'invalid-commit', commit: base };
  }

  const snapshot = await reanalyze(match.commitSha, root);
  return { kind: 'snapshot', snapshot };
}

export type DriftSnapshotsResolution =
  | { kind: 'snapshots'; from: DriftSnapshot; to: DriftSnapshot }
  | { kind: 'no-baseline' }
  | { kind: 'from-not-found'; commit: string };

/**
 * Resolve the two snapshots for the MCP drift tool.
 *
 * - `toCommit` defaults to the newest snapshot; `fromCommit` defaults to the
 *   snapshot immediately before it (chronological).
 * - `fromCommit` explicitly requested but absent from history →
 *   `from-not-found` (structured error).
 * - Fewer than two usable snapshots → `no-baseline`.
 *
 * @param fromCommit - Baseline commit sha (optional).
 * @param toCommit - Comparison commit sha (optional).
 * @param history - Loaded history (must be non-null, non-empty).
 * @param root - Git repository root.
 * @param reanalyze - Snapshot reconstruction hook (overridable in tests).
 */
export async function resolveDriftSnapshots(
  fromCommit: string | undefined,
  toCommit: string | undefined,
  history: ArchHealthHistory,
  root: string,
  reanalyze: (commitSha: string, root: string) => Promise<DriftSnapshot> = reanalyzeCommitSnapshot
): Promise<DriftSnapshotsResolution> {
  const sorted = [...history.snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const toIndex = toCommit !== undefined ? sorted.findIndex((s) => s.commitSha === toCommit) : -1;
  const effectiveToIndex = toIndex >= 0 ? toIndex : sorted.length - 1;
  const toSnapshot = sorted[effectiveToIndex];
  if (toSnapshot === undefined || toSnapshot.commitSha === undefined) {
    return { kind: 'no-baseline' };
  }

  let fromIndex: number;
  if (fromCommit !== undefined) {
    fromIndex = sorted.findIndex((s) => s.commitSha === fromCommit);
    if (fromIndex < 0) return { kind: 'from-not-found', commit: fromCommit };
  } else {
    fromIndex = effectiveToIndex - 1;
  }
  const fromSnapshot = sorted[fromIndex];
  if (fromSnapshot === undefined || fromSnapshot.commitSha === undefined) {
    return { kind: 'no-baseline' };
  }

  // Sequential (not Promise.all): git worktree add contends on the repo's
  // worktrees lock when two add/remove pairs run concurrently.
  const from = await reanalyze(fromSnapshot.commitSha, root);
  const to = await reanalyze(toSnapshot.commitSha, root);
  return { kind: 'snapshots', from, to };
}
