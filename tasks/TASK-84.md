---
id: TASK-84
title: "TASK-84: parser-pool 池大小机器相关断言修复——full-suite 最后一处本地失败"
status: done
labels:
  - defect
  - test
parent: null
children: []
extra: {}
---
# TASK-84: parser-pool 池大小机器相关断言修复——full-suite 最后一处本地失败

## Proposal

TASK-82 落地后本地 `npx vitest run` = **1 failed / 5182 passed**，唯一失败：
parser worker pool 测试的**池大小机器相关断言**——`os.cpus()`=2（本机）vs 测试隐式期望 size-4，
**修复前后同败**（已文档化为显式非回归）。这是本地 full-suite 真绿的最后一块绊脚石。

本任务：定位该断言（TASK-82 报告指向 `parser-pool.test.ts:59`，实文件在
`tests/unit/parser/parse-worker-pool.test.ts` 或 `process-parse-worker-pools.test.ts`），
把机器依赖的池大小断言改为**机器自适应**（读 `os.cpus().length` 或 mock），使
`npx vitest run` 在本机 exit 0。

### 选定机制

- 池大小来源：确认默认池大小是否由 `os.cpus()` 推导；若是，断言改用 `os.availableParallelism()` /
  `os.cpus().length` 派生，或对依赖固定池大小的分支 mock 并发数。
- 保持既有测试意图（验证 worker 池的消息路由/回收/去重逻辑），只修机器依赖的部分。
- 若该断言本质上是「默认并发=4」的产品契约，则改为显式传入池大小构造 + 断言改用推导值，
  不改变产品默认。

## Acceptance Criteria

- [x] 定位精确断言（TASK-82 报告 line 59 附近；确认池大小推导来源）
- [x] 改为机器自适应或显式 mock——`npx vitest run` 本机 exit 0（全绿）
- [x] 不改产品默认并发语义（若「默认 4」是契约，保留产品值，只修测试断言）
- [x] lint-clean；相关单测绿
- [x] 负控制：撤改 ⇒ 原失败复现

## Touches

- `tests/unit/parser/parse-worker-pool.test.ts`（及/或 `process-parse-worker-pools.test.ts`）
- 若需 mock 并发：相关测试 helper / `tests/` 下 setup
- `tasks/TASK-84.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | `npx vitest run` exit code + failed 数（before 1 vs after 0） |
| band | after = 0（本机全绿） |
| invariant | 产品默认并发语义不变；不削弱消息路由/回收/去重覆盖 |
| invoke | `npx vitest run`（本机，worktree 内 npm ci 后） |
| control | 撤掉断言改动 ⇒ 1 failed 复现（负控制） |
| resume | 从「定位断言 + 确认池大小推导」续 |

## Definition of Done

- [x] 本机 `npx vitest run` exit 0（全绿）— after 计数见下
- [x] before/after 证据落盘 + 机制说明
- [x] lint-clean，单测绿

## Evidence (2026-08-11, outer dispatch tick)

**定位（AC1）**：精确断言在 `tests/integration/parser-pool.test.ts:59`（TASK-82 报告 line 59，
实文件是 **integration** 文件，非任务 Touches 猜测的 `tests/unit/parser/`——已按实况修 integration
文件；`tests/unit/parser/process-parse-worker-pools.test.ts:36` 用显式 `concurrency: 9`（钳到 4），
机器无关，无需改）。池大小推导来源：`process-parse-worker-pools.ts:19`
`size = Math.max(1, Math.min(request.concurrency ?? 4, 4))`。

**根因**：池 key = `language:runtime:root:size`。`runAnalysis`（`run-analysis.ts:176`）传
`concurrency: config.concurrency`，config 默认 `os.cpus().length`（`config-loader.ts:180`）——本机
`os.cpus()=2` → 派发到 size-2 池。测试 line 58 的 `pools.get({runtime:'native', workspaceRoot})`
**省略 concurrency** → 默认 size **4** → 查到不同 key 的池（dispatchCount 0）→ line 59 失败。

**修复（AC2，机器自适应）**：line 58 查找池时显式传 `concurrency: cpus().length`——与 run-analysis
的 `config.concurrency` 默认一致，命中 run-analysis 实际派发的池。仅改测试断言，产品代码零改动。

**验证**：
- 单测（fix 后）：`npx vitest run tests/integration/parser-pool.test.ts` = **6/6 passed**
  （previously full-file 5 failed——含并发跑的 load 敏感，isolated 各过；fix 后全文件 6/6）。
- 负控制（AC5）：`git stash` 撤改 → 复现 `AssertionError: expected 0 to be greater than 0`
  （line 59）→ `stash pop` 恢复 → 过。
- lint：`npx eslint tests/integration/parser-pool.test.ts` **0 errors**（12 pre-existing warnings）。
- type-check：`npx tsc --noEmit` exit 0。
- **full suite（after）**：`npx vitest run` = **359 files passed | 3 skipped (362)**；
  **5183 passed | 18 skipped (5201)**；**0 failed**；**exit 0**。before = 1 failed / 5182 passed
  （TASK-82 基线）。**本机本地 full-suite 首次全绿。**

**不变性（AC3）**：产品默认并发语义未动（`process-parse-worker-pools.ts` / `config-loader.ts` /
`run-analysis.ts` 零改动）；测试意图（验证 worker 池路由/回收/去重）保留，仅修机器依赖的池查找部分。
