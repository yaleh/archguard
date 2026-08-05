/**
 * Persistence for the JL intrinsic-dimension history (TASK-64).
 *
 * Appends snapshots to `.archguard/arch-health-history.json` (schemaVersion=1),
 * keeping a chronological time series capped at 500 snapshots (oldest evicted).
 * Writes are atomic (tmp + rename) and forward-compatible: a file written with
 * a newer schemaVersion is never clobbered — append is refused.
 *
 * @module analysis/jl/history-writer
 */

import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import type { ArchHealthHistory, AppendSnapshotResult, IntrinsicDimensionResult } from './types.js';
import { HISTORY_SCHEMA_VERSION, MAX_SNAPSHOTS } from './types.js';

export const HISTORY_FILENAME = 'arch-health-history.json';

/** Path to the history file inside the `.archguard` directory. */
export function historyFilePath(archDir: string): string {
  return path.join(archDir, HISTORY_FILENAME);
}

/**
 * Read the raw history file contents without schema validation.
 *
 * @returns The parsed JSON object, or null when the file is missing/unparseable.
 */
async function readRawHistory(archDir: string): Promise<Record<string, unknown> | null> {
  const filePath = historyFilePath(archDir);
  if (!(await fs.pathExists(filePath))) return null;

  let raw: unknown;
  try {
    raw = await fs.readJson(filePath);
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  return raw as Record<string, unknown>;
}

/**
 * Read and validate the history file.
 *
 * @returns Parsed history, or null when the file is missing, unparseable, or
 *   written with an incompatible (newer/older) schemaVersion.
 */
export async function readHistoryFile(archDir: string): Promise<ArchHealthHistory | null> {
  const raw = await readRawHistory(archDir);
  if (raw === null) return null;
  if (typeof raw.schemaVersion !== 'number') return null;
  if (raw.schemaVersion !== HISTORY_SCHEMA_VERSION) return null;
  if (!Array.isArray(raw.snapshots)) return null;

  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    language: typeof raw.language === 'string' ? raw.language : 'unknown',
    snapshots: raw.snapshots as IntrinsicDimensionResult[],
  };
}

/**
 * Atomically write the history file (tmp sibling + rename).
 */
export async function writeHistoryFile(archDir: string, history: ArchHealthHistory): Promise<void> {
  const filePath = historyFilePath(archDir);
  await fs.ensureDir(archDir);
  const suffix = crypto.randomUUID().slice(0, 8);
  const tmpPath = `${filePath}.tmp.${suffix}`;
  await fs.writeJson(tmpPath, history, { spaces: 2 });
  await fs.rename(tmpPath, filePath);
}

/**
 * Append a snapshot to the history time series.
 *
 * - First write creates the file with schemaVersion=1.
 * - Appends are chronological (sorted by ISO timestamp).
 * - Exceeding MAX_SNAPSHOTS evicts the oldest entries.
 * - A file with a different schemaVersion is left untouched (forward-compat).
 *
 * @returns The previous latest snapshot before this append (null when none),
 *   and whether the append was persisted.
 */
export async function appendSnapshot(
  archDir: string,
  language: string,
  snapshot: IntrinsicDimensionResult
): Promise<AppendSnapshotResult> {
  const raw = await readRawHistory(archDir);

  if (raw !== null && raw.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `history schemaVersion ${String(raw.schemaVersion)} is not compatible with ${HISTORY_SCHEMA_VERSION}`,
      previous: null,
    };
  }

  const existingSnapshots =
    raw !== null && Array.isArray(raw.snapshots)
      ? (raw.snapshots as IntrinsicDimensionResult[])
      : [];
  const previous =
    existingSnapshots.length > 0 ? existingSnapshots[existingSnapshots.length - 1] : null;

  const snapshots = [...existingSnapshots, snapshot];
  snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  }

  const history: ArchHealthHistory = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    language,
    snapshots,
  };
  await writeHistoryFile(archDir, history);

  return { ok: true, previous };
}
