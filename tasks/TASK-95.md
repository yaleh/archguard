---
id: TASK-95
title: "TASK-95: git 工具的文件 key 相对源根而非仓库根——需先决定解析规则再实现"
status: todo
labels:
  - gap
  - mcp
  - git-history
  - design
parent: null
children: []
extra: {}
---
## Proposal

`src/cli/analyze/run-analysis.ts` 分析 git 历史时，把仓库根到 `projectRoot`（取自 `processor.getLastArchJson()?.workspaceRoot`）的前缀从文件路径里剥掉，metrics 的 key 因此相对「源根」而不是仓库根。这是有意的设计，但带来两个问题：（1）调用方用仓库相对路径（如 `plugin/scripts/driver-runtime.ts`）查询会「not found」，而 `file-metrics.json` 里没有任何 `plugin/` 或 `packages/` 开头的 key；（2）`workspaceRoot` 来自「实体最多者胜」的 last ArchJSON，多 source 时选到哪个不确定，同一仓库的 key 前缀可能跨次变化。

本任务先决策、后实现，不允许直接写代码：
- 选项 A：key 改为仓库相对路径（一次性、破坏旧 `file-metrics.json`，需 manifest 版本号提升）；
- 选项 B：保持源相对 key，在 `HistoryQuery` 查询入口同时接受仓库相对路径，命中时按 `gitSubDir` 前缀换算，并在响应回显换算后的 key；
- 选项 C：B 加上 manifest 里记录 `keyRoot`（相对仓库根的前缀），使 key 前缀跨次稳定。
推荐 B+C（兼容旧数据、改动局限在查询入口与 manifest）。决策与理由写入本文件的 `## Decision` 小节后再实现。

<!-- dedup-ref -->
相关但机制不同：TASK-93 只统一 notFound 的「未评估」表达；TASK-94 处理窗口截断。本任务处理的是 key 的相对根。

## AC

- [ ] 本文件新增 `## Decision` 小节，明确选定选项并说明为何不选其余两项（`grep -n "^## Decision" tasks/TASK-95.md` 有结果）
- [ ] `npx vitest run tests/unit/analysis/git-history/history-query.test.ts` exit 0，新增用例：源相对与仓库相对两种写法查同一文件得到同一结果，响应回显换算后的 key
- [ ] `npx vitest run tests/unit/analysis/git-history/history-aggregator.test.ts` exit 0（回归）
- [ ] 旧版本写出的 `file-metrics.json` / manifest（无 `keyRoot`）在新代码下仍可查询：`npx vitest run tests/unit/cli/git-history/history-loader.test.ts` exit 0
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

在 monorepo 布局（仓库根下有 `plugin/` 与 `packages/` 两个源目录）的真实仓库上，用仓库相对路径调用 `archguard_get_change_context`，命中并返回数据；用源相对路径调用行为与修复前一致。

## Touches

- `src/analysis/git-history/history-query.ts`
- `src/cli/git-history/history-loader.ts`
- `src/cli/analyze/run-analysis.ts`
- `src/types/git-history.ts`
- `tests/unit/analysis/git-history/history-query.test.ts`
- `tests/unit/cli/git-history/history-loader.test.ts`
- `tasks/TASK-95.md`
