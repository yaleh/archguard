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
   * Exclude patterns (glob patterns)
   * Will be combined with default excludes
   */
  exclude?: string[];

  /**
   * Skip missing source directories instead of throwing error
   * Default: false
   */
  skipMissing?: boolean;
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
    const { sources = ['./src'], exclude = [], skipMissing = false } = options;

    // Handle empty sources
    if (sources.length === 0) {
      return [];
    }

    // Discover files from all sources
    const allFiles: string[] = [];

    for (const source of sources) {
      const files = await this.discoverFromGlob({
        source,
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
    exclude: string[];
    skipMissing: boolean;
  }): Promise<string[]> {
    const { source, exclude, skipMissing } = options;

    // Resolve source path
    const sourcePath = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);

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
}
