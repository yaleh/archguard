/**
 * Unit tests for NativeParserBackend.
 *
 * Covers the native tree-sitter backend: session creation, parse/dispose
 * lifecycle (idempotent dispose, parse-after-dispose rejection, tree
 * delete-on-dispose), ParserInitializationError wrapping on loader failure,
 * nativeGrammarModule mapping, readNativeModuleRootEnv parsing, and
 * defaultNativeLoaders module-root scoping.
 */

import { describe, it, expect } from 'vitest';
import {
  NativeParserBackend,
  nativeGrammarModule,
  readNativeModuleRootEnv,
  defaultNativeLoaders,
  type NativeModuleLoaders,
} from '@/plugins/shared/native-parser-backend.js';
import {
  ParserInitializationError,
  resolveParserBackend,
} from '@/plugins/shared/parser-backend.js';

describe('nativeGrammarModule', () => {
  it('maps each language to its native grammar package', () => {
    expect(nativeGrammarModule('go')).toBe('tree-sitter-go');
    expect(nativeGrammarModule('java')).toBe('tree-sitter-java');
    expect(nativeGrammarModule('python')).toBe('tree-sitter-python');
    expect(nativeGrammarModule('cpp')).toBe('tree-sitter-cpp');
    expect(nativeGrammarModule('kotlin')).toBe('@tree-sitter-grammars/tree-sitter-kotlin');
  });
});

describe('readNativeModuleRootEnv', () => {
  it('returns undefined when env is unset or empty', () => {
    expect(readNativeModuleRootEnv({})).toBeUndefined();
    expect(readNativeModuleRootEnv({ ARCHGUARD_NATIVE_MODULE_ROOT: '' })).toBeUndefined();
  });

  it('returns the configured root', () => {
    expect(readNativeModuleRootEnv({ ARCHGUARD_NATIVE_MODULE_ROOT: '/opt/native' })).toBe(
      '/opt/native'
    );
  });
});

describe('NativeParserBackend', () => {
  it('exposes the native runtime kind', () => {
    expect(new NativeParserBackend().runtime).toBe('native');
  });

  it('parses real Go code through the ParserSession facade', async () => {
    const backend = new NativeParserBackend();
    const session = await backend.createSession('go');
    expect(session.language).toBe('go');
    expect(session.runtime).toBe('native');

    const tree = session.parse('package main\n\nfunc main() { println("hi") }\n');
    try {
      expect(tree.rootNode.type).toBe('source_file');
      expect(tree.rootNode.startIndex).toBe(0);
      expect(tree.rootNode.endIndex).toBeGreaterThan(0);
    } finally {
      tree.dispose();
      session.dispose();
    }
  });

  it('supports repeated parse/dispose cycles on one session', async () => {
    const backend = new NativeParserBackend();
    const session = await backend.createSession('python');
    for (let i = 0; i < 3; i++) {
      const tree = session.parse('x = 1\n');
      expect(tree.rootNode.type).toBe('module');
      tree.dispose();
      tree.dispose(); // idempotent
    }
    session.dispose();
    session.dispose(); // idempotent
  });

  it('rejects parsing after the session is disposed', async () => {
    const backend = new NativeParserBackend();
    const session = await backend.createSession('go');
    session.dispose();
    expect(() => session.parse('package main\n')).toThrow(/disposed/);
  });

  it('wraps loader failures in ParserInitializationError', async () => {
    const loaders: NativeModuleLoaders = {
      loadRuntime: () => {
        throw new Error('native addon missing');
      },
      loadGrammar: () => undefined,
    };
    const backend = new NativeParserBackend({ loaders });
    await expect(backend.createSession('go')).rejects.toThrow(ParserInitializationError);
    await expect(backend.createSession('go')).rejects.toThrow(/native/);
    await expect(backend.createSession('go')).rejects.toThrow(/go/);
  });

  it('wraps grammar-load failures (runtime ok) in ParserInitializationError', async () => {
    let parserDeleted = 0;
    const loaders: NativeModuleLoaders = {
      loadRuntime: () =>
        class FakeParser {
          delete(): void {
            parserDeleted++;
          }
          setLanguage(): void {
            throw new Error('bad grammar');
          }
          parse(): never {
            throw new Error('unreachable');
          }
        } as never,
      loadGrammar: () => ({}),
    };
    const backend = new NativeParserBackend({ loaders });
    await expect(backend.createSession('java')).rejects.toThrow(ParserInitializationError);
    // parser.delete() called on partial init failure
    expect(parserDeleted).toBe(1);
  });

  it('calls tree.delete() on tree dispose via session', async () => {
    let treeDeleted = 0;
    const loaders: NativeModuleLoaders = {
      loadRuntime: () =>
        class FakeParser {
          setLanguage(): void {}
          parse(): { rootNode: { type: string }; delete: () => void } {
            return { rootNode: { type: 'source_file' }, delete: () => treeDeleted++ };
          }
          delete(): void {}
        } as never,
      loadGrammar: () => ({}),
    };
    const backend = new NativeParserBackend({ loaders });
    const session = await backend.createSession('go');
    const tree = session.parse('x');
    tree.dispose();
    expect(treeDeleted).toBe(1);
    session.dispose();
  });

  it('calls parser.delete() on session dispose', async () => {
    let parserDeleted = 0;
    const loaders: NativeModuleLoaders = {
      loadRuntime: () =>
        class FakeParser {
          setLanguage(): void {}
          parse(): { rootNode: { type: string }; delete: () => void } {
            return { rootNode: { type: 'source_file' }, delete: () => {} };
          }
          delete(): void {
            parserDeleted++;
          }
        } as never,
      loadGrammar: () => ({}),
    };
    const backend = new NativeParserBackend({ loaders });
    const session = await backend.createSession('go');
    session.dispose();
    session.dispose(); // idempotent
    expect(parserDeleted).toBe(1);
  });

  it('supports injecting module loaders via options', async () => {
    const backend = new NativeParserBackend({
      loaders: defaultNativeLoaders(), // real loaders
    });
    const session = await backend.createSession('go');
    expect(session.runtime).toBe('native');
    session.dispose();
  });
});

