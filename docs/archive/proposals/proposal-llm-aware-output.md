# Proposal: LLM-Aware Output — 查询格式自适应与粒度路由

**状态**: 草案  
**日期**: 2026-06-12  
**承接实验**: granularity-v2.2 (B4)、format-encoding-v1.1 (H1、H-dense)  
**涉及 ADR**: ADR-006（MCP Tool 设计规范）、ADR-007（CLI/MCP 接口一致性）

---

## 背景

两份预注册实验给出了相互印证的结论，指向同一个实施方向。

### 实验依据 1 — granularity-v2.2 B4

L4（紧凑 JSON）比 L3（method 级 Mermaid）在同等结构信息下高出 **38.4 个百分点**
（Wilcoxon p = 7.6×10⁻⁸，n=68 任务）。这是实验中效应最大的单一发现，且信息量等价——格式本身
决定了 LLM 能否有效消费架构上下文。

同一实验还发现任务类别是最优粒度的强预测因子（后验 P_oracle）：

| 任务类别 | 最优粒度 | 命中率分布 |
|---|---|---|
| A — 事实提取（"有哪些包"） | L1 package | 13/25 任务 |
| B — 关系推理（"谁依赖谁"） | L3 method | 18/22 任务 |
| C — 跨组件综合（"trace 路径"） | L3 method | 19/21 任务 |

域启发式（H₀：按任务类→粒度路由）命中率 54%，远高于 GIT 几何预测器（最好 19%）。
这说明**路由表可以硬编码**，不需要额外的模型推理。

### 实验依据 2 — format-encoding-v1.1

8 种格式的跨模型准确率（haiku + GLM reasoning OFF 合并）：

| 格式 | Haiku | GLM | 特点 |
|---|---|---|---|
| **json-edge-list** | **0.671** | **0.643** | 平坦结构，JSON 预训练熟悉 |
| custom-dsl | 0.643 | 0.514 | |
| markdown-table | 0.643 | 0.500 | |
| yaml | 0.629 | 0.486 | |
| nl-exhaustive | 0.600 | 0.557 | |
| json-adjacency | 0.586 | 0.643 | |
| haskell-adt | 0.571 | 0.500 | |
| **mermaid** | **0.286** | **0.357** | Class A 地板效应（haiku 0.040）|

Friedman H1 确认（haiku p=0.007，GLM p=0.079）。Mermaid 对 LLM 而言是最差格式，
尤其在拓扑类查询（Class A）上几乎完全失效。H-dense 跨两个模型的合并分析（W=0，p=1.00）
排除了"mermaid 差"是特定模型的特异性。

### 当前管道结构

代码检查（2026-06-12）确认管道为两阶段：

```
源代码
  │
  ▼ ParallelParser / language plugin
AST
  │
  ▼ ArchJsonProvider（in-memory）
ArchJSON（class 级，含 members[] 方法签名，无跨方法调用边）
  │
  ├──▶ ArchJSONAggregator → DiagramOutputRouter
  │         ├──▶ Mermaid → SVG/PNG（渲染路径，无 ArchJSON 写盘）
  │         └──▶ JSON（ArchJSON 直接写盘）
  │
  └──▶ persistQueryScopes()（analyze 完成后）
            ▼
        .archguard/query/<scope>/arch.json  ← MCP 工具读此文件
```

**Mermaid 从 ArchJSON 派生，不是直接从 AST 生成。** 这意味着：
- json-edge-list 序列化可以在同一 ArchJSON 基础上实现，无需改 parser
- 粒度路由可在 `OutputScopeFilter` 层实现，无需改 parser 或 diagram pipeline

### 当前 ArchJSON 的粒度限制

| 字段 | 现状 |
|---|---|
| `Entity.members[]` | ✅ 有方法名、参数类型、返回类型、修饰符 |
| `Relation`（class 间） | ✅ 有 inheritance / composition / dependency 等 |
| 方法→方法调用边 | ❌ 无（call graph 未提取） |
| Go 调用图 | ✅ Go Atlas `FlowGraph.CallEdge`（仅 Go）|

**关键约束**：当前"method 粒度"= 暴露 `members[]` 字段，不包含跨方法调用链。
实验 L3 的信息量（完整 call graph）当前 ArchJSON 尚未完整覆盖（见"不做的事"和后续 §）。

