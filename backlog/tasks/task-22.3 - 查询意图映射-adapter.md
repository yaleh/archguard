---
id: TASK-22.3
title: 查询意图映射 adapter
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:08'
updated_date: '2026-06-28 02:40'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
新建 src/integrations/codebase-memory/adapter.ts：把 ArchGuard 查询意图映射到 Codebase Memory 工具——findEntity→search_graph(name_pattern)、getFileEntities→search_graph(file_pattern)、findCallers→trace_path(direction:inbound)、snippet enrichment→get_code_snippet、summary enrichment→get_architecture；含 trace_path 失败回退 search_graph 候选消歧、返回大小 limit；配 mock 单测。对应阶段 2-5 映射逻辑。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: 查询意图映射 adapter

## Background
集成层骨架（child 1）提供 client / project-resolver / envelope，但尚无"ArchGuard 查询意图 → Codebase Memory 工具"的映射。CLI(child 4) 与 MCP(child 5) 都只应依赖一个 `adapter`，而非各自拼工具调用，否则 fallback/消歧语义会发散。本子任务建立该 adapter，是 child 4/5 的唯一后端入口（提案阶段 2-5 映射逻辑）。

## Goals
1. 新建 `src/integrations/codebase-memory/adapter.ts`，依赖 child 1 的 client/project-resolver/types。
2. 映射：`findEntity`→`search_graph(name_pattern)`、`getFileEntities`→`search_graph(file_pattern)`、`findCallers`→`trace_path(direction:inbound)`、snippet enrichment→`get_code_snippet`、summary enrichment→`get_architecture`。
3. `trace_path` 失败时回退 `search_graph` 候选消歧；对返回大小施加 limit。
4. 所有出口返回 child 1 的 `BackendResult<T>` envelope，含 provenance 与 diagnostics。

## Proposed Approach
adapter 暴露 `findEntity` / `getFileEntities` / `findCallers` / `enrich*` 方法，内部调用 client 并消费 project-resolver。mock client 单测覆盖每个映射与回退路径。

## Trade-offs and Risks
- 不接 CLI/MCP（child 4/5）。不消费 config schema 本体（仅依赖类型，命令/timeout 默认值来自 child 2 类型）。
- 风险：schema 无损映射不可能 → 不可映射字段放入 `raw`/`source`，不伪装同一对象。

---

# Plan: 查询意图映射 adapter

Proposal: docs/proposals/proposal-codebase-memory-backend-adapter.md

## Phase A: findEntity / getFileEntities 映射
### Tests (write first)
- 新增 `tests/unit/integrations/codebase-memory/adapter.test.ts`：mock client，断言 `findEntity`/`getFileEntities` 映射到 `search_graph` 正确 pattern，返回 envelope。
### Implementation
- 新建 `src/integrations/codebase-memory/adapter.ts`（findEntity/getFileEntities）。
### DoD
- [ ] `npm test -- --run tests/unit/integrations/codebase-memory/adapter.test.ts`
- [ ] `test -f src/integrations/codebase-memory/adapter.ts`

## Phase B: findCallers 与 trace 回退消歧
### Tests (write first)
- 在 adapter.test.ts 覆盖 `findCallers`→`trace_path(inbound)`、trace 失败回退 `search_graph` 候选消歧、limit 截断。
### Implementation
- 扩展 adapter.ts 增加 findCallers + 回退逻辑。
### DoD
- [ ] `npm test -- --run tests/unit/integrations/codebase-memory/adapter.test.ts`
- [ ] `grep -q trace_path src/integrations/codebase-memory/adapter.ts`

## Phase C: enrichment 映射
### Tests (write first)
- 在 adapter.test.ts 覆盖 snippet enrichment→`get_code_snippet`、summary enrichment→`get_architecture`。
### Implementation
- 扩展 adapter.ts 增加 enrich 方法。
### DoD
- [ ] `npm test -- --run tests/unit/integrations/codebase-memory/adapter.test.ts`
- [ ] `npm run type-check`

## Constraints
- CLI/MCP 仅依赖 adapter；不可映射字段放入 raw/source。
- 测试用 mock client，不依赖外部 binary。

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-28T02:32:53Z

Completed: 2026-06-28T02:39:58Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/integrations/codebase-memory/adapter.test.ts
- [ ] #2 grep -q trace_path src/integrations/codebase-memory/adapter.ts
- [ ] #3 npm test
- [ ] #4 npm run type-check
<!-- DOD:END -->
