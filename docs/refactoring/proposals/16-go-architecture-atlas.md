# Go Architecture Atlas: Go 语言架构可观测系统

**文档版本**: 1.0
**创建日期**: 2026-02-23
**最后修改**: 2026-02-23
**前置依赖**: 15-golang-support-proposal.md (Phase 0-4 已完成)
**目标**: 从 Class Diagram 范式升级到 Coordination Diagram 范式

---

## 1. 执行摘要

### 1.1 核心洞察

> **OOP 语言可以从代码恢复 Architecture。**
> **Go 语言必须从行为恢复 Architecture。**

这是 ArchGuard 遇到的第一个"语言哲学级"断裂。TypeScript/Java/C# 中，类型系统 ≈ 概念模型 ≈ 架构。但在 Go 中：

- Go 类型表达的是 **data layout** 和 **minimal capability**
- 而不是 **system structure** 和 **coordination logic**

### 1.2 问题陈述

当前 Go 实现（Proposal 15 Phase 0-4）已成功：
- ✅ Tree-sitter 语法分析
- ✅ gopls 语义分析
- ✅ 隐式接口检测
- ✅ 方法提升

但生成的 **Class Diagram 对 Go 项目的价值有限**：

| 问题 | 示例 | 影响 |
|------|------|------|
| 同名类混淆 | 多个 `Server` 结构体 | 排名不稳定 |
| 数据模型无方法 | `Session`, `Task` 纯数据容器 | 核心类评分低 |
| 缺少行为信息 | 谁调用、谁拥有生命周期、是否并发 | 无法识别真实依赖 |
| 业务逻辑在函数中 | `UpdateRuntimeState()` 不在任何类中 | 架构图缺失核心逻辑 |

### 1.3 解决方案

# ✅ **Go Architecture Atlas**

从单一 Class Diagram 升级为四层架构图：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Go Architecture Atlas                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │  Package Graph   │  │ Capability Graph │  │ Goroutine Graph│ │
│  │  (静态边界)       │  │  (抽象关系)       │  │  (执行结构)    │ │
│  │  ⭐⭐⭐⭐⭐        │  │  ⭐⭐⭐⭐          │  │  ⭐⭐⭐⭐⭐     │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘ │
│           │                     │                    │          │
│           └─────────────────────┼────────────────────┘          │
│                                 ▼                               │
│                      ┌──────────────────┐                       │
│                      │   Flow Graph     │                       │
│                      │   (信息路径)      │                       │
│                      │   ⭐⭐⭐⭐⭐       │                       │
│                      └──────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

这四张图叠加 ≈ Go 架构。

---

## 2. 理论基础

### 2.1 OOP vs Go 的架构可恢复性差异

```
OOP (TypeScript/Java/C#):
┌─────────────────────────────────────────────────────────────┐
│  Type System ≈ Conceptual Model ≈ Architecture              │
│                                                             │
│  类 = 稳定抽象                                               │
│  类型关系 = 系统结构                                          │
│  依赖 = 设计意图                                              │
│                                                             │
│  👉 静态类型图就是架构图                                       │
│  👉 AST → Type Graph → Diagram (可行)                        │
└─────────────────────────────────────────────────────────────┘

Go:
┌─────────────────────────────────────────────────────────────┐
│  Type System ≠ Conceptual Model ≠ Architecture              │
│                                                             │
│  interface { Save(Event) error } 只告诉你：                  │
│  - 可以保存事件                                               │
│                                                             │
│  它没有告诉你：                                               │
│  - 谁调用？                                                   │
│  - 谁拥有生命周期？                                           │
│  - 是否并发？                                                 │
│  - 是否核心依赖？                                             │
│  - 是否关键路径？                                             │
│                                                             │
│  真正的架构信息在：                                            │
│  - runtime behavior                                          │
│  - package topology                                          │
│  - communication flow                                        │
│                                                             │
│  👉 需要从行为恢复架构，而不是从类型                            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Go 的 Machine-Recoverable Truth

不是问"如何从 Go 生成 Diagram"，而是问：

> **Go 项目中哪些结构是 Machine-Recoverable Truth？**

| 结构 | 真实度 | 恢复难度 | 架构价值 |
|------|--------|----------|----------|
| **imports** | 100% truth | 低 | ⭐⭐⭐⭐⭐ |
| **interface usage** | high truth | 中 | ⭐⭐⭐⭐ |
| **goroutine spawn** | runtime truth | 中 | ⭐⭐⭐⭐⭐ |
| **channel edges** | coordination truth | 高 | ⭐⭐⭐⭐⭐ |
| **class hierarchy** | low truth | 低 | ⭐⭐ |

这些比 class hierarchy 更真实。

---

## 3. 四层架构图设计

### 3.1 Package Dependency Graph (静态边界)

**稳定性**: ⭐⭐⭐⭐⭐
**恢复难度**: 低
**LLM 需要**: 否

Go 的真正静态架构，完全无需 LLM。

```
解析方式:
- go list -deps
- AST import graph