### 当前现状与问题

ArchGuard 的 MCP 工具通过 ArchJSON 传递架构上下文，已是正确方向；但：

1. **格式问题**：查询工具回应中夹带 Mermaid 片段；CLI `query` 命令未标准化为
   json-edge-list 结构，输出嵌套较深。
2. **粒度问题**：
   - `archguard_get_package_stats` 底层数据是 class 级 ArchJSON，传递了冗余细节
   - `archguard_get_dependencies` 等关系型工具返回 class 级，`members[]` 不暴露，
     LLM 拿不到方法签名层面的上下文
3. **缺少声明**：MCP 工具描述未告知 LLM 当前粒度，LLM 无法判断是否需要更细的上下文。

---

## 决策

### 决策 1 — 为所有查询输出引入 `--output-scope` / `outputScope` 参数

在 `QueryEngine` 层新增输出范围枚举：

```typescript
export type OutputScope = 'package' | 'class' | 'method';
```

所有 `QueryEngine` 方法接受可选的 `outputScope`，在返回结果时只保留该粒度所需的字段：

| `outputScope` | 保留字段 | 裁减字段 |
|---|---|---|
| `'package'` | 包名、包内文件数、包间关系 | 类成员、方法签名 |
| `'class'` | 实体名、类型、类间关系（当前默认） | `members[]` 字段 |
| `'method'` | 全部字段含 `members[]` 方法签名 | — |

> **注意**：`outputScope='method'` 当前暴露 `members[]`（方法签名、参数、返回类型），
> **不包含**跨方法调用边（call graph）。call graph 提取是独立的后续工作（见 §后续）。

**CLI 实现**：`query` 命令新增 `--output-scope <package|class|method>` flag，默认 `class`。

**MCP 实现**：所有查询工具 schema 新增可选参数
`outputScope: z.enum(['package', 'class', 'method']).default('class')`。

### 决策 2 — 为"供 LLM 消费"路径引入 json-edge-list 序列化

在 `QueryEngine` 层新增输出格式枚举：

```typescript
export type QueryOutputFormat = 'structured' | 'edge-list';
```

`'structured'`（默认）：维持当前 JSON 对象结构。  
`'edge-list'`：将实体和关系序列化为平坦的 json-edge-list 格式——
实体列表 + 边列表，避免深层嵌套，去除 Mermaid 片段。

**格式规范（基于代码检查 `experiments/format-encoding/renderers/json-edge-list.ts`）**：

```typescript
{
  entities: Array<{
    id: string;           // entity ID
    name: string;         // entity name
    type: string;         // entity type (class/interface/function/…)
    sourceFile: string;   // 来源文件，不可用时为 "unknown"
    methods: Array<{      // 仅当 outputScope='method' 时填充
      name: string;
      params: Array<{ name: string; type: string }>;
      returnType: string; // 不可用时为 "void"
    }>;
  }>;
  relations: Array<{
    from: string;         // entity ID
    to: string;           // entity ID
    type: string;         // RelationType
  }>;
}
```

> **注**：实验 `renderers/json-edge-list.ts` 使用的 schema 类型（`CEntity.methods`）对应
> ArchJSON 的 `Entity.members`（`type='method'` 的成员）。`EdgeListSerializer` 在
> `outputScope='class'`（默认）时 `methods` 字段输出空数组；`outputScope='method'` 时
> 填充方法签名。两层控制（scope + format）正交，可独立组合。

**CLI 实现**：`query` 命令新增 `--query-format <structured|edge-list>` flag，默认 `structured`。

**MCP 实现**：所有查询工具 schema 新增可选参数
`queryFormat: z.enum(['structured', 'edge-list']).default('structured')`，
工具描述注明：`edge-list format recommended for LLM reasoning (+38pp vs mermaid,
format-encoding experiment, n=14 tasks)`。

### 决策 3 — 按工具语义设置默认 outputScope（路由表硬编码）

根据 granularity 实验 P_oracle 路由表，为各 MCP 工具设置不同的默认 `outputScope`。

**工具清单核实（2026-06-12 代码检查）**：

