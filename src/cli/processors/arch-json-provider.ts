/**
 * ArchJsonProvider - ArchJSON acquisition with 4-path routing and 3-layer cache
 *
 * Encapsulates all ArchJSON parsing logic previously embedded in DiagramProcessor:
 * - Path A: TypeScript Plugin (produces tsAnalysis.moduleGraph)
 * - Path B: ParallelParser (general TypeScript parsing)
 * - Go path: GoAtlasPlugin
 * - C++ path: CppPlugin (with sub-module derivation)
 *
 * Three-layer cache:
 * 1. Memory cache (`archJsonCache`) — in-process, keyed by source hash
 * 2. Deferred promises (`archJsonDeferred`) — prevents duplicate parses for same sources
 * 3. Disk cache (`ArchJsonDiskCache`) — persists across runs
 *
 * @module cli/processors/arch-json-provider
 */

import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';
import { ParallelParser } from '@/parser/parallel-parser.js';
import type { ParseCache } from '@/parser/parse-cache.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { PluginRegistry } from '@/core/plugin-registry.js';
import { ArchJsonDiskCache } from '@/cli/cache/arch-json-disk-cache.js';
import { planGoAnalysisScope } from '@/plugins/golang/source-scope.js';
import { globalEntityTypeRegistry } from '@/core/entity-type-registry.js';
import path from 'path';

export type { ArchJsonProviderOptions, ArchJsonGetOptions } from './arch-json-provider-types.js';
export { hashSources, deriveSubModuleArchJSON } from './arch-json-utils.js';
import type { ArchJsonProviderOptions, ArchJsonGetOptions } from './arch-json-provider-types.js';
import { hashSources, deriveSubModuleArchJSON } from './arch-json-utils.js';

/**
 * ArchJsonProvider - handles all ArchJSON acquisition logic.
 *
 * Responsible for:
 * - Routing parse requests to the correct language plugin or parser
 * - Managing a 3-layer cache (memory, deferred promises, disk)
 * - Deriving sub-module ArchJSON from parent parses
 */
export class ArchJsonProvider {
  private readonly globalConfig: GlobalConfig;
  private readonly parseCache?: ParseCache;
  private readonly registry?: PluginRegistry;
  private readonly fileDiscovery: FileDiscoveryService;
  private readonly archJsonDiskCache: ArchJsonDiskCache;

  /** Memory cache: source hash → parsed ArchJSON */
  private archJsonCache = new Map<string, ArchJSON>();

  /** Reverse index: normalised source path → archJsonCache key, for parent-path lookup */
  private archJsonPathIndex = new Map<string, string>();

  /**
   * Deferred promises for in-progress parses.
   * Each entry: { promise: resolves with the parsed ArchJSON, sources: the sources being parsed }
   * Groups that detect a potential parent await this promise before checking the index.
   */
  private archJsonDeferred = new Map<
    string,
    { promise: Promise<ArchJSON>; sources: string[]; language: string }
  >();

  constructor(options: ArchJsonProviderOptions) {
    this.globalConfig = options.globalConfig;
    this.parseCache = options.parseCache;
    this.registry = options.registry;
    this.fileDiscovery = new FileDiscoveryService();

    const diskCacheRoot = this.globalConfig.cache?.dir ?? path.join('.archguard', 'cache');
    const diskCacheDir = path.join(diskCacheRoot, 'archjson');
    this.archJsonDiskCache = new ArchJsonDiskCache(diskCacheDir);
  }

  /**
   * Returns the number of entries in the memory cache.
   * Used by DiagramProcessor for debug logging.
   */
  public cacheSize(): number {
    return this.archJsonCache.size;
  }

