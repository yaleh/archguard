# Go Architecture Atlas Implementation Plan

**Plan ID**: 16
**Based on**: Proposal 16 - Go Architecture Atlas (v5.1)
**Created**: 2026-02-24
**Updated**: 2026-02-24 (v5.1 - Aligned with Proposal v5.1 and ADR v1.2 updates)
**Status**: Ready for Implementation
**Priority**: High

**Architecture Decisions**:
- [ADR-001: GoAtlasPlugin Composition v1.2](../adr/001-goatlas-plugin-composition.md) - 组合模式，GoPlugin 暴露 `parseToRawData(config & TreeSitterParseOptions)` 公共 API，插件名称 `'golang'` 替代 GoPlugin
- [ADR-002: ArchJSON Extensions v1.2](../adr/002-archjson-extensions.md) - 类型化扩展字段设计，四层图类型唯一权威定义，`triggerNodeTypes` 语义修正

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
2. **Composition over inheritance**: GoAtlasPlugin uses composition pattern (ADR-001), GoPlugin exposes `parseToRawData()` public API; plugin name `'golang'` replaces GoPlugin in Registry
3. **ADR-002 as type authority**: Four-layer graph types defined in ADR-002 only, not duplicated in plugin code
4. **No core type extensions**: `EntityType` and `RelationType` are NOT extended; Go-specific data lives in `extensions.goAtlas`
5. **Unified parsing API**: TreeSitterBridge single `parseCode(code, path, options?)` with configurable body extraction (no double-parsing)
6. **AST-based selective extraction**: Use `descendantsOfType()` for pre-scanning, not string matching
7. **Go.mod-aware import resolution**: Distinguish internal vs external dependencies
8. **Package deduplication by fullName**: Use `GoRawPackage.fullName` (not `name`) as Map key

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
│                    GoAtlasPlugin (组合模式)                      │
│           implements ILanguagePlugin + IGoAtlas                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │   GoPlugin   │  │ BehaviorAnalyzer │  │  AtlasRenderer   │ │
│  │  (composed)  │  │    (coordinator) │  │                  │ │
│  │              │  │                  │  │                  │ │
│  │ • parseToRaw │  │ ┌──────────────┐ │  │ ┌──────────────┐│ │
│  │   Data()     │  │ │PackageGraph │ │  │ │Mermaid      ││ │
│  │ • parseProjec│  │ │Builder      │ │  │ │Templates    ││ │
│  │   t()        │  │ │             │ │  │ │             ││ │
│  │              │  │ │+GoModResolv-│ │  │ │Package      ││ │
│  │ ┌────────────┐ │  │ │ er          │ │  │ │Capability   ││ │
│  │ │TreeSitter  │ │  │ └──────────────┘ │  │ │Goroutine    ││ │
│  │ │Bridge      │ │  │ ┌──────────────┐ │  │ │Flow         ││ │
│  │ │            │ │  │ │Capability   │ │  │ └──────────────┘│ │
│  │ │parseCode() │ │  │ │GraphBuilder │ │  │ ┌──────────────┐│ │
│  │ │(options)   │ │  │ └──────────────┘ │  │ │JSON         ││ │
│  │ └────────────┘ │  │ ┌──────────────┐ │  │ │Serializer   ││ │
│  │              │  │ │GoroutineTopo│ │  │ └──────────────┘│ │
│  │              │  │ │logyBuilder  │ │  │                  │ │
│  │              │  │ └──────────────┘ │  │                  │ │
│  │              │  │ ┌──────────────┐ │  │                  │ │
│  │              │  │ │FlowGraph    │ │  │                  │ │
│  │              │  │ │Builder      │ │  │                  │ │
│  │              │  │ └──────────────┘ │  │                  │ │
│  └──────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                  │
│  ┌──────────────┐                                               │
│  │ AtlasMapper  │                                               │
│  │ • toArchJSON │                                               │
│  └──────────────┘                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Components**:
- **GoPlugin** (composed): Standard Go parsing, exposes `parseToRawData()` public API
- **BehaviorAnalyzer**: Coordinates graph builders, maintains shared cache
- **AtlasRenderer**: Contains Mermaid templates and JSON serializers
- **AtlasMapper**: Maps Atlas data to ArchJSON extensions format
- **GoModResolver**: Resolves module path and classifies imports

### 2.2 Data Flow

```
Go Source Files
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ GoAtlasPlugin.parseProject(config: ParseConfig)              │
│ ├─ Check config.languageSpecific?.atlas?.enabled             │
│ └─ Delegate standard parsing to GoPlugin                   │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GoPlugin.parseToRawData(workspaceRoot, config)              │
│ ├─ Find .go files                                           │
│ ├─ TreeSitterBridge.parseCode(code, path, options)          │
│ │   ├─ Single-pass parsing (parser.parse() called once)    │
│ │   ├─ Optional body extraction via options.extractBodies   │
│ │   └─ Returns GoRawPackage with optional body data        │
│ ├─ Merge packages by fullName (not name)                   │
│ └─ Returns GoRawData                                        │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GoAtlasPlugin.generateAtlas(rootPath, options)              │
│ ├─ Get GoRawData via goPlugin.parseToRawData(config+opts)   │
│ │   (body extraction integrated, no second pass)            │
│ └─ BehaviorAnalyzer.buildAll(rawData)                       │
│    ├─ buildPackageGraph() → PackageGraph (ADR-002)          │
│    ├─ buildCapabilityGraph() → CapabilityGraph (ADR-002)    │
│    ├─ buildGoroutineTopology() → GoroutineTopology (ADR-002)│
│    └─ buildFlowGraph() → FlowGraph (ADR-002)                │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ ArchJSON                                                    │
│ ├─ version, language, sourceFiles, entities, relations      │
│ └─ extensions.goAtlas: GoAtlasExtension (ADR-002)           │
│    ├─ version: "1.0"                                        │
│    ├─ layers: { package?, capability?, goroutine?, flow? }  │
│    └─ metadata: GoAtlasMetadata                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Configuration Flow

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
│ CLI Parser (src/cli/commands/analyze.ts)                    │
│ ├─ Parse flags → AtlasConfig object                        │
│ └─ Embed in ParseConfig.languageSpecific.atlas             │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ PluginRegistry.getPlugin('golang')                         │
│   └─ Returns GoAtlasPlugin instance (replaces GoPlugin)    │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ GoAtlasPlugin.parseProject(root, config: ParseConfig)       │
│ ├─ Check config.languageSpecific?.atlas?.enabled            │
│ ├─ If not enabled → delegate to GoPlugin                   │
│ ├─ Else → generateAtlas() + merge into ArchJSON            │
│ └─ Return ArchJSON with extensions.goAtlas                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Phases

### Phase 0: Foundation (Type System, Configuration, Baseline)

**Objective**: Establish type system, configuration flow, and performance baseline

#### Task 1: Extend ArchJSON Schema (No Core Type Changes)

**File**: `src/types/index.ts`

Per Proposal v5.1 §4.4.1, `EntityType` and `RelationType` are **NOT** extended. Only add `extensions` field to `ArchJSON`:

```typescript
// src/types/index.ts — ONLY changes

/**
 * EntityType - NO CHANGES (per ADR-002 decision)
 * 'package' not added: Package is a module boundary, not an Entity
 */
export type EntityType =
  'class' | 'interface' | 'enum' | 'struct' | 'trait' | 'abstract_class' | 'function';

/**
 * RelationType - NO CHANGES (per ADR-002 decision)
 * 'spawns'/'calls' not added: Go-specific relations go in extensions
 */
export type RelationType =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association';

/**
 * Extended ArchJSON with typed extensions field
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

  // NEW: Type-safe extensions (ADR-002)
  extensions?: ArchJSONExtensions;
}

/**
 * Type-safe extension container (defined per ADR-002)
 */
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  // Future: javaAtlas?, rustAtlas?, ...
}
```

**Note**: `GoAtlasExtension` and all four-layer graph types (`PackageGraph`, `CapabilityGraph`, `GoroutineTopology`, `FlowGraph`) are defined in ADR-002 as the **single source of truth**. Implementation files import from a shared types module that re-exports ADR-002 definitions.

#### Task 2: Define Atlas Extension Types (ADR-002 aligned)

**File**: `src/plugins/golang/atlas/types.ts`

This file re-exports ADR-002 types and adds implementation-specific aliases:

```typescript
// Re-export all types from ADR-002 definition
// ADR-002 is the single source of truth for these types
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

