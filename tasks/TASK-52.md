---
id: TASK-52
title: "TASK-52: Reduce lint errors to 0"
status: done
labels:
  - defect
  - lint
parent: null
extra:
  schema: v1
---

# TASK-52: Reduce lint errors to 0

status: done

## Summary

`npm run lint` exits 1 with 234 errors (3853 warnings). After `eslint --fix`
reduced from 480 → 234 errors. Remaining 234 errors are mostly
`@typescript-eslint/no-unsafe-*` and `@typescript-eslint/no-explicit-any`
violations that cannot be auto-fixed.

## Evidence

```
✖ 4087 problems (234 errors, 3853 warnings)
FIX_EXIT=1
```

Detailed breakdown: `/tmp/lint-fix.log` (5194 lines). Pre-fix baseline: 480 errors / 4137 warnings.

## Contract

| Key | Value |
|---|---|
| measure | `npm run lint; echo $?` 退出码 + error count |
| band | exit 0, 0 errors（warnings 不计入阻塞） |
| invariant | 修复过程不引入新的 type-check 错误（`npm run type-check` 保持 exit 0） |
| invoke | `npm run lint`（全量验证） + `npm run type-check`（回归检查） |
| control | 修复前：234 errors；修复后目标：0 errors |
| resume | 若某条 rule 的修复代价过高（如 `no-explicit-any` 需大量类型重写），可先加 `// eslint-disable-next-line` 并建后续任务逐条清理，但总数必须降到 0 |

## Completion

| Key | Value |
|---|---|
| measure | `npm run lint; echo $?` 退出码 = **0**，errors = **0** |
| band | exit 0, 0 errors — 满足 |
| invariant | `npm run type-check` 退出码 = **0**（未引入新错误）— 满足 |
| invoke | 全量 lint + type-check 均通过 |
| control | 修复前 234 errors → 修复后 **0 errors** |

**错误构成与处置**（修复时的基线实测 237 errors = 234 parser + 3 个单发 rule error）：

| # | 数量 | 来源 | 处置 |
|---|------|------|------|
| 1 | 234 | **parser error**（`plugin/dist/*.d.ts` 231 + `plugin/scripts/*.ts` 3）——ESLint 用默认 espree 解析 `plugin/` 下非 src/tests 的 .ts，无法解析 | `eslint.config.js` 全局 ignores 增加 `plugin/**`（自包含子包：dist 是构建产物、scripts 是 AC3 编排脚本；根配置的 TS rules 本就有意只作用于 `src/**`/`tests/**`） |
| 2 | 1 | `gopls-client.ts:415` `prefer-promise-reject-errors` | `reject(error)` → `reject(error instanceof Error ? error : new Error(String(error)))` |
| 3 | 1 | `wasm-parser-backend.ts:124` `no-misused-promises` | `if (this.cache.modulePromise)` → `if (this.cache.modulePromise !== undefined)` |
| 4 | 1 | `test-coverage-renderer.test.ts:217` `no-unused-vars` | 补上注释本意但缺失的断言 `expect(truncated).toBe(true)`（截断到 30 字符 → 29 字符前缀 + '…'，includes 恒真，已实测通过） |

**验证结果**：

```
npm run lint      → ✖ 4095 problems (0 errors, 4095 warnings)，exit 0   （修复前 234 errors）
npm run type-check→ exit 0
定向回归（golang/shared/mermaid 单测）→ 37 files / 717 tests 全通过，exit 0
```

**warnings 说明**：剩余 4095 warnings（`no-unsafe-*`、`no-explicit-any` 等类型安全类）按 Contract
「warnings 不计入阻塞」有意保留，不是本任务目标；未使用 `eslint-disable`。注意：任务 Summary 里
「剩余错误主要是 no-unsafe-*/no-explicit-any」与实测不符——它们全是 **warning**；234 个 error 的
实际主体是 plugin/ 的 parser 错误，已按上述方式清零。

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T15:31Z |
| changed | 2026-08-03T15:56Z — status todo → done；补 Completion（见上） |