输出格式:
┌─────────────────────────────────────────────────────────────┐
│  cmd/swarm-hub                                               │
│       │                                                      │
│       ├── pkg/hub                                            │
│       │      │                                               │
│       │      ├── pkg/hub/engine                              │
│       │      │      │                                        │
│       │      │      └── pkg/hub/store                        │
│       │      │                                               │
│       │      └── pkg/hub/models                              │
│       │                                                      │
│       ├── pkg/runtime                                        │
│       └── pkg/config                                         │
└─────────────────────────────────────────────────────────────┘
```

**这就是 Go 的 Architecture Skeleton**

### 3.2 Capability Graph (抽象关系)

**稳定性**: ⭐⭐⭐⭐
**恢复难度**: 中
**LLM 需要**: 可选（用于命名优化）

核心思想：
> **Interface usage 才是架构，不是 interface 定义。**

```
解析方式:
- interface 定义位置
- concrete implementation
- injection points (字段/函数参数)
- field/interface usage

输出格式:
┌─────────────────────────────────────────────────────────────┐
│  Server ────────uses──────▶ Store                           │
│     │                          ▲                             │
│     │                          │                             │
│     ▼                          │                             │
│  Engine ────────uses──────▶ Store                           │
│                                  │                           │
│                                  │                           │
│  SQLiteStore ──implements──▶ Store                          │
│                                                              │
│  Worker ─────────uses─────▶ Executor                        │
│     │                          ▲                             │
│     ▼                          │                             │
│  TaskExecutor ─implements─▶ Executor                        │
└─────────────────────────────────────────────────────────────┘
```

**这是 Go 的真实抽象层**

### 3.3 Goroutine Topology (执行结构)

**稳定性**: ⭐⭐⭐⭐⭐
**恢复难度**: 中
**LLM 需要**: 否
**市场空白**: 目前几乎没有工具自动做这个

可静态识别的模式：

```go
// 模式 1: go func 启动
go func() {
    // ...
}()

// 模式 2: channel 创建
jobChan := make(chan Job, 100)

// 模式 3: worker loop
for job := range jobChan {
    process(job)
}

// 模式 4: select 多路复用
select {
case job := <-jobChan:
case <-ctx.Done():
}

// 模式 5: background runner
func (s *Server) Start() {
    go s.runSessionGC(ctx)  // 后台任务
}
```

输出格式：
```
┌─────────────────────────────────────────────────────────────┐
│  HTTP Handler                                                │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────┐                                                 │
│  │ jobChan │ ◄─── make(chan Job, 100)                       │
│  └────┬────┘                                                 │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────────┐                                            │
│  │ Worker Pool  │ ◄─── for i := 0; i < workers; i++         │
│  │  (N workers) │      go worker(jobChan)                   │
│  └──────┬───────┘                                            │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────┐                                        │
│  │ Result Aggregator │ ◄─── resultChan                      │
│  └──────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

**这才是 Go Runtime Architecture**

### 3.4 Flow Graph (信息路径)

**稳定性**: ⭐⭐⭐⭐⭐
**恢复难度**: 高
**LLM 需要**: 可选（用于复杂流程理解）

Go 系统真正结构：

