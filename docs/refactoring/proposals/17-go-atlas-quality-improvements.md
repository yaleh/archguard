# Go Architecture Atlas 图表质量改进

**文档版本**: 1.1
**创建日期**: 2026-02-25
**修订日期**: 2026-02-25
**前置依赖**: 16-go-architecture-atlas.md（已完成实现）
**状态**: 提案（经严苛架构师评审，v1.1 修订）
**背景**: 基于对 codex-swarm 项目的真实分析（365 实体，85 关系），系统性评估四层架构图的输出质量

---

## 1. 执行摘要

Plan 16 的 Go Architecture Atlas 四层架构图已完成实现并成功运行。通过对 codex-swarm 项目的真实分析，发现了影响图表实用性的系统性问题：

| 层 | 节点 / 边 | 核心问题 | 实用性 |
|----|---------|---------|--------|
| Package | 38 / 236 | 测试包占 31.6%，外部依赖节点无定义 | ⭐⭐⭐⭐ |
| Capability | 365 / 16 | implements 关系为零，图极度稀疏 | ⭐⭐ |
| Goroutine | 117 / ~230 | 测试 goroutine 占 48%，节点名不可读 | ⭐⭐⭐ |
| Flow | 28 / 0 | 图类型选错，调用链完全缺失 | ⭐ |

本提案按优先级组织改进措施，总体目标是将四层图的平均实用性从 ⭐⭐.5 提升到 ⭐⭐⭐⭐。

---

## 2. 问题分析

### 2.1 根因分类

所有问题归纳为三类根因：

**根因 A：配置/过滤缺失**（四层普遍存在，修复收益高，难度低）
测试代码无差别混入所有层：
- Package 层：12/38 节点（31.6%）是 tests/ 包
- Goroutine 层：56/117 节点（48%）是 stress/integration 测试 goroutine，是导致 PNG 像素超限的直接原因
- Capability 层：大量 mockStore、mockAdapter 等测试 struct 占用节点
- Flow 层：6/28 entry point 来自 `*_test.go`

**根因 B：表达方式选择不当**（设计决策，影响图的可读性）
- Flow 层使用 `sequenceDiagram`，但 entry point 之间无消息流，退化为格式混乱的路由列表
- Goroutine 节点使用包路径+行号（`tests_stress_TestStress_ConcurrentSessionCreation_spawn_39`），而非函数名
- Package 层检测到循环依赖但不显示具体路径

**根因 C：数据提取能力不足**（需要深度实现，收益高，难度高）
- Capability 层：`rawData.implementations` 字段已有预留位置，但 `BehaviorAnalyzer` 的数据流未调用 `InterfaceMatcher`，导致 0 条 implements 边
- Capability 层：struct→struct 字段依赖的 `uses` 边提取已有基础代码，但仅覆盖接口类型字段，未覆盖 struct 类型字段
- Package 层：外部依赖有边无节点定义，Mermaid 隐式创建节点但样式丢失，导致图布局混乱
- Flow 层：`traceCallsFromEntry` 只查 `pkg.functions`，未查 `pkg.structs[i].methods`，导致方法形式的 handler 永远追踪不到调用链

### 2.2 codex-swarm 实测数据

```
architecture-package.mmd   : 281 行，38 包，236 边，4 个循环依赖
architecture-capability.mmd: 382 行，365 节点，16 边（0 条 implements）
architecture-goroutine.mmd : 304 行，117 goroutine，43 channel（PNG 生成失败）
architecture-flow.mmd      :  55 行，28 entry point，0 条调用链箭头
```

---

## 3. 改进方案

### 3.1 P0：全局测试代码过滤（影响四层，收益最高）

#### 问题
四层图全部被测试代码污染，降低信噪比，Goroutine 层因节点过多导致 PNG 像素超限。

#### 方案

**3.1.1 CLI 参数**

```bash
# 排除测试包和测试文件（四层统一生效）
node dist/cli/index.js analyze --lang go --atlas --atlas-no-tests

# 自定义排除模式（使用现有 --exclude 参数）
node dist/cli/index.js analyze --lang go --atlas \
  --exclude "**/tests/**" "**/testutil/**" "**/*_test.go"
```

**3.1.2 配置文件**

