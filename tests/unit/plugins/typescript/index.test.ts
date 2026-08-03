/**
 * Unit tests for TypeScriptPlugin test-structure and path handling methods.
 */

import { describe, it, expect } from 'vitest';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';

function makePlugin(): TypeScriptPlugin {
  return new TypeScriptPlugin();
}

describe('TypeScriptPlugin.isTestFile', () => {
  const plugin = makePlugin();
  it('detects .test. and .spec. files', () => {
    expect(plugin.isTestFile('src/foo.test.ts')).toBe(true);
    expect(plugin.isTestFile('src/foo.spec.ts')).toBe(true);
    expect(plugin.isTestFile('src/foo.test.js')).toBe(true);
    expect(plugin.isTestFile('src/foo.spec.tsx')).toBe(true);
  });
  it('rejects non-test files', () => {
    expect(plugin.isTestFile('src/foo.ts')).toBe(false);
  });
  it('honours custom testFileGlobs', () => {
    expect(plugin.isTestFile('src/integration/foo.ts', { testFileGlobs: ['**/integration/**'] })).toBe(true);
  });
});

describe('TypeScriptPlugin.extractTestStructure', () => {
  const plugin = makePlugin();
  it('detects vitest framework and test cases', () => {
    const code = [
      "import { describe, it, expect } from 'vitest';",
      '',
      "describe('add', () => {",
      "  it('adds numbers', () => {",
      '    expect(add(1, 2)).toBe(3);',
      '  });',
      '});',
    ].join('\n');
    const result = plugin.extractTestStructure('src/add.test.ts', code);
    expect(result).not.toBeNull();
    expect(result!.frameworks).toContain('vitest');
    expect(result!.testCases.length).toBeGreaterThan(0);
    expect(result!.testTypeHint).toBe('unit');
  });

  it('detects e2e testTypeHint from path', () => {
    const code = "import { test } from '@playwright/test';\ntest('works', async () => {});";
    const result = plugin.extractTestStructure('tests/e2e/flow.spec.ts', code);
    expect(result!.testTypeHint).toBe('e2e');
    expect(result!.frameworks).toContain('playwright');
  });

  it('detects integration testTypeHint', () => {
    const code = "import { it } from 'vitest';\nit('works', () => {});";
    const result = plugin.extractTestStructure('tests/integration/flow.test.ts', code);
    expect(result!.testTypeHint).toBe('integration');
  });

  it('returns a result with zero test cases for files with no test declarations', () => {
    const result = plugin.extractTestStructure('src/foo.ts', 'export const x = 1');
    expect(result).not.toBeNull();
    expect(result!.testCases).toHaveLength(0);
  });

  it('counts it() and test() declarations as test cases', () => {
    const code = [
      "import { it, expect } from 'vitest';",
      "it('one', () => { expect(1).toBe(1); });",
      "test('two', () => { expect(2).toBe(2); });",
    ].join('\n');
    const result = plugin.extractTestStructure('src/x.test.ts', code);
    expect(result!.testCases).toHaveLength(2);
  });
});
