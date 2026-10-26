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
/** A persisted duplicates manifest plus the directory key it was read from. */
export interface DuplicatesArtifactRecord {
  /** `query/duplicates/<scopeKey>/` directory name; absent for the legacy flat layout. */
  scopeKey?: string;
  /** The artifact's own manifest, with the optional identity fields newer writers add. */
  manifest: DuplicateManifest & {
    /** Scope key recorded inside the manifest (per-scope writers). */
    scopeKey?: string;
    /** Human-readable scope label recorded inside the manifest (per-scope writers). */
    label?: string;
    /** Language of the analysed sources, when recorded. */
    language?: string;
  };
}

/**
 * Read every persisted duplicates artifact manifest.
 *
 * Supports both on-disk layouts:
 * - per-scope `query/duplicates/<scopeKey>/manifest.json` (one record per scope),
 * - the legacy flat `query/duplicates/manifest.json` (one record, no directory key).
 *
 * Missing directories, missing manifests and malformed JSON are skipped: a
 * broken auxiliary artifact must never make `analyze` fail. Never throws.
 */
export async function readDuplicatesArtifacts(
  archDir: string
): Promise<DuplicatesArtifactRecord[]> {
  const root = duplicatesDir(archDir);
  if (!(await fs.pathExists(root))) return [];

  const records: DuplicatesArtifactRecord[] = [];
  const readOne = async (manifestPath: string, scopeKey?: string): Promise<void> => {
    try {
      const manifest = (await fs.readJson(manifestPath)) as DuplicatesArtifactRecord['manifest'];
      records.push(scopeKey === undefined ? { manifest } : { scopeKey, manifest });
    } catch (err: unknown) {
      console.warn(
        `[duplicates] Ignoring unreadable artifact manifest ${manifestPath}: ${errorMessage(err)}`
      );
    }
  };

  // Legacy flat layout.
  const flatPath = path.join(root, MANIFEST_FILE);
  if (await fs.pathExists(flatPath)) {
    await readOne(flatPath);
  }

  // Per-scope layout: one directory per scope key.
  const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(root, dirent.name, MANIFEST_FILE);
    if (await fs.pathExists(manifestPath)) {
      await readOne(manifestPath, dirent.name);
    }
  }

  return records;
}

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