/**
 * GoArchitectureAtlas is an alias for GoAtlasExtension
 */
export type GoArchitectureAtlas = GoAtlasExtension;

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
  entryPointTypes?: EntryPointType[];
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
  entryPointTypes?: EntryPointType[];
  followIndirectCalls?: boolean;
}
```

#### Task 3: Extend Go Raw Types

**File**: `src/plugins/golang/types.ts`

Per Proposal v5.1 §4.6:

```typescript
/**
 * Go package — extended with fullName and sourceFiles
 *
 * CRITICAL: Use fullName (not name) as Map key when merging packages.
 * This prevents data loss when different directories have same package name
 * (e.g., pkg/hub and pkg/worker both named "hub" in different dirs).
 */
export interface GoRawPackage {
  id: string;              // Unique ID (equals fullName)
  name: string;            // Package name: "hub"
  fullName: string;        // Module-relative path: "pkg/hub" (disambiguation key)
  dirPath: string;         // Filesystem path
  imports: GoImport[];
  structs: GoRawStruct[];
  interfaces: GoRawInterface[];
  functions: GoFunction[];
  sourceFiles: string[];   // Source file paths in this package
}

/**
 * Extended GoFunction with optional body (Proposal v5.1 §4.6.2)
 */
export interface GoFunction {
  name: string;
  packageName: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  body?: GoFunctionBody;      // Optional: filled in Atlas mode
}

/**
 * Extended GoMethod with optional body (Proposal v5.1 §4.6.2)
 */
export interface GoMethod {
  name: string;
  receiver?: string;
  receiverType?: string;
  parameters: GoField[];
  returnTypes: string[];
  exported: boolean;
  location: GoSourceLocation;
  body?: GoFunctionBody;      // Optional: filled in Atlas mode
}

/**
 * Function body behavior data (Proposal v5.1 §4.6.3)
 */
export interface GoFunctionBody {
  calls: GoCallExpr[];        // All function calls
  goSpawns: GoSpawnStmt[];    // go func() / go namedFunc()
  channelOps: GoChannelOp[];  // ch <- x or <-ch
}

export interface GoCallExpr {
  functionName: string;       // Called function name
  packageName?: string;       // Cross-package call
  receiverType?: string;      // Method call
  location: GoSourceLocation;
}

export interface GoSpawnStmt {
  call: GoCallExpr;           // The spawned function call
  location: GoSourceLocation;
}

export interface GoChannelOp {
  channelName: string;
  operation: 'send' | 'receive' | 'close' | 'make';
  location: GoSourceLocation;
}

/**
 * Extended GoImport with classification
 */
export interface GoImport {
  path: string;
  alias?: string;
  location: GoSourceLocation;
  type?: 'std' | 'internal' | 'external' | 'vendor';  // Filled by GoModResolver
}

/**
 * Go project raw data (Proposal v5.1 §4.6.5)
 *
 * NOTE: Uses GoRawPackage[] array (not Map). The merge logic in GoPlugin
 * uses a Map<fullName, GoRawPackage> internally but converts to array.
 */
export interface GoRawData {
  packages: GoRawPackage[];
  moduleRoot: string;
  moduleName: string;
  implementations?: InferredImplementation[];
}
```

#### Task 4: Implement GoModResolver

**File**: `src/plugins/golang/atlas/go-mod-resolver.ts`

```typescript
import fs from 'fs-extra';
import path from 'path';

/**
 * Go module resolver for import classification
 *
 * RESPONSIBILITIES:
 * 1. Parse go.mod file
 * 2. Extract module name
 * 3. Classify imports: std | internal | external | vendor
 */
export class GoModResolver {
  private moduleInfo: ModuleInfo | null = null;

  async resolveProject(workspaceRoot: string): Promise<ModuleInfo> {
    const goModPath = path.join(workspaceRoot, 'go.mod');

    if (!await fs.pathExists(goModPath)) {
      throw new Error(`go.mod not found at ${goModPath}`);
    }

    const content = await fs.readFile(goModPath, 'utf-8');
    const moduleMatch = content.match(/^module\s+([^\s]+)/m);
    if (!moduleMatch) {
      throw new Error('Module declaration not found in go.mod');
    }

    this.moduleInfo = {
      moduleName: moduleMatch[1],
      moduleRoot: workspaceRoot,
      goModPath,
    };

    return this.moduleInfo;
  }

  classifyImport(importPath: string): 'std' | 'internal' | 'external' | 'vendor' {
    if (!this.moduleInfo) {
      throw new Error('GoModResolver not initialized. Call resolveProject() first.');
    }

    if (this.isStandardLibrary(importPath)) return 'std';
    if (importPath.startsWith('vendor/')) return 'vendor';
    if (importPath.startsWith(this.moduleInfo.moduleName)) return 'internal';
    if (importPath.startsWith('./') || importPath.startsWith('../')) return 'internal';
    return 'external';
  }

  /**
   * Standard library detection
   *
   * Uses heuristic: std lib packages do NOT contain dots in the first segment.
   * e.g., "fmt", "net/http" → std; "github.com/..." → external
   */
  private isStandardLibrary(importPath: string): boolean {
    const firstSegment = importPath.split('/')[0];
    return !firstSegment.includes('.');
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
```

#### Deliverables

- Complete type definitions (0 `any` types)
- ADR-002 types re-exported (not duplicated)
- GoModResolver implementation
- TypeScript strict mode validation

#### Validation

```bash
npm run type-check  # Must pass with no errors
npm run lint        # Must pass with no warnings
```

---

### Phase 1: GoPlugin Public API & TreeSitterBridge Extension

**Objective**: Expose `parseToRawData()` on GoPlugin, extend TreeSitterBridge with configurable body extraction

#### Task 1: Add GoPlugin.parseToRawData() Public Method

**File**: `src/plugins/golang/index.ts`

Per Proposal v5.1 §4.5.1:

```typescript
export class GoPlugin implements ILanguagePlugin {
  // Internal members remain PRIVATE
  private treeSitter!: TreeSitterBridge;
  private matcher!: InterfaceMatcher;
  private mapper!: ArchJsonMapper;
  private goplsClient: GoplsClient | null = null;

  /**
   * PUBLIC: Parse project to raw data
   *
   * Exposed for GoAtlasPlugin composition (ADR-001 v1.2).
   * Returns GoRawData (not ArchJSON) to avoid unnecessary mapping.
   * Accepts TreeSitterParseOptions for body extraction control.
   */
  async parseToRawData(
    workspaceRoot: string,
    config: ParseConfig & TreeSitterParseOptions
  ): Promise<GoRawData> {
    this.ensureInitialized();

    // Initialize gopls if available
    if (this.goplsClient && !this.goplsClient.isInitialized()) {
      try {
        await this.goplsClient.initialize(workspaceRoot);
      } catch (error) {
        console.warn('Failed to initialize gopls, using fallback:', error);
        this.goplsClient = null;
      }
    }

    // Find all .go files
    const pattern = config.filePattern ?? '**/*.go';
    const files = await glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ['**/vendor/**', '**/node_modules/**'],
    });

    // Parse all files — merge by fullName (not name!)
    const packages = new Map<string, GoRawPackage>();
    const moduleName = await this.readModuleName(workspaceRoot);

    for (const file of files) {
      const code = await fs.readFile(file, 'utf-8');
      const pkg = this.treeSitter.parseCode(code, file, {
        extractBodies: config.extractBodies,
        selectiveExtraction: config.selectiveExtraction,
      });

      // Compute fullName from file path relative to module root
      const relDir = path.relative(workspaceRoot, path.dirname(file));
      pkg.fullName = relDir || pkg.name;
      pkg.dirPath = path.dirname(file);

      // Merge by fullName (prevents same-name package collision)
      const key = pkg.fullName;
      if (packages.has(key)) {
        const existing = packages.get(key)!;
        existing.structs.push(...pkg.structs);
        existing.interfaces.push(...pkg.interfaces);
        existing.functions.push(...pkg.functions);
        existing.imports.push(...pkg.imports);
        existing.sourceFiles.push(...pkg.sourceFiles);
      } else {
        packages.set(key, pkg);
      }
    }

    return {
      packages: Array.from(packages.values()),
      moduleRoot: workspaceRoot,
      moduleName,
    };
  }

