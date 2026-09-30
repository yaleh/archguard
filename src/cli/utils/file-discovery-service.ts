/**
 * FileDiscoveryService - Unified file discovery with multi-source support
 * Handles file pattern matching, deduplication, and exclusion
 */

import { globby } from 'globby';
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

  /**
   * File extensions (with leading dot) to enumerate.
   * Default: TS_DISCOVERY_EXTENSIONS
   */
  extensions?: string[];
}

/**
 * Default exclude patterns
 */
const DEFAULT_EXCLUDES = ['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/node_modules/**'];

/**
 * Extensions enumerated by default — mirrors TypeScriptPlugin.metadata.fileExtensions.
 */
export const TS_DISCOVERY_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Extensions that look like JS/TS but are not enumerated; reported as skipped.
 */
export const TS_SKIPPED_EXTENSIONS = ['.mjs', '.cjs', '.mts', '.cts'];

function extGlob(exts: string[]): string {
  const names = exts.map((e) => e.replace(/^\./, ''));
  return names.length === 1 ? names[0] : `{${names.join(',')}}`;
}

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
      exclude = [],
      skipMissing = false,
      extensions = TS_DISCOVERY_EXTENSIONS,
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
        exclude,
        skipMissing,
        extensions,
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
    extensions: string[];
  }): Promise<string[]> {
    const { source, exclude, skipMissing, extensions } = options;

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

    // Check if source is a file (not a directory)
    const stat = await fs.stat(sourcePath);
    if (stat.isFile()) {
      // If it's a supported source file, return it directly
      if (extensions.some((e) => sourcePath.endsWith(e))) {
        return [sourcePath];
      }
      // If it's not a TypeScript file, return empty
      return [];
    }

    // Build glob pattern for TypeScript files
    const globPattern = `${sourcePath}/**/*.${extGlob(extensions)}`;

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
   * Count files under the given sources whose extension looks like JS/TS but is
   * not enumerated (.mjs/.cjs/.mts/.cts), so callers can report them instead of
   * dropping them silently.
   */
  async countSkippedByExtension(sources: string[], exclude: string[] = []): Promise<number> {
    let count = 0;
    for (const source of sources) {
      const sourcePath = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
      if (!(await fs.pathExists(sourcePath)) || !(await fs.stat(sourcePath)).isDirectory()) {
        continue;
      }
      const ignore = [...DEFAULT_EXCLUDES, ...exclude].map((p) =>
        p.startsWith('!') || path.isAbsolute(p) ? p : `!${p}`
      );
      const files = await globby(
        [`${sourcePath}/**/*.${extGlob(TS_SKIPPED_EXTENSIONS)}`, ...ignore],
        { absolute: true, onlyFiles: true, followSymbolicLinks: false }
      );
      count += files.length;
    }
    return count;
  }
}
