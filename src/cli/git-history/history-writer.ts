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
import type { GitHistoryArtifacts } from '@/types/git-history.js';

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