  /**
   * Refactored: Reuses parseToRawData()
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    const rawData = await this.parseToRawData(workspaceRoot, config);

    const allStructs = rawData.packages.flatMap(p => p.structs);
    const allInterfaces = rawData.packages.flatMap(p => p.interfaces);
    const implementations = await this.matcher.matchWithGopls(
      allStructs,
      allInterfaces,
      this.goplsClient
    );

    const entities = this.mapper.mapEntities(rawData.packages);
    const relations = this.mapper.mapRelations(rawData.packages, implementations);

    return {
      version: '1.0',
      language: 'go',
      timestamp: new Date().toISOString(),
      sourceFiles: rawData.packages.flatMap(p => p.sourceFiles),  // Package-level tracking
      entities,
      relations,
    };
  }

  private async readModuleName(workspaceRoot: string): Promise<string> {
    try {
      const goModContent = await fs.readFile(`${workspaceRoot}/go.mod`, 'utf-8');
      const match = goModContent.match(/^module\s+(.+)$/m);
      return match ? match[1].trim() : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
```

#### Task 2: Extend TreeSitterBridge with Unified API

**File**: `src/plugins/golang/tree-sitter-bridge.ts`

Per Proposal v5.1 §4.7:

```typescript
/**
 * Parse options for TreeSitterBridge
 *
 * DESIGN: Single entry point, options control behavior.
 * Avoids double-parsing (no separate parseCode vs parseCodeWithBodies).
 */
export interface TreeSitterParseOptions {
  /** Whether to extract function body behavior data (default false) */
  extractBodies?: boolean;
  /** Whether to use selective extraction (only functions with target AST nodes) */
  selectiveExtraction?: boolean;
}

export class TreeSitterBridge {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Go);
  }

  /**
   * Parse Go code with optional function body extraction
   *
   * UNIFIED API: Single method, single parser.parse() call.
   * Body extraction controlled by options.
   */
  parseCode(
    code: string,
    filePath: string,
    options?: TreeSitterParseOptions
  ): GoRawPackage {
    const tree = this.parser.parse(code);  // Only parsed ONCE
    const rootNode = tree.rootNode;

    const packageName = this.extractPackageName(rootNode, code);
    const imports = this.extractImports(rootNode, code, filePath);
    const structs = this.extractStructs(rootNode, code, filePath, packageName);
    const interfaces = this.extractInterfaces(rootNode, code, filePath, packageName);

    // Extract functions (with optional bodies)
    let functions: GoFunction[] = [];
    if (options?.extractBodies) {
      functions = this.extractFunctionsWithBodies(
        rootNode, code, filePath, packageName, options
      );

      // Also enrich struct methods with bodies
      for (const struct of structs) {
        this.enrichMethodBodies(struct, rootNode, code, filePath, options);
      }
    }

    return {
      id: packageName,
      name: packageName,
      fullName: '',       // Filled by caller (needs moduleRoot context)
      dirPath: '',        // Filled by caller
      imports,
      structs,
      interfaces,
      functions,
      sourceFiles: [filePath],
    };
  }

  /**
   * Extract functions with optional body data
   */
  private extractFunctionsWithBodies(
    rootNode: Parser.SyntaxNode,
    code: string,
    filePath: string,
    packageName: string,
    options: TreeSitterParseOptions
  ): GoFunction[] {
    const funcDecls = rootNode.descendantsOfType('function_declaration');
    const functions: GoFunction[] = [];

    for (const funcDecl of funcDecls) {
      const func = this.extractFunctionSignature(funcDecl, code, filePath, packageName);

      // Decide whether to extract body
      const blockNode = funcDecl.childForFieldName('body');
      if (blockNode) {
        if (options.selectiveExtraction) {
          // AST-based pre-scanning (NOT string matching)
          if (this.shouldExtractBody(blockNode)) {
            func.body = this.extractFunctionBody(blockNode, code, filePath);
          }
        } else {
          // Full extraction
          func.body = this.extractFunctionBody(blockNode, code, filePath);
        }
      }

      functions.push(func);
    }

    return functions;
  }

  /**
   * Selective extraction: AST node type pre-scanning
   *
   * Uses descendantsOfType() instead of string matching.
   * This avoids false positives from comments, variable names, etc.
   *
   * RATIONALE (Proposal v5.1 §4.7):
   * String matching like codeSnippet.includes('go ') would match:
   * - Comments: "// go ahead and do X"
   * - Variable names: "var gopher = ..."
   * AST-based scanning only matches actual Go statements.
   */
  private shouldExtractBody(blockNode: Parser.SyntaxNode): boolean {
    const targetNodeTypes = [
      'go_statement',          // go func() / go namedFunc()
      'send_statement',        // ch <- value
      'receive_expression',    // <-ch
    ];

    return targetNodeTypes.some(nodeType =>
      blockNode.descendantsOfType(nodeType).length > 0
    );
  }

  /**
   * Extract function body behavior data
   */
  private extractFunctionBody(
    blockNode: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoFunctionBody {
    return {
      calls: this.extractCallExprs(blockNode, code, filePath),
      goSpawns: this.extractGoSpawns(blockNode, code, filePath),
      channelOps: this.extractChannelOps(blockNode, code, filePath),
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
      // go_statement children: the expression being spawned
      // In tree-sitter-go, go_statement has no 'call' field name.
      // The first child after 'go' keyword is the call expression.
      const children = goStmt.namedChildren;
      if (children.length === 0) continue;

      const expr = children[0];  // The spawned expression

      if (expr.type === 'call_expression') {
        const call = this.extractCallExpr(expr, code, filePath);
        spawns.push({
          call,
          location: this.nodeToLocation(goStmt, filePath),
        });
      } else if (expr.type === 'func_literal') {
        // go func() { ... }()
        spawns.push({
          call: {
            functionName: '<anonymous>',
            location: this.nodeToLocation(expr, filePath),
          },
          location: this.nodeToLocation(goStmt, filePath),
        });
      }
    }

    return spawns;
  }

  /**
   * Extract call expressions
   */
  private extractCallExprs(
    block: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoCallExpr[] {
    const calls: GoCallExpr[] = [];
    const callExprs = block.descendantsOfType('call_expression');

    for (const callExpr of callExprs) {
      calls.push(this.extractCallExpr(callExpr, code, filePath));
    }

    return calls;
  }

  private extractCallExpr(
    callExpr: Parser.SyntaxNode,
    code: string,
    filePath: string
  ): GoCallExpr {
    const funcNode = callExpr.childForFieldName('function');
    let functionName = '';
    let packageName: string | undefined;
    let receiverType: string | undefined;

    if (funcNode) {
      if (funcNode.type === 'identifier') {
        functionName = code.substring(funcNode.startIndex, funcNode.endIndex);
      } else if (funcNode.type === 'selector_expression') {
        const operand = funcNode.childForFieldName('operand');
        const field = funcNode.childForFieldName('field');
        if (operand && field) {
          packageName = code.substring(operand.startIndex, operand.endIndex);
          functionName = code.substring(field.startIndex, field.endIndex);
        }
      }
    }

    return {
      functionName,
      packageName,
      receiverType,
      location: this.nodeToLocation(callExpr, filePath),
    };
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

    // send_statement: ch <- value
    for (const sendStmt of block.descendantsOfType('send_statement')) {
      const channel = sendStmt.childForFieldName('channel');
      ops.push({
        channelName: channel ? code.substring(channel.startIndex, channel.endIndex) : '',
        operation: 'send',
        location: this.nodeToLocation(sendStmt, filePath),
      });
    }

    // receive_expression: <-ch
    for (const recvExpr of block.descendantsOfType('receive_expression')) {
      const operand = recvExpr.namedChildren[0];
      ops.push({
        channelName: operand ? code.substring(operand.startIndex, operand.endIndex) : '',
        operation: 'receive',
        location: this.nodeToLocation(recvExpr, filePath),
      });
    }

    // make(chan T, size) — detect via call_expression
    for (const callExpr of block.descendantsOfType('call_expression')) {
      const funcNode = callExpr.childForFieldName('function');
      if (funcNode && code.substring(funcNode.startIndex, funcNode.endIndex) === 'make') {
        const args = callExpr.childForFieldName('arguments');
        if (args) {
          const firstArg = args.namedChildren[0];
          if (firstArg && firstArg.type === 'channel_type') {
            ops.push({
              channelName: '',  // Channel name determined by assignment context
              operation: 'make',
              location: this.nodeToLocation(callExpr, filePath),
            });
          }
        }
      }
    }

    return ops;
  }

  // ... existing extraction methods (extractPackageName, extractStructs, etc.) unchanged ...
}
```

#### Task 3: Performance Baseline

**File**: `tests/baseline/go-plugin.bench.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { GoPlugin } from '@/plugins/golang/index.js';

describe('GoPlugin Performance Baseline', () => {
  it('should establish baseline for 100 files (no Atlas)', async () => {
    const plugin = new GoPlugin();
    await plugin.initialize({ workspaceRoot: './test-data/medium-project' });

    const start = performance.now();
    await plugin.parseProject('./test-data/medium-project', {
      workspaceRoot: './test-data/medium-project',
      excludePatterns: ['**/vendor/**'],
      filePattern: '**/*.go',
    });
    const duration = performance.now() - start;

    console.log(`Baseline: ${duration.toFixed(0)}ms for 100 files`);
    expect(duration).toBeLessThan(5000);
  });
});

describe('TreeSitterBridge Performance', () => {
  it('none strategy: < 10% overhead vs baseline', async () => {
    // Compare parseCode() with and without options
  });

  it('selective strategy: 2-3x faster than full', async () => {
    // Compare selective vs full extraction
  });
});
```

#### Deliverables

- GoPlugin with public `parseToRawData()` method
- TreeSitterBridge with unified `parseCode(code, path, options?)` API
- AST-based `shouldExtractBody()` using `descendantsOfType()`
- Package merge by `fullName` (not `name`)
- `sourceFiles` populated in ArchJSON output
- Performance baseline documentation

---

### Phase 2: Package & Capability Graphs

**Objective**: Build package dependency and capability graphs

#### Task 1: PackageGraphBuilder

**File**: `src/plugins/golang/atlas/builders/package-graph-builder.ts`

```typescript
import type { GoRawData } from '../../types.js';
import type { PackageGraph, PackageNode, PackageDependency, PackageCycle } from '../types.js';
import { GoModResolver } from '../go-mod-resolver.js';

/**
 * Package dependency graph builder
 *
 * Output types defined in ADR-002 (PackageGraph, PackageNode, etc.)
 */
export class PackageGraphBuilder {
  private goModResolver: GoModResolver;

  constructor(goModResolver: GoModResolver) {
    this.goModResolver = goModResolver;
  }

  async build(rawData: GoRawData): Promise<PackageGraph> {
    const nodes = this.buildNodes(rawData);
    const edges = this.buildEdges(rawData);
    const cycles = this.detectCycles(nodes, edges);

    return { nodes, edges, cycles };
  }

  private buildNodes(rawData: GoRawData): PackageNode[] {
    return rawData.packages.map(pkg => ({
      id: pkg.fullName ? `${rawData.moduleName}/${pkg.fullName}` : pkg.name,
      name: pkg.fullName || pkg.name,
      type: this.classifyPackageType(pkg, rawData),
      fileCount: pkg.sourceFiles.length,
      stats: {
        structs: pkg.structs.length,
        interfaces: pkg.interfaces.length,
        functions: pkg.functions.length,
      },
    }));
  }

  private buildEdges(rawData: GoRawData): PackageDependency[] {
    const edges: PackageDependency[] = [];

    for (const pkg of rawData.packages) {
      const fromId = pkg.fullName ? `${rawData.moduleName}/${pkg.fullName}` : pkg.name;

      for (const imp of pkg.imports) {
        const importType = this.goModResolver.classifyImport(imp.path);
        if (importType === 'std') continue;  // Skip std lib

        edges.push({
          from: fromId,
          to: imp.path,
          strength: 1,
        });
      }
    }

    return edges;
  }

  /**
   * Detect cyclic dependencies using DFS
   *
   * Returns PackageCycle[] (ADR-002 v1.2 type with severity)
   */
  private detectCycles(
    nodes: PackageNode[],
    edges: PackageDependency[]
  ): PackageCycle[] {
    const graph = new Map<string, string[]>();
    for (const node of nodes) {
      graph.set(node.id, []);
    }
    for (const edge of edges) {
      graph.get(edge.from)?.push(edge.to);
    }

    const cycles: PackageCycle[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      for (const neighbor of graph.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push({
              packages: path.slice(cycleStart),
              severity: 'warning',
            });
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id);
      }
    }

    return cycles;
  }

  private classifyPackageType(
    pkg: GoRawPackage,
    rawData: GoRawData
  ): 'internal' | 'external' | 'vendor' | 'std' | 'cmd' {
    if (pkg.name === 'main') return 'cmd';
    if (pkg.fullName.includes('/vendor/')) return 'vendor';
    return 'internal';
  }
}
```

#### Task 2: CapabilityGraphBuilder

**File**: `src/plugins/golang/atlas/builders/capability-graph-builder.ts`

```typescript
import type { GoRawData } from '../../types.js';
import type { CapabilityGraph, CapabilityNode, CapabilityRelation } from '../types.js';

