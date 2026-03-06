import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  directoryHasCppFiles,
  getCppTopLevelModules,
  detectCppProjectStructure,
  MIN_CPP_FILES_FOR_MODULE,
} from '@/cli/utils/cpp-project-structure-detector.js';

/** Build a temp dir tree. Returns the root path. */
async function makeTempTree(structure: Record<string, string | null>): Promise<string> {
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
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-'));
  });
  afterEach(async () => {
    await fs.remove(tmpDir);
  });

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
  afterEach(async () => {
    await fs.remove(root);
  });

  it('returns sorted list of dirs that contain C++ files (meeting threshold)', async () => {
    root = await makeTempTree({
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
      'tests/a.cpp': '',
      'tests/b.cpp': '',
      'tests/c.cpp': '',
      'tests/d.cpp': '',
      'tests/e.cpp': '',
      'docs/README.md': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src', 'tests']);
  });

  it('skips build/ directory', async () => {
    root = await makeTempTree({
      'build/a.cpp': '',
      'build/b.cpp': '',
      'build/c.cpp': '',
      'build/d.cpp': '',
      'build/e.cpp': '',
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips vendor/ directory', async () => {
    root = await makeTempTree({
      'vendor/a.cpp': '',
      'vendor/b.cpp': '',
      'vendor/c.cpp': '',
      'vendor/d.cpp': '',
      'vendor/e.cpp': '',
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips cmake-build-release/ (prefix match, not exact)', async () => {
    root = await makeTempTree({
      'cmake-build-release/a.cpp': '',
      'cmake-build-release/b.cpp': '',
      'cmake-build-release/c.cpp': '',
      'cmake-build-release/d.cpp': '',
      'cmake-build-release/e.cpp': '',
      'cmake-build-relwithdebinfo/a.cpp': '',
      'cmake-build-relwithdebinfo/b.cpp': '',
      'cmake-build-relwithdebinfo/c.cpp': '',
      'cmake-build-relwithdebinfo/d.cpp': '',
      'cmake-build-relwithdebinfo/e.cpp': '',
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips hidden directories (starting with dot)', async () => {
    root = await makeTempTree({
      '.cache/a.cpp': '',
      '.cache/b.cpp': '',
      '.cache/c.cpp': '',
      '.cache/d.cpp': '',
      '.cache/e.cpp': '',
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('returns [] when no dirs with cpp files exist', async () => {
    root = await makeTempTree({ 'docs/README.md': '' });
    expect(await getCppTopLevelModules(root)).toEqual([]);
  });

  it('returns sorted alphabetically', async () => {
    root = await makeTempTree({
      'zzz/a.cpp': '',
      'zzz/b.cpp': '',
      'zzz/c.cpp': '',
      'zzz/d.cpp': '',
      'zzz/e.cpp': '',
      'aaa/a.cpp': '',
      'aaa/b.cpp': '',
      'aaa/c.cpp': '',
      'aaa/d.cpp': '',
      'aaa/e.cpp': '',
      'mmm/a.cpp': '',
      'mmm/b.cpp': '',
      'mmm/c.cpp': '',
      'mmm/d.cpp': '',
      'mmm/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['aaa', 'mmm', 'zzz']);
  });
});

describe('getCppTopLevelModules min file threshold', () => {
  let root: string;
  afterEach(async () => {
    if (root) await fs.remove(root);
  });

  it('MIN_CPP_FILES_FOR_MODULE is exported and equals 5', () => {
    expect(MIN_CPP_FILES_FOR_MODULE).toBe(5);
  });

  it('excludes module with fewer than MIN_CPP_FILES_FOR_MODULE files', async () => {
    root = await makeTempTree({
      'tiny/x.cpp': '',
      'tiny/y.cpp': '', // only 2 files — below threshold
    });
    expect(await getCppTopLevelModules(root)).toEqual([]);
  });

  it('includes module with exactly MIN_CPP_FILES_FOR_MODULE files', async () => {
    // exactly 5 .cpp files → should be included
    root = await makeTempTree({
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('counts cpp files recursively across subdirectories', async () => {
    // 3 at top level + 2 in subdir = 5 total → meets threshold
    root = await makeTempTree({
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/sub/d.cpp': '',
      'src/sub/e.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('excludes module with 4 files (one below threshold)', async () => {
    root = await makeTempTree({
      'small/a.cpp': '',
      'small/b.cpp': '',
      'small/c.cpp': '',
      'small/d.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual([]);
  });
});

describe('detectCppProjectStructure', () => {
  let root: string;
  afterEach(async () => {
    await fs.remove(root);
  });

  it('returns [package, class] when no subdirs with cpp files', async () => {
    root = await makeTempTree({ 'main.cpp': '' });
    const result = await detectCppProjectStructure(root, 'myproject');
    expect(result).toHaveLength(2);
    expect(result[0].level).toBe('package');
    expect(result[1].level).toBe('class');
    expect(result[0].name).toBe('myproject/overview/package');
    expect(result[1].name).toBe('myproject/class/all-classes');
    expect(result.every((d) => d.language === 'cpp')).toBe(true);
  });

  it('returns package + class + N class/<dir> for N subdirs meeting threshold', async () => {
    root = await makeTempTree({
      'engine/a.cpp': '',
      'engine/b.cpp': '',
      'engine/c.cpp': '',
      'engine/d.cpp': '',
      'engine/e.cpp': '',
      'common/a.cpp': '',
      'common/b.cpp': '',
      'common/c.cpp': '',
      'common/d.cpp': '',
      'common/e.cpp': '',
    });
    const result = await detectCppProjectStructure(root, 'game');
    expect(result).toHaveLength(4); // package + class + class/common + class/engine
    expect(result[0]).toMatchObject({
      name: 'game/overview/package',
      level: 'package',
      language: 'cpp',
    });
    expect(result[1]).toMatchObject({
      name: 'game/class/all-classes',
      level: 'class',
      language: 'cpp',
    });
    expect(result[2]).toMatchObject({
      name: 'game/class/common',
      sources: [path.join(root, 'common')],
      level: 'class',
      language: 'cpp',
    });
    expect(result[3]).toMatchObject({
      name: 'game/class/engine',
      sources: [path.join(root, 'engine')],
      level: 'class',
      language: 'cpp',
    });
  });

  it('root (package + class) diagrams use sourceRoot as sources[0]', async () => {
    root = await makeTempTree({ 'src/main.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj');
    expect(result[0].sources[0]).toBe(root);
    expect(result[1].sources[0]).toBe(root);
  });

  it('all DiagramConfigs carry language: cpp', async () => {
    root = await makeTempTree({
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
      'lib/a.cpp': '',
      'lib/b.cpp': '',
      'lib/c.cpp': '',
      'lib/d.cpp': '',
      'lib/e.cpp': '',
    });
    const result = await detectCppProjectStructure(root, 'proj');
    expect(result.every((d) => d.language === 'cpp')).toBe(true);
  });

  it('passes format option through to all DiagramConfigs', async () => {
    root = await makeTempTree({ 'src/a.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj', { format: 'json' });
    expect(result.every((d) => d.format === 'json')).toBe(true);
  });

  it('passes exclude option through to all DiagramConfigs', async () => {
    root = await makeTempTree({ 'src/a.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj', { exclude: ['**/test*'] });
    expect(result.every((d) => d.exclude?.includes('**/test*'))).toBe(true);
  });

  it('skips subdir with only non-cpp files from per-module list', async () => {
    root = await makeTempTree({
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
      'docs/README.md': '',
    });
    const result = await detectCppProjectStructure(root, 'proj');
    const names = result.map((d) => d.name);
    expect(names).not.toContain('proj/class/docs');
    expect(names).toContain('proj/class/src');
  });

  it('skips subdir with only 2 cpp files (below threshold)', async () => {
    root = await makeTempTree({
      'src/a.cpp': '',
      'src/b.cpp': '',
      'src/c.cpp': '',
      'src/d.cpp': '',
      'src/e.cpp': '',
      'tiny/x.cpp': '',
      'tiny/y.cpp': '', // only 2 files — below threshold
    });
    const result = await detectCppProjectStructure(root, 'proj');
    const names = result.map((d) => d.name);
    expect(names).toContain('proj/class/src');
    expect(names).not.toContain('proj/class/tiny');
  });
});
