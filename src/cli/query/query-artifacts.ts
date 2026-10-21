import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import type { QueryManifest, QueryScopeEntry, QuerySourceGroup } from './query-manifest.js';
import { buildArchIndex } from './arch-index-builder.js';
import { canonicalizeArchJson } from '../utils/canonicalize-arch-json.js';
import { hashSources, realpathOrSelf } from '../processors/arch-json-utils.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';

/**
 * Input type for scope persistence. Equivalent to QuerySourceGroup.
 */
export type QueryScopeInput = QuerySourceGroup;

export interface PersistQueryScopesOptions {
  merge?: boolean;
  preferredGlobalScopeKey?: string;
}

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
export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
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
    hasAtlasExtension: new ExtensionAccessor(archJson).hasAtlasExtension(),
    generatedAt: new Date().toISOString(),
    ...(scope.role ? { role: scope.role } : {}),
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
    // Equal width: prefer a scope previously marked primary, then fall back to key order.
    const currentPrimary = current.role === 'primary';
    if (currentPrimary !== (best.role === 'primary')) return currentPrimary ? current : best;
    return current.key.localeCompare(best.key) < 0 ? current : best;
  }).key;
}

// ---------------------------------------------------------------------------
// Identity normalization for existing manifest entries
// ---------------------------------------------------------------------------

/** A manifest entry whose identity has been re-derived from the filesystem. */
interface NormalizedEntry {
  /** Canonical manifest entry (key/sources replaced by their normalized form). */
  entry: QueryScopeEntry;
  /** The key the entry was stored under before normalization. */
  previousKey: string;
}

/**
 * Re-derive an existing manifest entry's identity from the filesystem.
 *
 * Legacy manifests accumulated duplicate identities for the same directory:
 * a relative route (`packages/quay/src`), a symlinked route
 * (`/home/...` → `/data/...`) and the current absolute route each hashed to a
 * different key because the key used to be computed from the raw string. The
 * new-scope path already realpath-normalizes before hashing (see
 * `hashSources`), but old entries were never re-normalized, so re-analysis
 * kept appending instead of replacing.
 *
 * Rules:
 * - Relative sources (written by pre-workDir-aware versions) are resolved
 *   against the project root, i.e. the parent of `.archguard`.
 * - Every source must resolve; an entry with at least one missing source is
 *   treated as stale and dropped from the manifest (see `persistQueryScopes`).
 *   We chose removal over a `stale` marker so `availableScopes` never lists a
 *   scope whose `arch.json` would depend on a vanished directory.
 * - The canonical key uses the same formula as new scopes
 *   (`hashSources(realpathSources, language)`), so a legacy entry lands on
 *   exactly the key a fresh analysis of the same directory would produce.
 */
async function normalizeManifestEntry(
  entry: QueryScopeEntry,
  projectRoot: string
): Promise<NormalizedEntry | null> {
  if (!entry.sources || entry.sources.length === 0) return null;

  const canonicalSources: string[] = [];
  for (const source of entry.sources) {
    const absolute = path.isAbsolute(source) ? source : path.resolve(projectRoot, source);
    if (!(await fs.pathExists(absolute))) return null;
    canonicalSources.push(realpathOrSelf(absolute));
  }

  const key = hashSources(canonicalSources, entry.language);
  return {
    entry: { ...entry, key, sources: canonicalSources },
    previousKey: entry.key,
  };
}

/**
 * Rank two entries that resolved to the same canonical identity.
 * Returns true when `a` should win over `b`:
 *  1. entries with a `generatedAt` beat legacy entries without one,
 *  2. the newest `generatedAt` wins,
 *  3. a directly parsed scope beats a derived one,
 *  4. the richer (more entities) scope wins,
 *  5. key order is the final deterministic tie-break.
 */
function prefersOver(a: QueryScopeEntry, b: QueryScopeEntry): boolean {
  const aTime = a.generatedAt ? Date.parse(a.generatedAt) : NaN;
  const bTime = b.generatedAt ? Date.parse(b.generatedAt) : NaN;
  const aDated = !Number.isNaN(aTime);
  const bDated = !Number.isNaN(bTime);
  if (aDated !== bDated) return aDated;
  if (aDated && bDated && aTime !== bTime) return aTime > bTime;
  if ((a.kind === 'parsed') !== (b.kind === 'parsed')) return a.kind === 'parsed';
  if (a.entityCount !== b.entityCount) return a.entityCount > b.entityCount;
  return a.key.localeCompare(b.key) < 0;
}

