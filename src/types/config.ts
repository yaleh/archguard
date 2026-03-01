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

// ============================================================================
// v2.1.0: Metadata Enhancement - Diagram Self-Documentation
// ============================================================================

/**
 * Diagram metadata for self-documenting architecture diagrams
 *
 * Breaking Change (v2.1): New optional fields for rich context
 * All fields are optional but recommended for better documentation
 */
export interface DiagramMetadata {
  /** Diagram title (displayed at top of diagram) */
  title?: string;

  /** Diagram subtitle */
  subtitle?: string;

  /** Purpose/use case description */
  purpose?: string;

  /** Primary actors or user roles */
  primaryActors?: string[];

  /** Input description */
  input?: {
    /** Input type (e.g., "TypeScript source files", "CLI commands") */
    type: string;
    /** Detailed description */
    description?: string;
    /** Example input */
    example?: string;
  };

  /** Output description */
  output?: {
    /** Output description */
    description: string;
    /** Output formats (e.g., ["JSON", "Mermaid"]) */
    formats?: string[];
    /** Example output */
    example?: string;
  };
}

/**
 * Design pattern and architectural information
 */
export interface DesignInfo {
  /** Architecture style */
  architectureStyle?: 'layered' | 'event-driven' | 'microkernel' | 'serverless';

  /** Applied design patterns */
  patterns?: DesignPatternInfo[];

  /** Key principles */
  principles?: string[];

  /** Architectural Decision Records (ADR) */
  decisions?: ArchitecturalDecision[];
}

/**
 * Design pattern information
 */
export interface DesignPatternInfo {
  /** Pattern name (e.g., "Builder Pattern", "Strategy Pattern") */
  name: string;
  /** Pattern category */
  category: PatternCategory;
  /** Participating classes/namespaces */
  participants: string[];
  /** Brief description */
  description: string;
  /** Code example (optional) */
  codeExample?: string;
}

/**
 * Design pattern categories
 */
export type PatternCategory =
  | 'creational' // 创建型：Builder, Factory
  | 'structural' // 结构型：Facade, Adapter, Proxy
  | 'behavioral' // 行为型：Strategy, Observer, Template Method
  | 'concurrency'; // 并发型：Parallel Processing

/**
 * Architectural decision record
 */
export interface ArchitecturalDecision {
  /** Decision topic */
  topic: string;
  /** What was chosen */
  decision: string;
  /** Why this choice was made */
  rationale: string;
  /** Alternatives considered */
  alternatives?: string[];
}

/**
 * Processing flow information
 */
export interface ProcessInfo {
  /** Number of processing stages */
  stages?: number;

  /** List of stages */
  stageList?: ProcessStage[];

  /** Data flow description */
  dataFlow?: string;

  /** Key dependencies */
  keyDependencies?: string[];
}

/**
 * Processing stage
 */
export interface ProcessStage {
  /** Stage order */
  order: number;
  /** Stage name */
  name: string;
  /** Stage description */
  description: string;
  /** Namespace/package */
  namespace?: string;
  /** Patterns used in this stage */
  patterns?: string[];
}

/**
 * Annotation configuration
 */
export interface AnnotationConfig {
  /** Enable comment generation (%% comments in source files only) */
  enableComments?: boolean;

  /** Highlight design patterns */
  highlightPatterns?: boolean;

  /** Show external dependencies */
  showExternalDeps?: boolean;

  /** Include usage example */
  includeUsageExample?: boolean;

  // ========== v2.1.1: Visible Title in Diagrams ==========
  /** Enable visible title (shown in rendered PNG/SVG images) */
  enableVisibleTitle?: boolean;

  /**
   * Which sections to include in visible title
   * Default: all sections included
   */
  visibleTitleSections?: (
    | 'title'
    | 'subtitle'
    | 'purpose'
    | 'input'
    | 'output'
    | 'patterns'
    | 'principles'
    | 'process'
  )[];

  /** Title position in diagram */
  titlePosition?: 'top' | 'bottom';
}

/**
 * Class-level annotation configuration
 */
export interface ClassHighlightConfig {
  /** Classes to highlight */
  highlightClasses?: string[];

  /** Classes with specific annotations */
  annotateClasses?: ClassAnnotation[];

  /** Visibility control */
  visibility?: {
    /** Explicitly include these classes */
    show?: string[];
    /** Explicitly exclude these classes */
    hide?: string[];
  };
}

/**
 * Class-level annotation
 */
export interface ClassAnnotation {
  /** Class name */
  className: string;
  /** Mermaid note */
  note?: string;
  /** Mermaid stereotypes (e.g., ["<<builder>>", "<<core>>"]) */
  stereotypes?: string[];
  /** Responsibility description */
  responsibility?: string;
}

/**
 * Single diagram configuration
 *
 * This is the core abstraction in v2.0 - both single and multiple diagrams
 * use the same DiagramConfig structure.
 *
 * Breaking Change (v2.1): Added optional metadata, design, process, annotations, classes
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

  /**
   * Language plugin to use for this diagram
   *
   * If not specified, defaults to 'typescript'.
   * Available plugins: 'typescript', 'go'
   * @default 'typescript'
   */
  language?: string;

  /**
   * Language-specific configuration options
   *
   * Passed through to ParseConfig.languageSpecific.
   * Example: { atlas: { enabled: true, functionBodyStrategy: 'selective' } }
   */
  languageSpecific?: Record<string, unknown>;

  // ========== v2.1.0: Metadata Enhancement (Optional) ==========

  /**
   * Diagram metadata for self-documentation
   *
   * Breaking Change: Replaces simple `description` field
   */
  metadata?: DiagramMetadata;

  /**
   * Design pattern and architectural information
   */
  design?: DesignInfo;

  /**
   * Processing flow information
   */
  process?: ProcessInfo;

  /**
   * Annotation configuration
   */
  annotations?: AnnotationConfig;

  /**
   * Class-level annotation configuration
   */
  classes?: ClassHighlightConfig;
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

  /**
   * Language plugin to use (CLI shortcut)
   *
   * If not specified, auto-detection is performed based on directory markers.
   * Available: 'typescript' (default)
   */
  lang?: string;

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
   * Mermaid theme
   */
  mermaidTheme?: 'default' | 'forest' | 'dark' | 'neutral';

  /**
   * Mermaid renderer
   */
  mermaidRenderer?: 'isomorphic' | 'cli';

  // ========== Go Architecture Atlas ==========

  /** Enable Go Architecture Atlas mode (default: true when --lang go) */
  atlas?: boolean;

  /** Disable Go Architecture Atlas mode (opt-out when --lang go) */
  noAtlas?: boolean;

  /** Atlas layers to generate (comma-separated: package,capability,goroutine,flow) */
  atlasLayers?: string;

  /** Function body extraction strategy: none|selective|full */
  atlasStrategy?: string;

  /** Exclude test files from Atlas extraction */
  atlasNoTests?: boolean;
  atlasIncludeTests?: boolean;

  /** Protocols to include in flow graph (comma-separated: http,grpc,cli,message,scheduler) */
  atlasProtocols?: string;
}
