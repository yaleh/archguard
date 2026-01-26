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
      stdin = false,
    } = options;

    // Handle STDIN mode
    if (stdin) {
      return this.discoverFromStdin({
        baseDir,
        exclude,
        skipMissing,
      });
    }

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
   * Discover files from STDIN
   */
  private async discoverFromStdin(options: {
    baseDir: string;
    exclude: string[];
    skipMissing: boolean;
  }): Promise<string[]> {
    const { baseDir, exclude, skipMissing } = options;

    // Read file list from STDIN
    const content = await this.readStdin();

    // Parse file list
    const files = this.parseFileList(content, baseDir);

    // Validate files exist
    const validatedFiles = await this.validateFiles(files, skipMissing);

    // Apply exclude patterns
    const filteredFiles = await this.applyExcludePatterns(validatedFiles, exclude);

    // Deduplicate
    return [...new Set(filteredFiles)];
  }

  /**
   * Read content from STDIN
   */
  private async readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      process.stdin.setEncoding('utf8');

      process.stdin.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });

      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      process.stdin.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Parse file list from STDIN content
   * Filters out:
   * - Empty lines
   * - Comment lines (starting with #)
   * - Whitespace-only lines
   */
  private parseFileList(content: string, baseDir: string): string[] {
    const lines = content.split('\n');
    const files: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === '') {
        continue;
      }

      // Skip comment lines
      if (trimmed.startsWith('#')) {
        continue;
      }

      // Resolve path (convert relative to absolute)
      const filePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);

      files.push(filePath);
    }

    return files;
  }

  /**
   * Validate that files exist
   * @param files - List of file paths to validate
   * @param skipMissing - If true, skip non-existent files; if false, throw error
   */
  private async validateFiles(files: string[], skipMissing: boolean): Promise<string[]> {
    const validFiles: string[] = [];

    for (const file of files) {
      const exists = await fs.pathExists(file);

      if (!exists) {
        if (skipMissing) {
          continue;
        }
        throw new Error(`File does not exist: ${file}`);
      }

      validFiles.push(file);
    }

    return validFiles;
  }

  /**
   * Apply exclude patterns to a list of files
   */
  private async applyExcludePatterns(files: string[], excludes: string[]): Promise<string[]> {
    if (excludes.length === 0) {
      return files;
    }

    // Combine default and custom excludes
    const allExcludes = [...DEFAULT_EXCLUDES, ...excludes];

    // Use globby to filter files against exclude patterns
    const filteredFiles = await globby(files, {
      ignore: allExcludes,
      absolute: true,
      onlyFiles: true,
    });

    return filteredFiles;
  }

  /**
   * Apply exclude patterns to a list of files (legacy method)
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
