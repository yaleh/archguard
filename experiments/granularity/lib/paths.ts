/**
 * Artifact directory conventions for the granularity experiment.
 *
 * All paths are anchored to this file's location so they are stable
 * regardless of the process working directory.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of `experiments/granularity/`. */
export const GRANULARITY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Obfuscated source tree output (Stage 59.2/59.3). */
export const OBF_DIR = path.join(GRANULARITY_ROOT, 'obf');

/** Root of all experiment artifacts. */
export const ARTIFACTS_DIR = path.join(GRANULARITY_ROOT, 'artifacts');

/** L0–L5 representation levels (Stage 65.1). */
export const LEVELS_DIR = path.join(ARTIFACTS_DIR, 'levels');

/** Ground truth + audit artifacts (Phase 60/64). */
export const GT_DIR = path.join(ARTIFACTS_DIR, 'gt');

/** Pre-registered predictions, committed before any LLM task (Phase 65). */
export const PREDICTIONS_DIR = path.join(ARTIFACTS_DIR, 'predictions');

/** LLM task run outputs (Phase 66). */
export const RUNS_DIR = path.join(ARTIFACTS_DIR, 'runs');

/** Embedding vectors + metadata cache (Phase 62/65). */
export const EMBEDDINGS_DIR = path.join(ARTIFACTS_DIR, 'embeddings');

const ALL_DIRS: readonly string[] = [
  OBF_DIR,
  LEVELS_DIR,
  GT_DIR,
  PREDICTIONS_DIR,
  RUNS_DIR,
  EMBEDDINGS_DIR,
];

/** Create every artifact directory. Idempotent. */
export function ensureDirs(): void {
  for (const dir of ALL_DIRS) {
    mkdirSync(dir, { recursive: true });
  }
}