/**
 * Capability (interface usage) graph builder
 *
 * Uses existing InterfaceMatcher for implementation detection.
 * Output types from ADR-002 (CapabilityGraph, CapabilityNode, CapabilityRelation).
 *
 * NOTE: ADR-002 uses flat nodes/edges structure (no redundant
 * implementors/consumers fields on InterfaceCapability).
 */
export class CapabilityGraphBuilder {
  async build(rawData: GoRawData): Promise<CapabilityGraph> {
    const nodes = this.buildNodes(rawData);
    const edges = this.buildEdges(rawData);

    return { nodes, edges };
  }

  private buildNodes(rawData: GoRawData): CapabilityNode[] {
    const nodes: CapabilityNode[] = [];

    for (const pkg of rawData.packages) {
      for (const iface of pkg.interfaces) {
        nodes.push({
          id: `${pkg.fullName}.${iface.name}`,
          name: iface.name,
          type: 'interface',
          package: pkg.fullName,
          exported: iface.exported,
        });
      }

      for (const struct of pkg.structs) {
        nodes.push({
          id: `${pkg.fullName}.${struct.name}`,
          name: struct.name,
          type: 'struct',
          package: pkg.fullName,
          exported: struct.exported,
        });
      }
    }

    return nodes;
  }

  private buildEdges(rawData: GoRawData): CapabilityRelation[] {
    const edges: CapabilityRelation[] = [];

    // Use pre-computed implementations if available
    if (rawData.implementations) {
      for (const impl of rawData.implementations) {
        edges.push({
          id: `impl-${impl.structPackageId}.${impl.structName}-${impl.interfacePackageId}.${impl.interfaceName}`,
          type: 'implements',
          source: `${impl.structPackageId}.${impl.structName}`,
          target: `${impl.interfacePackageId}.${impl.interfaceName}`,
          confidence: impl.confidence,
        });
      }
    }

    // Detect interface usage in struct fields and function parameters
    for (const pkg of rawData.packages) {
      const interfaceNames = new Set(
        rawData.packages.flatMap(p => p.interfaces.map(i => i.name))
      );

      for (const struct of pkg.structs) {
        for (const field of struct.fields) {
          if (interfaceNames.has(field.type)) {
            edges.push({
              id: `uses-${pkg.fullName}.${struct.name}-${field.type}`,
              type: 'uses',
              source: `${pkg.fullName}.${struct.name}`,
              target: field.type,  // Needs resolution to full ID
              confidence: 0.9,
              context: {
                fieldType: true,
                usageLocations: [`${field.location.file}:${field.location.startLine}`],
              },
            });
          }
        }
      }
    }

    return edges;
  }
}
```

#### Deliverables

- PackageGraphBuilder with cycle detection (returns `PackageCycle[]` per ADR-002 v1.2)
- CapabilityGraphBuilder using flat nodes/edges (no redundant implementors/consumers)
- Unit tests with mock Go projects
- Integration tests with real projects

---

### Phase 3: Goroutine Topology & Flow Graph

**Objective**: Build goroutine topology and flow graphs

#### Task 1: GoroutineTopologyBuilder

**File**: `src/plugins/golang/atlas/builders/goroutine-topology-builder.ts`

```typescript
import type { GoRawData } from '../../types.js';
import type { GoroutineTopology, GoroutineNode, SpawnRelation, ChannelInfo } from '../types.js';

