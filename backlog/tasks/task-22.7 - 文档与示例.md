---
id: TASK-22.7
title: 文档与示例
status: 'Basic: Done'
assignee: []
created_date: '2026-06-28 02:10'
updated_date: '2026-06-28 03:04'
labels:
  - 'kind:basic'
dependencies: []
parent_task_id: TASK-22
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
更新 docs/user-guide 与 docs/dev-guide：安装预期、config doctor codebase-memory 用法、index_repository 索引命令、backend 选择语义与限制、CLI/MCP 示例，并说明为何普通查询路径不自动索引。对应提案阶段 6。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Plan: 文档与示例

## Context
codebase-memory 后端能力（CLI/MCP/doctor）落地后，用户与开发者需要文档说明安装预期、doctor 用法、索引命令、backend 选择语义与限制。本子任务是 epic TASK-22 的收尾（提案阶段 6），依赖前序面向用户能力（child 4/5/6）基本就绪。纯文档，不改代码。

## Phase A: user-guide 后端使用文档
更新或新增 `docs/user-guide/codebase-memory-backend.md`：安装预期（可选依赖，不进 dependencies）、`archguard config doctor codebase-memory` 用法、`index_repository` 索引命令、`--backend archguard|codebase-memory|auto` 选择语义、CLI 示例、limitations（Atlas / 测试分析 / git history / 架构图 / analyze 不走 Codebase Memory），并说明为何普通查询路径不自动索引。
### Tests (write first)
- 文档校验命令：确认新增 user-guide 文件存在且覆盖关键小节（doctor / index_repository / backend / limitations）。
### DoD
- [ ] `test -f docs/user-guide/codebase-memory-backend.md`
- [ ] `grep -q index_repository docs/user-guide/codebase-memory-backend.md`
- [ ] `grep -q "auto" docs/user-guide/codebase-memory-backend.md`

## Phase B: dev-guide 与 MCP 示例
更新 `docs/dev-guide`（架构集成层说明）与 MCP 工具 backend 入参示例；说明 adapter 边界（CLI/MCP 仅依赖 adapter）与 envelope provenance 语义。
### Tests (write first)
- 文档校验命令：确认 dev-guide 覆盖 integrations/codebase-memory 集成层与 MCP backend 示例。
### DoD
- [ ] `grep -rq "codebase-memory" docs/dev-guide`
- [ ] `grep -rq "backend" docs/dev-guide`

## Constraints
- 纯文档，不修改 src/ 代码。
- 不重复 proposal 全文，聚焦用户/开发者可操作内容。

## Acceptance Gate
- [ ] `test -f docs/user-guide/codebase-memory-backend.md`
- [ ] `grep -rq "codebase-memory" docs/dev-guide`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-28T02:59:54Z

Completed: 2026-06-28T03:04:31Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 test -f docs/user-guide/codebase-memory-backend.md
- [ ] #2 grep -q index_repository docs/user-guide/codebase-memory-backend.md
- [ ] #3 grep -rq codebase-memory docs/dev-guide
<!-- DOD:END -->
