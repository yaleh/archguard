/**
 * Language plugin interface definition
 *
 * This is the core interface that all language plugins must implement
 * to integrate with ArchGuard's plugin system.
 */

import type { IParser } from './parser.js';
import type { IDependencyExtractor } from './dependency.js';
import type { IValidator } from './validation.js';
import type { TestPatternConfig } from '@/types/extensions.js';

/**
 * A single test case's raw structure (plugin layer output).
 */
export interface RawTestCase {
  /** Test name from the first argument of it()/test()/func Test...(). */
  name: string;
  /** True when the case is marked skip/todo/xtest/t.Skip. */
  isSkipped: boolean;
  /**
   * Static lower-bound count of assertion calls matching patternConfig.assertionPatterns.
   * Custom helpers not covered by patterns are not counted.
   */
  assertionCount: number;
}

/**
 * A test file's raw structure (plugin layer output).
 */
export interface RawTestFile {
  filePath: string;
  /** Detected test frameworks; may be multiple (e.g. ['vitest', 'playwright']). */
  frameworks: string[];
  /**
   * Plugin's path-based type hint.
   * TestAnalyzer applies behaviour-first override (assertionCount === 0 → 'debug').
   * Note: 'debug' is intentionally absent — it is only assigned by TestAnalyzer.
   */
  testTypeHint: 'unit' | 'integration' | 'e2e' | 'performance' | 'unknown';
  testCases: RawTestCase[];
  /** Absolute paths of project-internal source files imported by this test file. */
  importedSourceFiles: string[];
  /**
   * File-level total assertion count. When set, TestAnalyzer uses this value
   * instead of summing per-case assertionCounts (prevents rounding-to-zero loss
   * when few assertions are spread across many test functions, e.g. C++).
   */
  totalAssertions?: number;
}

/**
 * Plugin capabilities flags
 *
 * Indicates which optional features the plugin supports
 */
export interface PluginCapabilities {
  /**
   * Whether the plugin supports parsing individual code strings
   * (IParser.parseCode method)
   */
  singleFileParsing: boolean;

  /**
   * Whether the plugin supports incremental parsing of specific files
   * (IParser.parseFiles method)
   */
  incrementalParsing: boolean;

  /**
   * Whether the plugin supports dependency extraction
   * (IDependencyExtractor interface)
   */
  dependencyExtraction: boolean;

  /**
   * Whether the plugin supports type inference for untyped languages
   * @example Python, JavaScript (without TypeScript)
   */
  typeInference: boolean;

  /**
   * Whether the plugin implements isTestFile() and extractTestStructure().
   * Defaults to false for existing plugins that do not add these methods.
   */
  testStructureExtraction?: boolean;
}

/**
 * Plugin metadata
 *
 * Describes the plugin's identity, capabilities, and requirements
 */
export interface PluginMetadata {
  /**
   * Unique plugin identifier (lowercase, hyphen-separated)
   */
  name: string;

  /**
   * Plugin version (semantic versioning)
   */
  version: string;

  /**
   * Human-readable display name
   */
  displayName: string;

  /**
   * File extensions this plugin can handle
   */
  fileExtensions: string[];

  /**
   * Plugin author or organization
   */
  author: string;

  /**
   * Repository URL (optional)
   */
  repository?: string;

  /**
   * Minimum required ArchGuard core version
   */
  minCoreVersion: string;

  /**
   * Plugin capabilities
   */
  capabilities: PluginCapabilities;
}

/**
 * Plugin initialization configuration
 */
export interface PluginInitConfig {
  /**
   * Root directory of the workspace being analyzed
   */
  workspaceRoot: string;

  /**
   * Directory for plugin-specific cache storage
   * Plugins should use subdirectories within this path
   */
  cacheDir?: string;

  /**
   * Whether to enable verbose logging
   */
  verbose?: boolean;
}

/**
 * Language plugin interface
 *
 * All language plugins must implement this interface to be compatible
 * with ArchGuard's plugin system. Plugins provide language-specific
 * parsing capabilities and optional features like dependency extraction.
 */
export interface ILanguagePlugin extends IParser {
  /**
   * Plugin metadata describing capabilities and requirements
   */
  readonly metadata: PluginMetadata;

  /**
   * Initialize the plugin
   *
   * Called once when the plugin is loaded. Plugins should:
   * - Validate required tools are available
   * - Set up caching directories
   * - Initialize any required state
   *
   * @param config - Initialization configuration
   * @throws {PluginInitializationError} When initialization fails
   * @throws {ToolDependencyError} When required tools are missing
   */
  initialize(config: PluginInitConfig): Promise<void>;

  /**
   * Check if this plugin can handle the given file or directory
   *
   * Used for automatic plugin detection. The plugin should check:
   * - File extensions for individual files
   * - Project markers for directories (e.g., go.mod, package.json)
   *
   * @param targetPath - Path to file or directory
   * @returns true if the plugin can handle this target
   */
  canHandle(targetPath: string): boolean;

  /**
   * Clean up plugin resources
   *
   * Called when the plugin is no longer needed. Plugins should:
   * - Close any open files or connections
   * - Clear temporary caches
   * - Release system resources
   *
   * @throws {PluginError} When cleanup fails
   */
  dispose(): Promise<void>;

  /**
   * Diagram levels supported by this plugin.
   * Used by the --diagrams CLI flag to filter diagram generation.
   * @example ['package', 'class', 'method'] for TypeScript
   * @example ['package', 'capability', 'goroutine', 'flow'] for Go Atlas
   */
  readonly supportedLevels: readonly string[];

  /**
   * Optional dependency extractor
   *
   * If the plugin supports dependency extraction (capabilities.dependencyExtraction = true),
   * this property should provide an IDependencyExtractor implementation.
   */
  readonly dependencyExtractor?: IDependencyExtractor;

  /**
   * Optional validator
   *
   * If the plugin provides language-specific validation beyond the core schema,
   * this property should provide an IValidator implementation.
   */
  readonly validator?: IValidator;

  /**
   * Determine whether a given file path is a test file.
   *
   * When patternConfig.testFileGlobs is provided, those globs take precedence.
   * Otherwise the plugin uses its built-in language defaults:
   *   TypeScript: /\.(test|spec)\.(ts|tsx|js|jsx)$/
   *   Go: /_test\.go$/
   *
   * Uses micromatch for glob matching.
   */
  isTestFile?(filePath: string, patternConfig?: TestPatternConfig): boolean;

  /**
   * Extract raw test structure from a single test file (pure static analysis).
   *
   * Requirements:
   * - Must not execute any code.
   * - When patternConfig is provided, use its assertionPatterns / testCasePatterns /
   *   skipPatterns instead of built-in defaults.
   * - importedSourceFiles must contain only project-internal absolute paths
   *   (exclude node_modules, vendor).
   * - Return null if the file cannot be parsed; TestAnalyzer will skip it.
   *
   * @param filePath     Absolute path to the test file.
   * @param code         File content (avoid re-reading from disk).
   * @param patternConfig Optional project-specific patterns from the AI caller.
   */
  extractTestStructure?(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null;
}