/**
 * Goroutine topology builder
 *
 * Scans both functions AND methods for go spawn statements.
 * Output types from ADR-002 v1.2 (includes spawnType on GoroutineNode).
 */
export class GoroutineTopologyBuilder {
  async build(rawData: GoRawData): Promise<GoroutineTopology> {
    const nodes = this.extractGoroutineNodes(rawData);
    const edges = this.buildSpawnRelations(rawData);
    const channels = this.extractChannelInfo(rawData);

    // Classify patterns
    for (const node of nodes) {
      node.pattern = this.classifyPattern(node, edges, channels);
    }

    return { nodes, edges, channels };
  }

  /**
   * Extract goroutine nodes from BOTH functions AND methods
   *
   * CRITICAL: Methods must also be scanned (not just top-level functions).
   * e.g., Server.Start() spawning goroutines via go s.handleConn()
   */
  private extractGoroutineNodes(rawData: GoRawData): GoroutineNode[] {
    const nodes: GoroutineNode[] = [];

    for (const pkg of rawData.packages) {
      // Scan standalone functions
      for (const func of pkg.functions) {
        if (func.name === 'main' && pkg.name === 'main') {
          nodes.push({
            id: 'main',
            name: 'main.main',
            type: 'main',
            package: pkg.fullName,
            location: { file: func.location.file, line: func.location.startLine },
          });
        }

        if (func.body) {
          this.extractSpawnedNodes(func.body.goSpawns, pkg, func.name, nodes);
        }
      }

      // Scan struct methods (IMPORTANT: don't skip these!)
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (method.body) {
            this.extractSpawnedNodes(
              method.body.goSpawns, pkg,
              `${struct.name}.${method.name}`, nodes
            );
          }
        }
      }
    }

    return nodes;
  }

  private extractSpawnedNodes(
    goSpawns: GoSpawnStmt[],
    pkg: GoRawPackage,
    parentName: string,
    nodes: GoroutineNode[]
  ): void {
    for (const spawn of goSpawns) {
      const isAnonymous = spawn.call.functionName === '<anonymous>';
      nodes.push({
        id: `${pkg.fullName}.${parentName}.spawn-${spawn.location.startLine}`,
        name: spawn.call.functionName,
        type: 'spawned',
        spawnType: isAnonymous ? 'anonymous_func' : 'named_func',
        package: pkg.fullName,
        location: { file: spawn.location.file, line: spawn.location.startLine },
      });
    }
  }

  private buildSpawnRelations(rawData: GoRawData): SpawnRelation[] {
    const relations: SpawnRelation[] = [];

    for (const pkg of rawData.packages) {
      // Functions
      for (const func of pkg.functions) {
        if (!func.body) continue;
        const fromId = func.name === 'main' && pkg.name === 'main'
          ? 'main'
          : `${pkg.fullName}.${func.name}`;

        for (const spawn of func.body.goSpawns) {
          relations.push({
            from: fromId,
            to: `${pkg.fullName}.${func.name}.spawn-${spawn.location.startLine}`,
            spawnType: spawn.call.functionName === '<anonymous>' ? 'go-func' : 'go-stmt',
          });
        }
      }

      // Methods
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (!method.body) continue;
          const fromId = `${pkg.fullName}.${struct.name}.${method.name}`;

          for (const spawn of method.body.goSpawns) {
            relations.push({
              from: fromId,
              to: `${pkg.fullName}.${struct.name}.${method.name}.spawn-${spawn.location.startLine}`,
              spawnType: spawn.call.functionName === '<anonymous>' ? 'go-func' : 'go-stmt',
            });
          }
        }
      }
    }

    return relations;
  }

  private extractChannelInfo(rawData: GoRawData): ChannelInfo[] {
    const channels: ChannelInfo[] = [];

    const scanBody = (body: GoFunctionBody, pkg: GoRawPackage) => {
      for (const op of body.channelOps) {
        if (op.operation === 'make') {
          channels.push({
            id: `chan-${pkg.fullName}-${op.location.startLine}`,
            type: 'chan',
            direction: 'bidirectional',
            location: { file: op.location.file, line: op.location.startLine },
          });
        }
      }
    };

    for (const pkg of rawData.packages) {
      for (const func of pkg.functions) {
        if (func.body) scanBody(func.body, pkg);
      }
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (method.body) scanBody(method.body, pkg);
        }
      }
    }

    return channels;
  }

  private classifyPattern(
    node: GoroutineNode,
    edges: SpawnRelation[],
    channels: ChannelInfo[]
  ): GoroutinePattern | undefined {
    // TODO: Implement pattern detection (worker-pool, pipeline, fan-out, etc.)
    return undefined;
  }
}
```

#### Task 2: FlowGraphBuilder

**File**: `src/plugins/golang/atlas/builders/flow-graph-builder.ts`

```typescript
import type { GoRawData } from '../../types.js';
import type { FlowGraph, EntryPoint, CallChain, CallEdge, EntryPointType } from '../types.js';

/**
 * Flow graph builder (entry points and call chains)
 *
 * Entry point detection uses AST-based pattern matching on call expressions,
 * not function name heuristics.
 *
 * NOTE: For interface call resolution, gopls is REQUIRED (not optional).
 * Without gopls, Flow Graph accuracy drops to ~30%.
 */
export class FlowGraphBuilder {
  async build(rawData: GoRawData): Promise<FlowGraph> {
    const entryPoints = this.detectEntryPoints(rawData);
    const callChains = this.buildCallChains(rawData, entryPoints);

    return { entryPoints, callChains };
  }

