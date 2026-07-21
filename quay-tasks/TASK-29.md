---
id: TASK-29
title: 实验：执行 GIM A/B/C 方法论对照实验，验证 GIM system prompt 有效性
status: done
labels:
  - experiment
  - gim
parent: null
children: []
---

## Description

执行已设计好的 A/B/C 对照实验（`docs/experiments/git-methodology-ab-test.md`），向三组 LLM agent 分别注入不同的 system prompt，使用项目当前快照作为共享输入，收集三组推荐结果，并对照项目实际演进路径（plan-53 至今的 backlog）进行盲评打分，得出 GIM 方法论对 LLM 架构推荐质量是否有显著提升的结论。结论直接决定 TASK-10（GIM 集成层实现）是否值得投入。

## Context

实验文档 `docs/experiments/git-methodology-ab-test.md` 已完整设计了实验框架：
- 三组 system prompt 已写好（A: GIM 方法论、B: 简单工程规则、C: 无框架对照）
- 输入格式已定义（MetricVector + git log + 目录结构）
- 评估标准已定义（5 维盲评）

原始实验基准点为 commit ff88649（plan-52 HEAD），基准 MetricVector：
```
totalEntities: 514, totalRelations: 370, sccCount: 0
giniInDegree: 0.776, packageCount: 33, maxInDegree: 22
```
当前 `.archguard/metrics-history.jsonl` 快照（2026-06-30）与之高度吻合，**可直接使用现有快照，无需 checkout 历史**。

**Ground truth**（实验基准点之后实际发生的演进）：
- plan-53 ~ plan-56：GIM 方向提示、损失规则、MCP 工具、system prompt 生成器
- 后续 backlog：tree-sitter 外化（TASK-11）、形状气味检测（TASK-14）、JL 系列（TASK-17/18/19）、Go Atlas 热点（TASK-15）

## Implementation Plan

### Phase 1 — 准备共享输入（不依赖 LLM）

收集三组 agent 使用的统一上下文数据：

1. **MetricVector**：使用 `.archguard/metrics-history.jsonl` 的现有快照（2026-06-30），字段：totalEntities、totalRelations、sccCount、giniInDegree、giniPackageSize、packageCount、maxInDegree、maxOutDegree、inferredRelationRatio
2. **最近 10 个 commit**：`git log --oneline -10`（以 ff88649 附近为基准，或当前 HEAD 均可，需说明选择）
3. **已有 Plan 列表摘要**：plan-01 到 plan-52 的标题列表（从 `docs/archive/` 或 `backlog/` 提取）
4. **src/ 目录结构**（2 层深度）：`find src/ -maxdepth 2 -type d`
5. **top-10 高 inDegree 包**：从 `.archguard/metrics-history.jsonl` 的 packages 数组按 fanIn 排序取前 10

将上述数据整理为统一 markdown 文件 `docs/experiments/gim-abc-shared-context.md`，供三组 agent 共用。

### Phase 2 — 执行三组 Agent

并行启动三个独立 agent，每个 agent：
- 接收完全相同的共享上下文（Phase 1 输出）
- 接收各自的 system prompt（来自实验文档 A/B/C 三组）
- 输出统一格式：当前状态评估（100-200 字）+ 3 个 Plan 提案（含标题、类型标签、优先级理由、预期 MetricVector 影响、工作量）
- 结果写入 `docs/experiments/gim-abc-results/group-{a,b,c}.md`（文件名隐去组别标签，用于盲评）

**隔离要求**：三组 agent 独立运行，不共享上下文，不互相参考。

### Phase 3 — 盲评打分

将三组结果文件（隐去 A/B/C 标签，改为 X/Y/Z）交由评估者按 5 个维度打分（1-5 分）：

1. **诊断准确性**：状态评估是否符合项目 ff88649 时刻的实际情况？
2. **提案相关性**：提出的 Plan 是否解决了真实问题？
3. **排序合理性**：优先级是否合理？
4. **可执行性**：Plan 是否足够具体可以开始执行？
5. **视野广度**：是否发现了非显而易见的改进方向（如 GIM 方法论组是否识别出扩张/收缩判断）？

额外维度：**预测准确性**（对照 ground truth）：推荐的 Plan 是否与项目实际选择（plan-53 至今）有交集？

结果写入 `docs/experiments/gim-abc-results/evaluation.md`（揭盲后标注 A/B/C）。

### Phase 4 — 结论

在 `docs/experiments/gim-abc-results/conclusion.md` 中写明：

1. 各组总分及排名
2. GIM 组（A）相对 B（规则）和 C（无框架）的优势/劣势具体体现在哪个维度？
3. 对 TASK-10 的建议：实施 / 缩减范围 / 搁置（附理由）
4. 实验局限性说明（单次实验、评估者即项目作者的偏差风险等）

## Acceptance Criteria

- [x] `ls docs/experiments/gim-abc-shared-context.md` 退出 0（共享输入已准备）
- [x] `ls docs/experiments/gim-abc-results/group-a.md docs/experiments/gim-abc-results/group-b.md docs/experiments/gim-abc-results/group-c.md` 退出 0（三组结果已收集）
- [x] `grep -q '总分\|排名\|TASK-10' docs/experiments/gim-abc-results/conclusion.md` 退出 0（结论已写明）
- [x] `grep -q '预测准确性\|ground truth' docs/experiments/gim-abc-results/evaluation.md` 退出 0（盲评包含 ground truth 对照）

## Definition of Done

- [x] 三组 agent 结果文件存在且内容完整（各含状态评估 + 3 个 Plan 提案）
- [x] 盲评打分表完成，5 个维度 + 预测准确性维度均有分数
- [x] `conclusion.md` 中有对 TASK-10 的明确建议（实施/缩减/搁置）

实验结论必须落地为对 TASK-10 状态的实际操作（`done` 且 TASK-10 状态更新），不允许结论停留在文档中而 TASK-10 维持原状。
