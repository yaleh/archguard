# Proposal: GIM 方法论集成 — MetricVector 解释层与 LLM 开发工具支持

**状态**: Draft (reviewed 2026-03-31)
**日期**: 2026-03-31
**关联**: proposal-architecture-metrics-observatory.md、proposal-coverage-fisher-information.md、proposal-llm-semantic-exploration.md
**起源**: A/B/C 实验（`docs/experiments/git-methodology-ab-test.md`）验证了 GIM（Geometric Information Methodology）作为 LLM 开发工具 system prompt 方法论的区分度，尤其在 metrics-only 约束下。本提案将 GIM 的核心概念集成到 ArchGuard 的分析输出与 MCP 工具链中。

---

## 审查记录

> **2026-03-31 架构审查**：对原始 Draft 进行了全面审查，发现以下重大问题并已在文档中修正：
>
> **CRITICAL-1: 节律检测器的 snapshot 数据严重不足**。原方案声称"至少 3 个快照"即可进行趋势检测，但变化点检测文献一致表明，即使最简单的 CUSUM/滑动窗口方法也需要 10+ 数据点才能区分趋势与噪声。3 个快照实质上只有 2 个 delta，无法判断趋势。已将方案降级为"两点对比 + 方向提示"，并明确标注不是趋势检测。
>
> **CRITICAL-2: GimLossRule 与 rule-evaluator 的架构不兼容**。原方案的 `ℒ_S`（稳定性）需要多个快照的方差，但 `evaluateAllRules()` 的签名是 `(rules, vector, relations)` — 只接收单个 MetricVector，无法计算跨快照方差。已将 ℒ_S 从 fitness rule 中移除，改为仅在节律报告中展示。
>
> **SIGNIFICANT-1: MCP 工具数量过度设计**。3 个独立 GIM 工具（rhythm、losses、pillarization）对于一个方法论解释层来说过多。pillarization 工具的数据源尤其薄弱（FIM selfInfo 是测试覆盖的自信息，与"支柱化就绪度"无直接关系）。已合并为 1 个工具。
>
> **SIGNIFICANT-2: config-loader.ts 的 Zod schema 未覆盖**。原方案仅修改 `rule-types.ts` 但忽略了 `config-loader.ts` 中独立的 Zod validation schema（第 197-220 行），需同步更新。

---

## 背景与动机

### GIM 方法论概述

GIM（Geometric Information Methodology，原名 GIT/Geometric Information Theory）是一套用于软件系统演进分析的方法论框架。其核心概念包括：

| 概念 | 公式/描述 | 工程含义 |
|------|-----------|----------|
| MDL 分解 | L(X) = L(G) + L(R\|G) | 总描述长度 = 共享抽象 + 残差；好的架构最小化 L(X) |
| 扩张-收缩节律 | expansion / contraction cycle | 系统在添加能力（扩张）和提取抽象/压缩（收缩）间交替 |
| 支柱化 | Pillarization | 局部用确定性代码替代 ML 模型调用 |
| 晶体化 | Crystallization | 系统演化为代码框架 + ML 能力的混合体 |
| 五级收敛谱系 | Prompt → Agent → Workflow → Model → DSL → Compiled Code | 能力从高灵活/低确定逐步固化 |
| 五个损失函数 | ℒ_T, ℒ_C, ℒ_D, ℒ_G, ℒ_S | 可行性、一致性、描述长度、生成对齐、稳定性 |

