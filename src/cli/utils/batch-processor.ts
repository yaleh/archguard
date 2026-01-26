/**
 * BatchProcessor - Batch processing for multiple modules
 * Phase 4.1: Multi-module batch analysis
 *
 * Responsibilities:
 * - Process multiple source directories (modules) in batch
 * - Infer module names from source paths
 * - Generate separate PlantUML diagrams for each module
 * - Generate index file for all modules (optional)
 * - Handle errors gracefully (partial failures allowed)
 */

import type { Config } from '../config-loader.js';
import type { ParallelParser } from '@/parser/parallel-parser.js';
import type { PlantUMLGenerator } from '@/ai/plantuml-generator.js';
import type { ProgressReporter } from '../progress.js';
import { FileDiscoveryService } from './file-discovery-service.js';
import { OutputPathResolver } from './output-path-resolver.js';
import { IndexGenerator } from './index-generator.js';

/**
 * Options for batch processing
 */
export interface BatchProcessorOptions {
  /** Source directories to process */
  sources: string[];
  /** ArchGuard configuration */
  config: Config;
  /** Parser instance for parsing files */
  parser: ParallelParser;
  /** Generator instance for generating PlantUML */
  generator: PlantUMLGenerator;
  /** Progress reporter for user feedback */
  progress: ProgressReporter;
  /** Whether to generate index file (default: true) */
  generateIndex?: boolean;
}

/**
 * Result of processing a single module
 */
export interface BatchResult {
  /** Module name (inferred from path) */
  moduleName: string;
  /** Source path */
  sourcePath: string;
  /** Number of entities found */
  entities?: number;
  /** Number of relations found */
  relations?: number;
  /** Output path for the generated diagram */
  outputPath?: string;
  /** PNG path for the generated diagram */
  pngPath?: string;
  /** Whether processing succeeded */
  success: boolean;
  /** Error message if processing failed */
  error?: string;
}

/**
 * BatchProcessor - Process multiple modules in batch
 *
 * Usage:
 * ```typescript
 * const processor = new BatchProcessor({
 *   sources: ['./packages/frontend/src', './packages/backend/src'],
 *   config,
 *   parser,
 *   generator,
 *   progress,
 * });
 *
 * const results = await processor.processBatch();
 * ```
 */
export class BatchProcessor {
  private options: BatchProcessorOptions;
  private fileDiscovery: FileDiscoveryService;

  constructor(options: BatchProcessorOptions) {
    this.options = options;
    this.fileDiscovery = new FileDiscoveryService();
  }

  /**
   * Process all modules in batch
   *
   * @returns Array of batch results for each module
   */
  async processBatch(): Promise<BatchResult[]> {
    const { sources, generateIndex = true } = this.options;

    if (sources.length === 0) {
      return [];
    }

    const results: BatchResult[] = [];

    // Process each module
    for (const source of sources) {
      const moduleName = this.inferModuleName(source);
      const result = await this.processModule(source, moduleName);
      results.push(result);
    }

    // Generate index if enabled
    if (generateIndex) {
      await this.generateIndex(results);
    }

    return results;
  }

  /**
   * Process a single module
   *
   * @param source - Source directory path
   * @param moduleName - Module name
   * @returns Batch result for the module
   */
  private async processModule(source: string, moduleName: string): Promise<BatchResult> {
    const { config, parser, generator, progress } = this.options;

    try {
      // Start progress reporting
      progress.start(`Processing module: ${moduleName}`);

      // Discover files in the module
      const files = await this.fileDiscovery.discoverFiles({
        sources: [source],
        exclude: this.buildExcludePatterns(),
        skipMissing: false,
      });

      // Parse files
      const archJson = await parser.parseFiles(files);

      // Resolve output path for the module
      const pathResolver = new OutputPathResolver(config);
      const outputPath = pathResolver.resolve({
        name: `modules/${moduleName}`,
      });

      // Ensure output directory exists
      await import('fs/promises').then((fs) => fs.mkdir(outputPath.outputDir, { recursive: true }));

      // Generate PlantUML
      await generator.generateAndRender(archJson, outputPath);

      // Success
      progress.succeed(`Module ${moduleName} processed successfully`);

      return {
        moduleName,
        sourcePath: source,
        entities: archJson.entities.length,
        relations: archJson.relations.length,
        outputPath: outputPath.paths.puml,
        pngPath: outputPath.paths.png,
        success: true,
      };
    } catch (error) {
      // Handle errors gracefully
      progress.fail(`Module ${moduleName} processing failed`);

      return {
        moduleName,
        sourcePath: source,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Infer module name from source path
   *
   * Algorithm:
   * 1. Split path by separators
   * 2. Filter out current/parent directory references (., ..)
   * 3. Remove common source directories (src, dist) from middle, but keep if at end
   * 4. Take the last valid segment
   * 5. Fallback to 'module' if empty
   *
   * Examples:
   * - './packages/frontend/src' -> 'frontend'
   * - './services/auth-service' -> 'auth-service'
   * - './src' -> 'src'
   * - './apps/web/src' -> 'web'
   * - '.' -> 'module'
   *
   * @param sourcePath - Source directory path
   * @returns Inferred module name
   */
  private inferModuleName(sourcePath: string): string {
    // Normalize path separators
    const normalizedPath = sourcePath.replace(/\\/g, '/');

    // Split into segments
    const segments = normalizedPath.split('/');

    // Filter segments to remove common directory names
    const filteredSegments = segments.filter((segment) => {
      // Remove empty segments
      if (segment === '') return false;

      // Remove current/parent directory references
      if (segment === '.' || segment === '..') return false;

      return true;
    });

    // If we have multiple segments, filter out common source directories from middle
    // But keep them if they're the only segment
    if (filteredSegments.length > 1) {
      // Remove 'src' and 'dist' from the end
      while (
        filteredSegments.length > 1 &&
        (filteredSegments[filteredSegments.length - 1] === 'src' ||
          filteredSegments[filteredSegments.length - 1] === 'dist')
      ) {
        filteredSegments.pop();
      }
    }

    // Take the last valid segment
    if (filteredSegments.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return filteredSegments[filteredSegments.length - 1]!; // Safe due to length check
    }

    // Fallback
    return 'module';
  }

  /**
   * Build exclude patterns from config
   *
   * @returns Array of exclude patterns
   */
  private buildExcludePatterns(): string[] {
    const { config } = this.options;
    return config.exclude || [];
  }

  /**
   * Generate index file for all modules
   *
   * @param results - Array of batch results
   */
  private async generateIndex(results: BatchResult[]): Promise<void> {
    const indexGenerator = new IndexGenerator(this.options.config);
    await indexGenerator.generate(results);
  }
}
