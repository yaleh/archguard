/**
 * Transactional commit of the grammar asset tree.
 *
 * Both update paths — `fetch-grammar-wasms.mjs --update` and
 * `build-dart-grammar-wasm.mjs --update` — write a partially overlapping set of
 * files under `assets/grammars/` (WASM, LICENSE, `checksums.json`,
 * `provenance.json`). Writing those files one-by-one leaves a mixed
 * (new/old) directory if any step fails. This module commits the whole set as
 * one unit:
 *
 *   1. stage    — copy the current tree into a unique sibling directory
 *   2. build    — apply the caller's plan (relative path → content) into stage
 *   3. validate — run the caller's invariant checks against the staged tree
 *   4. commit   — rename current → backup, stage → current (same filesystem)
 *   5. rollback — on commit failure, restore backup; on success, delete backup
 *
 * Staging and backup live inside `assetsDir`'s parent directory so `rename()`
 * stays atomic (same filesystem) and a crashed/failed commit never leaves a
 * partially updated tree behind.
 */

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A path that does not exist yet, unique per process + invocation. */
function uniquePath(parent, prefix) {
  return path.join(
    parent,
    `${prefix}${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
  );
}

/**
 * Replace `assetsDir` with the tree produced by applying `plan` over a full
 * copy of its current contents, only after `validate` accepts the staged tree.
 *
 * @param {string} assetsDir  target directory (e.g. assets/grammars)
 * @param {Record<string, Buffer | string>} plan  relative path → file content
 * @param {(stagedDir: string) => void} [validate]  throws on any invariant violation
 * @param {{ rename?: typeof renameSync }} [deps]  injectable for fault-injection tests
 */
export function commitAssetPlan(assetsDir, plan, validate, deps = {}) {
  const rename = deps.rename ?? renameSync;
  const parent = path.dirname(assetsDir);
  mkdirSync(parent, { recursive: true });

  const staging = uniquePath(parent, '.grammar-stage-');
  const backup = uniquePath(parent, '.grammar-backup-');

  // Seed staging with the current tree so `plan` only describes changed files.
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, staging, { recursive: true });
  } else {
    mkdirSync(staging, { recursive: true });
  }

  try {
    // Build the complete staged tree.
    for (const [relPath, content] of Object.entries(plan)) {
      const target = path.join(staging, relPath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    // Validate the staged tree before swapping it into place.
    if (validate) validate(staging);

    // Commit via directory swap; the old tree stays as backup until the swap
    // succeeds, so a failed commit restores the original intact.
    if (existsSync(assetsDir)) {
      rename(assetsDir, backup);
    }
    try {
      rename(staging, assetsDir);
    } catch (commitError) {
      if (existsSync(backup)) rename(backup, assetsDir);
      throw commitError;
    }
    rmSync(backup, { recursive: true, force: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