`src/cli/mcp/mcp-server.ts` 中 `registerTools()` 注册了 **10 个**核心查询工具；
`src/cli/mcp/tools/git-history-tools.ts` 中 `registerGitHistoryTools()` 注册了 **4 个**
git 历史工具（`archguard_get_change_context`、`archguard_get_cochange`、
`archguard_get_change_risk`、`archguard_get_ownership`）。
另有 `archguard_get_atlas_layer`（Go 专属，不适用 outputScope 路由）和
`archguard_analyze`、`archguard_analyze_git`（写操作，不适用）。

> **注**：git 历史工具的输出来自 `.archguard/git-history/` 目录中的演化信号（churn、
> co-change、ownership、risk score），其数据源不是 ArchJSON，因此
> `outputScope`/`queryFormat` 参数不适用于这 4 个工具（见"遗留问题"）。

| 工具 | 任务类别 | 默认 `outputScope` | 依据 |
|---|---|---|---|
| `archguard_summary` | A — 概览 | `package` | L1 最优；class 级是噪声 |
| `archguard_get_package_stats` | A — 统计 | `package` | 同上 |
| `archguard_find_entity` | A/B — 查找 | `class` | 实体本身即 class 级 |
| `archguard_get_file_entities` | A — 查找 | `class` | 同上 |
| `archguard_get_dependencies` | B — 关系 | `method` | L3 最优（B 类 18/22）；暴露 members[] |
| `archguard_get_dependents` | B — 关系 | `method` | 同上 |
| `archguard_find_subclasses` | B — 关系 | `class` | 继承关系 class 级即完整 |
| `archguard_find_implementers` | B — 关系 | `class` | 同上 |
| `archguard_detect_cycles` | B — 关系 | `class` | 环路检测不需要方法签名 |
| `archguard_get_atlas_layer` | B/C — Go 专属 | 不适用 | 数据来自 Go Atlas 扩展，非 ArchJSON 主体 |
| `archguard_get_change_context` | C — 综合 | 不适用 | 数据来自 git 历史，非 ArchJSON |
| `archguard_get_cochange` | C — 综合 | 不适用 | 同上 |
| `archguard_get_change_risk` | C — 综合 | 不适用 | 同上 |
| `archguard_get_ownership` | C — 综合 | 不适用 | 同上 |

调用方可通过 `outputScope` 参数覆盖可用工具的默认值。
`outputScope` 和 `queryFormat` 只在返回 ArchJSON 派生内容的工具上实现（前 9 个）。

### 决策 4 — 工具描述内联粒度声明（ADR-006 合规）

根据 ADR-006 §2.3，每个受影响工具的描述补充当前粒度声明和限制：

```
archguard_get_dependencies:
  "Return direct and transitive class-level dependency graph with method
   signatures (outputScope=method by default); call graph edges (method→method
   calls) are not included — only class-level structural relations."

archguard_summary:
  "Return package-level architecture summary (L1 granularity); for
   method-level detail call archguard_get_dependencies."
```

### 决策 5 — 扩展 `archguard_summary` 暴露预计算聚合统计

#### 动机：地板效应的根因

format-encoding 实验揭示了一类特殊的"地板任务"——准确率在**所有 8 种格式和两个模型**上均为 0 或接近 0：

| 任务 | Ground truth | Haiku 均值 | GLM 均值 | 失败模式 |
|---|---|---|---|---|
| `entity-count` | 545 | **0.000** | **0.000** | 需枚举 545 实体 |
| `count-by-type` | 280 (dependency) | **0.000** | **0.000** | 需按类型枚举 355 条关系 |
| `relation-count` | 355 | 0.075 | 0.000 | 需枚举 355 条关系 |
| `subclasses` | 单个 entity id | 0.075 | 0.000 | 需扫全图找 inheritance |
| `direct-deps-0` | `['mermaid']`（npm 包） | 0.075 | 0.125 | 跨 class/package 层次找外部包 |

对照：**同样的 LLM** 在"拿到具名实体后数其方法数"（答案 = 5）上得 **1.000**。
差异不在 LLM 能力，在于：**局部查找 vs 全局枚举**。LLM 无法在 65K token 的格式化文本中
可靠地计数 545 个对象——这是认知负荷限制，而非智力限制。

