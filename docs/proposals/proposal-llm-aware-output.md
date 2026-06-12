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

### 当前现状与问题

ArchGuard 的 MCP 工具通过 ArchJSON 传递架构上下文，已是正确方向；但：

1. **格式问题**：`archguard_analyze` / `archguard_get_dependencies` 等工具回应中夹带 Mermaid
   片段（summary 字段）；CLI `query` 命令默认输出 JSON 但未标准化为 json-edge-list 结构。
2. **粒度问题**：所有查询工具使用统一的 ArchJSON 粒度（class 级），
   - `archguard_get_package_stats` 回的是 package 级统计，但依赖的底层数据是 class 级 ArchJSON，
     传递了冗余细节；
   - `archguard_get_dependencies` / `archguard_find_callers` 等关系型工具返回 class 级数据，
     缺失 method 级调用链——而实验显示 B/C 类任务在 L3 method 级准确率最高。
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
| `'class'` | 实体名、类型、类间关系（当前默认） | 方法体、参数列表 |
| `'method'` | 全部字段含方法签名和调用链 | — |

**CLI 实现**：`query` 命令新增 `--output-scope <package|class|method>` flag，默认 `class`（维持向后兼容）。

**MCP 实现**：所有查询工具 schema 新增可选参数 `outputScope: z.enum(['package', 'class', 'method']).default('class')`。

### 决策 2 — 为"供 LLM 消费"路径引入 json-edge-list 序列化

在 `QueryEngine` 层新增输出格式枚举：

```typescript
export type QueryOutputFormat = 'structured' | 'edge-list';
```

`'structured'`（默认）：维持当前 JSON 对象结构。  
`'edge-list'`：将实体和关系序列化为 json-edge-list 格式（与 format-encoding 实验所用格式一致）——
平坦的边列表，避免深层嵌套，去除 Mermaid 片段。

**CLI 实现**：`query` 命令新增 `--query-format <structured|edge-list>` flag，默认 `structured`。

**MCP 实现**：所有查询工具 schema 新增可选参数 `queryFormat: z.enum(['structured', 'edge-list']).default('structured')`，
在工具描述中注明：`edge-list format is preferred for LLM reasoning tasks (format-encoding experiment confirms +38pp accuracy vs mermaid)`。

### 决策 3 — 按工具语义设置默认 outputScope（路由表硬编码）

根据 granularity 实验 P_oracle 路由表，为各 MCP 工具设置不同的默认 `outputScope`：

| 工具 | 任务类别 | 默认 `outputScope` | 依据 |
|---|---|---|---|
| `archguard_summary` | A — 概览 | `package` | L1 最优；class 级是噪声 |
| `archguard_get_package_stats` | A — 统计 | `package` | 同上 |
| `archguard_find_entity` | A — 查找 | `class` | 实体本身即 class 级 |
| `archguard_get_file_entities` | A — 查找 | `class` | 同上 |
| `archguard_get_dependencies` | B — 关系 | `method` | L3 最优（B 类 18/22）|
| `archguard_get_dependents` | B — 关系 | `method` | 同上 |
| `archguard_find_subclasses` | B — 关系 | `class` | 继承关系 class 级即完整 |
| `archguard_find_implementers` | B — 关系 | `class` | 同上 |
| `archguard_detect_cycles` | B — 关系 | `class` | 环路检测不需要方法签名 |
| `archguard_get_change_context` | C — 综合 | `method` | L3 最优（C 类 19/21）|
| `archguard_get_cochange` | C — 综合 | `method` | 同上 |
| `archguard_get_change_risk` | C — 综合 | `method` | 同上 |

调用方可通过 `outputScope` 参数覆盖默认值。

### 决策 4 — 工具描述内联粒度声明（ADR-006 合规）

根据 ADR-006 §2.3（局限性内联），每个受影响工具的描述需补充当前粒度声明，例如：

```
archguard_get_dependencies:
  "Return direct and transitive dependency graph at method granularity
   (L3); use outputScope='class' for a coarser class-level view."

archguard_summary:
  "Return package-level architecture summary (L1); call
   archguard_get_dependencies for method-level dependency detail."
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
    OutputScopeFilter.narrow(archJson, scope)     ← 新增独立模块
    EdgeListSerializer.serialize(archJson)         ← 新增独立模块
```

`OutputScopeFilter` 和 `EdgeListSerializer` 在 `src/core/query/` 下实现，
不在 CLI/MCP 接口层实现任何业务逻辑。

### 接口对称性（遵循 ADR-007 §4）

| MCP 参数 | CLI flag |
|---|---|
| `outputScope` | `--output-scope <scope>` |
| `queryFormat` | `--query-format <format>` |

两侧均调用 `QueryEngine` 同一方法，只做参数解析。

### 向后兼容

- 所有新参数均为可选，默认值与当前行为一致（`outputScope: 'class'`，`queryFormat: 'structured'`）。
- MCP 工具描述更新不影响现有调用方。
- 唯一行为变更：`archguard_get_dependencies` 等关系型工具默认 `outputScope` 从
  `class` 升为 `method`——这是主动提升，但属于工具输出的增量扩展，不删除现有字段。

### 测试要求（遵循 ADR-007 §3）

1. `OutputScopeFilter` 单元测试：每个 scope 级别的字段裁减行为，含边界（空实体列表、无方法签名的 class 级 ArchJSON）。
2. `EdgeListSerializer` 单元测试：序列化与 format-encoding 实验渲染器输出格式的一致性断言。
3. CLI/MCP 等价快照测试：同一 fixture + 同一 outputScope → CLI 与 MCP 产物字节级等价。
4. 新 MCP 工具 schema 测试：`outputScope`、`queryFormat` 的 `z.enum` 合法值和非法值拒绝。

---

## 不做的事

- **不修改 Mermaid 渲染路径**：`analyze` 命令的可视化输出（`.archguard/*.md`、`.archguard/*.svg`）
  继续使用 Mermaid，不受本提案影响。本提案只影响 `query` 命令和 MCP 查询工具。
- **不引入 LLM 推理来选择粒度**：路由表按任务类别硬编码，不依赖额外模型调用。
- **不实现 haskell-adt 或其他高嵌套格式**：实验已明确否定密集编码对 LLM 的优势（H-dense W=0 p=1.00 跨两模型）。

---

## 关联 ADR 与后续

- **ADR-007 §4**：本提案新增的 `outputScope` / `queryFormat` 需补充到接口对称性表格中。
- **ADR-006 §2.3**：受影响工具描述需在实施时逐条更新（见决策 4）。
- **后续候选**：`archguard_analyze` 增加 `granularity` 参数，在分析阶段选择写盘的 ArchJSON 粒度
  （当前每次分析写全量 class 级 ArchJSON，L1/L3 可按需派生）。
