/**
 * Unit tests for the per-language parser runtime resolver (TASK-39).
 *
 * Fault injection happens through the injectable NativeModuleLoaders — tests
 * simulate missing, broken, ABI-incompatible, and grammar-incompatible native
 * bindings without mutating node_modules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  defaultNativeLoaders,
  getParserRuntimeDiagnostics,
  hasParserRuntimeEnvOverride,
  probeNativeBinding,
  readParserRuntimePolicy,
  resetParserBackendSelectionCache,
  selectParserBackendFor,
  type NativeModuleLoaders,
} from '../../../../src/plugins/shared/parser-runtime.js';
import { nativeParserBackend } from '../../../../src/plugins/shared/native-parser-backend.js';
import { wasmParserBackend } from '../../../../src/plugins/shared/wasm-parser-backend.js';
import {
  ParserInitializationError,
  resolveParserBackend,
  type ParserLanguage,
} from '../../../../src/plugins/shared/parser-backend.js';

const ROOT_TYPES: Record<ParserLanguage, string> = {
  go: 'source_file',
  java: 'program',
  python: 'module',
  cpp: 'translation_unit',
  kotlin: 'source_file',
};

interface LoaderSpy {
  runtimeLoads: number;
  grammarLoads: ParserLanguage[];
}

/** Fake healthy native bindings: a parser that reports the probed language's real root type. */
function healthyLoaders(spy?: LoaderSpy): NativeModuleLoaders {
  class FakeParser {
    private language: { lang: ParserLanguage } | undefined;
    setLanguage(grammar: unknown): void {
      this.language = grammar as { lang: ParserLanguage };
    }
    parse(): { rootNode: { type: string } } {
      return { rootNode: { type: ROOT_TYPES[this.language?.lang ?? 'go'] } };
    }
    delete(): void {}
  }
  return {
    loadRuntime: () => {
      if (spy) spy.runtimeLoads += 1;
      return FakeParser;
    },
    loadGrammar: (language: ParserLanguage) => {
      spy?.grammarLoads.push(language);
      return { lang: language };
    },
  };
}

function missingRuntimeLoaders(): NativeModuleLoaders {
  return {
    loadRuntime: () => {
      throw new Error("Cannot find module 'tree-sitter'");
    },
    loadGrammar: () => ({}),
  };
}

function missingGrammarLoaders(): NativeModuleLoaders {
  const healthy = healthyLoaders();
  return {
    loadRuntime: healthy.loadRuntime,
    loadGrammar: (language: ParserLanguage) => {
      throw new Error(`Cannot find module 'tree-sitter-${language}'`);
    },
  };
}

function abiIncompatibleLoaders(): NativeModuleLoaders {
  class AbiBrokenParser {
    setLanguage(): void {
      throw new Error('Incompatible language version 15. Expected 14.');
    }
    parse(): never {
      throw new Error('unreachable');
    }
  }
  return {
    loadRuntime: () => AbiBrokenParser as never,
    loadGrammar: (language: ParserLanguage) => ({ lang: language }),
  };
}

function grammarMismatchLoaders(): NativeModuleLoaders {
  class WrongTreeParser {
    setLanguage(): void {}
    parse(): { rootNode: { type: string } } {
      return { rootNode: { type: 'WRONG_ROOT' } };
    }
    delete(): void {}
  }
  return {
    loadRuntime: () => WrongTreeParser,
    loadGrammar: (language: ParserLanguage) => ({ lang: language }),
  };
}

const ENV_KEYS = [
  'ARCHGUARD_PARSER_RUNTIME',
  'ARCHGUARD_PARSER_BACKEND',
  'ARCHGUARD_NATIVE_MODULE_ROOT',
] as const;

