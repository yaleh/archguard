---
id: TASK-70
title: "TASK-70: 采纳 --prefer-offline 卫生项（3 个 npm 安装集成测试走本地缓存）"
status: done
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

- [x] 3 个集成测试文件按 TASK-57 Evidence 落地 --prefer-offline / NPM_CONFIG_PREFER_OFFLINE
- [x] `npx vitest run tests/integration/plugin-install.test.ts tests/integration/install-policy.test.ts tests/integration/installer-claude-user-scope.test.ts` 全绿
- [x] 改动文件 lint-clean（`npm run lint` 不引入新 error——治本规则）
- [x] 不 claim 性能优化（无改善声明，只是卫生采纳）

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

## Execution（2026-08-05，内层执行）

**改动**（3 文件，TASK-57 Evidence 直接落地，只加 npm 安装参数/env，未改测试断言语义）：
- `tests/integration/plugin-install.test.ts`：npm install 数组加 `--prefer-offline`
- `tests/integration/install-policy.test.ts`：npm install 数组加 `--prefer-offline`
- `tests/integration/installer-claude-user-scope.test.ts`：real-claude 边界测试 `isolatedEnv` 加 `NPM_CONFIG_PREFER_OFFLINE: 'true'`

**invoke 实跑证据**（worktree `task/TASK-70`，先 `npm run build` 后跑）：
```
$ npx vitest run tests/integration/plugin-install.test.ts tests/integration/install-policy.test.ts tests/integration/installer-claude-user-scope.test.ts
 ✓ tests/integration/plugin-install.test.ts (14 tests) 93840ms
 ✓ tests/integration/installer-claude-user-scope.test.ts (33 tests) 80509ms
 ✓ tests/integration/install-policy.test.ts (8 tests) 57829ms

 Test Files  3 passed (3)
      Tests  55 passed (55)
   Start at  15:51:52
   Duration  238.55s (transform 2.55s, setup 0ms, collect 5.24s, tests 232.18s, ...)

VITEST EXIT: 0
```
注：install-policy 驱动跑会输出 gopls unavailable / Language.query deprecated 的 stderr 警告（既有现象，非失败）。

**lint（scoped，治本规则）**：`npx eslint tests/integration/plugin-install.test.ts tests/integration/install-policy.test.ts tests/integration/installer-claude-user-scope.test.ts --ext .ts` → 0 errors（125 既有 warning，均不在改动行）。`npx prettier --check` 3 文件 → 全 clean。

**卫生采纳声明**：本任务只采纳 `--prefer-offline` 卫生项（本地 npm 缓存优先，减少外部网络依赖脆弱性），**不 claim 任何性能优化**（TASK-57 已实测无净改善，落 σ 噪声内）。

## Definition of Done

- [x] 3 文件改动落地 + scoped 全绿
- [x] lint 0 error（新文件 lint-clean）
- [x] 无性能优化 claim（卫生采纳声明写进任务体）
