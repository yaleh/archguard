---
id: TASK-22.1
title: 集成层骨架：Client + Project Resolver + Result Envelope
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:06'
updated_date: '2026-06-28 02:32'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
新建 src/integrations/codebase-memory/{types,client,project-resolver}.ts：client.ts 封装 codebase-memory-mcp cli <tool> <json>（timeout/stdout-stderr 捕获/JSON parse/错误归一化），project-resolver.ts 基于 list_projects 实现 auto 解析（精确 path → 目录名 → 歧义诊断），types.ts 定义 BackendResult<T> envelope 与诊断类型；配 mock 单元测试与合约 fixture。对应提案阶段 1。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: 集成层骨架：Client + Project Resolver + Result Envelope

## Background
ArchGuard 查询能力强依赖 `archguard analyze` 产物。要复用已被 `codebase-memory-mcp` 索引的同一仓库，需先建立一个独立窄集成层骨架——封装 subprocess 边界、project 解析与统一响应 envelope，供后续 adapter / CLI / MCP / doctor 各入口复用，避免各入口各自发明不一致的 subprocess 调用与 fallback 语义。本子任务对应提案阶段 1，是 epic TASK-22 的基座。

## Goals
1. 新建 `src/integrations/codebase-memory/client.ts`，封装 `codebase-memory-mcp cli <tool> <json>` 调用：含 timeout、stdout/stderr 捕获、JSON parse、错误归一化为 diagnostics（binary 缺失 / timeout / parse 失败均不泄漏 subprocess 细节）。
2. 新建 `src/integrations/codebase-memory/project-resolver.ts`，基于 `list_projects` 实现 auto 解析：精确 path 优先 → 目录名匹配 → 歧义时返回诊断而非乱选。
3. 新建 `src/integrations/codebase-memory/types.ts`，定义 `BackendResult<T>` envelope（`backend` / `projectRoot` / 可选 `codebaseMemoryProject` / `stale` / `diagnostics`）与诊断类型。
4. 单元测试用 mock client + 合约 fixture（`search_graph.*.json` / `trace_path.*.json` / `list_projects.json`），不要求本机安装 `codebase-memory-mcp`。

## Proposed Approach
建立 `src/integrations/codebase-memory/` 目录，三个文件互相依赖最小化：`types.ts` 无依赖，`client.ts` 依赖 `types.ts`，`project-resolver.ts` 依赖 `client.ts` + `types.ts`。subprocess 经 `child_process` 封装并集中错误归一化。fixture 置于 `tests/fixtures/codebase-memory/`。

## Trade-offs and Risks
- 不实现 adapter 映射（后续 child 3）。不接 CLI / MCP（child 4/5）。
- 不进 `package.json` dependencies；测试默认 mock，不依赖外部 binary。
- 风险：codebase-memory CLI 输出 schema 漂移 → 用 fixture 锚定合约，parse 失败归一化为诊断。

---

# Plan: 集成层骨架：Client + Project Resolver + Result Envelope

Proposal: docs/proposals/proposal-codebase-memory-backend-adapter.md

## Phase A: types envelope 与诊断类型
### Tests (write first)
- 新增 `tests/unit/integrations/codebase-memory/types.test.ts`：断言 `BackendResult<T>` 含 `backend`/`projectRoot`/可选字段；诊断类型工厂函数产出可读 message。
### Implementation
- 新建 `src/integrations/codebase-memory/types.ts`。
### DoD
- [ ] `npm test -- --run tests/unit/integrations/codebase-memory/types.test.ts`
- [ ] `test -f src/integrations/codebase-memory/types.ts`

## Phase B: client subprocess 封装与错误归一化
### Tests (write first)
- 新增 `tests/unit/integrations/codebase-memory/client.test.ts`：mock subprocess，覆盖成功 JSON parse、binary 缺失、timeout、parse 失败四类，断言均归一化为 diagnostics。
### Implementation
- 新建 `src/integrations/codebase-memory/client.ts`，配 fixture `tests/fixtures/codebase-memory/*.json`。
### DoD
- [ ] `npm test -- --run tests/unit/integrations/codebase-memory/client.test.ts`
- [ ] `test -f src/integrations/codebase-memory/client.ts`

## Phase C: project-resolver auto 解析
### Tests (write first)
- 新增 `tests/unit/integrations/codebase-memory/project-resolver.test.ts`：基于 `list_projects.json` fixture，覆盖精确 path 命中、目录名命中、歧义诊断三类。
### Implementation
- 新建 `src/integrations/codebase-memory/project-resolver.ts`。
### DoD
- [ ] `npm test -- --run tests/unit/integrations/codebase-memory/project-resolver.test.ts`
- [ ] `test -f src/integrations/codebase-memory/project-resolver.ts`

## Constraints
- 不进 `package.json` dependencies；测试默认 mock，不依赖外部 binary。
- 仅本层，不接 CLI / MCP / adapter。

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
- [ ] #1 npm test -- --run tests/unit/integrations/codebase-memory/types.test.ts
- [ ] #2 npm test -- --run tests/unit/integrations/codebase-memory/client.test.ts
- [ ] #3 npm test -- --run tests/unit/integrations/codebase-memory/project-resolver.test.ts
- [ ] #4 npm test
- [ ] #5 npm run type-check
<!-- DOD:END -->
