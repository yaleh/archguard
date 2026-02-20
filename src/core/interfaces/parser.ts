/**
 * Core parser interface definitions for ArchGuard plugins
 */

import type { ArchJSON } from '@/types/index.js';

/**
 * Configuration for parsing operations
 */
export interface ParseConfig {
  /**
   * Root directory of the workspace/project
   */
  workspaceRoot: string;

  /**
   * Patterns to exclude from parsing (glob patterns)
   */
  excludePatterns: string[];

  /**
   * Patterns to include in parsing (glob patterns)
   * If not specified, all files matching the plugin's file extensions are included
   */
  includePatterns?: string[];

  /**
   * File pattern for filtering files (glob pattern)
   */
  filePattern?: string;

  /**
   * Maximum number of concurrent file parsing operations
   * @default CPU cores count
   */
  concurrency?: number;

  /**
   * Language-specific configuration options
   * Allows plugins to extend configuration with custom options
   */
  languageSpecific?: Record<string, unknown>;
}

/**
 * Core parser interface that all language plugins must implement
 */
export interface IParser {
  /**
   * Parse an entire project and return ArchJSON representation
   *
   * This is the primary parsing method that analyzes all relevant files
   * in the workspace and produces a complete architectural model.
   *
   * @param workspaceRoot - Root directory of the project to analyze
   * @param config - Parsing configuration options
   * @returns Promise resolving to ArchJSON representation of the project
   * @throws {ParseError} When parsing fails due to syntax errors or file issues
   */
  parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON>;

  /**
   * Parse a single code string and return ArchJSON representation
   *
   * Optional capability for plugins that support single-file parsing.
   * Useful for testing, IDE integrations, or incremental analysis.
   *
   * @param code - Source code string to parse
   * @param filePath - Optional file path for context (affects module resolution)
   * @returns ArchJSON representation of the code
   * @throws {ParseError} When parsing fails
   */
  parseCode?(code: string, filePath?: string): ArchJSON;

  /**
   * Parse specific files and return ArchJSON representation
   *
   * Optional capability for plugins that support incremental parsing.
   * Allows targeted analysis of specific files without full project scan.
   *
   * @param filePaths - Array of absolute file paths to parse
   * @returns Promise resolving to ArchJSON representation of the files
   * @throws {ParseError} When parsing fails
   */
  parseFiles?(filePaths: string[]): Promise<ArchJSON>;
}
