# ADR-002: ArchJSON extensions 字段设计

**状态**: 已采纳
**日期**: 2026-02-24
**上下文**: Go Architecture Atlas 实施计划 Phase 4
**决策者**: ArchGuard 架构团队
**修订**: v2.0 - 重构 EntryPoint 结构，移除 EntryPointType，引入 protocol/method/framework 三字段；
          移除 generationStrategy.entryPointTypes；GO_ATLAS_EXTENSION_VERSION 升至 2.0
          （破坏性变更，不考虑向后兼容）

---

## 上下文

Go Architecture Atlas 需要存储四层架构图数据（Package、Capability、Goroutine、Flow），这些数据无法完全映射到现有的 ArchJSON 结构中：

### 现有 ArchJSON 的局限性

```typescript
export interface ArchJSON {
  version: string;
  language: SupportedLanguage;
  timestamp: string;
  sourceFiles: string[];
  entities: Entity[];           // 类、接口、结构体
  relations: Relation[];        // 继承、实现、依赖关系
  modules?: Module[];
  metadata?: Record<string, unknown>;
}

export type EntityType =
  'class' | 'interface' | 'enum' | 'struct' | 'trait' |
  'abstract_class' | 'function';

export type RelationType =
  'inheritance' | 'implementation' | 'composition' |
  'aggregation' | 'dependency' | 'association';
```

**问题**：
1. **包不是实体**: Package 是模块边界，不是类/接口
2. **缺少关系类型**: Goroutine spawn (`spawns`) 和函数调用 (`calls`) 无法表示
3. **层级化数据**: Atlas 是四层独立视图，不是扁平的 entity-relation 列表
4. **元数据不同**: Atlas 需要生成策略、完整度等元数据

### 设计目标

1. **无向后兼容约束**: 既然不考虑向后兼容，可以优化设计
2. **可扩展性**: 支持未来的语言专用扩展（Java、Rust 等）
3. **可验证性**: 清晰的类型定义和版本控制
4. **渐进式生成**: 支持部分图层生成（如只有 Package + Capability）

---

## 决策

**使用显式类型化的 `extensions` 字段**，结合强类型接口定义。

### 核心设计

```typescript
/**
 * 扩展的 ArchJSON 结构
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

  // ========== 新增：扩展字段 ==========
  extensions?: ArchJSONExtensions;
}

/**
 * 类型化的扩展容器
 */
export interface ArchJSONExtensions {
  // Go Architecture Atlas 扩展
  goAtlas?: GoAtlasExtension;

  // 未来其他语言的扩展
  javaAtlas?: JavaAtlasExtension;
  rustAtlas?: RustAtlasExtension;
}

/**
 * Go Architecture Atlas 扩展
 */
export interface GoAtlasExtension {
  // 扩展版本（独立于 ArchJSON.version）
  version: string;  // "1.0"

  // 四层架构图（渐进式生成）
  layers: GoAtlasLayers;

  // 元数据
  metadata: GoAtlasMetadata;
}

/**
 * Go Atlas 图层定义（可选部分）
 */
export interface GoAtlasLayers {
  // Package Dependency Graph（静态分析，100% 可恢复）
  package?: PackageGraph;

  // Capability Graph（接口使用，85% 可恢复）
  capability?: CapabilityGraph;

  // Goroutine Topology（并发模式，70% 可恢复）
  goroutine?: GoroutineTopology;

  // Flow Graph（调用链，60% 可恢复）
  flow?: FlowGraph;
}

/**
 * Go Atlas 元数据
 */
export interface GoAtlasMetadata {
  // 生成时间
  generatedAt: string;

  // 生成策略
  generationStrategy: {
    // 函数体提取策略
    functionBodyStrategy: 'none' | 'selective' | 'full';

    // 选择性提取配置（如果适用）
    selectiveConfig?: {
      /**
       * 触发函数体提取的 AST 节点类型
       * 例如: ['go_statement', 'send_statement', 'receive_expression']
       */
      triggerNodeTypes: string[];
      excludedTestFiles: boolean;
      extractedFunctionCount: number;
      totalFunctionCount: number;
    };

    // 检测到的框架列表（来自 go.mod + import 扫描）
    detectedFrameworks: string[];       // e.g. ['gin', 'grpc', 'net/http']

    // 协议过滤（undefined = 不过滤，输出全部）
    protocols?: string[];               // e.g. ['http', 'grpc']

    // 是否启用间接调用追踪
    followIndirectCalls: boolean;

    // gopls 是否可用
    goplsEnabled: boolean;
  };

  // 完整度评估
  completeness: {
    package: number;      // 0.0 - 1.0 (总是 1.0)
    capability: number;    // 0.0 - 1.0
    goroutine: number;    // 0.0 - 1.0
    flow: number;         // 0.0 - 1.0
  };

  // 性能指标
  performance: {
    fileCount: number;
    parseTime: number;        // 毫秒
    totalTime: number;        // 毫秒
    memoryUsage: number;      // 字节
  };

  // 警告和限制
  warnings?: string[];
}
```

