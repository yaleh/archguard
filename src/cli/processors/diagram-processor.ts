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
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import type { ArchJSON, ArchJSONMetrics } from '@/types/index.js';
import type { QuerySourceGroup } from '@/cli/query/query-manifest.js';
import type { ProgressReporterLike } from '@/cli/progress.js';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';
import type { PluginRegistry } from '@/core/plugin-registry.js';
import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import { ArchJsonProvider, hashSources } from './arch-json-provider.js';
import { DiagramOutputRouter } from './diagram-output-router.js';
import { generateTestCoverageHeatmap } from './test-coverage-writer.js';
import { WorkerPoolFactory } from './worker-pool-factory.js';
import { QueryScopeCollector } from './query-scope-collector.js';
import { DiagramPipelineRunner } from './diagram-pipeline-runner.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';
import pMap from 'p-map';
import os from 'os';

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
  /**
   * Optional worker pool factory for creating MermaidRenderWorkerPool instances.
   * Primarily used in tests to inject a mock pool factory.
   */
  poolFactory?: WorkerPoolFactory;
  /**
   * Optional query scope collector for accumulating query-layer scopes.
   * Primarily used in tests to inject a mock collector.
   */
  collector?: QueryScopeCollector;
  /**
   * Optional diagram pipeline runner for processing individual diagrams.
   * Primarily used in tests to inject a mock runner.
   */
  runner?: DiagramPipelineRunner;
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
  private parallelProgress?: ParallelProgressReporter;
  private readonly provider: ArchJsonProvider;
  private readonly router: DiagramOutputRouter;
  private readonly poolFactory: WorkerPoolFactory;
  private readonly collector: QueryScopeCollector;
  private readonly runner: DiagramPipelineRunner;

  constructor(options: DiagramProcessorOptions) {
    if (options.diagrams.length === 0) {
      throw new Error('At least one diagram configuration is required');
    }

    this.diagrams = options.diagrams;
    this.globalConfig = options.globalConfig;
    this.progress = options.progress;
    this.provider = new ArchJsonProvider({
      globalConfig: options.globalConfig,
      parseCache: options.parseCache,
      registry: options.registry,
    });
    this.router = new DiagramOutputRouter(options.globalConfig, options.progress);
    this.poolFactory = options.poolFactory ?? new WorkerPoolFactory();
    this.collector = options.collector ?? new QueryScopeCollector();
    this.runner =
      options.runner ??
      new DiagramPipelineRunner(
        new ArchJSONAggregator(),
        new MetricsCalculator(),
        this.router,
        options.globalConfig,
        options.progress
      );
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
    // Pool sizing is handled by WorkerPoolFactory (accounts for Go Atlas layer count).
    const pool = this.poolFactory.create(this.diagrams, this.globalConfig);

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

  /**
   * Return collected query scopes. Each scope represents a unique set of source
   * directories and the ArchJSON produced for them during processAll().
   */
  public getQuerySourceGroups(): InternalQueryScope[] {
    return this.collector.getQuerySourceGroups();
  }

  /**
   * Return the first parsed ArchJSON from processAll().
   * Prefers the scope group with role === 'primary'; falls back to the first
   * successfully parsed ArchJSON if no primary role exists.
   * Returns null before processAll() is called or if all groups failed.
   */
  public getLastArchJson(): ArchJSON | null {
    return this.collector.getLastArchJson();
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
      this.collector.register(firstDiagram.sources, rawArchJSON, kind, firstDiagram.queryRole);
      // Store ArchJSON for test analysis: first assignment wins, unless a primary role is found.
      // Check all diagrams in the group (they share sources, so any with queryRole='primary' wins).
      const groupHasPrimary = diagrams.some((d) => d.queryRole === 'primary');
      this.collector.setLastArchJson(rawArchJSON, groupHasPrimary);
      return await pMap(
        diagrams,
        (diagram) => this.runner.run(diagram, rawArchJSON, pool, this.parallelProgress),
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
    return generateTestCoverageHeatmap(analysis, archJson, outputDir);
  }
}
