/**
 * FileDiscoveryService - Unified file discovery with multi-source support
 * Handles file pattern matching, deduplication, and exclusion
 */

import { globby } from 'globby';
import path from 'path';
import fs from 'fs-extra';
import {
  findIgnoreRoot,
  findIgnoringSet,
  loadIgnoreRuleSets,
  type ExcludeReportEntry,
} from './ignore-file-loader.js';

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
  private report = new Map<string, ExcludeReportEntry>();

  /**
   * Effective exclusion rules from the last discoverFiles() call:
   * .gitignore / .archguardignore rules (with dropped-file counts) and config exclude.
   */
  getExcludeReport(): ExcludeReportEntry[] {
    return [...this.report.values()];
  }

  /**
   * Absolute paths of TS/TSX files under `source` that .gitignore / .archguardignore exclude.
   * Used by parse paths that do their own globbing (they take these as absolute `!` excludes).
   * Also records the rule sets in the exclude report.
   */
  async discoverIgnoredFiles(source: string): Promise<string[]> {
    const sourcePath = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
    if (!(await fs.pathExists(sourcePath)) || !(await fs.stat(sourcePath)).isDirectory()) {
      return [];
    }
    const sets = await loadIgnoreRuleSets(await findIgnoreRoot(sourcePath));
    if (sets.length === 0) return [];
    const all = await globby([`${sourcePath}/**/*.{ts,tsx}`, '!**/node_modules/**'], {
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
    const ignored: string[] = [];
    for (const set of sets) this.report.delete(set.source);
    for (const f of all) {
      const hit = findIgnoringSet(sets, f);
      if (!hit) continue;
      ignored.push(f);
      const entry = this.report.get(hit.source) ?? {
        source: hit.source,
        count: hit.rules.length,
        rules: hit.rules,
        excludedFiles: 0,
      };
      entry.excludedFiles = (entry.excludedFiles ?? 0) + 1;
      this.report.set(hit.source, entry);
    }
    for (const set of sets) {
      if (!this.report.has(set.source)) {
        this.report.set(set.source, {
          source: set.source,
          count: set.rules.length,
          rules: set.rules,
          excludedFiles: 0,
        });
      }
    }
    return ignored;
  }

  /** Human-readable lines describing the effective exclusion rules. */
  formatExcludeReport(): string[] {
    return this.getExcludeReport().map((e) => {
      const dropped = e.excludedFiles ? `, excluded ${e.excludedFiles} file(s)` : '';
      return `${e.source}: ${e.count} rule(s) [${e.rules.join(', ')}]${dropped}`;
    });
  }

  /**
   * Discover TypeScript files from configured sources
   */
  async discoverFiles(options: FileDiscoveryOptions = {}): Promise<string[]> {
    const { sources = ['./src'], exclude = [], skipMissing = false } = options;

    this.report = new Map();
    if (exclude.length > 0) {
      this.report.set('config exclude', {
        source: 'config exclude',
        count: exclude.length,
        rules: [...exclude],
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

    // Check if source is a file (not a directory)
    const stat = await fs.stat(sourcePath);
    if (stat.isFile()) {
      // If it's a TypeScript file, return it directly
      if (sourcePath.endsWith('.ts')) {
        return [sourcePath];
      }
      // If it's not a TypeScript file, return empty
      return [];
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

    // Apply .gitignore + .archguardignore (union with explicit excludes above)
    const root = await findIgnoreRoot(sourcePath);
    const sets = await loadIgnoreRuleSets(root);
    for (const set of sets) {
      if (!this.report.has(set.source)) {
        this.report.set(set.source, {
          source: set.source,
          count: set.rules.length,
          rules: set.rules,
          excludedFiles: 0,
        });
      }
    }
    if (sets.length === 0) return files;

    return files.filter((f) => {
      const hit = findIgnoringSet(sets, f);
      if (!hit) return true;
      this.report.get(hit.source)!.excludedFiles! += 1;
      return false;
    });
  }
}
