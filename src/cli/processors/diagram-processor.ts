/**
 * DiagramProcessor - Unified diagram processing component (v2.0 core)
 *
 * Key Features:
 * - Processes multiple diagrams independently
 * - Unified processing flow (no mode branches)
 * - Each diagram uses the same DiagramConfig structure
 * - Failures are isolated (one diagram failure doesn't affect others)
 * - Supports all detail levels (package/class/method)
 * - Supports all output formats (mermaid/json)
 *
 * @module cli/processors/diagram-processor
 * @version 2.0.0
 */

import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';
import { ParallelParser } from '@/parser/parallel-parser.js';
import { ArchJSONAggregator } from '@/parser/archjson-aggregator.js';
import { MetricsCalculator } from '@/parser/metrics-calculator.js';
import type { ParseCache } from '@/parser/parse-cache.js';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';
import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator.js';
import type { DiagramConfig, GlobalConfig, OutputFormat, DetailLevel } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporter } from '@/cli/progress.js';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';
import type { PluginRegistry } from '@/core/plugin-registry.js';
import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import { ArchJsonDiskCache } from '@/cli/cache/arch-json-disk-cache.js';
import fs from 'fs-extra';
import pMap from 'p-map';
import os from 'os';
import { createHash } from 'crypto';
import path from 'path';

/**
 * Options for DiagramProcessor
 */
export interface DiagramProcessorOptions {
  /** Array of diagram configurations to process */
  diagrams: DiagramConfig[];
  /** Global configuration settings */
  globalConfig: GlobalConfig;
  /** Progress reporter for user feedback */
  progress: ProgressReporter;
  /**
   * Optional parse-time cache shared across all diagrams in this invocation.
   * Eliminates redundant TypeScriptParser instantiation for files that appear
   * in multiple overlapping source sets.
   */
  parseCache?: ParseCache;
  /**
   * Optional plugin registry for language routing.
   * When provided, language-specific diagrams are routed through the registered
   * plugins instead of hardcoded dynamic imports.
   */
  registry?: PluginRegistry;
}

/**
 * Result from processing a single diagram
 */
export interface DiagramResult {
  /** Diagram name */
  name: string;
  /** Whether processing succeeded */
  success: boolean;
  /** Output file paths (if successful) */
  paths?: {
    mmd?: string;
    svg?: string;
    png?: string;
    json?: string;
  };
  /** Processing statistics (if successful) */
  stats?: {
    entities: number;
    relations: number;
    parseTime: number;
  };
  /** Error message (if failed) */
  error?: string;
}

/**
 * Derive a sub-module ArchJSON from a parent by filtering to entities
 * whose filePath starts with subPath. Relations where both endpoints
 * are in the sub-module are retained. moduleGraph is filtered similarly.
 *
 * @param parent - The parent ArchJSON to derive from
 * @param subPath - The sub-path to filter by (may be absolute)
 * @param workspaceRoot - Optional workspace root; when provided, enables matching
 *   of relative entity filePaths against an absolute subPath. TypeScriptParser
 *   stores filePaths relative to the workspace root (source directory), so without
 *   this parameter, absolute subPaths would never match relative filePaths.
 */