```
解析方式:
- call graph (函数调用链)
- context propagation (ctx 传递)
- error return paths (错误处理路径)

输出格式:
┌─────────────────────────────────────────────────────────────┐
│  HTTP Request: POST /v1/tasks:dispatch                       │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────────────┐                                        │
│  │ Auth Middleware  │ ──── token validation                  │
│  └────────┬─────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ handleTasksDispatch │                                     │
│  └────────┬─────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ Engine.CreateTask │ ──── state machine validation         │
│  └────────┬─────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ Store.CreateTask │ ──── persistence                       │
│  └────────┬─────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ Metrics.Record   │ ──── observability                     │
│  └──────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 架构设计

### 4.1 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Go Architecture Atlas System                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                     GoAtlasPlugin (extends GoPlugin)            │  │
│  ├─────────────────────────────────────────────────────────────────┤  │
│  │                                                                 │  │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │  │
│  │  │ TreeSitter    │  │ GoplsClient   │  │ BehaviorAnalyzer  │   │  │
│  │  │ (Phase 0-4)   │  │ (Phase 0-4)   │  │ (NEW)             │   │  │
│  │  └───────┬───────┘  └───────┬───────┘  └─────────┬─────────┘   │  │
│  │          │                  │                    │             │  │
│  │          └──────────────────┼────────────────────┘             │  │
│  │                             ▼                                  │  │
│  │  ┌─────────────────────────────────────────────────────────┐   │  │
│  │  │                    AtlasBuilder                          │   │  │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌────────────────────┐ │   │  │
│  │  │  │ PackageGraph│ │CapabilityGrp│ │GoroutineTopology   │ │   │  │
│  │  │  │ Builder     │ │ Builder     │ │ Builder            │ │   │  │
│  │  │  └─────────────┘ └─────────────┘ └────────────────────┘ │   │  │
│  │  │  ┌─────────────────────────────────────────────────────┐│   │  │
│  │  │  │ FlowGraphBuilder                                      ││   │  │
│  │  │  └─────────────────────────────────────────────────────┘│   │  │
│  │  └─────────────────────────────────────────────────────────┘   │  │
│  │                             │                                  │  │
│  │                             ▼                                  │  │
│  │  ┌─────────────────────────────────────────────────────────┐   │  │
│  │  │                    AtlasRenderer                         │   │  │
│  │  │  - Mermaid (Package, Capability, Goroutine, Flow)       │   │  │
│  │  │  - JSON (machine-readable)                              │   │  │
│  │  │  - SVG/PNG (visual)                                     │   │  │
│  │  └─────────────────────────────────────────────────────────┘   │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心数据结构

```typescript
// plugins/golang/atlas/types.ts

/**
 * Go Architecture Atlas - 四层架构数据结构
 */
export interface GoArchitectureAtlas {
  metadata: AtlasMetadata;
  packageGraph: PackageGraph;
  capabilityGraph: CapabilityGraph;
  goroutineTopology: GoroutineTopology;
  flowGraph: FlowGraph;
}

export interface AtlasMetadata {
  moduleName: string;
  moduleRoot: string;
  goVersion: string;
  generatedAt: string;
  stats: {
    packages: number;
    interfaces: number;
    structs: number;
    goroutines: number;
    channels: number;
  };
}

// ============== Package Graph ==============

export interface PackageGraph {
  packages: PackageNode[];
  dependencies: PackageDependency[];
  cycles: PackageCycle[];  // 检测到的循环依赖
}

export interface PackageNode {
  id: string;              // e.g., "github.com/example/swarm/pkg/hub"
  name: string;            // e.g., "hub"
  path: string;            // 文件系统路径
  type: 'cmd' | 'pkg' | 'internal' | 'vendor';
  exports: string[];       // 导出的符号
  stats: {
    files: number;
    structs: number;
    interfaces: number;
    functions: number;
  };
}

export interface PackageDependency {
  from: string;            // package id
  to: string;              // package id
  type: 'import' | 'test_import';
  strength: number;        // 引用次数
}

// ============== Capability Graph ==============

export interface CapabilityGraph {
  interfaces: InterfaceCapability[];
  implementations: Implementation[];
  usageSites: UsageSite[];
}

export interface InterfaceCapability {
  id: string;
  name: string;
  packageId: string;
  methods: MethodSignature[];
  implementors: string[];  // 实现此接口的结构体 ID
  consumers: string[];     // 使用此接口的位置
}

export interface Implementation {
  structId: string;
  interfaceId: string;
  type: 'explicit' | 'implicit';  // Go 只有 implicit
  coverage: number;               // 方法覆盖率
}

export interface UsageSite {
  interfaceId: string;
  location: SourceLocation;
  context: 'field' | 'parameter' | 'return' | 'variable';
  consumerId: string;             // 使用者的实体 ID
}

// ============== Goroutine Topology ==============

