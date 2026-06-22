/**
 * Core type definitions for ArchGuard
 */

// Export configuration types (v2.0)
export * from './config.js';
import type { DetailLevel } from './config.js';

// Export MetricVector type
export type { MetricVector } from './metric-vector.js';

// Export CognitiveSummaryEntry type (archguard_get_cognitive_summary MCP tool)
export type { CognitiveSummaryEntry } from './cognitive-summary.js';

// Export extension types (ADR-002)
export type { ArchJSONExtensions } from './extensions/index.js';
export type {
  GoAtlasExtension,
  GoAtlasLayers,
  GoAtlasMetadata,
  ProjectSemantics,
  PackageGraph,
  PackageCycle,
  PackageNode,
  PackageStats,
  PackageDependency,
  CapabilityGraph,
  CapabilityNode,
  CapabilityRelation,
  GoroutineTopology,
  GoroutineNode,
  GoroutinePattern,
  SpawnRelation,
  ChannelInfo,
  FlowGraph,
  EntryPoint,
  CallChain,
  CallEdge,
  TestPatternConfig,
  DetectedTestPatterns,
  TestAnalysis,
  TestFileInfo,
  CoverageLink,
  TestIssue,
  TestMetrics,
  PackageCoverage,
} from './extensions/index.js';
export {
  GO_ATLAS_EXTENSION_VERSION,
  PROJECT_SEMANTICS_VERSION,
  TEST_ANALYSIS_VERSION,
  TS_ANALYSIS_EXTENSION_VERSION,
} from './extensions/index.js';

/**
 * Supported programming languages
 */
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp' | 'kotlin';

/**
 * Module structure for organizing entities
 */
export interface Module {
  name: string;
  entities: string[];
  submodules?: Module[];
}

/**
 * Main architecture JSON structure
 */
export interface ArchJSON {
  readonly version: string;
  readonly language: SupportedLanguage;
  readonly timestamp: string;
  readonly sourceFiles: readonly string[];
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  modules?: Module[];
  metadata?: Record<string, unknown>;
  readonly workspaceRoot?: string;

  // Type-safe extensions (ADR-002)
  extensions?: import('./extensions/index.js').ArchJSONExtensions;

  /**
   * Structural proxy metrics, computed by MetricsCalculator after aggregation.
   * Only present in json-format output. Bound to the aggregation level used.
   */
  metrics?: ArchJSONMetrics;

  /**
   * Standardized metric vector for temporal comparison and fitness checks.
   * Computed after aggregation; only present in json-format output.
   */
  metricVector?: import('./metric-vector.js').MetricVector;
}

/** Current ArchJSON schema version. Increment minor on non-breaking field additions. */
export const ARCHJSON_SCHEMA_VERSION = '1.1' as const;

/**
 * Known (built-in) entity types in the architecture.
 * Plugins may declare additional types via EntityTypeRegistry; use EntityType
 * (the open union) wherever a value may be a custom type string.
 */
export type KnownEntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'abstract_class'
  | 'function';

/**
 * Open entity type: the seven built-in kinds plus any custom string that a
 * language plugin registers. Widened from the closed KnownEntityType union so
 * that values like 'package', 'lock_domain', etc. are first-class citizens
 * without requiring `as any` casts.
 */
export type EntityType = KnownEntityType | string;

/**
 * Visibility modifiers
 */
export type Visibility = 'public' | 'private' | 'protected';

/**
 * Entity representation
 */
export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly visibility: Visibility;
  members: Member[];
  sourceLocation: SourceLocation;
  decorators?: Decorator[];
  isAbstract?: boolean;
  isConst?: boolean;
  genericParams?: string[];
  extends?: string[];
  implements?: string[];
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Member types (properties and methods)
 */
export type MemberType = 'property' | 'method' | 'constructor' | 'field';

/**
 * Member of an entity
 */
export interface Member {
  readonly name: string;
  readonly type: MemberType;
  readonly visibility: Visibility;
  returnType?: string;
  parameters?: Parameter[];
  isStatic?: boolean;
  isAbstract?: boolean;
  isAsync?: boolean;
  isReadonly?: boolean;
  isOptional?: boolean;
  fieldType?: string;
  defaultValue?: string;
  decorators?: Decorator[];
}

/**
 * Method/function parameter
 */
export interface Parameter {
  name: string;
  type: string;
  isOptional?: boolean;
  defaultValue?: string;
}

