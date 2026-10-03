/**
 * Fitness relations loader — reads the relation edges that `archguard analyze`
 * persisted under `<archDir>/query/`, so the `check` command can evaluate
 * `no-dependency` rules against real edges instead of a hard-coded empty array.
 *
 * Layout (written by `persistQueryScopes`): `.archguard/query/manifest.json`
 * holds the manifest; the global scope's ArchJSON is at
 * `.archguard/query/<scope.key>/arch.json`.
 *
 * Kept in its own module so the CLI's I/O is a single mockable seam (same
 * pattern as `cluster-archjson-loader.ts`).
 *
 * @module cli/utils/fitness-relations-loader
 */

import fs from 'fs-extra';
import path from 'path';
import type { ArchJSON, Relation } from '@/types/index.js';

/**
 * Outcome of a relations load.
 *
 * `relations === null` means the edges could not be read — either no analyze
 * artifact exists, or it holds no edges at this granularity. That is NOT the
 * same as "an evaluable graph with no forbidden edge": callers must report
 * `no-dependency` rules as not-evaluated, never as pass (tri-state principle).
 */
export interface FitnessRelationsResult {
  /** Relation edges from the analyzed artifact, or `null` when unavailable. */
  relations: readonly Relation[] | null;
  /** Human-readable explanation of where the edges came from (or why not). */
  detail: string;
  /** Scope key the edges were read from, when one could be resolved. */
  scopeKey?: string;
}

interface QueryManifestShape {
  globalScopeKey?: string;
  scopes?: Array<{ key?: string }>;
}

/**
 * Load the relation edges for the global scope of an analyzed project.
 *
 * @param archDir - ArchGuard work directory (config `workDir`, e.g. `.archguard`).
 * @returns The edges plus provenance, or `relations: null` with a reason.
 */
export async function loadFitnessRelations(archDir: string): Promise<FitnessRelationsResult> {
  const queryDir = path.join(archDir, 'query');
  const manifestPath = path.join(queryDir, 'manifest.json');

  if (!(await fs.pathExists(manifestPath))) {
    return {
      relations: null,
      detail: `no query artifacts under ${queryDir} (run \`archguard analyze\`)`,
    };
  }

  let manifest: QueryManifestShape;
  try {
    manifest = (await fs.readJson(manifestPath)) as QueryManifestShape;
  } catch {
    return { relations: null, detail: `unreadable query manifest at ${manifestPath}` };
  }

  const scopeKey = manifest.globalScopeKey ?? manifest.scopes?.find((s) => s?.key)?.key;
  if (!scopeKey) {
    return { relations: null, detail: `query manifest at ${manifestPath} declares no scope` };
  }

  const archJsonPath = path.join(queryDir, scopeKey, 'arch.json');
  if (!(await fs.pathExists(archJsonPath))) {
    return {
      relations: null,
      detail: `arch.json missing for scope "${scopeKey}"`,
      scopeKey,
    };
  }

  let archJson: ArchJSON;
  try {
    archJson = (await fs.readJson(archJsonPath)) as ArchJSON;
  } catch {
    return {
      relations: null,
      detail: `unreadable arch.json for scope "${scopeKey}"`,
      scopeKey,
    };
  }

  const relations = archJson.relations ?? [];
  if (relations.length === 0) {
    return { relations: null, detail: `scope "${scopeKey}" has no relation edges`, scopeKey };
  }

  return {
    relations,
    detail: `${relations.length} relation edges from scope "${scopeKey}"`,
    scopeKey,
  };
}
