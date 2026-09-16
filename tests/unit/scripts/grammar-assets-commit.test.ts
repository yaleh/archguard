/**
 * Unit tests for the transactional grammar asset commit primitive
 * (scripts/grammar-assets-commit.mjs).
 *
 * Covers the three guarantees the asset update paths depend on:
 *   1. a valid plan replaces the whole tree atomically;
 *   2. a validation failure leaves the target directory untouched;
 *   3. a commit (directory swap) failure rolls back to the original tree.
 */
import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitAssetPlan } from '../../../scripts/grammar-assets-commit.mjs';

function makeRoot(): { root: string; assetsDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'archguard-commit-'));
  const assetsDir = path.join(root, 'assets', 'grammars');
  mkdirSync(assetsDir, { recursive: true });
  return { root, assetsDir };
}

/** Recursively capture every file's contents (directories collapse to keys). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel = '') => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, r);
      else out[r] = readFileSync(full, 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

describe('commitAssetPlan', () => {
  it('commits a valid plan over the existing tree', () => {
    const { root, assetsDir } = makeRoot();
    writeFileSync(path.join(assetsDir, 'keep.txt'), 'original');

    commitAssetPlan(assetsDir, {
      'new.wasm': Buffer.from('wasm-bytes'),
      'nested/deep.json': '{}',
    });

    expect(readFileSync(path.join(assetsDir, 'keep.txt'), 'utf8')).toBe('original');
    expect(readFileSync(path.join(assetsDir, 'new.wasm'), 'utf8')).toBe('wasm-bytes');
    expect(readFileSync(path.join(assetsDir, 'nested', 'deep.json'), 'utf8')).toBe('{}');

    const leftovers = readdirSync(root).filter(
      (n) => n.includes('grammar-stage') || n.includes('grammar-backup')
    );
    expect(leftovers).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves the target unchanged when validation fails', () => {
    const { root, assetsDir } = makeRoot();
    writeFileSync(path.join(assetsDir, 'keep.txt'), 'original');
    const before = snapshot(assetsDir);

    expect(() =>
      commitAssetPlan(assetsDir, { 'new.wasm': Buffer.from('x') }, () => {
        throw new Error('staged invariant violated');
      })
    ).toThrow(/invariant violated/);

    expect(snapshot(assetsDir)).toEqual(before);
    expect(existsSync(path.join(assetsDir, 'new.wasm'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('rolls back to the original tree when the commit swap fails', () => {
    const { root, assetsDir } = makeRoot();
    writeFileSync(path.join(assetsDir, 'keep.txt'), 'original');
    const before = snapshot(assetsDir);

    // Fail the second rename (staging -> assetsDir) to simulate a commit error;
    // the first (assetsDir -> backup) and the rollback (backup -> assetsDir)
    // must still use the real rename so the rollback can be observed.
    let call = 0;
    const rename = (from: string, to: string): void => {
      call += 1;
      if (call === 2) throw new Error('injected commit failure');
      renameSync(from, to);
    };

    expect(() =>
      commitAssetPlan(assetsDir, { 'new.wasm': Buffer.from('x') }, undefined, { rename })
    ).toThrow(/injected commit failure/);

    expect(snapshot(assetsDir)).toEqual(before);
    expect(existsSync(path.join(assetsDir, 'keep.txt'))).toBe(true);
    expect(existsSync(path.join(assetsDir, 'new.wasm'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
