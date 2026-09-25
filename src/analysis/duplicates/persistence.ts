/**
 * Persistence layer for duplicate-detection results.
 *
 * Writes and reads the analysis under .archguard/query/duplicates/.
 */

import fs from 'fs-extra';
import path from 'path';
import type { DuplicateAnalysis, DuplicateGroup, DuplicateManifest } from './types.js';
import { errorMessage } from '@/utils/error-message.js';

const DUPLICATES_SUBDIR = 'query/duplicates';
const MANIFEST_FILE = 'manifest.json';
const GROUPS_FILE = 'groups.json';

function duplicatesDir(archDir: string): string {
  return path.join(archDir, DUPLICATES_SUBDIR);
}

/**
 * Persist duplicate-detection results to `<archDir>/query/duplicates/`.
 */
export async function persistDuplicates(
  archDir: string,
  analysis: DuplicateAnalysis
): Promise<void> {
  const dir = duplicatesDir(archDir);
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, MANIFEST_FILE), analysis.manifest, { spaces: 2 });
  await fs.writeJson(path.join(dir, GROUPS_FILE), analysis.groups, { spaces: 2 });
}

/**
 * Load persisted duplicate-detection results.
 *
 * Returns null when nothing has been persisted; throws a descriptive error on malformed JSON.
 */
export async function loadDuplicates(archDir: string): Promise<DuplicateAnalysis | null> {
  const dir = duplicatesDir(archDir);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  const groupsPath = path.join(dir, GROUPS_FILE);

  if (!(await fs.pathExists(manifestPath))) return null;

  try {
    const manifest = (await fs.readJson(manifestPath)) as DuplicateManifest;
    const groups = (await fs.pathExists(groupsPath))
      ? ((await fs.readJson(groupsPath)) as DuplicateGroup[])
      : [];
    return { manifest, groups };
  } catch (err: unknown) {
    throw new Error(`Failed to load duplicate results from ${dir}: ${errorMessage(err)}`);
  }
}