#### 关键观察：`getSummary()` 已有部分答案

**代码检查（2026-06-12）**：`src/core/query/query-engine.ts:getSummary()` 当前完整返回签名：

```typescript
{
  entityCount: number;
  relationCount: number;
  language: string;
  kind: 'parsed' | 'derived';
  topDependedOn: Array<{ name: string; dependentCount: number }>;  // 字段名为 name
  topDependedOnNote?: string;
  capabilities: { classHierarchy: boolean; interfaceImplementation: boolean; packageGraph: boolean; cycleDetection: boolean };
  topPackages: PackageStatEntry[];
  totalPackageCount: number;
}
```

这意味着如果 LLM 被引导调用 `archguard_summary`，`entity-count`（0.000）和 `relation-count`
（0.075）任务可以立刻得满分——**工具已有数据，只是 LLM 不知道**。

`count-by-type`（0.000）差一步：`index.relationsByType` 按类型索引已存在
（`ArchIndex.relationsByType: Partial<Record<RelationType, [string, string][]>>`），
只需把 `{type → count}` 字典加进 `getSummary()` 返回值即可。

> **RelationType 约束**：生产代码 `RelationType`（`src/types/index.ts`）=
> `'inheritance' | 'implementation' | 'composition' | 'aggregation' | 'dependency' | 'association'`。
> 注意**不含** `'call'`（仅在实验 schema 中存在），故统计结果中不会出现 call 类型。

#### 决策：扩展 `getSummary()` 返回值

在 `QueryEngine.getSummary()` 中新增三个字段：

```typescript
interface SummaryResult {
  // 现有字段（保留不变，完整签名见上方）
  entityCount: number;
  relationCount: number;
  language: string;
  kind: 'parsed' | 'derived';
  topDependedOn: Array<{ name: string; dependentCount: number }>;  // name，非 entity
  topDependedOnNote?: string;
  capabilities: { classHierarchy: boolean; interfaceImplementation: boolean; packageGraph: boolean; cycleDetection: boolean };
  topPackages: PackageStatEntry[];  // PackageStatEntry，非 PackageStat
  totalPackageCount: number;

  // 新增字段
  relationCountByType: Partial<Record<RelationType, number>>;
  // 覆盖 count-by-type 地板任务（0.000 → 1.000 预期）

  topByMethodCount: Array<{ name: string; methodCount: number }>;
  // 字段名用 name（与 topDependedOn 一致）；top-10 按方法数降序
  // 覆盖 most-methods 任务（当前 0.425/0.275）

  topByOutDegree: Array<{ name: string; outDegree: number }>;
  // 字段名用 name；top-10 按出度降序；与 topDependedOn（入度）对称
  // 覆盖 highest-out-degree 任务（当前 0.875，仅 mermaid 失败）
}
```

**实现（全部在 `getSummary()` 内，纯内存操作）**：

```typescript
// relationCountByType — ArchIndex.relationsByType 是 Record<RelationType, [string,string][]>
const relationCountByType: Partial<Record<RelationType, number>> = {};
for (const [type, rels] of Object.entries(this.index.relationsByType)) {
  relationCountByType[type as RelationType] = rels.length;
}

// topByMethodCount — 含 constructor（与 getPackageStats methodCount 计算逻辑一致）
const topByMethodCount = this.archJson.entities
  .map(e => ({
    name: this.index.idToName[e.id] ?? e.id,
    methodCount: (e.members ?? []).filter(m => m.type === 'method' || m.type === 'constructor').length,
  }))
  .sort((a, b) => b.methodCount - a.methodCount)
  .slice(0, 10);

// topByOutDegree — index.dependencies 是 Record<string, string[]>（数组，用 .length）
const topByOutDegree = this.archJson.entities
  .map(e => ({
    name: this.index.idToName[e.id] ?? e.id,
    outDegree: (this.index.dependencies[e.id] ?? []).length,
  }))
  .sort((a, b) => b.outDegree - a.outDegree)
  .slice(0, 10);
```

