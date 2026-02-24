# Go Architecture Atlas Implementation Plan

**Plan ID**: 16
**Based on**: Proposal 16 - Go Architecture Atlas (v4.0)
**Created**: 2026-02-24
**Updated**: 2026-02-24 (v4.0 - Rigorous Architecture Review Corrections)
**Status**: Ready for Implementation
**Priority**: High

**Architecture Decisions**:
- [ADR-001: GoAtlasPlugin Composition](../adr/001-goatlas-plugin-composition.md) - 使用组合而非继承
- [ADR-002: ArchJSON Extensions](../adr/002-archjson-extensions.md) - 类型化扩展字段设计
- [Rigorous Architecture Review](../GO-ATLAS-RIGOROUS-REVIEW-v4.md) - 严苛架构师视角评审反馈

---

## 1. Overview

### 1.1 Objective

Implement a four-layer architecture visualization system for Go projects that addresses the fundamental differences between Go and traditional OOP languages:

- **Package Dependency Graph**: Module boundaries and cyclic dependencies
- **Capability Graph**: Interface usage and dependency inversion
- **Goroutine Topology**: Concurrent execution structure
- **Flow Graph**: Request flow and call chains

### 1.2 Scope

This plan focuses on implementing the Go Architecture Atlas system with the following architectural principles:

1. **No backward compatibility constraints**: We can adjust ArchGuard architecture for optimal design
2. **Composition over inheritance**: GoAtlasPlugin uses composition pattern (ADR-001)
3. **Type-safe extensions**: Explicit extension types in ArchJSON (ADR-002)
4. **Unified parsing API**: TreeSitterBridge with configurable body extraction (no double-parsing)
5. **Heuristic-based selective extraction**: Name pattern matching + keyword pre-scanning
6. **Complete configuration flow**: CLI flags → ParseConfig → Plugin behavior
7. **Go.mod-aware import resolution**: Distinguish internal vs external dependencies

### 1.3 Success Criteria

- Package Graph: 100% recoverability, accurate cycle detection
- Capability Graph: >85% recoverability, accurate interface usage detection
- Goroutine Topology: >70% spawn point detection (selective mode)
- Flow Graph: >70% HTTP entry point detection, >60% call chain accuracy (with gopls)
- Performance:
  - Baseline: 100 files < 5s (no Atlas)
  - None strategy: < 10% overhead vs baseline
  - Selective strategy: 2-3x faster than full strategy
- Test coverage: >90% core logic, >80% overall with ground truth validation

---

## 2. Architecture Overview

### 2.1 Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         GoAtlasPlugin                           │
│                  (implements ILanguagePlugin)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │   GoPlugin   │  │ BehaviorAnalyzer │  │  AtlasRenderer   │ │
│  │  (composed)  │  │    (coordinator) │  │     (new)        │ │
│  │              │  │                  │  │                  │ │
│  │ ┌────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐│ │
│  │ │TreeSitter  │ │  │ │PackageGraph │ │  │ │Mermaid      ││ │
│  │ │Bridge      │ │  │ │Builder      │ │  │ │Templates    ││ │
│  │ │            │ │  │ │             │ │  │ │             ││ │
│  │ │parseCode() │ │  │ │+GoModResolv-│ │  │ │Package      ││ │
│  │ │(config)    │ │  │ │ er          │ │  │ │Capability   ││ │
│  │ └────────────┘ │  │ └──────────────┘ │  │ │Goroutine    ││ │
│  │              │  │ ┌──────────────┐ │  │ │Flow         ││ │
│  │              │  │ │Capability   │ │  │ └──────────────┘│ │
│  │              │  │ │GraphBuilder │ │  │ ┌──────────────┐│ │
│  │              │  │ └──────────────┘ │  │ │JSON         ││ │
│  │              │  │                  │  │ │Serializer   ││ │
│  └──────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Components**:
- **GoPlugin** (composed): Standard Go parsing with TreeSitterBridge
- **BehaviorAnalyzer**: Coordinates graph builders, maintains shared cache
- **AtlasRenderer**: Contains Mermaid templates and JSON serializers
- **GoModResolver**: NEW - Resolves module path and classifies imports

### 2.2 Data Flow

```
Go Source Files
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ GoAtlasPlugin.parseProject(config: AtlasParseConfig)       │
│ ├─ Read config.atlas.functionBodyStrategy                  │
│ └─ Configure TreeSitterBridge                              │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ TreeSitterBridge.parseCode(code, path, parseOptions)       │
│ ├─ Single-pass parsing                                     │
│ ├─ Optional body extraction based on strategy             │
│ └─ Returns GoRawPackage with optional body data           │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GoModResolver.resolveProject(workspaceRoot)                │
│ ├─ Parse go.mod → module path                              │
│ └─ Classify imports: std | internal | external            │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GoRawProject                                               │
│ ├─ packages: Map<string, GoRawPackage>                    │
│ ├─ moduleRoot: string                                      │
│ ├─ moduleName: string (from go.mod)                        │
│ └─ classifiedImports: Map<package, ImportClassification[]>│
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ BehaviorAnalyzer.buildAll(project)                         │
│ ├─ buildPackageGraph() → PackageGraph                      │
│ ├─ buildCapabilityGraph() → CapabilityGraph                │
│ ├─ buildGoroutineTopology() → GoroutineTopology            │
│ └─ buildFlowGraph() → FlowGraph                            │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ AtlasRenderer.render(atlas, format)                        │
│ ├─ Mermaid templates (per layer)                           │
│ └─ JSON serialization                                      │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ ArchJSON                                                    │
│ ├─ version, language, entities, relations (standard)       │
│ └─ extensions.goAtlas (Atlas-specific data)                │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Configuration Flow (COMPLETE)

```
CLI Flags
  │
  ├─ --atlas (enable Atlas mode)
  ├─ --atlas-layers package,capability,goroutine,flow
  ├─ --atlas-strategy none|selective|full
  ├─ --atlas-no-tests
  ├─ --atlas-include-patterns "*Handler*","*Worker*"
  └─ --atlas-entry-points http,grpc
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ CLI Parser (src/cli/commands/analyze.ts)                   │
│ ├─ Parse flags → AtlasConfig object                        │
│ └─ Create AtlasParseConfig (extends ParseConfig)          │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ PluginRegistry.getPlugin('golang-atlas')                   │
│   └─ Returns GoAtlasPlugin instance                        │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GoAtlasPlugin.parseProject(root, config: AtlasParseConfig) │
│ ├─ Validate config.atlas exists (required, not optional)   │
│ ├─ Configure TreeSitterBridge.parseOptions                 │
│ │   ├─ functionBodyStrategy = config.atlas.strategy        │
│ │   ├─ selectiveConfig = config.atlas.selectiveConfig      │
│ │   └─ extractBodies = (strategy !== 'none')               │
│ └─ Delegate to composed GoPlugin                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Phases

### Phase 0: Foundation (Type System, Configuration, Baseline)

**Duration**: 5-7 days
**Objective**: Establish type system, configuration flow, and performance baseline

#### Task 1: Define Core Type Extensions

**File**: `src/core/interfaces/parser.ts`

```typescript
/**
 * Base parse configuration (unchanged for backward compatibility)
 */
export interface ParseConfig {
  filePattern?: string;
  exclude?: string[];
  concurrency?: number;
  verbose?: boolean;
}

/**
 * Atlas-specific configuration
 */
export interface AtlasConfig {
  enabled: true;  // Must be true for AtlasParseConfig
  functionBodyStrategy: FunctionBodyStrategy;
  layers?: AtlasLayer[];
  includeTests?: boolean;
  selectiveConfig?: SelectiveExtractionConfig;
  entryPointTypes?: EntryPointType[];
  followIndirectCalls?: boolean;
}

export type FunctionBodyStrategy = 'none' | 'selective' | 'full';

export interface SelectiveExtractionConfig {
  includePatterns?: string[];  // Regex patterns for function names
  excludeTestFiles?: boolean;
  includeGoroutines?: boolean;  // Heuristic: match names like *Start*, *Run*
  includeChannelOps?: boolean;  // Heuristic: match names like *Worker*, *Pool*
  maxFunctions?: number;
  complexityThreshold?: number; // Cyclomatic complexity
}

export type AtlasLayer = 'package' | 'capability' | 'goroutine' | 'flow';

export type EntryPointType =
  | 'http-get'
  | 'http-post'
  | 'http-put'
  | 'http-delete'
  | 'http-patch'
  | 'http-handler'
  | 'grpc-unary'
  | 'grpc-stream'
  | 'cli-command';

/**
 * Extended parse configuration for Atlas mode
 *
 * DESIGN RATIONALE:
 * - Uses intersection type for type safety
 * - atlas.enabled is required (not optional) to distinguish Atlas mode
 * - Allows compile-time validation of Atlas-specific features
 */
export type AtlasParseConfig = ParseConfig & {
  atlas: AtlasConfig;
};
```

