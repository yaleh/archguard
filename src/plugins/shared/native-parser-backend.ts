import { createRequire } from 'node:module';
import path from 'node:path';
import type { ParserBackend, ParserLanguage } from './parser-backend.js';
import { ParserInitializationError } from './parser-backend.js';
import type { ParserSession, SyntaxTreeLike } from './syntax-tree.js';

const require = createRequire(import.meta.url);

const RUNTIME_MODULE = 'tree-sitter';

const GRAMMAR_MODULES: Record<ParserLanguage, string> = {
  go: 'tree-sitter-go',
  java: 'tree-sitter-java',
  python: 'tree-sitter-python',
  cpp: 'tree-sitter-cpp',
  kotlin: '@tree-sitter-grammars/tree-sitter-kotlin',
};

/** Package specifier of the native grammar module for a language (test/probe reuse). */
export function nativeGrammarModule(language: ParserLanguage): string {
  return GRAMMAR_MODULES[language];
}

/** Minimal structural surface shared by the runtime probe and real sessions. */
export interface NativeParserLike {
  setLanguage(language: unknown): void;
  parse(
    code: string
  ): { readonly rootNode?: { readonly type?: unknown } | null; delete?: () => void } | null;
  delete?: () => void;
}

export interface NativeParserConstructorLike {
  new (): NativeParserLike;
}

/**
 * Injectable native module loaders (TASK-39): the runtime resolver probes
 * through these, tests fault-inject missing/broken bindings through them, and
 * the backend parses through the same loaders so probe and use share one
 * resolution scope.
 */
export interface NativeModuleLoaders {
  loadRuntime(): NativeParserConstructorLike;
  loadGrammar(language: ParserLanguage): unknown;
}

/** Explicitly configured external module root for native packages. */
export function readNativeModuleRootEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = env.ARCHGUARD_NATIVE_MODULE_ROOT;
  return root && root !== '' ? root : undefined;
}

function moduleDefault<T>(module: { default?: T } | T): T {
  return (module as { default?: T }).default ?? (module as T);
}

/**
 * Default loaders. Without an explicit module root, resolution happens from
 * ArchGuard's own package scope (this file), so a native addon is never
 * loaded from the project being analyzed and global npm locations are never
 * scanned. `moduleRoot` must be an explicitly configured, trusted directory
 * (option or ARCHGUARD_NATIVE_MODULE_ROOT) containing the native packages.
 */
export function defaultNativeLoaders(moduleRoot?: string): NativeModuleLoaders {
  const scopedRequire = moduleRoot
    ? createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
    : require;
  return {
    loadRuntime: () =>
      moduleDefault(
        scopedRequire(RUNTIME_MODULE) as { default?: unknown }
      ) as NativeParserConstructorLike,
    loadGrammar: (language: ParserLanguage) =>
      moduleDefault(scopedRequire(GRAMMAR_MODULES[language]) as { default?: unknown }),
  };
}

interface NativeTree {
  rootNode: SyntaxTreeLike['rootNode'];
  delete?: () => void;
}

interface NativeParser {
  setLanguage(language: unknown): void;
  parse(code: string): NativeTree;
  delete?: () => void;
}

interface ParserConstructor {
  new (): NativeParser;
}

export interface NativeParserBackendOptions {
  /**
   * Module loaders used for both probing and parsing. Defaults to ArchGuard's
   * own package scope, or ARCHGUARD_NATIVE_MODULE_ROOT when explicitly set.
   */
  loaders?: NativeModuleLoaders;
}

export class NativeParserBackend implements ParserBackend {
  readonly runtime = 'native' as const;

  private readonly loaders: NativeModuleLoaders;

  constructor(options: NativeParserBackendOptions = {}) {
    this.loaders = options.loaders ?? defaultNativeLoaders(readNativeModuleRootEnv());
  }

  async createSession(language: ParserLanguage): Promise<ParserSession> {
    let parser: NativeParser | undefined;
    try {
      const Parser = this.loaders.loadRuntime() as unknown as ParserConstructor;
      parser = new Parser();
      parser.setLanguage(this.loaders.loadGrammar(language));
      return new NativeParserSession(language, parser);
    } catch (error) {
      parser?.delete?.();
      throw new ParserInitializationError(language, this.runtime, error);
    }
  }
}

class NativeParserSession implements ParserSession {
  readonly runtime = 'native' as const;
  private disposed = false;

  constructor(
    readonly language: ParserLanguage,
    private readonly parser: NativeParser
  ) {}

  parse(code: string): SyntaxTreeLike {
    if (this.disposed) throw new Error(`${this.language} parser session has been disposed`);
    const tree = this.parser.parse(code);
    let disposed = false;
    return {
      rootNode: tree.rootNode,
      dispose(): void {
        if (disposed) return;
        disposed = true;
        tree.delete?.();
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.parser.delete?.();
  }
}

export const nativeParserBackend = new NativeParserBackend();
