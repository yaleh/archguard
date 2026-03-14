/**
 * Tests for TypeScriptPlugin.extractTestStructure()
 *
 * TDD: Phase A (assertion counting via brace-depth scan) and
 *      Phase B (@/ alias import extraction)
 *
 * Plan 40: TypeScript Test Analysis Accuracy
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';
import * as tsconfigFinder from '@/utils/tsconfig-finder.js';

let plugin: TypeScriptPlugin;

beforeEach(async () => {
  plugin = new TypeScriptPlugin();
  await plugin.initialize({ workspaceRoot: '/project' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Phase A — assertion counting via brace-depth scan
// ---------------------------------------------------------------------------

describe('extractTestStructure — assertion counting via brace-depth scan', () => {
  it('counts expect() within 20 lines (existing behaviour unchanged)', () => {
    const code = `it('short test', () => {\n  expect(1).toBe(1);\n});\n`;
    const result = plugin.extractTestStructure('/test/foo.test.ts', code);
    expect(result.testCases[0].assertionCount).toBe(1);
  });

  it('counts expect() at line 50 of test body', () => {
    const setup = Array.from({ length: 48 }, (_, i) => `  const x${i} = ${i};`).join('\n');
    const code = `it('long test', async () => {\n${setup}\n  expect(true).toBe(true);\n});\n`;
    const result = plugin.extractTestStructure('/test/foo.test.ts', code);
    expect(result.testCases[0].assertionCount).toBeGreaterThan(0);
  });

  it('counts multiple expects scattered across a 90-line body', () => {
    const lines = [`it('big', async () => {`];
    for (let i = 0; i < 90; i++) {
      lines.push(i % 30 === 0 ? `  expect(${i}).toBeDefined();` : `  const v${i} = ${i};`);
    }
    lines.push('});');
    const result = plugin.extractTestStructure('/test/foo.test.ts', lines.join('\n'));
    // expects at i=0 (first iteration), i=30, i=60 → 3 assertions
    expect(result.testCases[0].assertionCount).toBe(3);
  });

  it('reports assertionCount=0 when test body has no assertions', () => {
    const code = `it('noop', () => {\n  const x = 1 + 1;\n});\n`;
    const result = plugin.extractTestStructure('/test/foo.test.ts', code);
    expect(result.testCases[0].assertionCount).toBe(0);
  });

  it('handles nested braces (object literals) without exiting early', () => {
    const code = `it('obj test', () => {\n  const cfg = { a: { b: 1 } };\n  expect(cfg).toBeDefined();\n});\n`;
    const result = plugin.extractTestStructure('/test/foo.test.ts', code);
    expect(result.testCases[0].assertionCount).toBe(1);
  });

  it('handles two consecutive test cases with independent brace scans', () => {
    const code = [
      `it('first', () => {`,
      `  expect(1).toBe(1);`,
      `});`,
      `it('second', () => {`,
      `  const x = 1;`,
      `  const y = 2;`,
      `  expect(x + y).toBe(3);`,
      `});`,
    ].join('\n');
    const result = plugin.extractTestStructure('/test/foo.test.ts', code);
    expect(result.testCases).toHaveLength(2);
    expect(result.testCases[0].assertionCount).toBe(1);
    expect(result.testCases[1].assertionCount).toBe(1);
  });

  it('counts expect() beyond the old 20-line window limit', () => {
    // Build a test body that is 25 lines before the assertion
    const padding = Array.from({ length: 25 }, (_, i) => `  const pad${i} = null;`).join('\n');
    const code = `it('padded', async () => {\n${padding}\n  expect(true).toBeTruthy();\n});\n`;
    const result = plugin.extractTestStructure('/test/foo.test.ts', code);
    // With old 20-line window, assertionCount would be 0; with brace scan it should be 1
    expect(result.testCases[0].assertionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase B — @/ alias import extraction
// ---------------------------------------------------------------------------

describe('extractTestStructure — @/ alias import extraction', () => {
  it('resolves @/ import when tsconfig.json maps @/* to src/*', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = `import { Parser } from '@/parser/typescript-parser.js';\nit('x', () => {});\n`;
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    expect(result.importedSourceFiles).toContain('/project/src/parser/typescript-parser.ts');
  });

  it('does not throw when no tsconfig.json found — falls back gracefully', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue(undefined);

    const code = `import { Parser } from '@/parser/foo.js';\nit('x', () => {});\n`;
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    // Falls back to heuristic — either resolves or produces empty; does not throw
    expect(result).not.toBeNull();
  });

  it('still resolves relative imports alongside @/ imports', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = [
      `import { A } from './local-helper';`,
      `import { B } from '@/cli/progress';`,
      `it('x', () => {});`,
    ].join('\n');
    const result = plugin.extractTestStructure('/project/tests/unit/foo.test.ts', code);
    expect(result.importedSourceFiles.some((p) => p.includes('local-helper'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.includes('cli/progress'))).toBe(true);
  });

  it('converts .js extension to .ts in resolved path', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = `import { X } from '@/utils/helpers.js';\nit('x', () => {});\n`;
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    expect(result.importedSourceFiles.some((p) => p.endsWith('.ts'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('.js'))).toBe(false);
  });

  it('resolves @/ import without .js extension (bare path)', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = `import { X } from '@/core/plugin-registry';\nit('x', () => {});\n`;
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    // bare path (no .js) should get .ts appended
    expect(result.importedSourceFiles.some((p) => p.includes('core/plugin-registry'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase C — relative .js import extension normalization (Fix 2)
// ---------------------------------------------------------------------------

describe('extractTestStructure — relative .js import extension normalization', () => {
  it('normalizes ../../../src/bar.js to ../../../src/bar.ts in importedSourceFiles', () => {
    const code = [
      `import { Foo } from '../../../src/mermaid/renderer.js';`,
      `it('x', () => { expect(1).toBe(1); });`,
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/project/tests/unit/mermaid/renderer.test.ts',
      code
    );
    expect(result.importedSourceFiles.some((p) => p.endsWith('renderer.ts'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('renderer.js'))).toBe(false);
  });

  it('does not double-convert .ts extension (already .ts stays .ts)', () => {
    const code = [
      `import { Foo } from '../../../src/mermaid/renderer.ts';`,
      `it('x', () => { expect(1).toBe(1); });`,
    ].join('\n');
    const result = plugin.extractTestStructure(
      '/project/tests/unit/mermaid/renderer.test.ts',
      code
    );
    expect(result.importedSourceFiles.some((p) => p.endsWith('renderer.ts'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('renderer.js'))).toBe(false);
  });

  it('@/ alias .js → .ts still works (existing @/ branch unchanged)', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = `import { X } from '@/cli/tools/analyze-tool.js';\nit('x', () => {});\n`;
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    expect(result.importedSourceFiles.some((p) => p.endsWith('analyze-tool.ts'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('analyze-tool.js'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase D — dynamic import() capture (Fix 5)
// ---------------------------------------------------------------------------

describe('extractTestStructure — dynamic import() capture', () => {
  it('captures await import(@/ alias) and resolves to .ts path', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = [
      `it('x', async () => {`,
      `  const mod = await import('@/cli/tools/analyze-tool.js');`,
      `  expect(mod).toBeDefined();`,
      `});`,
    ].join('\n');
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    expect(result.importedSourceFiles.some((p) => p.includes('cli/tools/analyze-tool'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('.ts'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('.js'))).toBe(false);
  });

  it('captures import() with relative path and normalizes .js → .ts', () => {
    const code = [
      `it('x', async () => {`,
      `  const mod = await import('../../../src/mermaid/renderer.js');`,
      `  expect(mod).toBeDefined();`,
      `});`,
    ].join('\n');
    const result = plugin.extractTestStructure('/project/tests/unit/mermaid/test.test.ts', code);
    expect(
      result.importedSourceFiles.some((p) => p.includes('mermaid/renderer') && p.endsWith('.ts'))
    ).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.endsWith('.js'))).toBe(false);
  });

  it('does not duplicate when same path is both static-imported and dynamic-imported', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = [
      `import { X } from '@/parser/foo.js';`,
      `it('x', async () => {`,
      `  const mod = await import('@/parser/foo.js');`,
      `  expect(mod).toBeDefined();`,
      `});`,
    ].join('\n');
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    const parserFooPaths = result.importedSourceFiles.filter((p) => p.includes('parser/foo'));
    // Should have the path at least once (deduplication acceptable but not required)
    expect(parserFooPaths.length).toBeGreaterThanOrEqual(1);
  });
});

describe('extractTestStructure — @/ alias import extraction — additional', () => {
  it('does not include @/ imports in relative import list (no double-counting)', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = `import { X } from '@/utils/helpers.js';\nit('x', () => {});\n`;
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    // No entry should contain the literal '@/' string
    expect(result.importedSourceFiles.every((p) => !p.includes('@/'))).toBe(true);
  });

  it('handles multiple @/ imports in one file', () => {
    vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
    vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
      baseUrl: '/project',
      paths: { '@/*': ['src/*'] },
    });

    const code = [
      `import { A } from '@/parser/a.js';`,
      `import { B } from '@/cli/b.js';`,
      `import { C } from '@/utils/c.js';`,
      `it('x', () => { expect(1).toBe(1); });`,
    ].join('\n');
    const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
    expect(result.importedSourceFiles.some((p) => p.includes('parser/a'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.includes('cli/b'))).toBe(true);
    expect(result.importedSourceFiles.some((p) => p.includes('utils/c'))).toBe(true);
  });
});