**重要说明**：GIM 是一套方法论框架，不是经过实证验证的精确理论。其价值在于为 LLM 提供结构化的推理词汇表，而非产生可量化的精确度量。实现应保持简单，避免给代理近似赋予虚假的精确性。MDL 的精确计算需要完整的信息论编码方案（参见 [Grunwald 2007 MDL Tutorial](https://homepages.cwi.nl/~paulv/course-kc/mdlintro.pdf)），远超本工具的范围。

参考文档：
- `docs/references/GIT_Analysis_for_ArchGuard.md` — GIT 框架对 ArchGuard 的指导分析
- `docs/references/GIT_Software_Dev_Future.md` — GIT 完整理论
- `docs/references/GIT_complete_framework_with_metalayers.md` — 元层扩展

### A/B/C 实验结果

`docs/experiments/git-methodology-ab-test.md` 记录了三组独立 Task Agent 的对照实验。输入完全相同（MetricVector、git log、fileStats、目录结构），仅 system prompt 不同。

**关键发现**：

| 维度 | Group A (GIM) | Group B (Simple Rules) | Group C (No Framework) |
|------|---------------|----------------------|----------------------|
| 提案区分度 | 唯一提出 tree-sitter bridge 支柱化 | 阈值匹配建议 | 与 B 高度重叠 |
| 分析深度 | 通过 ℒ_G 识别跨层级演进方向 | 单指标驱动 | 表面级改进 |
| 节律判断 | 识别当前处于扩张末期 | 无节律概念 | 无节律概念 |

实验同时揭示了 GIM 的局限：

1. **MetricVector 有效维度低**：14 维向量在单项目轨迹上实质降维到 ~2 个独立维度（依赖拓扑 + 代码集中度）
2. **全局指标盲区**：重构效果（如 DiagramProcessor 拆分为 4 模块）在全局 MetricVector 上几乎不可见，因为在同一包内（`src/cli/processors/`）
3. **GIM 的核心价值**：不在于产生与常规工程判断不同的决策，而在于为 LLM 开发工具提供结构化的推理框架，驱动更好的自动迭代与演进

### 与 FIM 实验的关系

`proposal-coverage-fisher-information.md` 和 `proposal-architecture-metrics-observatory.md` 已经记录了 FIM 经验验证的结果：

- co-change 作为 FIM 代理在运行时覆盖数据下 **未通过** Mantel 检验（r=0.28, p=0.20）
- 但 FIM 的特征值谱、条件数等计算基础设施（`src/analysis/fim/`）仍然可用

本提案不依赖 FIM 的统计验证结论，而是利用 GIM 的**方法论层面**概念（节律、收敛谱系、损失函数）来增强 MetricVector 的解释能力。

---

## 目标

1. **`archguard analyze` 输出包含 GIM 方向提示**：基于最近两个 MetricVector 快照的差异，输出当前演进方向（扩张/收缩/无变化）
2. **`archguard check` 的 fitness rules 支持 GIM 损失函数代理**：在现有 `FitnessRule` 体系（`src/analysis/fitness/rule-types.ts`）中新增 GIM 规则类型（仅限单快照可计算的 4 个损失函数）
3. **MCP 单工具向 LLM 提供 GIM 上下文**：通过 1 个 MCP tool 输出方向提示 + 损失函数状态
4. **提供 GIM system prompt 模板**：为 LLM 开发工具（Claude Code、Cursor 等）提供可直接使用的 GIM prompt

---

## 非目标

- 不重新验证 FIM 的统计合法性。FIM 基础设施（`src/analysis/fim/`）保持现状，本提案在其上层增加解释能力。
- 不实现完整的 MDL 计算。L(X) = L(G) + L(R|G) 的精确计算需要信息论基础设施，超出当前范围。
- 不自动执行重构。GIM 判断输出为建议和上下文，实际行动由人或 LLM agent 决定。
- 不替代现有 fitness rules。GIM 规则作为新规则类型并列存在，用户可选择启用。
- **不实现趋势检测或变化点检测**。当前快照积累不足以支撑统计方法（需 10+ 数据点）。仅做两点对比。

---

## 现状审计

### 可利用的现有基础设施

| 组件 | 位置 | GIM 集成点 |
|------|------|-----------|
| MetricVector | `src/types/metric-vector.ts` | 14 维向量（含 `relationTypeBreakdown` 对象和 11 个数值字段），方向提示的输入 |
| Snapshot Store | `src/analysis/snapshot-store.ts` | 纵向快照（`loadSnapshots()` 返回按时间 DESC 排列的 `MetricSnapshot[]`），两点对比的来源 |
| Snapshot Diff | `src/analysis/snapshot-diff.ts` | 两点差异计算（`diffSnapshots()` 输出 `MetricDiffEntry[]`），已有 delta/percentChange |
| Fitness Rules | `src/analysis/fitness/rule-types.ts` | `MetricThresholdRule` + `DependencyConstraintRule`，需扩展 |
| Rule Evaluator | `src/analysis/fitness/rule-evaluator.ts` | 规则执行引擎，`evaluateAllRules(rules, vector, relations)` — 注意签名只接收单个 MetricVector |
| Config Loader | `src/cli/config-loader.ts` | Zod schema（第 197-220 行）独立定义了 fitness rules 的校验，需同步扩展 |
| FIM Builder | `src/analysis/fim/fim-builder.ts` | Gram 矩阵计算、特征值谱 |
| MCP Tools | `src/cli/mcp/tools/fim-tools.ts` | FIM 查询工具，可参考模式 |
| GlobalConfig | `src/types/config-global.ts` | 已有 `fitness?: FitnessConfig`，无需添加新顶层字段 |
| MetricVector Builder | `src/analysis/metric-vector-builder.ts` | 从 ArchJSON + PackageStatEntry[] 构建 MetricVector |

### 缺失能力

| 能力 | 说明 |
|------|------|
| 两点方向提示 | `snapshot-diff.ts` 输出 delta 但无方向解释（上升/下降 → 扩张/收缩信号映射） |
| 损失函数代理计算 | 四个单快照损失函数（ℒ_T/ℒ_C/ℒ_D/ℒ_G）无对应实现 |
| ~~纵向趋势分析~~ | ~~快照积累不足，暂不实现~~（降级为两点对比） |
| ~~局部作用域分析~~ | ~~MetricVector 是全局的，无法检测包级变化~~（已确认的盲区，不在本提案范围） |
| ~~收敛层级标注~~ | ~~需要代码语义理解~~（属于 LLM 推理范畴，非静态分析可解决） |

---

## 方案设计

### Phase 1: 扩张-收缩方向提示

**目标**：从最近两个 MetricVector 快照输出当前演进方向。

> **架构审查注 (CRITICAL-1)**：原方案声称用 3 个快照做"节律检测"。但变化点检测文献（[Aminikhanghahi & Cook 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5464762/)）表明即使 CUSUM 这种最简单的方法也建议 10+ 个连续观测值。3 个快照只有 2 个 delta，无法区分趋势和噪声。方案降级为诚实的"两点对比方向提示"。
>
> 未来当快照积累到 10+ 个时，可升级为基于滑动窗口的真正趋势检测。这本身符合 GIM 的收敛谱系思想（规则 → 统计模型的渐进升级）。

#### 1.1 方向提示器

新增 `src/analysis/gim/direction-hint.ts`（注意：不叫 `rhythm-detector`，因为这不是节律检测）：

```typescript
export type DirectionType = 'expansion' | 'contraction' | 'stable' | 'insufficient_data';

export interface DirectionHint {
  direction: DirectionType;
  confidence: 'low' | 'medium';   // 两点对比不会产生 'high' 置信度
  signals: DirectionSignal[];
  recommendation: string;
  snapshotCount: number;
  caveat: string;                  // 始终包含局限性说明
}

export interface DirectionSignal {
  metric: string;
  delta: number;
  percentChange: number | null;
  interpretation: string;
}
```

**判断逻辑**：

| 指标 | 扩张信号 | 收缩信号 |
|------|---------|---------|
| totalEntities | 上升 >5% | 下降 >5% |
| totalRelations | 上升 >5% | 下降 >5% |
| packageCount | 上升 | 下降 |
| sccCount | 上升（债务累积） | 下降（清理） |
| giniInDegree | 上升（耦合集中） | 下降（解耦） |

简单多数投票法（不加权——加权需要经验校准数据，当前不具备）。多数方向一致则判定。无多数则输出 `stable`。不足 2 个快照输出 `insufficient_data`。

`confidence` 始终为 `'low'`（2 个快照）或 `'medium'`（3-9 个快照，可看到方向是否持续）。真正的 `'high'` 置信度需要 10+ 个快照和统计检验，属于未来升级。

`caveat` 字段始终填写，例如：`"Based on 2-snapshot comparison only. Not a statistically validated trend. Direction may reverse in next snapshot."`

**数据来源**：复用 `src/analysis/snapshot-store.ts` 的 `loadSnapshots()`，取最近 2 个快照，调用 `diffSnapshots()` 获取 delta。

#### 1.2 CLI 集成

`archguard analyze` 加 `--gim` flag，在分析输出末尾追加方向提示：

```
GIM Direction Hint (based on 2 snapshots):
  Direction: EXPANSION (confidence: low)
  Signals:
    - totalEntities: 412 → 514 (+24.8%) — expansion signal
    - packageCount: 28 → 33 (+17.9%) — expansion signal
    - sccCount: 0 → 0 (no change) — neutral
  Caveat: Based on 2-snapshot comparison only. Not a statistically validated trend.
  Recommendation: Consider a contraction phase — extract shared abstractions from recently added packages.
```

输出同时写入 `.archguard/gim/direction.json`。

### Phase 2: GIM 损失函数 Fitness Rules

**目标**：在现有 `FitnessRule` 体系中支持 GIM 损失函数评估。

> **架构审查注 (CRITICAL-2)**：原方案包含 ℒ_S（稳定性 = 跨快照 MetricVector 方差）。但 `evaluateAllRules()` 的签名是 `(rules: FitnessRule[], vector: MetricVector, relations: Relation[]): RuleResult[]`。它只接收**单个** MetricVector，无法计算跨快照方差。
>
> 修改 `evaluateAllRules` 签名以传入快照数组会破坏所有调用方，且违反 fitness rule 的设计理念（fitness function 评估的是当前状态的健康度，不是时间序列属性）。
>
> **决策**：ℒ_S 从 fitness rules 中移除。跨快照稳定性信息仅在 Phase 1 的方向提示和 Phase 3 的 MCP 工具中展示，不参与 pass/fail 判断。

#### 2.1 新增规则类型

扩展 `src/analysis/fitness/rule-types.ts`：

```typescript
export interface GimLossRule {
  type: 'gim-loss';
  loss: 'feasibility' | 'consistency' | 'description-length' | 'generation-alignment';
  // 注意：没有 'stability'，因为它需要多快照数据，与 evaluateAllRules 签名不兼容
  op: ComparisonOp;
  value: number;
  message: string;
}

export type FitnessRule = MetricThresholdRule | DependencyConstraintRule | GimLossRule;
```

**同步修改** `src/cli/config-loader.ts` 第 197-220 行的 Zod schema：

```typescript
// 在 fitness.rules 的 z.union 中添加第三个分支：
z.object({
  type: z.literal('gim-loss'),
  loss: z.enum(['feasibility', 'consistency', 'description-length', 'generation-alignment']),
  op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
  value: z.number(),
  message: z.string(),
}),
```

**同步修改** `src/analysis/fitness/rule-evaluator.ts` 的 `evaluateAllRules`：

```typescript
export function evaluateAllRules(
  rules: FitnessRule[], vector: MetricVector, relations: Relation[]
): RuleResult[] {
  return rules.map((rule) => {
    if (rule.type === 'no-dependency') {
      return checkDependencyConstraint(rule, relations);
    }
    if (rule.type === 'gim-loss') {
      return evaluateGimLossRule(rule, vector);
    }
    return evaluateMetricRule(rule as MetricThresholdRule, vector);
  });
}
```

#### 2.2 损失函数映射

将 GIM 四个单快照损失函数映射到可计算的 MetricVector 代理：

| 损失函数 | 符号 | MetricVector 代理 | 计算方式 | 代理合理性 |
|----------|------|-------------------|----------|-----------|
| 可行性 | ℒ_T | sccCount | 循环依赖数量（cycles.length）| 直接：SCC > 0 意味着存在编译/部署上的可行性风险 |
| 一致性 | ℒ_C | inferredRelationRatio | 推断关系比例 | 直接：显式声明的关系更一致 |
| 描述长度 | ℒ_D | totalEntities + totalRelations | 实体数 + 关系数之和 | 弱代理：这只是复杂度的粗略上界，真正的 MDL 需要编码方案 |
| 生成对齐 | ℒ_G | giniInDegree | Gini 系数 | 中等代理：高 Gini 意味着依赖分布不均匀 |

**重要说明**：

1. 这些映射是**代理近似**，不是数学等价。文档和输出中必须明确标注。
2. ℒ_D 的值（`totalEntities + totalRelations`）不可跨项目比较。一个 100 实体的项目和一个 10000 实体的项目不能用相同阈值。用户必须根据自己项目的规模设定合理阈值。
3. ~~ℒ_S（稳定性）~~ 已从 fitness rules 中移除（见审查注 CRITICAL-2）。
4. 原方案中 ℒ_T 使用 `sccCount + maxOutDegree`，但 `maxOutDegree` 高不一定意味着不可行（高扇出可能只是一个 facade），简化为仅使用 `sccCount`，语义更清晰。
5. 原方案中 ℒ_G 使用 `giniInDegree + giniPackageSize`，两个 Gini 系数相加无统计意义，简化为单一 `giniInDegree`。

#### 2.3 配置示例

```json
{
  "fitness": {
    "rules": [
      { "type": "gim-loss", "loss": "feasibility", "op": "==", "value": 0, "message": "No dependency cycles allowed (GIM feasibility proxy)" },
      { "type": "gim-loss", "loss": "consistency", "op": "<=", "value": 0.3, "message": "Inferred relations should be <30% (GIM consistency proxy)" },
      { "type": "gim-loss", "loss": "description-length", "op": "<=", "value": 1500, "message": "Total entities+relations should stay manageable (GIM description-length proxy, project-specific threshold)" }
    ],
    "failOnViolation": false
  }
}
```

注意 `failOnViolation: false`。GIM 损失函数的代理值不应阻断 CI，仅作为顾问性信号。

### Phase 3: MCP 工具 — GIM 上下文提供

**目标**：新增 1 个 MCP tool，使 LLM 能查询 GIM 分析结果。

> **架构审查注 (SIGNIFICANT-1)**：原方案设计了 3 个独立 MCP 工具（`archguard_get_gim_rhythm`、`archguard_get_gim_losses`、`archguard_get_pillarization_candidates`）。
>
> 审查后合并为 1 个工具，理由：
> 1. GIM 上下文是一个整体——LLM 不需要分开调用方向提示和损失函数。一次调用获取全部上下文更高效。
> 2. 原 `pillarization_candidates` 工具的数据来源不可靠：FIM `selfInfo` 是测试覆盖的 Fisher 信息对角线值，度量的是"该文件在测试覆盖矩阵中的信息量"，与"模块是否稳定到可以支柱化"无直接关系。移除为独立工具，改为在 GIM 上下文中包含一个轻量级的"高 inDegree 低 outDegree"列表作为参考。
> 3. 遵循已有模式中工具数量克制的原则：`fim-tools.ts` 只有 1 个工具，`git-history-analyze-tool.ts` 只有 1 个工具。

#### 3.1 新增工具

新增 `src/cli/mcp/tools/gim-tools.ts`，注册 1 个 MCP tool：

**`archguard_get_gim_context`**

输入：`projectRoot?`

输出：完整的 GIM 上下文 JSON：

```json
{
  "direction": {
    "direction": "expansion",
    "confidence": "low",
    "signals": [
      { "metric": "totalEntities", "delta": 102, "percentChange": 24.8, "interpretation": "expansion signal" }
    ],
    "caveat": "Based on 2-snapshot comparison only. Not a statistically validated trend.",
    "recommendation": "Consider a contraction phase."
  },
  "losses": {
    "feasibility": { "value": 0, "status": "healthy", "detail": "sccCount=0", "proxy": true },
    "consistency": { "value": 0.12, "status": "healthy", "detail": "inferredRelationRatio=0.12", "proxy": true },
    "descriptionLength": { "value": 884, "status": "info", "detail": "514 entities + 370 relations (project-specific, not comparable across projects)", "proxy": true },
    "generationAlignment": { "value": 0.776, "status": "warning", "detail": "giniInDegree=0.776 (high concentration)", "proxy": true }
  },
  "highInfluenceEntities": [
    { "file": "src/cli/mcp/mcp-server.ts", "inDegree": 22, "outDegree": 5, "note": "high inDegree, low outDegree — stable provider candidate" }
  ],
  "snapshotCount": 2,
  "methodology": "GIM (Geometric Information Methodology) — values are proxy approximations, not exact measurements"
}
```

注意输出中每个 loss 都有 `"proxy": true` 标记，`methodology` 字段说明性质。

**`highInfluenceEntities` 数据来源说明**：per-entity 的 inDegree/outDegree 不在 MetricVector 中（MetricVector 只有全局的 `maxInDegree`/`maxOutDegree`）。需要通过 `loadEngine(archguardDir)` 加载 QueryEngine，调用 `getSummary()` 获取 `fileStats` 中的 per-entity 度数据。如果无 ArchJSON 数据可用（未运行过 analyze），则返回空数组。

#### 3.2 实现模式

遵循现有 MCP 工具的标准模式（参考 `fim-tools.ts`、`git-history-tools.ts`）：

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { diffSnapshots } from '@/analysis/snapshot-diff.js';
import { loadEngine } from '../../query/engine-loader.js';
// ... computeDirectionHint, computeLosses 从 src/analysis/gim/ 导入

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerGIMTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_gim_context',
    'Get GIM (Geometric Information Methodology) context: evolution direction hint and loss function proxy values. All values are proxy approximations for LLM reasoning, not exact measurements. Requires at least one prior archguard_analyze run.',
    {
      projectRoot: z.string().optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
    },
    async ({ projectRoot }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      // ... implementation
    }
  );
}
```

在 `src/cli/mcp/mcp-server.ts` 中注册：

```typescript
import { registerGIMTools } from './tools/gim-tools.js';
// ... 在 createMcpServer() 中添加：
registerGIMTools(server, defaultRoot);
```

#### 3.3 工具调用流程

```
LLM Agent
  ├── archguard_summary              → 基础架构概览
  ├── archguard_get_gim_context      → 方向提示 + 损失函数代理值 + 高影响实体
  └── (可选) archguard_get_fim       → FIM 覆盖详情（如果需要更深入分析）
      → LLM 综合以上信息，使用 GIM 词汇表生成演进建议
