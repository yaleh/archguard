/**
 * Go Atlas plugin types
 *
 * Re-exports ADR-002 types (single source of truth) and adds
 * atlas-specific aliases and configuration types.
 */

// Re-export all types from ADR-002 definition (src/types/extensions.ts)
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
  EntryPointType,
  CallChain,
  CallEdge,
} from '@/types/extensions.js';

export { GO_ATLAS_EXTENSION_VERSION } from '@/types/extensions.js';

/**
 * GoArchitectureAtlas is an alias for GoAtlasExtension
 */
export type { GoAtlasExtension as GoArchitectureAtlas } from '@/types/extensions.js';

/**
 * Atlas layer names
 */
export type AtlasLayer = 'package' | 'capability' | 'goroutine' | 'flow' | 'all';

/**
 * Rendering types
 */
export type RenderFormat = 'mermaid' | 'json' | 'svg' | 'png';

export interface RenderResult {
  content: string;
  format: RenderFormat;
  layer: AtlasLayer;
}

/**
 * Atlas generation options (from Proposal v5.1 §4.5.2)
 */
export interface AtlasGenerationOptions {
  functionBodyStrategy?: 'full' | 'selective' | 'none';
  selectiveExtraction?: {
    /** AST node types that trigger body extraction (e.g. 'go_statement') */
    triggerNodeTypes?: string[];
    excludeTestFiles?: boolean;
    maxFunctions?: number;
  };
  includeTests?: boolean;
  excludeTests?: boolean;
  excludePatterns?: string[];
  entryPointTypes?: import('@/types/extensions.js').EntryPointType[];
  followIndirectCalls?: boolean;
}

/**
 * Atlas configuration embedded in ParseConfig (from Proposal v5.1 §4.5.4)
 */
export interface AtlasConfig {
  enabled: boolean;
  functionBodyStrategy?: 'none' | 'selective' | 'full';
  layers?: AtlasLayer[];
  includeTests?: boolean;
  excludeTests?: boolean;
  entryPointTypes?: import('@/types/extensions.js').EntryPointType[];
  followIndirectCalls?: boolean;
  excludePatterns?: string[];
}
