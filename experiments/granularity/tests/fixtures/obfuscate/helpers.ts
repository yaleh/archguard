/** Shared helpers for the obfuscator test suites (not a test file). */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate, type ObfuscateResult } from '../../../lib/obfuscate/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Root of the micro fixture TS project. */
export const FIXTURE = path.join(HERE, 'proj');

/**
 * Base directory for obfuscation outputs. Lives inside the repo (not os tmp)
 * so that tsc/ts-morph can resolve @types/node by walking up to the repo root.
 */
export const TMP_BASE = path.join(HERE, '.tmp-out');

/** Create a fresh output directory under TMP_BASE. */
export function makeOutDir(prefix: string): string {
  mkdirSync(TMP_BASE, { recursive: true });
  return mkdtempSync(path.join(TMP_BASE, `${prefix}-`));
}

/** Run the obfuscator over the fixture project into outDir. */
export function runFixture(outDir: string): ObfuscateResult {
  return obfuscate({
    tsConfigFilePath: path.join(FIXTURE, 'tsconfig.json'),
    repoRoot: FIXTURE,
    entryGlobs: [path.join(FIXTURE, 'src/**/*.ts')],
    closureDir: path.join(FIXTURE, 'src'),
    outDir,
    seed: 59,
  });
}

/** Read every file in a directory tree into a (posix relative path -> text) map. */
export function readTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(path.relative(dir, p).split(path.sep).join('/'), readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}
