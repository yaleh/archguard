/**
 * Unit tests for scripts/check-runtime-deps.ts (TASK-30).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  packageNameFromSpecifier,
  findBareSpecifiers,
  checkRuntimeDeps,
} from '../../../scripts/check-runtime-deps.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-runtime-deps-test-'));
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

describe('packageNameFromSpecifier', () => {
  it('returns null for relative and absolute specifiers', () => {
    expect(packageNameFromSpecifier('./foo.js')).toBeNull();
    expect(packageNameFromSpecifier('../bar.js')).toBeNull();
    expect(packageNameFromSpecifier('/abs/path.js')).toBeNull();
  });

  it('returns null for Node builtins, bare and node: prefixed', () => {
    expect(packageNameFromSpecifier('fs')).toBeNull();
    expect(packageNameFromSpecifier('node:fs')).toBeNull();
    expect(packageNameFromSpecifier('node:module')).toBeNull();
  });

  it('resolves a plain package specifier', () => {
    expect(packageNameFromSpecifier('typescript')).toBe('typescript');
  });

  it('resolves a subpath specifier to its top-level package', () => {
    expect(packageNameFromSpecifier('lodash/debounce')).toBe('lodash');
  });

  it('resolves a scoped package and scoped subpath to the scope/name pair', () => {
    expect(packageNameFromSpecifier('@babel/core')).toBe('@babel/core');
    expect(packageNameFromSpecifier('@babel/core/lib/foo')).toBe('@babel/core');
  });
});

describe('findBareSpecifiers', () => {
  it('finds ESM import, CJS require, and dynamic import specifiers', () => {
    const source = `
      import ts from 'typescript';
      const x = require("zod");
      const y = await import('lodash');
      import './relative.js';
    `;
    const found = findBareSpecifiers(source)
      .map((f) => f.specifier)
      .sort();
    expect(found).toEqual(['lodash', 'typescript', 'zod']);
  });

  it('reports the correct line number', () => {
    const source = `line1\nline2\nimport ts from 'typescript';\n`;
    const found = findBareSpecifiers(source);
    expect(found).toEqual([{ specifier: 'typescript', line: 3 }]);
  });
});

describe('checkRuntimeDeps', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reproduces the TASK-30 regression: a package only in devDependencies used at runtime is flagged', () => {
    writeFile(dir, 'dist/utils/tool.js', `import ts from 'typescript';\n`);
    const pkgPath = writeFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { zod: '^4.0.0' }, devDependencies: { typescript: '^5.3.0' } })
    );

    const violations = checkRuntimeDeps(path.join(dir, 'dist'), pkgPath);
    expect(violations).toEqual([
      expect.objectContaining({ packageName: 'typescript', specifier: 'typescript' }),
    ]);
  });

  it('passes when every runtime-imported package is a declared dependency', () => {
    writeFile(dir, 'dist/utils/tool.js', `import { z } from 'zod';\nimport fs from 'node:fs';\n`);
    const pkgPath = writeFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { zod: '^4.0.0' } })
    );

    expect(checkRuntimeDeps(path.join(dir, 'dist'), pkgPath)).toEqual([]);
  });

  it('does not flag relative imports', () => {
    writeFile(dir, 'dist/utils/tool.js', `import { helper } from './helper.js';\n`);
    const pkgPath = writeFile(dir, 'package.json', JSON.stringify({ dependencies: {} }));

    expect(checkRuntimeDeps(path.join(dir, 'dist'), pkgPath)).toEqual([]);
  });

  it('passes against the real current dist/ build (clean-codebase run)', () => {
    const realDist = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(realDist)) return; // skipped when dist/ hasn't been built in this environment
    const violations = checkRuntimeDeps(realDist, path.join(process.cwd(), 'package.json'));
    expect(violations).toEqual([]);
  });
});
