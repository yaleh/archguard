---
id: TASK-95
title: "TASK-95: git 历史的文件 key 相对根不确定、且只采集了单个子树——统一为确定的 keyRoot 与多 pathspec"
status: ready
labels:
  - gap
  - mcp
  - git-history
  - design
parent: null
children: []
extra: {}
depends_on:
  - TASK-94
---
## Proposal

`src/cli/analyze/run-analysis.ts` 分析 git 历史时有三个相互关联的问题（源码核实）：
1. **数据只覆盖单个子树。** `readGitLog` 带 `pathFilter: gitSubDir`，只采集「最大 scope 的源根」这一个子树的提交。用仓库相对路径（如 `plugin/scripts/driver-runtime.ts`）查不到，是因为那部分提交从没进过数据，不只是 key 格式不同。`file-metrics.json` 里没有任何 `plugin/` 或 `packages/` 开头的 key。
2. **源根不确定。** `projectRoot` 取自 `processor.getLastArchJson()?.workspaceRoot`，而 last ArchJSON 按「实体最多者胜」选，多 source 时同一仓库的 key 前缀可能跨次变化。
3. **key 相对源根而非仓库根**，调用方用仓库相对路径查询得到「not found」，且原因不可区分。

## Decision

选定：**B + C，并修正数据采集范围与源根的确定性**（用户 2026-09-25 确认）。
- `keyRoot` 不再取 last ArchJSON，而是取**所有已分析 source 目录的最近公共祖先**，记为相对 git 根的路径（`''` 表示仓库根）。单 source 时与现状完全一致；多 source 时变得确定。
- git log 的 pathspec 由单个 `gitSubDir` 改为**所有 source 目录的列表**（`git log -- p1 p2 …`）。manifest 新增 `keyRoot` 与 `pathFilters`（相对 git 根的目录列表）。
- 查询入口同时接受仓库相对路径与 key 相对路径：目标以 `keyRoot/` 开头时剥掉该前缀再查；响应回显换算后的 key（`resolvedTarget`）。
- notFound 的原因分类，新增机器可读 `code`：`outside-analyzed-paths`（目标不在任何 `pathFilters` 下，附实际采集的目录）、`no-commits-in-window`（在采集目录下但窗口内无提交，附窗口起止）、`legacy-manifest`（manifest 无 `keyRoot`，提示重跑 `archguard_analyze_git`）。TASK-93 的 `evaluated:false` 复用这些 `code`。
- 旧 manifest 没有 `keyRoot` 时按恒等处理，不需要提升 manifest 版本号（只加可选字段）。

不选 A（改成仓库相对 key）：`extractPackagePath` 取路径前 `depth` 段，key 改成仓库相对后 depth=1 的包会全部塌成 `plugin` / `packages`，包级指标的含义整体改变，且旧数据作废。
不只选 B：B 修不了「数据根本没采集」和「源根不确定」，只是让错误的数据更容易被查到。

<!-- dedup-ref -->
相关但机制不同：TASK-93 只统一 notFound 的「未评估」表达并复用这里的 `code`；TASK-94 处理窗口截断，与本任务都扩展 `GitHistoryManifest`，因此本任务通过 `depends_on` 排在 TASK-94 之后。

## AC

- [x] `npx vitest run tests/unit/analysis/git-history/git-log-reader.test.ts` exit 0，新增用例：`readGitLog` 接受 pathspec 列表，只返回落在这些目录下的文件变更
- [x] `npx vitest run tests/unit/cli/analyze/run-analysis.test.ts` exit 0，新增用例：两个 source 位于不同子目录时 manifest 的 `keyRoot` 为它们的最近公共祖先，且不随各 scope 实体数变化；单 source 时 `keyRoot` 等于该 source 相对 git 根的路径
- [x] `npx vitest run tests/unit/analysis/git-history/history-query.test.ts` exit 0，新增用例：仓库相对与 key 相对两种写法查同一文件得到同一结果并回显 `resolvedTarget`；三种 notFound `code` 各有用例
- [x] `npx vitest run tests/unit/cli/git-history/history-loader.test.ts` exit 0，新增用例：无 `keyRoot` 的旧 manifest 仍可加载，查询按恒等处理，notFound 时 `code` 为 `legacy-manifest`
- [x] `npx vitest run tests/unit/analysis/git-history/history-aggregator.test.ts` exit 0（回归，包路径含义不变）
- [x] `npm run type-check && npm run lint` exit 0

## DoD

在 monorepo 布局（仓库根下有 `plugin/` 与 `packages/` 两个源目录）的真实仓库上，同时分析两个 source 并带 `includeGit`，用仓库相对路径调用 `archguard_get_change_context` 命中并返回数据；查询一个不在任何采集目录下的路径得到 `outside-analyzed-paths` 与实际采集目录列表；单 source 项目的既有 key 与查询行为与修复前一致。

## Touches

- `src/analysis/git-history/git-log-reader.ts`
- `src/analysis/git-history/history-query.ts`
- `src/cli/git-history/history-loader.ts`
- `src/cli/analyze/run-analysis.ts`
- `src/types/git-history.ts`
- `tests/unit/analysis/git-history/git-log-reader.test.ts`
- `tests/unit/analysis/git-history/git-log-reader-exec.test.ts`
- `tests/unit/analysis/git-history/history-query.test.ts`
- `tests/unit/cli/git-history/history-loader.test.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`
- `tasks/TASK-95.md`
