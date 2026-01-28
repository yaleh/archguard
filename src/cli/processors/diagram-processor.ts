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
import fs from 'fs-extra';
import pMap from 'p-map';
import os from 'os';

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
   * @returns Array of DiagramResult
   */
  async processAll(): Promise<DiagramResult[]> {
    const concurrency = this.globalConfig.concurrency || os.cpus().length;

    // Initialize parallel progress for multiple diagrams
    if (this.diagrams.length > 1) {
      const diagramNames = this.diagrams.map(d => d.name);
      this.parallelProgress = new ParallelProgressReporter(diagramNames);
    }

    try {
      const results = await pMap(
        this.diagrams,
        async (diagram) => {
          return await this.processDiagram(diagram);
        },
        { concurrency }
      );

      return results;
    } finally {
      // Stop parallel progress when done
      if (this.parallelProgress) {
        this.parallelProgress.stop();
      }
    }
  }

  /**
   * Process a single diagram
   *
   * @param diagram - Diagram configuration
   * @returns DiagramResult
   */
  private async processDiagram(diagram: DiagramConfig): Promise<DiagramResult> {
    const startTime = Date.now();

    try {
      // For single diagram, use original progress reporter
      if (!this.parallelProgress) {
        this.progress.start(`Processing diagram: ${diagram.name}`);
      }

      // 1. Discover files from sources
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 10, 'Discovering files');
      }
      const files = await this.fileDiscovery.discoverFiles({
        sources: diagram.sources,
        exclude: diagram.exclude || this.globalConfig.exclude,
        skipMissing: false,
      });

      if (files.length === 0) {
        throw new Error(`No TypeScript files found in sources: ${diagram.sources.join(', ')}`);
      }

      // 2. Parse files in parallel
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 30, 'Parsing files');
      }
      const parser = new ParallelParser({
        concurrency: this.globalConfig.concurrency,
        continueOnError: true,
      });

      const archJSON = await parser.parseFiles(files);

      // 3. Aggregate to specified level
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 50, 'Aggregating');
      }
      const aggregatedJSON = this.aggregator.aggregate(archJSON, diagram.level);

      // 4. Resolve output paths
      if (this.parallelProgress) {
        this.parallelProgress.update(diagram.name, 60, 'Preparing output');
      }
      const pathResolver = new OutputPathResolver({
        outputDir: this.globalConfig.outputDir,
        output: undefined, // Not using legacy output field
      });

      const paths = pathResolver.resolve({ name: diagram.name });
      await pathResolver.ensureDirectory({ name: diagram.name });

      // 5. Generate output based on format
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
        // Generate Mermaid diagram
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
        break;

      default:
        const exhaustiveCheck: never = format;
        throw new Error(`Unsupported format: ${exhaustiveCheck}`);
    }
  }
}
