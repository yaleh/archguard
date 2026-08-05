---
id: TASK-68
title: "TASK-68: npm run lint 不通过（13 errors）——.quay/vendor 被 lint + query.ts 格式"
status: todo
labels:
  - defect
  - hygiene
  - lint
parent: null
children: []
extra:
  schema: v1
  source: outer-ac-audit-2026-08-05
---
# TASK-68: npm run lint 不通过（13 errors）

## Proposal

外层 AC 审计勾 TASK-50 DoD #4（npm run lint）时实测 `npm run lint`（`eslint . --ext .ts`）
**不通过**：13 errors / 3880 warnings（`/tmp/archguard-lint-full.log`，LINT_EXIT=1）。

**错误分解（已定位）**：
1. **`.quay/` 备份目录 4 个 Parsing error**：`pre-task67-merge-untracked/full-suite-runner.ts`、
   `suite-state-trigger.ts`、`quay-init-backups/1785910228/it0-split-or-commit-check.ts`——
   瞬态备份的 experimental-syntax .ts（`import.meta`/`type`），主 eslint parser 不认。
   **根因：无 `.eslintignore`，`eslint .` 扫了 `.quay/` 运行时态/备份。**
2. **`vendor/quay/dist/*.js` 7 个 rule-not-found**：vendor 打包 JS 内联引用
   `@typescript-eslint/prefer-nullish-coalescing` / `unbound-method` / `no-explicit-any`，
   这些规则定义没被 eslint 加载。**根因：vendor 目录被 lint，不应。**
3. **`src/cli/commands/query.ts` 2 个 formatting error**（TASK-64 ADR-007 修复新增代码）：
   prettier 格式（`Replace \`·dInt...` 等），`npx prettier --write` 可修。

**影响**：CI 若跑 lint 会红；TASK-62 DoD #8 / TASK-64 DoD #11（npm run lint）不满足（外层审计
实测后未勾）。full-suite 是 vitest-only 不覆盖 lint——5019/0 绿但 lint 有错。

### 选定机制

1. 加 `.eslintignore`（或 eslint config `ignorePatterns`）：排除 `.quay/`、`vendor/`。
2. `npx prettier --write src/cli/commands/query.ts` 修 2 个 formatting。
3. 重跑 `npm run lint`：期望 0 errors（warnings 现状可容忍或另立清理）。

## Acceptance Criteria

- [ ] `npm run lint` 退出 0（errors = 0）
- [ ] `.quay/` 和 `vendor/` 不再被 eslint 扫描（Parsing error / rule-not-found 消失）
- [ ] `src/cli/commands/query.ts` prettier 格式通过（无 formatting error）
- [ ] 不引入新 warnings（对比修复前后 warnings 数不增）

## Touches

- `.eslintignore`（新建）或 `.eslintrc.json`（ignorePatterns）
- `src/cli/commands/query.ts`（prettier 格式）
- `tasks/TASK-68.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | `npm run lint` 的 error 计数（期望 0）与 warnings 计数（不增） |
| band | errors = 0；warnings ≤ 修复前 3880 |
| invariant | 不删除/降级任何 lint 规则本身（只加 ignore 范围 + 格式） |
| invoke | `npm run lint` |
| control | 若仅靠删规则/改 severity 达 0 errors ⇒ 判定不成立（必须 ignore 范围 + 格式） |
| resume | 每修一类即重跑 lint 落盘；被打断可从缺口续 |

## Definition of Done

- [ ] `npm run lint` exit 0
- [ ] `.quay/`/`vendor/` 被排除（新增 .eslintignore）
- [ ] `query.ts` prettier 通过
