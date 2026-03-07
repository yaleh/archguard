/**
 * Engine loader — shared loading logic for CLI commands and MCP.
 *
 * Reads manifest.json, arch.json, and arch-index.json from disk,
 * validates consistency via SHA-256 hash, and returns a QueryEngine.
 */

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import type { QueryManifest, QueryScopeEntry } from './query-manifest.js';
import type { ArchIndex } from './arch-index.js';
import { buildArchIndex } from './arch-index-builder.js';
import { atomicWriteFile } from './query-artifacts.js';
import { QueryEngine } from './query-engine.js';

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
export async function resolveScope(
  queryRoot: string,
  scopeKey?: string,
): Promise<QueryScopeEntry> {
  const manifestPath = path.join(queryRoot, 'query', 'manifest.json');
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error('No query data found. Run `archguard analyze` first.');
  }
  const manifest: QueryManifest = await fs.readJson(manifestPath);

  if (manifest.scopes.length === 0) {
    throw new Error('No query scopes available. Run `archguard analyze` first.');
  }

  // Explicit scope: synthetic "global" alias
  if (scopeKey === 'global') {
    if (!manifest.globalScopeKey) {
      throw new Error(
        'No global query scope configured. Run `archguard analyze` to regenerate a global view or use `--scope`.',
      );
    }
    const globalScope = manifest.scopes.find(s => s.key === manifest.globalScopeKey);
    if (!globalScope) {
      throw new Error(
        `Global query scope "${manifest.globalScopeKey}" is missing from manifest. Run \`archguard analyze\` to regenerate.`,
      );
    }
    return globalScope;
  }

  // Explicit scope: match by key or label
  if (scopeKey) {
    const lower = scopeKey.toLowerCase();
    const found =
      manifest.scopes.find(s => s.key === scopeKey) ??
      manifest.scopes.find(s => s.label.toLowerCase().includes(lower));
    if (!found) {
      const scopeList = manifest.scopes
        .map(s => `  ${s.key}  ${s.label}`)
        .join('\n');
      throw new Error(
        `Scope "${scopeKey}" not found. Available scopes:\n${scopeList}`,
      );
    }
    return found;
  }

  if (manifest.scopes.length === 1) {
    return manifest.scopes[0];
  }

  if (!manifest.globalScopeKey) {
    throw new Error(
      'No global query scope configured. Available scopes exist, but none is marked global. Use `--scope` or rerun `archguard analyze`.',
    );
  }

  const globalScope = manifest.scopes.find(s => s.key === manifest.globalScopeKey);
  if (!globalScope) {
    throw new Error(
      `Global query scope "${manifest.globalScopeKey}" is missing from manifest. Run \`archguard analyze\` to regenerate.`,
    );
  }

  return globalScope;
}

/**
 * Load a QueryEngine from disk.
 *
 * 1. Resolves the scope from manifest.json
 * 2. Reads arch.json for that scope
 * 3. Loads or rebuilds arch-index.json (validates via SHA-256 hash)
 * 4. Returns a ready-to-use QueryEngine
 */
export async function loadEngine(
  archDir: string,
  scopeKey?: string,
): Promise<QueryEngine> {
  const queryRoot = archDir;
  const scopeEntry = await resolveScope(queryRoot, scopeKey);

  const archJsonPath = path.join(
    queryRoot,
    'query',
    scopeEntry.key,
    'arch.json',
  );
  if (!(await fs.pathExists(archJsonPath))) {
    throw new Error(
      `arch.json missing for scope "${scopeEntry.key}". Run \`archguard analyze\` to regenerate.`,
    );
  }

  // Read arch.json as raw Buffer for hash comparison
  const archJsonBuf = await fs.readFile(archJsonPath);
  const archJsonHash = crypto
    .createHash('sha256')
    .update(archJsonBuf)
    .digest('hex');
  const archJson = JSON.parse(archJsonBuf.toString());

  // Try to load arch-index.json
  const indexPath = path.join(
    queryRoot,
    'query',
    scopeEntry.key,
    'arch-index.json',
  );
  let archIndex: ArchIndex;

  if (await fs.pathExists(indexPath)) {
    try {
      const indexData: ArchIndex = await fs.readJson(indexPath);
      if (
        indexData.version === '1.0' &&
        indexData.archJsonHash === archJsonHash
      ) {
        archIndex = indexData;
      } else {
        // Version or hash mismatch — rebuild
        archIndex = buildArchIndex(archJson, archJsonHash);
        await atomicWriteFile(
          indexPath,
          JSON.stringify(archIndex, null, 2),
        );
      }
    } catch {
      // Corrupted — rebuild
      archIndex = buildArchIndex(archJson, archJsonHash);
      await atomicWriteFile(
        indexPath,
        JSON.stringify(archIndex, null, 2),
      );
    }
  } else {
    // Missing — build and persist
    archIndex = buildArchIndex(archJson, archJsonHash);
    await atomicWriteFile(indexPath, JSON.stringify(archIndex, null, 2));
  }

  return new QueryEngine({ archJson, archIndex, scopeEntry });
}
