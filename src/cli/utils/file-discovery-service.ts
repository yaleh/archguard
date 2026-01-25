/**
 * FileDiscoveryService - Unified file discovery with multi-source support
 * Handles file pattern matching, deduplication, and exclusion
 */

import globby from 'globby';
import path from 'path';
import fs from 'fs-extra';

/**
 * Options for file discovery
 */
export interface FileDiscoveryOptions {
  /**
   * Source directories or glob patterns to search
   * Default: ['./src']
   */
  sources?: string[];

  /**
   * Base directory for resolving relative paths
   * Default: process.cwd()
   */
  baseDir?: string;

  /**
   * Exclude patterns (glob patterns)
   * Will be combined with default excludes
   */
  exclude?: string[];

  /**
   * Skip missing source directories instead of throwing error
   * Default: false
   */
  skipMissing?: boolean;

  /**
   * Enable STDIN mode (reserved for future use)
   * Default: false
   */
  stdin?: boolean;
}

/**
 * Default exclude patterns
 */
const DEFAULT_EXCLUDES = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'];

/**
 * FileDiscoveryService - Discovers TypeScript files from multiple sources
 */
export class FileDiscoveryService {
  /**
   * Discover TypeScript files from configured sources
   */
  async discoverFiles(options: FileDiscoveryOptions = {}): Promise<string[]> {
    const {
      sources = ['./src'],
      baseDir = process.cwd(),
      exclude = [],
      skipMissing = false,
    } = options;

    // Handle empty sources
    if (sources.length === 0) {
      return [];
    }

    // Discover files from all sources
    const allFiles: string[] = [];

    for (const source of sources) {
      const files = await this.discoverFromGlob({
        source,
        baseDir,
        exclude,
        skipMissing,
      });
      allFiles.push(...files);
    }

    // Deduplicate files using Set
    const uniqueFiles = [...new Set(allFiles)];

    return uniqueFiles;
  }

  /**
   * Discover files from a single source using glob patterns
   */
  private async discoverFromGlob(options: {
    source: string;
    baseDir: string;
    exclude: string[];
    skipMissing: boolean;
  }): Promise<string[]> {
    const { source, baseDir, exclude, skipMissing } = options;

    // Resolve source path
    const sourcePath = path.isAbsolute(source) ? source : path.resolve(baseDir, source);

    // Check if source exists
    const exists = await fs.pathExists(sourcePath);
    if (!exists) {
      if (skipMissing) {
        return [];
      }
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    // Build glob pattern for TypeScript files
    const globPattern = `${sourcePath}/**/*.ts`;

    // Combine default and custom excludes
    const allExcludes = [...DEFAULT_EXCLUDES, ...exclude];

    // Convert excludes to glob ignore patterns
    const ignorePatterns = allExcludes.map((pattern) => {
      // If pattern is already negated or absolute, use as-is
      if (pattern.startsWith('!') || path.isAbsolute(pattern)) {
        return pattern;
      }
      // Otherwise, treat as a glob pattern
      return `!${pattern}`;
    });

    // Use globby to find files
    const files = await globby([globPattern, ...ignorePatterns], {
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    return files;
  }

  /**
   * Apply exclude patterns to a list of files
   * Note: Currently, exclusion is handled directly in discoverFromGlob via globby.
   * This method is available for future use if additional post-processing filtering is needed.
   *
   * @param files - List of file paths to filter
   * @param excludes - Glob patterns to exclude
   * @returns Filtered list of files
   * @internal
   */
  // @ts-expect-error - Reserved for future use
  private applyExcludes(files: string[], excludes: string[]): string[] {
    if (excludes.length === 0) {
      return files;
    }

    // This is a placeholder for additional filtering if needed
    // Currently, exclusion is handled in discoverFromGlob via globby
    return files;
  }
}