export function deriveSubModuleArchJSON(
  parent: ArchJSON,
  subPath: string,
  workspaceRoot?: string,
): ArchJSON {
  const normSub = subPath.replace(/\\/g, '/').replace(/\/$/, '');

  // Compute the relative sub-path for matching against relative entity filePaths.
  // TypeScriptParser stores filePaths relative to workspaceRoot (the source directory).
  let relSub: string | null = null;
  if (workspaceRoot) {
    const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (normSub.startsWith(normRoot + '/')) {
      relSub = normSub.slice(normRoot.length + 1); // e.g., 'shared'
    } else if (normSub === normRoot) {
      relSub = ''; // sub-path IS the root → match everything
    }
  }

  // Filter entities: try absolute match first, then relative if workspaceRoot provided.
  // TypeScriptParser encodes the relative file path in entity.id as "<relPath>.<name>".
  // When filePath is absent, extract it from id: id.slice(0, id.length - name.length - 1).
  const entities = parent.entities.filter((e) => {
    // Primary: explicit filePath field (may be absent in TypeScript parser output)
    let fp = ((e as unknown as { filePath?: string }).filePath ?? '').replace(/\\/g, '/');
    // Fallback: extract relative file path from entity id ("<relPath>.<name>")
    if (!fp && e.name && e.id.endsWith('.' + e.name)) {
      fp = e.id.slice(0, e.id.length - e.name.length - 1).replace(/\\/g, '/');
    }
    if (!fp) return false;
    // Absolute path match (original behavior)
    if (fp.startsWith(normSub + '/') || fp === normSub) return true;
    // Relative path match (when workspaceRoot is provided)
    if (relSub !== null) {
      if (relSub === '') return true; // root covers everything
      if (fp.startsWith(relSub + '/') || fp === relSub) return true;
    }
    return false;
  });
  const ids = new Set(entities.map((e) => e.id));

  // Filter relations
  const relations = (parent.relations ?? []).filter(
    (r) => ids.has(r.source) && ids.has(r.target)
  );

  // Filter moduleGraph if present
  let extensions = parent.extensions;
  const mg = parent.extensions?.tsAnalysis?.moduleGraph;
  if (mg) {
    // TsModuleNode.id is a relative module path (e.g. "src/core").
    // Derive the relative prefix from normSub by taking the last 2 path segments
    // (heuristic for standard src/* layout; works for web-llm case).
    const parts = normSub.split('/').filter(Boolean);
    const relPrefix = parts.length >= 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] ?? normSub;

    const filteredNodes = mg.nodes.filter(
      (n) => n.id === relPrefix || n.id.startsWith(relPrefix + '/')
    );
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = mg.edges.filter(
      (e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)
    );
    const filteredCycles = (mg.cycles ?? []).filter(
      (c) => c.modules.every((m) => filteredNodeIds.has(m))
    );
    extensions = {
      ...parent.extensions,
      tsAnalysis: {
        ...parent.extensions!.tsAnalysis!,
        moduleGraph: {
          nodes: filteredNodes,
          edges: filteredEdges,
          cycles: filteredCycles,
        } as import('@/types/extensions.js').TsModuleGraph,
      },
    };
  }

  return { ...parent, entities, relations, extensions };
}

/**
 * DiagramProcessor - Unified diagram processor
 *
 * Usage:
 * ```typescript
 * const processor = new DiagramProcessor({
 *   diagrams: [
 *     { name: 'overview', sources: ['./src'], level: 'package' },
 *     { name: 'frontend', sources: ['./src/frontend'], level: 'class' }
 *   ],
 *   globalConfig,
 *   progress
 * });
 *
 * const results = await processor.processAll();
 * ```
 */
export class DiagramProcessor {
  private diagrams: DiagramConfig[];
  private globalConfig: GlobalConfig;
  private progress: ProgressReporter;
  private fileDiscovery: FileDiscoveryService;
  private aggregator: ArchJSONAggregator;
  private metricsCalculator: MetricsCalculator;
  private parallelProgress?: ParallelProgressReporter;
  private parseCache?: ParseCache;
  private registry?: PluginRegistry;
  private archJsonDiskCache: ArchJsonDiskCache;

  constructor(options: DiagramProcessorOptions) {
    if (options.diagrams.length === 0) {
      throw new Error('At least one diagram configuration is required');
    }

    this.diagrams = options.diagrams;
    this.globalConfig = options.globalConfig;
    this.progress = options.progress;
    this.fileDiscovery = new FileDiscoveryService();
    this.aggregator = new ArchJSONAggregator();
    this.metricsCalculator = new MetricsCalculator();
    this.parseCache = options.parseCache;
    this.registry = options.registry;
    const diskCacheDir = path.join(os.homedir(), '.archguard', 'cache', 'archjson');
    this.archJsonDiskCache = new ArchJsonDiskCache(diskCacheDir);
  }