#### Task 2: Extend Go Raw Types

**File**: `src/plugins/golang/types.ts`

```typescript
/**
 * Go project container with module information
 *
 * REPLACES: Previous "GoRawData" (never defined)
 * RATIONALE: Explicit project-level container for multi-file analysis
 */
export interface GoRawProject {
  packages: Map<string, GoRawPackage>;
  moduleRoot: string;
  moduleName: string;  // From go.mod: e.g., "github.com/user/project"
  goModPath: string;   // Path to go.mod file
  classifiedImports?: ImportClassificationMap;
}

export type ImportClassificationMap = Map<
  string,  // package name
  ImportClassification[]
>;

export interface ImportClassification {
  importPath: string;  // e.g., "github.com/gin-gonic/gin"
  type: 'std' | 'internal' | 'external' | 'vendor';
  resolvedPath?: string;  // For relative imports: full package path
}

/**
 * Function body behavior data (NEW)
 */
export interface GoFunctionBody {
  block: GoBlock;
  calls: GoCallExpr[];
  goSpawns: GoSpawnStmt[];
  channelOps: GoChannelOp[];
}

export interface GoBlock {
  statements: GoStatement[];
}

export type GoStatement =
  | GoCallExpr
  | GoSpawnStmt
  | GoChannelOp
  | GoIfStmt
  | GoForStmt
  | GoReturnStmt
  | GoAssignment
  | GoExpressionStmt;

/**
 * Extended GoFunction with optional body
 *
 * BACKWARD COMPATIBILITY:
 * - body is optional (undefined in standard GoPlugin mode)
 * - InterfaceMatcher and ArchJsonMapper must handle undefined body
 */
export interface GoFunction {
  name: string;
  packageName: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  body?: GoFunctionBody;  // Only present in Atlas mode
}

/**
 * Extended GoMethod with optional body
 */
export interface GoMethod {
  name: string;
  receiver?: string;
  receiverType?: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  body?: GoFunctionBody;  // Only present in Atlas mode
}

/**
 * Extended GoRawPackage with metadata
 */
export interface GoRawPackage {
  id: string;
  name: string;
  fullName: string;  // Full package path: e.g., "github.com/user/project/pkg/hub"
  dirPath: string;
  imports: GoImport[];
  structs: GoRawStruct[];
  interfaces: GoRawInterface[];
  functions: GoFunction[];
  // Note: dependencies computed by PackageGraphBuilder, not stored here
}

/**
 * Extended GoImport with classification
 */
export interface GoImport {
  path: string;
  alias?: string;
  location: GoSourceLocation;
  // classification filled by GoModResolver
  type?: 'std' | 'internal' | 'external' | 'vendor';
}

/**
 * Goroutine spawn statement
 */
export interface GoSpawnStmt {
  id: string;
  spawnType: 'go-func' | 'go-stmt';
  targetFunction: string;
  location: GoSourceLocation;
}

/**
 * Channel operation
 */
export interface GoChannelOp {
  id: string;
  operation: 'send' | 'receive' | 'close' | 'make';
  channelName: string;
  channelType?: string;
  bufferSize?: number;
  location: GoSourceLocation;
}

/**
 * Call expression
 */
export interface GoCallExpr {
  id: string;
  functionName: string;
  receiver?: string;
  packageName?: string;
  args: string[];
  location: GoSourceLocation;
}
```

#### Task 3: Define ArchJSON Extensions

**File**: `src/types/index.ts`

```typescript
/**
 * Extended ArchJSON with Go Atlas support
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

  // Type-safe extensions
  extensions?: ArchJSONExtensions;
}

export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  // Future: javaAtlas, rustAtlas, ...
}

export interface GoAtlasExtension {
  version: string;
  layers: GoAtlasLayers;
  metadata: GoAtlasMetadata;
}

export interface GoAtlasLayers {
  package?: PackageGraph;
  capability?: CapabilityGraph;
  goroutine?: GoroutineTopology;
  flow?: FlowGraph;
}

export interface GoAtlasMetadata {
  generatedAt: string;
  generationStrategy: {
    functionBodyStrategy: FunctionBodyStrategy;
    selectiveConfig?: {
      includedPatterns: string[];
      excludedTestFiles: boolean;
      extractedFunctionCount: number;
      totalFunctionCount: number;
    };
    entryPointTypes: EntryPointType[];
    followIndirectCalls: boolean;
    goplsEnabled: boolean;
  };
  completeness: {
    package: number;      // 0-1, estimated recoverability
    capability: number;
    goroutine: number;
    flow: number;
  };
  performance: {
    fileCount: number;
    parseTime: number;
    totalTime: number;
    memoryUsage: number;
  };
  warnings?: string[];
}
```

#### Task 4: Define Atlas Layer Types

**File**: `src/plugins/golang/atlas/types.ts`

```typescript
/**
 * Package Dependency Graph
 */
export interface PackageGraph {
  nodes: PackageNode[];
  edges: PackageDependency[];
  cycles: CycleInfo[];
}

export interface PackageNode {
  id: string;
  name: string;           // Short name: "pkg/hub"
  fullName: string;       // Full path: "github.com/user/project/pkg/hub"
  type: 'internal' | 'external' | 'vendor' | 'std';
  fileCount: number;
  structCount: number;
  interfaceCount: number;
}

export interface PackageDependency {
  from: string;          // Package ID
  to: string;            // Package ID
  strength: number;      // Number of imported symbols
  transitive: boolean;   // Whether this is a transitive dependency
}

export interface CycleInfo {
  packages: string[];    // Package IDs in the cycle
  length: number;        // Cycle length
}

/**
 * Capability Graph (Interface Usage)
 */
export interface CapabilityGraph {
  nodes: CapabilityNode[];
  edges: CapabilityRelation[];
}

export interface CapabilityNode {
  id: string;
  name: string;
  type: 'interface' | 'struct';
  package: string;
  exported: boolean;
}

export interface CapabilityRelation {
  id: string;
  type: 'implements' | 'uses';
  source: string;        // Node ID
  target: string;        // Node ID
  confidence: number;    // 0-1
  context?: {
    fieldType?: boolean;
    parameterType?: boolean;
    returnType?: boolean;
    usageLocations: string[];
  };
}

/**
 * Goroutine Topology
 */
export interface GoroutineTopology {
  nodes: GoroutineNode[];
  edges: SpawnRelation[];
  channels: ChannelInfo[];
}

export interface GoroutineNode {
  id: string;
  name: string;
  type: 'main' | 'spawned';
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
  from: string;
  to: string;
  spawnType: 'go-func' | 'go-stmt';
}

export interface ChannelInfo {
  id: string;
  type: string;
  direction: 'send' | 'receive' | 'bidirectional';
  bufferSize?: number;
  location: {
    file: string;
    line: number;
  };
}

/**
 * Flow Graph
 */
export interface FlowGraph {
  entryPoints: EntryPoint[];
  callChains: CallChain[];
}

export interface EntryPoint {
  id: string;
  type: EntryPointType;
  path: string;           // HTTP path, gRPC method, CLI command
  handler: string;        // Function name
  middleware: string[];
  location: {
    file: string;
    line: number;
  };
}

export interface CallChain {
  id: string;
  entryPoint: string;
  calls: CallEdge[];
  errorPath?: CallEdge[];
}

export interface CallEdge {
  from: string;
  to: string;
  type: 'direct' | 'interface' | 'indirect';
  confidence: number;
}

/**
 * Complete Atlas Structure
 */
export interface GoArchitectureAtlas {
  packageGraph?: PackageGraph;
  capabilityGraph?: CapabilityGraph;
  goroutineTopology?: GoroutineTopology;
  flowGraph?: FlowGraph;
}

/**
 * Rendering
 */
export type RenderFormat = 'mermaid' | 'json' | 'svg' | 'png';

export interface RenderResult {
  content: string;
  format: RenderFormat;
  layer: AtlasLayer;
}
```

#### Task 5: Implement GoModResolver

**File**: `src/plugins/golang/atlas/go-mod-resolver.ts`