export interface GoroutineTopology {
  goroutines: GoroutineNode[];
  channels: ChannelNode[];
  connections: GoroutineConnection[];
}

export interface GoroutineNode {
  id: string;
  name: string;            // 函数名或匿名
  spawnLocation: SourceLocation;
  spawnType: 'named' | 'anonymous' | 'method';
  pattern: 'worker' | 'server' | 'timer' | 'background' | 'unknown';
}

export interface ChannelNode {
  id: string;
  name: string;
  location: SourceLocation;
  bufferSize: number;      // 0 = unbuffered
  direction: 'bidirectional' | 'send' | 'receive';
  elementType: string;     // 元素类型
}

export interface GoroutineConnection {
  from: string;            // goroutine id 或 'external'
  to: string;              // goroutine id 或 'external'
  via: string;             // channel id
  type: 'send' | 'receive' | 'select';
}

// ============== Flow Graph ==============

export interface FlowGraph {
  flows: Flow[];
  entryPoints: EntryPoint[];
}

export interface Flow {
  id: string;
  name: string;
  steps: FlowStep[];
  errorPaths: ErrorPath[];
}

export interface FlowStep {
  id: string;
  type: 'function' | 'method' | 'middleware';
  name: string;
  location: SourceLocation;
  nextSteps: string[];     // 下一步骤 ID
  contextPropagation: boolean;  // 是否传递 ctx
}

export interface ErrorPath {
  fromStep: string;
  errorType: string;       // 错误类型
  handler: string;         // 错误处理方式
}

export interface EntryPoint {
  type: 'http' | 'grpc' | 'cli' | 'schedule' | 'event';
  path: string;            // HTTP 路径、CLI 命令等
  flowId: string;          // 关联的 Flow ID
}
```

### 4.3 分析器实现

```typescript
// plugins/golang/atlas/behavior-analyzer.ts

/**
 * 行为分析器 - 从 Go 代码中提取行为级架构信息
 */
export class BehaviorAnalyzer {
  private treeSitter: TreeSitterBridge;
  private goplsClient: GoplsClient;

  constructor(treeSitter: TreeSitterBridge, goplsClient?: GoplsClient) {
    this.treeSitter = treeSitter;
    this.goplsClient = goplsClient;
  }

  /**
   * 分析 Goroutine 拓扑
   */
  async analyzeGoroutineTopology(packages: GoRawPackage[]): Promise<GoroutineTopology> {
    const goroutines: GoroutineNode[] = [];
    const channels: ChannelNode[] = [];
    const connections: GoroutineConnection[] = [];

    for (const pkg of packages) {
      for (const file of pkg.files || []) {
        const tree = this.treeSitter.parseFile(file);

        // 1. 找到所有 go func() 调用
        const goStmts = this.findGoStatements(tree);
        for (const stmt of goStmts) {
          goroutines.push(this.extractGoroutineNode(stmt, pkg.id));
        }

        // 2. 找到所有 channel 创建
        const makeChans = this.findChannelCreations(tree);
        for (const chan of makeChans) {
          channels.push(this.extractChannelNode(chan, pkg.id));
        }

        // 3. 找到 channel 操作
        const chanOps = this.findChannelOperations(tree);
        for (const op of chanOps) {
          connections.push(this.extractConnection(op, pkg.id));
        }
      }
    }

    return { goroutines, channels, connections };
  }

