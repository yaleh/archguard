/**
 * Mixed native/WASM per-language selection through real plugins (TASK-39).
 *
 * Uses the real backends: in this environment native tree-sitter is healthy,
 * so `auto` selects native; forced policies and fault-injected loaders
 * exercise the WASM path. ArchJSON from the resolver-selected backend must be
 * byte-identical to the explicitly constructed backend for the same runtime
 * (behavior-preserving happy path).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  resetParserBackendSelectionCache,
  selectParserBackendFor,
  type NativeModuleLoaders,
} from '../../../src/plugins/shared/parser-runtime.js';
import { nativeParserBackend } from '../../../src/plugins/shared/native-parser-backend.js';
import { wasmParserBackend } from '../../../src/plugins/shared/wasm-parser-backend.js';
import type { ParserBackend, ParserLanguage } from '../../../src/plugins/shared/parser-backend.js';
import { GoPlugin } from '../../../src/plugins/golang/index.js';
import { JavaPlugin } from '../../../src/plugins/java/index.js';
import { PythonPlugin } from '../../../src/plugins/python/index.js';
import { CppPlugin } from '../../../src/plugins/cpp/index.js';
import { KotlinPlugin } from '../../../src/plugins/kotlin/index.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures');
const LOCAL_FIXTURES = path.resolve(__dirname, '../wasm-parity/fixtures');

const CASES: Array<{ language: ParserLanguage; filePath: string; rootType: string }> = [
  { language: 'go', filePath: path.join(FIXTURES, 'go/sample.go'), rootType: 'source_file' },
  {
    language: 'java',
    filePath: path.join(FIXTURES, 'java/simple-class.java'),
    rootType: 'program',
  },
  {
    language: 'python',
    filePath: path.join(FIXTURES, 'python/simple-class.py'),
    rootType: 'module',
  },
  {
    language: 'cpp',
    filePath: path.join(LOCAL_FIXTURES, 'sample.cpp'),
    rootType: 'translation_unit',
  },
  { language: 'kotlin', filePath: path.join(LOCAL_FIXTURES, 'sample.kt'), rootType: 'source_file' },
];

const ENV_KEYS = ['ARCHGUARD_PARSER_RUNTIME', 'ARCHGUARD_PARSER_BACKEND'] as const;

function normalize(archjson: unknown): string {
  return JSON.stringify(archjson).replaceAll(/"timestamp":"[^"]*"/g, '"timestamp":"<normalized>"');
}

function pluginFor(language: ParserLanguage, backend: ParserBackend) {
  switch (language) {
    case 'go':
      return new GoPlugin(backend);
    case 'java':
      return new JavaPlugin(backend);
    case 'python':
      return new PythonPlugin(backend);
    case 'cpp':
      return new CppPlugin(backend);
    case 'kotlin':
      return new KotlinPlugin(backend);
  }
}

describe('per-language runtime selection through real plugins', () => {
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

  it.each(CASES)('auto selects native for $language in a healthy install', async ({ language }) => {
    const selection = await selectParserBackendFor(language);
    expect(selection.runtime).toBe('native');
    expect(selection.fallbackReason).toBeUndefined();
  });

  it.each(CASES)(
    'auto-selected backend parses $language fixtures with the expected root',
    async ({ language, filePath, rootType }) => {
      const selection = await selectParserBackendFor(language);
      const session = await selection.backend.createSession(language);
      try {
        const tree = session.parse(readFileSync(filePath, 'utf8'));
        try {
          expect(tree.rootNode.type).toBe(rootType);
        } finally {
          tree.dispose();
        }
      } finally {
        session.dispose();
      }
    }
  );

  it.each(CASES)(
    'auto-selected (native) ArchJSON is byte-identical to explicit native for $language',
    async ({ language, filePath }) => {
      const selection = await selectParserBackendFor(language);
      expect(selection.runtime).toBe('native');
      const workspaceRoot = path.dirname(filePath);
      const selected = pluginFor(language, selection.backend);
      const explicit = pluginFor(language, nativeParserBackend);
      await selected.initialize({ workspaceRoot } as never);
      await explicit.initialize({ workspaceRoot } as never);
      try {
        const code = readFileSync(filePath, 'utf8');
        expect(normalize(selected.parseCode(code, filePath))).toBe(
          normalize(explicit.parseCode(code, filePath))
        );
      } finally {
        await selected.dispose?.();
        await explicit.dispose?.();
      }
    },
    120_000
  );

  it('supports a mixed native/WASM process: per-language forced policies both parse', async () => {
    const goSelection = await selectParserBackendFor('go', { policy: 'wasm' });
    const javaSelection = await selectParserBackendFor('java', { policy: 'native' });
    expect(goSelection.runtime).toBe('wasm');
    expect(javaSelection.runtime).toBe('native');

    const workspaceRoot = path.join(FIXTURES, 'go');
    const goPlugin = new GoPlugin(goSelection.backend);
    const javaPlugin = new JavaPlugin(javaSelection.backend);
    await goPlugin.initialize({ workspaceRoot } as never);
    await javaPlugin.initialize({ workspaceRoot } as never);
    try {
      const goCode = readFileSync(path.join(FIXTURES, 'go/sample.go'), 'utf8');
      const javaCode = readFileSync(path.join(FIXTURES, 'java/simple-class.java'), 'utf8');
      expect(goPlugin.parseCode(goCode, 'sample.go').language).toBe('go');
      expect(javaPlugin.parseCode(javaCode, 'simple-class.java').language).toBe('java');
    } finally {
      await goPlugin.dispose?.();
      await javaPlugin.dispose?.();
    }
  }, 120_000);

  it('fault-injected native for one language falls back to WASM with identical ArchJSON', async () => {
    const brokenJava: NativeModuleLoaders = {
      loadRuntime: () => {
        throw new Error("Cannot find module 'tree-sitter'");
      },
      loadGrammar: () => ({}),
    };
    const selection = await selectParserBackendFor('java', {
      policy: 'auto',
      nativeLoaders: brokenJava,
    });
    expect(selection.runtime).toBe('wasm');
    expect(selection.fallbackReason).toMatch(/tree-sitter/);

    const filePath = path.join(FIXTURES, 'java/simple-class.java');
    const workspaceRoot = path.dirname(filePath);
    const viaResolver = new JavaPlugin(selection.backend);
    const explicitWasm = new JavaPlugin(wasmParserBackend);
    await viaResolver.initialize({ workspaceRoot } as never);
    await explicitWasm.initialize({ workspaceRoot } as never);
    try {
      const code = readFileSync(filePath, 'utf8');
      expect(normalize(viaResolver.parseCode(code, filePath))).toBe(
        normalize(explicitWasm.parseCode(code, filePath))
      );
    } finally {
      await viaResolver.dispose?.();
      await explicitWasm.dispose?.();
    }
  }, 120_000);
});