  /**
   * Get (or parse) the ArchJSON for the given diagram configuration.
   *
   * Routes to the correct parse path based on language and needsModuleGraph flag.
   * Applies 3-layer caching: memory cache → deferred promise → disk cache → fresh parse.
   *
   * @param diagram - The diagram whose sources should be parsed
   * @param opts - Options including needsModuleGraph flag (must be computed by caller)
   * @returns Parsed or derived ArchJSON with a kind indicator
   */
  async get(
    diagram: DiagramConfig,
    opts: ArchJsonGetOptions
  ): Promise<{ archJson: ArchJSON; kind: 'parsed' | 'derived' }> {
    const key = hashSources(diagram.sources, diagram.language);

    // ① Unified memory cache check
    // Safe because archJsonCache only contains truly parsed results, and
    // groupDiagramsBySource processes each source key once per run.
    const cached = this.archJsonCache.get(key);
    if (cached) return { archJson: cached, kind: 'parsed' };

    // ② Language routing: Go
    if (diagram.language === 'go') {
      const archJson = await this.registerDeferred(
        diagram.sources,
        diagram.language,
        this.parseGoProject(diagram)
      );
      return { archJson, kind: 'parsed' };
    }

    // ③ Language routing: C++
    if (diagram.language === 'cpp') {
      const { deferred, normParentPath } = this.findParentCoverage(
        diagram.sources,
        diagram.language
      );
      if (deferred !== null) {
        const parent = await deferred;
        return {
          archJson: deriveSubModuleArchJSON(
            parent,
            diagram.sources[0],
            normParentPath ?? undefined
          ),
          kind: 'derived',
        };
      } else if (normParentPath) {
        const parentKey = this.archJsonPathIndex.get(
          this.makePathIndexKey(diagram.language ?? 'typescript', normParentPath)
        );
        const parent = this.archJsonCache.get(parentKey);
        return {
          archJson: deriveSubModuleArchJSON(parent, diagram.sources[0], normParentPath),
          kind: 'derived',
        };
      } else {
        const archJson = await this.registerDeferred(
          diagram.sources,
          diagram.language,
          this.parseCppProject(diagram)
        );
        return { archJson, kind: 'parsed' };
      }
    }

    if (
      diagram.language === 'python' ||
      diagram.language === 'java' ||
      diagram.language === 'kotlin'
    ) {
      const archJson = await this.registerDeferred(
        diagram.sources,
        diagram.language,
        this.parseGenericLanguageProject(diagram)
      );
      return { archJson, kind: 'parsed' };
    }

    // ④ TypeScript Plugin path (Path A)
    // Only taken when needsModuleGraph === true AND language is typescript or unspecified.
    // Java/Python diagrams with level === 'package' fall through to Path B.
    if (opts.needsModuleGraph && (!diagram.language || diagram.language === 'typescript')) {
      const tsFiles = await this.fileDiscovery.discoverFiles({
        sources: diagram.sources,
        exclude: diagram.exclude || this.globalConfig.exclude,
        skipMissing: false,
      });
      const diskCacheEnabled = this.globalConfig.cache?.enabled !== false;
      const diskKey =
        diskCacheEnabled && tsFiles.length > 0
          ? await this.archJsonDiskCache.computeKey(tsFiles)
          : null;
      const cachedFromDisk = diskKey ? await this.archJsonDiskCache.get(diskKey) : null;
      if (cachedFromDisk) {
        if (process.env.ArchGuardDebug === 'true') {
          console.debug(`💾 Disk cache hit for ts-morph path: ${diagram.sources.join(', ')}`);
        }
        // Populate memory cache and path index so sub-groups can derive from this result
        // via findParentCoverage() without re-parsing independently.
        this.cacheArchJson(diagram.sources, cachedFromDisk);
        return { archJson: cachedFromDisk, kind: 'parsed' };
      }
      const archJson = await this.registerDeferred(
        diagram.sources,
        diagram.language,
        this.parseTsPlugin(diagram).then(async (result) => {
          if (diskKey) await this.archJsonDiskCache.set(diskKey, result);
          return result;
        })
      );
      return { archJson, kind: 'parsed' };
    }

    // ⑤ General ParallelParser path (Path B)
    const { deferred, normParentPath } = this.findParentCoverage(diagram.sources, diagram.language);
    if (deferred !== null) {
      const parent = await deferred;
      if (process.env.ArchGuardDebug === 'true') {
        console.debug(
          `🔗 Awaited parent and derived ArchJSON for ${diagram.sources.join(', ')} from ${normParentPath}`
        );
      }
      return {
        archJson: deriveSubModuleArchJSON(parent, diagram.sources[0], normParentPath ?? undefined),
        kind: 'derived',
      };
    } else if (normParentPath) {
      const parentKey = this.archJsonPathIndex.get(
        this.makePathIndexKey(diagram.language ?? 'typescript', normParentPath)
      );
      const parent = this.archJsonCache.get(parentKey);
      if (process.env.ArchGuardDebug === 'true') {
        console.debug(
          `🔗 Derived ArchJSON for ${diagram.sources.join(', ')} from ${normParentPath}`
        );
      }
      return {
        archJson: deriveSubModuleArchJSON(parent, diagram.sources[0], normParentPath),
        kind: 'derived',
      };
    } else {
      const files = await this.fileDiscovery.discoverFiles({
        sources: diagram.sources,
        exclude: diagram.exclude || this.globalConfig.exclude,
        skipMissing: false,
      });

      // files.length === 0 check AFTER parent coverage (semantic improvement: sub-dirs with 0 files
      // can still be derived when parent coverage exists)
      if (files.length === 0) {
        throw new Error(`No TypeScript files found in sources: ${diagram.sources.join(', ')}`);
      }

      if (process.env.ArchGuardDebug === 'true') {
        console.debug(`🔍 Cache miss for ${key}: ${diagram.sources.join(', ')}`);
      }

      const diskCacheEnabled = this.globalConfig.cache?.enabled !== false;
      const diskKey = diskCacheEnabled ? await this.archJsonDiskCache.computeKey(files) : null;
      const diskCached = diskKey ? await this.archJsonDiskCache.get(diskKey) : null;
      if (diskCached) {
        if (process.env.ArchGuardDebug === 'true') {
          console.debug(`💾 Disk cache hit for ParallelParser path: ${diagram.sources.join(', ')}`);
        }
        this.cacheArchJson(diagram.sources, diskCached);
        return { archJson: diskCached, kind: 'parsed' };
      }

      const archJson = await this.parseWithParallelParser(diagram, files);
      if (diskKey) await this.archJsonDiskCache.set(diskKey, archJson);
      this.cacheArchJson(diagram.sources, archJson);
      return { archJson, kind: 'parsed' };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Atomically write to archJsonCache and archJsonPathIndex. */
  private cacheArchJson(sources: string[], archJson: ArchJSON, language?: string): void {
    const resolvedLanguage = language ?? archJson.language;
    const key = hashSources(sources, resolvedLanguage);
    this.archJsonCache.set(key, archJson);
    for (const s of sources) {
      this.archJsonPathIndex.set(this.makePathIndexKey(resolvedLanguage, s), key);
    }
  }

  /**
   * Register a parse promise in archJsonDeferred so concurrent sub-groups can await it.
   * When the promise resolves, caches the result and removes the deferred entry.
   */
  private registerDeferred(
    sources: string[],
    language: string | undefined,
    parsePromise: Promise<ArchJSON>
  ): Promise<ArchJSON> {
    const key = hashSources(sources, language);
    const withCaching = parsePromise.then((result) => {
      this.cacheArchJson(sources, result, language);
      this.archJsonDeferred.delete(key);
      return result;
    });
    this.archJsonDeferred.set(key, {
      promise: withCaching,
      sources,
      language: language ?? 'typescript',
    });
    return withCaching;
  }

  /**
   * Check whether a completed or in-progress parent parse covers all given sources.
   * Returns deferred promise (if parent still parsing) or null (if already complete or not found),
   * plus the matched parent path string.
   */
  private findParentCoverage(
    sources: string[],
    language?: string
  ): {
    deferred: Promise<ArchJSON> | null;
    normParentPath: string | null;
  } {
    const normSources = sources.map((s) => s.replace(/\\/g, '/'));
    const resolvedLanguage = language ?? 'typescript';

    // Check already-completed entries in the path index
    for (const [indexedPath] of this.archJsonPathIndex) {
      const [entryLanguage, entryPath] = this.parsePathIndexKey(indexedPath);
      if (entryLanguage !== resolvedLanguage) continue;
      if (normSources.every((s) => s.startsWith(entryPath + '/') || s === entryPath)) {
        return { deferred: null, normParentPath: entryPath };
      }
    }

    // Check in-progress deferred entries
    for (const [, { promise, sources: parentSources, language: parentLanguage }] of this
      .archJsonDeferred) {
      if (parentLanguage !== resolvedLanguage) continue;
      const normParentSources = parentSources.map((ps) => ps.replace(/\\/g, '/'));
      const matchedParent = normParentSources.find((ps) =>
        normSources.every((s) => s.startsWith(ps + '/') || s === ps)
      );
      if (matchedParent) {
        return { deferred: promise, normParentPath: matchedParent };
      }
    }

    return { deferred: null, normParentPath: null };
  }

  private makePathIndexKey(language: string, source: string): string {
    return `${language}::${source.replace(/\\/g, '/')}`;
  }

  private parsePathIndexKey(key: string): [string, string] {
    const separator = key.indexOf('::');
    if (separator === -1) {
      return ['typescript', key];
    }
    return [key.slice(0, separator), key.slice(separator + 2)];
  }

  /**
   * Parse a Go project via the plugin registry (preferred) or GoAtlasPlugin directly.
   */
  private async parseGoProject(diagram: DiagramConfig): Promise<ArchJSON> {
    const plan = await planGoAnalysisScope(diagram.sources);
    const workspaceRoot = plan.workspaceRoot;
    const registryPlugin = this.registry?.getByName('golang');
    const plugin =
      registryPlugin ??
      (await (async () => {
        const { GoAtlasPlugin } = await import('@/plugins/golang/atlas/index.js');
        return new GoAtlasPlugin();
      })());

    await plugin.initialize({ workspaceRoot });
    if (plugin.metadata?.customEntityTypes) {
      for (const decl of plugin.metadata.customEntityTypes) {
        globalEntityTypeRegistry.register(decl);
      }
    }
    return plugin.parseProject(workspaceRoot, {
      workspaceRoot,
      includePatterns: plan.includePatterns,
      excludePatterns: [
        ...(diagram.exclude ?? this.globalConfig.exclude ?? []),
        ...plan.excludePatterns,
      ],
      languageSpecific: diagram.languageSpecific,
    });
  }

  /**
   * Parse a C++ project via the CppPlugin.
   */
  private async parseCppProject(diagram: DiagramConfig): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const registryPlugin = this.registry?.getByName('cpp');
    const plugin =
      registryPlugin ??
      (await (async () => {
        const { CppPlugin } = await import('@/plugins/cpp/index.js');
        return new CppPlugin();
      })());

    await plugin.initialize({ workspaceRoot });
    if (plugin.metadata?.customEntityTypes) {
      for (const decl of plugin.metadata.customEntityTypes) {
        globalEntityTypeRegistry.register(decl);
      }
    }
    return plugin.parseProject(workspaceRoot, {
      workspaceRoot,
      excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
    });
  }

  /**
   * Parse a TypeScript project via the plugin registry (preferred) or TypeScriptPlugin directly.
   *
   * This path is used when package-level diagrams are requested so that
   * tsAnalysis.moduleGraph is attached to the resulting ArchJSON.
   *
   * Renamed from parseTsProject to parseTsPlugin to clarify it uses the plugin system.
   */
  private async parseTsPlugin(diagram: DiagramConfig): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const registryPlugin = this.registry?.getByName('typescript');
    const plugin =
      registryPlugin ??
      (await (async () => {
        const { TypeScriptPlugin } = await import('@/plugins/typescript/index.js');
        return new TypeScriptPlugin();
      })());

    await plugin.initialize({ workspaceRoot });
    if (plugin.metadata?.customEntityTypes) {
      for (const decl of plugin.metadata.customEntityTypes) {
        globalEntityTypeRegistry.register(decl);
      }
    }
    return plugin.parseProject(workspaceRoot, {
      workspaceRoot,
      excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
    });
  }

