/**
 * Configuration Type Definitions for ArchGuard v2.0
 *
 * Breaking Change: Complete redesign of configuration system
 * - Unified DiagramConfig abstraction
 * - Multi-level detail support (package/class/method)
 * - Configuration-first design with diagrams array
 *
 * @module types/config
 * @version 2.0.0
 */

/**
 * Detail level for architecture diagram generation
 *
 * - package: High-level overview showing only package structure and dependencies
 * - class: Default level showing classes, interfaces, and public methods
 * - method: Full detail showing all methods including private ones
 */
export type DetailLevel = 'package' | 'class' | 'method';

/**
 * Mermaid-specific configuration
 */
export interface MermaidConfig {
  /** Enable LLM-based intelligent grouping (default: true) */
  enableLLMGrouping?: boolean;

  /** Mermaid renderer type */
  renderer?: 'isomorphic' | 'cli';

  /** Mermaid theme */
  theme?: 'default' | 'forest' | 'dark' | 'neutral';

  /** Background transparency */
  transparentBackground?: boolean;
}

/**
 * Default Mermaid configuration
 */
export const defaultMermaidConfig: MermaidConfig = {
  enableLLMGrouping: true,
  renderer: 'isomorphic',
  theme: 'default',
  transparentBackground: false,
};

/**
 * Output format for generated diagrams
 *
 * - mermaid: Generate .mmd and .svg/.png files (default, uses isomorphic-mermaid)
 * - json: Generate ArchJSON only (fast, no rendering required)
 */
export type OutputFormat = 'mermaid' | 'json';

/**
 * Single diagram configuration
 *
 * This is the core abstraction in v2.0 - both single and multiple diagrams
 * use the same DiagramConfig structure.
 */
export interface DiagramConfig {
  /**
   * Output name for the diagram (without extension)
   *
   * Supports subdirectories for organization.
   * Examples: "overview", "modules/parser", "layers/frontend/api"
   */
  name: string;

  /**
   * Source paths or glob patterns to analyze
   *
   * Multiple sources are merged into a single diagram.
   */
  sources: string[];

  /**
   * Detail level for this diagram
   *
   * Controls how much detail is shown
   * @default 'class'
   */
  level: DetailLevel;

  /**
   * Human-readable description
   *
   * Used in index pages and documentation.
   */
  description?: string;

  /**
   * Output format for this diagram
   *
   * Overrides global format setting if specified.
   */
  format?: OutputFormat;

  /**
   * Exclude patterns for this diagram
   *
   * Overrides global exclude patterns if specified.
   */
  exclude?: string[];
}

/**
 * Global configuration options
 *
 * These settings apply to all diagrams unless overridden at the diagram level.
 */
export interface GlobalConfig {
  /**
   * Output root directory for all generated diagrams
   * @default './archguard'
   */
  outputDir: string;

  /**
   * Default output format for all diagrams
   * @default 'mermaid'
   */
  format: OutputFormat;

  /**
   * Mermaid-specific configuration (only used when format is 'mermaid')
   */
  mermaid?: MermaidConfig;

  /**
   * Default exclude patterns
   */
  exclude: string[];

  /**
   * Claude CLI configuration
   */
  cli: {
    /** Claude CLI command to execute */
    command: string;
    /** Additional CLI arguments */
    args: string[];
    /** Timeout for CLI operations in milliseconds */
    timeout: number;
  };

  /**
   * Cache configuration
   */
  cache: {
    /** Enable file-level caching */
    enabled: boolean;
    /** Cache time-to-live in seconds */
    ttl: number;
  };

  /**
   * Number of concurrent file parsing operations
   */
  concurrency: number;

  /**
   * Enable verbose output
   */
  verbose: boolean;
}

/**
 * Complete ArchGuard configuration
 *
 * This is the root configuration type used in archguard.config.json.
 *
 * Key Design Principles:
 * 1. Everything is a Diagram: Single and multiple diagrams use the same structure
 * 2. Configuration-first: Complex scenarios use config file, simple scenarios use CLI
 * 3. Orthogonal Design: Each parameter controls one dimension
 * 4. Single Processing Path: Unified DiagramProcessor, no mode branches
 */
export interface ArchGuardConfig extends GlobalConfig {
  /**
   * Array of diagram definitions
   *
   * Core Design: "Everything is a Diagram"
   * - Single diagram: diagrams.length === 1
   * - Multiple diagrams: diagrams.length > 1
   * - Empty: Use CLI shortcut or default
   *
   * Each diagram is processed independently by DiagramProcessor.
   * If multiple diagrams are generated, an index.md is automatically created.
   */
  diagrams: DiagramConfig[];
}

/**
 * CLI options type (subset of config for command-line usage)
 *
 * These options are parsed from command-line arguments and can
 * override configuration file settings.
 */
export interface CLIOptions {
  /**
   * Config file path
   */
  config?: string;

  /**
   * Filter specific diagrams by name
   *
   * Only generate diagrams matching these names.
   */
  diagrams?: string[];

  // ========== CLI Shortcut (generates single diagram) ==========

  /**
   * Source directories (CLI shortcut)
   *
   * When provided, generates a single diagram with these sources.
   */
  sources?: string[];

  /**
   * Detail level (CLI shortcut)
   */
  level?: DetailLevel;

  /**
   * Diagram name (CLI shortcut)
   */
  name?: string;

  // ========== Global Config Overrides ==========

  /**
   * Output format override
   */
  format?: OutputFormat;

  /**
   * Output directory override
   */
  outputDir?: string;

  /**
   * Exclude patterns override
   */
  exclude?: string[];

  /**
   * Disable cache
   */
  cache?: boolean;

  /**
   * Concurrency override
   */
  concurrency?: number;

  /**
   * Verbose output override
   */
  verbose?: boolean;

  /**
   * Claude CLI command override
   */
  cliCommand?: string;

  /**
   * Claude CLI args override
   */
  cliArgs?: string;

  // ========== Mermaid-Specific Options ==========

  /**
   * Disable LLM grouping (use heuristic)
   */
  llmGrouping?: boolean;

  /**
   * Mermaid theme
   */
  mermaidTheme?: 'default' | 'forest' | 'dark' | 'neutral';

  /**
   * Mermaid renderer
   */
  mermaidRenderer?: 'isomorphic' | 'cli';
}