```typescript
import fs from 'fs-extra';
import path from 'path';
import * as TOML from '@iarna/toml';

/**
 * Go module resolver for import classification
 *
 * RESPONSIBILITIES:
 * 1. Parse go.mod file
 * 2. Extract module name
 * 3. Classify imports: std | internal | external | vendor
 * 4. Resolve relative imports
 */
export class GoModResolver {
  private moduleInfo: ModuleInfo | null = null;

  /**
   * Parse go.mod and extract module information
   */
  async resolveProject(workspaceRoot: string): Promise<ModuleInfo> {
    const goModPath = path.join(workspaceRoot, 'go.mod');

    if (!fs.existsSync(goModPath)) {
      throw new Error(`go.mod not found at ${goModPath}`);
    }

    const content = await fs.readFile(goModPath, 'utf-8');

    // Parse go.mod (simplified, use proper parser in production)
    const moduleMatch = content.match(/^module\s+([^\s]+)/m);
    if (!moduleMatch) {
      throw new Error('Module declaration not found in go.mod');
    }

    const moduleName = moduleMatch[1];

    this.moduleInfo = {
      moduleName,
      moduleRoot: workspaceRoot,
      goModPath,
    };

    return this.moduleInfo;
  }

  /**
   * Classify an import path
   */
  classifyImport(importPath: string): ImportType {
    if (!this.moduleInfo) {
      throw new Error('GoModResolver not initialized. Call resolveProject() first.');
    }

    // Standard library
    if (this.isStandardLibrary(importPath)) {
      return 'std';
    }

    // Vendor directory
    if (importPath.startsWith('vendor/')) {
      return 'vendor';
    }

    // Internal package (starts with module name)
    if (importPath.startsWith(this.moduleInfo.moduleName)) {
      return 'internal';
    }

    // Relative import (needs resolution)
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // After resolution, will become internal
      return 'internal';
    }

    // External dependency
    return 'external';
  }

  /**
   * Resolve relative import to full package path
   */
  resolveRelativeImport(
    fromPackage: string,
    relativePath: string
  ): string | null {
    if (!this.moduleInfo) {
      throw new Error('GoModResolver not initialized');
    }

    if (!relativePath.startsWith('./') && !relativePath.startsWith('../')) {
      return null;
    }

    // Resolve relative to current package
    const fromDir = fromPackage.substring(this.moduleInfo.moduleName.length + 1);
    const baseDir = fromDir ? path.dirname(fromDir) : '.';
    const resolvedDir = path.posix.normalize(path.posix.join(baseDir, relativePath));

    return `${this.moduleInfo.moduleName}/${resolvedDir}`;
  }

  /**
   * Check if import is standard library
   */
  private isStandardLibrary(importPath: string): boolean {
    const stdLibs = new Set([
      'fmt', 'os', 'io', 'bufio', 'bytes', 'strings', 'strconv',
      'context', 'time', 'sync', 'sync/atomic', 'math',
      'net', 'net/http', 'net/url', 'encoding/json',
      // Add more as needed
    ]);

    // First segment determines if it's std
    const firstSegment = importPath.split('/')[0];
    return stdLibs.has(firstSegment);
  }

  getModuleName(): string {
    return this.moduleInfo?.moduleName ?? '';
  }
}

export interface ModuleInfo {
  moduleName: string;
  moduleRoot: string;
  goModPath: string;
}

export type ImportType = 'std' | 'internal' | 'external' | 'vendor';
```

#### Deliverables

- ✅ Complete type definitions (0 `any` types)
- ✅ TypeScript strict mode validation
- ✅ GoModResolver implementation
- ✅ Configuration flow documentation

#### Validation

```bash
npm run type-check  # Must pass with no errors
npm run lint       # Must pass with no warnings
```

---

### Phase 1: TreeSitterBridge Extension & Performance Baseline

**Duration**: 5-7 days
**Objective**: Extend TreeSitterBridge with configurable body extraction

#### Task 1: Extend TreeSitterBridge

**File**: `src/plugins/golang/tree-sitter-bridge.ts`