/**
 * A canonical identity and the on-disk directories the entries in that
 * identity used to occupy (legacy keys included).
 */
interface MergedIdentity {
  entry: QueryScopeEntry;
  /** Key whose `arch.json` belongs to the winning entry (may be a legacy key). */
  dataKey: string;
  /** Every key previously used for this identity (including the canonical one). */
  previousKeys: Set<string>;
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
 * Existing manifest entries are re-normalized on every merge pass:
 * - their `sources` are resolved to absolute realpaths (relative legacy
 *   routes against the project root, i.e. the parent of `.archguard`) and
 *   their key is recomputed with the same formula new scopes use;
 * - entries that land on the same identity collapse into one (newest /
 *   richest wins), and superseded `query/<oldKey>/` directories are removed;
 * - entries whose sources no longer exist are dropped (not marked stale), so
 *   they disappear from `availableScopes`;
 * - scopes with genuinely different source sets keep their own identity.
 *
 * @param workDir  Base output directory (defaults to `.archguard` if falsy).
 * @param scopes   Scopes to persist.
 */
export async function persistQueryScopes(
  workDir: string,
  scopes: QueryScopeInput[],
  options: PersistQueryScopesOptions = {}
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

  const existingManifest =
    options.merge !== false
      ? ((await fs
          .readJson(path.join(queryDir, 'manifest.json'))
          .catch(() => null)) as QueryManifest | null)
      : null;

  // Re-derive the identity of every existing entry from the filesystem before
  // merging. Legacy manifests registered the same directory under a relative
  // route, a symlinked route and the current absolute route; normalizing makes
  // those collapse onto the key a fresh analysis would compute, so re-analysis
  // replaces instead of accumulating.
  const projectRoot = path.dirname(path.resolve(resolvedDir));
  const identities = new Map<string, MergedIdentity>();
  for (const entry of existingManifest?.scopes ?? []) {
    const normalized = await normalizeManifestEntry(entry, projectRoot);
    if (!normalized) {
      // All-sources-missing (or empty) entries are stale: drop them so they
      // disappear from availableScopes instead of lingering forever.
      console.warn(
        `[query-artifacts] Dropping stale scope "${entry.key}" (sources no longer exist): ${entry.sources.join(', ')}`
      );
      continue;
    }
    const current = identities.get(normalized.entry.key);
    if (!current) {
      identities.set(normalized.entry.key, {
        entry: normalized.entry,
        dataKey: normalized.previousKey,
        previousKeys: new Set([normalized.previousKey]),
      });
      continue;
    }
    current.previousKeys.add(normalized.previousKey);
    if (prefersOver(normalized.entry, current.entry)) {
      current.entry = normalized.entry;
      current.dataKey = normalized.previousKey;
    }
  }

  // This run's freshly written scopes win over any existing entry with the same
  // canonical key: their ArchJSON is the current parse, not a previous one.
  for (const entry of writtenEntries) {
    const current = identities.get(entry.key);
    identities.set(entry.key, {
      entry,
      dataKey: entry.key,
      previousKeys: current?.previousKeys ?? new Set<string>(),
    });
  }

  // Materialize the canonical directory for each retained identity. Copies (not
  // moves) keep the old manifest/disk pair consistent if we crash before the
  // manifest is rewritten; the legacy dirs are removed afterwards.
  for (const [canonicalKey, identity] of identities) {
    const canonicalDir = path.join(queryDir, canonicalKey);
    const canonicalHasData = await fs.pathExists(path.join(canonicalDir, 'arch.json'));

    let dataDir: string | null = null;
    for (const candidate of [identity.dataKey, ...identity.previousKeys]) {
      if (candidate === canonicalKey) {
        if (canonicalHasData) {
          dataDir = canonicalKey;
          break;
        }
      } else if (await fs.pathExists(path.join(queryDir, candidate, 'arch.json'))) {
        dataDir = candidate;
        break;
      }
    }
    if (dataDir === null && canonicalHasData) dataDir = canonicalKey;

    if (dataDir === null) {
      // No payload anywhere: the entry cannot be queried, so do not advertise it.
      console.warn(
        `[query-artifacts] Dropping unreachable scope "${canonicalKey}" (no arch.json on disk)`
      );
      identities.delete(canonicalKey);
    } else if (dataDir !== canonicalKey) {
      await fs.remove(canonicalDir);
      await fs.copy(path.join(queryDir, dataDir), canonicalDir);
    }
  }

  const mergedEntries = new Map<string, QueryScopeEntry>();
  for (const [key, identity] of identities) {
    mergedEntries.set(key, identity.entry);
  }

  const mergedList = Array.from(mergedEntries.values()).sort((a, b) => a.key.localeCompare(b.key));
  // Without a primary scope in this run, re-select over the merged list (widest parsed scope)
  // instead of carrying over the previous key, which would otherwise go stale forever.
  const globalScopeKey =
    options.preferredGlobalScopeKey && mergedEntries.has(options.preferredGlobalScopeKey)
      ? options.preferredGlobalScopeKey
      : selectGlobalScopeKey(mergedList);

  const manifest: QueryManifest = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    globalScopeKey,
    scopes: mergedList,
  };