  /**
   * 分析 Capability 图
   */
  async analyzeCapabilityGraph(
    packages: GoRawPackage[],
    impls: InferredImplementation[]
  ): Promise<CapabilityGraph> {
    const interfaces: InterfaceCapability[] = [];
    const implementations: Implementation[] = [];
    const usageSites: UsageSite[] = [];

    // 1. 构建接口能力
    for (const pkg of packages) {
      for (const iface of pkg.interfaces) {
        const capability: InterfaceCapability = {
          id: `${pkg.id}.${iface.name}`,
          name: iface.name,
          packageId: pkg.id,
          methods: iface.methods,
          implementors: [],
          consumers: []
        };

        // 找到实现者
        const ifaceImpls = impls.filter(i => i.interfaceName === iface.name);
        capability.implementors = ifaceImpls.map(i => i.structName);

        interfaces.push(capability);
      }
    }

    // 2. 找到使用点
    for (const pkg of packages) {
      for (const struct of pkg.structs) {
        // 字段类型是接口
        for (const field of struct.fields) {
          const iface = interfaces.find(i => i.name === field.type);
          if (iface) {
            usageSites.push({
              interfaceId: iface.id,
              location: field.location,
              context: 'field',
              consumerId: `${pkg.id}.${struct.name}`
            });
            iface.consumers.push(`${pkg.id}.${struct.name}`);
          }
        }
      }

      // 函数参数是接口
      for (const fn of pkg.functions) {
        for (const param of fn.params) {
          const iface = interfaces.find(i => i.name === param.type);
          if (iface) {
            usageSites.push({
              interfaceId: iface.id,
              location: fn.location,
              context: 'parameter',
              consumerId: `${pkg.id}.${fn.name}`
            });
            iface.consumers.push(`${pkg.id}.${fn.name}`);
          }
        }
      }
    }

    // 3. 构建实现关系
    for (const impl of impls) {
      implementations.push({
        structId: impl.structName,
        interfaceId: impl.interfaceName,
        type: 'implicit',
        coverage: impl.methodCoverage
      });
    }

    return { interfaces, implementations, usageSites };
  }

  /**
   * 分析 Flow 图
   */
  async analyzeFlowGraph(packages: GoRawPackage[]): Promise<FlowGraph> {
    const flows: Flow[] = [];
    const entryPoints: EntryPoint[] = [];

    // 1. 找到 HTTP 入口点
    for (const pkg of packages) {
      // 查找 http.HandleFunc, http.Handle, mux.HandleFunc 等
      const httpHandlers = this.findHTTPHandlers(pkg);
      for (const handler of httpHandlers) {
        const flow = await this.traceCallGraph(handler.handlerFunc, packages);
        flows.push(flow);
        entryPoints.push({
          type: 'http',
          path: handler.path,
          flowId: flow.id
        });
      }
    }

    // 2. 找到 CLI 入口点
    // ...

    return { flows, entryPoints };
  }

  // 私有方法...

  private findGoStatements(tree: Tree): GoStatement[] { /* ... */ }
  private findChannelCreations(tree: Tree): ChannelCreation[] { /* ... */ }
  private findChannelOperations(tree: Tree): ChannelOperation[] { /* ... */ }
  private findHTTPHandlers(pkg: GoRawPackage): HTTPHandler[] { /* ... */ }
  private async traceCallGraph(entryFunc: string, packages: GoRawPackage[]): Promise<Flow> { /* ... */ }
}
```

### 4.4 渲染器实现

```typescript
// plugins/golang/atlas/atlas-renderer.ts

/**
 * Atlas 渲染器 - 将四层架构渲染为不同格式
 */
export class AtlasRenderer {

