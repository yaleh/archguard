---
id: TASK-74
title: "TASK-74: A 类——config 语义 E2E 稳定化（archguard.config.json 加载与字段行为）"
status: ready
labels:
  - test-coverage
  - boundary-list
  - e2e
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-58 边界清单 A 类，分批第二批）
---
# TASK-74: config 语义 E2E 稳定化

## Proposal

TASK-58 边界清单 **A 类（用户可见契约 → 端到端）**：`archguard.config.json` 加载与字段行为
（src/cli/config-loader、config-*）是用户入口契约——配置字段语义、默认值、覆盖、非法配置的
报错都应被 E2E 守住。已有集成测试基础（`tests/integration/custom-config-path.test.ts` 等），
本任务「保持 + 稳定」：审计现有覆盖，补缺口的契约断言。

**分批裁定（外层 2026-08-05）**：A 类分多批，本任务第二批 = config 语义（TASK-73 CLI 命令族
是第一批）。TASK-73 落地后派发。

### 选定机制

审计 config 加载/字段行为的现有 E2E 覆盖；对缺口补契约断言（如自定义 config 路径、字段默认值
与覆盖、非法 config 的退出码/报错信息）。每字段独立判断，不凑数。

## Acceptance Criteria

- [ ] config 加载关键契约有 E2E 断言（自定义路径、默认值、覆盖、非法 config 报错）
- [ ] 每个新增/修改断言有具体契约依据
- [ ] `npx vitest run tests/integration/` 中 config 相关全绿
- [ ] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不设全局 coverage 百分比目标

## Touches

- `tests/integration/*config*`（E2E 测试）
- `src/cli/config-loader.ts` / `config-*`（测试触碰的入口——只读审计，不改造）
- `tasks/TASK-74.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | config 契约 E2E 断言数 + config 相关 scoped 测试 pass |
| band | 关键 config 契约有 E2E 断言；scoped 全绿 |
| invariant | 不改造 config 实现（只审计 + 补测试断言）；不设全局 % |
| invoke | `npx vitest run tests/integration/custom-config-path.test.ts` |
| control | 改一个 config 字段的默认值/报错 → 对应 E2E 红 |
| resume | 每字段落盘；被打断可从缺口续 |

## Definition of Done

- [ ] config 契约 E2E 断言补全 + scoped 全绿
- [ ] 契约依据证据
- [ ] lint 0 error（新文件 lint-clean）
