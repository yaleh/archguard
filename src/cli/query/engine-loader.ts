/**
 * Engine loader — shared loading logic for CLI commands and MCP.
 *
 * Reads manifest.json, arch.json, and arch-index.json from disk,
 * validates consistency via SHA-256 hash, and returns a QueryEngine.
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'node:child_process';
import type { QueryManifest, QueryScopeEntry, QuerySourceGroup } from './query-manifest.js';
import type { ArchIndex } from './arch-index.js';
import type { ArchJSON } from '@/types/index.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';
import { buildArchIndex } from './arch-index-builder.js';
import { atomicWriteFile } from './query-artifacts.js';
import { QueryEngine } from './query-engine.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import { RelationQueryService } from '@/core/query/relation-query-service.js';
import { mergeQueryScopes } from '../processors/query-scope-collector.js';

/**
 * Synthetic scope alias: every scope in the manifest merged into one view.
 *
 * Individual scopes keep their own source root and therefore drop imports that
 * cross into another root. `scope=merged` re-bases them onto their common
 * ancestor and folds the recovered cross-scope edges back in. A real scope
 * whose key is literally `merged` still wins (exact-key match is checked
 * first).
 */
export const MERGED_SCOPE_KEY = 'merged';

/** Label shown for the synthetic merged scope. */
export function mergedScopeLabel(scopeCount: number): string {
  return `merged (${scopeCount} scopes)`;
}

/** Where the current git HEAD sits, as read from the project that owns the snapshot. */
export interface GitHeadInfo {
  /** Short (12-char) HEAD commit sha. */
  sha: string;
  /** ISO-8601 committer date of HEAD. */
  committedAt: string;
}

export type StalenessStatus = 'fresh' | 'stale' | 'not-checked';

/**
 * Whether a query snapshot still describes the current checkout.
 *
 * `stale` means the manifest was generated before the current git HEAD commit,
 * so the readings come from an older tree; `not-checked` means git (or a
 * parseable timestamp) was unavailable and no claim is made either way.
 */
export interface StalenessInfo {
  status: StalenessStatus;
  /** ISO-8601 timestamp of the snapshot the comparison used (manifest.generatedAt). */
  generatedAt: string;
  /** Current HEAD when it could be read; absent when status is `not-checked`. */
  head?: GitHeadInfo;
  /** Actionable explanation, present for `stale` (and for `not-checked` diagnostics). */
  hint?: string;
}

/** Metadata about the scope a query was resolved against. */
export interface ResolvedScopeInfo {
  key: string;
  label: string;
  sources: string[];
  /** ISO-8601 timestamp of the manifest (analysis) that produced this scope. */
  generatedAt: string;
  /**
   * Snapshot-vs-HEAD signal. Absent on older loaders/mocks that predate the
   * check; `loadEngine` always populates it.
   */
  staleness?: StalenessInfo;
}

/**
 * Read the git HEAD of the project that owns `archDir`.
 * Returns undefined when git is unavailable or the directory is not in a repo —
 * callers must then report `not-checked`, never a silent "fresh".
 */
export function readGitHead(projectRoot: string): GitHeadInfo | undefined {
  const opts = {
    encoding: 'utf8' as const,
    stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
  };
  try {
    const sha = execFileSync(
      'git',
      ['-C', projectRoot, 'rev-parse', '--short=12', 'HEAD'],
      opts
    ).trim();
    const committedAt = execFileSync(
      'git',
      ['-C', projectRoot, 'log', '-1', '--format=%cI', 'HEAD'],
      opts
    ).trim();
    if (!sha || !committedAt) return undefined;
    return { sha, committedAt };
  } catch {
    return undefined;
  }
}

/**
 * Pure snapshot-vs-HEAD comparison. A snapshot generated before HEAD's commit
 * time is `stale` (it describes an older tree) and carries a re-run hint;
 * otherwise it is `fresh`.
 */
export function computeStaleness(
  generatedAt: string,
  head: GitHeadInfo | undefined
): StalenessInfo {
  if (!head) {
    return {
      status: 'not-checked',
      generatedAt,
      hint: 'Git HEAD unavailable (not a git work tree, git not installed, or no commits); staleness not checked.',
    };
  }
  const genMs = Date.parse(generatedAt);
  const headMs = Date.parse(head.committedAt);
  if (!Number.isFinite(genMs) || !Number.isFinite(headMs)) {
    return {
      status: 'not-checked',
      generatedAt,
      head,
      hint: 'Could not parse generatedAt or git commit time; staleness not checked.',
    };
  }
  if (genMs < headMs) {
    return {
      status: 'stale',
      generatedAt,
      head,
      hint:
        `Snapshot generatedAt ${generatedAt} predates git HEAD ${head.sha} (${head.committedAt}). ` +
        'Readings come from an older tree — re-run archguard_analyze to refresh.',
    };
  }
  return { status: 'fresh', generatedAt, head };
}

