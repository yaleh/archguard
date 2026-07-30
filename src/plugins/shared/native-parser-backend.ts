import { createRequire } from 'node:module';
import type { ParserBackend, ParserLanguage } from './parser-backend.js';
import { ParserInitializationError } from './parser-backend.js';
import type { ParserSession, SyntaxTreeLike } from './syntax-tree.js';

const require = createRequire(import.meta.url);

const GRAMMAR_MODULES: Record<ParserLanguage, string> = {
  go: 'tree-sitter-go',
  java: 'tree-sitter-java',
  python: 'tree-sitter-python',
  cpp: 'tree-sitter-cpp',
  kotlin: '@tree-sitter-grammars/tree-sitter-kotlin',
};

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

function moduleDefault<T>(module: { default?: T } | T): T {
  return (module as { default?: T }).default ?? (module as T);
}

export class NativeParserBackend implements ParserBackend {
  readonly runtime = 'native' as const;

  async createSession(language: ParserLanguage): Promise<ParserSession> {
    let parser: NativeParser | undefined;
    try {
      const Parser = moduleDefault(require('tree-sitter')) as unknown as ParserConstructor;
      parser = new Parser();
      parser.setLanguage(moduleDefault(require(GRAMMAR_MODULES[language])));
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
