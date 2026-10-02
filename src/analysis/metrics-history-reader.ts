/**
 * Reads the per-analyze metrics history from .archguard/metrics-history.jsonl.
 * Extracted from the MCP tool layer per ADR-006 ("tools should be thin").
 */

import path from 'path';
import fs from 'fs-extra';
import { METRICS_HISTORY_FILENAME } from './metrics-history-types.js';
import type { MetricsHistoryEntry } from './metrics-history-types.js';

export type { MetricsHistoryEntry };

/** Scope label assigned to legacy entries that carry no `scopeKey`. */
export const UNKNOWN_SCOPE = 'unknown';

export interface ReadHistoryOptions {
  /**
   * Only return entries of this scope. Entries without a `scopeKey` (legacy)
   * belong to the {@link UNKNOWN_SCOPE} scope rather than being dropped.
   */
  scope?: string;
}

/**
 * Read all JSONL lines from the metrics-history file.
 * Returns an empty array if the file does not exist.
 */
export async function readHistoryEntries(
  outputDir: string,
  options: ReadHistoryOptions = {}
): Promise<MetricsHistoryEntry[]> {
  const filePath = path.join(outputDir, METRICS_HISTORY_FILENAME);
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const entries: MetricsHistoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as MetricsHistoryEntry);
    } catch {
      // Skip malformed lines
    }
  }
  if (options.scope === undefined) return entries;
  return entries.filter((e) => (e.scopeKey ?? UNKNOWN_SCOPE) === options.scope);
}