/** Compact description of a scope available in the manifest. */
export interface AvailableScope {
  key: string;
  label: string;
  entityCount: number;
  /** ISO-8601 timestamp of when this scope was last written (absent in older manifests). */
  generatedAt?: string;
}

export interface QueryContext {
  engine: QueryEngine;
  extensionAccessor: ExtensionAccessor;
  scopeEntry: QueryScopeEntry;
  relationQueryService: RelationQueryService;
  /** Resolved scope metadata (key, sources, generatedAt). */
  scopeInfo: ResolvedScopeInfo;
  /** All scopes present in the manifest. */
  availableScopes: AvailableScope[];
}

/**
 * Resolve the .archguard directory path.
 * Defaults to <cwd>/.archguard if not provided.
 */
export function resolveArchDir(archDir?: string): string {
  return archDir ?? path.join(process.cwd(), '.archguard');
}

/**
 * Read the manifest.json from the query directory.
 */
export async function readManifest(archDir: string): Promise<QueryManifest> {
  const manifestPath = path.join(archDir, 'query', 'manifest.json');
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error('No query data found. Run `archguard analyze` first.');
  }
  return fs.readJson(manifestPath) as Promise<QueryManifest>;
}

/**
 * Resolve a query scope from the manifest.
 *
 * - No scopeKey: auto-selects the widest parsed scope (most entities).
 *   This is the correct default for both CLI and MCP — "current project".
 * - scopeKey provided: matches by key or by label (case-insensitive).
 * - Throws descriptive errors when data is missing or scope is not found.
 */
export async function resolveScope(queryRoot: string, scopeKey?: string): Promise<QueryScopeEntry> {
  return (await resolveScopeWithManifest(queryRoot, scopeKey)).scopeEntry;
}

async function resolveScopeWithManifest(
  queryRoot: string,
  scopeKey?: string
): Promise<{ scopeEntry: QueryScopeEntry; manifest: QueryManifest; merged: boolean }> {
  const manifestPath = path.join(queryRoot, 'query', 'manifest.json');
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error('No query data found. Run `archguard analyze` first.');
  }
  const manifest = (await fs.readJson(manifestPath)) as QueryManifest;

  if (manifest.scopes.length === 0) {
    throw new Error('No query scopes available. Run `archguard analyze` first.');
  }

  // Explicit scope: synthetic "global" alias
  if (scopeKey === 'global') {
    if (!manifest.globalScopeKey) {
      throw new Error(
        'No global query scope configured. Run archguard_analyze to regenerate a global view, or pass scope parameter explicitly.'
      );
    }
    const globalScope = manifest.scopes.find((s) => s.key === manifest.globalScopeKey);
    if (!globalScope) {
      throw new Error(
        `Global query scope "${manifest.globalScopeKey}" is missing from manifest. Run \`archguard analyze\` to regenerate.`
      );
    }
    return { scopeEntry: globalScope, manifest, merged: false };
  }

  // A real scope key always wins over the synthetic alias below.
  if (scopeKey) {
    const exact = manifest.scopes.find((s) => s.key === scopeKey);
    if (exact) return { scopeEntry: exact, manifest, merged: false };
  }

  // Explicit scope: synthetic "merged" alias — one view over every scope.
  if (scopeKey?.toLowerCase() === MERGED_SCOPE_KEY) {
    if (manifest.scopes.length < 2) {
      throw new Error(
        `Merged view requires at least two query scopes; only "${manifest.scopes[0].key}" is available. Query it directly, or analyze additional sources.`
      );
    }
    return {
      scopeEntry: buildMergedScopeEntry(manifest),
      manifest,
      merged: true,
    };
  }

  // Explicit scope: match by key or label
  if (scopeKey) {
    const lower = scopeKey.toLowerCase();
    const found = manifest.scopes.find((s) => s.label.toLowerCase().includes(lower));
    if (!found) {
      const scopeList = manifest.scopes.map((s) => `  ${s.key}  ${s.label}`).join('\n');
      throw new Error(`Scope "${scopeKey}" not found. Available scopes:\n${scopeList}`);
    }
    return { scopeEntry: found, manifest, merged: false };
  }

  if (manifest.scopes.length === 1) {
    return { scopeEntry: manifest.scopes[0], manifest, merged: false };
  }

  if (!manifest.globalScopeKey) {
    throw new Error(
      'No global query scope configured. Available scopes exist, but none is marked global. Pass scope parameter explicitly, or rerun archguard_analyze.'
    );
  }

  const globalScope = manifest.scopes.find((s) => s.key === manifest.globalScopeKey);
  if (!globalScope) {
    throw new Error(
      `Global query scope "${manifest.globalScopeKey}" is missing from manifest. Run \`archguard analyze\` to regenerate.`
    );
  }

  return { scopeEntry: globalScope, manifest, merged: false };
}

