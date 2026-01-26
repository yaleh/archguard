/**
 * Output Path Resolver
 * Phase 4.4: Centralized output path management
 * Task #4: Enhanced with subdirectory support and json path
 *
 * Responsibilities:
 * - Resolve output directory from config
 * - Generate paths for .puml, .png, .svg, .json files
 * - Create output directories automatically (including subdirectories)
 * - Handle relative and absolute paths
 * - Support subdirectory organization (e.g., "frontend/api")
 */

import path from 'path';
import fs from 'fs/promises';

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
    /** Path to .mmd file (Mermaid source) */
    mmd: string;
    /** Path to .png file */
    png: string;
    /** Path to .svg file */
    svg: string;
    /** Path to .json file */
    json: string;
  };
}

/**
 * Options for path resolution
 * Supports both legacy 'baseName' and new 'name' parameter
 */
export interface ResolveOptions {
  /** Optional custom base name (default: 'architecture') */
  baseName?: string;
  /** Optional custom name (alias for baseName, supports subdirectories) */
  name?: string;
  /** Optional output override (takes priority over config.output) */
  output?: string;
}

/**
 * New interface for Task #4 (alias for ResolveOptions)
 */
export interface OutputPathOptions extends ResolveOptions {}

/**
 * New interface for Task #4 (alias for PathResolution)
 */
export interface ResolvedPaths extends PathResolution {
  /** Alias for outputDir */
  dir: string;
}

/**
 * OutputPathResolver - Centralized output path management
 *
 * Usage:
 * ```typescript
 * const resolver = new OutputPathResolver(config);
 *
 * // Basic usage
 * const paths = resolver.resolve({ name: 'my-arch' });
 *
 * // With subdirectory support
 * const paths = resolver.resolve({ name: 'frontend/api' });
 * // => Generates: archguard/frontend/api.{mmd,png,svg,json}
 *
 * await resolver.ensureDirectory();
 * // Use paths.paths.png, paths.paths.mmd, paths.paths.json, etc.
 * ```
 */
export class OutputPathResolver {
  constructor(private config: { outputDir: string; output?: string }) {}

  /**
   * Resolve output paths based on config and options
   *
   * Priority:
   * 1. options.output (if provided)
   * 2. options.name or options.baseName (if set, supports subdirectories)
   * 3. config.output (if set)
   * 4. config.outputDir
   *
   * @param options - Resolution options
   * @returns PathResolution with all resolved paths
   */
  resolve(options: ResolveOptions = {}): PathResolution {
    // Priority 1: If options.output is provided, use it directly
    if (options.output) {
      const { dir, baseName } = this.parseBasePath(options.output);
      return this.buildPathResolution(path.resolve(dir), baseName);
    }

    // Priority 2: Handle options.name or options.baseName with subdirectory support
    const customName = options.name || options.baseName;

    if (customName) {
      const { outputDir, fileName } = this.parseCustomName(customName);
      return this.buildPathResolution(outputDir, fileName);
    }

    // Priority 3 & 4: Use config.output or config.outputDir
    const basePath = this.determineBasePath(options);
    const { dir, baseName } = this.parseBasePath(basePath);
    return this.buildPathResolution(path.resolve(dir), baseName);
  }

  /**
   * Create output directory if it doesn't exist
   *
   * @param options - Optional resolution options to determine which directory to create
   * @throws Error if directory creation fails
   */
  async ensureDirectory(options: ResolveOptions = {}): Promise<void> {
    const resolution = this.resolve(options);
    await fs.mkdir(resolution.outputDir, { recursive: true });
  }

  /**
   * Build PathResolution object from resolved directory and filename
   * Eliminates code duplication
   */
  private buildPathResolution(outputDir: string, baseName: string): PathResolution {
    return {
      outputDir,
      baseName,
      paths: {
        mmd: path.join(outputDir, `${baseName}.mmd`),
        png: path.join(outputDir, `${baseName}.png`),
        svg: path.join(outputDir, `${baseName}.svg`),
        json: path.join(outputDir, `${baseName}.json`),
      },
    };
  }

  /**
   * Parse custom name with subdirectory support
   * Handles: "frontend/api", "services/auth/models", "frontend/"
   */
  private parseCustomName(customName: string): { outputDir: string; fileName: string } {
    let baseDir: string;
    let fileName: string;

    // Normalize path separators (convert \ to / for cross-platform support)
    const normalizedName = customName.replace(/\\/g, '/');

    if (normalizedName.includes('/')) {
      // Handle trailing slash separately
      if (normalizedName.endsWith('/')) {
        // Directory only, use default filename
        fileName = 'architecture';
        baseDir = normalizedName.replace(/\/$/, '');
      } else {
        // Parse subdirectory structure
        const parsed = path.posix.parse(normalizedName);
        fileName = parsed.name || 'architecture';
        baseDir = parsed.dir;
      }
    } else {
      fileName = normalizedName;
      baseDir = '';
    }

    // Get base directory from config
    const configDir = this.config.outputDir || '.';
    const finalDir = baseDir ? path.join(configDir, baseDir) : configDir;
    const outputDir = path.resolve(finalDir);

    return { outputDir, fileName };
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