  /**
   * Detect HTTP entry points via call expression pattern matching
   *
   * Supported patterns (from Proposal v5.1 §3.4):
   * - http.HandleFunc("/path", handler)
   * - mux.Handle("/path", handler)
   * - router.GET/POST/...("/path", handler)
   * - pb.RegisterServiceServer(server, impl)
   */
  private detectEntryPoints(rawData: GoRawData): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    for (const pkg of rawData.packages) {
      // Scan function bodies for HTTP handler registration calls
      for (const func of pkg.functions) {
        if (!func.body) continue;

        for (const call of func.body.calls) {
          const entry = this.matchEntryPointPattern(call, pkg);
          if (entry) {
            entryPoints.push(entry);
          }
        }
      }

      // Also scan method bodies
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (!method.body) continue;

          for (const call of method.body.calls) {
            const entry = this.matchEntryPointPattern(call, pkg);
            if (entry) {
              entryPoints.push(entry);
            }
          }
        }
      }
    }

    return entryPoints;
  }

  /**
   * Match call expression against known HTTP framework patterns
   */
  private matchEntryPointPattern(
    call: GoCallExpr,
    pkg: GoRawPackage
  ): EntryPoint | null {
    // http.HandleFunc or mux.HandleFunc
    if (call.functionName === 'HandleFunc' || call.functionName === 'Handle') {
      return {
        id: `entry-${pkg.fullName}-${call.location.startLine}`,
        type: 'http-handler' as EntryPointType,
        path: '',  // Extracted from first argument at AST level
        handler: '',  // Extracted from second argument
        middleware: [],
        location: { file: call.location.file, line: call.location.startLine },
      };
    }

    // gin/echo: router.GET, router.POST, etc.
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (httpMethods.includes(call.functionName)) {
      const methodMap: Record<string, EntryPointType> = {
        'GET': 'http-get', 'POST': 'http-post', 'PUT': 'http-put',
        'DELETE': 'http-delete', 'PATCH': 'http-patch',
      };
      return {
        id: `entry-${pkg.fullName}-${call.location.startLine}`,
        type: methodMap[call.functionName],
        path: '',
        handler: '',
        middleware: [],
        location: { file: call.location.file, line: call.location.startLine },
      };
    }

    return null;
  }

  private buildCallChains(
    rawData: GoRawData,
    entryPoints: EntryPoint[]
  ): CallChain[] {
    const chains: CallChain[] = [];

    for (const entry of entryPoints) {
      const calls = this.traceCallsFromEntry(rawData, entry);
      chains.push({
        id: `chain-${entry.id}`,
        entryPoint: entry.id,
        calls,
      });
    }

    return chains;
  }

  private traceCallsFromEntry(
    rawData: GoRawData,
    entry: EntryPoint
  ): CallEdge[] {
    // TODO: Implement call chain tracing
    // For interface calls, gopls call hierarchy API is required
    return [];
  }
}
```

#### Deliverables

- GoroutineTopologyBuilder scanning both functions AND methods
- GoroutineNode with `spawnType` (ADR-002 v1.2)
- FlowGraphBuilder with AST-based entry point detection
- Unit tests for each builder
- Integration tests with real projects

---

### Phase 4: AtlasRenderer & CLI Integration

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
 */
export class MermaidTemplates {
  static renderPackageGraph(graph: PackageGraph): string {
    let output = 'flowchart TB\n';

    for (const node of graph.nodes) {
      const style = node.type === 'cmd' ? ':::cmd' : `:::${node.type}`;
      output += `  ${this.sanitizeId(node.id)}["${node.name}"]${style}\n`;
    }

    for (const edge of graph.edges) {
      const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
      output += `  ${this.sanitizeId(edge.from)} -->${label} ${this.sanitizeId(edge.to)}\n`;
    }

    if (graph.cycles.length > 0) {
      output += '\n  %% Cycles detected:\n';
      for (const cycle of graph.cycles) {
        output += `  %% ${cycle.severity}: ${cycle.packages.join(' → ')}\n`;
      }
    }

    return output;
  }

  static renderCapabilityGraph(graph: CapabilityGraph): string {
    let output = 'flowchart LR\n';

    for (const node of graph.nodes) {
      if (node.type === 'interface') {
        output += `  ${this.sanitizeId(node.id)}{{"${node.name}"}}\n`;
      } else {
        output += `  ${this.sanitizeId(node.id)}["${node.name}"]\n`;
      }
    }

    for (const edge of graph.edges) {
      if (edge.type === 'implements') {
        output += `  ${this.sanitizeId(edge.source)} -.->|impl| ${this.sanitizeId(edge.target)}\n`;
      } else {
        output += `  ${this.sanitizeId(edge.source)} -->|uses| ${this.sanitizeId(edge.target)}\n`;
      }
    }

    return output;
  }

  static renderGoroutineTopology(topology: GoroutineTopology): string {
    let output = 'flowchart TB\n';

    for (const node of topology.nodes) {
      const style = node.type === 'main' ? ':::main' : ':::spawned';
      const patternLabel = node.pattern ? ` (${node.pattern})` : '';
      output += `  ${this.sanitizeId(node.id)}["${node.name}${patternLabel}"]${style}\n`;
    }

    for (const edge of topology.edges) {
      output += `  ${this.sanitizeId(edge.from)} -->|go| ${this.sanitizeId(edge.to)}\n`;
    }

    if (topology.channels.length > 0) {
      output += '\n  subgraph channels\n';
      for (const ch of topology.channels) {
        output += `    ${this.sanitizeId(ch.id)}[("${ch.type}")]:::channel\n`;
      }
      output += '  end\n';
    }

    output += '\n  classDef main fill:#f66,stroke:#333,stroke-width:2px\n';
    output += '  classDef spawned fill:#6f6,stroke:#333,stroke-width:1px\n';
    output += '  classDef channel fill:#ff6,stroke:#333,stroke-width:1px\n';

    return output;
  }

  static renderFlowGraph(graph: FlowGraph): string {
    let output = 'sequenceDiagram\n';

    for (const chain of graph.callChains) {
      const entry = graph.entryPoints.find(e => e.id === chain.entryPoint);
      if (!entry) continue;

      output += `\n  Note over ${this.sanitizeId(entry.handler)}: ${entry.type} ${entry.path}\n`;

      for (const call of chain.calls) {
        output += `  ${this.sanitizeId(call.from)}->>+${this.sanitizeId(call.to)}: call\n`;
        output += `  ${this.sanitizeId(call.to)}-->>-${this.sanitizeId(call.from)}: return\n`;
      }
    }

    return output;
  }

  private static sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}
```

#### Task 2: AtlasRenderer

**File**: `src/plugins/golang/atlas/renderers/atlas-renderer.ts`

```typescript
import type { GoArchitectureAtlas, AtlasLayer, RenderFormat, RenderResult } from '../types.js';
import { MermaidTemplates } from './mermaid-templates.js';

export class AtlasRenderer {
  async render(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: RenderFormat
  ): Promise<RenderResult> {
    if (layer === 'all') {
      // Render all available layers concatenated
      const parts: string[] = [];
      if (atlas.layers.package) parts.push(MermaidTemplates.renderPackageGraph(atlas.layers.package));
      if (atlas.layers.capability) parts.push(MermaidTemplates.renderCapabilityGraph(atlas.layers.capability));
      if (atlas.layers.goroutine) parts.push(MermaidTemplates.renderGoroutineTopology(atlas.layers.goroutine));
      if (atlas.layers.flow) parts.push(MermaidTemplates.renderFlowGraph(atlas.layers.flow));

      return { content: parts.join('\n---\n'), format, layer };
    }

    switch (format) {
      case 'mermaid':
        return this.renderMermaid(atlas, layer);
      case 'json':
        return this.renderJson(atlas, layer);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private renderMermaid(atlas: GoArchitectureAtlas, layer: AtlasLayer): RenderResult {
    let content: string;
    switch (layer) {
      case 'package':
        content = MermaidTemplates.renderPackageGraph(atlas.layers.package!);
        break;
      case 'capability':
        content = MermaidTemplates.renderCapabilityGraph(atlas.layers.capability!);
        break;
      case 'goroutine':
        content = MermaidTemplates.renderGoroutineTopology(atlas.layers.goroutine!);
        break;
      case 'flow':
        content = MermaidTemplates.renderFlowGraph(atlas.layers.flow!);
        break;
      default:
        throw new Error(`Unknown layer: ${layer}`);
    }
    return { content, format: 'mermaid', layer };
  }

  private renderJson(atlas: GoArchitectureAtlas, layer: AtlasLayer): RenderResult {
    const layerData = atlas.layers[layer as keyof typeof atlas.layers];
    return {
      content: JSON.stringify(layerData, null, 2),
      format: 'json',
      layer,
    };
  }
}
```

#### Task 3: CLI Integration

**File**: `src/cli/commands/analyze.ts`

```typescript
import { Command } from 'commander';
import type { AtlasConfig } from '@/plugins/golang/atlas/types.js';

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
      'Function body extraction strategy: none|selective|full',
      'selective'
    )
    .option('--atlas-no-tests', 'Exclude test files from extraction')
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
  atlasEntryPoints?: string;
}): AtlasConfig | undefined {
  if (!options.atlas) return undefined;

  return {
    enabled: true,
    functionBodyStrategy: (options.atlasStrategy as 'none' | 'selective' | 'full') ?? 'selective',
    layers: (options.atlasLayers?.split(',') ?? ['package']) as AtlasLayer[],
    includeTests: !options.atlasNoTests,
    entryPointTypes: options.atlasEntryPoints?.split(',') as EntryPointType[],
  };
}
```

#### Deliverables

- MermaidTemplates with all four layer templates
- AtlasRenderer accessing `atlas.layers.*` (ADR-002 structure)
- CLI integration with Atlas flags
- No duplicate `nodeIdById` methods

---

### Phase 5: GoAtlasPlugin Integration

**Objective**: Integrate all components into GoAtlasPlugin using composition pattern

#### Task 1: GoAtlasPlugin Implementation

**File**: `src/plugins/golang/atlas/index.ts`

Per Proposal v5.1 §4.5.3 and ADR-001 v1.2:

```typescript
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import type { ArchJSON } from '@/types/index.js';
import { GoPlugin } from '../index.js';
import { BehaviorAnalyzer } from './behavior-analyzer.js';
import { AtlasRenderer } from './renderers/atlas-renderer.js';
import { GoModResolver } from './go-mod-resolver.js';
import type {
  GoArchitectureAtlas,
  AtlasConfig,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './types.js';

/**
 * IGoAtlas - Atlas-specific interface (Proposal v5.1 §4.5.2)
 */
export interface IGoAtlas {
  generateAtlas(rootPath: string, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas>;
  renderLayer(atlas: GoArchitectureAtlas, layer: AtlasLayer, format: RenderFormat): Promise<RenderResult>;
}

/**
 * Go Architecture Atlas Plugin
 *
 * ARCHITECTURE (ADR-001 v1.2):
 * - Uses COMPOSITION, not inheritance
 * - Delegates standard parsing to GoPlugin via public parseToRawData()
 * - NO bracket hacks (this.goPlugin['treeSitter'])
 * - All GoPlugin internals remain private
 * - Plugin name 'golang' replaces GoPlugin in Registry (Proposal v5.1 §4.5.5)
 * - Atlas config via ParseConfig.languageSpecific.atlas (Proposal v5.1 §4.5.6)
 */
export class GoAtlasPlugin implements ILanguagePlugin, IGoAtlas {
  readonly metadata: PluginMetadata = {
    name: 'golang',              // Replaces GoPlugin in Registry (§4.5.5)
    version: '5.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    author: 'ArchGuard Team',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  // Composed components (ADR-001)
  private goPlugin: GoPlugin;
  private behaviorAnalyzer: BehaviorAnalyzer;
  private atlasRenderer: AtlasRenderer;
  private goModResolver: GoModResolver;

  // Delegated property (matches GoPlugin readonly style, not getter)
  readonly dependencyExtractor: IDependencyExtractor;

  constructor() {
    this.goPlugin = new GoPlugin();
    this.goModResolver = new GoModResolver();
    this.behaviorAnalyzer = new BehaviorAnalyzer(this.goModResolver);
    this.atlasRenderer = new AtlasRenderer();
    this.dependencyExtractor = this.goPlugin.dependencyExtractor;
  }

  // ========== ILanguagePlugin (delegate to GoPlugin) ==========

  async initialize(config: PluginInitConfig): Promise<void> {
    await this.goPlugin.initialize(config);
  }

  canHandle(targetPath: string): boolean {
    return this.goPlugin.canHandle(targetPath);
  }

  // IParser optional method delegation (Proposal v5.1 §4.5.7)
  parseCode(code: string, filePath?: string): ArchJSON {
    return this.goPlugin.parseCode(code, filePath);
  }

  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    return this.goPlugin.parseFiles(filePaths);
  }

  async parseProject(
    workspaceRoot: string,
    config: ParseConfig
  ): Promise<ArchJSON> {
    // Check Atlas config via languageSpecific (Proposal v5.1 §4.5.6)
    const atlasConfig = config.languageSpecific?.atlas as AtlasConfig | undefined;

    // Standard mode: delegate entirely to GoPlugin
    if (!atlasConfig?.enabled) {
      return this.goPlugin.parseProject(workspaceRoot, config);
    }

    // Atlas mode: get base ArchJSON + generate Atlas extension
    const baseArchJSON = await this.goPlugin.parseProject(workspaceRoot, config);
    const atlas = await this.generateAtlas(workspaceRoot, {
      functionBodyStrategy: atlasConfig.functionBodyStrategy ?? 'selective',
      includeTests: atlasConfig.includeTests,
      entryPointTypes: atlasConfig.entryPointTypes,
      followIndirectCalls: atlasConfig.followIndirectCalls,
    });

    return {
      ...baseArchJSON,
      extensions: { goAtlas: atlas },
    };
  }

  // ========== IGoAtlas ==========

  async generateAtlas(
    rootPath: string,
    options: AtlasGenerationOptions = {}
  ): Promise<GoArchitectureAtlas> {
    // 1. Get raw data via GoPlugin public API (with body extraction integrated)
    const rawData = await this.goPlugin.parseToRawData(rootPath, {
      workspaceRoot: rootPath,
      excludePatterns: ['**/vendor/**', '**/testdata/**'],
      extractBodies: options.functionBodyStrategy !== 'none',
      selectiveExtraction: options.functionBodyStrategy === 'selective',
    });

    // 2. Resolve module info for import classification
    await this.goModResolver.resolveProject(rootPath);

    // 3. Build all four layers in parallel (no second parsing pass needed)
    const startTime = performance.now();
    const [packageGraph, capabilityGraph, goroutineTopology, flowGraph] = await Promise.all([
      this.behaviorAnalyzer.buildPackageGraph(rawData),
      this.behaviorAnalyzer.buildCapabilityGraph(rawData),
      this.behaviorAnalyzer.buildGoroutineTopology(rawData, { includeTests: options.includeTests }),
      this.behaviorAnalyzer.buildFlowGraph(rawData, {
        entryPointTypes: options.entryPointTypes,
        followIndirectCalls: options.followIndirectCalls,
      }),
    ]);

    // 4. Return GoAtlasExtension (ADR-002 structure)
    return {
      version: '1.0',
      layers: {
        package: packageGraph,
        capability: capabilityGraph,
        goroutine: goroutineTopology,
        flow: flowGraph,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        generationStrategy: {
          functionBodyStrategy: options.functionBodyStrategy ?? 'none',
          entryPointTypes: options.entryPointTypes ?? [],
          followIndirectCalls: options.followIndirectCalls ?? false,
          goplsEnabled: false,  // TODO: detect gopls
        },
        completeness: {
          package: 1.0,
          capability: 0.85,
          goroutine: options.functionBodyStrategy === 'full' ? 0.7 : 0.5,
          flow: 0.6,
        },
        performance: {
          fileCount: rawData.packages.length,
          parseTime: performance.now() - startTime,
          totalTime: performance.now() - startTime,
          memoryUsage: process.memoryUsage().heapUsed,
        },
      },
    };
  }

  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer = 'all',
    format: RenderFormat = 'mermaid'
  ): Promise<RenderResult> {
    // 'mermaid' → generate DSL, then use MermaidGenerator for SVG/PNG
    // 'json' → serialize layer data directly
    return this.atlasRenderer.render(atlas, layer, format);
  }

  async dispose(): Promise<void> {
    await this.goPlugin.dispose();
  }
}
```

#### Task 2: BehaviorAnalyzer Coordinator

**File**: `src/plugins/golang/atlas/behavior-analyzer.ts`

```typescript
import type { GoRawData } from '../types.js';
import type { PackageGraph, CapabilityGraph, GoroutineTopology, FlowGraph } from './types.js';
import { PackageGraphBuilder } from './builders/package-graph-builder.js';
import { CapabilityGraphBuilder } from './builders/capability-graph-builder.js';
import { GoroutineTopologyBuilder } from './builders/goroutine-topology-builder.js';
import { FlowGraphBuilder } from './builders/flow-graph-builder.js';
import { GoModResolver } from './go-mod-resolver.js';

/**
 * Behavior analysis coordinator
 *
 * Implements IBehaviorAnalyzer (Proposal v5.1 §4.5.8).
 * Coordinates graph builders, no `any` types in cache.
 */
export class BehaviorAnalyzer implements IBehaviorAnalyzer {
  private packageGraphBuilder: PackageGraphBuilder;
  private capabilityGraphBuilder: CapabilityGraphBuilder;
  private goroutineTopologyBuilder: GoroutineTopologyBuilder;
  private flowGraphBuilder: FlowGraphBuilder;

  constructor(goModResolver: GoModResolver) {
    this.packageGraphBuilder = new PackageGraphBuilder(goModResolver);
    this.capabilityGraphBuilder = new CapabilityGraphBuilder();
    this.goroutineTopologyBuilder = new GoroutineTopologyBuilder();
    this.flowGraphBuilder = new FlowGraphBuilder();
  }

  async buildPackageGraph(rawData: GoRawData): Promise<PackageGraph> {
    return this.packageGraphBuilder.build(rawData);
  }

  async buildCapabilityGraph(rawData: GoRawData): Promise<CapabilityGraph> {
    return this.capabilityGraphBuilder.build(rawData);
  }

  async buildGoroutineTopology(
    rawData: GoRawData,
    options: Pick<AtlasGenerationOptions, 'includeTests'> = {}
  ): Promise<GoroutineTopology> {
    return this.goroutineTopologyBuilder.build(rawData, options);
  }

  async buildFlowGraph(
    rawData: GoRawData,
    options: Pick<AtlasGenerationOptions, 'entryPointTypes' | 'followIndirectCalls'> = {}
  ): Promise<FlowGraph> {
    return this.flowGraphBuilder.build(rawData, options);
  }
}
```

#### Deliverables