/** Build the synthetic manifest entry used for `scope=merged`. */
function buildMergedScopeEntry(manifest: QueryManifest): QueryScopeEntry {
  const sources = [...new Set(manifest.scopes.flatMap((scope) => scope.sources))].sort();
  return {
    key: MERGED_SCOPE_KEY,
    label: mergedScopeLabel(manifest.scopes.length),
    language: manifest.scopes[0].language,
    kind: 'derived',
    sources,
    entityCount: manifest.scopes.reduce((sum, scope) => sum + scope.entityCount, 0),
    relationCount: manifest.scopes.reduce((sum, scope) => sum + scope.relationCount, 0),
    hasAtlasExtension: manifest.scopes.some((scope) => scope.hasAtlasExtension),
    generatedAt: manifest.generatedAt,
  };
}

/**
 * Load a QueryEngine from disk.
 *
 * 1. Resolves the scope from manifest.json
 * 2. Reads arch.json for that scope
 * 3. Loads or rebuilds arch-index.json (validates via SHA-256 hash)
 * 4. Returns a ready-to-use QueryEngine
 */
export async function loadEngine(archDir: string, scopeKey?: string): Promise<QueryContext> {
  const queryRoot = archDir;
  const { scopeEntry, manifest, merged } = await resolveScopeWithManifest(queryRoot, scopeKey);

  if (merged) return loadMergedEngine(queryRoot, manifest, scopeEntry);

  const archJsonPath = path.join(queryRoot, 'query', scopeEntry.key, 'arch.json');
  if (!(await fs.pathExists(archJsonPath))) {
    throw new Error(
      `arch.json missing for scope "${scopeEntry.key}". Run \`archguard analyze\` to regenerate.`
    );
  }

  // Read arch.json as raw Buffer for hash comparison
  const archJsonBuf = await fs.readFile(archJsonPath);
  const archJsonHash = crypto.createHash('sha256').update(archJsonBuf).digest('hex');
  const archJson = JSON.parse(archJsonBuf.toString()) as ArchJSON;

  // Try to load arch-index.json
  const indexPath = path.join(queryRoot, 'query', scopeEntry.key, 'arch-index.json');
  let archIndex: ArchIndex;

  if (await fs.pathExists(indexPath)) {
    try {
      const indexData = (await fs.readJson(indexPath)) as ArchIndex;
      if (indexData.version === '1.0' && indexData.archJsonHash === archJsonHash) {
        archIndex = indexData;
      } else {
        // Version or hash mismatch — rebuild
        archIndex = buildArchIndex(archJson, archJsonHash);
        await atomicWriteFile(indexPath, JSON.stringify(archIndex, null, 2));
      }
    } catch {
      // Corrupted — rebuild
      archIndex = buildArchIndex(archJson, archJsonHash);
      await atomicWriteFile(indexPath, JSON.stringify(archIndex, null, 2));
    }
  } else {
    // Missing — build and persist
    archIndex = buildArchIndex(archJson, archJsonHash);
    await atomicWriteFile(indexPath, JSON.stringify(archIndex, null, 2));
  }

  // Inject standalone test-analysis.json if present (written by --include-tests)
  await injectStandaloneTestAnalysis(queryRoot, archJson);

  const engine = new QueryEngine({ archJson, archIndex, scopeEntry });
  const extensionAccessor = new ExtensionAccessor(archJson);
  const relationQueryService = engine.relationQueryService;
  // The .archguard dir lives inside the analyzed project; its parent is the
  // git work tree whose HEAD the snapshot is compared against.
  const projectRoot = path.dirname(archDir);
  const scopeInfo: ResolvedScopeInfo = {
    key: scopeEntry.key,
    label: scopeEntry.label,
    sources: scopeEntry.sources,
    generatedAt: manifest.generatedAt,
    staleness: computeStaleness(manifest.generatedAt, readGitHead(projectRoot)),
  };
  const availableScopes: AvailableScope[] = manifest.scopes.map((s) => ({
    key: s.key,
    label: s.label,
    entityCount: s.entityCount,
    generatedAt: s.generatedAt,
  }));
  return {
    engine,
    extensionAccessor,
    scopeEntry,
    relationQueryService,
    scopeInfo,
    availableScopes,
  };
}

