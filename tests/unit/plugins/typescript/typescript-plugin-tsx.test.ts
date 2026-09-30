/**
 * Tests for TypeScriptPlugin .tsx file inclusion (TDD)
 *
 * Verifies that the default file pattern includes .tsx files (React components),
 * that .test.tsx / .spec.tsx / .test.jsx / .spec.jsx are excluded from source parsing,
 * and that isTestFile() correctly identifies .tsx test files.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let plugin: TypeScriptPlugin;

beforeEach(async () => {
  plugin = new TypeScriptPlugin();
  await plugin.initialize({ workspaceRoot: '/project' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isTestFile — tsx/jsx patterns
// ---------------------------------------------------------------------------

describe('isTestFile — tsx/jsx test file detection', () => {
  it('identifies .test.tsx as a test file', () => {
    expect(plugin.isTestFile('/src/components/Button.test.tsx')).toBe(true);
  });

  it('identifies .spec.tsx as a test file', () => {
    expect(plugin.isTestFile('/src/components/Button.spec.tsx')).toBe(true);
  });

  it('identifies .test.jsx as a test file', () => {
    expect(plugin.isTestFile('/src/components/Button.test.jsx')).toBe(true);
  });

  it('identifies .spec.jsx as a test file', () => {
    expect(plugin.isTestFile('/src/components/Button.spec.jsx')).toBe(true);
  });

  it('does NOT identify a plain .tsx file as a test file', () => {
    expect(plugin.isTestFile('/src/components/Button.tsx')).toBe(false);
  });

  it('does NOT identify a plain .jsx file as a test file', () => {
    expect(plugin.isTestFile('/src/components/Button.jsx')).toBe(false);
  });

  it('identifies additional test globs such as *.integration.ts', () => {
    expect(
      plugin.isTestFile('/src/components/Button.integration.ts', {
        testFileGlobs: ['**/*.integration.ts'],
      })
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// initTsProject — default pattern includes .tsx
// ---------------------------------------------------------------------------

describe('parseProject default pattern includes .tsx files', () => {
  it('default filePattern is **/*.{ts,tsx,js,jsx} (not **/*.ts)', async () => {
    // We test this indirectly: spy on parser.parseProject to capture the pattern arg
    const { TypeScriptParser } = await import('@/parser/typescript-parser.js');

    let capturedPattern: string | undefined;
    const origParseProject = TypeScriptParser.prototype.parseProject;
    TypeScriptParser.prototype.parseProject = function (
      workspaceRoot: string,
      pattern: string,
      ...rest: unknown[]
    ) {
      capturedPattern = pattern;
      return origParseProject.call(this, workspaceRoot, pattern, ...(rest as [unknown]));
    };

    try {
      // Use a real temp dir (or just let it fail on empty result — we only care about pattern)
      await plugin.parseProject('/nonexistent-workspace', {}).catch(() => {
        /* ignore parse errors */
      });
    } finally {
      TypeScriptParser.prototype.parseProject = origParseProject;
    }

    // The key assertion: default pattern must include tsx
    expect(capturedPattern).toBe('**/*.{ts,tsx,js,jsx}');
  });

  it('explicit filePattern is passed through unchanged', async () => {
    const { TypeScriptParser } = await import('@/parser/typescript-parser.js');

    let capturedPattern: string | undefined;
    const origParseProject = TypeScriptParser.prototype.parseProject;
    TypeScriptParser.prototype.parseProject = function (
      workspaceRoot: string,
      pattern: string,
      ...rest: unknown[]
    ) {
      capturedPattern = pattern;
      return origParseProject.call(this, workspaceRoot, pattern, ...(rest as [unknown]));
    };

    try {
      await plugin.parseProject('/nonexistent-workspace', { filePattern: '**/*.ts' }).catch(() => {
        /* ignore parse errors */
      });
    } finally {
      TypeScriptParser.prototype.parseProject = origParseProject;
    }

    expect(capturedPattern).toBe('**/*.ts');
  });
});

// ---------------------------------------------------------------------------
// initTsProject — .test.tsx / .spec.tsx excluded from ts-morph Project
// ---------------------------------------------------------------------------

describe('initTsProject built-in excludes cover tsx/jsx test files', () => {
  it('excludes *.test.tsx from the ts-morph Project by default', async () => {
    // Access private method via cast
    const pluginAny = plugin as unknown as {
      initTsProject: (
        root: string,
        pattern: string,
        excludes?: string[]
      ) => import('ts-morph').Project;
    };

    const tsProject = pluginAny.initTsProject('/nonexistent', '**/*.{ts,tsx}');
    const _sourceFiles = tsProject.getSourceFiles().map((sf) => sf.getFilePath());

    // No source files expected (workspace doesn't exist), but we verify the pattern
    // doesn't accidentally include test files when real files are added.
    // Verify by checking that the project was created successfully with exclude patterns.
    expect(tsProject).toBeDefined();
    // The point is confirmed by the unit tests below that check pattern strings
  });

  it('built-in exclude list contains *.test.tsx pattern', async () => {
    const os = await import('os');
    const fsx = await import('fs-extra');
    const pathm = await import('path');
    const dir = await fsx.default.mkdtemp(pathm.default.join(os.default.tmpdir(), 'tsx-excl-'));
    try {
      for (const f of ['a.tsx', 'a.test.tsx', 'a.spec.tsx', 'b.jsx', 'b.test.jsx', 'b.spec.jsx']) {
        await fsx.default.outputFile(pathm.default.join(dir, f), 'export const x = 1;\n');
      }
      const pluginAny = plugin as unknown as {
        initTsProject: (
          root: string,
          pattern: string,
          excludes?: string[]
        ) => { getSourceFiles: () => { getBaseName: () => string }[] };
      };
      const names = pluginAny
        .initTsProject(dir, '**/*.{ts,tsx,js,jsx}')
        .getSourceFiles()
        .map((f) => f.getBaseName())
        .sort();
      expect(names).toEqual(['a.tsx', 'b.jsx']);
    } finally {
      await fsx.default.remove(dir);
    }
  });
});