```json
{
  "diagrams": [{
    "name": "architecture",
    "sources": ["."],
    "language": "go",
    "languageSpecific": {
      "atlas": {
        "enabled": true,
        "excludeTests": true
      }
    }
  }]
}
```

**3.1.3 实现位置与正确层次**

修改入口是 `GoAtlasPlugin.generateAtlas()`，**通过调用参数扩展 `excludePatterns`**，而非修改 `GoPlugin.parseToRawData()` 内部的 glob 实现。`parseToRawData` 的 `excludePatterns` 参数已存在：

```typescript
// GoAtlasPlugin.generateAtlas() — 已有 excludePatterns 调用点，只需扩展
const rawData = await this.goPlugin.parseToRawData(rootPath, {
  workspaceRoot: rootPath,
  excludePatterns: [
    '**/vendor/**',
    '**/testdata/**',
    // 新增：按 excludeTests 选项追加
    ...(options.excludeTests
      ? ['**/*_test.go', '**/tests/**', '**/testutil/**']
      : []),
  ],
  extractBodies: options.functionBodyStrategy !== 'none',
  selectiveExtraction: options.functionBodyStrategy === 'selective',
});
```

由于过滤在文件级别（`parseToRawData` 阶段）已经排除了 `*_test.go` 来源的所有实体，各 Builder 层**不需要额外的节点过滤**。这是单一职责：一次过滤，全层生效。

同时，`AtlasConfig` 类型需补充字段：

```typescript
// src/plugins/golang/atlas/types.ts
export interface AtlasConfig {
  enabled: boolean;
  functionBodyStrategy?: 'none' | 'selective' | 'full';
  layers?: AtlasLayer[];
  excludeTests?: boolean;          // 新增
  entryPointTypes?: import('@/types/extensions.js').EntryPointType[];
  followIndirectCalls?: boolean;
}
```

#### 预期效果（codex-swarm）

| 层 | 过滤前 | 过滤后（预估） |
|----|--------|---------------|
| Package 节点 | 38 | ~26（减少 12 个测试包）|
| Goroutine 节点 | 117 | ~61（减少 56 个测试 goroutine）|
| Goroutine PNG | 失败（像素超限）| 成功 |
| Flow entry points | 28 | ~22（减少测试 handler）|
| Capability 节点 | 365 | ~300（减少 mock struct）|

---

### 3.2 P0：Flow 层改用 flowchart（表达方式重设计）

#### 问题

当前 `sequenceDiagram` 对 REST API 路由的表达完全不合适：每个 handler 是独立的 `Note over`，没有任何消息箭头，实质上是格式混乱的路由列表。

#### 方案：改用 `flowchart LR`，按服务分 subgraph

**目标格式**：

```
flowchart LR
  subgraph hub["Hub 服务 (pkg/hub)"]
    direction TB
    h1["/healthz\nhandleHealth"]
    h2["/v1/metrics\nhandleMetrics"]
    h3["/v1/sessions\nhandleSessions"]
    h4["/v1/tasks\nhandleTasksList"]
    h5["/v1/tasks:dispatch\nhandleTasksDispatch"]
  end

  subgraph catalog["Catalog 服务 (pkg/catalog)"]
    direction TB
    c1["GET /products\nListProducts"]
    c2["POST /products\nCreateProduct"]
    c3["GET /products/{id}\nGetProduct"]
  end
```

**节点标签降级策略**（HandleFunc 不携带 HTTP method 信息）：

`HandleFunc`/`Handle` 注册的 handler，`entry.type` 为 `http-handler`，无法确定 HTTP method。节点标签按以下规则降级：

```typescript
// mermaid-templates.ts
private static formatEntryLabel(entry: EntryPoint): string {
  const method = entry.type === 'http-handler'
    ? ''                   // HandleFunc 不带 method，省略
    : entry.type.replace('http-', '').toUpperCase() + ' ';
  const handler = entry.handler ? `\n${entry.handler}` : '';
  return `"${method}${entry.path}${handler}"`;
}
```

**实现位置**：`src/plugins/golang/atlas/renderers/mermaid-templates.ts` 的 `renderFlowGraph()`

**核心逻辑**：
1. 按 entry point 的 `location.file` 目录部分分组
2. 每组生成一个 subgraph，标签取目录最后两段
3. 节点标签：`"[METHOD] /path\nhandlerName"`（HandleFunc 省略 METHOD）
4. 有调用链时（`chain.calls.length > 0`），用箭头连接 handler → 被调函数