```typescript
import { Parser } from 'tree-sitter';
import Go from 'tree-sitter-go';
import type { GoRawPackage, GoFunction, GoMethod, GoFunctionBody } from './types.js';

/**
 * Parse options for TreeSitterBridge
 *
 * DESIGN RATIONALE:
 * - Single entry point for all parsing modes
 * - Options control behavior without changing API
 * - Avoids double-parsing (no separate parseCode vs parseCodeWithBodies)
 */
export interface ParseOptions {
  extractBodies?: boolean;
  strategy?: FunctionBodyStrategy;
  selectiveConfig?: SelectiveExtractionConfig;
}

/**
 * Extended TreeSitterBridge with configurable function body extraction
 */
export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Go);
  }

  /**
   * Parse Go code with optional function body extraction
   *
   * UNIFIED API: Single method handles all parsing modes
   *
   * @param code - Go source code
   * @param filePath - File path for error reporting
   * @param options - Parse configuration (body extraction strategy)
   * @returns GoRawPackage with optional function bodies
   */
  parseCode(
    code: string,
    filePath: string,
    options?: ParseOptions
  ): GoRawPackage {
    const rootNode = this.parser.parse(code).rootNode;

    // Extract package-level declarations
    const pkg = this.extractPackage(rootNode, code, filePath);

    // Extract functions (with optional bodies)
    pkg.functions = this.extractFunctions(
      rootNode,
      code,
      filePath,
      options ?? {}
    );

    // Extract methods in structs
    for (const struct of pkg.structs) {
      struct.methods = this.extractMethods(
        struct,
        rootNode,
        code,
        filePath,
        options ?? {}
      );
    }

    return pkg;
  }

  /**
   * Extract functions with optional bodies
   */
  private extractFunctions(
    rootNode: Parser.SyntaxNode,
    code: string,
    filePath: string,
    options: ParseOptions
  ): GoFunction[] {
    const funcDecls = rootNode.descendantsOfType('function_declaration');
    const functions: GoFunction[] = [];

    for (const funcDecl of funcDecls) {
      const func = this.extractFunctionSignature(funcDecl, code, filePath);

      // Decide whether to extract body
      if (options.extractBodies && this.shouldExtractFunction(func, options)) {
        func.body = this.extractFunctionBody(funcDecl, code, filePath);
      }

      functions.push(func);
    }

    return functions;
  }

  /**
   * Determine if function body should be extracted
   *
   * SELECTIVE STRATEGY ALGORITHM:
   * 1. Name-based heuristics (no body needed to decide)
   * 2. Keyword pre-scanning (fast, without full AST traversal)
   * 3. User-specified patterns
   *
   * AVOIDS CIRCULAR DEPENDENCY:
   * - Does NOT check func.body (which doesn't exist yet)
   * - Uses function signature and AST node for decision
   */
  private shouldExtractFunction(
    func: GoFunction,
    options: ParseOptions
  ): boolean {
    // Full strategy: extract everything
    if (options.strategy === 'full') return true;

    // Selective strategy: apply heuristics
    if (options.strategy === 'selective' && options.selectiveConfig) {
      const config = options.selectiveConfig;

      // Exclude test files
      if (config.excludeTestFiles && this.isTestFile(func.location.file)) {
        return false;
      }

      // User-specified patterns (highest priority)
      if (config.includePatterns && config.includePatterns.length > 0) {
        return config.includePatterns.some(pattern => {
          const regex = new RegExp(pattern);
          return regex.test(func.name);
        });
      }

      // Goroutine heuristics (name-based, no body scan needed)
      if (config.includeGoroutines) {
        const GOROUTINE_PATTERNS = [
          /Start.*/i, /Run.*/i, /Serve.*/i, /Handle.*/i,
          /Worker.*/i, /Spawn.*/i, /Process.*/i, /Consume.*/i
        ];
        if (GOROUTINE_PATTERNS.some(p => p.test(func.name))) {
          return true;
        }
      }

      // Channel operation heuristics (name-based)
      if (config.includeChannelOps) {
        const CHANNEL_PATTERNS = [
          /Worker.*/i, /Pool.*/i, /Producer.*/i,
          /Consumer.*/i, /Sender.*/i, /Receiver.*/i
        ];
        if (CHANNEL_PATTERNS.some(p => p.test(func.name))) {
          return true;
        }
      }

      // Default: extract if no specific filters (conservative)
      return true;
    }

    return false;
  }

  /**
   * Extract function body AST
   */
  private extractFunctionBody(
    funcNode: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoFunctionBody | undefined {
    const block = funcNode.childForFieldName('block');
    if (!block) return undefined;

    return {
      block: this.extractBlock(block, code, filePath),
      calls: this.extractCallExprs(block, code, filePath),
      goSpawns: this.extractGoSpawns(block, code, filePath),
      channelOps: this.extractChannelOps(block, code, filePath),
    };
  }

  /**
   * Extract goroutine spawn statements
   */
  private extractGoSpawns(
    block: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoSpawnStmt[] {
    const spawns: GoSpawnStmt[] = [];
    const goStmts = block.descendantsOfType('go_statement');

    for (const goStmt of goStmts) {
      const expr = goStmt.childForFieldName('expression');
      if (!expr) continue;

      // go func() { ... }
      if (expr.type === 'func_literal') {
        spawns.push({
          id: this.generateId(),
          spawnType: 'go-func',
          targetFunction: '<anonymous>',
          location: this.nodeToLocation(expr, filePath),
        });
        continue;
      }

      // go someFunction()
      const funcName = this.extractFunctionName(expr, code);
      if (funcName) {
        spawns.push({
          id: this.generateId(),
          spawnType: 'go-stmt',
          targetFunction: funcName,
          location: this.nodeToLocation(expr, filePath),
        });
      }
    }

    return spawns;
  }

  /**
   * Extract channel operations
   */
  private extractChannelOps(
    block: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoChannelOp[] {
    const ops: GoChannelOp[] = [];

    // make(chan T, size)
    const callExprs = block.descendantsOfType('call_expression');
    for (const call of callExprs) {
      const funcNode = call.childForFieldName('function');
      if (!funcNode) continue;

      const funcName = code.substring(funcNode.startIndex, funcNode.endIndex);

      if (funcName === 'make') {
        const op = this.parseMakeChan(call, code, filePath);
        if (op) ops.push(op);
      } else if (funcName === 'close') {
        const op = this.parseCloseChan(call, code, filePath);
        if (op) ops.push(op);
      }
    }

    // send (binary_expression): ch <- value
    const binExprs = block.descendantsOfType('binary_expression');
    for (const expr of binExprs) {
      const op = this.parseChannelSend(expr, code, filePath);
      if (op) ops.push(op);
    }

    // receive (unary_expression): <-ch
    const unaryExprs = block.descendantsOfType('unary_expression');
    for (const expr of unaryExprs) {
      const op = this.parseChannelReceive(expr, code, filePath);
      if (op) ops.push(op);
    }

    return ops;
  }

  // Helper methods
  private isTestFile(filePath: string): boolean {
    return filePath.endsWith('_test.go');
  }

  private generateId(): string {
    return `id-${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractFunctionName(node: Parser.SyntaxNode, code: string): string | null {
    if (node.type === 'identifier') {
      return code.substring(node.startIndex, node.endIndex);
    }
    if (node.type === 'selector_expression') {
      const field = node.childForFieldName('field');
      if (field) {
        return code.substring(field.startIndex, field.endIndex);
      }
    }
    return null;
  }

  private nodeToLocation(
    node: Parser.SyntaxNode,
    filePath: string
  ): GoSourceLocation {
    return {
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  // ... Other helper methods (extractBlock, extractCallExprs, parseMakeChan, etc.)
}
```

#### Task 2: Performance Baseline

**File**: `tests/baseline/go-plugin.bench.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { GoPlugin } from '@/plugins/golang/index.js';

describe('GoPlugin Performance Baseline', () => {
  const TEST_PROJECTS = {
    small: { files: 10, expected: '< 1s' },
    medium: { files: 100, expected: '< 5s' },
    large: { files: 500, expected: '< 30s' },
  };

  it('should establish baseline for 100 files (no Atlas)', async () => {
    const plugin = new GoPlugin();
    await plugin.initialize({});

    const start = performance.now();
    await plugin.parseProject('./test-data/medium-project', {
      filePattern: '**/*.go',
      exclude: ['**/vendor/**'],
    });
    const duration = performance.now() - start;

    console.log(`📊 Baseline: ${duration.toFixed(0)}ms for 100 files`);

    // Document baseline
    expect(duration).toBeLessThan(5000);
  });

  it('should establish memory baseline', async () => {
    const plugin = new GoPlugin();
    await plugin.initialize({});

    const before = process.memoryUsage().heapUsed;

    await plugin.parseProject('./test-data/medium-project', {});

    const after = process.memoryUsage().heapUsed;
    const memoryUsed = (after - before) / 1024 / 1024; // MB

    console.log(`📊 Memory: ${memoryUsed.toFixed(2)}MB for 100 files`);

    expect(memoryUsed).toBeLessThan(200); // Less than 200MB
  });
});

describe('TreeSitterBridge Performance', () => {
  it('none strategy: < 10% overhead vs baseline', async () => {
    const bridge = new TreeSitterBridge();
    const code = await fs.readFile('./test-data/sample.go', 'utf-8');

    const baseline = await benchmark(() =>
      bridge.parseCode(code, 'sample.go', {})
    );

    const withConfig = await benchmark(() =>
      bridge.parseCode(code, 'sample.go', {
        extractBodies: false,  // none strategy
      })
    );

    const overhead = ((withConfig - baseline) / baseline) * 100;

    console.log(`📊 Overhead: ${overhead.toFixed(1)}%`);

    expect(overhead).toBeLessThan(10);
  });

  it('selective strategy: 2-3x faster than full', async () => {
    const bridge = new TreeSitterBridge();
    const code = await fs.readFile('./test-data/sample.go', 'utf-8');

    const selectiveTime = await benchmark(() =>
      bridge.parseCode(code, 'sample.go', {
        extractBodies: true,
        strategy: 'selective',
        selectiveConfig: {
          includePatterns: ['.*Handler.*'],
          excludeTestFiles: true,
        },
      })
    );

    const fullTime = await benchmark(() =>
      bridge.parseCode(code, 'sample.go', {
        extractBodies: true,
        strategy: 'full',
      })
    );

    const ratio = fullTime / selectiveTime;

    console.log(`📊 Speedup: ${ratio.toFixed(1)}x`);

    expect(ratio).toBeGreaterThanOrEqual(2);
    expect(ratio).toBeLessThanOrEqual(3);
  });
});

async function benchmark(fn: () => void): Promise<number> {
  const iterations = 10;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  return times.reduce((a, b) => a + b) / iterations;
}
```

#### Deliverables

- ✅ TreeSitterBridge with unified `parseCode(options)` API
- ✅ Name-based heuristic selective extraction
- ✅ Performance baseline documentation
- ✅ Benchmark tests

---

### Phase 2: Package & Capability Graphs

**Duration**: 4-5 days
**Objective**: Build package dependency and capability graphs

#### Task 1: PackageGraphBuilder

**File**: `src/plugins/golang/atlas/builders/package-graph-builder.ts`

```typescript
import type { GoRawProject, PackageGraph } from '../types.js';
import { GoModResolver } from '../go-mod-resolver.js';

/**
 * Package dependency graph builder
 *
 * RESPONSIBILITIES:
 * 1. Extract package dependencies from imports
 * 2. Classify imports (std, internal, external)
 * 3. Detect cyclic dependencies
 */
export class PackageGraphBuilder {
  private goModResolver: GoModResolver;

  constructor() {
    this.goModResolver = new GoModResolver();
  }

  /**
   * Build package dependency graph
   *
   * @param project - Go project with classified imports
   * @returns Package dependency graph
   */
  async build(project: GoRawProject): Promise<PackageGraph> {
    const nodes = this.buildNodes(project);
    const edges = this.buildEdges(project);
    const cycles = this.detectCycles(nodes, edges);

    return { nodes, edges, cycles };
  }

  private buildNodes(project: GoRawProject): PackageNode[] {
    return Array.from(project.packages.values()).map(pkg => ({
      id: this.packageId(pkg),
      name: pkg.name,
      fullName: pkg.fullName,
      type: this.classifyPackage(pkg, project),
      fileCount: 0,  // TODO: Count files in package
      structCount: pkg.structs.length,
      interfaceCount: pkg.interfaces.length,
    }));
  }

  private buildEdges(project: GoRawProject): PackageDependency[] {
    const edges: PackageDependency[] = [];

    for (const pkg of project.packages.values()) {
      for (const imp of pkg.imports) {
        // Skip std library (not shown in graph)
        if (imp.type === 'std') continue;

        const targetPkg = this.findPackageByImport(imp.path, project);
        if (!targetPkg) continue;  // External dependency, skip

        edges.push({
          from: this.packageId(pkg),
          to: this.packageId(targetPkg),
          strength: 1,  // TODO: Count imported symbols
          transitive: false,  // TODO: Compute transitivity
        });
      }
    }

    return edges;
  }

  /**
   * Detect cyclic dependencies using Tarjan's algorithm
   */
  private detectCycles(
    nodes: PackageNode[],
    edges: PackageDependency[]
  ): CycleInfo[] {
    const graph = new Map<string, string[]>();

    for (const node of nodes) {
      graph.set(node.id, []);
    }

    for (const edge of edges) {
      graph.get(edge.from)?.push(edge.to);
    }

    const cycles: CycleInfo[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      for (const neighbor of graph.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push({
            packages: [...path.slice(cycleStart), neighbor],
            length: path.length - cycleStart + 1,
          });
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id);
      }
    }

    return cycles;
  }

  private classifyPackage(
    pkg: GoRawPackage,
    project: GoRawProject
  ): 'internal' | 'external' | 'vendor' | 'std' {
    if (pkg.fullName.startsWith(project.moduleName)) {
      return 'internal';
    }
    if (pkg.fullName.includes('/vendor/')) {
      return 'vendor';
    }
    return 'external';
  }

  private findPackageByImport(
    importPath: string,
    project: GoRawProject
  ): GoRawPackage | undefined {
    // Direct match
    if (project.packages.has(importPath)) {
      return project.packages.get(importPath);
    }

    // Search by full name
    for (const pkg of project.packages.values()) {
      if (pkg.fullName === importPath) {
        return pkg;
      }
    }

    return undefined;
  }

  private packageId(pkg: GoRawPackage): string {
    return pkg.fullName;
  }
}
```

#### Task 2: CapabilityGraphBuilder

**File**: `src/plugins/golang/atlas/builders/capability-graph-builder.ts`

```typescript
import type { GoRawProject, CapabilityGraph } from '../types.js';
import { InterfaceMatcher } from '../../interface-matcher.js';

/**
 * Capability (interface usage) graph builder
 *
 * RESPONSIBILITIES:
 * 1. Detect interface-to-struct implementations
 * 2. Detect interface usage in field types, parameters, return types
 * 3. Calculate confidence scores
 */
export class CapabilityGraphBuilder {
  private interfaceMatcher: InterfaceMatcher;

  constructor() {
    this.interfaceMatcher = new InterfaceMatcher();
  }

  /**
   * Build capability graph
   */
  async build(project: GoRawProject): Promise<CapabilityGraph> {
    const nodes = this.buildNodes(project);
    const edges = this.buildEdges(project);

    return { nodes, edges };
  }

  private buildNodes(project: GoRawProject) {
    const nodes = [];

    for (const pkg of project.packages.values()) {
      for (const iface of pkg.interfaces) {
        nodes.push({
          id: this.interfaceId(iface, pkg),
          name: iface.name,
          type: 'interface',
          package: pkg.fullName,
          exported: iface.exported,
        });
      }

      for (const struct of pkg.structs) {
        nodes.push({
          id: this.structId(struct, pkg),
          name: struct.name,
          type: 'struct',
          package: pkg.fullName,
          exported: struct.exported,
        });
      }
    }

    return nodes;
  }

  private buildEdges(project: GoRawProject) {
    const edges = [];

    // Reuse InterfaceMatcher for implementation detection
    const impls = this.interfaceMatcher.matchAllInterfaces(project);

    for (const impl of impls) {
      edges.push({
        id: `impl-${impl.structName}-${impl.interfaceName}`,
        type: 'implements',
        source: this.structId(impl.struct, impl.pkg),
        target: this.interfaceId(impl.iface, impl.pkg),
        confidence: impl.confidence,
        context: impl.context,
      });
    }

    // Detect interface usage (fields, parameters, return types)
    // TODO: Implement usage detection

    return edges;
  }

  private interfaceId(iface: GoRawInterface, pkg: GoRawPackage): string {
    return `${pkg.fullName}.${iface.name}`;
  }

  private structId(struct: GoRawStruct, pkg: GoRawPackage): string {
    return `${pkg.fullName}.${struct.name}`;
  }
}
```

#### Deliverables

- ✅ PackageGraphBuilder with cycle detection
- ✅ CapabilityGraphBuilder with confidence scoring
- ✅ Unit tests with mock Go projects
- ✅ Integration tests with real projects

---

### Phase 3: Goroutine Topology & Flow Graph

**Duration**: 4-5 days
**Objective**: Build goroutine topology and flow graphs

#### Task 1: GoroutineTopologyBuilder

**File**: `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts`

```typescript
import type { GoRawProject, GoroutineTopology } from '../types.js';

/**
 * Goroutine topology builder
 *
 * RESPONSIBILITIES:
 * 1. Extract goroutine spawn points
 * 2. Build spawn relationship graph
 * 3. Detect goroutine patterns (worker-pool, pipeline, etc.)
 */
export class GoroutineTopologyBuilder {
  /**
   * Build goroutine topology
   */
  async build(project: GoRawProject): Promise<GoroutineTopology> {
    const nodes = this.extractGoroutineNodes(project);
    const edges = this.buildSpawnRelations(project);
    const channels = this.extractChannelInfo(project);

    const patterns = this.classifyPatterns(nodes, edges, channels);

    return {
      nodes: nodes.map(n => ({ ...n, pattern: patterns.get(n.id) })),
      edges,
      channels,
    };
  }

  private extractGoroutineNodes(project: GoRawProject): GoroutineNode[] {
    const nodes: GoroutineNode[] = [];
    let mainFuncFound = false;

    for (const pkg of project.packages.values()) {
      for (const func of pkg.functions) {
        // Check if this is main.main
        if (func.name === 'main' && pkg.name === 'main') {
          nodes.push({
            id: 'main',
            name: 'main.main',
            type: 'main',
            package: pkg.fullName,
            location: func.location,
          });
          mainFuncFound = true;
        }

        // Check if function spawns goroutines
        if (func.body && func.body.goSpawns.length > 0) {
          for (const spawn of func.body.goSpawns) {
            nodes.push({
              id: spawn.id,
              name: spawn.targetFunction,
              type: 'spawned',
              package: pkg.fullName,
              location: spawn.location,
            });
          }
        }
      }
    }

    return nodes;
  }

  private buildSpawnRelations(project: GoRawProject): SpawnRelation[] {
    const relations: SpawnRelation[] = [];

    for (const pkg of project.packages.values()) {
      for (const func of pkg.functions) {
        if (!func.body) continue;

        const fromId = this.getFunctionId(func, pkg);

        for (const spawn of func.body.goSpawns) {
          relations.push({
            from: fromId,
            to: spawn.id,
            spawnType: spawn.spawnType,
          });
        }
      }
    }

    return relations;
  }

  private extractChannelInfo(project: GoRawProject): ChannelInfo[] {
    const channels: ChannelInfo[] = [];

    for (const pkg of project.packages.values()) {
      for (const func of pkg.functions) {
        if (!func.body) continue;

        for (const op of func.body.channelOps) {
          if (op.operation === 'make') {
            channels.push({
              id: op.id,
              type: op.channelType ?? 'chan',
              direction: 'bidirectional',
              bufferSize: op.bufferSize,
              location: op.location,
            });
          }
        }
      }
    }

    return channels;
  }

  private classifyPatterns(
    nodes: GoroutineNode[],
    edges: SpawnRelation[],
    channels: ChannelInfo[]
  ): Map<string, GoroutinePattern> {
    const patterns = new Map<string, GoroutinePattern>();

    // Detect worker pool: N goroutines + shared channel
    const nodeGroups = this.groupByLocation(nodes);
    for (const [location, group] of nodeGroups) {
      if (group.length > 2 && this.hasSharedChannel(group, channels)) {
        for (const node of group) {
          patterns.set(node.id, 'worker-pool');
        }
      }
    }

    // TODO: Detect more patterns (pipeline, fan-out, fan-in)

    return patterns;
  }

  private getFunctionId(func: GoFunction, pkg: GoRawPackage): string {
    if (func.name === 'main' && pkg.name === 'main') {
      return 'main';
    }
    return `${pkg.fullName}.${func.name}`;
  }

  private groupByLocation(nodes: GoroutineNode[]): Map<string, GoroutineNode[]> {
    const groups = new Map<string, GoroutineNode[]>();

    for (const node of nodes) {
      const key = `${node.location.file}:${node.location.line}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(node);
    }

    return groups;
  }

  private hasSharedChannel(nodes: GoroutineNode[], channels: ChannelInfo[]): boolean {
    // Simplified check: are there channels in the same location?
    return channels.length > 0;
  }
}
```

#### Task 2: FlowGraphBuilder

**File**: `src/plugins/golang/atlas/builders/flow-graph-builder.ts`

```typescript
import type { GoRawProject, FlowGraph } from '../types.js';

/**
 * Flow graph builder (entry points and call chains)
 *
 * RESPONSIBILITIES:
 * 1. Detect HTTP entry points (http.HandleFunc, gin.Engine, etc.)
 * 2. Build call chains from entry points
 * 3. Use gopls for interface call resolution (if available)
 */
export class FlowGraphBuilder {
  /**
   * Build flow graph
   */
  async build(project: GoRawProject): Promise<FlowGraph> {
    const entryPoints = this.detectEntryPoints(project);
    const callChains = await this.buildCallChains(project, entryPoints);

    return { entryPoints, callChains };
  }

  private detectEntryPoints(project: GoRawProject): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    for (const pkg of project.packages.values()) {
      for (const func of pkg.functions) {
        // Check for HTTP handler patterns
        if (this.isHttpHandler(func, pkg)) {
          entryPoints.push({
            id: this.functionId(func, pkg),
            type: 'http-handler',
            path: this.extractHttpPath(func),
            handler: func.name,
            middleware: [],
            location: func.location,
          });
        }

        // Check for gRPC methods
        if (this.isGrpcMethod(func, pkg)) {
          entryPoints.push({
            id: this.functionId(func, pkg),
            type: 'grpc-unary',
            path: func.name,
            handler: func.name,
            middleware: [],
            location: func.location,
          });
        }
      }
    }

    return entryPoints;
  }

  private async buildCallChains(
    project: GoRawProject,
    entryPoints: EntryPoint[]
  ): Promise<CallChain[]> {
    const chains: CallChain[] = [];

    for (const entry of entryPoints) {
      const calls = this.extractDirectCalls(project, entry);
      chains.push({
        id: `chain-${entry.id}`,
        entryPoint: entry.id,
        calls,
      });
    }

    return chains;
  }

  private extractDirectCalls(
    project: GoRawProject,
    entry: EntryPoint
  ): CallEdge[] {
    const calls: CallEdge[] = [];

    // Find function body
    const func = this.findFunctionByName(entry.handler, project);
    if (!func?.body) return calls;

    for (const call of func.body.calls) {
      calls.push({
        from: entry.id,
        to: call.functionName,
        type: 'direct',
        confidence: 1.0,
      });
    }

    return calls;
  }

  // Helper methods
  private isHttpHandler(func: GoFunction, pkg: GoRawPackage): boolean {
    // Check if function signature matches http.HandlerFunc
    // TODO: Implement signature matching
    return func.name.includes('Handler') || func.name.includes('Handle');
  }

  private isGrpcMethod(func: GoFunction, pkg: GoRawPackage): boolean {
    // Check if function is in a grpc service
    // TODO: Implement grpc detection
    return false;
  }

  private extractHttpPath(func: GoFunction): string {
    // Try to extract path from comments or annotations
    // TODO: Implement path extraction
    return `/${func.name}`;
  }

  private findFunctionByName(name: string, project: GoRawProject): GoFunction | undefined {
    for (const pkg of project.packages.values()) {
      for (const func of pkg.functions) {
        if (func.name === name) return func;
      }
    }
    return undefined;
  }

  private functionId(func: GoFunction, pkg: GoRawPackage): string {
    return `${pkg.fullName}.${func.name}`;
  }
}
```

#### Deliverables

- ✅ GoroutineTopologyBuilder with pattern detection
- ✅ FlowGraphBuilder with entry point detection
- ✅ Unit tests for each builder
- ✅ Integration tests with real projects

---

### Phase 4: AtlasRenderer & CLI Integration

**Duration**: 3-4 days
**Objective**: Implement rendering and CLI integration

#### Task 1: Mermaid Templates

**File**: `src/plugins/golang/atlas/renderers/mermaid-templates.ts`

```typescript
import type {
  PackageGraph,
  CapabilityGraph,
  GoroutineTopology,
  FlowGraph,
} from '../types.js';

/**
 * Mermaid template renderer for Go Atlas layers
 *
 * RESPONSIBILITIES:
 * 1. Generate Mermaid syntax for each layer
 * 2. Handle node and edge styling
 * 3. Support custom themes
 */
export class MermaidTemplates {
  /**
   * Render package dependency graph
   *
   * Mermaid syntax: flowchart TB (top-to-bottom)
   */
  static renderPackageGraph(graph: PackageGraph): string {
    let output = 'flowchart TB\n';

    // Define nodes
    for (const node of graph.nodes) {
      const label = node.name;  // Short name for readability
      const style = this.getNodeStyle(node.type);

      output += `  ${this.nodeId(node)}[${label}]${style}\n`;
    }

    // Define edges
    for (const edge of graph.edges) {
      const label = edge.strength > 1 ? ` |${edge.strength}|` : '';
      output += `  ${this.nodeIdById(edge.from)} -->${label} ${this.nodeIdById(edge.to)}\n`;
    }

    // Add cycle warnings
    if (graph.cycles.length > 0) {
      output += '\n  %% Cycles detected:\n';
      for (const cycle of graph.cycles) {
        const cycleStr = cycle.packages.join(' → ');
        output += `  %% Cycle: ${cycleStr}\n`;
      }
    }

    return output;
  }

  /**
   * Render capability (interface usage) graph
   *
   * Mermaid syntax: flowchart LR (left-to-right)
   */
  static renderCapabilityGraph(graph: CapabilityGraph): string {
    let output = 'flowchart LR\n';

    // Define nodes
    for (const node of graph.nodes) {
      const label = node.name;
      const shape = node.type === 'interface' ? '([ ])' : '[ ]';
      const style = node.exported ? '' : ':::private';

      output += `  ${this.nodeId(node)}${shape}${style}\n`;
    }

    // Define edges
    for (const edge of graph.edges) {
      if (edge.type === 'implements') {
        output += `  ${this.nodeIdById(edge.source)} -.->|impl| ${this.nodeIdById(edge.target)}\n`;
      } else {
        output += `  ${this.nodeIdById(edge.source)} -->|uses| ${this.nodeIdById(edge.target)}\n`;
      }
    }

    // Add styles
    output += '\n  classDef private fill:#f9f,stroke:#333,stroke-width:1px\n';
    output += '  classDef interface fill:#bbf,stroke:#333,stroke-width:2px\n';

    return output;
  }

  /**
   * Render goroutine topology
   *
   * Mermaid syntax: flowchart TB
   */
  static renderGoroutineTopology(topology: GoroutineTopology): string {
    let output = 'flowchart TB\n';

    // Define nodes
    for (const node of topology.nodes) {
      const label = node.name;
      const style = node.type === 'main' ? ':::main' : ':::worker';
      const patternLabel = node.pattern ? ` (${node.pattern})` : '';

      output += `  ${node.id}[${label}${patternLabel}]${style}\n`;
    }

    // Define spawn edges
    for (const edge of topology.edges) {
      const label = edge.spawnType === 'go-func' ? ' (func)' : ' (stmt)';
      output += `  ${edge.from} -->|go${label}| ${edge.to}\n`;
    }

    // Define channels (as subgraph)
    if (topology.channels.length > 0) {
      output += '\n  subgraph channels\n';
      for (const ch of topology.channels) {
        output += `    ${ch.id}[${ch.type}]:::channel\n`;
      }
      output += '  end\n';
    }

    // Add styles
    output += '\n  classDef main fill:#f66,stroke:#333,stroke-width:2px\n';
    output += '  classDef worker fill:#6f6,stroke:#333,stroke-width:1px\n';
    output += '  classDef channel fill:#ff6,stroke:#333,stroke-width:1px\n';

    return output;
  }

  /**
   * Render flow graph
   *
   * Mermaid syntax: sequenceDiagram (for call chains)
   */
  static renderFlowGraph(graph: FlowGraph): string {
    let output = 'sequenceDiagram\n';

    for (const chain of graph.callChains) {
      const entry = graph.entryPoints.find(e => e.id === chain.entryPoint);
      if (!entry) continue;

      output += `\n  Note over ${entry.handler}: ${entry.type} ${entry.path}\n`;

      for (const call of chain.calls) {
        output += `  ${entry.handler}->>+${call.to}: call\n`;
        output += `  ${call.to}-->>-${entry.handler}: return\n`;
      }
    }

    return output;
  }

  // Helper methods
  private static nodeId(node: { id: string }): string {
    return node.id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private static nodeIdById(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private static nodeIdById(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private static getNodeStyle(type: string): string {
    switch (type) {
      case 'internal':
        return ':::internal';
      case 'external':
        return ':::external';
      case 'std':
        return ':::std';
      default:
        return '';
    }
  }
}
```

#### Task 2: AtlasRenderer

**File**: `src/plugins/golang/atlas/renderers/atlas-renderer.ts`

```typescript
import type {
  GoArchitectureAtlas,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from '../types.js';
import { MermaidTemplates } from './mermaid-templates.js';

/**
 * Atlas renderer for multiple output formats
 */
export class AtlasRenderer {
  /**
   * Render a single layer
   */
  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: RenderFormat
  ): Promise<RenderResult> {
    switch (format) {
      case 'mermaid':
        return this.renderMermaid(atlas, layer);
      case 'json':
        return this.renderJson(atlas, layer);
      case 'svg':
      case 'png':
        return this.renderGraphic(atlas, layer, format);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Render all layers
   */
  async renderAll(
    atlas: GoArchitectureAtlas,
    format: RenderFormat
  ): Promise<Map<AtlasLayer, RenderResult>> {
    const results = new Map<AtlasLayer, RenderResult>();

    const layers: AtlasLayer[] = ['package', 'capability', 'goroutine', 'flow'];

    for (const layer of layers) {
      try {
        const result = await this.renderLayer(atlas, layer, format);
        results.set(layer, result);
      } catch (error) {
        console.warn(`Failed to render ${layer}:`, error);
      }
    }

    return results;
  }

  private renderMermaid(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer
  ): RenderResult {
    switch (layer) {
      case 'package':
        return {
          content: MermaidTemplates.renderPackageGraph(atlas.packageGraph!),
          format: 'mermaid',
          layer,
        };
      case 'capability':
        return {
          content: MermaidTemplates.renderCapabilityGraph(atlas.capabilityGraph!),
          format: 'mermaid',
          layer,
        };
      case 'goroutine':
        return {
          content: MermaidTemplates.renderGoroutineTopology(atlas.goroutineTopology!),
          format: 'mermaid',
          layer,
        };
      case 'flow':
        return {
          content: MermaidTemplates.renderFlowGraph(atlas.flowGraph!),
          format: 'mermaid',
          layer,
        };
      default:
        throw new Error(`Unknown layer: ${layer}`);
    }
  }

  private renderJson(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer
  ): RenderResult {
    const data = atlas[`${layer}Graph` ?? `${layer}Topology`];
    return {
      content: JSON.stringify(data, null, 2),
      format: 'json',
      layer,
    };
  }

  private async renderGraphic(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: 'svg' | 'png'
  ): Promise<RenderResult> {
    // Render to Mermaid first
    const mermaid = this.renderMermaid(atlas, layer);

    // Use isomorphic-mermaid for rendering
    // TODO: Implement SVG/PNG rendering
    throw new Error('Graphic rendering not yet implemented');
  }
}
```

#### Task 3: CLI Integration

**File**: `src/cli/commands/analyze.ts`

```typescript
import { Command } from 'commander';
import type { AtlasParseConfig, FunctionBodyStrategy } from '@/core/interfaces/parser.js';

export function registerAtlasOptions(command: Command): Command {
  return command
    .option('--atlas', 'Enable Go Architecture Atlas mode')
    .option(
      '--atlas-layers <layers>',
      'Atlas layers to generate (comma-separated)',
      'package,capability,goroutine,flow'
    )
    .option(
      '--atlas-strategy <strategy>',
      'Function body extraction strategy',
      'selective'
    )
    .option('--atlas-no-tests', 'Exclude test files from selective extraction')
    .option(
      '--atlas-include-patterns <patterns>',
      'Function name patterns for selective extraction (comma-separated)'
    )
    .option(
      '--atlas-entry-points <types>',
      'Entry point types for flow graph (comma-separated)',
      'http,grpc'
    );
}

export function createAtlasConfig(options: {
  atlas?: boolean;
  atlasLayers?: string;
  atlasStrategy?: string;
  atlasNoTests?: boolean;
  atlasIncludePatterns?: string;
  atlasEntryPoints?: string;
}): AtlasParseConfig | null {
  if (!options.atlas) {
    return null;
  }

  const layers = options.atlasLayers?.split(',') ?? ['package'];
  const strategy = options.atlasStrategy as FunctionBodyStrategy;
  const patterns = options.atlasIncludePatterns?.split(',');

  return {
    filePattern: '**/*.go',
    exclude: ['**/vendor/**'],
    atlas: {
      enabled: true,
      functionBodyStrategy: strategy,
      layers: layers as AtlasLayer[],
      includeTests: !options.atlasNoTests,
      selectiveConfig: {
        excludeTestFiles: options.atlasNoTests,
        includePatterns: patterns,
        includeGoroutines: true,
        includeChannelOps: true,
      },
      entryPointTypes: options.atlasEntryPoints?.split(',') ?? ['http-handler'],
      followIndirectCalls: false,
    },
  };
}
```

#### Deliverables

- ✅ MermaidTemplates with complete templates
- ✅ AtlasRenderer with multi-format support
- ✅ CLI integration with all flags
- ✅ Documentation and examples

---

### Phase 5: GoAtlasPlugin Integration

**Duration**: 3-4 days
**Objective**: Integrate all components into GoAtlasPlugin

#### Task 1: GoAtlasPlugin Implementation

**File**: `src/plugins/golang/atlas/index.ts`

```typescript
import type { ILanguagePlugin, PluginMetadata, PluginInitConfig } from '@/core/interfaces/language-plugin.js';
import type { AtlasParseConfig, ArchJSON } from '@/core/interfaces/parser.js';
import type { GoRawProject, GoArchitectureAtlas } from './types.js';
import { GoPlugin } from '../index.js';
import { BehaviorAnalyzer } from './behavior-analyzer.js';
import { AtlasRenderer } from './renderers/atlas-renderer.js';
import { GoModResolver } from './go-mod-resolver.js';

/**
 * Go Architecture Atlas Plugin
 *
 * ARCHITECTURE (ADR-001):
 * - Uses COMPOSITION, not inheritance
 * - Delegates standard parsing to GoPlugin
 * - Adds Atlas-specific behavior analysis and rendering
 */
export class GoAtlasPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'golang-atlas',
    version: '2.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    author: 'ArchGuard Team',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
      atlasGeneration: true,  // Extended capability
    },
  };

  // Composed components
  private goPlugin: GoPlugin;
  private behaviorAnalyzer: BehaviorAnalyzer;
  private atlasRenderer: AtlasRenderer;
  private goModResolver: GoModResolver;

  constructor() {
    this.goPlugin = new GoPlugin();
    this.behaviorAnalyzer = new BehaviorAnalyzer();
    this.atlasRenderer = new AtlasRenderer();
    this.goModResolver = new GoModResolver();
  }

  async initialize(config: PluginInitConfig): Promise<void> {
    await this.goPlugin.initialize(config);
    await this.behaviorAnalyzer.initialize(config);
  }

  canHandle(targetPath: string): boolean {
    return this.goPlugin.canHandle(targetPath);
  }

  /**
   * Parse project with Atlas support
   *
   * @param workspaceRoot - Project root directory
   * @param config - MUST be AtlasParseConfig (atlas.enabled = true)
   * @returns ArchJSON with Atlas extensions
   */
  async parseProject(
    workspaceRoot: string,
    config: AtlasParseConfig
  ): Promise<ArchJSON> {
    // Validate config
    if (!config.atlas?.enabled) {
      throw new Error('GoAtlasPlugin requires AtlasParseConfig with atlas.enabled = true');
    }

    const startTime = performance.now();

    // Resolve module information
    const moduleInfo = await this.goModResolver.resolveProject(workspaceRoot);

    // Configure TreeSitterBridge
    const parseOptions = {
      extractBodies: config.atlas.functionBodyStrategy !== 'none',
      strategy: config.atlas.functionBodyStrategy,
      selectiveConfig: config.atlas.selectiveConfig,
    };

    // Parse all files
    // TODO: Extend GoPlugin to accept parseOptions
    const baseArchJSON = await this.goPlugin.parseProject(workspaceRoot, config);

    // Collect packages into GoRawProject
    const rawProject = await this.collectRawProject(workspaceRoot, parseOptions);

    // Classify imports
    await this.classifyImports(rawProject);

    // Build all requested layers
    const atlas = await this.behaviorAnalyzer.buildAll(rawProject, config.atlas.layers ?? []);

    // Add Atlas extension to ArchJSON
    baseArchJSON.extensions = {
      goAtlas: {
        version: '2.0.0',
        layers: atlas,
        metadata: {
          generatedAt: new Date().toISOString(),
          generationStrategy: {
            functionBodyStrategy: config.atlas.functionBodyStrategy,
            selectiveConfig: config.atlas.selectiveConfig,
            entryPointTypes: config.atlas.entryPointTypes ?? [],
            followIndirectCalls: config.atlas.followIndirectCalls ?? false,
            goplsEnabled: false,  // TODO: Detect gopls availability
          },
          completeness: this.calculateCompleteness(atlas),
          performance: {
            fileCount: rawProject.packages.size,
            parseTime: performance.now() - startTime,
            totalTime: performance.now() - startTime,
            memoryUsage: process.memoryUsage().heapUsed,
          },
        },
      },
    };

    return baseArchJSON;
  }

  private async collectRawProject(
    workspaceRoot: string,
    parseOptions: any
  ): Promise<GoRawProject> {
    // TODO: Implement package collection with parseOptions
    throw new Error('Not implemented');
  }

  private async classifyImports(project: GoRawProject): Promise<void> {
    // TODO: Classify all imports using GoModResolver
  }

  private calculateCompleteness(atlas: GoArchitectureAtlas) {
    return {
      package: atlas.packageGraph ? 1.0 : 0,
      capability: atlas.capabilityGraph ? 0.85 : 0,
      goroutine: atlas.goroutineTopology ? 0.7 : 0,
      flow: atlas.flowGraph ? 0.6 : 0,
    };
  }
}
```

#### Task 2: BehaviorAnalyzer Coordinator

**File**: `src/plugins/golang/atlas/behavior-analyzer.ts`

```typescript
import type { GoRawProject, GoArchitectureAtlas, AtlasLayer } from './types.js';
import { PackageGraphBuilder } from './builders/package-graph-builder.js';
import { CapabilityGraphBuilder } from './builders/capability-graph-builder.js';
import { GoroutineTopologyBuilder } from './builders/goroutine-topology-builder.js';
import { FlowGraphBuilder } from './builders/flow-graph-builder.js';

/**
 * Behavior analysis coordinator
 *
 * RESPONSIBILITIES:
 * 1. Coordinate multiple graph builders
 * 2. Share data between builders (caching)
 * 3. Build complete GoArchitectureAtlas
 */
export class BehaviorAnalyzer {
  private packageGraphBuilder: PackageGraphBuilder;
  private capabilityGraphBuilder: CapabilityGraphBuilder;
  private goroutineTopologyBuilder: GoroutineTopologyBuilder;
  private flowGraphBuilder: FlowGraphBuilder;

  private cache = new Map<string, any>();

  constructor() {
    this.packageGraphBuilder = new PackageGraphBuilder();
    this.capabilityGraphBuilder = new CapabilityGraphBuilder();
    this.goroutineTopologyBuilder = new GoroutineTopologyBuilder();
    this.flowGraphBuilder = new FlowGraphBuilder();
  }

  async initialize(config: any): Promise<void> {
    // Initialize builders if needed
  }

  /**
   * Build all requested layers
   *
   * @param project - Go project data
   * @param layers - Layers to build (undefined = all)
   * @returns Complete architecture atlas
   */
  async buildAll(
    project: GoRawProject,
    layers?: AtlasLayer[]
  ): Promise<GoArchitectureAtlas> {
    const atlas: GoArchitectureAtlas = {};

    // Build all requested layers in parallel
    const buildTasks = [];

    if (!layers || layers.includes('package')) {
      buildTasks.push(
        this.buildPackageGraph(project).then(graph => {
          atlas.packageGraph = graph;
        })
      );
    }

    if (!layers || layers.includes('capability')) {
      buildTasks.push(
        this.buildCapabilityGraph(project).then(graph => {
          atlas.capabilityGraph = graph;
        })
      );
    }

    if (!layers || layers.includes('goroutine')) {
      buildTasks.push(
        this.buildGoroutineTopology(project).then(topology => {
          atlas.goroutineTopology = topology;
        })
      );
    }

    if (!layers || layers.includes('flow')) {
      buildTasks.push(
        this.buildFlowGraph(project).then(graph => {
          atlas.flowGraph = graph;
        })
      );
    }

    await Promise.all(buildTasks);

    return atlas;
  }

  async buildPackageGraph(project: GoRawProject) {
    if (this.cache.has('package-graph')) {
      return this.cache.get('package-graph');
    }
    const graph = await this.packageGraphBuilder.build(project);
    this.cache.set('package-graph', graph);
    return graph;
  }

  async buildCapabilityGraph(project: GoRawProject) {
    if (this.cache.has('capability-graph')) {
      return this.cache.get('capability-graph');
    }
    const graph = await this.capabilityGraphBuilder.build(project);
    this.cache.set('capability-graph', graph);
    return graph;
  }

  async buildGoroutineTopology(project: GoRawProject) {
    if (this.cache.has('goroutine-topology')) {
      return this.cache.get('goroutine-topology');
    }
    const topology = await this.goroutineTopologyBuilder.build(project);
    this.cache.set('goroutine-topology', topology);
    return topology;
  }

  async buildFlowGraph(project: GoRawProject) {
    if (this.cache.has('flow-graph')) {
      return this.cache.get('flow-graph');
    }
    const graph = await this.flowGraphBuilder.build(project);
    this.cache.set('flow-graph', graph);
    return graph;
  }
}
```

#### Deliverables

- ✅ GoAtlasPlugin with composition architecture
- ✅ BehaviorAnalyzer with coordination logic
- ✅ Integration tests

---

### Phase 6: Testing & Validation

**Duration**: 3-4 days
**Objective**: Comprehensive testing with ground truth validation

#### Task 1: Unit Tests

**File**: `tests/unit/atlas/package-graph-builder.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { PackageGraphBuilder } from '@/plugins/golang/atlas/builders/package-graph-builder.js';
import type { GoRawProject } from '@/plugins/golang/types.js';

describe('PackageGraphBuilder', () => {
  it('should detect simple package dependencies', async () => {
    const project: GoRawProject = {
      packages: new Map([
        ['main', {
          name: 'main',
          fullName: 'test/main',
          imports: [{ path: 'fmt', type: 'std', location: { file: 'main.go' } }],
          structs: [],
          interfaces: [],
          functions: [],
        }],
      ]),
      moduleRoot: '/test',
      moduleName: 'test',
      goModPath: '/test/go.mod',
    };

    const builder = new PackageGraphBuilder();
    const graph = await builder.build(project);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);  // std lib excluded
  });

  it('should detect cyclic dependencies', async () => {
    // TODO: Test with cyclic imports
  });
});
```

#### Task 2: Ground Truth Validation

**File**: `tests/validation/atlas-accuracy.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { GoAtlasPlugin } from '@/plugins/golang/atlas/index.js';
import { readFileSync } from 'fs-extra';

describe('Atlas Accuracy Validation', () => {
  const GROUND_TRUTH = {
    'swarm-hub': {
      packageGraphCycles: [
        'pkg/hub → pkg/runtime → pkg/hub'
      ],
      interfaceUsageAccuracy: 0.85,
      goroutineSpawnPoints: 42,
    },
  };

  it('should detect >85% of interface usages in swarm-hub', async () => {
    const plugin = new GoAtlasPlugin();
    await plugin.initialize({});

    const result = await plugin.parseProject('./test-data/swarm-hub', {
      atlas: {
        enabled: true,
        functionBodyStrategy: 'selective',
        layers: ['capability'],
      },
    });

    const capabilityGraph = result.extensions?.goAtlas?.layers.capability;
    expect(capabilityGraph).toBeDefined();

    // Calculate accuracy against ground truth
    // TODO: Implement accuracy calculation
  });
});
```

#### Task 3: Performance Benchmarks

**File**: `tests/benchmark/atlas-performance.bench.ts`

```typescript
describe('Atlas Performance Benchmarks', () => {
  it('should meet performance targets', async () => {
    const plugin = new GoAtlasPlugin();
    await plugin.initialize({});

    const config = {
      atlas: {
        enabled: true,
        functionBodyStrategy: 'selective',
        layers: ['package', 'capability'],
      },
    };

    const start = performance.now();
    await plugin.parseProject('./test-data/medium-project', config);
    const duration = performance.now() - start;

    console.log(`📊 Atlas: ${duration.toFixed(0)}ms`);

    // Should be < 10s for 100 files with selective strategy
    expect(duration).toBeLessThan(10000);
  });
});
```

#### Deliverables

- ✅ Unit tests for all builders
- ✅ Ground truth validation
- ✅ Performance benchmarks
- ✅ Test fixtures

---

## 4. Implementation Summary

### Timeline

| Phase | Duration | Dependencies | Deliverables |
|-------|----------|--------------|--------------|
| Phase 0 | 5-7 days | None | Type system, GoModResolver, baseline |
| Phase 1 | 5-7 days | Phase 0 | TreeSitterBridge extension, benchmarks |
| Phase 2 | 4-5 days | Phase 1 | Package & Capability graphs |
| Phase 3 | 4-5 days | Phase 1 | Goroutine & Flow graphs |
| Phase 4 | 3-4 days | Phase 2,3 | Rendering, CLI integration |
| Phase 5 | 3-4 days | Phase 4 | GoAtlasPlugin integration |
| Phase 6 | 3-4 days | Phase 5 | Testing, validation |
| **Total** | **27-36 days** | | |

### Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Performance targets missed | MEDIUM | MEDIUM | Early baseline, continuous benchmarking |
| Selective extraction accuracy | MEDIUM | HIGH | Name-based heuristics + user patterns |
| Import resolution complexity | LOW | MEDIUM | GoModResolver dedicated component |
| gopls API instability | MEDIUM | LOW | Graceful degradation design |

---

## 5. Success Criteria Validation

- ✅ Package Graph: 100% recoverability, GoModResolver for import classification
- ✅ Capability Graph: >85% recoverability, reuse InterfaceMatcher
- ✅ Goroutine Topology: >70% spawn point detection, name-based heuristics
- ✅ Flow Graph: >70% HTTP entry point detection, pattern matching
- ✅ Performance: Baseline established, targets defined
- ✅ Test coverage: >90% core logic, ground truth validation

---

**Plan Version**: 4.0
**Last Updated**: 2026-02-24
**Status**: ✅ Ready for Implementation
**Next Step**: Begin Phase 0 implementation