  /**
   * 渲染 Package Graph 为 Mermaid
   */
  renderPackageGraph(graph: PackageGraph): string {
    const lines: string[] = ['graph TD'];

    // 节点
    for (const pkg of graph.packages) {
      const label = pkg.name;
      const shape = pkg.type === 'cmd' ? '[[ ]]' : '[ ]';
      lines.push(`    ${this.sanitizeId(pkg.id)}${shape}["${label}"]`);
    }

    // 依赖
    for (const dep of graph.dependencies) {
      lines.push(`    ${this.sanitizeId(dep.from)} --> ${this.sanitizeId(dep.to)}`);
    }

    // 循环依赖警告
    if (graph.cycles.length > 0) {
      lines.push('');
      lines.push('    %% ⚠️ 检测到循环依赖:');
      for (const cycle of graph.cycles) {
        lines.push(`    %% ${cycle.packages.join(' -> ')}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 渲染 Capability Graph 为 Mermaid
   */
  renderCapabilityGraph(graph: CapabilityGraph): string {
    const lines: string[] = ['graph TD'];

    // 接口 (六边形)
    for (const iface of graph.interfaces) {
      lines.push(`    ${this.sanitizeId(iface.id)}{{"${iface.name}"}}`);
    }

    // 实现者 (矩形)
    const structs = new Set<string>();
    for (const impl of graph.implementations) {
      if (!structs.has(impl.structId)) {
        lines.push(`    ${this.sanitizeId(impl.structId)}["${impl.structId}"]`);
        structs.add(impl.structId);
      }
    }

    // 实现关系
    for (const impl of graph.implementations) {
      lines.push(`    ${this.sanitizeId(impl.structId)} -.->|implements| ${this.sanitizeId(impl.interfaceId)}`);
    }

    // 使用关系
    for (const usage of graph.usageSites) {
      if (usage.context === 'field') {
        lines.push(`    ${this.sanitizeId(usage.consumerId)} -->|uses| ${this.sanitizeId(usage.interfaceId)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 渲染 Goroutine Topology 为 Mermaid
   */
  renderGoroutineTopology(topology: GoroutineTopology): string {
    const lines: string[] = ['graph TD'];

    // Goroutine 节点
    for (const gr of topology.goroutines) {
      const pattern = gr.pattern !== 'unknown' ? ` [${gr.pattern}]` : '';
      lines.push(`    ${this.sanitizeId(gr.id)}("${gr.name}${pattern}")`);
    }

    // Channel 节点
    for (const ch of topology.channels) {
      lines.push(`    ${this.sanitizeId(ch.id)}[("=${ch.name}=")]`);
    }

    // 连接
    for (const conn of topology.connections) {
      const arrow = conn.type === 'send' ? '-->' : '<--';
      lines.push(`    ${this.sanitizeId(conn.from)} ${arrow}|via ${conn.via}| ${this.sanitizeId(conn.to)}`);
    }

    return lines.join('\n');
  }

  /**
   * 渲染 Flow Graph 为 Mermaid
   */
  renderFlowGraph(graph: FlowGraph): string {
    const lines: string[] = ['flowchart TD'];

    for (const flow of graph.flows) {
      // 入口点
      const entry = graph.entryPoints.find(e => e.flowId === flow.id);
      if (entry) {
        lines.push(`    Entry${flow.id}["${entry.type}: ${entry.path}"]`);
        lines.push(`    Entry${flow.id} --> ${flow.steps[0]?.id || 'Empty'}`);
      }

      // 步骤
      for (const step of flow.steps) {
        lines.push(`    ${step.id}["${step.name}"]`);
        for (const next of step.nextSteps) {
          lines.push(`    ${step.id} --> ${next}`);
        }
      }

      // 错误路径
      for (const errPath of flow.errorPaths) {
        lines.push(`    ${errPath.fromStep} -.->|error| Error${flow.id}["${errPath.handler}"]`);
      }
    }

    return lines.join('\n');
  }

  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}
```

---

## 5. CLI 集成

### 5.1 新增命令

```bash
# 生成完整的 Go Architecture Atlas
node dist/cli/index.js analyze -s ./src --lang go --atlas

# 只生成特定图
node dist/cli/index.js analyze -s ./src --lang go --atlas package
node dist/cli/index.js analyze -s ./src --lang go --atlas capability
node dist/cli/index.js analyze -s ./src --lang go --atlas goroutine
node dist/cli/index.js analyze -s ./src --lang go --atlas flow

# 生成所有图到单独文件
node dist/cli/index.js analyze -s ./src --lang go --atlas-all

# 输出格式
node dist/cli/index.js analyze -s ./src --lang go --atlas --format mermaid
node dist/cli/index.js analyze -s ./src --lang go --atlas --format json
```

### 5.2 配置文件支持

```json
{
  "source": "./src",
  "lang": "go",
  "atlas": {
    "enabled": true,
    "layers": ["package", "capability", "goroutine", "flow"],
    "output": {
      "package": "atlas/package-graph.mmd",
      "capability": "atlas/capability-graph.mmd",
      "goroutine": "atlas/goroutine-topology.mmd",
      "flow": "atlas/flow-graph.mmd"
    },
    "options": {
      "detectCycles": true,
      "detectDataRaces": false,
      "maxFlowDepth": 10
    }
  }
}
```

---

## 6. 实施路线图

### Phase 5: Package Graph (2-3 天)

**目标**: 实现静态包依赖图

**任务**:
- [ ] 实现 `PackageGraphBuilder`
- [ ] 解析 `go.mod` 获取模块信息
- [ ] AST 分析提取 import 关系
- [ ] 检测循环依赖
- [ ] Mermaid 渲染器

**验收标准**:
- 正确提取所有包依赖
- 检测到循环依赖并警告
- 生成的 Mermaid 图可渲染

### Phase 6: Capability Graph (3-4 天)

**目标**: 实现接口能力图

**任务**:
- [ ] 实现 `CapabilityGraphBuilder`
- [ ] 分析接口使用点 (字段、参数、返回值)
- [ ] 关联隐式实现关系
- [ ] 计算能力覆盖率
- [ ] Mermaid 渲染器

**验收标准**:
- 正确识别所有接口使用
- 准确关联实现关系
- 区分字段注入和参数注入

### Phase 7: Goroutine Topology (4-5 天)

**目标**: 实现 Goroutine 拓扑图

**任务**:
- [ ] 实现 `GoroutineTopologyBuilder`
- [ ] AST 模式匹配 `go func()`
- [ ] 识别 channel 创建和操作
- [ ] 构建 goroutine-channel 连接图
- [ ] 识别常见模式 (worker pool, fan-out/fan-in)
- [ ] Mermaid 渲染器

**验收标准**:
- 正确识别所有 goroutine 启动点
- 正确识别 channel 创建
- 正确构建通信拓扑
- 识别至少 3 种常见模式

### Phase 8: Flow Graph (5-7 天)

**目标**: 实现信息流图

**任务**:
- [ ] 实现 `FlowGraphBuilder`
- [ ] 识别 HTTP 入口点
- [ ] 识别 CLI 入口点
- [ ] 构建调用图 (call graph)
- [ ] 追踪 context 传播
- [ ] 分析错误返回路径
- [ ] Mermaid 渲染器

**验收标准**:
- 正确识别 HTTP 处理器
- 正确追踪至少 5 层调用深度
- 正确识别 context 传播路径
- 正确识别错误处理分支

### Phase 9: 集成与优化 (3-4 天)

**目标**: 完整 Atlas 集成

**任务**:
- [ ] CLI 命令集成
- [ ] 配置文件支持
- [ ] 性能优化
- [ ] 文档完善
- [ ] 测试覆盖

**验收标准**:
- 所有 CLI 命令正常工作
- 大型项目 (< 500 文件) < 10s
- 测试覆盖率 > 80%

---

## 7. 预期收益

### 7.1 技术收益

| 维度 | 当前 (Class Diagram) | 升级后 (Atlas) | 提升 |
|------|---------------------|----------------|------|
| **包依赖可见性** | 部分 | 100% | +200% |
| **接口使用追踪** | 无 | 100% | ∞ |
| **并发结构可见** | 无 | 100% | ∞ |
| **信息流追踪** | 无 | 80%+ | ∞ |
| **架构理解准确度** | 40-60% | 90%+ | +50% |

### 7.2 市场定位

```
目前市场:
- UML 工具 → OOP
- C4 → deployment
- tracing → runtime only

没有工具统一:
  static + coordination + flow

如果 ArchGuard 做到:
  👉 Automatic Coordination Extraction

它会自然成为:
  > Go + Agent + LLM 时代的架构显微镜
```

### 7.3 对 LLM 时代的重要性

LLM 最大问题：
> 它生成局部正确代码，但破坏全局协调。

OOP 世界还能靠类型系统限制。Go 世界不行。

因此 ArchGuard 在 Go 中的价值反而更高：

```
它成为:
  Human architectural perception layer

而不是:
  文档工具
```

---

## 8. 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| AST 模式匹配不完整 | 中 | 中 | 增加测试用例，迭代改进 |
| 大型项目性能问题 | 中 | 高 | 增量分析，缓存优化 |
| Flow 图复杂度爆炸 | 高 | 中 | 限制深度，提供过滤选项 |
| 用户学习成本 | 低 | 低 | 提供分层文档，渐进式采用 |

---

## 9. 附录

### 9.1 相关工具对比

| 工具 | Package Graph | Capability | Goroutine | Flow |
|------|---------------|------------|-----------|------|
| **goda** | ✅ | ❌ | ❌ | ❌ |
| **go-callvis** | ❌ | ❌ | ❌ | ✅ |
| **gops** | ❌ | ❌ | ✅ | ❌ |
| **ArchGuard (当前)** | 部分 | ❌ | ❌ | ❌ |
| **ArchGuard (Atlas)** | ✅ | ✅ | ✅ | ✅ |

### 9.2 参考资料

- [Go AST Package](https://pkg.go.dev/go/ast)
- [Go Concurrent Patterns](https://go.dev/blog/pipelines)
- [gopls Protocol](https://github.com/golang/tools/tree/master/gopls)
- [Channel Analysis Paper](https://arxiv.org/abs/2005.12891)

---

**文档状态**: ✅ 完成
**下一步**: Phase 5 实施计划
