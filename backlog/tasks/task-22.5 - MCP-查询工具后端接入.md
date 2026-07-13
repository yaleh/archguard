---
id: TASK-22.5
title: MCP 查询工具后端接入
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:08'
updated_date: '2026-06-28 02:51'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
给 src/cli/mcp/mcp-server.ts（archguard_find_entity / archguard_get_file_entities / archguard_summary）与 src/cli/mcp/tools/call-graph-tools.ts（archguard_find_callers）增加可选 backend / projectRoot / codebaseMemoryProject 入参，返回统一 envelope，默认行为不变。对应阶段 2-5 MCP 侧。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: MCP 查询工具后端接入

## Background
与 CLP 侧对称，MCP 查询工具（`archguard_find_entity` / `archguard_get_file_entities` / `archguard_summary` / `archguard_find_callers`）也需可选后端入参，让 agent 在无 ArchGuard 产物时复用 Codebase Memory 图谱。MCP 默认行为必须不变、且不让 server 崩溃。本子任务接入 MCP 侧（提案阶段 2-5 MCP 侧）。

## Goals
1. 给 `src/cli/mcp/mcp-server.ts`（`archguard_find_entity` / `archguard_get_file_entities` / `archguard_summary`）增加可选 `backend` / `projectRoot` / `codebaseMemoryProject` 入参。
2. 给 `src/cli/mcp/tools/call-graph-tools.ts`（`archguard_find_callers`）增加同样可选入参。
3. 工具返回统一 `BackendResult<T>` envelope（含 provenance / diagnostics）；后端错误归一化为诊断，不让 MCP server 崩溃。
4. 不传 `backend` 时默认行为逐字节不变，现有 MCP 工具测试全绿。

## Proposed Approach
扩展工具 input schema 增加 optional 参数，handler 路由到 child 3 adapter 或现有引擎；错误经 try/catch 归一化为 envelope diagnostics。

## Trade-offs and Risks
- 不接 CLI（child 4）。不实现 doctor（child 6）。
- 风险：未捕获错误使 server 崩溃 → handler 全程 try/catch，错误归一化为 diagnostics envelope。

---

# Plan: MCP 查询工具后端接入

Proposal: docs/proposals/proposal-codebase-memory-backend-adapter.md

## Phase A: mcp-server 三工具入参与默认不变
### Tests (write first)
- 新增 `tests/unit/cli/mcp/mcp-server.backend.test.ts`：断言不传 `backend` 时 `archguard_find_entity`/`get_file_entities`/`summary` 行为不变；可选入参被接受。
### Implementation
- 修改 `src/cli/mcp/mcp-server.ts` 三工具增加可选入参并路由。
### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/mcp-server.backend.test.ts`
- [ ] `grep -q backend src/cli/mcp/mcp-server.ts`

## Phase B: find_callers 入参与错误归一化
### Tests (write first)
- 新增 `tests/unit/cli/mcp/call-graph-tools.backend.test.ts`：覆盖 `archguard_find_callers` 可选入参、后端错误归一化为 diagnostics envelope（server 不崩溃）。
### Implementation
- 修改 `src/cli/mcp/tools/call-graph-tools.ts` 增加可选入参与 try/catch 归一化。
### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/call-graph-tools.backend.test.ts`
- [ ] `! grep -rq "codebase-memory-mcp" src/cli/mcp/tools/call-graph-tools.ts`

## Constraints
- 仅依赖 adapter；`src/cli/` 下无 `codebase-memory-mcp` 字面 subprocess。
- 默认行为逐字节不变，现有 MCP 测试全绿。

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-28T02:40:59Z

Completed: 2026-06-28T02:50:46Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/cli/mcp/mcp-server.backend.test.ts
- [ ] #2 npm test -- --run tests/unit/cli/mcp/call-graph-tools.backend.test.ts
- [ ] #3 npm test
- [ ] #4 npm run type-check
<!-- DOD:END -->