**调用链显示**（当有数据时）：

```
flowchart LR
  subgraph hub["Hub 服务"]
    h3["/v1/sessions\nhandleSessions"]
    h3 --> engine_CreateSession["engine.CreateSession"]
    engine_CreateSession --> store_Insert["store.Insert"]
  end
```

#### 向后兼容：`--atlas-flow-format` 完整集成路径

保留 `sequenceDiagram` 为可选格式。完整的数据流修改点：

```typescript
// 1. AtlasConfig 类型新增字段（atlas/types.ts）
export interface AtlasConfig {
  // ...
  flowFormat?: 'flowchart' | 'sequence';   // 新增，默认 'flowchart'
}

// 2. CLI 参数命名（与现有 --atlas-* 参数族对齐）
// diagram-processor.ts 或 cli/commands/analyze.ts
program.option('--atlas-flow-format <format>', 'Flow layer format: flowchart|sequence', 'flowchart');

// 3. 传递到 AtlasConfig
const atlasConfig: AtlasConfig = {
  ...existingConfig,
  flowFormat: options.atlasFlowFormat ?? 'flowchart',
};

// 4. MermaidTemplates.renderFlowGraph() 接受 format 参数
static renderFlowGraph(graph: FlowGraph, format: 'flowchart' | 'sequence' = 'flowchart'): string {
  if (format === 'sequence') return this.renderFlowGraphAsSequence(graph);
  return this.renderFlowGraphAsFlowchart(graph);
}
```

---

### 3.3 P1：Flow 层 handler 方法追踪修复（比跨包追踪更紧迫）

#### 问题

`traceCallsFromEntry` 只查 `pkg.functions`，而大多数项目中 handler 是 struct 的方法（如 `s.handleSessions`），位于 `pkg.structs[i].methods`，**永远找不到**：

```typescript
// 当前代码 —— 遗漏 struct methods
for (const pkg of rawData.packages) {
  for (const func of pkg.functions) {         // ← 只查 standalone functions
    if (func.name !== handlerFnName) continue;
    ...
  }
  // ← pkg.structs[i].methods 完全未查
}
```

这是 Flow callchain 完全为零的直接原因之一，比"跨包追踪"更基础，优先级应为 **P1**（而非原 P2）。

#### 方案

```typescript
// flow-graph-builder.ts
private traceCallsFromEntry(rawData: GoRawData, entry: EntryPoint): CallEdge[] {
  const calls: CallEdge[] = [];
  if (!entry.handler) return calls;

  const handlerFnName = entry.handler.split('.').at(-1) ?? entry.handler;

  for (const pkg of rawData.packages) {
    // 查 standalone functions
    for (const func of pkg.functions) {
      if (func.name !== handlerFnName || !func.body) continue;
      calls.push(...this.extractCallEdges(func.body.calls, entry.handler));
    }

    // 新增：查 struct methods
    for (const struct of pkg.structs) {
      for (const method of struct.methods) {
        if (method.name !== handlerFnName || !method.body) continue;
        calls.push(...this.extractCallEdges(method.body.calls, entry.handler));
      }
    }
  }

  return calls;
}
```

---

### 3.4 P1：Goroutine 节点命名改进

#### 问题

当前节点 ID 使用包路径 + spawn 序号（原始格式，点分隔）：
```
pkg/hub.Server.run.spawn-42
```
经 `sanitizeId()` 转换后在 Mermaid 中渲染为：
```
pkg_hub_Server_run_spawn_42[""]:::spawned
```
函数名为空，ID 不可读。

#### 方案

**节点 ID 的原始格式为**（`goroutine-topology-builder.ts`）：
```typescript
id: `${pkg.fullName}.${parentName}.spawn-${spawn.location.startLine}`
// 例: "pkg/hub.Server.run.spawn-42"
```

分隔符是 **`.`**（点），`spawn` 前缀是 **`.spawn-`**（点+连字符）。正确的提取逻辑：

```typescript
// mermaid-templates.ts 或 goroutine-topology-builder.ts
private static formatGoroutineName(node: GoroutineNode): string {
  if (node.name) return node.name;

  // 原始 id: "pkg/hub.Server.run.spawn-42"
  // 去掉 ".spawn-NNN" 后缀
  const withoutSpawn = node.id.replace(/\.spawn-\d+$/, '');
  // 按 "." 分割，取最后两段（近似 Receiver.method）
  const parts = withoutSpawn.split('.');
  return parts.slice(-2).join('.');  // → "Server.run"
}
```

