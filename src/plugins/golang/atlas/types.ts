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
  ConcreteUsageRisk,
  GoroutineLifecycleSummary,
  GoroutineTopology,
  GoroutineNode,
  GoroutinePattern,
  SpawnRelation,
  ChannelInfo,
  ChannelEdge,
  FlowGraph,
  EntryPoint,
  CallChain,
  CallEdge,
} from '@/types/extensions.js';

export { GO_ATLAS_EXTENSION_VERSION } from '@/types/extensions.js';

/**
 * GoArchitectureAtlas is an alias for GoAtlasExtension
 */
export type { GoAtlasExtension as GoArchitectureAtlas } from '@/types/extensions.js';

// ========== Framework Detection Types ==========

export interface CustomCallPattern {
  method?: string;            // exact AST call functionName to match
  methodSuffix?: string;      // suffix match: call.functionName.endsWith(methodSuffix)
  receiverContains?: string;  // substring of GoCallExpr.receiverType for disambiguation
                              // e.g. 'mux.Router' to distinguish gorilla/mux from net/http
  pathArgIndex?: number;      // index into GoCallExpr.args for path
  handlerArgIndex?: number;   // index into GoCallExpr.args for handler
  topicArgIndex?: number;     // index for message topic
}
// At least one of `method` or `methodSuffix` must be set.

export interface CustomFrameworkConfig {
  name: string;
  protocol: string;
  patterns: CustomCallPattern[];
}

export interface ManualEntryPoint {
  function: string;   // fully-qualified: "pkg/path.(*Receiver).Method"
  protocol: string;
}

// DetectedFrameworks: set of active framework keys
export type DetectedFrameworks = Set<string>;

// FlowBuildOptions: passed to FlowGraphBuilder.build() and BehaviorAnalyzer.buildFlowGraph()
export interface FlowBuildOptions {
  detectedFrameworks: DetectedFrameworks;
  protocols?: string[];
  customFrameworks?: CustomFrameworkConfig[];
  entryPoints?: ManualEntryPoint[];
  followIndirectCalls?: boolean;
}

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
  protocols?: string[];
  customFrameworks?: CustomFrameworkConfig[];
  entryPoints?: ManualEntryPoint[];
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
  protocols?: string[];
  customFrameworks?: CustomFrameworkConfig[];
  entryPoints?: ManualEntryPoint[];
  followIndirectCalls?: boolean;
  excludePatterns?: string[];
}