describe('readParserRuntimePolicy', () => {
  it('defaults to auto when no env is set', () => {
    expect(readParserRuntimePolicy({})).toBe('auto');
  });

  it.each(['auto', 'native', 'wasm'] as const)('accepts ARCHGUARD_PARSER_RUNTIME=%s', (value) => {
    expect(readParserRuntimePolicy({ ARCHGUARD_PARSER_RUNTIME: value })).toBe(value);
  });

  it('rejects an invalid ARCHGUARD_PARSER_RUNTIME value', () => {
    expect(() => readParserRuntimePolicy({ ARCHGUARD_PARSER_RUNTIME: 'bogus' })).toThrow(
      /Invalid ARCHGUARD_PARSER_RUNTIME value "bogus"/
    );
  });

  it.each(['native', 'wasm'] as const)(
    'keeps ARCHGUARD_PARSER_BACKEND=%s as a deprecated alias',
    (value) => {
      expect(readParserRuntimePolicy({ ARCHGUARD_PARSER_BACKEND: value })).toBe(value);
    }
  );

  it('rejects an invalid ARCHGUARD_PARSER_BACKEND value', () => {
    expect(() => readParserRuntimePolicy({ ARCHGUARD_PARSER_BACKEND: 'bogus' })).toThrow(
      /Invalid ARCHGUARD_PARSER_BACKEND value "bogus"/
    );
  });

  it('lets ARCHGUARD_PARSER_RUNTIME supersede the legacy alias when both are set', () => {
    expect(
      readParserRuntimePolicy({
        ARCHGUARD_PARSER_RUNTIME: 'wasm',
        ARCHGUARD_PARSER_BACKEND: 'native',
      })
    ).toBe('wasm');
  });

  it('reports whether an env override is present', () => {
    expect(hasParserRuntimeEnvOverride({})).toBe(false);
    expect(hasParserRuntimeEnvOverride({ ARCHGUARD_PARSER_RUNTIME: 'auto' })).toBe(true);
    expect(hasParserRuntimeEnvOverride({ ARCHGUARD_PARSER_BACKEND: 'wasm' })).toBe(true);
  });
});