  /**
   * Process all diagrams in parallel
   *
   * Each diagram is processed independently. If one fails, others continue.
   * Uses p-map for concurrent processing with configurable concurrency limit.
   * Shows parallel progress bars when processing multiple diagrams.
   *
   * Groups diagrams by source hash to reuse cached ArchJSON results.
   *
   * @returns Array of DiagramResult
   */
  async processAll(): Promise<DiagramResult[]> {
    const concurrency = this.globalConfig.concurrency || os.cpus().length;

    // Initialize parallel progress for multiple diagrams
    if (this.diagrams.length > 1) {
      const diagramNames = this.diagrams.map((d) => d.name);
      this.parallelProgress = new ParallelProgressReporter(diagramNames);
    }

    // Create worker pool for parallel SVG rendering.
    // For single diagrams we normally skip the pool, but Go Atlas diagrams render
    // 4 layers concurrently so we treat the layer count as the effective diagram count.
    const diagramCount = this.diagrams.length;
    const isGoAtlas =
      diagramCount === 1 && this.diagrams[0].language === 'go';
    const atlasLayerCount = isGoAtlas
      ? ((this.diagrams[0].languageSpecific?.atlas as { layers?: string[] } | undefined)
          ?.layers?.length ?? 4)
      : 0;
    const effectiveDiagramCount = Math.max(diagramCount, atlasLayerCount);
    const poolSize = effectiveDiagramCount >= 2 ? Math.min(os.cpus().length, effectiveDiagramCount, 4) : 0;
    const poolTheme = typeof this.globalConfig.mermaid?.theme === 'string'
      ? this.globalConfig.mermaid.theme
      : (this.globalConfig.mermaid?.theme as any)?.name ?? 'default';
    const pool = poolSize > 0
      ? new MermaidRenderWorkerPool(poolSize, {
          theme: poolTheme,
          backgroundColor: this.globalConfig.mermaid?.transparentBackground ? 'transparent' : 'white',
        })
      : null;

    if (pool) await pool.start();

    try {
      // Group diagrams by source hash to enable caching
      const sourceGroups = this.groupDiagramsBySource();

      // Process each source group
      const groupResults = await pMap(
        Array.from(sourceGroups.entries()),
        async ([sourceKey, diagrams]) => {
          // All diagrams in this group share the same sources
          // Parse once and reuse ArchJSON
          return await this.processSourceGroup(sourceKey, diagrams, pool);
        },
        { concurrency: Math.min(concurrency, sourceGroups.size) }
      );

      // Flatten results
      const results = groupResults.flat();

      // Log cache statistics in debug mode
      if (process.env.ArchGuardDebug === 'true') {
        console.debug(`📊 Cache stats: ${this.archJsonCache.size} entries`);
      }

      return results;
    } finally {
      // Terminate the render pool first (drains in-flight/queued jobs)
      await pool?.terminate();

      // Stop parallel progress when done
      if (this.parallelProgress) {
        this.parallelProgress.stop();
      }
    }
  }

  /**
   * Group diagrams by their source hash for caching
   *
   * @returns Map of source hash to array of diagrams
   */
  private groupDiagramsBySource(): Map<string, DiagramConfig[]> {
    const sourceGroups = new Map<string, DiagramConfig[]>();

    for (const diagram of this.diagrams) {
      const key = this.hashSources(diagram.sources);
      if (!sourceGroups.has(key)) {
        sourceGroups.set(key, []);
      }
      sourceGroups.get(key).push(diagram);
    }

    return sourceGroups;
  }

  /**
   * Generate hash key from source files
   *
   * @param sources - Array of source directory paths
   * @returns SHA-256 hash string (first 8 characters)
   */
  private hashSources(sources: string[]): string {
    const normalized = sources
      .map((s) => s.replace(/\\/g, '/'))
      .sort()
      .join('|');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  }

  /** Atomically write to archJsonCache and archJsonPathIndex. */
  private cacheArchJson(sources: string[], archJson: ArchJSON): void {
    const key = this.hashSources(sources);
    this.archJsonCache.set(key, archJson);
    for (const s of sources) {
      this.archJsonPathIndex.set(s.replace(/\\/g, '/'), key);
    }
  }

  /**
   * Register a parse promise in archJsonDeferred so concurrent sub-groups can await it.
   * When the promise resolves, caches the result and removes the deferred entry.
   */
  private registerDeferred(
    sources: string[],
    parsePromise: Promise<ArchJSON>
  ): Promise<ArchJSON> {
    const key = this.hashSources(sources);
    const withCaching = parsePromise.then((result) => {
      this.cacheArchJson(sources, result);
      this.archJsonDeferred.delete(key);
      return result;
    });
    this.archJsonDeferred.set(key, { promise: withCaching, sources });
    return withCaching;
  }

