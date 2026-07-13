---
id: TASK-22.4
title: CLI query 命令后端接入
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:08'
updated_date: '2026-06-28 02:51'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
在 src/cli/commands/query.ts 增加 --backend archguard|codebase-memory|auto 与 --cbm-project，串接 adapter 与现有 src/cli/query/engine-loader.ts 路径；--entity/--file/--callers 支持 fallback/codebase-memory，--summary 仅 enrichment；CLI 文本输出加 provenance 页脚；默认仍 archguard。对应阶段 2-5 CLI 侧。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: CLI query 命令后端接入

## Background
集成层 adapter（child 3）就绪后，CLI `query` 命令需对外暴露后端选择能力，让用户在无 `.archguard/query` 产物时也能查询。CLI 必须仅依赖 adapter、默认仍走 archguard，否则会破坏现有逐字节兼容。本子任务接入 CLI 侧（提案阶段 2-5 CLI 侧）。

## Goals
1. 在 `src/cli/commands/query.ts` 增加 `--backend archguard|codebase-memory|auto` 与 `--cbm-project` 选项。
2. `--entity`/`--file`/`--callers` 支持 codebase-memory 后端与 auto fallback；`--summary` 仅做 enrichment。
3. 串接 child 3 adapter 与现有 `src/cli/query/engine-loader.ts` 路径；`src/cli/` 下无 `codebase-memory-mcp` 字面 subprocess 调用。
4. CLI 文本输出加 provenance 页脚（backend/projectRoot 等）；不传 `--backend` 时默认 archguard，现有 query 测试全绿。

## Proposed Approach
在 query 命令解析层读取新选项，路由到 adapter 或 engine-loader；envelope 的 provenance 渲染为文本页脚。优先级：显式 `--backend` > 配置 `queryBackends` > 默认 archguard。

## Trade-offs and Risks
- 不接 MCP（child 5）。不实现 doctor（child 6）。
- 风险：默认行为漂移 → 默认分支保持 archguard，现有 query 测试套件全绿作为门禁。

---

# Plan: CLI query 命令后端接入

Proposal: docs/proposals/proposal-codebase-memory-backend-adapter.md

## Phase A: backend 选项解析与默认不变
### Tests (write first)
- 新增 `tests/unit/cli/commands/query.backend.test.ts`：断言不传 `--backend` 走 archguard（现有行为）；`--backend` 选项被解析。
### Implementation
- 修改 `src/cli/commands/query.ts` 增加 `--backend`/`--cbm-project` 解析与路由骨架。
### DoD
- [ ] `npm test -- --run tests/unit/cli/commands/query.backend.test.ts`
- [ ] `! grep -rq "codebase-memory-mcp" src/cli/commands/query.ts`

## Phase B: codebase-memory / auto fallback 接入
### Tests (write first)
- 在 query.backend.test.ts 覆盖 `--entity --backend codebase-memory`（mock adapter 返回符号）、`--backend auto` fallback、provenance 页脚渲染。
### Implementation
- 串接 adapter 与 engine-loader；渲染 provenance 页脚。
### DoD
- [ ] `npm test -- --run tests/unit/cli/commands/query.backend.test.ts`
- [ ] `grep -q backend src/cli/commands/query.ts`

## Constraints
- `src/cli/` 下无 `codebase-memory-mcp` 字面 subprocess；仅依赖 adapter。
- 默认 archguard，现有 query 测试全绿。

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
- [ ] #1 npm test -- --run tests/unit/cli/commands/query.backend.test.ts
- [ ] #2 ! grep -rq codebase-memory-mcp src/cli/commands/query.ts
- [ ] #3 npm test
- [ ] #4 npm run type-check
<!-- DOD:END -->