```

### Phase 4: GIM System Prompt 模板

**目标**：提供可直接使用的 GIM system prompt，供 LLM 开发工具在架构演进对话中使用。

#### 4.1 模板结构

输出到 `.archguard/gim/system-prompt.md`，内容由分析结果动态生成：

```markdown
## Architecture Context (GIM Framework)

> All metrics below are proxy approximations derived from static analysis.
> They provide structured vocabulary for reasoning, not precise measurements.

### Current Direction: EXPANSION (confidence: low, based on 2 snapshots)
The project is adding capabilities. MetricVector shows rising entity count (+24.8%)
and package count (+17.9%) compared to the previous snapshot.

**Caveat**: This is a 2-point comparison, not a validated trend.

### Loss Function Proxy Status
| Loss | Proxy Value | Status | What It Measures (Approximately) |
|------|-------------|--------|----------------------------------|
| ℒ_T (Feasibility) | 0 | Healthy | Dependency cycle count (sccCount) |
| ℒ_C (Consistency) | 0.12 | Healthy | Inferred relation ratio |
| ℒ_D (Description Length) | 884 | Info | Entity + relation count (project-specific) |
| ℒ_G (Generation Alignment) | 0.776 | Warning | Gini coefficient of inDegree distribution |

### High-Influence Entities (candidates for stabilization)
- `mcp-server.ts` — inDegree=22, outDegree=5 (high provider, low consumer)

