---
id: TASK-22.6
title: config doctor codebase-memory 只读检查命令
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:08'
updated_date: '2026-06-28 02:59'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
新增 doctor 子命令（PR #60 若届时已合入则复用其 install/doctor provider 框架及 dry-run/backup 语义，否则按提案契约新增）：检查 PATH/配置 command、list_projects 可执行性、project 解析、索引状态，输出结构化 {ok, binary, project, nextSteps}，绝不修改环境。对应阶段 1 doctor 项。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: config doctor codebase-memory 只读检查命令

## Background
启用 codebase-memory 后端前，用户需要一个只读诊断命令确认 binary 是否可调用、project 是否已索引——否则只能靠后端报错试错。doctor 必须绝不修改用户环境，仅显式调用时检查。本子任务新增该命令（提案阶段 1 的 doctor 项），可复用 child 1 的 client/project-resolver 检查能力与 child 2 的 command 配置。

## Goals
1. 新增 `archguard config doctor codebase-memory` 子命令（PR #60 provider 框架若届时已合入则复用其 dry-run/backup 语义，否则按提案契约新增）。
2. 检查 PATH/配置 `command` 可定位、`list_projects` 可执行、project 解析、索引状态。
3. 输出结构化 `{ok, binary, project, nextSteps}`（含 `index_repository` 等 next steps）。
4. 绝不修改用户环境（不安装、不索引、不写配置）；普通 `archguard mcp` 启动不触发本检查。

## Proposed Approach
doctor 子命令复用 child 1 client/project-resolver 做只读探测，复用 child 2 `command` 配置。结果聚合为结构化对象。单测用 mock client，不依赖外部 binary。

## Trade-offs and Risks
- 不实现 install/自动索引（提案非目标）。
- 风险：PR #60 是否合入未知 → 设计为"复用 if 已合入，否则按契约新增"，不阻塞其余子任务。

---

# Plan: config doctor codebase-memory 只读检查命令

Proposal: docs/proposals/proposal-codebase-memory-backend-adapter.md

## Phase A: doctor 子命令骨架与结构化输出
### Tests (write first)
- 新增 `tests/unit/cli/commands/doctor.codebase-memory.test.ts`：mock client，断言输出 `{ok, binary, project, nextSteps}` 结构；binary 缺失/未索引各产出对应 nextSteps。
### Implementation
- 新增 doctor 子命令文件于 `src/cli/`（复用 child 1 client/project-resolver）。
### DoD
- [ ] `npm test -- --run tests/unit/cli/commands/doctor.codebase-memory.test.ts`
- [ ] `grep -rq "list_projects" src/cli/`

## Phase B: 只读保证与 next steps
### Tests (write first)
- 在 doctor 测试覆盖：检查路径绝不写文件/不改环境（mock 断言无写操作）、project 解析与索引状态分支、`index_repository` next step。
### Implementation
- 完善 doctor 检查逻辑与 nextSteps 生成。
### DoD
- [ ] `npm test -- --run tests/unit/cli/commands/doctor.codebase-memory.test.ts`
- [ ] `npm run type-check`

## Constraints
- 只读：不安装、不索引、不写配置；普通 mcp 启动不触发。
- 测试用 mock client，不依赖外部 binary。

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-28T02:51:46Z

Completed: 2026-06-28T02:58:52Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/cli/commands/doctor.codebase-memory.test.ts
- [ ] #2 grep -rq list_projects src/cli/
- [ ] #3 npm test
- [ ] #4 npm run type-check
<!-- DOD:END -->