  // Manifest first: a crash mid-way leaves orphan directories, never dangling
  // entries (same ordering guarantee as pruneQueryScopes).
  const manifestPath = path.join(queryDir, 'manifest.json');
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Now remove every superseded legacy directory, then any unreferenced
  // 8-hex scope directory (auxiliary dirs such as `duplicates` / `git-history`
  // do not match the key shape and are left untouched).
  for (const [canonicalKey, identity] of identities) {
    for (const previousKey of identity.previousKeys) {
      if (previousKey !== canonicalKey) {
        await fs.remove(path.join(queryDir, previousKey));
      }
    }
  }
  const retainedKeys = new Set(identities.keys());
  for (const dirent of await fs.readdir(queryDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    if (/^[0-9a-f]{8}$/.test(dirent.name) && !retainedKeys.has(dirent.name)) {
      await fs.remove(path.join(queryDir, dirent.name));
    }
  }

  return writtenEntries;
}

// ---------------------------------------------------------------------------
// Prune query scopes
// ---------------------------------------------------------------------------

export interface PruneQueryScopesOptions {
  /** Exact scope keys to remove. */
  keys?: string[];
  /** Remove scopes whose generatedAt is older than this many days. */
  olderThanDays?: number;
  /** Report what would be removed without touching disk. */
  dryRun?: boolean;
  /** Clock override for tests. */
  now?: Date;
}

export interface PruneQueryScopesResult {
  removed: QueryScopeEntry[];
  remaining: QueryScopeEntry[];
  missingKeys: string[];
}

/**
 * Remove scopes from `<workDir>/query/manifest.json` and delete their
 * `query/<key>/` directories. Scopes without generatedAt are never removed by
 * age (only by explicit key).
 */
export async function pruneQueryScopes(
  workDir: string,
  options: PruneQueryScopesOptions
): Promise<PruneQueryScopesResult> {
  const queryDir = path.join(workDir || path.join(process.cwd(), '.archguard'), 'query');
  const manifestPath = path.join(queryDir, 'manifest.json');
  const manifest = (await fs.readJson(manifestPath).catch(() => null)) as QueryManifest | null;
  if (!manifest) {
    throw new Error(`No query manifest found at ${manifestPath}`);
  }

  const keys = new Set(options.keys ?? []);
  const cutoff =
    options.olderThanDays !== undefined
      ? (options.now ?? new Date()).getTime() - options.olderThanDays * 86_400_000
      : undefined;
  if (keys.size === 0 && cutoff === undefined) {
    throw new Error('Specify at least one scope key or an age threshold');
  }

  const existingKeys = new Set(manifest.scopes.map((s) => s.key));
  const missingKeys = [...keys].filter((k) => !existingKeys.has(k));

  const shouldRemove = (s: QueryScopeEntry): boolean => {
    if (keys.has(s.key)) return true;
    if (cutoff !== undefined && s.generatedAt) {
      const t = Date.parse(s.generatedAt);
      return !Number.isNaN(t) && t < cutoff;
    }
    return false;
  };
  const removed = manifest.scopes.filter(shouldRemove);
  const remaining = manifest.scopes.filter((s) => !shouldRemove(s));

  if (!options.dryRun && removed.length > 0) {
    const globalScopeKey = remaining.some((s) => s.key === manifest.globalScopeKey)
      ? manifest.globalScopeKey
      : selectGlobalScopeKey(remaining);
    // Manifest first: a crash mid-way leaves orphan dirs, never dangling entries.
    await atomicWriteFile(
      manifestPath,
      JSON.stringify({ ...manifest, globalScopeKey, scopes: remaining }, null, 2)
    );
    for (const s of removed) {
      await fs.remove(path.join(queryDir, s.key));
    }
  }

  return { removed, remaining, missingKeys };
}
