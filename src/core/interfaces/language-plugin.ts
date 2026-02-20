/**
 * Language plugin interface definition
 *
 * This is the core interface that all language plugins must implement
 * to integrate with ArchGuard's plugin system.
 */

import type { IParser } from './parser.js';
import type { IDependencyExtractor } from './dependency.js';
import type { IValidator } from './validation.js';

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
}
