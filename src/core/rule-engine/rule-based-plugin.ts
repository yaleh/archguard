/**
 * RuleBasedLanguagePlugin — ILanguagePlugin adapter over a LoadedPack
 * (TASK-63, Phase B).
 *
 * Wraps a loaded knowledge pack so the existing PluginRegistry can
 * instantiate a declarative, pack-driven language plugin transparently.
 * Imperative plugins always take precedence over rule-based plugins for the
 * same language; this adapter is the fallback when a pack is found and no
 * imperative plugin is registered.
 */

import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import type {
  ILanguagePlugin,
  PluginInitConfig,
  PluginMetadata,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON, Entity, Relation, SupportedLanguage } from '@/types/index.js';
import { ARCHJSON_SCHEMA_VERSION } from '@/types/index.js';
import { selectParserBackendFor } from '@/plugins/shared/parser-runtime.js';
import type { ParserLanguage } from '@/plugins/shared/parser-backend.js';
import type { ParserSession } from '@/plugins/shared/syntax-tree.js';
import type { LoadedPack } from '../pack-registry/types.js';
import { RuleEngine } from './rule-engine.js';

const SUPPORTED_PARSER_LANGUAGES: ReadonlySet<string> = new Set([
  'go',
  'java',
  'python',
  'cpp',
  'kotlin',
]);

export class RuleBasedLanguagePlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata;
  readonly supportedLevels = ['package', 'class'] as const;

  private engine?: RuleEngine;
  private session?: ParserSession;
  private initialized = false;

  constructor(private readonly pack: LoadedPack) {
    this.metadata = {
      name: pack.manifest.language,
      version: pack.manifest.version,
      displayName: pack.manifest.name,
      fileExtensions: pack.manifest.extensions,
      author: 'ArchGuard Team',
      minCoreVersion: '2.0.0',
      capabilities: {
        singleFileParsing: true,
        incrementalParsing: false,
        dependencyExtraction: false,
        typeInference: false,
      },
    };
  }

  /** The loaded pack's language code (e.g. 'java'). */
  get language(): string {
    return this.pack.manifest.language;
  }

  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) return;
    const language = this.pack.manifest.language;
    if (!SUPPORTED_PARSER_LANGUAGES.has(language)) {
      throw new Error(
        `RuleBasedLanguagePlugin: no tree-sitter grammar available for pack language '${language}'`
      );
    }
    const { backend } = await selectParserBackendFor(language as ParserLanguage);
    this.session = await backend.createSession(language as ParserLanguage);
    this.engine = new RuleEngine(this.pack, this.session, {
      workspaceRoot: config.workspaceRoot,
    });
    this.initialized = true;
  }

  canHandle(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();
    return this.pack.manifest.extensions.some((e) => ext === e.toLowerCase());
  }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();
    const engine = this.engine;
    const extension = this.pack.manifest.extensions[0];
    const pattern = config.filePattern ?? `**/*${extension}`;
    const exclude = config.excludePatterns ?? [];

    const files = await glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/target/**',
        '**/build/**',
        '**/__pycache__/**',
        '**/.venv/**',
        '**/venv/**',
        ...exclude,
      ],
    });

    // Python import relations resolve against the known-module index, so build
    // it from every file path before extracting relations.
    const moduleIndex = new Set<string>();
    for (const file of files) {
      const id = engine.moduleIdFor(file);
      if (id) moduleIndex.add(id);
    }

    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const result = engine.analyzeFile(code, file, moduleIndex);
        entities.push(...result.entities);
        for (const rel of result.relations) {
          const key = `${rel.type}:${rel.source}:${rel.target}`;
          if (seen.has(key)) continue;
          seen.add(key);
          relations.push(rel);
        }
      } catch (error) {
        console.warn(`[rule-based:${this.pack.manifest.language}] failed to parse ${file}:`, error);
      }
    }

    return {
      version: ARCHJSON_SCHEMA_VERSION,
      language: this.pack.manifest.language as SupportedLanguage,
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities,
      relations,
      workspaceRoot,
    };
  }

  parseCode(code: string, filePath: string = 'source'): ArchJSON {
    this.ensureInitialized();
    const engine = this.engine;
    // No project context in single-file mode: pass an empty module index so
    // import relations are not spuriously emitted with unresolvable targets
    // (mirrors the imperative plugins, which emit none in parseCode).
    const result = engine.analyzeFile(code, filePath, new Set());
    return {
      version: ARCHJSON_SCHEMA_VERSION,
      language: this.pack.manifest.language as SupportedLanguage,
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities: result.entities,
      relations: result.relations,
    };
  }

  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();
    const engine = this.engine;
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    const seen = new Set<string>();

    for (const file of filePaths) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        // Incremental mode carries no project module index; see parseCode.
        const result = engine.analyzeFile(code, file, new Set());
        entities.push(...result.entities);
        for (const rel of result.relations) {
          const key = `${rel.type}:${rel.source}:${rel.target}`;
          if (seen.has(key)) continue;
          seen.add(key);
          relations.push(rel);
        }
      } catch (error) {
        console.warn(`[rule-based:${this.pack.manifest.language}] failed to parse ${file}:`, error);
      }
    }

    return {
      version: ARCHJSON_SCHEMA_VERSION,
      language: this.pack.manifest.language as SupportedLanguage,
      timestamp: new Date().toISOString(),
      sourceFiles: filePaths,
      entities,
      relations,
    };
  }

  dispose(): Promise<void> {
    this.session?.dispose();
    this.session = undefined;
    this.initialized = false;
    return Promise.resolve();
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RuleBasedLanguagePlugin not initialized. Call initialize() first.');
    }
  }
}
