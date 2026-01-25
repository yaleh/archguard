/**
 * Output Path Resolver
 * Phase 4.4: Centralized output path management
 *
 * Responsibilities:
 * - Resolve output directory from config
 * - Generate paths for .puml, .png, .svg files
 * - Create output directories automatically
 * - Handle relative and absolute paths
 */

import path from 'path';
import fs from 'fs/promises';
import type { Config } from '../config-loader.js';

/**
 * Path resolution result
 */
export interface PathResolution {
  /** Resolved output directory (absolute path) */
  outputDir: string;
  /** Base file name (without extension) */
  baseName: string;
  /** Full paths for all output file types */
  paths: {
    /** Path to .puml file */
    puml: string;
    /** Path to .png file */
    png: string;
    /** Path to .svg file */
    svg: string;
  };
}

/**
 * Options for path resolution
 */
export interface ResolveOptions {
  /** Optional custom base name (default: 'architecture') */
  baseName?: string;
  /** Optional output override (takes priority over config.output) */
  output?: string;
}

/**
 * OutputPathResolver - Centralized output path management
 *
 * Usage:
 * ```typescript
 * const resolver = new OutputPathResolver(config);
 * const paths = resolver.resolve({ baseName: 'my-arch' });
 * await resolver.ensureDirectory();
 * // Use paths.paths.png, paths.paths.puml, etc.
 * ```
 */
export class OutputPathResolver {
  constructor(private config: Pick<Config, 'outputDir' | 'output'>) {}

  /**
   * Resolve output paths based on config and options
   *
   * Priority:
   * 1. options.output (if provided)
   * 2. config.output (if set)
   * 3. config.outputDir
   *
   * @param options - Resolution options
   * @returns PathResolution with all resolved paths
   */
  resolve(options: ResolveOptions = {}): PathResolution {
    // Determine the base output path
    const basePath = this.determineBasePath(options);

    // Extract directory and base name
    const { dir, baseName } = this.parseBasePath(basePath);

    // Use custom baseName from options if provided
    const finalBaseName = options.baseName || baseName;

    // Resolve to absolute path
    const outputDir = path.resolve(dir);

    return {
      outputDir,
      baseName: finalBaseName,
      paths: {
        puml: path.join(outputDir, `${finalBaseName}.puml`),
        png: path.join(outputDir, `${finalBaseName}.png`),
        svg: path.join(outputDir, `${finalBaseName}.svg`),
      },
    };
  }

  /**
   * Create output directory if it doesn't exist
   *
   * @throws Error if directory creation fails
   */
  async ensureDirectory(): Promise<void> {
    const resolution = this.resolve();
    await fs.mkdir(resolution.outputDir, { recursive: true });
  }

  /**
   * Determine the base output path
   * Priority: options.output > config.output > config.outputDir
   */
  private determineBasePath(options: ResolveOptions): string {
    if (options.output) {
      return options.output;
    }

    if (this.config.output) {
      return this.config.output;
    }

    // Use outputDir as default
    const outputDir = this.config.outputDir || '';
    return path.join(outputDir, 'architecture');
  }

  /**
   * Parse base path into directory and base name
   * Handles:
   * - Path with directory and filename: './dir/name' -> dir='dir', name='name'
   * - Path with extension: './dir/name.png' -> dir='dir', name='name'
   * - Just filename: 'name' -> dir=outputDir, name='name'
   */
  private parseBasePath(basePath: string): { dir: string; baseName: string } {
    // Remove extension if present
    const parsed = path.parse(basePath);
    const nameWithoutExt = parsed.name;
    const dir = parsed.dir;

    // If the path ends with a directory separator, use default base name
    if (basePath.endsWith('/') || basePath.endsWith('\\')) {
      return { dir: basePath, baseName: 'architecture' };
    }

    // If directory is '.', it means we have just a filename
    // In this case, use outputDir as the directory
    if (dir === '.' || dir === '') {
      return {
        dir: this.config.outputDir || '.',
        baseName: nameWithoutExt || 'architecture',
      };
    }

    // If we have a directory path, use it
    return {
      dir,
      baseName: nameWithoutExt || 'architecture',
    };
  }
}