  /**
   * Check whether a completed or in-progress parent parse covers all given sources.
   * Returns deferred promise (if parent still parsing) or null (if already complete or not found),
   * plus the matched parent path string.
   */
  private findParentCoverage(sources: string[]): {
    deferred: Promise<ArchJSON> | null;
    normParentPath: string | null;
  } {
    const normSources = sources.map((s) => s.replace(/\\/g, '/'));

    // Check already-completed entries in the path index
    for (const [indexedPath] of this.archJsonPathIndex) {
      if (normSources.every((s) => s.startsWith(indexedPath + '/') || s === indexedPath)) {
        return { deferred: null, normParentPath: indexedPath };
      }
    }

    // Check in-progress deferred entries
    for (const [, { promise, sources: parentSources }] of this.archJsonDeferred) {
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

  /**
   * Cache key for parsed ArchJSON results
   * Maps source hash to parsed ArchJSON
   */
  private archJsonCache = new Map<string, ArchJSON>();

  /** Reverse index: normalised source path → archJsonCache key, for parent-path lookup */
  private archJsonPathIndex = new Map<string, string>();

  /**
   * Deferred promises for in-progress parses.
   * Each entry: { promise: resolves with the parsed ArchJSON, sources: the sources being parsed }
   * Groups that detect a potential parent await this promise before checking the index.
   */
  private archJsonDeferred = new Map<string, { promise: Promise<ArchJSON>; sources: string[] }>();

  /**
   * Process a group of diagrams that share the same sources
   *
   * @param sourceKey - Hash key for the sources
   * @param diagrams - Array of diagrams sharing these sources
   * @returns Array of DiagramResult
   */
  private async processSourceGroup(
    sourceKey: string,
    diagrams: DiagramConfig[],
    pool: MermaidRenderWorkerPool | null = null
  ): Promise<DiagramResult[]> {
    // For single diagram, use original progress reporter
    if (!this.parallelProgress && diagrams.length === 1) {
      this.progress.start(`Processing diagram: ${diagrams[0].name}`);
    }

    try {
      // Route Go diagrams through the Go plugin system
      const firstDiagram = diagrams[0];
      if (firstDiagram.language === 'go') {
        const rawArchJSON = await this.registerDeferred(
          firstDiagram.sources,
          this.parseGoProject(firstDiagram)
        );

        const results = await pMap(
          diagrams,
          async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
          { concurrency: this.globalConfig.concurrency || os.cpus().length }
        );
        return results;
      }

      // Route C++ diagrams through the CppPlugin
      if (firstDiagram.language === 'cpp') {
        const rawArchJSON = await this.registerDeferred(
          firstDiagram.sources,
          this.parseCppProject(firstDiagram)
        );

        const results = await pMap(
          diagrams,
          async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
          { concurrency: this.globalConfig.concurrency || os.cpus().length }
        );
        return results;
      }

      // Route TypeScript package-level diagrams through TypeScriptPlugin so that
      // tsAnalysis.moduleGraph is populated and the TsModuleGraph renderer can be used.
      const needsModuleGraph = diagrams.some((d) => d.level === 'package');
      if (needsModuleGraph && (!firstDiagram.language || firstDiagram.language === 'typescript')) {
        // Discover files for cache key before invoking ts-morph
        const tsFiles = await this.fileDiscovery.discoverFiles({
          sources: firstDiagram.sources,
          exclude: firstDiagram.exclude || this.globalConfig.exclude,
          skipMissing: false,
        });
        const diskCacheEnabled = this.globalConfig.cache?.enabled !== false;
        const diskKey = diskCacheEnabled && tsFiles.length > 0 ? await this.archJsonDiskCache.computeKey(tsFiles) : null;
        let cachedArchJSON: ArchJSON | null = null;
        if (diskKey) {
          cachedArchJSON = await this.archJsonDiskCache.get(diskKey);
          if (cachedArchJSON && process.env.ArchGuardDebug === 'true') {
            console.debug(`💾 Disk cache hit for ts-morph path: ${firstDiagram.sources.join(', ')}`);
          }
        }

        const rawArchJSON = cachedArchJSON
          ? cachedArchJSON
          : await this.registerDeferred(
              firstDiagram.sources,
              this.parseTsProject(firstDiagram).then(async (result) => {
                if (diskKey) await this.archJsonDiskCache.set(diskKey, result);
                return result;
              })
            );

        const results = await pMap(
          diagrams,
          async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
          { concurrency: this.globalConfig.concurrency || os.cpus().length }
        );
        return results;
      }

      // Discover files from sources (all diagrams in group use same sources)
      const files = await this.fileDiscovery.discoverFiles({
        sources: diagrams[0].sources,
        exclude: diagrams[0].exclude || this.globalConfig.exclude,
        skipMissing: false,
      });

      if (files.length === 0) {
        throw new Error(`No TypeScript files found in sources: ${diagrams[0].sources.join(', ')}`);
      }

      // Check cache for parsed ArchJSON
      let rawArchJSON = this.archJsonCache.get(sourceKey);
      if (!rawArchJSON) {
        // Check whether a parent parse (completed or in-progress) covers these sources
        const { deferred, normParentPath } = this.findParentCoverage(diagrams[0].sources);

        if (deferred) {
          // Parent is still parsing; wait for it then derive sub-module ArchJSON
          const parentArchJSON = await deferred;
          rawArchJSON = deriveSubModuleArchJSON(parentArchJSON, diagrams[0].sources[0], normParentPath ?? undefined);
          if (process.env.ArchGuardDebug === 'true') {
            console.debug(`🔗 Awaited parent and derived ArchJSON for ${diagrams[0].sources.join(', ')} from ${normParentPath}`);
          }
        } else if (normParentPath) {
          // Parent already complete; derive immediately from cache
          const parentCacheKey = this.archJsonPathIndex.get(normParentPath)!;
          const parentArchJSON = this.archJsonCache.get(parentCacheKey)!;
          rawArchJSON = deriveSubModuleArchJSON(parentArchJSON, diagrams[0].sources[0], normParentPath);
          if (process.env.ArchGuardDebug === 'true') {
            console.debug(`🔗 Derived ArchJSON for ${diagrams[0].sources.join(', ')} from ${normParentPath}`);
          }
        } else {
          if (process.env.ArchGuardDebug === 'true') {
            console.debug(`🔍 Cache miss for ${sourceKey}: ${diagrams[0].sources.join(', ')}`);
          }

          // Check disk cache before expensive parse
          const diskCacheEnabled2 = this.globalConfig.cache?.enabled !== false;
          const diskKey = diskCacheEnabled2 ? await this.archJsonDiskCache.computeKey(files) : null;
          const diskCached = diskKey ? await this.archJsonDiskCache.get(diskKey) : null;
          if (diskCached) {
            rawArchJSON = diskCached;
            if (process.env.ArchGuardDebug === 'true') {
              console.debug(`💾 Disk cache hit for ParallelParser path: ${diagrams[0].sources.join(', ')}`);
            }
          } else {
            // Parse files in parallel
            const parser = new ParallelParser({
              concurrency: this.globalConfig.concurrency,
              continueOnError: true,
              parseCache: this.parseCache,
            });
            rawArchJSON = await parser.parseFiles(files);
            if (diskKey) await this.archJsonDiskCache.set(diskKey, rawArchJSON);
          }

          // Cache the raw parsed result
          this.cacheArchJson(diagrams[0].sources, rawArchJSON);
        }
      } else if (process.env.ArchGuardDebug === 'true') {
        console.debug(`📦 Cache hit for ${sourceKey}: ${diagrams[0].sources.join(', ')}`);
      }

      // Process all diagrams in this group in parallel, using cached ArchJSON
      const results = await pMap(
        diagrams,
        async (diagram) => {
          return await this.processDiagramWithArchJSON(diagram, rawArchJSON, pool);
        },
        { concurrency: this.globalConfig.concurrency || os.cpus().length }
      );

      return results;
    } catch (error) {
      // If the entire group fails, return error results for all diagrams in the group
      const errorMessage = error instanceof Error ? error.message : String(error);
      return diagrams.map((diagram) => ({
        name: diagram.name,
        success: false,
        error: errorMessage,
      }));
    }
  }

  /**
   * Process a single diagram with pre-parsed ArchJSON
   *
   * @param diagram - Diagram configuration
   * @param rawArchJSON - Pre-parsed ArchJSON (before aggregation)
   * @returns DiagramResult
   */
  private async processDiagramWithArchJSON(
    diagram: DiagramConfig,
    rawArchJSON: ArchJSON,
    pool: MermaidRenderWorkerPool | null = null
  ): Promise<DiagramResult> {
    const startTime = Date.now();

    try {
      // For single diagram, use original progress reporter
      if (!this.parallelProgress) {
        this.progress.start(`Processing diagram: ${diagram.name}`);
      }

      // 1. Aggregate to specified level
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 50, 'Aggregating');
      }
      const aggregatedJSON = this.aggregator.aggregate(rawArchJSON, diagram.level);

      // 2. Resolve output paths
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 60, 'Preparing output');
      }
      const pathResolver = new OutputPathResolver({
        outputDir: this.globalConfig.outputDir,
        output: undefined, // Not using legacy output field
      });

