/**
 * DiagramProcessor - Unified diagram processing component (v2.0 core)
 *
 * Key Features:
 * - Processes multiple diagrams independently
 * - Unified processing flow (no mode branches)
 * - Each diagram uses the same DiagramConfig structure
 * - Failures are isolated (one diagram failure doesn't affect others)
 * - Supports all detail levels (package/class/method)
 * - Supports all output formats (plantuml/json/svg)
 *
 * @module cli/processors/diagram-processor
 * @version 2.0.0
 */

import { FileDiscoveryService } from '@/cli/utils/file-discovery-service.js';
import { ParallelParser } from '@/parser/parallel-parser.js';
import { ArchJSONAggregator } from '@/parser/archjson-aggregator.js';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';
import { PlantUMLGenerator } from '@/ai/plantuml-generator.js';
import type { DiagramConfig, GlobalConfig, OutputFormat, DetailLevel } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporter } from '@/cli/progress.js';
import fs from 'fs-extra';

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
    puml?: string;
    png?: string;
    json?: string;
    svg?: string;
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
   * Process all diagrams
   *
   * Each diagram is processed independently. If one fails, others continue.
   *
   * @returns Array of DiagramResult
   */
  async processAll(): Promise<DiagramResult[]> {
    const results: DiagramResult[] = [];

    for (const diagram of this.diagrams) {
      const result = await this.processDiagram(diagram);
      results.push(result);
    }

    return results;
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
      this.progress.start(`Processing diagram: ${diagram.name}`);

      // 1. Discover files from sources
      const files = await this.fileDiscovery.discoverFiles({
        sources: diagram.sources,
        exclude: diagram.exclude || this.globalConfig.exclude,
        skipMissing: false,
      });

      if (files.length === 0) {
        throw new Error(`No TypeScript files found in sources: ${diagram.sources.join(', ')}`);
      }

      // 2. Parse files in parallel
      const parser = new ParallelParser({
        concurrency: this.globalConfig.concurrency,
        continueOnError: true,
      });

      const archJSON = await parser.parseFiles(files);

      // 3. Aggregate to specified level
      const aggregatedJSON = this.aggregator.aggregate(archJSON, diagram.level);

      // 4. Resolve output paths
      const pathResolver = new OutputPathResolver({
        outputDir: this.globalConfig.outputDir,
        output: undefined, // Not using legacy output field
      });

      const paths = pathResolver.resolve({ name: diagram.name });
      await pathResolver.ensureDirectory({ name: diagram.name });

      // 5. Generate output based on format
      const format = diagram.format || this.globalConfig.format;
      await this.generateOutput(aggregatedJSON, paths, format, diagram.level);

      const parseTime = Date.now() - startTime;

      this.progress.succeed(`Diagram ${diagram.name} completed`);

      // Build result paths based on format
      const resultPaths: DiagramResult['paths'] = {};
      if (format === 'json') {
        resultPaths.json = paths.paths.json;
      } else if (format === 'plantuml') {
        resultPaths.puml = paths.paths.puml;
        resultPaths.png = paths.paths.png;
      } else if (format === 'svg') {
        resultPaths.puml = paths.paths.puml;
        resultPaths.svg = paths.paths.svg;
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
      this.progress.fail(`Diagram ${diagram.name} failed: ${errorMessage}`);

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
   */
  private async generateOutput(
    archJSON: ArchJSON,
    paths: { paths: { json: string; puml: string; png: string; svg: string } },
    format: OutputFormat,
    level: DetailLevel
  ): Promise<void> {
    switch (format) {
      case 'json':
        // Write JSON file directly
        await fs.writeJson(paths.paths.json, archJSON, { spaces: 2 });
        break;

      case 'plantuml':
      case 'svg':
        // Generate PlantUML diagram
        // Create a minimal config compatible with PlantUMLGenerator
        const generatorConfig = {
          timeout: this.globalConfig.cli.timeout,
          maxRetries: 2,
          workingDir: process.cwd(),
        };
        const generator = new PlantUMLGenerator(generatorConfig);
        await generator.generateAndRender(archJSON, {
          outputDir: paths.paths.puml.replace(/\/[^/]+$/, ''),
          baseName: paths.paths.puml.replace(/^.*\/([^/]+)\.puml$/, '$1'),
          paths: paths.paths,
        }, level);
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
}
