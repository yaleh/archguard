import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  directoryHasCppFiles,
  getCppTopLevelModules,
  detectCppProjectStructure,
} from '@/cli/utils/cpp-project-structure-detector.js';

/** Build a temp dir tree. Returns the root path. */
async function makeTempTree(
  structure: Record<string, string | null>
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-cpp-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(root, rel);
    await fs.ensureDir(path.dirname(abs));
    if (content !== null) await fs.writeFile(abs, content ?? '');
  }
  return root;
}

describe('directoryHasCppFiles', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-')); });
  afterEach(async () => { await fs.remove(tmpDir); });

  it('returns true when directory contains a .cpp file', async () => {
    await fs.writeFile(path.join(tmpDir, 'main.cpp'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(true);
  });

  it('returns true when directory contains a .h file', async () => {
    await fs.writeFile(path.join(tmpDir, 'foo.h'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(true);
  });

  it('returns true when cpp file is in a subdirectory (recursive)', async () => {
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'foo.cpp'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(true);
  });

  it('returns false when directory contains only .md files', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    expect(await directoryHasCppFiles(tmpDir)).toBe(false);
  });

  it('returns false for a non-existent path', async () => {
    expect(await directoryHasCppFiles(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('getCppTopLevelModules', () => {
  let root: string;
  afterEach(async () => { await fs.remove(root); });

  it('returns sorted list of dirs that contain C++ files', async () => {
    root = await makeTempTree({
      'src/engine.cpp': '',
      'tests/test.cpp': '',
      'docs/README.md': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src', 'tests']);
  });

  it('skips build/ directory', async () => {
    root = await makeTempTree({ 'build/output.cpp': '', 'src/main.cpp': '' });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips vendor/ directory', async () => {
    root = await makeTempTree({ 'vendor/lib.cpp': '', 'src/main.cpp': '' });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips cmake-build-release/ (prefix match, not exact)', async () => {
    root = await makeTempTree({
      'cmake-build-release/foo.cpp': '',
      'cmake-build-relwithdebinfo/bar.cpp': '',
      'src/main.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips hidden directories (starting with dot)', async () => {
    root = await makeTempTree({ '.cache/foo.cpp': '', 'src/main.cpp': '' });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('returns [] when no dirs with cpp files exist', async () => {
    root = await makeTempTree({ 'docs/README.md': '' });
    expect(await getCppTopLevelModules(root)).toEqual([]);
  });

  it('returns sorted alphabetically', async () => {
    root = await makeTempTree({
      'zzz/a.cpp': '', 'aaa/b.cpp': '', 'mmm/c.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['aaa', 'mmm', 'zzz']);
  });
});

describe('detectCppProjectStructure', () => {
  let root: string;
  afterEach(async () => { await fs.remove(root); });

  it('returns [package, class] when no subdirs with cpp files', async () => {
    root = await makeTempTree({ 'main.cpp': '' });
    const result = await detectCppProjectStructure(root, 'myproject');
    expect(result).toHaveLength(2);
    expect(result[0].level).toBe('package');
    expect(result[1].level).toBe('class');
    expect(result.every(d => d.language === 'cpp')).toBe(true);
  });

  it('returns package + class + N class/<dir> for N subdirs', async () => {
    root = await makeTempTree({
      'engine/renderer.cpp': '',
      'common/utils.cpp': '',
    });
    const result = await detectCppProjectStructure(root, 'game');
    expect(result).toHaveLength(4); // package + class + class/common + class/engine
    expect(result[0]).toMatchObject({ name: 'game/package', level: 'package', language: 'cpp' });
    expect(result[1]).toMatchObject({ name: 'game/class',   level: 'class',   language: 'cpp' });
    expect(result[2]).toMatchObject({ name: 'game/class/common', sources: [path.join(root, 'common')], level: 'class', language: 'cpp' });
    expect(result[3]).toMatchObject({ name: 'game/class/engine', sources: [path.join(root, 'engine')], level: 'class', language: 'cpp' });
  });

  it('root (package + class) diagrams use sourceRoot as sources[0]', async () => {
    root = await makeTempTree({ 'src/main.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj');
    expect(result[0].sources[0]).toBe(root);
    expect(result[1].sources[0]).toBe(root);
  });

  it('all DiagramConfigs carry language: cpp', async () => {
    root = await makeTempTree({ 'src/a.cpp': '', 'lib/b.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj');
    expect(result.every(d => d.language === 'cpp')).toBe(true);
  });

  it('passes format option through to all DiagramConfigs', async () => {
    root = await makeTempTree({ 'src/a.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj', { format: 'json' });
    expect(result.every(d => d.format === 'json')).toBe(true);
  });

  it('passes exclude option through to all DiagramConfigs', async () => {
    root = await makeTempTree({ 'src/a.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj', { exclude: ['**/test*'] });
    expect(result.every(d => d.exclude?.includes('**/test*'))).toBe(true);
  });

  it('skips subdir with only non-cpp files from per-module list', async () => {
    root = await makeTempTree({
      'src/main.cpp': '',
      'docs/README.md': '',
    });
    const result = await detectCppProjectStructure(root, 'proj');
    const names = result.map(d => d.name);
    expect(names).not.toContain('proj/class/docs');
    expect(names).toContain('proj/class/src');
  });
});