同时限制 `sanitizeId` 输出长度（Mermaid 对超长 ID 有渲染问题）：

```typescript
private static sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
}
```

注意：`slice(0, 64)` 保留前缀（包含包名），比 `slice(-64)` 保留尾部更利于可读性，但实际取哪端需根据测试结果确定。

---

### 3.5 P1：Package 层改进

#### 3.5.1 边去重

`MermaidTemplates.renderPackageGraph()` **已预留** `strength > 1` 的标签支持：
```typescript
// 已有代码，无需修改
const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
```

只需修改 **`package-graph-builder.ts`** 的 `buildEdges()`，用 `Map` 去重并累加 `strength`：

```typescript
private buildEdges(rawData: GoRawData): PackageDependency[] {
  // key: "from→to"，value: 引用次数
  const edgeMap = new Map<string, { from: string; to: string; count: number }>();

  for (const pkg of rawData.packages) {
    const fromId = pkg.fullName ? `${rawData.moduleName}/${pkg.fullName}` : pkg.name;
    for (const imp of pkg.imports) {
      if (this.goModResolver.classifyImport(imp.path) === 'std') continue;
      const key = `${fromId}→${imp.path}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        edgeMap.set(key, { from: fromId, to: imp.path, count: 1 });
      }
    }
  }

  return [...edgeMap.values()].map(({ from, to, count }) => ({
    from, to, strength: count,
  }));
}
```

#### 3.5.2 外部依赖节点定义（修正"完全不显示"的误判）

**实际情况**：`buildEdges()` 会为 external import 生成边（`to: imp.path`），但 `buildNodes()` 只处理 `rawData.packages`（internal 包），导致外部依赖**有边无节点**。Mermaid 会隐式创建这些节点但样式丢失，图布局混乱。

改进方向（P2 可考虑）：为 external 依赖按模块域聚合成一个分组节点：
```
github_com_google_uuid["github.com/google\n(external)"]:::external
```
而不是为每个 import path 创建独立节点。

#### 3.5.3 循环依赖路径显示

当前 cycles 注释只显示包列表：
```
%% warning: pkg/hub → pkg/hub
```

改进为显示完整成环链（`PackageCycle.packages` 已包含路径数组）：
```
%% cycle[warning]: pkg/hub → pkg/hub/engine → pkg/hub
```

实现：`renderPackageGraph()` 中 `cycle.packages.join(' → ')` 已经是完整路径，只需调整注释格式为 `cycle[severity]:` 前缀。

---

### 3.6 P2：Capability 层 Go 隐式接口检测

#### 问题根因（精确定位）

`CapabilityGraphBuilder.buildEdges()` **已有** `rawData.implementations` 的读取逻辑：

```typescript
// 已有代码
if (rawData.implementations) {
  for (const impl of rawData.implementations) {
    edges.push({ ...type: 'implements'... });
  }
}
```

问题是：**`rawData.implementations` 从未被填充**。`GoAtlasPlugin.generateAtlas()` 调用 `goPlugin.parseToRawData()` 后直接传入 builders，而 `parseToRawData` 没有运行 `InterfaceMatcher`。这是 `BehaviorAnalyzer` 层的 **missing wiring**，不是架构缺陷。

#### 方案：在 BehaviorAnalyzer 中完成数据连接

```typescript
// behavior-analyzer.ts — buildCapabilityGraph() 调用前填充 implementations
async buildCapabilityGraph(rawData: GoRawData): Promise<CapabilityGraph> {
  // 若尚未由 GoPlugin 填充，在此运行 InterfaceMatcher（不需要 gopls）
  if (!rawData.implementations) {
    const matcher = new InterfaceMatcher();
    const allStructs = rawData.packages.flatMap(p => p.structs);
    const allInterfaces = rawData.packages.flatMap(p => p.interfaces);
    // matchImplicitImplementations 不需要 gopls，仅基于方法名匹配
    (rawData as GoRawData & { implementations: InferredImplementation[] }).implementations =
      matcher.matchImplicitImplementations(allStructs, allInterfaces);
  }

  return this.capabilityGraphBuilder.build(rawData);
}
```

> **注意**：`matchImplicitImplementations(structs, interfaces)` 是正确的 API，`InterfaceMatcher` 不存在 `findImplementations(rawData)` 方法。

**全限定名匹配**：`matchImplicitImplementations` 当前按名称匹配，跨包可能出现同名接口误匹配。应优先使用 `matchImplicitImplementationsWithEmbedding` 并传入 `structMap`，保留 `packageId` 进行全限定名校验。

**预期结果**（codex-swarm）：
- 当前：0 条 implements 边
- 改进后：预计 15-30 条（基于 24 个接口 × 平均 1-2 个实现者，扣除同名误匹配）

#### 3.6.1 struct 字段依赖扩展（已有基础代码）

`CapabilityGraphBuilder.buildEdges()` **已有**接口类型字段的 uses 提取：

```typescript
// 已有代码
const allInterfaceNames = new Set(rawData.packages.flatMap(p => p.interfaces.map(i => i.name)));
for (const field of struct.fields) {
  if (allInterfaceNames.has(field.type)) {  // ← 只匹配接口类型
    edges.push({ ...type: 'uses'... });
  }
}
```

改进：将 `allInterfaceNames` 扩展为 `allKnownTypeNames`（接口 + struct 均纳入），从而提取 struct 对其他 struct 的字段依赖：

```typescript
// buildEdges() 改动：用 allKnownTypeNames 替换 allInterfaceNames
const allKnownTypeNames = new Set([
  ...rawData.packages.flatMap(p => p.interfaces.map(i => i.name)),
  ...rawData.packages.flatMap(p => p.structs.map(s => s.name)),
]);
```

这是一行改动，不是新功能。**预期效果**：uses 边从 16 条增加到 80-120 条，图密度从 0.012% 提升到 ~0.1%。

---

### 3.7 P2：Flow 层多层调用链追踪

#### 问题

在修复 §3.3（struct methods 追踪）之后，单层调用链应已可用。P2 目标是支持多层递归追踪。

#### 方案

**深度参数**：`--atlas-flow-depth N`（默认 2），配置路径同 `flowFormat`。

```typescript
// flow-graph-builder.ts
private traceCallsFromEntry(
  rawData: GoRawData,
  entry: EntryPoint,
  maxDepth: number = 2
): CallEdge[] {
  if (!entry.handler) return [];
  const handlerFnName = entry.handler.split('.').at(-1) ?? entry.handler;
  return this.traceRecursive(rawData, handlerFnName, entry.handler, maxDepth, new Set());
}

