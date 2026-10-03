---
id: gap-a4-architecture-layer-check-proposal-review
title: A4 分层声明 + 确定性方向检查 + 展示：proposal 评审并拆分实施计划
status: needs-human
labels:
  - proposal
  - architecture
  - needs-ruling
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ts-module-graph-type-only-edge-split
---
## Proposal

`docs/architecture-checking-scenarios.md`（实际路径 `docs/user-guide/architecture-checking-scenarios.md`）的 Limits 一节写明 ArchGuard 目前没有一等的架构规则检查。2026-10-02 起 archguard 自身与 quay 项目的两次独立实验证明"层声明 → 确定性检查 → 单页展示"可以跑通，并发现了 `detect_cycles(package)` 看不见的目录级环与方向违例。proposal 已写成文档 `docs/proposals/proposal-architecture-layer-check.md`（Draft v1，2026-10-03），外部原型在 `docs/experiments/layer-map/`（提交 2a75651e）。

本任务不是实现，而是**人评审该 proposal 并裁定范围**，之后再由 `quay-task-to-plan`（或 feature-to-backlog 流程）拆成分阶段的实施任务。proposal 的核心主张：

- 层声明另起文件（glob→层、allowed 方向、known_violations 基线），**不扩展** `project-semantics.json` 的 `architecturalLayers`（它只能表达分组，表达不了方向）；
- 检查器确定性、不含 LLM，结果三态 pass / fail / not-evaluated，读不懂输入、空图、glob 全不匹配都是 not-evaluated，不得与 pass 同形；
- 取边依赖 moduleGraph 边集合完整（gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges）和 type-only/值依赖拆分（gap-ts-module-graph-type-only-edge-split）；
- 形态：确定性内核（CLI 子命令 + MCP 工具）+ 编排 skill + 仅用于起草初版层声明的 subagent；
- 不纳入：运行时耦合发现（quay A3）、PlantUML 输出、跨 scope 补边。

## 人的裁定

（待填：1. 是否同意 proposal 的范围与非目标；2. 形态（CLI 子命令名、是否同时提供 MCP 工具、skill 是否放进 archguard plugin）；3. `architecturalLayers` 与层声明的关系（独立文件 / 层声明引用它）；4. 实施分阶段的先后；5. 开放问题 1–6 各自的处置。裁定写入后，把状态改为 todo，并由 `quay-task-to-plan` 产出实施计划。）

## AC

- [ ] 人的裁定已写入上面"## 人的裁定"一节，且任务状态已由人改为 todo（本项未满足前不得开始实现）
- [ ] 评审后的 proposal 文档已按裁定更新（`docs/proposals/proposal-architecture-layer-check.md` 状态从 Draft 改为 Approved 或 Rejected，并记录修订）
- [ ] 若批准：已生成分阶段实施计划文档（`docs/plans/` 下）并按阶段立出 quay 任务，每个任务的 Touches 具体到文件、带测试文件，依赖关系用 `depends_on` 声明
- [ ] 若批准：`docs/user-guide/architecture-checking-scenarios.md` 的 Limits 一节是否需要修改已有明确结论

## DoD

完成的标准是"有人的裁定且 proposal 状态已更新为终态"，而不是"文档写完"。若批准，必须有可执行的、依赖关系明确的实施任务集合，且第一阶段任务的 AC 已能被机械检查；若拒绝，必须记录拒绝理由，并说明 `docs/experiments/layer-map/` 原型的处置（保留为实验或删除）。

## Touches

- docs/proposals/proposal-architecture-layer-check.md
- docs/user-guide/architecture-checking-scenarios.md
- tasks/gap-a4-architecture-layer-check-proposal-review.md
