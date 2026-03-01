/**
 * ArchJSON extension types
 *
 * This file is the SINGLE SOURCE OF TRUTH for all language-specific extension types.
 * As defined in ADR-002: ArchJSON Extensions v1.2
 */

// ========== Container ==========

/**
 * Type-safe extension container
 */
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;
  // Future: javaAtlas?, rustAtlas?, ...
}

// ========== Go Atlas Extension ==========

export const GO_ATLAS_EXTENSION_VERSION = '2.0';

/**
 * Go Architecture Atlas extension
 */
export interface GoAtlasExtension {
  version: string; // "1.0"
  layers: GoAtlasLayers;
  metadata: GoAtlasMetadata;
}

/**
 * Go Atlas layer definitions (partial generation supported)
 */
export interface GoAtlasLayers {
  package?: PackageGraph;
  capability?: CapabilityGraph;
  goroutine?: GoroutineTopology;
  flow?: FlowGraph;
}

/**
 * Go Atlas metadata
 */
export interface GoAtlasMetadata {
  generatedAt: string;
  generationStrategy: {
    functionBodyStrategy: 'none' | 'selective' | 'full';
    selectiveConfig?: {
      /**
       * AST node types that trigger body extraction
       * e.g. ['go_statement', 'send_statement', 'receive_expression']
       */
      triggerNodeTypes: string[];
      excludedTestFiles: boolean;
      extractedFunctionCount: number;
      totalFunctionCount: number;
    };
    detectedFrameworks: string[];   // e.g. ['gin', 'net/http']
    protocols?: string[];           // undefined = not filtered
    followIndirectCalls: boolean;
    goplsEnabled: boolean;
  };
  completeness: {
    package: number; // 0.0 - 1.0 (always 1.0)
    capability: number;
    goroutine: number;
    flow: number;
  };
  performance: {
    fileCount: number;
    parseTime: number; // ms
    totalTime: number; // ms
    memoryUsage: number; // bytes
  };
  warnings?: string[];
}

// ========== Package Dependency Graph ==========

export interface PackageGraph {
  nodes: PackageNode[];
  edges: PackageDependency[];
  cycles: PackageCycle[];
}

export interface PackageCycle {
  packages: string[]; // list of package IDs in the cycle
  severity: 'warning' | 'error';
}

export interface PackageNode {
  id: string; // e.g. "github.com/archguard/swarm-hub/pkg/hub"
  name: string; // e.g. "pkg/hub"
  type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd' | 'tests' | 'examples' | 'testutil';
  fileCount: number;
  stats?: PackageStats;
}

export interface PackageStats {
  structs: number;
  interfaces: number;
  functions: number;
}

export interface PackageDependency {
  from: string; // package id
  to: string; // package id
  strength: number; // number of imported symbols
  transitive?: boolean;
}

// ========== Capability Graph ==========

export interface CapabilityGraph {
  nodes: CapabilityNode[];
  edges: CapabilityRelation[];
  concreteUsageRisks?: ConcreteUsageRisk[];
}

export interface CapabilityNode {
  id: string;
  name: string;
  type: 'interface' | 'struct';
  package: string;
  exported: boolean;
  methodCount?: number;
  fieldCount?: number;
  fanIn?: number; // count of distinct source nodes pointing to this node
  fanOut?: number; // count of distinct target nodes this node points to
}

export interface CapabilityRelation {
  id: string;
  type: 'implements' | 'uses';
  source: string; // struct or function id
  target: string; // interface id
  confidence: number; // 0.0 - 1.0
  concreteUsage?: boolean; // true when target is a struct (not an interface)
  context?: {
    fieldType?: boolean;
    parameterType?: boolean;
    returnType?: boolean;
    usageLocations: string[]; // "file:line" references
  };
}

export interface ConcreteUsageRisk {
  owner: string; // source node ID (the struct that holds the field)
  fieldType: string; // raw field type string, e.g. "*engine.Engine"
  concreteType: string; // target node ID (the concrete struct being depended on)
  location: string; // "file:line" first usage location
}