### Recommendation
Consider scheduling a contraction phase: extract shared abstractions from recently
added packages before the next expansion.
```

#### 4.2 集成方式

`archguard analyze --gim` 自动生成此文件。LLM 工具可通过文件读取或 MCP tool 获取。

**`--gim` 完整执行流程**（在 `analyze.ts` 中，分析完成后触发）：
1. `loadSnapshots(outputDir)` — 加载历史快照
2. `computeDirectionHint(snapshots)` — 计算方向提示
3. 写入 `.archguard/gim/direction.json`
4. 从 `snapshots[0].metricVector` 取最新向量，调用 `computeAllLosses(vector)`
5. `generateGimPrompt(hint, losses)` — 生成 system prompt
6. 写入 `.archguard/gim/system-prompt.md`

步骤 1-3 在 Phase 1 实现，步骤 4-6 在 Phase 4 追加。

---

## 权衡分析

### 采用 MetricVector 代理 vs 精确 GIM 计算

**选择**：MetricVector 代理

**理由**：

- 精确的 MDL 计算（L(X) = L(G) + L(R|G)）需要定义完整的编码方案（参见 [Grunwald MDL Tutorial](https://homepages.cwi.nl/~paulv/course-kc/mdlintro.pdf) — crude MDL 需要 two-stage code，refined MDL 需要 universal code），实现复杂度高，且 FIM 实验已证明数学精确性不一定带来工程价值
- MetricVector 的 14 维已经捕获了主要的架构信号（实验确认实质 ~2 个独立维度）
- 代理映射的价值在于将 GIM 概念**可操作化**，不在于数学等价

**代价**：损失函数值不可跨项目比较（绝对值无意义，趋势有意义）

### 方向判断：两点对比 vs 时间序列模型

**选择**：两点对比 + 简单多数投票

**理由**：

- 时间序列变化点检测方法（CUSUM、PELT、Bayesian Online CPD）普遍需要 10+ 个连续观测值才有统计意义（[Aminikhanghahi & Cook 2017 survey](https://pmc.ncbi.nlm.nih.gov/articles/PMC5464762/)）
- 当前大多数项目的快照积累远不足 10 个
- 两点对比虽然粗糙，但诚实——不假装是趋势检测
- 随着快照积累到 10+，可升级为滑动窗口 + 显著性检验（符合 GIM 收敛谱系：规则 → 模型）

**代价**：无法区分真正的趋势变化和一次性波动。通过 `confidence: 'low'` 和 `caveat` 字段显式传达此局限。

### 新增 1 个 MCP 工具 vs 扩展现有工具

**选择**：新增独立的 `gim-tools.ts`，包含 1 个工具

**理由**：

- 遵循现有模式：`fim-tools.ts`（1 个工具）、`git-history-analyze-tool.ts`（1 个工具）各自独立
- GIM 工具可独立启用/禁用，不影响现有工具
- 合并为 1 个工具而非原方案的 3 个：GIM 上下文是一个整体，LLM 一次调用获取全部信息更高效

**代价**：单个工具的输出较大，但 LLM 上下文窗口已足够处理

### 损失函数作为 Fitness Rules vs 独立报告

**选择**：4 个单快照损失函数集成到 Fitness Rules 体系，ℒ_S 独立展示

**理由**：

- 复用现有 `FitnessConfig` 基础设施（`src/analysis/fitness/`）
- 用户可在 `archguard.config.json` 中声明式配置
- `archguard check` 命令自动评估，与 CI 集成自然
- ℒ_S 因需要多快照数据，与 `evaluateAllRules(rules, vector, relations)` 签名不兼容，放在 MCP 工具的方向提示中展示

**代价**：GIM 损失函数的"值"是代理近似，用户可能误解为精确度量。通过 `proxy: true` 标记和文档缓解。

---

## 风险

### R1: 两点对比导致方向判断频繁翻转

**风险**：只有两个快照时，一次小变更就可能导致方向从 expansion 翻转为 contraction。

**缓解**：
- `confidence` 在两点对比时始终为 `'low'`，在输出中显式标注
- `caveat` 字段始终说明局限性
- 设置 5% 的变化阈值，低于阈值的 delta 视为 `stable` 而非方向信号
- 在 GIM system prompt 中明确告知 LLM 这是方向提示而非确定判断

### R2: 损失函数代理映射的误导性

**风险**：用户可能将 ℒ_D = 884 解读为"描述长度为 884 比特"，但实际只是 entity + relation 数量之和。

**缓解**：
- 输出中始终附带 `detail` 字段说明计算来源
- 输出中始终附带 `proxy: true` 标记
- 文档和 system prompt 明确标注"代理近似，非精确计算"
- 默认 `failOnViolation: false`，避免基于代理值阻断 CI
- ℒ_D 的 `status` 使用 `'info'` 而非 `'warning'`，避免不当的紧迫感

### R3: GIM 概念对非 GIM 用户的认知负担

**风险**：大多数用户不了解 GIM 方法论，"扩张-收缩节律"、"支柱化"等术语可能造成困惑。

**缓解**：
- GIM 功能默认关闭（需 `--gim` flag 或配置文件启用）
- 所有输出使用自然语言 recommendation，不强制使用 GIM 术语
- GIM system prompt 模板面向 LLM 消费，不面向人类直接阅读

### R4: 快照积累不足导致方向提示长期为 insufficient_data

**风险**：新项目或未持续运行 `analyze` 的项目将长期看到 `insufficient_data`。

**缓解**：
- `archguard analyze --gim` 每次运行自动保存快照（复用现有 `saveSnapshot()`）
- 在 CI 中推荐定期运行以积累数据
- 即使无快照，4 个单快照损失函数（ℒ_T/ℒ_C/ℒ_D/ℒ_G）仍可独立评估

### R5: 与 FIM 实验结论的混淆

**风险**：用户可能认为本提案是 FIM 的延续/替代，而 FIM 经验验证已部分失败（P5 refuted）。

**缓解**：
- 文档明确区分 FIM（统计验证层，`src/analysis/fim/`）与 GIM（方法论解释层）
- 本提案不复用 FIM 的 selfInfo 或特征值作为 GIM 输入（原方案的 pillarization 工具试图这样做，已移除）
- `proposal-architecture-metrics-observatory.md` 已对 FIM 结论做了诚实记录

### R6（新增）: over-engineering — GIM 本身是方法论而非精确理论

**风险**：过度实现（复杂的类层次结构、多个分析阶段、精细的配置选项）会给代理近似赋予虚假的精确性，增加维护负担而无实质收益。

**缓解**：
- 整个实现应控制在 ~300 行代码以内（`direction-hint.ts` ~100 行 + `gim-loss-evaluator.ts` ~80 行 + `gim-tools.ts` ~80 行 + system prompt generator ~40 行）
- 不引入新的类层次结构。所有函数保持为纯函数，输入 MetricVector/MetricDiffEntry，输出 JSON 对象
- 不引入 GIM 特定的配置段。GIM 规则复用现有 `fitness.rules`，方向提示通过 `--gim` flag 控制

---

## 实现优先级

| Phase | 内容 | 依赖 | 变更范围 | 预估工作量 |
|-------|------|------|---------|-----------|
| 1 | 方向提示器 + CLI `--gim` flag | snapshot-store.ts, snapshot-diff.ts | 新增 `src/analysis/gim/direction-hint.ts` (~100 行) | S |
| 2 | GIM 损失函数 Fitness Rules（4 个） | rule-types.ts, rule-evaluator.ts, config-loader.ts | 修改 3 个现有文件 + 新增 `gim-loss-evaluator.ts` (~80 行) | S |
| 3 | MCP 工具（1 个 tool） | Phase 1 + Phase 2 | 新增 `src/cli/mcp/tools/gim-tools.ts` (~80 行)，修改 `mcp-server.ts` 注册 | S |
| 4 | GIM System Prompt 模板生成 | Phase 1 + Phase 2 | 新增 system prompt generator (~40 行) | XS |

总计新增代码量：~300 行。修改现有文件 4 个（`rule-types.ts`、`rule-evaluator.ts`、`config-loader.ts`、`mcp-server.ts`），每个改动 < 20 行。

Phase 1-2 可并行实施。Phase 3 依赖前两者。Phase 4 最后。

---

## 附录 A：与 Lehman 软件演化定律的对照

GIM 的"扩张-收缩节律"概念与 Lehman 定律中两条得到广泛实证确认的定律一致：

- **持续变化定律**（Law I）：使用中的系统必须持续适应，否则逐渐失效 — 对应 GIM 的"扩张阶段必然发生"
- **持续增长定律**（Law VI）：系统功能必须持续增长以维持用户满意度 — 但 Lehman 定律中没有"收缩阶段"的对应概念

注意：Lehman 的 8 条定律中，仅 Law I（持续变化）和 Law VI（持续增长）在跨项目实证研究中被一致确认（[Wikipedia: Lehman's laws](https://en.wikipedia.org/wiki/Lehman%27s_laws_of_software_evolution)、[Israeli et al. 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC4375964/)）。其余定律的实证支持因项目和测量方法而异。GIM 的收缩阶段更接近工程最佳实践（重构周期）而非普遍的演化规律。

## 附录 B：A/B/C 实验数据摘要

来源：`docs/experiments/git-methodology-ab-test.md`

实验输入（三组相同）：
```
MetricVector:
  totalEntities: 514, totalRelations: 370
  sccCount: 0, maxInDegree: 22, maxOutDegree: 16
  giniInDegree: 0.776, giniPackageSize: 0.378
  packageCount: 33, maxPackageSize: 24
