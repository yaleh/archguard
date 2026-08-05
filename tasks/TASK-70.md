---
id: TASK-70
title: "TASK-70: 采纳 --prefer-offline 卫生项（3 个 npm 安装集成测试走本地缓存）"
status: todo
labels:
  - hygiene
  - integration-test
parent: null
children: []
extra:
  schema: v1
  source: outer-direction-2026-08-05（TASK-57 遗留项）
---
# TASK-70: 采纳 --prefer-offline 卫生项

## Proposal

TASK-57 实测 `--prefer-offline`（3 个 top-5 慢安装集成测试走本地缓存）：3 次全量墙钟 481.27s vs
基线 ~475s = **无净改善，完全落 σ 噪声内**——不作为优化合并。但改动本身是**安全卫生项**
（用本地 npm 缓存，减少网络依赖），当时记录留待外层单独裁定采纳。

**本次裁定：采纳为卫生项**（不 claim 优化，只减少外部网络依赖的脆弱性）。改动：3 文件 +15 行。

**改动清单**（TASK-57 Evidence 记录）：
- `tests/integration/plugin-install.test.ts`：npm install 加 `--prefer-offline`
- `tests/integration/install-policy.test.ts`：npm install 加 `--prefer-offline`
- `tests/integration/installer-claude-user-scope.test.ts`：env 加 `NPM_CONFIG_PREFER_OFFLINE: 'true'`

### 选定机制

按 TASK-57 记录的改动直接落地（3 文件 +15 行），跑 scoped 验证（3 个慢文件）。这是卫生采纳，
不是优化 claim——验收判据是「不回归」不是「变快」。

## Acceptance Criteria

- [ ] 3 个集成测试文件按 TASK-57 Evidence 落地 --prefer-offline / NPM_CONFIG_PREFER_OFFLINE
- [ ] `npx vitest run tests/integration/plugin-install.test.ts tests/integration/install-policy.test.ts tests/integration/installer-claude-user-scope.test.ts` 全绿
- [ ] 改动文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [ ] 不 claim 性能优化（无改善声明，只是卫生采纳）

## Touches

- `tests/integration/plugin-install.test.ts`
- `tests/integration/install-policy.test.ts`
- `tests/integration/installer-claude-user-scope.test.ts`
- `tasks/TASK-70.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 3 个慢文件 scoped 测试的 pass/fail + `npm run lint` 的 error 计数 |
| band | scoped 全绿；lint 0 error（不引入新 error） |
| invariant | 不改测试断言语义（只加 npm 安装参数/env） |
| invoke | `npx vitest run tests/integration/plugin-install.test.ts tests/integration/install-policy.test.ts tests/integration/installer-claude-user-scope.test.ts` |
| control | 去掉 --prefer-offline → 测试仍绿（卫生项不改变行为） |
| resume | 每文件落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 3 文件改动落地 + scoped 全绿
- [ ] lint 0 error（新文件 lint-clean）
- [ ] 无性能优化 claim（卫生采纳声明写进任务体）
