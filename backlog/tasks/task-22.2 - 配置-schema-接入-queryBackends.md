---
id: TASK-22.2
title: 配置 schema 接入 queryBackends
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:08'
updated_date: '2026-06-28 02:32'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
在 src/types/config-global.ts（GlobalConfig / ArchGuardConfig 接口）与 src/cli/config-loader.ts 的 zod schema 增加可选 queryBackends（primary / fallback / codebaseMemory.{command,project,autoIndex,timeoutMs,maxResults}），约定显式 CLI/MCP 参数优先级高于配置；含 schema 默认值与校验单测。横切提案阶段 1-5。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: 配置 schema 接入 queryBackends

## Background
后端选择能力需要一处可声明的配置基座：默认后端、fallback 顺序、codebase-memory 的 command/project/timeout/maxResults。若不先建立 `queryBackends` 配置类型与 zod 校验，后续 CLI(child 4)/MCP(child 5)/doctor(child 6) 接入会各自硬编码默认值，优先级语义无处统一。本子任务是 epic TASK-22 的横切前置基座（提案阶段 1-5）。

## Goals
1. 在 `src/types/config-global.ts` 的 `GlobalConfig` / `ArchGuardConfig` 接口增加可选 `queryBackends` 字段。
2. 在 `src/cli/config-loader.ts` 的 zod schema 增加 `queryBackends`（`primary` / `fallback` / `codebaseMemory.{command,project,autoIndex,timeoutMs,maxResults}`），全部可选并带默认值。
3. 约定优先级：显式 CLI/MCP 参数 > 配置文件 > 默认值；通过单测验证。
4. 配置缺省时行为不变（不传 `queryBackends` 等价于 `primary: archguard`）。

## Proposed Approach
扩展现有接口与 zod schema，新增字段全部 optional 并提供安全默认。优先级合并逻辑放在 config-loader 的解析出口，单测覆盖默认值填充与非法值拒绝。

## Trade-offs and Risks
- 不接 CLI/MCP/adapter 本体（后续 child）。
- 风险：新增 schema 误判旧配置非法 → 全部字段 optional，旧配置测试保持全绿。

---

# Plan: 配置 schema 接入 queryBackends

Proposal: docs/proposals/proposal-codebase-memory-backend-adapter.md

## Phase A: 配置类型与接口扩展
### Tests (write first)
- 新增/扩展 `tests/unit/cli/config-loader.queryBackends.test.ts`：断言 `GlobalConfig.queryBackends` 可选；不传时解析结果等价默认。
### Implementation
- 修改 `src/types/config-global.ts` 增加 `queryBackends` 接口。
### DoD
- [ ] `npm test -- --run tests/unit/cli/config-loader.queryBackends.test.ts`
- [ ] `npm run type-check`

## Phase B: zod schema 与默认值/优先级
### Tests (write first)
- 在同测试文件覆盖：默认值填充、非法值拒绝、显式参数覆盖配置的优先级。
### Implementation
- 修改 `src/cli/config-loader.ts` 增加 zod schema 与合并逻辑。
### DoD
- [ ] `npm test -- --run tests/unit/cli/config-loader.queryBackends.test.ts`
- [ ] `grep -q queryBackends src/cli/config-loader.ts`

## Constraints
- 所有新增字段可选；旧配置测试保持全绿。
- 不实现 adapter / CLI / MCP / doctor 本体。

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-28T02:21:28Z

Completed: 2026-06-28T02:32:29Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/cli/config-loader.queryBackends.test.ts
- [ ] #2 grep -q queryBackends src/cli/config-loader.ts
- [ ] #3 npm test
- [ ] #4 npm run type-check
<!-- DOD:END -->
