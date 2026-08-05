---
id: TASK-76
title: "TASK-76: A 类——插件注册表/外部插件加载 E2E 稳定化"
status: todo
labels:
  - test-coverage
  - boundary-list
  - e2e
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-58 边界清单 A 类，分批最后一批）
---
# TASK-76: 插件注册表/外部插件加载 E2E 稳定化

## Proposal

TASK-58 边界清单 **A 类（用户可见契约 → 端到端）**：语言插件注册表 / 外部插件加载（插件边界是
用户可扩展面）。注册表契约（内置插件枚举、外部插件加载、配置注册）应被 E2E 守住。已有基础
（tests/integration 的 plugin 相关），本任务「保持 + 稳定」。

**分批裁定（外层 2026-08-05）**：A 类最后一批 = 插件注册表（TASK-73 CLI、TASK-74 config、
TASK-75 输出格式已落地）。

### 选定机制

审计插件注册表/外部加载的现有 E2E 覆盖；对缺口补契约断言（注册表列出内置插件、外部插件路径
加载、非法插件报错）。每契约独立判断。

## Acceptance Criteria

- [ ] 插件注册表/外部加载关键契约有 E2E 断言（内置枚举 / 外部加载 / 非法报错）
- [ ] 每个新增/修改断言有具体契约依据
- [ ] 插件相关 scoped 测试全绿
- [ ] 新增/修改文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不设全局 coverage 百分比目标

## Touches

- `tests/integration/*plugin*`（E2E 测试）
- `src/plugin-registry.ts` / `src/plugins/*`（测试触碰的入口——只读审计，不改造）
- `tasks/TASK-76.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 插件契约 E2E 断言数 + 插件 scoped 测试 pass |
| band | 关键插件契约有 E2E 断言；scoped 全绿 |
| invariant | 不改造插件实现（只审计 + 补断言）；不设全局 % |
| invoke | `npx vitest run tests/integration/` 插件相关 |
| control | 改注册表枚举/外部加载行为 → 对应 E2E 红 |
| resume | 每契约落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 插件契约 E2E 断言补全 + scoped 全绿
- [ ] 契约依据证据
- [ ] lint 0 error（新文件 lint-clean）
