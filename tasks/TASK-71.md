---
id: TASK-71
title: "TASK-71: B 类剩余——kotlin 插件分支密集路径直接 import 单测"
status: todo
labels:
  - test-coverage
  - boundary-list
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-59 边界清单 B 类剩余项）
---
# TASK-71: kotlin 插件分支密集路径单测

## Proposal

TASK-58 边界清单（交付物）B 类：**分支密集纯函数 → 直接 import 单测**。TASK-59 已覆盖
parser/shared/atlas/mermaid/analysis，**剩余项包含 kotlin 插件**：
`src/plugins/kotlin/*-extractor.ts`、`*-mapper.ts`、`index.ts`——分支密集但缺少直接 import 单测。
遵循 TASK-58/59 判据：**不设全局百分比目标**，逐模块判断哪些边界值得稳定。

### 选定机制

对 kotlin 插件逐文件分析分支密集路径（extractor 的语法分支、mapper 的映射分支、index 的插件
装配），为**值得稳定**的边界补直接 import 单测。每文件独立判断（不凑数）。

## Acceptance Criteria

- [ ] kotlin 插件值得稳定的分支密集路径有直接 import 单测（`tests/unit/plugins/kotlin/`）
- [ ] 每个新增测试文件有负控制或覆盖具体分支的证据（不是空转）
- [ ] `npx vitest run tests/unit/plugins/kotlin/` 全绿
- [ ] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不设全局 coverage 百分比目标（按模块判断）

## Touches

- `src/plugins/kotlin/*`（extractor/mapper/index——测试触碰的实现文件）
- `tests/unit/plugins/kotlin/*`（新增测试）
- `tasks/TASK-71.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | kotlin 插件值得稳定边界的直接 import 测试数 + `npx vitest run tests/unit/plugins/kotlin/` pass |
| band | 分支密集边界有测试覆盖；scoped 全绿 |
| invariant | 不触碰非 kotlin 文件；不设全局 % 目标 |
| invoke | `npx vitest run tests/unit/plugins/kotlin/` |
| control | 变异一个分支（如改 mapper 映射条件）→ 对应测试红（测试真抓分支） |
| resume | 每文件落盘；被打断可从缺口续 |

## Definition of Done

- [ ] kotlin 分支密集边界单测落地 + scoped 全绿
- [ ] 负控制证据（变异分支 → 测试红）
- [ ] lint 0 error（新文件 lint-clean）
