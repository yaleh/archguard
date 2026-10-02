/**
 * MetricsHistoryWriter — append per-analyze package metrics snapshots to JSONL.
 *
 * Each call to append() writes one line to <outputDir>/metrics-history.jsonl.
 * The file grows monotonically; existing lines are never modified.
 *
 * @module cli/metrics-history-writer
 */

import path from 'path';
import fs from 'fs-extra';
import { METRICS_HISTORY_FILENAME } from '@/analysis/metrics-history-types.js';
import type {
  MetricsHistoryEntry,
  MetricsHistoryScopeInfo,
  PackageMetricsSnapshot,
} from '@/analysis/metrics-history-types.js';

// Re-exported so existing importers of this module keep their paths
// (tests/unit/cli/metrics-history-writer.test.ts, cli/mcp/tools/metric-trend-tools.ts).
export type { MetricsHistoryEntry, MetricsHistoryScopeInfo, PackageMetricsSnapshot };

export class MetricsHistoryWriter {
  /** Path within outputDir where the JSONL file is written. */
  static readonly FILENAME = METRICS_HISTORY_FILENAME;

  /**
   * Append a snapshot of current package metrics to the history file.
   *
   * @param packages - Array of per-package metrics to record.
   * @param outputDir - The .archguard directory where the file is written.
   * @param scope - Optional scope identity recorded on the entry.
   * @returns true if a line was written; false if the snapshot was empty and skipped.
   */
  async append(
    packages: PackageMetricsSnapshot[],
    outputDir: string,
    scope: MetricsHistoryScopeInfo = {}
  ): Promise<boolean> {
    // An empty snapshot carries no trend information — never record it.
    if (packages.length === 0) return false;

    const filePath = path.join(outputDir, MetricsHistoryWriter.FILENAME);

    const entry: MetricsHistoryEntry = {
      timestamp: new Date().toISOString(),
      packages,
    };
    if (scope.scopeKey !== undefined) entry.scopeKey = scope.scopeKey;
    if (scope.sources !== undefined) entry.sources = scope.sources;

    const line = JSON.stringify(entry) + '\n';

    // Ensure the directory exists, then append atomically to the file.
    await fs.ensureDir(outputDir);
    await fs.appendFile(filePath, line, 'utf-8');
    return true;
  }
}