### 图层数据结构

```typescript
/**
 * Package Dependency Graph
 */
export interface PackageGraph {
  nodes: PackageNode[];
  edges: PackageDependency[];
  cycles: PackageCycle[];  // 检测到的循环依赖
}

export interface PackageCycle {
  packages: string[];     // 循环依赖的包 ID 列表
  severity: 'warning' | 'error';
}

export interface PackageNode {
  id: string;           // "github.com/archguard/swarm-hub/pkg/hub"
  name: string;         // "pkg/hub"
  type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd'
      | 'tests' | 'examples' | 'testutil';  // v1.3: role-based classification
  fileCount: number;
  stats?: PackageStats;
}

export interface PackageStats {
  structs: number;
  interfaces: number;
  functions: number;
}

export interface PackageDependency {
  from: string;         // package id
  to: string;           // package id
  strength: number;     // 导入符号数量
  transitive?: boolean; // 是否为传递依赖
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
  source: string;        // struct or function id
  target: string;        // interface id
  confidence: number;    // 0.0 - 1.0
  context?: {
    fieldType?: boolean;
    parameterType?: boolean;
    returnType?: boolean;
    usageLocations: string[];  // file:line references
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
  name: string;          // 函数名
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
  from: string;          // spawner function id
  to: string;            // spawned function id
  spawnType: 'go-func' | 'go-stmt';
}

export interface ChannelInfo {
  id: string;
  type: string;          // channel type (e.g., "chan Job")
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

/**
 * Protocol surface of an entry point.
 *
 * Open string type — allows user-defined values (e.g. 'kafka', 'websocket')
 * via customFrameworks config without requiring a source change to ArchGuard.
 *
 * Built-in values: 'http' | 'grpc' | 'cli' | 'message' | 'scheduler'
 */
export type EntryPointProtocol = string;

/** HTTP method. Only set when protocol === 'http'. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ANY';

export interface EntryPoint {
  id: string;
  /** Architectural protocol surface — replaces the former `type` field. */
  protocol: EntryPointProtocol;
  /** HTTP method, only present when protocol === 'http'. */
  method?: HttpMethod;
  /** Which detector/framework produced this entry point (e.g. 'gin', 'net/http', 'cobra'). */
  framework: string;
  path: string;          // URL path, gRPC method name, topic name, command name, etc.
  handler: string;       // function id
  middleware: string[];  // middleware function ids
  package?: string;      // Go package full path
  location: {
    file: string;
    line: number;
  };
}

// EntryPointType is REMOVED. Use EntryPoint.protocol instead.

export interface CallChain {
  id: string;
  entryPoint: string;    // entry point id
  calls: CallEdge[];
  errorPath?: CallEdge[];
}

export interface CallEdge {
  from: string;
  to: string;
  type: 'direct' | 'interface' | 'indirect';
  confidence: number;
}
```

---

## 使用示例

### 完整 Atlas 生成

```typescript
const archJSON: ArchJSON = {
  version: '1.0',
  language: 'go',
  timestamp: '2026-02-24T10:00:00Z',
  sourceFiles: ['main.go', 'pkg/hub/server.go', /* ... */],
  entities: [/* GoPlugin 生成的实体 */],
  relations: [/* GoPlugin 生成的关系 */],

  extensions: {
    goAtlas: {
      version: '1.0',
      layers: {
        package: {
          nodes: [
            { id: 'github.com/...', name: 'cmd/swarm-hub', type: 'internal', fileCount: 1 },
            { id: 'github.com/...', name: 'pkg/hub', type: 'internal', fileCount: 12 },
          ],
          edges: [
            { from: 'cmd/swarm-hub', to: 'pkg/hub', strength: 5 },
          ],
          cycles: [],  // PackageCycle[]
        },
        capability: {
          nodes: [/* ... */],
          edges: [/* ... */],
        },
        goroutine: {
          nodes: [/* ... */],
          edges: [/* ... */],
          channels: [/* ... */],
        },
        flow: {
          entryPoints: [
            {
              id: 'entry-pkg/hub-42',
              protocol: 'http',
              method: 'POST',
              framework: 'gin',
              path: '/api/sessions',
              handler: 'handleCreateSession',
              middleware: [],
              package: 'pkg/hub',
              location: { file: 'pkg/hub/server.go', line: 42 },
            },
          ],
          callChains: [/* ... */],
        },
      },
      metadata: {
        generatedAt: '2026-02-24T10:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'selective',
          selectiveConfig: {
            triggerNodeTypes: ['go_statement', 'send_statement', 'receive_expression'],
            excludedTestFiles: true,
            extractedFunctionCount: 42,
            totalFunctionCount: 156,
          },
          detectedFrameworks: ['gin', 'net/http'],
          protocols: undefined,       // not filtered
          followIndirectCalls: false,
          goplsEnabled: true,
        },
        completeness: {
          package: 1.0,
          capability: 0.87,
          goroutine: 0.72,
          flow: 0.58,
        },
        performance: {
          fileCount: 100,
          parseTime: 8234,
          totalTime: 15234,
          memoryUsage: 256 * 1024 * 1024,
        },
        warnings: [
          'Flow graph accuracy limited without gopls call hierarchy',
          '5 goroutine spawn points could not be classified',
        ],
      },
    },
  },
};
```