> **草案勘误（已更正）**：
> 1. `topDependedOn` 的元素字段名是 `name`，原草案写成 `entity`，已修正。
> 2. `topByOutDegree` 原草案写 `index.dependencies[e.id]?.size`（Set API），
>    实际 `ArchIndex.dependencies` 是 `Record<string, string[]>`，应用 `.length`，已修正。
> 3. `topByMethodCount` 原草案仅过滤 `m.type === 'method'`，漏掉 `'constructor'`；
>    已与 `getPackageStats()` 中的计算逻辑对齐，加入 `'constructor'`。
> 4. 原草案 `topPackages: PackageStat[]` 类型错误，实际导出类型是 `PackageStatEntry[]`，已修正。

#### `archguard_summary` 工具描述更新（ADR-006 §2.3）

```
archguard_summary:
  "Return pre-computed architecture statistics: exact entity/relation counts
   (no graph enumeration needed), relation breakdown by type, top-N entities by
   in-degree / out-degree / method count.
   ALWAYS call this tool first for any counting or ranking query — do NOT attempt
   to enumerate or count items from other tool outputs."
```

这条描述明确了**优先调用语义**，将 LLM 从地板任务的枚举陷阱中引导出来。

#### `direct-deps-0` 的特殊情况

`direct-deps-0` 答案是外部 npm 包 `mermaid`（0.075 失败），不是 class 级关系。
这是 ArchJSON `externalDependencies` 字段，与上述统计扩展无关。
建议在 `archguard_get_package_stats` 的返回值中暴露 `externalDependencies` 列表——
作为独立的小增量，不纳入本决策 5，标记为后续待办。

---

## 实施规范

### 分层架构（遵循 ADR-007 §1）

```
CLI flag (--output-scope, --query-format)
MCP tool param (outputScope, queryFormat)
          ↓
    QueryEngine.{method}(options: { outputScope, queryFormat })   ← 唯一逻辑层
          ↓
    OutputScopeFilter.narrow(archJson, scope)     ← 新增：src/core/query/
    EdgeListSerializer.serialize(archJson)         ← 新增：src/core/query/
```

两个新模块均在 `src/core/query/` 下实现（对应路径别名 `@/core/query/`，见 CLAUDE.md），
不在接口层（`query.ts` 或 `mcp-server.ts`）内联任何业务逻辑。

**文件布局说明（重要）**：

项目中存在两个 `query-engine.ts`：
- `src/core/query/query-engine.ts` — 领域类的**规范位置**，含 `QueryEngine` 类实体
- `src/cli/query/query-engine.ts` — **向后兼容 re-export shim**，只做 re-export

所有新增逻辑（`OutputScope`、`QueryOutputFormat`、新方法参数、`getSummary()` 扩展）
均在 `src/core/query/query-engine.ts` 实现。

**shim 需同步更新**：`src/cli/query/query-engine.ts` 当前仅 re-export
`QueryEngine`、`EntitySummary`、`PackageStatEntry`、`PackageStatMeta`、`PackageStatsResult`、
`QueryEngineOptions`。Stage 82.1 新增类型后，shim 必须追加 re-export：
`OutputScope`、`QueryOutputFormat`、`QueryMethodOptions`、`EdgeListOutput`、
`EdgeListEntity`、`EdgeListRelation`。
这样 `src/cli/mcp/mcp-server.ts` 可以继续通过现有导入路径
`'../query/query-engine.js'`（即 shim）使用这些类型，无需修改导入路径。

### 接口对称性（遵循 ADR-007 §4）

| MCP 参数 | CLI flag |
|---|---|
| `outputScope` | `--output-scope <package\|class\|method>` |
| `queryFormat` | `--query-format <structured\|edge-list>` |

### 向后兼容

- 所有新参数均为可选，默认值维持当前行为（`outputScope: 'class'`，`queryFormat: 'structured'`）。
- `archguard_get_dependencies` 等关系型工具默认 `outputScope` 升为 `'method'`，
  是增量扩展（新增 `members[]` 字段），不删除任何现有字段。

### 与现有 `verbose` 参数的关系

`src/cli/mcp/mcp-server.ts` 中多个工具已存在 `verbose: boolean` 参数（`verboseParam`），
控制是否返回完整 Entity（含 `members[]`）还是 `EntitySummary`（不含 members）：

```typescript
// 现有行为
verbose=false → engine.toSummary(entity)  // 无 members
verbose=true  → entity（完整，含 members）
```

