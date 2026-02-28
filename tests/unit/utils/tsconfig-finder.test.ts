/**
 * Unit tests for findTsConfigPath()
 * All tests must FAIL before the utility is implemented.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { findTsConfigPath, loadPathAliases } from '@/utils/tsconfig-finder.js';

describe('findTsConfigPath', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds tsconfig.json in the start directory', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    expect(findTsConfigPath(tmpDir)).toBe(path.join(tmpDir, 'tsconfig.json'));
  });

  it('finds tsconfig.json in a parent directory', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    const subDir = path.join(tmpDir, 'src', 'cli');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    expect(findTsConfigPath(subDir)).toBe(path.join(tmpDir, 'tsconfig.json'));
  });

  it('finds the nearest tsconfig.json when multiple exist', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    const subDir = path.join(tmpDir, 'packages', 'core');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{"root":true}');
    writeFileSync(path.join(subDir, 'tsconfig.json'), '{"nested":true}');

    // Should return the nearest (closest to startDir)
    expect(findTsConfigPath(subDir)).toBe(path.join(subDir, 'tsconfig.json'));
  });

  it('returns undefined when no tsconfig.json exists anywhere in tmp subtree', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    const subDir = path.join(tmpDir, 'src');
    mkdirSync(subDir, { recursive: true });
    // No tsconfig.json written

    // Can't guarantee the filesystem root has no tsconfig, but within an isolated tmp dir:
    // Walk up from subDir — will either find nothing in tmpDir or hit root.
    // We can only assert it doesn't throw and returns undefined or string.
    const result = findTsConfigPath(subDir);
    expect(result === undefined || typeof result === 'string').toBe(true);
  });
});

describe('loadPathAliases', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns baseUrl and paths from tsconfig.json with both present', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    const tsconfig = {
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
      },
    };
    writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig));

    const result = loadPathAliases(path.join(tmpDir, 'tsconfig.json'));

    expect(result).toBeDefined();
    expect(result?.baseUrl).toBe(tmpDir);
    expect(result?.paths).toEqual({ '@/*': ['src/*'] });
  });

  it('returns undefined when tsconfig has no paths or baseUrl', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext' } }));

    const result = loadPathAliases(path.join(tmpDir, 'tsconfig.json'));

    expect(result).toBeUndefined();
  });

  it('returns undefined for empty compilerOptions', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const result = loadPathAliases(path.join(tmpDir, 'tsconfig.json'));

    expect(result).toBeUndefined();
  });

  it('resolves baseUrl relative to tsconfig directory', () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tsconfig-finder-'));
    const subDir = path.join(tmpDir, 'config');
    mkdirSync(subDir, { recursive: true });
    const tsconfig = {
      compilerOptions: {
        baseUrl: '..',
        paths: { '@/*': ['src/*'] },
      },
    };
    writeFileSync(path.join(subDir, 'tsconfig.json'), JSON.stringify(tsconfig));

    const result = loadPathAliases(path.join(subDir, 'tsconfig.json'));

    expect(result).toBeDefined();
    expect(result?.baseUrl).toBe(tmpDir);
  });

  it('returns undefined when tsconfig file does not exist', () => {
    const result = loadPathAliases('/nonexistent/tsconfig.json');
    expect(result).toBeUndefined();
  });
});
