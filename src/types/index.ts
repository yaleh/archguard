/**
 * Core type definitions for ArchGuard
 */

// Export configuration types (v2.0)
export * from './config.js';
import type { DetailLevel } from './config.js';

// Export extension types (ADR-002)
export type { ArchJSONExtensions } from './extensions.js';
export type {
  GoAtlasExtension,
  GoAtlasLayers,
  GoAtlasMetadata,
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
} from './extensions.js';
export { GO_ATLAS_EXTENSION_VERSION } from './extensions.js';

/**
 * Supported programming languages
 */
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp';

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
  version: string;
  language: SupportedLanguage;
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];
  relations: Relation[];
  modules?: Module[];
  metadata?: Record<string, unknown>;
  workspaceRoot?: string;

  // Type-safe extensions (ADR-002)
  extensions?: import('./extensions.js').ArchJSONExtensions;

  /**
   * Structural proxy metrics, computed by MetricsCalculator after aggregation.
   * Only present in json-format output. Bound to the aggregation level used.
   */
  metrics?: ArchJSONMetrics;
}

/**
 * Entity types in the architecture
 */
export type EntityType =
  | 'class'
  | 'interface'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'abstract_class'
  | 'function';

/**
 * Visibility modifiers
 */
export type Visibility = 'public' | 'private' | 'protected';

/**
 * Entity representation
 */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  visibility: Visibility;
  members: Member[];
  sourceLocation: SourceLocation;
  decorators?: Decorator[];
  isAbstract?: boolean;
  isConst?: boolean;
  genericParams?: string[];
  extends?: string[];
  implements?: string[];
}

/**
 * Member types (properties and methods)
 */
export type MemberType = 'property' | 'method' | 'constructor' | 'field';

/**
 * Member of an entity
 */
export interface Member {
  name: string;
  type: MemberType;
  visibility: Visibility;
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
  file: string;
  startLine: number;
  endLine: number;
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
  | 'association';

/**
 * Relation between entities
 */
export interface Relation {
  id: string;
  type: RelationType;
  source: string;
  target: string;
  confidence?: number;
  inferenceSource?: 'explicit' | 'inferred' | 'gopls';
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
