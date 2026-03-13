/**
 * History loader — reads git history artifacts from
 * <archguardDir>/query/git-history/ and builds in-memory Maps for fast lookup.
 *
 * Stage 2.1 of Phase 2 (Query Layer).
 */

import fs from 'fs-extra';
import path from 'path';
import type {
  GitHistoryManifest,
  FileHistoryMetrics,
  PackageHistoryMetrics,
} from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class GitHistoryNotFoundError extends Error {
  constructor(archguardDir: string) {
    super(
      `No git history data found at ${archguardDir}/query/git-history.\nRun archguard_analyze_git({ projectRoot: "..." }) first.`
    );
    this.name = 'GitHistoryNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface LoadedHistoryData {
  manifest: GitHistoryManifest;
  /** Keyed by PackageHistoryMetrics.path */
  packageMetrics: Map<string, PackageHistoryMetrics>;
  /** Keyed by FileHistoryMetrics.path */
  fileMetrics: Map<string, FileHistoryMetrics>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load all three git history artifact files from disk and build Maps for
 * fast lookup by path.
 *
 * @param archguardDir  The .archguard directory (e.g. /project/.archguard).
 * @throws GitHistoryNotFoundError if the directory or manifest does not exist.
 */
export async function loadHistoryData(archguardDir: string): Promise<LoadedHistoryData> {
  const historyDir = path.join(archguardDir, 'query', 'git-history');
  const manifestPath = path.join(historyDir, 'manifest.json');

  // Existence check — if manifest is absent we treat entire dataset as missing
  const manifestExists = await fs.pathExists(manifestPath);
  if (!manifestExists) {
    throw new GitHistoryNotFoundError(archguardDir);
  }

  // Load all three files in parallel
  const [manifest, packageMetricsArray, fileMetricsArray] = await Promise.all([
    fs.readJson(manifestPath) as Promise<GitHistoryManifest>,
    fs.readJson(path.join(historyDir, 'package-metrics.json')) as Promise<PackageHistoryMetrics[]>,
    fs.readJson(path.join(historyDir, 'file-metrics.json')) as Promise<FileHistoryMetrics[]>,
  ]);

  // Version check: warn if artifacts were generated without packageDepth support (v1)
  if (manifest.version === '1' || manifest.packageDepth == null) {
    console.warn(
      '[archguard] Warning: Git history artifacts were generated with an older version of ArchGuard ' +
      '(missing packageDepth). Consider re-running archguard_analyze_git to get sub-package depth support, ' +
      'SHA dedup, and contributor breakdowns. Falling back to depth=1.'
    );
  }

  // Build Maps for O(1) lookup by path
  const packageMetrics = new Map<string, PackageHistoryMetrics>(
    packageMetricsArray.map((p) => [p.path, p])
  );

  const fileMetrics = new Map<string, FileHistoryMetrics>(
    fileMetricsArray.map((f) => [f.path, f])
  );

  return { manifest, packageMetrics, fileMetrics };
}
