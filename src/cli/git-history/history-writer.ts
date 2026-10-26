/**
 * History writer — persists GitHistoryArtifacts to disk.
 *
 * Writes three JSON files under <archguardDir>/query/git-history/:
 *   - manifest.json
 *   - package-metrics.json
 *   - file-metrics.json
 */

import fs from 'fs-extra';
import path from 'path';
import type { GitHistoryArtifacts, GitHistoryManifest } from '@/types/git-history.js';

/**
 * Write git history artifacts to the .archguard query directory.
 *
 * @param archguardDir  The .archguard directory path (e.g. /project/.archguard).
 * @param artifacts     The artifacts to persist.
 */
export async function writeHistoryArtifacts(
  archguardDir: string,
  artifacts: GitHistoryArtifacts
): Promise<void> {
  const outputDir = path.join(archguardDir, 'query', 'git-history');
  await fs.ensureDir(outputDir);

  await Promise.all([
    fs.writeJson(path.join(outputDir, 'manifest.json'), artifacts.manifest, { spaces: 2 }),
    fs.writeJson(path.join(outputDir, 'package-metrics.json'), artifacts.packageMetrics, {
      spaces: 2,
    }),
    fs.writeJson(path.join(outputDir, 'file-metrics.json'), artifacts.fileMetrics, { spaces: 2 }),
  ]);
}

/**
 * The git-history artifact manifest, with optional provenance fields that
 * newer writers may record.
 */
export interface HistoryArtifactManifest extends GitHistoryManifest {
  /** Sources the history was collected for, when recorded. */
  sources?: string[];
  /** Language of those sources, when recorded. */
  language?: string;
}

/**
 * Read the git-history artifact manifest from `query/git-history/manifest.json`.
 *
 * Returns null when the file is absent or unreadable. Never throws: a broken
 * auxiliary artifact must not make `analyze` fail.
 */
export async function readHistoryManifest(
  archguardDir: string
): Promise<HistoryArtifactManifest | null> {
  const manifestPath = path.join(archguardDir, 'query', 'git-history', 'manifest.json');
  if (!(await fs.pathExists(manifestPath))) return null;

  try {
    return (await fs.readJson(manifestPath)) as HistoryArtifactManifest;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[git-history] Ignoring unreadable artifact manifest ${manifestPath}: ${message}`);
    return null;
  }
}
