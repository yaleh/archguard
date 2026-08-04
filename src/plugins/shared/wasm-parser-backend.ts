import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParserBackend, ParserLanguage } from './parser-backend.js';
import { ParserInitializationError } from './parser-backend.js';
import type { ParserSession, SyntaxNodeLike, SyntaxTreeLike } from './syntax-tree.js';

/**
 * Portable parser backend built on web-tree-sitter with grammar WASM assets
 * bundled under assets/grammars/ (pinned + checksummed; see
 * scripts/fetch-grammar-wasms.mjs). Consumed through the same ParserBackend /
 * ParserSession contract as the native backend.
 *
 * Memory model: web-tree-sitter Node objects are plain JS views into the
 * tree's WASM memory, so disposing the tree frees everything a parse
 * allocated. Sessions delete their parser, trees delete themselves, and
 * Language instances are cached for the process lifetime.
 */

const GRAMMAR_WASM_FILES: Record<ParserLanguage, string> = {
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  python: 'tree-sitter-python.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
};

const RUNTIME_WASM_FILE = 'tree-sitter.wasm';

/** Structural subset of the web-tree-sitter API this backend relies on. */
interface WtsParserModule {
  init(options?: { locateFile?: (scriptName: string) => string }): Promise<void>;
  new (): WtsParser;
}

interface WtsParser {
  setLanguage(language: WtsLanguage): void;
  parse(code: string): WtsTree;
  delete(): void;
}

interface WtsTree {
  readonly rootNode: SyntaxNodeLike;
  delete(): void;
}

interface WtsLanguage {
  delete(): void;
}

interface WtsModule {
  Parser: WtsParserModule;
  Language: { load(path: string): Promise<WtsLanguage> };
}

export interface WasmParserBackendOptions {
  /**
   * Directory containing the pinned .wasm assets. Defaults to
   * <package-root>/assets/grammars resolved via import.meta.url, so asset
   * loading never depends on process.cwd(). Overridable for tests.
   */
  assetsDir?: string;
}

function defaultAssetsDir(): string {
  // Both src/plugins/shared/ (vitest) and dist/plugins/shared/ (packed
  // installs) sit three levels below the package root.
  return fileURLToPath(new URL('../../../assets/grammars/', import.meta.url));
}

interface WasmRuntimeCache {
  modulePromise?: Promise<WtsModule>;
  readonly languagePromises: Map<ParserLanguage, Promise<WtsLanguage>>;
}

// web-tree-sitter initialization and grammar compilation are process-scoped,
// not analysis-scoped. Keep distinct caches for explicitly different asset
// directories so tests and embedded installations cannot cross-contaminate.
const runtimeCaches = new Map<string, WasmRuntimeCache>();

/** Test hook; production caches intentionally live for the process lifetime. */
export function resetWasmParserRuntimeCache(): void {
  runtimeCaches.clear();
}

export class WasmParserBackend implements ParserBackend {
  readonly runtime = 'wasm' as const;

  private readonly assetsDir: string;
  private readonly cache: WasmRuntimeCache;

  constructor(options: WasmParserBackendOptions = {}) {
    this.assetsDir = path.resolve(options.assetsDir ?? defaultAssetsDir());
    let cache = runtimeCaches.get(this.assetsDir);
    if (!cache) {
      cache = { languagePromises: new Map() };
      runtimeCaches.set(this.assetsDir, cache);
    }
    this.cache = cache;
  }

  /** Number of languages whose WASM grammar has been loaded (test visibility). */
  get cachedLanguageCount(): number {
    return this.cache.languagePromises.size;
  }

  async createSession(language: ParserLanguage): Promise<ParserSession> {
    let parser: WtsParser | undefined;
    try {
      const wts = await this.initializeRuntime();
      const loadedLanguage = await this.loadLanguage(wts, language);
      parser = new wts.Parser();
      parser.setLanguage(loadedLanguage);
      return new WasmParserSession(language, parser);
    } catch (error) {
      if (error instanceof ParserInitializationError) throw error;
      parser?.delete();
      throw new ParserInitializationError(language, this.runtime, error);
    }
  }

  /** One-time web-tree-sitter runtime initialization, cached per backend. */
  private initializeRuntime(): Promise<WtsModule> {
    if (this.cache.modulePromise !== undefined) return this.cache.modulePromise;
    const initialized = (async (): Promise<WtsModule> => {
      const wts = (await import('web-tree-sitter')) as unknown as WtsModule;
      const runtimePath = path.join(this.assetsDir, RUNTIME_WASM_FILE);
      // Fall back to web-tree-sitter's own bundled runtime if our copy is not
      // installed (same pinned version, so the ABI matches either way).
      const locateFile = existsSync(runtimePath)
        ? { locateFile: (): string => runtimePath }
        : undefined;
      await wts.Parser.init(locateFile);
      return wts;
    })();
    initialized.catch(() => {
      if (this.cache.modulePromise === initialized) this.cache.modulePromise = undefined;
    });
    this.cache.modulePromise ??= initialized;
    return this.cache.modulePromise;
  }

  /** Per-language Language.load() caching: each grammar WASM is read once. */
  private loadLanguage(wts: WtsModule, language: ParserLanguage): Promise<WtsLanguage> {
    if (this.cache.languagePromises.has(language)) {
      return this.cache.languagePromises.get(language);
    }
    const loaded: Promise<WtsLanguage> = (async (): Promise<WtsLanguage> => {
      const grammarPath = path.join(this.assetsDir, GRAMMAR_WASM_FILES[language]);
      if (!existsSync(grammarPath)) {
        throw new Error(
          `bundled ${language} grammar WASM not found at ${grammarPath} ` +
            `(rebuild with: node scripts/fetch-grammar-wasms.mjs --update)`
        );
      }
      return wts.Language.load(grammarPath);
    })();
    // Do not cache failures: a transient read error must not poison the cache.
    loaded.catch(() => this.cache.languagePromises.delete(language));
    this.cache.languagePromises.set(language, loaded);
    return loaded;
  }
}

class WasmParserSession implements ParserSession {
  readonly runtime = 'wasm' as const;
  private disposed = false;

  constructor(
    readonly language: ParserLanguage,
    private readonly parser: WtsParser
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
        // Frees the WASM-side tree; Node views into it must not be used after.
        tree.delete();
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.parser.delete();
  }
}

export const wasmParserBackend = new WasmParserBackend();