// ========== Goroutine Topology ==========

export interface GoroutineLifecycleSummary {
  nodeId: string; // matches GoroutineNode.id (spawn-N format)
  spawnTargetName: string; // resolved target function name, e.g. "handleConn"
  // "<anonymous>" for closures
  receivesContext: boolean; // from function parameter list (always available)
  cancellationCheckAvailable: boolean; // false when function body was not extracted
  hasCancellationCheck?: boolean; // only present when cancellationCheckAvailable=true
  cancellationMechanism?: 'context' | 'channel';
  orphan: boolean;
}

export interface GoroutineTopology {
  nodes: GoroutineNode[];
  edges: SpawnRelation[];
  channels: ChannelInfo[];
  channelEdges: ChannelEdge[];
  lifecycle?: GoroutineLifecycleSummary[]; // one entry per spawned GoroutineNode
}

export interface GoroutineNode {
  id: string;
  name: string;
  type: 'main' | 'spawned';
  spawnType?: 'named_func' | 'anonymous_func' | 'method';
  package: string;
  location: {
    file: string;
    line: number;
  };
  pattern?: GoroutinePattern;
}

export type GoroutinePattern =
  | 'worker-pool'
  | 'pipeline'
  | 'fan-out'
  | 'fan-in'
  | 'orchestrator'
  | 'unknown';

export interface SpawnRelation {
  from: string; // spawner function id
  to: string; // spawned function id
  spawnType: 'go-func' | 'go-stmt';
}

export interface ChannelInfo {
  id: string;
  name: string; // variable name from make(chan), e.g. "jobs"
  type: string; // e.g. "chan Job"
  direction: 'send' | 'receive' | 'bidirectional';
  bufferSize?: number;
  location: {
    file: string;
    line: number;
  };
}

export interface ChannelEdge {
  from: string; // goroutine node ID (for make/send) OR channel ID (for recv)
  to: string; // channel ID (for make/send) OR goroutine node ID (for recv)
  edgeType: 'make' | 'send' | 'recv';
}

// ========== Flow Graph ==========

export interface FlowGraph {
  entryPoints: EntryPoint[];
  callChains: CallChain[];
}

export interface EntryPoint {
  id: string;
  protocol: EntryPointProtocol;
  method?: HttpMethod;          // only set when protocol === 'http'
  framework: string;            // e.g. 'gin', 'net/http', 'cobra'
  path: string; // HTTP path or gRPC method
  handler: string; // function id
  middleware: string[]; // middleware function ids
  package?: string; // Go package full path, e.g. "pkg/hub"
  location: {
    file: string;
    line: number;
  };
}

export type EntryPointProtocol = string; // built-ins: 'http'|'grpc'|'cli'|'message'|'scheduler'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY';

/**
 * @deprecated Use EntryPointProtocol + HttpMethod instead.
 * Kept as string alias for backward compatibility with GoAtlasMetadata.entryPointTypes.
 */
export type EntryPointType = string;

export interface CallChain {
  id: string;
  entryPoint: string; // entry point id
  calls: CallEdge[];
  errorPath?: CallEdge[];
}

export interface CallEdge {
  from: string;
  to: string;
  type: 'direct' | 'interface' | 'indirect';
  confidence: number;
}

// ========== TypeScript Analysis Extension ==========

export const TS_ANALYSIS_EXTENSION_VERSION = '1.0';

export interface TsAnalysis {
  version: string;
  moduleGraph?: TsModuleGraph;
}

export interface TsModuleGraph {
  nodes: TsModuleNode[];
  edges: TsModuleDependency[];
  cycles: TsModuleCycle[];
}

export interface TsModuleNode {
  id: string;
  name: string;
  type: 'internal' | 'external' | 'node_modules';
  fileCount: number;
  stats: { classes: number; interfaces: number; functions: number; enums: number };
}

export interface TsModuleDependency {
  from: string;
  to: string;
  strength: number;
  importedNames: string[];
}

export interface TsModuleCycle {
  modules: string[];
  severity: 'warning' | 'error';
}
