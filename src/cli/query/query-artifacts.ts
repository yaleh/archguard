import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import type { QueryManifest, QueryScopeEntry, QuerySourceGroup } from './query-manifest.js';
import { buildArchIndex } from './arch-index-builder.js';
import { canonicalizeArchJson } from '../utils/canonicalize-arch-json.js';

/**
 * Input type for scope persistence. Equivalent to QuerySourceGroup.
 */
export type QueryScopeInput = QuerySourceGroup;

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Atomically write data to filePath.
 *
 * Strategy: write to a sibling temp file (`<filePath>.tmp.<random8>`),
 * then `fs.rename()` which is atomic on POSIX filesystems when source
 * and destination are on the same volume.
 *
 * The random suffix prevents collisions when multiple processes run
 * concurrently against the same output directory.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  const suffix = crypto.randomUUID().slice(0, 8);
  const tmpPath = `${filePath}.tmp.${suffix}`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Label generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable label from source paths and language.
 * Uses `path.basename()` of the first source entry.
 *
 * Example: `['/home/user/project/src']`, `'typescript'` → `'src (typescript)'`
 */
export function generateScopeLabel(sources: string[], language: string): string {
  const base = sources.length > 0 ? path.basename(sources[0]) : 'unknown';
  return `${base} (${language})`;
}

// ---------------------------------------------------------------------------
// Manifest entry builder
// ---------------------------------------------------------------------------

/**
 * Build a single `QueryScopeEntry` from a `QueryScopeInput`.
 *
 * Extracts entity/relation counts from the ArchJSON and checks for
 * the Go Atlas extension.
 */
export function buildManifestEntry(scope: QueryScopeInput): QueryScopeEntry {
  const { archJson } = scope;
  return {
    key: scope.key,
    label: generateScopeLabel(scope.sources, archJson.language),
    language: archJson.language,
    kind: scope.kind,
    sources: scope.sources,
    entityCount: archJson.entities.length,
    relationCount: archJson.relations.length,
    hasAtlasExtension: !!archJson.extensions?.goAtlas,
  };
}

function selectGlobalScopeKey(entries: QueryScopeEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0].key;

  const parsed = entries.filter((entry) => entry.kind === 'parsed');
  const candidates = parsed.length > 0 ? parsed : entries;
  return candidates.reduce((best, current) => {
    if (current.entityCount !== best.entityCount) {
      return current.entityCount > best.entityCount ? current : best;
    }
    return current.key.localeCompare(best.key) < 0 ? current : best;
  }).key;
}

// ---------------------------------------------------------------------------
// Persist query scopes + manifest
// ---------------------------------------------------------------------------

/**
 * Persist all query scopes and generate a manifest.
 *
 * Layout under `<workDir>/query/`:
 * ```
 * query/
 *   manifest.json          ← QueryManifest
 *   <scope.key>/
 *     arch.json             ← scope.archJson
 * ```
 *
 * All writes use the atomic tmp+rename pattern. If a single scope
 * fails to write, a warning is logged and the remaining scopes are
 * still processed. The manifest only contains entries for successfully
 * written scopes.
 *
 * @param workDir  Base output directory (defaults to `.archguard` if falsy).
 * @param scopes   Scopes to persist.
 */
export async function persistQueryScopes(
  workDir: string,
  scopes: QueryScopeInput[],
): Promise<QueryScopeEntry[]> {
  const resolvedDir = workDir || path.join(process.cwd(), '.archguard');
  const queryDir = path.join(resolvedDir, 'query');
  await fs.ensureDir(queryDir);

  const writtenEntries: QueryScopeEntry[] = [];

  for (const scope of scopes) {
    try {
      const scopeDir = path.join(queryDir, scope.key);
      await fs.ensureDir(scopeDir);

      const archJsonPath = path.join(scopeDir, 'arch.json');
      const canonicalArchJson = canonicalizeArchJson(scope.archJson);
      const buf = Buffer.from(JSON.stringify(canonicalArchJson, null, 2));
      await atomicWriteFile(archJsonPath, buf);

      // Build and persist arch-index.json (hash based on disk bytes)
      const archJsonHash = crypto.createHash('sha256').update(buf).digest('hex');
      const archIndex = buildArchIndex(canonicalArchJson, archJsonHash);
      const indexPath = path.join(scopeDir, 'arch-index.json');
      await atomicWriteFile(indexPath, JSON.stringify(archIndex, null, 2));

      writtenEntries.push(buildManifestEntry({ ...scope, archJson: canonicalArchJson }));
    } catch (err) {
      // Log warning but continue with remaining scopes
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[query-artifacts] Failed to write scope "${scope.key}": ${message}`);
    }
  }

  const manifest: QueryManifest = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    globalScopeKey: selectGlobalScopeKey(writtenEntries),
    scopes: [...writtenEntries].sort((a, b) => a.key.localeCompare(b.key)),
  };

  const manifestPath = path.join(queryDir, 'manifest.json');
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2));
  return writtenEntries;
}