```

Group A (GIM) 的差异化输出：
- 通过 ℒ_G 分析识别 tree-sitter bridge 支柱化机会（giniInDegree 0.776 表明生成规则覆盖不均匀，少数模块承担大量依赖 → 这些模块是支柱化的自然候选）
- 识别扩张末期信号（entity 和 package 数量持续上升，但 sccCount 保持 0 → 架构纪律尚好，但复杂度在累积）
- 建议收缩：从最近新增的包中提取共享抽象

Group B/C 的重叠输出：
- 均建议降低 giniInDegree（但未给出结构性方向）
- 均建议增加测试覆盖（entityCoverageRatio 缺失）
- 未提及节律或支柱化概念

## 附录 C：变更清单（供实现参考）

| 文件 | 操作 | 变更内容 |
|------|------|---------|
| `src/analysis/gim/direction-hint.ts` | 新增 | DirectionHint 类型 + computeDirectionHint() 纯函数 |
| `src/analysis/gim/gim-loss-evaluator.ts` | 新增 | evaluateGimLossRule() 纯函数，4 个 loss 的 MetricVector 代理计算 |
| `src/analysis/fitness/rule-types.ts` | 修改 | 添加 GimLossRule 接口，扩展 FitnessRule 联合类型 |
| `src/analysis/fitness/rule-evaluator.ts` | 修改 | evaluateAllRules 添加 'gim-loss' 分支（~5 行） |
| `src/cli/config-loader.ts` | 修改 | fitness.rules Zod schema 添加 gim-loss 分支（~7 行） |
| `src/cli/mcp/tools/gim-tools.ts` | 新增 | registerGIMTools()，1 个 tool |
| `src/cli/mcp/mcp-server.ts` | 修改 | import + 调用 registerGIMTools()（~2 行） |
| `src/cli/commands/analyze.ts` | 修改 | --gim flag 处理，调用方向提示 + 写入 .archguard/gim/（~15 行） |