/**
 * Source code location
 */
export interface SourceLocation {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Decorator information
 */
export interface Decorator {
  name: string;
  arguments?: string[] | Record<string, unknown>;
}

/**
 * Relation types between entities
 */
export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association'
  | 'call';

/**
 * Relation between entities
 */
export interface Relation {
  readonly id: string;
  readonly type: RelationType;
  readonly source: string;
  readonly target: string;
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls' | 'call-aggregated' | 'tree-sitter';

  /**
   * Method-level call edge fields. Only populated when `type === 'call'`.
   * sourceMethod: the calling method name on the source entity.
   * targetMethod: the called method name on the target entity.
   * callType: how the call is dispatched — 'direct' (static dispatch),
   *   'interface' (virtual/interface dispatch), or 'indirect' (callback/higher-order).
   */
  sourceMethod?: string;
  targetMethod?: string;
  callType?: 'direct' | 'interface' | 'indirect';
}

/**
 * Structural proxy metrics for ArchJSON.
 * Computed by MetricsCalculator after aggregation; all values are bound to `level`.
 * Do NOT compare values across different levels.
 */
export interface ArchJSONMetrics {
  /** The aggregation level that produced these metrics. Must be checked before interpreting any value. */
  level: DetailLevel;

  /** Total entity count at this level (= entities.length) */
  entityCount: number;

  /** Total relation count at this level (= relations.length) */
  relationCount: number;

  /**
   * Per-type relation counts. Only types with count > 0 are present.
   * Sum of all values equals relationCount.
   */
  relationTypeBreakdown: Partial<Record<RelationType, number>>;

  /**
   * Number of strongly connected components (Kosaraju algorithm) in the directed dependency graph.
   * - Equals entityCount → no cyclic dependencies
   * - Less than entityCount → cyclic dependencies exist
   * - Equals 0 → entities array is empty
   */
  stronglyConnectedComponents: number;

  /**
   * Ratio of inferred relations (inferenceSource !== 'explicit') to total relations. Range: [0, 1].
   * Higher values mean heavier reliance on static analysis inference, lower result confidence.
   * Returns 0 when relationCount === 0.
   */
  inferredRelationRatio: number;

  /**
   * Per-file statistics, sorted by inDegree DESC.
   * undefined when level === 'package', Go Atlas mode, or entities array is empty.
   */
  fileStats?: FileStats[];

  /**
   * Non-trivial SCCs (size > 1), sorted by size DESC.
   * Empty array = no size > 1 cycles. Self-loops (size = 1) are excluded.
   */
  cycles?: CycleInfo[];
}

/**
 * Per-source-file statistics. Only present when level === 'class' | 'method'
 * and not in Go Atlas mode. All values are raw counts with no thresholds.
 */
export interface FileStats {
  /** Source file path, relative to workspaceRoot (C++ absolute paths normalised). */
  file: string;
  /** Approximate line count: max(entity.sourceLocation.endLine) for entities in this file. */
  loc: number;
  /** Number of entities (class / interface / struct / enum / …) defined in this file. */
  entityCount: number;
  /** Total methods: members where type === 'method' || type === 'constructor'. */
  methodCount: number;
  /** Total fields: members where type === 'property' || type === 'field'. */
  fieldCount: number;
  /**
   * Number of internal relations whose target is an entity in this file.
   * "Internal" means both source and target are in the parsed entity set.
   * Counts edges, not distinct neighbour files.
   */
  inDegree: number;
  /**
   * Number of internal relations whose source is an entity in this file.
   * "Internal" means both source and target are in the parsed entity set.
   * Counts edges, not distinct neighbour files.
   */
  outDegree: number;
  /** Count of distinct non-trivial SCCs (size > 1) that contain an entity from this file. */
  cycleCount: number;
}

/**
 * One strongly connected component of size > 1 (non-trivial cycle).
 * Kosaraju produces a partition — members across different CycleInfo entries never overlap.
 */
export interface CycleInfo {
  /** Number of entities in this cycle. */
  size: number;
  /** Entity IDs (ArchJSON entities[].id) — for programmatic lookup. */
  members: string[];
  /** Entity names, parallel to members — for human-readable rendering in index.md. */
  memberNames: string[];
  /** Deduplicated source file paths (relative) of all members. Empty strings filtered out. */
  files: string[];
}
