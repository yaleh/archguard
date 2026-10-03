---
id: gap-a4-architecture-layer-check-proposal-review
title: A4 分层声明 + 确定性方向检查 + 展示：proposal 评审并拆分实施计划
status: todo
labels:
  - proposal
  - architecture
  - needs-ruling
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-verify-module-graph-edge-completeness
  - gap-fitness-check-relations-stub
  - gap-query-cycles-ignores-output-scope-package
---
## Proposal

`docs/architecture-checking-scenarios.md`（实际路径 `docs/user-guide/architecture-checking-scenarios.md`）的 Limits 一节写明 ArchGuard 目前没有一等的架构规则检查。2026-10-02 起 archguard 自身与 quay 项目的两次独立实验证明"层声明 → 确定性检查 → 单页展示"可以跑通，并发现了 `detect_cycles(package)` 看不见的目录级环与方向违例。proposal 已写成文档 `docs/proposals/proposal-architecture-layer-check.md`（Draft v1，2026-10-03），外部原型在 `docs/experiments/layer-map/`（提交 2a75651e）。

本任务不是实现，而是**人评审该 proposal 并裁定范围**，之后再由 `quay-task-to-plan`（或 feature-to-backlog 流程）拆成分阶段的实施任务。proposal 的核心主张：

- 层声明另起文件（glob→层、allowed 方向、known_violations 基线），**不扩展** `project-semantics.json` 的 `architecturalLayers`（它只能表达分组，表达不了方向）；
- 检查器确定性、不含 LLM，结果三态 pass / fail / not-evaluated，读不懂输入、空图、glob 全不匹配都是 not-evaluated，不得与 pass 同形；
- 取边依赖 moduleGraph 边集合完整（gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges）和 type-only/值依赖拆分（gap-ts-module-graph-type-only-edge-split）；
- 形态：确定性内核（CLI 子命令 + MCP 工具）+ 编排 skill + 仅用于起草初版层声明的 subagent；
- 不纳入：运行时耦合发现（quay A3）、PlantUML 输出、跨 scope 补边。

## 人的裁定（2026-10-03）

1. **范围与非目标**：批准，按原文范围（目标 1–6；非目标：不纳入运行时耦合 A3、不重引 PlantUML、不让 LLM 判定违例、不跨 scope 补边）。
2. **实现入口形态**：延后裁定。先修 fitness 引擎死桩 `gap-fitness-check-relations-stub` 与 `gap-query-cycles-ignores-output-scope-package`，看到引擎真实能力后再定「扩展 archguard check」还是「独立 check-layers 子命令」。
3. **层声明与 architecturalLayers 的关系**：方案 1 —— 层声明为唯一正本，architecturalLayers 降为 analyze 时的派生投影（投影进 ArchJSON.extensions.projectSemantics，渲染器不改，无声明文件时行为不变）。
4. **分阶段起点**：先补阶段 0/1 验收 `gap-verify-module-graph-edge-completeness`，再进阶段 2。

开放问题 1–6 处置：1 → 由验收任务覆盖；2 → 接受（not-evaluated 设计已覆盖）；3 → 接受，v1 只做 TS；4 → 见裁定 3；5 → 接受，阶段 3 AC 必须含浏览器目视验证；6 → A1/A2 各自单独提案，排后。

评审新发现（已立案）：`archguard check` 已存在 fitness 规则引擎（`fitness.rules` + `no-dependency`），proposal 原文「没有一等的规则检查」不准确；且 `src/cli/commands/check.ts` 硬编码空 relations 使该规则永不生效。`detect_cycles(package)` 缺陷已修，proposal 动机已改写为「环 ≠ 方向」。

产出：
- proposal 更新为 Approved v2 并记录修订：`docs/proposals/proposal-architecture-layer-check.md`
- 实施计划：`docs/plans/plan-a4-layer-check.md`
- 前置任务（todo）：`gap-verify-module-graph-edge-completeness`、`gap-fitness-check-relations-stub`、`gap-query-cycles-ignores-output-scope-package`
- `docs/user-guide/architecture-checking-scenarios.md` 的 Limits 一节已加 2026-10-03 结论（限制成立，指向本提案）

下一步（人）：A0 完成后裁定入口形态，再立阶段 2–4 的任务。

## AC

- [x] 人的裁定已写入上面"## 人的裁定"一节，任务状态由 needs-human 改为 todo
- [x] 评审后的 proposal 文档已按裁定更新（`docs/proposals/proposal-architecture-layer-check.md` 状态 Draft → Approved v2，并记录修订）
- [ ] 若批准：已生成分阶段实施计划文档（`docs/plans/plan-a4-layer-check.md`）并按阶段立出 quay 任务 —— 阶段 0.5/A0 已立（todo）；阶段 2–4 的入口形态按裁定 2 待 A0 完成后裁定，尚未立项
- [x] 若批准：`docs/user-guide/architecture-checking-scenarios.md` 的 Limits 一节已加明确结论（限制成立，加提案指针）

## DoD

完成的标准是"有人的裁定且 proposal 状态已更新为终态"，而不是"文档写完"。若批准，必须有可执行的、依赖关系明确的实施任务集合，且第一阶段任务的 AC 已能被机械检查；若拒绝，必须记录拒绝理由，并说明 `docs/experiments/layer-map/` 原型的处置（保留为实验或删除）。

## Touches

- docs/proposals/proposal-architecture-layer-check.md
- docs/user-guide/architecture-checking-scenarios.md
- tasks/gap-a4-architecture-layer-check-proposal-review.md
- docs/plans/plan-a4-layer-check.md
- docs/proposals/proposal-architecture-layer-check.md