describe('selectParserBackendFor', () => {
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

  describe('auto policy', () => {
    it('selects native when the health probe passes', async () => {
      const selection = await selectParserBackendFor('go', {
        policy: 'auto',
        nativeLoaders: healthyLoaders(),
      });
      expect(selection.runtime).toBe('native');
      // Injected loaders produce a native backend bound to the same loaders.
      expect(selection.backend.runtime).toBe('native');
      expect(selection.fallbackReason).toBeUndefined();
      expect(selection.diagnostic).toContain('go');
      expect(selection.diagnostic).toContain('native');
    });

    it('falls back to WASM when the native runtime module is missing', async () => {
      const selection = await selectParserBackendFor('java', {
        policy: 'auto',
        nativeLoaders: missingRuntimeLoaders(),
      });
      expect(selection.runtime).toBe('wasm');
      expect(selection.backend).toBe(wasmParserBackend);
      expect(selection.fallbackReason).toMatch(/tree-sitter/);
      expect(selection.diagnostic).toContain('java');
      expect(selection.diagnostic).toContain('wasm');
      expect(selection.diagnostic).toContain(selection.fallbackReason);
    });

    it('falls back to WASM when the language grammar module is missing', async () => {
      const selection = await selectParserBackendFor('python', {
        policy: 'auto',
        nativeLoaders: missingGrammarLoaders(),
      });
      expect(selection.runtime).toBe('wasm');
      expect(selection.fallbackReason).toMatch(/tree-sitter-python/);
    });

    it('falls back to WASM on ABI-incompatible bindings', async () => {
      const selection = await selectParserBackendFor('cpp', {
        policy: 'auto',
        nativeLoaders: abiIncompatibleLoaders(),
      });
      expect(selection.runtime).toBe('wasm');
      expect(selection.fallbackReason).toMatch(/ABI/);
    });

    it('falls back to WASM on grammar/runtime mismatch (unexpected probe root)', async () => {
      const selection = await selectParserBackendFor('kotlin', {
        policy: 'auto',
        nativeLoaders: grammarMismatchLoaders(),
      });
      expect(selection.runtime).toBe('wasm');
      expect(selection.fallbackReason).toMatch(/unexpected root node/);
    });

    it('is the default policy when no env or option overrides it', async () => {
      // Real default loaders: this environment has a healthy native install.
      const selection = await selectParserBackendFor('go');
      expect(selection.policy).toBe('auto');
      expect(selection.runtime).toBe('native');
      // Default-scope selections share the process-wide native backend.
      expect(selection.backend).toBe(nativeParserBackend);
    });
  });

  describe('native policy (forced)', () => {
    it('selects native when the probe passes', async () => {
      const selection = await selectParserBackendFor('go', {
        policy: 'native',
        nativeLoaders: healthyLoaders(),
      });
      expect(selection.runtime).toBe('native');
      expect(selection.backend.runtime).toBe('native');
    });

    it('reports an actionable error and never silently uses WASM when broken', async () => {
      const attempt = selectParserBackendFor('go', {
        policy: 'native',
        nativeLoaders: missingRuntimeLoaders(),
      });
      await expect(attempt).rejects.toBeInstanceOf(ParserInitializationError);
      await expect(attempt).rejects.toThrow(/Failed to initialize go parser with native backend/);
      await expect(attempt).rejects.toThrow(/ARCHGUARD_NATIVE_MODULE_ROOT/);
      await expect(attempt).rejects.toThrow(/tree-sitter-go/);
    });
  });

  describe('wasm policy (forced)', () => {
    it('never attempts to import native modules', async () => {
      const spy: LoaderSpy = { runtimeLoads: 0, grammarLoads: [] };
      const selection = await selectParserBackendFor('go', {
        policy: 'wasm',
        nativeLoaders: healthyLoaders(spy),
      });
      expect(selection.runtime).toBe('wasm');
      expect(selection.backend).toBe(wasmParserBackend);
      expect(spy.runtimeLoads).toBe(0);
      expect(spy.grammarLoads).toEqual([]);
    });
  });

  describe('per-language selection and caching', () => {
    it('selects backends independently per language (mixed native/WASM process)', async () => {
      const healthy = healthyLoaders();
      const mixedLoaders: NativeModuleLoaders = {
        loadRuntime: healthy.loadRuntime,
        loadGrammar: (language: ParserLanguage) => {
          if (language === 'java') throw new Error("Cannot find module 'tree-sitter-java'");
          return healthy.loadGrammar(language);
        },
      };
      const go = await selectParserBackendFor('go', {
        policy: 'auto',
        nativeLoaders: mixedLoaders,
      });
      const java = await selectParserBackendFor('java', {
        policy: 'auto',
        nativeLoaders: mixedLoaders,
      });
      expect(go.runtime).toBe('native');
      expect(java.runtime).toBe('wasm');
      expect(java.fallbackReason).toMatch(/tree-sitter-java/);
    });

    it('caches the selection per (policy, language) for the process lifetime', async () => {
      const first = await selectParserBackendFor('go');
      const second = await selectParserBackendFor('go');
      expect(second).toBe(first);
    });

    it('keys the cache by policy', async () => {
      const autoSelection = await selectParserBackendFor('go');
      const wasmSelection = await selectParserBackendFor('go', { policy: 'wasm' });
      expect(autoSelection.runtime).toBe('native');
      expect(wasmSelection.runtime).toBe('wasm');
      expect(wasmSelection).not.toBe(autoSelection);
    });

    it('probes again for injected (uncached) loaders', async () => {
      const spy: LoaderSpy = { runtimeLoads: 0, grammarLoads: [] };
      const loaders = healthyLoaders(spy);
      await selectParserBackendFor('go', { nativeLoaders: loaders });
      await selectParserBackendFor('go', { nativeLoaders: loaders });
      expect(spy.runtimeLoads).toBe(2);
    });

    it('reads the policy from the environment when no explicit option is given', async () => {
      process.env.ARCHGUARD_PARSER_RUNTIME = 'wasm';
      const selection = await selectParserBackendFor('java');
      expect(selection.policy).toBe('wasm');
      expect(selection.runtime).toBe('wasm');
    });

    it('honours the legacy ARCHGUARD_PARSER_BACKEND alias', async () => {
      process.env.ARCHGUARD_PARSER_BACKEND = 'wasm';
      const selection = await selectParserBackendFor('java');
      expect(selection.policy).toBe('wasm');
      expect(selection.runtime).toBe('wasm');
    });
  });

  describe('diagnostics', () => {
    it('records the choice and fallback reason without writing to stdout', async () => {
      await selectParserBackendFor('go', { policy: 'auto', nativeLoaders: healthyLoaders() });
      await selectParserBackendFor('java', {
        policy: 'auto',
        nativeLoaders: missingRuntimeLoaders(),
      });
      const log = getParserRuntimeDiagnostics();
      expect(log.some((line) => line.includes('go') && line.includes('native'))).toBe(true);
      const javaLine = log.find((line) => line.includes('java'));
      expect(javaLine).toBeDefined();
      expect(javaLine).toContain('wasm');
      expect(javaLine).toContain('native probe failed');
    });

    it('forwards diagnostics to the onDiagnostic sink', async () => {
      const lines: string[] = [];
      await selectParserBackendFor('python', {
        policy: 'auto',
        nativeLoaders: missingGrammarLoaders(),
        onDiagnostic: (line) => lines.push(line),
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('python');
      expect(lines[0]).toContain('tree-sitter-python');
    });
  });
});

describe('native module resolution scope', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');

  it('resolves native modules from ArchGuard package scope, never from the analyzed project', () => {
    // Sabotage: a fake "analyzed project" with a broken tree-sitter in its own
    // node_modules. Default discovery must not consult it, even as cwd.
    const fakeProject = mkdtempSync(path.join(tmpdir(), 'archguard-fake-project-'));
    try {
      const fakePkg = path.join(fakeProject, 'node_modules', 'tree-sitter');
      mkdirSync(fakePkg, { recursive: true });
      writeFileSync(
        path.join(fakePkg, 'package.json'),
        JSON.stringify({ name: 'tree-sitter', version: '0.0.0', main: 'index.js' })
      );
      writeFileSync(
        path.join(fakePkg, 'index.js'),
        'module.exports = class { setLanguage() { throw new Error("sabotaged project-local tree-sitter"); } };'
      );
      const previousCwd = process.cwd();
      process.chdir(fakeProject);
      try {
        // Must load the REAL native binding from ArchGuard's own scope and pass.
        expect(() => probeNativeBinding('go')).not.toThrow();
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      rmSync(fakeProject, { recursive: true, force: true });
    }
  });

  it('resolves the native runtime inside the ArchGuard install, not via global paths', () => {
    const require = createRequire(path.join(repoRoot, 'src', 'plugins', 'shared', 'index.js'));
    const resolved = require.resolve('tree-sitter');
    // node_modules may be a symlink (shared worktree installs): compare
    // against the realpath of the package's own node_modules directory.
    const ownModules = realpathSync(path.join(repoRoot, 'node_modules'));
    expect(realpathSync(resolved).startsWith(ownModules + path.sep)).toBe(true);
  });

  it('supports an explicitly configured external module root', () => {
    // Trusted external root: symlinks to the real native packages.
    const trustedRoot = mkdtempSync(path.join(tmpdir(), 'archguard-trusted-root-'));
    try {
      const modulesDir = path.join(trustedRoot, 'node_modules');
      mkdirSync(modulesDir, { recursive: true });
      const require = createRequire(path.join(repoRoot, 'package.json'));
      for (const pkg of ['tree-sitter', 'tree-sitter-go']) {
        symlinkSync(
          path.dirname(require.resolve(`${pkg}/package.json`)),
          path.join(modulesDir, pkg)
        );
      }
      const loaders = defaultNativeLoaders(modulesDir);
      expect(() => probeNativeBinding('go', loaders)).not.toThrow();
    } finally {
      rmSync(trustedRoot, { recursive: true, force: true });
    }
  });

  it('fails the probe when the explicit module root lacks native packages', () => {
    const emptyRoot = mkdtempSync(path.join(tmpdir(), 'archguard-empty-root-'));
    try {
      const loaders = defaultNativeLoaders(emptyRoot);
      expect(() => probeNativeBinding('go', loaders)).toThrow(/tree-sitter/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('parses through the same trusted module root the probe used', async () => {
    const trustedRoot = mkdtempSync(path.join(tmpdir(), 'archguard-trusted-root-'));
    try {
      const modulesDir = path.join(trustedRoot, 'node_modules');
      mkdirSync(modulesDir, { recursive: true });
      const require = createRequire(path.join(repoRoot, 'package.json'));
      for (const pkg of ['tree-sitter', 'tree-sitter-go']) {
        symlinkSync(
          path.dirname(require.resolve(`${pkg}/package.json`)),
          path.join(modulesDir, pkg)
        );
      }
      const selection = await selectParserBackendFor('go', { nativeModuleRoot: modulesDir });
      expect(selection.runtime).toBe('native');
      const session = await selection.backend.createSession('go');
      try {
        const tree = session.parse('package main\n');
        try {
          expect(tree.rootNode.type).toBe('source_file');
        } finally {
          tree.dispose();
        }
      } finally {
        session.dispose();
      }
    } finally {
      rmSync(trustedRoot, { recursive: true, force: true });
      resetParserBackendSelectionCache();
    }
  });
});

describe('resolveParserBackend env reconciliation (legacy global API)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['ARCHGUARD_PARSER_RUNTIME', 'ARCHGUARD_PARSER_BACKEND'] as const) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ['ARCHGUARD_PARSER_RUNTIME', 'ARCHGUARD_PARSER_BACKEND'] as const) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('honours ARCHGUARD_PARSER_RUNTIME=wasm', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'wasm';
    expect((await resolveParserBackend()).runtime).toBe('wasm');
  });

  it('lets ARCHGUARD_PARSER_RUNTIME supersede the legacy alias', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'native';
    process.env.ARCHGUARD_PARSER_BACKEND = 'wasm';
    expect((await resolveParserBackend()).runtime).toBe('native');
  });

  it('rejects an invalid ARCHGUARD_PARSER_RUNTIME value', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'bogus';
    await expect(resolveParserBackend()).rejects.toThrow(/ARCHGUARD_PARSER_RUNTIME/);
  });

  it('ignores ARCHGUARD_PARSER_RUNTIME=auto for the global API and applies the legacy alias', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'auto';
    process.env.ARCHGUARD_PARSER_BACKEND = 'wasm';
    expect((await resolveParserBackend()).runtime).toBe('wasm');
  });
});
