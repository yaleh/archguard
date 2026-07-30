/**
 * loadPluginForLanguage (TASK-39): the broad language-plugin→TypeScript
 * fallback is removed. A failed Go/Java/Python/C++/Kotlin initialization
 * surfaces as an explicit language-specific error and is never silently
 * analyzed as TypeScript; the selected parser backend is injected via the
 * per-language runtime resolver.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPluginForLanguage } from '@/cli/analyze/run-analysis.js';
import { ParserInitializationError } from '@/plugins/shared/parser-backend.js';
import type { NativeModuleLoaders } from '@/plugins/shared/parser-runtime.js';
import { resetParserBackendSelectionCache } from '@/plugins/shared/parser-runtime.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import { JavaPlugin } from '@/plugins/java/index.js';
import { TypeScriptPlugin } from '@/plugins/typescript/index.js';

function missingNativeLoaders(): NativeModuleLoaders {
  return {
    loadRuntime: () => {
      throw new Error("Cannot find module 'tree-sitter'");
    },
    loadGrammar: () => ({}),
  };
}

const ENV_KEYS = ['ARCHGUARD_PARSER_RUNTIME', 'ARCHGUARD_PARSER_BACKEND'] as const;

describe('loadPluginForLanguage (no TypeScript fallback)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetParserBackendSelectionCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetParserBackendSelectionCache();
  });

  it.each(['go', 'java', 'python', 'cpp', 'kotlin'] as const)(
    'rejects with a %s-specific error under forced native with broken bindings — never TypeScript',
    async (language) => {
      const attempt = loadPluginForLanguage(language, '/tmp', {
        policy: 'native',
        nativeLoaders: missingNativeLoaders(),
      });
      await expect(attempt).rejects.toBeInstanceOf(ParserInitializationError);
      await expect(attempt).rejects.toThrow(
        new RegExp(`Failed to initialize ${language} parser with native backend`)
      );
    }
  );

  it('returns a TypeScriptPlugin only for the typescript language', async () => {
    const plugin = await loadPluginForLanguage('typescript', '/tmp');
    expect(plugin).toBeInstanceOf(TypeScriptPlugin);
  });

  it('loads the Go plugin with the resolver-selected backend (auto, healthy native)', async () => {
    const plugin = await loadPluginForLanguage('go', '/tmp');
    expect(plugin).toBeInstanceOf(GoPlugin);
    expect(plugin).not.toBeInstanceOf(TypeScriptPlugin);
  });

  it('loads the Java plugin under forced WASM without touching native modules', async () => {
    let nativeImports = 0;
    const plugin = await loadPluginForLanguage('java', '/tmp', {
      policy: 'wasm',
      nativeLoaders: {
        loadRuntime: () => {
          nativeImports += 1;
          throw new Error('must not be called');
        },
        loadGrammar: () => {
          nativeImports += 1;
          return {};
        },
      },
    });
    expect(plugin).toBeInstanceOf(JavaPlugin);
    expect(nativeImports).toBe(0);
  });

  it('propagates plugin initialization errors instead of substituting TypeScript', async () => {
    // Forced native succeeds at probe time only if native is healthy; instead
    // force a plugin-level failure by pointing at an unreadable workspace is
    // plugin-specific — so here we assert the general contract: errors throw.
    await expect(
      loadPluginForLanguage('kotlin', '/tmp', {
        policy: 'native',
        nativeLoaders: missingNativeLoaders(),
      })
    ).rejects.toThrow(/kotlin/);
  });

  it('emits the runtime choice through the onDiagnostic sink', async () => {
    const lines: string[] = [];
    await loadPluginForLanguage('python', '/tmp', {
      policy: 'wasm',
      onDiagnostic: (line) => lines.push(line),
    });
    expect(lines.some((line) => line.includes('python') && line.includes('wasm'))).toBe(true);
  });
});