private traceRecursive(
  rawData: GoRawData,
  fnName: string,
  displayName: string,
  depth: number,
  visited: Set<string>
): CallEdge[] {
  if (depth === 0 || visited.has(fnName)) return [];
  visited.add(fnName);

  const edges: CallEdge[] = [];
  for (const pkg of rawData.packages) {
    // 查 functions 和 methods（与 §3.3 一致）
    const bodies = [
      ...pkg.functions.filter(f => f.name === fnName).map(f => f.body),
      ...pkg.structs.flatMap(s => s.methods.filter(m => m.name === fnName).map(m => m.body)),
    ].filter(Boolean);

    for (const body of bodies) {
      for (const call of body!.calls) {
        const toName = call.packageName
          ? `${call.packageName}.${call.functionName}`
          : call.functionName;
        edges.push({ from: displayName, to: toName, type: 'direct', confidence: 0.7 });
        // 递归追踪
        edges.push(...this.traceRecursive(rawData, call.functionName, toName, depth - 1, visited));
      }
    }
  }

  return edges;
}
```

---

## 4. 实施计划

### 4.1 Phase 1：快速改进（P0，1 周内）

| 工作项 | 修改文件 | 估时 | 收益 |
|--------|----------|------|------|
| `AtlasConfig` 添加 `excludeTests` + CLI `--atlas-no-tests` | `atlas/types.ts`, `analyze.ts` | 2h | 配置入口 |
| `generateAtlas()` 扩展 `excludePatterns` | `atlas/index.ts` | 1h | 四层噪音减半，PNG 不再失败 |
| Flow 层改用 `flowchart LR` + subgraph | `mermaid-templates.ts` | 6h | Flow 图变得可读 |
| `AtlasConfig` 添加 `flowFormat` + CLI `--atlas-flow-format` | `atlas/types.ts`, `analyze.ts` | 2h | 向后兼容 |

### 4.2 Phase 2：中等改进（P1，2 周内）

| 工作项 | 修改文件 | 估时 | 收益 |
|--------|----------|------|------|
| `traceCallsFromEntry` 补充 struct methods 查找 | `flow-graph-builder.ts` | 3h | callchain 不再为零 |
| Goroutine 节点命名（`.spawn-` 正确分割） | `mermaid-templates.ts` | 3h | 节点可读 |
| Package 边去重（`Map` 统计 strength） | `package-graph-builder.ts` | 2h | 模板侧已预留，只改 Builder |
| Package 循环路径注释格式 | `mermaid-templates.ts` | 1h | 循环可定位 |
| `sanitizeId` 限制长度 64 字符 | `mermaid-templates.ts` | 1h | 避免 Mermaid 渲染问题 |

### 4.3 Phase 3：深度改进（P2，4 周内）

| 工作项 | 修改文件 | 估时 | 收益 |
|--------|----------|------|------|
| Capability: BehaviorAnalyzer 中填充 `implementations` | `behavior-analyzer.ts` | 4h | 接口关系可见 |
| Capability: `allKnownTypeNames` 扩展 uses 边 | `capability-graph-builder.ts` | 2h | 图密度提升 5-8x |
| Flow: 多层递归调用链追踪 + `--atlas-flow-depth` | `flow-graph-builder.ts`, `atlas/types.ts` | 1d | 业务流程可见 |
| Package: external 依赖按模块域聚合节点 | `package-graph-builder.ts`, `mermaid-templates.ts` | 1d | 布局不再混乱 |

---

## 5. 测试策略

每项改进遵循 TDD。所有验收测试基于 **fixture 项目**（`tests/fixtures/go/`），不依赖外部项目（codex-swarm），确保在 CI 中可重复执行。

**Phase 1 测试重点**：
- fixture：含 `*_test.go` 的 Go 项目，断言过滤后节点数减少到预期范围
- fixture：含 `HandleFunc`/`router.GET` 的项目，断言 Flow 输出以 `flowchart LR` 开头
- fixture：多包项目，断言 subgraph 数量等于包目录数
- Flow 节点标签：`HandleFunc` 注册的 handler 标签不含 METHOD 前缀（降级策略）

**Phase 2 测试重点**：
- `formatGoroutineName("pkg/hub.Server.run.spawn-42")` → `"Server.run"`（单元测试）
- `formatGoroutineName("pkg/hub.run.spawn-1")` → `"hub.run"`（单元测试）
- fixture：含方法 handler 的项目（`s.handleSessions`），断言 callchain 非空
- fixture：同一对包有 3 个 import，断言 edges 只有 1 条，`strength = 3`

**Phase 3 测试重点**：
- fixture：`Store` interface + `InMemoryStore` struct（实现该接口），断言 implements 边 ≥ 1
- fixture：`Server` struct 含 `Store` 字段（struct 类型），断言 uses 边存在（extends 现有接口字段测试）
- Flow 多层追踪：fixture handler 调用 `service.Create()`，`service.Create()` 调用 `store.Insert()`，断言深度 2 时有 2 条 callchain 边

---

## 6. 验收标准

所有标准均基于 fixture 项目，在 CI 中自动化验证。

### Phase 1 完成标准
- [ ] fixture `exclude-tests`：过滤后 Package 层无 `_test` 后缀节点
- [ ] fixture `exclude-tests`：Goroutine 层节点数 < 未过滤时的 60%
- [ ] fixture `flow-basic`：Flow 图为 `flowchart LR` 格式，`subgraph` 数量 ≥ 1
- [ ] fixture `flow-basic`：`HandleFunc` handler 节点标签不含 `GET`/`POST` 等 METHOD 前缀
- [ ] fixture `flow-basic`：Flow 图可被 Mermaid 解析（通过 `isomorphic-mermaid` 的 `parse()` 验证）

### Phase 2 完成标准
- [ ] `formatGoroutineName` 单元测试：5 种 ID 格式均返回可读名称（无 `spawn_` 后缀）
- [ ] fixture `method-handler`：含方法 handler 的项目生成非空 callchain
- [ ] fixture `package-multi-import`：多 import 场景下 Package 层无重复边，`strength > 1`
- [ ] 循环依赖注释格式包含 `cycle[severity]:` 前缀

### Phase 3 完成标准
- [ ] fixture `interface-impl`：`implements` 边数 ≥ 接口数（fixture 保证每个接口有一个实现者）
- [ ] fixture `struct-deps`：struct 字段为另一 struct 时，`uses` 边被生成
- [ ] fixture `call-depth`：深度 2 追踪时 callchain 包含两层 CallEdge

---

## 7. 风险评估

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| `--atlas-no-tests` 过滤误删业务代码 | 低 | 中 | 仅过滤 `*_test.go` 文件，不过滤 `testutil` 等辅助包；默认关闭 |
| Flow flowchart 在路由过多时过宽 | 中 | 低 | `--atlas-flow-format sequence` 可退回旧格式；subgraph 限制节点数 |
| `matchImplicitImplementations` 跨包同名误匹配 | 中 | 中 | 以 `structPackageId + structName` 作为全限定 key 去重；接受一定假阳性 |
| struct 字段 uses 边爆炸（大型项目数百 struct） | 高 | 中 | 默认只提取 exported 字段；添加 `--capability-max-edges N`（默认 500）截断 |
| Goroutine sanitizeId 截断导致 ID 碰撞 | 低 | 低 | 截断前先检查唯一性，碰撞时追加行号后缀 |

---

## 8. 关联文档

- [16-go-architecture-atlas.md](./16-go-architecture-atlas.md)：Atlas 系统的原始设计和实现
- [15-golang-support-proposal.md](./15-golang-support-proposal.md)：Go 插件基础（Phase 0-4）
- [03-multi-language-support.md](./03-multi-language-support.md)：语言插件架构

---

## 9. 附录 A：v1.0 → v1.1 修订记录

基于严苛架构师评审，修正以下问题：

| 章节 | v1.0 错误 | v1.1 修正 |
|------|----------|----------|
| §3.5 InterfaceMatcher | 引用不存在的 `findImplementations(rawData)` | 修正为 `matchImplicitImplementations(structs, interfaces)` |
| §3.5 根因 | 未解释 `rawData.implementations` 为何为空 | 定位到 BehaviorAnalyzer missing wiring，说明修改入口 |
| §3.3 Goroutine 正则 | `/_spawn_\d+$/` + `split('_')` 对原始 ID 格式失效 | 修正为 `/\.spawn-\d+$/` + `split('.')` |
| §3.1.3 实现层次 | 描述修改 `parseToRawData` 内部 glob | 修正为修改 `generateAtlas()` 的 `excludePatterns` 调用参数 |
| §3.5.1 struct 字段提取 | 描述为新功能，误导读者从零实现 | 说明现有代码范围（接口类型字段），明确扩展点（加入 struct 类型） |
| §3.6（原） | traceCallsFromEntry 方法追踪列为 P2 | 提升为 P1（§3.3），因其比跨包追踪更基础 |
| §3.4.1 边去重 | 未提及模板侧已预留 `strength` 支持 | 说明模板无需改动，只改 Builder |
| 外部依赖描述 | "外部依赖完全不显示" | 修正为"有边无节点定义，Mermaid 隐式创建节点导致布局混乱" |
| §3.2 向后兼容 | 仅提及参数名，无类型定义和数据流 | 补充完整集成路径（AtlasConfig → CLI → renderFlowGraph 参数）|
| §6 验收标准 | 依赖 codex-swarm 外部项目，不可在 CI 自动化 | 改为基于 fixture 项目，所有标准可 CI 自动化 |

---

## 10. 附录 B：问题-方案映射

| 用户观察 | 精确根因 | 本文方案 | 优先级 |
|----------|---------|---------|--------|
| Capability 连接极稀疏 | BehaviorAnalyzer 未调用 InterfaceMatcher；uses 只提取接口字段 | §3.6 + §3.6.1 | P2 |
| Flow 图未表现业务处理过程 | sequenceDiagram 无 callchain；methods handler 追踪缺失 | §3.2 + §3.3 | P0 + P1 |
| Goroutine 包含大量测试路由 + PNG 失败 | excludePatterns 未排除 `*_test.go` | §3.1 | P0 |
| Package 包含大量测试包 + 布局混乱 | 无测试过滤；external 依赖无节点定义 | §3.1 + §3.5 | P0 + P1/P2 |