### 部分生成（仅 Package + Capability）

```typescript
const archJSON: ArchJSON = {
  // ... 基础字段 ...

  extensions: {
    goAtlas: {
      version: '1.0',
      layers: {
        package: { /* ... */ },
        capability: { /* ... */ },
        // goroutine 和 flow 未生成
      },
      metadata: {
        generatedAt: '2026-02-24T10:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          // ...
        },
        completeness: {
          package: 1.0,
          capability: 0.85,
          goroutine: 0.0,  // 未生成
          flow: 0.0,       // 未生成
        },
        performance: { /* ... */ },
      },
    },
  },
};
```

---

## 扩展 ArchJSON 核心类型（可选增强）

虽然使用 `extensions` 字段，但也可以选择性扩展核心类型以支持更好的互操作性：

```typescript
// 扩展 EntityType（可选）
export type EntityType =
  | 'class' | 'interface' | 'enum' | 'struct' | 'trait'
  | 'abstract_class' | 'function'
  | 'package';  // 新增：支持包作为实体

// 扩展 RelationType（可选）
export type RelationType =
  | 'inheritance' | 'implementation' | 'composition'
  | 'aggregation' | 'dependency' | 'association'
  | 'spawns'      // 新增：goroutine spawn
  | 'calls';      // 新增：function call
```

**决策**: 暂不扩展核心类型，原因：
1. Package 不适合作为 `Entity`（缺少成员、方法等概念）
2. `spawns` 和 `calls` 关系与 Goroutine Topology 重复
3. 保持核心类型简洁，语言特定数据放在 `extensions`

---

## 版本控制策略

### ArchJSON 版本
- 当前版本：`1.0`
- 破坏性更改时递增主版本
- `extensions` 字段的添加**不**视为破坏性更改（可选字段）

### GoAtlasExtension 版本
- 独立版本号：`1.0`, `1.1`, `2.0`
- 版本变更规则：
  - **主版本**: 图层结构重大变更
  - **次版本**: 新增可选字段
  - **补丁版本**: Bug 修复

```typescript
export const GO_ATLAS_EXTENSION_VERSION = '2.0';  // v2.0: EntryPoint.type → protocol/method/framework

export interface GoAtlasExtension {
  version: string;  // 与常量匹配
  // ...
}
```

---

## 验证和类型安全

### 运行时验证

```typescript
import { z } from 'zod';

// Zod schema for validation
export const GoAtlasExtensionSchema = z.object({
  version: z.string(),
  layers: z.object({
    package: PackageGraphSchema.optional(),
    capability: CapabilityGraphSchema.optional(),
    goroutine: GoroutineTopologySchema.optional(),
    flow: FlowGraphSchema.optional(),
  }),
  metadata: GoAtlasMetadataSchema,
});

// 验证函数
export function validateGoAtlasExtension(
  data: unknown
): data is GoAtlasExtension {
  return GoAtlasExtensionSchema.safeParse(data).success;
}
```

### 编译时类型安全

```typescript
// 类型守卫
function hasGoAtlasExtension(archJSON: ArchJSON): archJSON is ArchJSON & {
  extensions: { goAtlas: GoAtlasExtension };
} {
  return !!archJSON.extensions?.goAtlas;
}

// 使用
if (hasGoAtlasExtension(archJSON)) {
  const packageGraph = archJSON.extensions.goAtlas.layers.package;
  // TypeScript 知道 packageGraph 是 PackageGraph | undefined
}
```

---

## 后果

### 正面影响

