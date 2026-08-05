---
id: TASK-73
title: "TASK-73: A 类——CLI 命令族 E2E 稳定化（analyze/init/cache 用户入口契约）"
status: ready
labels:
  - test-coverage
  - boundary-list
  - e2e
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-58 边界清单 A 类，分批第一批）
---
# TASK-73: CLI 命令族 E2E 稳定化

## Proposal

TASK-58 边界清单 **A 类（用户可见契约 → 端到端）**：CLI 命令族 `analyze` / `init` / `cache`
（src/cli/commands）是用户入口，全链路 parse→generate→render→output 应走 E2E。已有
`tests/integration/cli/` 基础，本任务「保持 + 稳定」：审计现有 E2E 覆盖，补缺口的契约断言
（命令退出码、输出存在性、关键输出内容），不新建重复测试。

**分批裁定（外层 2026-08-05）**：A 类分多批，本任务第一批 = CLI 命令族。

### 选定机制

审计 `tests/integration/cli/` 现有 E2E 对 analyze/init/cache 的覆盖；对缺口补契约断言
（如 analyze 产出 ArchJSON 字段、init 生成 config 文件、cache 命令的清除/统计行为）。
每命令独立判断，不凑数。

## Acceptance Criteria

- [ ] analyze/init/cache 三个命令的 E2E 契约断言完整（退出码 + 关键输出）
- [ ] 每个新增/修改断言有具体契约依据（不是空转）
- [ ] `npx vitest run tests/integration/cli/` 全绿
- [ ] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不设全局 coverage 百分比目标

## Touches

- `tests/integration/cli/*`（E2E 测试）
- `src/cli/commands/analyze.ts` / `init.ts` / `cache.ts`（测试触碰的入口——只读审计，不改造）
- `tasks/TASK-73.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 三命令 E2E 契约断言数 + `npx vitest run tests/integration/cli/` pass |
| band | 关键用户契约有 E2E 断言；scoped 全绿 |
| invariant | 不改造 CLI 实现（只审计 + 补测试断言）；不设全局 % |
| invoke | `npx vitest run tests/integration/cli/` |
| control | 改一个命令的退出码/输出契约 → 对应 E2E 红 |
| resume | 每命令落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 三命令 E2E 契约断言补全 + scoped 全绿
- [ ] 契约依据证据（每个断言对应的用户可见行为）
- [ ] lint 0 error（新文件 lint-clean）