/**
 * Build a QueryEngine over every scope in the manifest.
 *
 * The merged ArchJSON is derived in memory — nothing is written to disk, so
 * individual-scope artifacts and their hashes stay untouched.
 */
async function loadMergedEngine(
  queryRoot: string,
  manifest: QueryManifest,
  syntheticEntry: QueryScopeEntry
): Promise<QueryContext> {
  const groups: QuerySourceGroup[] = [];
  for (const entry of manifest.scopes) {
    const archJsonPath = path.join(queryRoot, 'query', entry.key, 'arch.json');
    if (!(await fs.pathExists(archJsonPath))) continue;
    const archJson = (await fs.readJson(archJsonPath)) as ArchJSON;
    groups.push({
      key: entry.key,
      sources: entry.sources,
      archJson,
      kind: entry.kind,
      role: entry.role,
    });
  }

  const view = mergeQueryScopes(groups);
  if (!view) {
    throw new Error(
      `Merged query view requires at least two readable query scopes under ${path.join(
        queryRoot,
        'query'
      )}. Run \`archguard analyze\` to regenerate.`
    );
  }

  const archJson = view.archJson;
  await injectStandaloneTestAnalysis(queryRoot, archJson);

  // Derived in memory: the hash is only an index key, it never needs to match
  // bytes on disk.
  const archJsonHash = crypto.createHash('sha256').update(JSON.stringify(archJson)).digest('hex');
  const archIndex = buildArchIndex(archJson, archJsonHash);
  const scopeEntry: QueryScopeEntry = {
    ...syntheticEntry,
    entityCount: archJson.entities.length,
    relationCount: archJson.relations.length,
    hasAtlasExtension: new ExtensionAccessor(archJson).hasAtlasExtension(),
  };

  const engine = new QueryEngine({
    archJson,
    archIndex,
    scopeEntry,
    crossScopeEdges: view.crossScopeEdges,
  });
  const extensionAccessor = new ExtensionAccessor(archJson);
  const relationQueryService = engine.relationQueryService;
  const projectRoot = path.dirname(queryRoot);
  const scopeInfo: ResolvedScopeInfo = {
    key: scopeEntry.key,
    label: scopeEntry.label,
    sources: scopeEntry.sources,
    generatedAt: manifest.generatedAt,
    staleness: computeStaleness(manifest.generatedAt, readGitHead(projectRoot)),
  };
  const availableScopes: AvailableScope[] = [
    ...manifest.scopes.map((s) => ({
      key: s.key,
      label: s.label,
      entityCount: s.entityCount,
      generatedAt: s.generatedAt,
    })),
    {
      key: scopeEntry.key,
      label: scopeEntry.label,
      entityCount: scopeEntry.entityCount,
      generatedAt: manifest.generatedAt,
    },
  ];
  return {
    engine,
    extensionAccessor,
    scopeEntry,
    relationQueryService,
    scopeInfo,
    availableScopes,
  };
}

/**
 * Inject the standalone `test-analysis.json` (written by `--include-tests`)
 * into an in-memory ArchJSON, if present. A corrupt file is ignored.
 */
async function injectStandaloneTestAnalysis(queryRoot: string, archJson: ArchJSON): Promise<void> {
  const testAnalysisPath = path.join(queryRoot, 'query', 'test-analysis.json');
  if (!(await fs.pathExists(testAnalysisPath))) return;
  try {
    const testAnalysis = (await fs.readJson(testAnalysisPath)) as TestAnalysis;
    if (!archJson.extensions) archJson.extensions = {};
    archJson.extensions.testAnalysis = testAnalysis;
  } catch {
    // ignore corrupt file
  }
}