✅ **类型安全**: 完整的 TypeScript 类型定义
✅ **可扩展性**: 清晰的扩展点，支持未来语言
✅ **渐进式生成**: 支持部分图层，灵活的生成策略
✅ **自描述**: 元数据包含生成策略和完整度
✅ **可验证**: 运行时验证 + 编译时类型检查

### 负面影响

❌ **复杂性**: 引入额外的类型定义和验证逻辑
❌ **数据冗余**: 某些信息可能同时存在于 `entities/relations` 和 `extensions` 中

### 缓解措施

1. **复杂性**: 提供工具函数简化访问
   ```typescript
   // 便捷访问器
   class GoAtlasAccessor {
     constructor(private archJSON: ArchJSON) {}

     getPackageGraph(): PackageGraph | undefined {
       return this.archJSON.extensions?.goAtlas?.layers.package;
     }

     isLayerAvailable(layer: AtlasLayer): boolean {
       return !!this.archJSON.extensions?.goAtlas?.layers[layer];
     }
   }
   ```

2. **数据冗余**: 明确语义边界
   - `entities/relations`: 面向通用的类图/依赖图
   - `extensions.goAtlas`: 面向 Go 特定的四层架构视图
   - 两者共存，服务于不同的可视化需求

---

## 替代方案

### 方案 A: 独立的 Atlas JSON 文件（已拒绝）

```json
// archguard-atlas.json (separate file)
{
  "version": "1.0",
  "packageGraph": { /* ... */ },
  // ...
}
```

**问题**:
- 文件管理复杂（多个输出文件）
- 缺少与基础 ArchJSON 的关联
- 用户困惑（应该用哪个文件？）

### 方案 B: 嵌入到 metadata 字段（已拒绝）

```typescript
metadata: {
  goAtlas: { /* ... */ }  // 失去类型安全
}
```

**问题**:
- `metadata` 是 `Record<string, unknown>`，失去类型检查
- 无法明确扩展结构
- 不符合语义（`metadata` 应该是辅助信息，不是核心数据）

### 方案 C: 扩展 Entity 和 Relation 类型（已拒绝）

```typescript
entities: [
  { id: 'pkg-1', type: 'package', /* ... */ },
  // ...
]
relations: [
  { id: 'r-1', type: 'spawns', /* ... */ },
  // ...
]
```

**问题**:
- Package 不适合 Entity 模型（缺少 methods, fields 等）
- 四层架构图不是扁平的 entity-relation 结构
- 失去层级化的视图组织

---

## 相关决策

- [ADR-001: GoAtlasPlugin 组合模式](./001-goatlas-plugin-composition.md)
- [Proposal 16: Go Architecture Atlas v5.1](../proposals/16-go-architecture-atlas.md)

---

## 实施检查清单

- [ ] 定义完整的 TypeScript 类型系统
- [ ] 实现 Zod 验证 schema
- [ ] 更新 ArchJSON 序列化/反序列化逻辑
- [ ] 实现 GoAtlasAccessor 工具类
- [ ] 添加单元测试（类型验证）
- [ ] 集成到 GoAtlasPlugin
- [ ] 文档更新

---

**文档版本**: 2.0
**最后更新**: 2026-03-01
**状态**: 已采纳 - 待实施
**变更记录**:
- v1.1: `PackageGraph.cycles` 改为结构化 `PackageCycle[]`（含 severity）；`PackageNode.type` 新增 `'cmd'`；`PackageNode` 新增可选 `stats`；`GoroutineNode` 新增可选 `spawnType`
- v1.2: `selectiveConfig.includedPatterns` 重命名为 `triggerNodeTypes`（语义修正：这是 AST 节点类型列表，非正则匹配模式）；更新示例对齐实际用法；交叉引用更新至 Proposal v5.1
- v1.3: `PackageNode.type` union 扩展，新增 `'tests' | 'examples' | 'testutil'` 用于角色分类；`GO_ATLAS_EXTENSION_VERSION` 升至 `'1.1'`
- v2.0: **破坏性变更**（不考虑向后兼容）
  - `EntryPoint.type: EntryPointType` 移除，拆分为三个字段：
    - `protocol: EntryPointProtocol`（开放 string，架构层面协议分类）
    - `method?: HttpMethod`（仅 HTTP 协议时存在）
    - `framework: string`（产生该入口点的检测器/框架名称）
  - `EntryPointType` 联合类型完全移除
  - `GoAtlasMetadata.generationStrategy.entryPointTypes` 移除，替换为：
    - `detectedFrameworks: string[]`（自动检测结果）
    - `protocols?: string[]`（过滤配置，undefined = 不过滤）
  - `GO_ATLAS_EXTENSION_VERSION` 升至 `'2.0'`
  - 关联：Proposal go-flow-framework-detection v2