- GoAtlasPlugin with composition architecture (ADR-001 v1.2), name 'golang' replacing GoPlugin
- No `any` types in BehaviorAnalyzer
- Integration tests
- All outputs use ADR-002 `GoAtlasExtension` structure

---

### Phase 6: Testing & Validation

**Objective**: Comprehensive testing with ground truth validation

#### Task 1: Unit Tests

```typescript
// tests/unit/atlas/package-graph-builder.test.ts
describe('PackageGraphBuilder', () => {
  it('should detect simple package dependencies', async () => {
    const rawData: GoRawData = {
      packages: [{
        id: 'main', name: 'main', fullName: 'cmd/app',
        dirPath: '/test/cmd/app', sourceFiles: ['main.go'],
        imports: [{ path: 'fmt', location: { file: 'main.go', startLine: 1, endLine: 1 } }],
        structs: [], interfaces: [], functions: [],
      }],
      moduleRoot: '/test',
      moduleName: 'test',
    };

    const builder = new PackageGraphBuilder(new GoModResolver());
    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].type).toBe('cmd');
    expect(graph.edges).toHaveLength(0);  // std lib excluded
    expect(graph.cycles).toHaveLength(0);
  });

  it('should return PackageCycle with severity', async () => {
    // Test cycle detection returns { packages: [...], severity: 'warning' }
  });
});

// tests/unit/atlas/goroutine-topology-builder.test.ts
describe('GoroutineTopologyBuilder', () => {
  it('should scan both functions and methods for go spawns', async () => {
    // Ensure methods are scanned, not just top-level functions
  });

  it('should set spawnType on GoroutineNode', async () => {
    // Verify ADR-002 v1.2 spawnType field
  });
});
```

#### Task 2: Ground Truth Validation

```typescript
// tests/validation/atlas-accuracy.test.ts
describe('Atlas Accuracy Validation', () => {
  it('should detect >85% of interface usages', async () => {
    const plugin = new GoAtlasPlugin();
    await plugin.initialize({ workspaceRoot: './test-data/swarm-hub' });

    const result = await plugin.parseProject('./test-data/swarm-hub', {
      workspaceRoot: './test-data/swarm-hub',
      excludePatterns: ['**/vendor/**'],
      languageSpecific: {
        atlas: {
          enabled: true,
          functionBodyStrategy: 'selective',
          layers: ['capability'],
        },
      },
    });

    const capabilityGraph = result.extensions?.goAtlas?.layers.capability;
    expect(capabilityGraph).toBeDefined();
    expect(capabilityGraph!.nodes.length).toBeGreaterThan(0);
  });
});
```

#### Deliverables

- Unit tests for all builders
- Ground truth validation
- Performance benchmarks
- Test fixtures

---

## 4. Implementation Summary

### Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Performance targets missed | MEDIUM | MEDIUM | Early baseline, continuous benchmarking |
| Selective extraction accuracy | MEDIUM | HIGH | AST-based pre-scanning (not string matching) |
| Import resolution complexity | LOW | MEDIUM | GoModResolver dedicated component |
| gopls API instability | MEDIUM | LOW | Graceful degradation design |
| Package name collision | LOW | HIGH | Merge by fullName, not name |

### Key Alignment with Proposal v5.1

| Aspect | Implementation | Proposal Section |
|--------|---------------|-----------------|
| Plugin architecture | Composition via `GoPlugin` instance | §4.5 |
| Plugin name | `'golang'` (replaces GoPlugin in Registry) | §4.5.5 |
| Plugin metadata | Includes `author`, `minCoreVersion` | §4.5.3 |
| Atlas trigger | `ParseConfig.languageSpecific.atlas` + `IGoAtlas` | §4.5.6 |
| GoPlugin API | `parseToRawData(root, ParseConfig & TreeSitterParseOptions)` | §4.5.1 |
| IParser delegation | `parseCode()`, `parseFiles()` delegated | §4.5.7 |
| dependencyExtractor | `readonly` property (not getter) | §4.5.3 |
| BehaviorAnalyzer | Implements `IBehaviorAnalyzer` with typed options | §4.5.8 |
| TreeSitter API | Unified `parseCode(code, path, options?)` | §4.7 |
| Selective extraction | AST `descendantsOfType()`, `triggerNodeTypes` | §4.7, §4.5.2 |
| Body extraction | Integrated into `parseToRawData()`, no double-parsing | §4.5.1, §4.7 |
| Type authority | ADR-002 re-exported, not duplicated | §4.3.1 |
| Core types | EntityType/RelationType NOT extended | §4.4.1 |
| ILanguagePlugin | NOT modified (no `generateExtendedAnalysis`) | §4.4.2 |
| Package merge | By `fullName`, not `name` | §4.6.1 |
| fullName computation | `path.relative(workspaceRoot, dirPath)` | §4.6.1 |
| sourceFiles | Package-level tracking via `GoRawPackage.sourceFiles` | §4.8 |
| Atlas output | `GoAtlasExtension` with `version`/`layers`/`metadata` | §4.3.1 |
| Cycle detection | Returns `PackageCycle[]` with severity | §4.3.2 |
| GoroutineNode | Includes `spawnType` field | §4.3.2 |
| Method scanning | Both functions AND methods scanned for spawns | §4.6 |
| Mermaid rendering | AtlasRenderer → MermaidGenerator infrastructure | §4.5.2 |

---

## 5. Success Criteria Validation

- Package Graph: 100% recoverability, GoModResolver for import classification
- Capability Graph: >85% recoverability, flat nodes/edges (no redundant fields)
- Goroutine Topology: >70% spawn point detection, scans methods too
- Flow Graph: >70% HTTP entry point detection, AST-based pattern matching
- Performance: Baseline established, targets defined
- Test coverage: >90% core logic, ground truth validation
- Type safety: 0 `any` types in public APIs

---

**Plan Version**: 5.1
**Last Updated**: 2026-02-24
**Status**: Ready for Implementation
**Next Step**: Begin Phase 0 implementation

**Changes from v5.0** (aligned with Proposal v5.1 and ADR v1.2):
- P0-1: Added `author`/`minCoreVersion` to GoAtlasPlugin metadata
- P0-2: Plugin name changed to `'golang'` (replaces GoPlugin in Registry); updated all `getPlugin('golang-atlas')` references
- P0-3: `parseToRawData()` signature changed to `ParseConfig & TreeSitterParseOptions`; all call sites pass required fields
- P1-1: `dependencyExtractor` changed from getter to `readonly` property
- P1-2: Atlas trigger via `ParseConfig.languageSpecific.atlas` (not `ParseConfig & { atlas? }`); added `IGoAtlas` direct entry
- P1-3: Corrected `sourceFiles` description (package-level tracking, not "fix empty array")
- P1-4: Added `fullName` computation code in parseToRawData
- P1-5: `selectiveExtraction.includePatterns` renamed to `triggerNodeTypes`
- P2-1: Added `parseCode()`/`parseFiles()` delegation in GoAtlasPlugin
- P2-2: BehaviorAnalyzer implements `IBehaviorAnalyzer` with typed `options` on `buildGoroutineTopology`/`buildFlowGraph`
- P2-3: Added Mermaid rendering note on AtlasRenderer
- P2-4: Removed `enrichWithFunctionBodies()`; body extraction integrated into `parseToRawData()`
- Updated all Proposal version references from v5.0 to v5.1
- Updated ADR references from v1.1 to v1.2
- Fixed test examples to use proper `ParseConfig` with required fields

**Changes from v4.0** (historical):
- Aligned with Proposal v5.0 and ADR-001 v1.1 / ADR-002 v1.2
- Removed EntityType/RelationType extensions
- Removed `generateExtendedAnalysis` from ILanguagePlugin
- GoPlugin exposes `parseToRawData()` public API (not protected)
- TreeSitterBridge `shouldExtractBody()` uses AST pre-scanning
- Package merge by `fullName` (not `name`), `sourceFiles` populated
- Atlas types reference ADR-002 (not duplicated)
- `PackageCycle` with severity replaces `CycleInfo`
- `GoroutineNode` includes `spawnType`
- GoroutineTopologyBuilder scans methods (not just functions)
- AtlasRenderer accesses `atlas.layers.*` (ADR-002 structure)
- No `any` types in BehaviorAnalyzer cache
- Removed work duration estimates from phase headers
