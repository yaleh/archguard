/**
 * Shapes for loaded git-history data.
 *
 * `LoadedHistoryData` is the in-memory shape the analysis-layer `HistoryQuery`
 * consumes, so it is defined here (analysis) rather than in the cli loader that
 * happens to build it. `src/cli/git-history/history-loader.ts` imports and
 * re-exports it, so existing import paths keep working (layer guard:
 * tests/unit/architecture/layer-imports.test.ts — analysis must not import cli).
 */

import type {
  GitHistoryManifest,
  FileHistoryMetrics,
  PackageHistoryMetrics,
} from '@/types/git-history.js';

export interface LoadedHistoryData {
  manifest: GitHistoryManifest;
  /** Keyed by PackageHistoryMetrics.path */
  packageMetrics: Map<string, PackageHistoryMetrics>;
  /** Keyed by FileHistoryMetrics.path */
  fileMetrics: Map<string, FileHistoryMetrics>;
}
