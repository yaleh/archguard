---
id: TASK-75
title: "TASK-75: A 类——输出格式契约 E2E 稳定化（ArchJSON/mermaid/SVG 渲染）"
status: ready
labels:
  - test-coverage
  - boundary-list
  - e2e
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-58 边界清单 A 类，分批第三批）
---
# TASK-75: 输出格式契约 E2E 稳定化

## Proposal

TASK-58 边界清单 **A 类（用户可见契约 → 端到端）**：输出格式契约 = ArchJSON schema、mermaid
输出、SVG/PNG 渲染（tests/integration/mermaid/e2e 已覆盖）。接口变更必须被 E2E 守住。本任务
「保持 + 稳定」：审计现有输出格式 E2E 覆盖，补缺口的契约断言。

**分批裁定（外层 2026-08-05）**：A 类第三批 = 输出格式契约（TASK-73 CLI、TASK-74 config 已落地）。

### 选定机制

审计 ArchJSON/mermaid/SVG 渲染的 E2E 覆盖；对缺口补契约断言（ArchJSON schema 字段、mermaid
关键结构、渲染产物存在性/内容）。每输出格式独立判断。

## Acceptance Criteria

- [ ] 输出格式关键契约有 E2E 断言（ArchJSON schema / mermaid 结构 / 渲染产物）
- [ ] 每个新增/修改断言有具体契约依据
- [ ] `npx vitest run tests/integration/mermaid/` 全绿
- [ ] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不设全局 coverage 百分比目标

## Touches

- `tests/integration/mermaid/*`（E2E 测试）
- `tests/integration/*archjson*` / `*render*`（相关 E2E）
- `tasks/TASK-75.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 输出格式契约 E2E 断言数 + `npx vitest run tests/integration/mermaid/` pass |
| band | 关键输出契约有 E2E 断言；scoped 全绿 |
| invariant | 不改造输出实现（只审计 + 补断言）；不设全局 % |
| invoke | `npx vitest run tests/integration/mermaid/e2e.test.ts` |
| control | 改一个输出结构（如 mermaid 标题/层级）→ 对应 E2E 红 |
| resume | 每格式落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 输出格式契约 E2E 断言补全 + scoped 全绿
- [ ] 契约依据证据
- [ ] lint 0 error（新文件 lint-clean）
