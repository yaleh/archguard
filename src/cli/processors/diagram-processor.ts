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

import { ArchJSONAggregator } from '@/parser/archjson-aggregator.js';
import { MetricsCalculator } from '@/parser/metrics-calculator.js';
import type { ParseCache } from '@/parser/parse-cache.js';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import type { ArchJSON, ArchJSONMetrics } from '@/types/index.js';
import type { QuerySourceGroup } from '@/cli/query/query-manifest.js';
import type { ProgressReporterLike } from '@/cli/progress.js';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';
import type { PluginRegistry } from '@/core/plugin-registry.js';
import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import { ArchJsonProvider, hashSources } from './arch-json-provider.js';
import { DiagramOutputRouter } from './diagram-output-router.js';
import { TestCoverageRenderer } from '@/mermaid/test-coverage-renderer.js';
import type { TestAnalysis } from '@/types/extensions.js';
import fs from 'fs-extra';
import pMap from 'p-map';
import os from 'os';
import path from 'path';

// Re-export so existing callers importing from diagram-processor are unaffected.
export { deriveSubModuleArchJSON } from './arch-json-provider.js';

/**
 * Internal representation of a query scope collected during diagram processing.
 * Re-exported from QuerySourceGroup for backward compatibility.
 */
export type InternalQueryScope = QuerySourceGroup;

/**
 * Options for DiagramProcessor
 */
export interface DiagramProcessorOptions {
  /** Array of diagram configurations to process */
  diagrams: DiagramConfig[];
  /** Global configuration settings */
  globalConfig: GlobalConfig;
  /** Progress reporter for user feedback */
  progress: ProgressReporterLike;
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
  /**
   * Structural metrics for this diagram (computed regardless of output format).
   * Used by DiagramIndexGenerator to render index.md stats tables.
   * Only present when success === true.
   */
  metrics?: ArchJSONMetrics;
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
  private progress: ProgressReporterLike;
  private aggregator: ArchJSONAggregator;
  private metricsCalculator: MetricsCalculator;
  private parallelProgress?: ParallelProgressReporter;
  private readonly provider: ArchJsonProvider;
  private readonly router: DiagramOutputRouter;
  private _lastArchJson: ArchJSON | null = null;

  constructor(options: DiagramProcessorOptions) {
    if (options.diagrams.length === 0) {
      throw new Error('At least one diagram configuration is required');
    }

    this.diagrams = options.diagrams;
    this.globalConfig = options.globalConfig;
    this.progress = options.progress;
    this.aggregator = new ArchJSONAggregator();
    this.metricsCalculator = new MetricsCalculator();
    this.provider = new ArchJsonProvider({
      globalConfig: options.globalConfig,
      parseCache: options.parseCache,
      registry: options.registry,
    });
    this.router = new DiagramOutputRouter(options.globalConfig, options.progress);
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
    const isGoAtlas = diagramCount === 1 && this.diagrams[0].language === 'go';
    const atlasLayerCount = isGoAtlas
      ? ((this.diagrams[0].languageSpecific?.atlas as { layers?: string[] } | undefined)?.layers
          ?.length ?? 4)
      : 0;
    const effectiveDiagramCount = Math.max(diagramCount, atlasLayerCount);
    const poolSize = Math.max(1, Math.min(os.cpus().length - 1, effectiveDiagramCount, 4));
    const poolTheme = this.globalConfig.mermaid?.theme ?? 'default';
    const pool = new MermaidRenderWorkerPool(poolSize, {
      theme: poolTheme,
      maxTextSize: 200000,
      transparentBackground: this.globalConfig.mermaid?.transparentBackground ?? false,
      themeVariables: undefined,
    });

    const needsRendering = this.diagrams.some(
      (d) => (d.format ?? this.globalConfig.format ?? 'mermaid') !== 'json'
    );
    if (needsRendering) pool.start();

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
        console.debug(`📊 Cache stats: ${this.provider.cacheSize()} entries`);
      }

