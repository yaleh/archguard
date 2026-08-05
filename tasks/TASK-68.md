---
id: TASK-68
title: "TASK-68: npm run lint 不通过（13 errors）——.quay/vendor 被 lint + query.ts 格式"
status: ready
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

- [x] `npm run lint` 退出 0（errors = 0）
- [x] `.quay/` 和 `vendor/` 不再被 eslint 扫描（Parsing error / rule-not-found 消失）
- [x] `src/cli/commands/query.ts` prettier 格式通过（无 formatting error）
- [x] 不引入新 warnings（对比修复前后 warnings 数不增）

### Lint 实跑证据（TASK-68 执行，worktree @ 380c079）

**修复前（baseline，worktree 380c079）**：
```
✖ 3945 problems (23 errors, 3922 warnings)
  23 errors and 0 warnings potentially fixable with the `--fix` option.
LINT_EXIT=1
```
23 errors 分解：8 个文件 prettier 格式错误（`drift-calculator.ts`、`analyze.ts`、
`query.ts`、`drift-baseline.ts`、`drift-reporter.ts`、`drift-calculator.test.ts`、
`analyze-drift.test.ts`、`arch-health-drift-tool.test.ts`）+ 6 个
`no-unnecessary-type-assertion`（`drift-calculator.ts` 111/112/113、
`drift-calculator.test.ts` 90/92/128）。主仓库另有 `.quay/` 3 个 .ts（Parsing error）与
`vendor/quay/dist/quay.js` + `vendor/quay-native/dist/quay-native.js`（rule-not-found，
inline eslint-disable 引用未加载规则）；worktree 不含这些 untracked 文件故未计入。
注：任务立案时录得 13 errors / 3880 warnings（/tmp/archguard-lint-full.log），
TASK-65 fan-in 新增 JL drift 文件后当前基线为 23 errors / 3922 warnings。

**修复后**：
```
✖ 3919 problems (0 errors, 3919 warnings)
EXIT=0
```
warnings 3922 → 3919（净 -3，来自移除 3 个 non-null assertion warning，不增）。

**ignore 机制实证**：ESLint v9 为 flat config（`eslint.config.js`），`.eslintignore`
已不再支持（实测触发 `ESLintIgnoreWarning`），故排除 `.quay/`/`vendor/` 通过
`eslint.config.js` `ignores` 数组新增 `'.quay/**'` + `'vendor/**'` 实现；用合成
`import.meta` .ts 与 inline-disable .js 验证二者不再被扫描。

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
