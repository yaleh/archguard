/**
 * Persistence layer for duplicate-detection results.
 *
 * Results are filed per query scope:
 *
 *   .archguard/query/duplicates/
 *     index.json                 — lists every persisted scope
 *     <scopeKey>/manifest.json   — that scope's scan manifest
 *     <scopeKey>/groups.json     — that scope's duplicate groups
 *
 * The old flat layout (`duplicates/manifest.json` + `groups.json`) is never
 * written again: storing every scope in one fixed pair of files made two scopes
 * silently overwrite each other.
 */

import fs from 'fs-extra';
import path from 'path';
import type { DuplicateAnalysis, DuplicateGroup, DuplicateManifest } from './types.js';
import { errorMessage } from '@/utils/error-message.js';

const DUPLICATES_SUBDIR = 'query/duplicates';
const MANIFEST_FILE = 'manifest.json';
const GROUPS_FILE = 'groups.json';
const INDEX_FILE = 'index.json';

/** One persisted scope, as listed in `duplicates/index.json`. */
export interface DuplicateIndexEntry {
  scopeKey: string;
  label: string;
  sources: string[];
  generatedAt: string;
}

/** Top-level index persisted to `duplicates/index.json`. */
export interface DuplicateIndex {
  version: '1';
  entries: DuplicateIndexEntry[];
}

function duplicatesDir(archDir: string): string {
  return path.join(archDir, DUPLICATES_SUBDIR);
}

/**
 * Persist one scope's duplicate-detection results and refresh the top-level index.
 *
 * The manifest must carry `scopeKey` (the scope-aware callers set it). Each
 * scope gets its own directory, so persisting a second scope can never overwrite
 * the first. The index is rebuilt from the on-disk directories, which keeps
 * `entries` in exact one-to-one correspondence with the `<scopeKey>/` folders.
 */
export async function persistDuplicates(
  archDir: string,
  analysis: DuplicateAnalysis
): Promise<void> {
  const scopeKey = analysis.manifest.scopeKey;
  if (!scopeKey) {
    throw new Error(
      'Cannot persist duplicate results: the manifest has no scopeKey. ' +
        'Pass a scope to detectDuplicates so the key can be derived via hashSources.'
    );
  }
  const root = duplicatesDir(archDir);
  const dir = path.join(root, scopeKey);
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, MANIFEST_FILE), analysis.manifest, { spaces: 2 });
  await fs.writeJson(path.join(dir, GROUPS_FILE), analysis.groups, { spaces: 2 });
  await writeIndex(root);
}

/** Rebuild `index.json` from the on-disk `<scopeKey>/manifest.json` files. */
async function writeIndex(root: string): Promise<void> {
  const index: DuplicateIndex = { version: '1', entries: await readIndexEntries(root) };
  await fs.writeJson(path.join(root, INDEX_FILE), index, { spaces: 2 });
}

/**
 * List the persisted scopes by reading their manifests.
 *
 * Directories without a readable manifest are skipped rather than failing the
 * rebuild: the index is a derived projection, and one broken sibling scope must
 * not block persisting a healthy one. Sorted by scopeKey for determinism.
 */
async function readIndexEntries(root: string): Promise<DuplicateIndexEntry[]> {
  if (!(await fs.pathExists(root))) return [];
  const entries: DuplicateIndexEntry[] = [];
  for (const dirent of await fs.readdir(root, { withFileTypes: true })) {
    // Directories only: this also skips the legacy flat manifest.json / groups.json.
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(root, dirent.name, MANIFEST_FILE);
    if (!(await fs.pathExists(manifestPath))) continue;
    try {
      const manifest = (await fs.readJson(manifestPath)) as DuplicateManifest;
      entries.push({
        scopeKey: manifest.scopeKey ?? dirent.name,
        label: manifest.label ?? '',
        sources: manifest.sources ?? [],
        generatedAt: manifest.generatedAt ?? '',
      });
    } catch {
      // Malformed manifest: not a loadable scope; leave it out of the index.
    }
  }
  return entries.sort((a, b) => a.scopeKey.localeCompare(b.scopeKey));
}

/**
 * Load one scope's persisted duplicate results.
 *
 * Contract:
 * - `scopeKey` given: reads `duplicates/<scopeKey>/`; returns null when absent.
 * - `scopeKey` omitted: reads the only persisted scope. Returns null when none
 *   is persisted; throws a descriptive error when several are (the caller must
 *   pick one instead of silently getting an arbitrary scope).
 *
 * Throws on malformed JSON in a manifest/groups file.
 */
export async function loadDuplicates(
  archDir: string,
  scopeKey?: string
): Promise<DuplicateAnalysis | null> {
  const root = duplicatesDir(archDir);
  const resolvedKey = scopeKey ?? (await singleScopeKey(root));
  if (!resolvedKey) return null;

  const dir = path.join(root, resolvedKey);
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

/** The persisted scope key when exactly one exists; undefined when none; throws when several. */
async function singleScopeKey(root: string): Promise<string | undefined> {
  const entries = await readIndexEntries(root);
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0].scopeKey;
  throw new Error(
    `Multiple duplicate scopes are persisted (${entries.map((e) => e.scopeKey).join(', ')}); ` +
      'pass a scopeKey to loadDuplicates.'
  );
}
