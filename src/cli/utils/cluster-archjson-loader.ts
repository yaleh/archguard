/**
 * ArchJSON loader for the cluster-boundary MCP tool (TASK-66 Phase D).
 *
 * Reads the query manifest to resolve the global scope, then loads that
 * scope's `arch.json`. Kept in its own module so the MCP tool's I/O is a
 * single mockable seam (unit tests exercise the tool with a stubbed loader).
 *
 * @module cli/utils/cluster-archjson-loader
 */

import fs from 'fs-extra';
import path from 'path';
import type { ArchJSON } from '@/types/index.js';

/**
 * Load the global-scope ArchJSON for a project root.
 *
 * Layout (written by `persistQueryScopes`): `.archguard/query/manifest.json`
 * holds the manifest; the global scope's ArchJSON is at
 * `.archguard/query/<scope.key>/arch.json`.
 *
 * @param root - Project root directory.
 * @returns The parsed ArchJSON, or null when no query data exists.
 */
export async function loadArchJsonForCluster(root: string): Promise<ArchJSON | null> {
  const queryDir = path.join(root, '.archguard', 'query');
  const manifestPath = path.join(queryDir, 'manifest.json');
  if (!(await fs.pathExists(manifestPath))) return null;

  let manifest: { globalScopeKey?: string; scopes?: Array<{ key: string }> };
  try {
    manifest = (await fs.readJson(manifestPath)) as typeof manifest;
  } catch {
    return null;
  }

  const scopeKey = manifest.globalScopeKey ?? manifest.scopes?.[0]?.key;
  if (!scopeKey) return null;

  const archJsonPath = path.join(queryDir, scopeKey, 'arch.json');
  if (!(await fs.pathExists(archJsonPath))) return null;

  try {
    return (await fs.readJson(archJsonPath)) as ArchJSON;
  } catch {
    return null;
  }
}