describe('defaultNativeLoaders', () => {
  it('returns loaders that resolve the runtime and grammar', () => {
    const loaders = defaultNativeLoaders();
    const Parser = loaders.loadRuntime();
    expect(typeof Parser).toBe('function');
    const grammar = loaders.loadGrammar('go');
    expect(grammar).toBeTruthy();
  });
});

describe('resolveParserBackend (legacy global API)', () => {
  const original = {
    runtime: process.env.ARCHGUARD_PARSER_RUNTIME,
    backend: process.env.ARCHGUARD_PARSER_BACKEND,
  };

  afterEach(() => {
    if (original.runtime === undefined) delete process.env.ARCHGUARD_PARSER_RUNTIME;
    else process.env.ARCHGUARD_PARSER_RUNTIME = original.runtime;
    if (original.backend === undefined) delete process.env.ARCHGUARD_PARSER_BACKEND;
    else process.env.ARCHGUARD_PARSER_BACKEND = original.backend;
  });

  it('defaults to native backend when no env or kind given', async () => {
    const backend = await resolveParserBackend();
    expect(backend.runtime).toBe('native');
  });

  it('honours ARCHGUARD_PARSER_RUNTIME=native', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'native';
    const backend = await resolveParserBackend();
    expect(backend.runtime).toBe('native');
  });

  it('honours ARCHGUARD_PARSER_RUNTIME=wasm', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'wasm';
    const backend = await resolveParserBackend();
    expect(backend.runtime).toBe('wasm');
  });

  it('ignores auto for the language-agnostic API (native fallback)', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'auto';
    const backend = await resolveParserBackend();
    expect(backend.runtime).toBe('native');
  });

  it('rejects an invalid ARCHGUARD_PARSER_RUNTIME value', async () => {
    process.env.ARCHGUARD_PARSER_RUNTIME = 'bogus';
    await expect(resolveParserBackend()).rejects.toThrow(/ARCHGUARD_PARSER_RUNTIME/);
  });

  it('applies the deprecated ARCHGUARD_PARSER_BACKEND alias only when RUNTIME unset', async () => {
    process.env.ARCHGUARD_PARSER_BACKEND = 'wasm';
    const wasm = await resolveParserBackend();
    expect(wasm.runtime).toBe('wasm');

    process.env.ARCHGUARD_PARSER_RUNTIME = 'native'; // supersedes alias
    const native = await resolveParserBackend();
    expect(native.runtime).toBe('native');
  });

  it('rejects an invalid ARCHGUARD_PARSER_BACKEND value', async () => {
    process.env.ARCHGUARD_PARSER_BACKEND = 'bogus';
    await expect(resolveParserBackend()).rejects.toThrow(/ARCHGUARD_PARSER_BACKEND/);
  });
});