`outputScope='method'` 的语义与 `verbose=true` 部分重叠，但不完全等价：
- `verbose` 是工具级布尔开关，作用于实体列表的 members 字段
- `outputScope` 是跨工具的三级粒度控制，还影响 `'package'` 级的字段裁减

**实施决策**：两个参数独立共存，不合并。`outputScope='method'` 时隐式启用完整 entity
输出（等效于 `verbose=true`）；当用户显式传入 `verbose=false` 且 `outputScope='method'`
时，`outputScope` 优先（method scope 必须暴露 members[]）。现有 `verbose` 参数可在后续
逐步废弃。

### 测试要求（遵循 ADR-007 §3）

1. `OutputScopeFilter` 单元测试：三个 scope 级别的字段保留/裁减行为，
   含边界（空 members、无关系的 class）。
2. `EdgeListSerializer` 单元测试：序列化输出结构与 format-encoding 实验
   `renderers/json-edge-list.ts` 产物格式一致性断言（`{ entities, relations }` 顶层结构，
   entity 含 `id/name/type/sourceFile/methods[]`，relation 含 `from/to/type`）。
3. CLI/MCP 等价快照测试：同一 fixture + 同一 `outputScope` → 两侧产物字节级等价。
4. MCP 工具 schema 测试：`outputScope`、`queryFormat` 枚举合法值/非法值。
5. `getSummary()` 新字段测试：`relationCountByType` 覆盖已知关系类型；
   `topByMethodCount`/`topByOutDegree` 按降序排列，至多 10 条。

---

## 遗留问题（需在实施阶段决策）

### P1 — git 历史工具（4个）不支持 outputScope/queryFormat

`archguard_get_change_context`、`archguard_get_cochange`、`archguard_get_change_risk`、
`archguard_get_ownership` 的数据源是 `.archguard/git-history/` 演化信号（churn、
ownership、co-change），不是 ArchJSON。本提案两个参数对这 4 个工具无意义，
**不实施**，路由表中标注为"不适用"。

如需为这 4 个工具优化 LLM 消费格式，需单独立项（git 历史工具格式化独立 proposal）。

### P2 — `archguard_get_atlas_layer` 的 format 参数冲突

该工具已有自己的 `format: 'full' | 'adjacency'` 参数。`queryFormat='edge-list'` 与
`format='adjacency'` 语义重叠。实施时需明确：Atlas 工具**不添加** `queryFormat` 参数，
维持现有 `format` 参数，避免混淆。

### P3 — `externalDependencies` 暴露（direct-deps-0 地板任务）

实验中 `direct-deps-0` 答案是外部 npm 包 `mermaid`，需从 ArchJSON `externalDependencies`
字段暴露。这是独立增量，不在本提案范围内，建议作为 `archguard_get_package_stats` 的
后续小增量处理。

---

## 不做的事（本 Proposal 范围内）

- **不修改 Mermaid 渲染路径**：`analyze` 命令的可视化输出继续使用 Mermaid，不受影响。
- **不引入 LLM 推理选择粒度**：路由表硬编码，不依赖额外模型调用。
- **不实现 haskell-adt 或高嵌套格式**：H-dense W=0 p=1.00 已明确否定。
- **不提取 call graph**：跨方法调用边提取是独立工作，见下节。
- **不在本 proposal 内处理 `direct-deps-0` 地板任务**：该任务答案是外部 npm 包名，
  需从 `externalDependencies` 暴露；作为 `archguard_get_package_stats` 的增量，独立处理。

---

## 后续：call graph 提取（范围外，单独立项）

`outputScope='method'` 当前能暴露方法签名，但 granularity 实验 L3 的完整语义
（方法间调用边）需要 call graph 支持。当前仅 Go Atlas 有此能力。

TypeScript / Java / Python 的 call graph 提取是独立的后续 proposal，
与本提案解耦——本提案先交付"方法签名可见 + 格式优化"，call graph 作为
`outputScope='method'` 的增量增强，不阻塞本提案实施。

---

## 关联 ADR 与文档

- **ADR-007 §4**：实施时需将 `outputScope` / `queryFormat` 补充到接口对称性表格。
- **ADR-006 §2.3**：实施时逐条更新受影响工具描述（见决策 4）。