  private async parseGenericLanguageProject(diagram: DiagramConfig): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const pluginName = diagram.language;

    if (pluginName === 'python') {
      const registryPlugin = this.registry?.getByName('python');
      const plugin =
        registryPlugin ??
        (await (async () => {
          const { PythonPlugin } = await import('@/plugins/python/index.js');
          return new PythonPlugin();
        })());

      await plugin.initialize({ workspaceRoot });
      if (plugin.metadata?.customEntityTypes) {
        for (const decl of plugin.metadata.customEntityTypes) {
          globalEntityTypeRegistry.register(decl);
        }
      }
      return plugin.parseProject(workspaceRoot, {
        workspaceRoot,
        excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
      });
    }

    if (pluginName === 'java') {
      const registryPlugin = this.registry?.getByName('java');
      const plugin =
        registryPlugin ??
        (await (async () => {
          const { JavaPlugin } = await import('@/plugins/java/index.js');
          return new JavaPlugin();
        })());

      await plugin.initialize({ workspaceRoot });
      if (plugin.metadata?.customEntityTypes) {
        for (const decl of plugin.metadata.customEntityTypes) {
          globalEntityTypeRegistry.register(decl);
        }
      }
      return plugin.parseProject(workspaceRoot, {
        workspaceRoot,
        excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
      });
    }

    if (pluginName === 'kotlin') {
      const registryPlugin = this.registry?.getByName('kotlin');
      const plugin =
        registryPlugin ??
        (await (async () => {
          const { KotlinPlugin } = await import('@/plugins/kotlin/index.js');
          return new KotlinPlugin();
        })());

      await plugin.initialize({ workspaceRoot });
      if (plugin.metadata?.customEntityTypes) {
        for (const decl of plugin.metadata.customEntityTypes) {
          globalEntityTypeRegistry.register(decl);
        }
      }
      return plugin.parseProject(workspaceRoot, {
        workspaceRoot,
        excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
      });
    }

    throw new Error(`Unsupported language plugin route: ${pluginName}`);
  }

  /**
   * Parse files via ParallelParser.
   * Disk cache logic stays in get() — this method receives pre-discovered files.
   */
  private async parseWithParallelParser(
    diagram: DiagramConfig,
    files: string[]
  ): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const parser = new ParallelParser({
      concurrency: this.globalConfig.concurrency,
      continueOnError: true,
      parseCache: this.parseCache,
      workspaceRoot,
    });
    return parser.parseFiles(files);
  }
}
