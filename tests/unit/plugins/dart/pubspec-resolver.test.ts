import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { buildPackageMap, resolveImportUri } from '@/plugins/dart/pubspec-resolver.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.remove(dir);
  }
  tmpDirs.length = 0;
});

async function makeWorkspace(structure: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-dart-pubspec-'));
  tmpDirs.push(root);
  for (const [file, content] of Object.entries(structure)) {
    const target = path.join(root, file);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content);
  }
  return root;
}

describe('buildPackageMap', () => {
  it('maps each pubspec name to its containing directory', async () => {
    const root = await makeWorkspace({
      'pubspec.yaml': 'name: root_app\nenvironment:\n  sdk: ^3.0.0\n',
      'packages/foo/pubspec.yaml': 'name: foo\n',
      'packages/bar/pubspec.yaml': 'name: bar\n',
    });

    const map = await buildPackageMap(root);
    expect(map.get('root_app')).toBe(root);
    expect(map.get('foo')).toBe(path.join(root, 'packages/foo'));
    expect(map.get('bar')).toBe(path.join(root, 'packages/bar'));
  });

  it('ignores pubspec files under build/.dart_tool/coverage', async () => {
    const root = await makeWorkspace({
      'pubspec.yaml': 'name: real_app\n',
      '.dart_tool/package_config.json': '{}',
      'build/foo/pubspec.yaml': 'name: generated_foo\n',
      'coverage/bar/pubspec.yaml': 'name: coverage_bar\n',
    });

    const map = await buildPackageMap(root);
    expect(map.has('real_app')).toBe(true);
    expect(map.has('generated_foo')).toBe(false);
    expect(map.has('coverage_bar')).toBe(false);
  });
});

describe('resolveImportUri', () => {
  const map = new Map([
    ['foo', '/ws/packages/foo'],
    ['bar', '/ws/packages/bar'],
  ]);

  it('resolves package: URIs for known packages under lib/', () => {
    expect(
      resolveImportUri(map, 'package:foo/common/product.dart', '/ws/packages/foo/test/a_test.dart')
    ).toBe('/ws/packages/foo/lib/common/product.dart');
  });

  it('returns null for dart: core libraries', () => {
    expect(resolveImportUri(map, 'dart:core', '/ws/packages/foo/test/a_test.dart')).toBeNull();
  });

  it('returns null for unknown package: (external dependencies)', () => {
    expect(
      resolveImportUri(map, 'package:flutter/widgets.dart', '/ws/packages/foo/test/a_test.dart')
    ).toBeNull();
    expect(
      resolveImportUri(map, 'package:mocktail/mocktail.dart', '/ws/packages/foo/test/a_test.dart')
    ).toBeNull();
  });

  it('returns null for a bare package: without a path', () => {
    expect(resolveImportUri(map, 'package:foo', '/ws/packages/foo/test/a_test.dart')).toBeNull();
  });

  it('resolves relative imports against the test file directory', () => {
    expect(resolveImportUri(map, '../lib/foo.dart', '/ws/packages/foo/test/a_test.dart')).toBe(
      '/ws/packages/foo/lib/foo.dart'
    );
    expect(resolveImportUri(map, './helper.dart', '/ws/packages/foo/test/a_test.dart')).toBe(
      '/ws/packages/foo/test/helper.dart'
    );
  });
});
