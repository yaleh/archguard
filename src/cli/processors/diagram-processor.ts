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
import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';
import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator.js';
import type { DiagramConfig, GlobalConfig, OutputFormat, DetailLevel } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporter } from '@/cli/progress.js';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';
import type { RenderJob } from '@/mermaid/diagram-generator.js';
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
  private parallelProgress?: ParallelProgressReporter;

  constructor(options: DiagramProcessorOptions) {
    if (options.diagrams.length === 0) {
      throw new Error('At least one diagram configuration is required');
    }

    this.diagrams = options.diagrams;
    this.globalConfig = options.globalConfig;
    this.progress = options.progress;
    this.fileDiscovery = new FileDiscoveryService();
    this.aggregator = new ArchJSONAggregator();
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

    try {
      // Group diagrams by source hash to enable caching
      const sourceGroups = this.groupDiagramsBySource();

      // Process each source group
      const groupResults = await pMap(
        Array.from(sourceGroups.entries()),
        async ([sourceKey, diagrams]) => {
          // All diagrams in this group share the same sources
          // Parse once and reuse ArchJSON
          return await this.processSourceGroup(sourceKey, diagrams);
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

  /**
   * Cache key for parsed ArchJSON results
   * Maps source hash to parsed ArchJSON
   */
  private archJsonCache = new Map<string, ArchJSON>();

  /**
   * Process a group of diagrams that share the same sources
   *
   * @param sourceKey - Hash key for the sources
   * @param diagrams - Array of diagrams sharing these sources
   * @returns Array of DiagramResult
   */
  private async processSourceGroup(
    sourceKey: string,
    diagrams: DiagramConfig[]
  ): Promise<DiagramResult[]> {
    // For single diagram, use original progress reporter
    if (!this.parallelProgress && diagrams.length === 1) {
      this.progress.start(`Processing diagram: ${diagrams[0].name}`);
    }

    try {
      // Route Go diagrams through the Go plugin system
      const firstDiagram = diagrams[0];
      if (firstDiagram.language === 'go') {
        const rawArchJSON = await this.parseGoProject(firstDiagram);
        this.archJsonCache.set(sourceKey, rawArchJSON);

        const results = await pMap(
          diagrams,
          async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON),
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
        if (process.env.ArchGuardDebug === 'true') {
          console.debug(`🔍 Cache miss for ${sourceKey}: ${diagrams[0].sources.join(', ')}`);
        }

        // Parse files in parallel
        const parser = new ParallelParser({
          concurrency: this.globalConfig.concurrency,
          continueOnError: true,
        });
        rawArchJSON = await parser.parseFiles(files);

        // Cache the raw parsed result
        this.archJsonCache.set(sourceKey, rawArchJSON);
      } else if (process.env.ArchGuardDebug === 'true') {
        console.debug(`📦 Cache hit for ${sourceKey}: ${diagrams[0].sources.join(', ')}`);
      }

      // Process all diagrams in this group in parallel, using cached ArchJSON
      const results = await pMap(
        diagrams,
        async (diagram) => {
          return await this.processDiagramWithArchJSON(diagram, rawArchJSON);
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
    rawArchJSON: ArchJSON
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
      await this.generateOutput(aggregatedJSON, paths, format, diagram.level, diagram);

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

      return {
        name: diagram.name,
        success: true,
        paths: resultPaths,
        stats: {
          entities: aggregatedJSON.entities.length,
          relations: aggregatedJSON.relations.length,
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
   * Process a source group using two-stage rendering approach
   *
   * Stage 1: Parse and generate all Mermaid codes (CPU intensive)
   * Stage 2: Render all Mermaid codes in parallel (I/O intensive)
   *
   * @param sourceKey - Hash key for the sources
   * @param diagrams - Array of diagrams sharing these sources
   * @returns Array of DiagramResult
   */
  private async processSourceGroupWithTwoStageRendering(
    sourceKey: string,
    diagrams: DiagramConfig[]
  ): Promise<DiagramResult[]> {
    const startTime = Date.now();

    try {
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
        if (process.env.ArchGuardDebug === 'true') {
          console.debug(`🔍 Cache miss for ${sourceKey}: ${diagrams[0].sources.join(', ')}`);
        }

        // Parse files in parallel
        const parser = new ParallelParser({
          concurrency: this.globalConfig.concurrency,
          continueOnError: true,
        });
        rawArchJSON = await parser.parseFiles(files);

        // Cache the raw parsed result
        this.archJsonCache.set(sourceKey, rawArchJSON);
      } else if (process.env.ArchGuardDebug === 'true') {
        console.debug(`📦 Cache hit for ${sourceKey}: ${diagrams[0].sources.join(', ')}`);
      }

      // Stage 1: Generate all Mermaid codes (CPU intensive)
      this.progress.start('📝 Stage 1: Generating Mermaid code for all diagrams...');
      const allRenderJobs: RenderJob[] = [];

      for (const diagram of diagrams) {
        const aggregatedJSON = this.aggregator.aggregate(rawArchJSON, diagram.level);

        const format = diagram.format || this.globalConfig.format;
        if (format === 'mermaid') {
          const pathResolver = new OutputPathResolver({
            outputDir: this.globalConfig.outputDir,
            output: undefined,
          });

          const paths = pathResolver.resolve({ name: diagram.name });
          await pathResolver.ensureDirectory({ name: diagram.name });

          const generator = new MermaidDiagramGenerator(this.globalConfig);
          const jobs = await generator.generateOnly(
            aggregatedJSON,
            {
              outputDir: paths.paths.mmd.replace(/\/[^/]+$/, ''),
              baseName: paths.paths.mmd.replace(/^.*\/([^/]+)\.mmd$/, '$1'),
              paths: paths.paths,
            },
            diagram.level,
            diagram
          );

          allRenderJobs.push(...jobs);
        }
      }

      this.progress.succeed(
        `✅ Generated ${allRenderJobs.length} Mermaid file${allRenderJobs.length > 1 ? 's' : ''}`
      );

      // Stage 2: Render all in parallel (I/O intensive)
      if (allRenderJobs.length > 0) {
        const renderConcurrency = (this.globalConfig.concurrency || os.cpus().length) * 2;
        await MermaidDiagramGenerator.renderJobsInParallel(allRenderJobs, renderConcurrency);
      }

      const parseTime = Date.now() - startTime;

      // Build results
      return diagrams.map((diagram) => {
        const pathResolver = new OutputPathResolver({
          outputDir: this.globalConfig.outputDir,
          output: undefined,
        });

        const paths = pathResolver.resolve({ name: diagram.name });
        const aggregatedJSON = this.aggregator.aggregate(rawArchJSON, diagram.level);

        return {
          name: diagram.name,
          success: true,
          paths: {
            mmd: paths.paths.mmd,
            svg: paths.paths.svg,
            png: paths.paths.png,
          },
          stats: {
            entities: aggregatedJSON.entities.length,
            relations: aggregatedJSON.relations.length,
            parseTime,
          },
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.progress.fail(`❌ Two-stage rendering failed: ${errorMessage}`);

      return diagrams.map((diagram) => ({
        name: diagram.name,
        success: false,
        error: errorMessage,
      }));
    }
  }

  /**
   * Parse a Go project using GoAtlasPlugin
   *
   * Routes Go diagrams through the plugin system instead of ParallelParser.
   * Uses GoAtlasPlugin which handles both standard Go parsing and Atlas mode.
   *
   * @param diagram - Diagram configuration with language === 'go'
   * @returns Parsed ArchJSON (with optional Atlas extensions)
   */
  private async parseGoProject(diagram: DiagramConfig): Promise<ArchJSON> {
    // Dynamic import to avoid loading Go plugin when not needed
    const { GoAtlasPlugin } = await import('@/plugins/golang/atlas/index.js');
    const plugin = new GoAtlasPlugin();
    await plugin.initialize({ workspaceRoot: diagram.sources[0] });

    const workspaceRoot = path.resolve(diagram.sources[0]);
    return plugin.parseProject(workspaceRoot, {
      workspaceRoot,
      excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
      languageSpecific: diagram.languageSpecific,
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
    diagram: DiagramConfig
  ): Promise<void> {
    switch (format) {
      case 'json':
        // Write JSON file directly
        await fs.writeJson(paths.paths.json, archJSON, { spaces: 2 });
        break;

      case 'mermaid':
        // Route Go Atlas diagrams to AtlasRenderer (4-layer flowchart output)
        if (archJSON.extensions?.goAtlas) {
          await this.generateAtlasOutput(archJSON, paths, diagram);
        } else {
          // Generate standard Mermaid classDiagram
          const mermaidGenerator = new MermaidDiagramGenerator(this.globalConfig);
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
    diagram: DiagramConfig
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

    for (const layer of availableLayers) {
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

      const svg = await mermaidRenderer.renderSVG(result.content);
      await fs.writeFile(layerPaths.svg, svg, 'utf-8');

      try {
        await mermaidRenderer.renderPNG(result.content, layerPaths.png);
        console.log(`  ✅ ${layer}: ${layerPaths.mmd}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  ${layer} PNG skipped (${msg}) — MMD + SVG saved`);
        console.log(`  ✅ ${layer}: ${layerPaths.mmd} (no PNG)`);
      }
    }

    // Save full Atlas JSON alongside the layer diagrams
    const atlasJsonPath = `${basePath}-atlas.json`;
    await fs.writeJson(atlasJsonPath, atlas, { spaces: 2 });
    console.log(`  📊 Atlas JSON: ${atlasJsonPath}`);
    console.log(`\n✨ Atlas layers: ${availableLayers.join(', ')}`);
  }
}
