/**
 * Unit tests for PythonPlugin test-structure and path handling methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { PythonPlugin } from '@/plugins/python/index.js';
import type { ParserBackend } from '@/plugins/shared/parser-backend.js';

function makePlugin(): PythonPlugin {
  return new PythonPlugin({} as ParserBackend);
}

describe('PythonPlugin.isTestFile', () => {
  const plugin = makePlugin();
  it('detects test_* and *_test.py files', () => {
    expect(plugin.isTestFile('test_foo.py')).toBe(true);
    expect(plugin.isTestFile('foo_test.py')).toBe(true);
  });
  it('rejects conftest.py and __init__.py', () => {
    expect(plugin.isTestFile('conftest.py')).toBe(false);
    expect(plugin.isTestFile('__init__.py')).toBe(false);
  });
  it('detects files under tests/ or test/ directories', () => {
    expect(plugin.isTestFile('tests/unit/test_x.py')).toBe(true);
    expect(plugin.isTestFile('src/app/test/helper.py')).toBe(true);
  });
  it('rejects non-test modules', () => {
    expect(plugin.isTestFile('src/app/main.py')).toBe(false);
  });
});

describe('PythonPlugin.extractTestStructure', () => {
  const plugin = makePlugin();
  it('returns null for non-test files', () => {
    expect(plugin.extractTestStructure('main.py', 'def main(): pass')).toBeNull();
  });

  it('extracts pytest test functions with assertion counts', () => {
    const code = [
      'import pytest',
      '',
      'def test_add():',
      '    assert add(1, 2) == 3',
      '    assert add(0, 0) == 0',
      '',
      'def test_sub():',
      '    assert sub(5, 3) == 2',
    ].join('\n');
    const result = plugin.extractTestStructure('test_calc.py', code);
    expect(result).not.toBeNull();
    expect(result.frameworks).toContain('pytest');
    expect(result.testTypeHint).toBe('unit');
    expect(result.testCases).toHaveLength(2);
    expect(result.testCases[0].name).toBe('test_add');
    expect(result.testCases[0].assertionCount).toBeGreaterThanOrEqual(2);
  });

  it('marks skipped tests via decorators', () => {
    const code = [
      'import unittest',
      '',
      '@unittest.skip("not ready")',
      'def test_slow():',
      '    assert True',
    ].join('\n');
    const result = plugin.extractTestStructure('test_slow.py', code);
    expect(result.frameworks).toContain('unittest');
    expect(result.testCases[0].isSkipped).toBe(true);
  });

  it('returns null when no test functions are present', () => {
    const result = plugin.extractTestStructure('test_empty.py', 'import pytest\nx = 1');
    expect(result).toBeNull();
  });

  it('detects integration/e2e testTypeHint from path', () => {
    const code = 'import pytest\ndef test_flow():\n    assert True';
    const integration = plugin.extractTestStructure('tests/integration/test_flow.py', code);
    expect(integration.testTypeHint).toBe('integration');
    const e2e = plugin.extractTestStructure('tests/e2e/test_flow.py', code);
    expect(e2e.testTypeHint).toBe('e2e');
  });

  it('extracts absolute imports into relative file paths', () => {
    const code = [
      'import pytest',
      'from mypkg.repo import UserRepo',
      'import mypkg.utils',
      'import os',
      'def test_x():',
      '    assert True',
    ].join('\n');
    const result = plugin.extractTestStructure('test_x.py', code);
    expect(result.importedSourceFiles).toContain('mypkg/repo.py');
    expect(result.importedSourceFiles).toContain('mypkg/utils.py');
    // stdlib 'os' single-component is skipped
    expect(result.importedSourceFiles.some((f) => f === 'os')).toBe(false);
  });
});

describe('PythonPlugin.canHandle', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'py-plugin-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('accepts .py files', () => {
    expect(makePlugin().canHandle('some/module.py')).toBe(true);
  });
  it('accepts directories with python markers', async () => {
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[project]');
    expect(makePlugin().canHandle(dir)).toBe(true);
  });
  it('rejects other paths', () => {
    expect(makePlugin().canHandle('some/Foo.ts')).toBe(false);
  });
});
