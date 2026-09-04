/**
 * Unit tests for Dart --sources discovery (P1-1).
 *
 * The old provider behavior used only `sources[0]` as the workspace root, which
 * broke single-file input (glob cwd = a file path) and silently dropped every
 * additional directory. These cases lock in the fixed contract: every source —
 * file or directory — contributes its .dart files.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';

import {
  discoverDartSourceFiles,
  resolveDartWorkspaceRoot,
} from '@/cli/processors/dart-source-discovery.js';

const FIXTURE_DART = path.resolve(__dirname, '../../../fixtures/dart');

describe('discoverDartSourceFiles (P1-1)', () => {
  it('returns a single file when the source is a .dart file', async () => {
    const file = path.join(FIXTURE_DART, 'sample.dart');
    const files = await discoverDartSourceFiles([file]);
    expect(files).toEqual([file]);
  });

  it('globs a directory source for all .dart files', async () => {
    const files = await discoverDartSourceFiles([FIXTURE_DART]);
    expect(files).toContain(path.join(FIXTURE_DART, 'sample.dart'));
    expect(files).toContain(path.join(FIXTURE_DART, 'sample_adjacent.dart'));
  });

  it('merges files from multiple directory sources without dropping any', async () => {
    const files = await discoverDartSourceFiles([FIXTURE_DART]);
    // sample.dart + sample_adjacent.dart + sample_test.dart
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('mixes a file and a directory source and merges both', async () => {
    const file = path.join(FIXTURE_DART, 'sample.dart');
    const files = await discoverDartSourceFiles([file, FIXTURE_DART]);
    expect(files).toContain(file);
    expect(files).toContain(path.join(FIXTURE_DART, 'sample_adjacent.dart'));
  });

  it('honors exclude patterns for directory globs', async () => {
    const files = await discoverDartSourceFiles([FIXTURE_DART], {
      exclude: ['**/sample_test.dart'],
    });
    expect(files).not.toContain(path.join(FIXTURE_DART, 'sample_test.dart'));
  });

  it('returns [] for a source containing no .dart files', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-nodart-'));
    try {
      await fs.writeFile(path.join(empty, 'readme.txt'), 'x');
      expect(await discoverDartSourceFiles([empty])).toEqual([]);
    } finally {
      await fs.remove(empty);
    }
  });
});

describe('discoverDartSourceFiles default ignore (P1-1)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-ignore-'));
    await fs.ensureDir(path.join(root, 'lib', 'generated'));
    await fs.ensureDir(path.join(root, 'lib', 'pull_to_refresh_flutter'));
    await fs.writeFile(path.join(root, 'lib', 'service.dart'), 'class S {}\n');
    await fs.writeFile(path.join(root, 'lib', 'service.g.dart'), 'class SG {}\n');
    await fs.writeFile(path.join(root, 'lib', 'model.freezed.dart'), 'class MF {}\n');
    await fs.writeFile(path.join(root, 'lib', 'generated', 'l10n.dart'), 'class L {}\n');
    await fs.writeFile(path.join(root, 'lib', 'l10n.dart'), 'class TopL {}\n');
    await fs.writeFile(path.join(root, 'lib', 'pull_to_refresh_flutter', 'x.dart'), 'class V {}\n');
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('excludes generated and vendored files by default', async () => {
    const files = await discoverDartSourceFiles([root]);
    expect(files).toContain(path.join(root, 'lib', 'service.dart'));
    expect(files).not.toContain(path.join(root, 'lib', 'service.g.dart'));
    expect(files).not.toContain(path.join(root, 'lib', 'model.freezed.dart'));
    expect(files).not.toContain(path.join(root, 'lib', 'generated', 'l10n.dart'));
    expect(files).not.toContain(path.join(root, 'lib', 'l10n.dart'));
    expect(files).not.toContain(path.join(root, 'lib', 'pull_to_refresh_flutter', 'x.dart'));
  });

  it('applies default ignore to single-file sources too', async () => {
    const files = await discoverDartSourceFiles([path.join(root, 'lib', 'service.g.dart')]);
    expect(files).toEqual([]);
  });

  it('lets user exclude extend (not replace) the defaults', async () => {
    const files = await discoverDartSourceFiles([root], { exclude: ['**/service.dart'] });
    expect(files).not.toContain(path.join(root, 'lib', 'service.dart'));
    // Defaults still apply alongside the user exclude.
    expect(files).not.toContain(path.join(root, 'lib', 'service.g.dart'));
  });
});

describe('resolveDartWorkspaceRoot (P1-2)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-wsroot-'));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('uses a directory source as the analysis root', async () => {
    await fs.ensureDir(path.join(root, 'proj', 'lib'));
    await fs.writeFile(path.join(root, 'proj', 'pubspec.yaml'), 'name: proj\n');
    await fs.writeFile(path.join(root, 'proj', 'lib', 'a.dart'), 'class A {}\n');
    expect(resolveDartWorkspaceRoot([path.join(root, 'proj')])).toBe(path.join(root, 'proj'));
  });

  it('walks up to the nearest pubspec.yaml from a single file', async () => {
    await fs.ensureDir(path.join(root, 'proj', 'lib'));
    await fs.writeFile(path.join(root, 'proj', 'pubspec.yaml'), 'name: proj\n');
    const file = path.join(root, 'proj', 'lib', 'a.dart');
    await fs.writeFile(file, 'class A {}\n');
    expect(resolveDartWorkspaceRoot([file])).toBe(path.join(root, 'proj'));
  });

  it('walks up to the sub-package pubspec in a melos monorepo', async () => {
    await fs.ensureDir(path.join(root, 'packages', 'foo', 'lib'));
    await fs.writeFile(path.join(root, 'packages', 'foo', 'pubspec.yaml'), 'name: foo\n');
    const file = path.join(root, 'packages', 'foo', 'lib', 'a.dart');
    await fs.writeFile(file, 'class A {}\n');
    expect(resolveDartWorkspaceRoot([file])).toBe(path.join(root, 'packages', 'foo'));
  });

  it('uses the common ancestor of multiple directory sources', async () => {
    await fs.ensureDir(path.join(root, 'pkg_a'));
    await fs.ensureDir(path.join(root, 'pkg_b'));
    expect(resolveDartWorkspaceRoot([path.join(root, 'pkg_a'), path.join(root, 'pkg_b')])).toBe(
      root
    );
  });

  it('uses the common ancestor for mixed file + directory sources', async () => {
    await fs.ensureDir(path.join(root, 'pkg_a', 'lib'));
    await fs.ensureDir(path.join(root, 'pkg_b'));
    await fs.writeFile(path.join(root, 'pkg_a', 'lib', 'a.dart'), 'class A {}\n');
    expect(
      resolveDartWorkspaceRoot([
        path.join(root, 'pkg_a', 'lib', 'a.dart'),
        path.join(root, 'pkg_b'),
      ])
    ).toBe(root);
  });
});
