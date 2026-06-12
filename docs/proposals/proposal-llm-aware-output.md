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
实体列表 + 边列表，避免深层嵌套，去除 Mermaid 片段。格式与 format-encoding 实验
所用渲染器 `renderers/json-edge-list.ts` 一致。

**CLI 实现**：`query` 命令新增 `--query-format <structured|edge-list>` flag，默认 `structured`。

**MCP 实现**：所有查询工具 schema 新增可选参数
`queryFormat: z.enum(['structured', 'edge-list']).default('structured')`，
工具描述注明：`edge-list format recommended for LLM reasoning (+38pp vs mermaid,
format-encoding experiment, n=14 tasks)`。

### 决策 3 — 按工具语义设置默认 outputScope（路由表硬编码）

根据 granularity 实验 P_oracle 路由表，为各 MCP 工具设置不同的默认 `outputScope`：

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
| `archguard_get_change_context` | C — 综合 | `method` | L3 最优（C 类 19/21）；暴露 members[] |
| `archguard_get_cochange` | C — 综合 | `method` | 同上 |
| `archguard_get_change_risk` | C — 综合 | `method` | 同上 |

调用方可通过 `outputScope` 参数覆盖默认值。

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

两个新模块均在 `src/core/query/` 下实现，不在接口层（`query.ts` 或 `mcp-server.ts`）
内联任何业务逻辑。

### 接口对称性（遵循 ADR-007 §4）

| MCP 参数 | CLI flag |
|---|---|
| `outputScope` | `--output-scope <package\|class\|method>` |
| `queryFormat` | `--query-format <structured\|edge-list>` |

### 向后兼容

- 所有新参数均为可选，默认值维持当前行为（`outputScope: 'class'`，`queryFormat: 'structured'`）。
- `archguard_get_dependencies` 等关系型工具默认 `outputScope` 升为 `'method'`，
  是增量扩展（新增 `members[]` 字段），不删除任何现有字段。

### 测试要求（遵循 ADR-007 §3）

1. `OutputScopeFilter` 单元测试：三个 scope 级别的字段保留/裁减行为，
   含边界（空 members、无关系的 class）。
2. `EdgeListSerializer` 单元测试：序列化输出结构与 format-encoding 实验
   `renderers/json-edge-list.ts` 产物格式一致性断言。
3. CLI/MCP 等价快照测试：同一 fixture + 同一 `outputScope` → 两侧产物字节级等价。
4. MCP 工具 schema 测试：`outputScope`、`queryFormat` 枚举合法值/非法值。

---

## 不做的事（本 Proposal 范围内）

- **不修改 Mermaid 渲染路径**：`analyze` 命令的可视化输出继续使用 Mermaid，不受影响。
- **不引入 LLM 推理选择粒度**：路由表硬编码，不依赖额外模型调用。
- **不实现 haskell-adt 或高嵌套格式**：H-dense W=0 p=1.00 已明确否定。
- **不提取 call graph**：跨方法调用边提取是独立工作，见下节。

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