      return results;
    } finally {
      // Terminate the render pool first (drains in-flight/queued jobs)
      await pool.terminate();

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
      const key = hashSources(diagram.sources, diagram.language);
      if (!sourceGroups.has(key)) {
        sourceGroups.set(key, []);
      }
      sourceGroups.get(key).push(diagram);
    }

    return sourceGroups;
  }

  /** Collector for query-layer scopes: one entry per unique source set that produced ArchJSON. */
  private queryScopes = new Map<string, InternalQueryScope>();

  /**
   * Register a query scope for the query layer.
   * Only registers if the ArchJSON has at least one entity and the key is not already present
   * (first registration wins to avoid overwriting with a derived copy).
   */
  private registerQueryScope(
    sources: string[],
    archJson: ArchJSON,
    kind: 'parsed' | 'derived',
    role?: 'primary' | 'secondary'
  ): void {
    if (!archJson.entities || archJson.entities.length === 0) return;
    const key = hashSources(sources, archJson.language);
    if (this.queryScopes.has(key)) return;
    const normalizedSources = sources.map((s) => path.resolve(s));
    this.queryScopes.set(key, {
      key,
      sources: normalizedSources,
      archJson,
      kind,
      role,
    });
  }

  /**
   * Return collected query scopes. Each scope represents a unique set of source
   * directories and the ArchJSON produced for them during processAll().
   */
  public getQuerySourceGroups(): InternalQueryScope[] {
    return Array.from(this.queryScopes.values());
  }

  /**
   * Return the first parsed ArchJSON from processAll().
   * Prefers the scope group with role === 'primary'; falls back to the first
   * successfully parsed ArchJSON if no primary role exists.
   * Returns null before processAll() is called or if all groups failed.
   */
  public getLastArchJson(): ArchJSON | null {
    return this._lastArchJson;
  }

  /**
   * Process a group of diagrams that share the same sources.
   * Delegates ArchJSON acquisition to ArchJsonProvider.
   *
   * @param _sourceKey - Hash key for the sources (kept for call-site convention)
   * @param diagrams - Array of diagrams sharing these sources
   * @returns Array of DiagramResult
   */
  private async processSourceGroup(
    _sourceKey: string,
    diagrams: DiagramConfig[],
    pool: MermaidRenderWorkerPool
  ): Promise<DiagramResult[]> {
    // NOTE: pre-parse progress.start (original behaviour for single-diagram runs) is intentionally
    // dropped; processDiagramWithArchJSON calls progress.start after parse. For single-diagram runs,
    // the progress indicator appears slightly later (post-parse). Acceptable trade-off.
    try {
      const needsModuleGraph = diagrams.some((d) => d.level === 'package');
      const firstDiagram = diagrams[0];
      const { archJson: rawArchJSON, kind } = await this.provider.get(firstDiagram, {
        needsModuleGraph,
      });
      this.registerQueryScope(firstDiagram.sources, rawArchJSON, kind, firstDiagram.queryRole);
      // Store ArchJSON for test analysis: first assignment wins, unless a primary role is found.
      // Check all diagrams in the group (they share sources, so any with queryRole='primary' wins).
      const groupHasPrimary = diagrams.some((d) => d.queryRole === 'primary');
      if (this._lastArchJson === null || groupHasPrimary) {
        this._lastArchJson = rawArchJSON;
      }
      return await pMap(
        diagrams,
        (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
        { concurrency: this.globalConfig.concurrency || os.cpus().length }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return diagrams.map((diagram) => ({
        name: diagram.name,
        success: false,
        error: errorMessage,
      }));
    }
  }

  /**
   * Generate a test coverage heatmap Markdown file with a four-bucket Mermaid diagram.
   *
   * Writes `test/coverage-heatmap.md` under the given outputDir. This method is
   * intentionally NOT called from processAll() — it is called from run-analysis.ts
   * after TestAnalyzer.analyze() completes and testAnalysis is available.
   *
   * @param analysis   The freshly computed TestAnalysis result.
   * @param archJson   The ArchJSON from which entity coverage is read.
   * @param outputDir  The base output directory (e.g. `.archguard`).
   */
  public async generateTestCoverageHeatmap(
    analysis: TestAnalysis,
    archJson: ArchJSON,
    outputDir: string
  ): Promise<void> {
    const renderer = new TestCoverageRenderer();
    const mermaidCode = renderer.render(analysis, archJson);

    const heatmapDir = path.join(outputDir, 'test');
    await fs.ensureDir(heatmapDir);

    const heatmapPath = path.join(heatmapDir, 'coverage-heatmap.md');
    const content = [
      '# Test Coverage Heatmap',
      '',
      '> Generated from test analysis — four buckets by coverage score',
      '',
      '```mermaid',
      mermaidCode,
      '```',
      '',
    ].join('\n');

    await fs.writeFile(heatmapPath, content, 'utf-8');
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
    pool: MermaidRenderWorkerPool
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

      // Compute metrics unconditionally so they can be attached to the DiagramResult
      // (consumers like DiagramIndexGenerator need them regardless of output format).
      // Always embed metrics so json format gets them; mermaid renderers ignore the field.
      const computedMetrics: ArchJSONMetrics = this.metricsCalculator.calculate(
        aggregatedJSON,
        diagram.level
      );
      const outputJSON = { ...aggregatedJSON, metrics: computedMetrics };

      await this.router.route(outputJSON, paths, diagram, pool);

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

      // For Go Atlas diagrams the package layer is the source of truth at package level.
      const atlasPackageLayer = aggregatedJSON.extensions?.goAtlas?.layers?.['package'];
      const usesAtlas = !!atlasPackageLayer && !usesModuleGraph;

      return {
        name: diagram.name,
        success: true,
        metrics: computedMetrics,
        paths: resultPaths,
        stats: {
          entities: usesModuleGraph
            ? moduleGraph.nodes.length
            : usesAtlas
              ? atlasPackageLayer.nodes.length
              : aggregatedJSON.entities.length,
          relations: usesModuleGraph
            ? moduleGraph.edges.length
            : usesAtlas
              ? atlasPackageLayer.edges.length
              : aggregatedJSON.relations.length,
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
}
