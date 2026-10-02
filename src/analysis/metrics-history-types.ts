/**
 * Types and on-disk name for the per-analyze metrics history JSONL.
 *
 * These live in the analysis layer (below cli) because the history file is an
 * analysis artifact: `metrics-history-reader.ts` reads it and the cli writer
 * appends to it. `src/cli/metrics-history-writer.ts` imports and re-exports them,
 * so existing import paths keep working (layer guard:
 * tests/unit/architecture/layer-imports.test.ts — analysis must not import cli).
 *
 * @module analysis/metrics-history-types
 */

export interface PackageMetricsSnapshot {
  /** Package name (e.g. "src/parser" or "com.example.service") */
  name: string;
  /** Number of cross-package incoming relations */
  fanIn: number;
  /** Number of cross-package outgoing relations */
  fanOut: number;
  /** Number of SCCs (strongly-connected components) this package participates in */
  cycleCount: number;
  /** Number of entities in this package */
  entityCount: number;
}

export interface MetricsHistoryEntry {
  /** ISO-8601 UTC timestamp of the analyze run */
  timestamp: string;
  /** Per-package metrics snapshot */
  packages: PackageMetricsSnapshot[];
  /** Query scope key of the analyzed scope. Absent on legacy entries (read as "unknown"). */
  scopeKey?: string;
  /** Source paths of the analyzed scope. Absent on legacy entries. */
  sources?: string[];
}

export interface MetricsHistoryScopeInfo {
  scopeKey?: string;
  sources?: string[];
}

/** Path within outputDir where the JSONL file is written. */
export const METRICS_HISTORY_FILENAME = 'metrics-history.jsonl';
