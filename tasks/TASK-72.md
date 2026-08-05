---
id: TASK-72
title: "TASK-72: B 类剩余——core mermaid generator 深层分支直接 import 单测"
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
# TASK-72: core mermaid generator 深层分支单测

## Proposal

TASK-58 边界清单 B 类：**分支密集纯函数 → 直接 import 单测**。TASK-59 已补 mermaid
generator-formatting/grouper-extra/atlas renderers，**剩余：core 主 generator 的深层分支**
（`src/mermaid/generator.ts` 或等价文件——实体/关系处理、过滤、分组的深层条件分支）。
遵循 TASK-58/59 判据：**不设全局百分比目标**，逐边界判断。

### 选定机制

对 core mermaid generator 的分支密集路径（实体去重、关系过滤、分组、跳过逻辑等）补直接
import 单测。每边界独立判断是否值得稳定（不是凑覆盖）。

## Acceptance Criteria

- [ ] core mermaid generator 值得稳定的分支密集路径有直接 import 单测（`tests/unit/mermaid/`）
- [ ] 每个新增测试有负控制或覆盖具体分支的证据
- [ ] `npx vitest run tests/unit/mermaid/` 全绿
- [ ] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不设全局 coverage 百分比目标

## Touches

- `src/mermaid/generator.ts`（及 core 生成路径的实现文件——测试触碰的）
- `tests/unit/mermaid/*`（新增测试）
- `tasks/TASK-72.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | core generator 值得稳定边界的直接 import 测试数 + `npx vitest run tests/unit/mermaid/` pass |
| band | 分支密集边界有测试覆盖；scoped 全绿 |
| invariant | 不触碰非 mermaid 文件；不设全局 % 目标 |
| invoke | `npx vitest run tests/unit/mermaid/` |
| control | 变异一个分支（如改过滤条件）→ 对应测试红 |
| resume | 每边界落盘；被打断可从缺口续 |

## Definition of Done

- [ ] core generator 分支密集边界单测落地 + scoped 全绿
- [ ] 负控制证据（变异分支 → 测试红）
- [ ] lint 0 error（新文件 lint-clean）