      const paths = pathResolver.resolve({ name: diagram.name });
      await pathResolver.ensureDirectory({ name: diagram.name });

      // 3. Generate output based on format
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 70, 'Generating output');
      }
      const format = diagram.format || this.globalConfig.format;

      // For json format: compute metrics and produce a new object (never mutate aggregatedJSON or rawArchJSON,
      // as rawArchJSON may be a shared cached reference returned by the 'method'-level aggregator).
      const outputJSON =
        format === 'json'
          ? { ...aggregatedJSON, metrics: this.metricsCalculator.calculate(aggregatedJSON, diagram.level) }
          : aggregatedJSON;

      await this.generateOutput(outputJSON, paths, format, diagram.level, diagram, pool);

      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 90, 'Finalizing');
      }

      const parseTime = Date.now() - startTime;

      if (this.parallelProgress) {
        this.parallelProgress.complete(diagram.name);
      } else {
        this.progress.succeed(`Diagram ${diagram.name} completed`);
      }

      // Build result paths based on format
      const resultPaths: DiagramResult['paths'] = {};
      if (format === 'json') {
        resultPaths.json = paths.paths.json;
      } else if (format === 'mermaid') {
        resultPaths.mmd = paths.paths.mmd;
        resultPaths.svg = paths.paths.svg;
        resultPaths.png = paths.paths.png;
      }

      // For package-level TS diagrams the rendered output comes from the
      // TsModuleGraph extension, not from aggregatedJSON.entities/relations.
      // Use moduleGraph counts so index.md reflects the actual diagram content.
      const moduleGraph = aggregatedJSON.extensions?.tsAnalysis?.moduleGraph;
      const usesModuleGraph = diagram.level === 'package' && !!moduleGraph;

      return {
        name: diagram.name,
        success: true,
        paths: resultPaths,
        stats: {
          entities: usesModuleGraph ? moduleGraph.nodes.length : aggregatedJSON.entities.length,
          relations: usesModuleGraph ? moduleGraph.edges.length : aggregatedJSON.relations.length,
          parseTime,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.parallelProgress) {
        this.parallelProgress.fail(diagram.name);
      } else {
        this.progress.fail(`Diagram ${diagram.name} failed: ${errorMessage}`);
      }

      return {
        name: diagram.name,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Parse a Go project via the plugin registry (preferred) or GoAtlasPlugin directly.
   *
   * When a PluginRegistry is provided and has a 'golang' plugin registered, that
   * plugin is used. Otherwise falls back to a dynamic import of GoAtlasPlugin.
   *
   * @param diagram - Diagram configuration with language === 'go'
   * @returns Parsed ArchJSON (with optional Atlas extensions)
   */
  private async parseGoProject(diagram: DiagramConfig): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const registryPlugin = this.registry?.getByName('golang');
    const plugin = registryPlugin ?? await (async () => {
      const { GoAtlasPlugin } = await import('@/plugins/golang/atlas/index.js');
      return new GoAtlasPlugin();
    })();

    await plugin.initialize({ workspaceRoot });
    return plugin.parseProject(workspaceRoot, {
      workspaceRoot,
      excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
      languageSpecific: diagram.languageSpecific,
    });
  }

  /**
   * Parse a C++ project via the CppPlugin.
   *
   * @param diagram - Diagram configuration with language === 'cpp'
   * @returns Parsed ArchJSON
   */
  private async parseCppProject(diagram: DiagramConfig): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const registryPlugin = this.registry?.getByName('cpp');
    const plugin = registryPlugin ?? await (async () => {
      const { CppPlugin } = await import('@/plugins/cpp/index.js');
      return new CppPlugin();
    })();

    await plugin.initialize({ workspaceRoot });
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
   * When a PluginRegistry is provided and has a 'typescript' plugin registered, that
   * plugin is used. Otherwise falls back to a dynamic import of TypeScriptPlugin.
   *
   * @param diagram - Diagram configuration
   * @returns Parsed ArchJSON with tsAnalysis extension attached
   */
  private async parseTsProject(diagram: DiagramConfig): Promise<ArchJSON> {
    const workspaceRoot = path.resolve(diagram.sources[0]);
    const registryPlugin = this.registry?.getByName('typescript');
    const plugin = registryPlugin ?? await (async () => {
      const { TypeScriptPlugin } = await import('@/plugins/typescript/index.js');
      return new TypeScriptPlugin();
    })();

    await plugin.initialize({ workspaceRoot });
    return plugin.parseProject(workspaceRoot, {
      workspaceRoot,
      excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
    });
  }

  /**
   * Generate output based on format
   *
   * @param archJSON - Architecture JSON
   * @param paths - Output paths
   * @param format - Output format
   * @param level - Detail level
   * @param diagram - Diagram configuration (v2.1.0: for metadata)
   */
  private async generateOutput(
    archJSON: ArchJSON,
    paths: { paths: { json: string; mmd: string; png: string; svg: string } },
    format: OutputFormat,
    level: DetailLevel,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null = null
  ): Promise<void> {
    switch (format) {
      case 'json':
        // Write JSON file directly
        await fs.writeJson(paths.paths.json, archJSON, { spaces: 2 });
        break;

      case 'mermaid':
        // Route Go Atlas diagrams to AtlasRenderer (4-layer flowchart output)
        if (archJSON.extensions?.goAtlas) {
          await this.generateAtlasOutput(archJSON, paths, diagram, pool);
        } else if (level === 'package' && archJSON.extensions?.tsAnalysis?.moduleGraph) {
          // Route TypeScript package-level diagrams to TsModuleGraph renderer
          await this.generateTsModuleGraphOutput(archJSON, paths, diagram, pool);
        } else {
          // Generate standard Mermaid classDiagram
          const mermaidGenerator = new MermaidDiagramGenerator(this.globalConfig, this.progress);
          await mermaidGenerator.generateAndRender(
            archJSON,
            {
              outputDir: paths.paths.mmd.replace(/\/[^/]+$/, ''),
              baseName: paths.paths.mmd.replace(/^.*\/([^/]+)\.mmd$/, '$1'),
              paths: paths.paths,
            },
            level,
            diagram // v2.1.0: Pass diagram config for metadata
          );
        }
        break;

      default:
        const exhaustiveCheck: never = format;
        throw new Error(`Unsupported format: ${exhaustiveCheck}`);
    }
  }

  /**
   * Generate Go Architecture Atlas output (4-layer flowchart diagrams)
   *
   * Renders each requested Atlas layer as a separate Mermaid flowchart file:
   *   {name}-package.mmd/svg/png    - Package dependency graph
   *   {name}-capability.mmd/svg/png - Capability graph
   *   {name}-goroutine.mmd/svg/png  - Goroutine topology
   *   {name}-flow.mmd/svg/png       - Flow graph
   *   {name}-atlas.json             - Full Atlas data
   *
   * @param archJSON - Architecture JSON with goAtlas extension
   * @param paths - Base output paths
   * @param diagram - Diagram configuration
   */
  private async generateAtlasOutput(
    archJSON: ArchJSON,
    paths: { paths: { json: string; mmd: string; png: string; svg: string } },
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null = null
  ): Promise<void> {
    const { AtlasRenderer } = await import('@/plugins/golang/atlas/renderers/atlas-renderer.js');
    const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

    const atlas = archJSON.extensions.goAtlas;
    const renderer = new AtlasRenderer();

    // Determine which layers to render (from config or default to all 4)
    const requestedLayers: string[] = (
      diagram.languageSpecific?.atlas as { layers?: string[] } | undefined
    )?.layers ?? ['package', 'capability', 'goroutine', 'flow'];

    // Only render layers that have actual data
    const availableLayers = requestedLayers.filter(
      (layer) => atlas.layers[layer as keyof typeof atlas.layers]
    );

    // Derive base path by stripping .mmd extension
    const basePath = paths.paths.mmd.replace(/\.mmd$/, '');

    // Build renderer options from global config
    const rendererOptions: Record<string, unknown> = {};
    if (this.globalConfig.mermaid?.theme) {
      rendererOptions.theme =
        typeof this.globalConfig.mermaid.theme === 'string'
          ? { name: this.globalConfig.mermaid.theme }
          : this.globalConfig.mermaid.theme;
    }
    if (this.globalConfig.mermaid?.transparentBackground) {
      rendererOptions.backgroundColor = 'transparent';
    }

    const mermaidRenderer = new IsomorphicMermaidRenderer(rendererOptions as any);

    console.log('\n🗺️  Generating Go Architecture Atlas...');

    await Promise.all(availableLayers.map(async (layer) => {
      const result = await renderer.render(
        atlas,
        layer as Parameters<typeof renderer.render>[1],
        'mermaid'
      );

      const layerPaths = {
        mmd: `${basePath}-${layer}.mmd`,
        svg: `${basePath}-${layer}.svg`,
        png: `${basePath}-${layer}.png`,
      };

      // Write MMD and SVG unconditionally; attempt PNG separately so large
      // diagrams that exceed the pixel limit still produce MMD + SVG.
      await fs.ensureDir(path.dirname(layerPaths.mmd));
      await fs.writeFile(layerPaths.mmd, result.content, 'utf-8');

      // Render SVG: use worker pool if available, fall back to main thread
      let svg: string;
      if (pool) {
        const poolResult = await pool.render({ mermaidCode: result.content });
        if (!poolResult.success) {
          console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
          svg = await mermaidRenderer.renderSVG(result.content);
        } else {
          svg = poolResult.svg!;
        }
      } else {
        svg = await mermaidRenderer.renderSVG(result.content);
      }

      let pngFailed = false;
      await Promise.all([
        fs.writeFile(layerPaths.svg, svg, 'utf-8'),
        mermaidRenderer.convertSVGToPNG(svg, layerPaths.png).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ⚠️  ${layer} PNG skipped (${msg}) — MMD + SVG saved`);
          pngFailed = true;
        }),
      ]);
      console.log(`  ✅ ${layer}: ${layerPaths.mmd}${pngFailed ? ' (no PNG)' : ''}`);
    }));

    // Save full Atlas JSON alongside the layer diagrams
    const atlasJsonPath = `${basePath}-atlas.json`;
    await fs.writeJson(atlasJsonPath, atlas, { spaces: 2 });
    console.log(`  📊 Atlas JSON: ${atlasJsonPath}`);
    console.log(`\n✨ Atlas layers: ${availableLayers.join(', ')}`);
  }

  /**
   * Generate TypeScript module dependency graph output.
   *
   * Renders a TsModuleGraph as a Mermaid flowchart diagram:
   *   {name}.mmd  - Mermaid source
   *   {name}.svg  - SVG rendering
   *   {name}.png  - PNG rendering (best effort)
   *
   * @param archJSON - Architecture JSON with tsAnalysis extension
   * @param paths - Base output paths
   * @param diagram - Diagram configuration
   */
  private async generateTsModuleGraphOutput(
    archJSON: ArchJSON,
    paths: { paths: { json: string; mmd: string; png: string; svg: string } },
    _diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null = null
  ): Promise<void> {
    const { renderTsModuleGraph } = await import('@/mermaid/ts-module-graph-renderer.js');
    const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

    const moduleGraph = archJSON.extensions.tsAnalysis.moduleGraph;
    const mmdContent = renderTsModuleGraph(moduleGraph);

    const rendererOptions: Record<string, unknown> = {};
    if (this.globalConfig.mermaid?.theme) {
      rendererOptions.theme =
        typeof this.globalConfig.mermaid.theme === 'string'
          ? { name: this.globalConfig.mermaid.theme }
          : this.globalConfig.mermaid.theme;
    }
    if (this.globalConfig.mermaid?.transparentBackground) {
      rendererOptions.backgroundColor = 'transparent';
    }

    const mermaidRenderer = new IsomorphicMermaidRenderer(rendererOptions as any);

    await fs.ensureDir(path.dirname(paths.paths.mmd));
    await fs.writeFile(paths.paths.mmd, mmdContent, 'utf-8');

    // Render SVG: use worker pool if available, fall back to main thread
    let svg: string;
    if (pool) {
      const poolResult = await pool.render({ mermaidCode: mmdContent });
      if (!poolResult.success) {
        console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
        svg = await mermaidRenderer.renderSVG(mmdContent);
      } else {
        svg = poolResult.svg!;
      }
    } else {
      svg = await mermaidRenderer.renderSVG(mmdContent);
    }

    await Promise.all([
      fs.writeFile(paths.paths.svg, svg, 'utf-8'),
      mermaidRenderer.convertSVGToPNG(svg, paths.paths.png).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  TS module graph PNG skipped (${msg}) — MMD + SVG saved`);
      }),
    ]);
  }
}
