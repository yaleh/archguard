---
id: TASK-94
title: "TASK-94: git 历史窗口被静默截断——manifest 写 sinceDays:90 实际只覆盖 3 天，无 truncated 标志"
status: ready
labels:
  - gap
  - defect
  - mcp
  - git-history
parent: null
children: []
extra: {}
---
## Proposal

`src/cli/analyze/run-analysis.ts` 的 git 历史分析写死 `sinceDays=90, maxCommits=500`（`git-history-analyze-tool.ts` 的独立工具默认值相同）。`git log --max-count=500` 从最新往回截，manifest 只记 `sinceDays:90` 与 `totalCommits`，没有窗口起止时间也没有截断标志。实测：90 天内有 19876 个非合并提交，实际读到的 500 个只覆盖 09-23 到 09-25，manifest 却声称窗口是 90 天，churn/co-change/ownership 全部基于这 3 天却按 90 天解读。

方案：
1. manifest 增加 `windowStart`、`windowEnd`（实际读到的最早/最晚提交时间）和 `truncated`（读到的提交数等于 `maxCommits` 且更早还有提交时为 true；判定可用多读 1 条）。字段全部可选，旧 manifest 仍可读。
2. `HistoryQuery` 的 `analyzedWindow` 与各 git 工具响应回显这三个字段；`truncated:true` 时附一句说明「窗口实际短于 sinceDays」。
3. `archguard_analyze` 暴露 `gitSinceDays` / `gitMaxCommits` 参数（默认值不变），CLI 侧同步，避免调用方无法调大。

<!-- dedup-ref -->
相关但机制不同：TASK-93（未评估形状）、TASK-95（git 路径 key 的解析）。本任务只处理窗口的可见性与可调性。

## AC

- [x] `npx vitest run tests/unit/analysis/git-history/git-log-reader.test.ts` exit 0，新增用例：读到的提交数达到 `maxCommits` 且仓库还有更早提交时 `truncated` 为 true；提交数不足上限时为 false；`windowStart/windowEnd` 与提交时间一致
- [x] `npx vitest run tests/unit/analysis/git-history/history-query.test.ts` exit 0，新增用例：`analyzedWindow` 含 `windowStart/windowEnd/truncated`，旧 manifest（无这些字段）读取不抛错
- [x] `npx vitest run tests/unit/cli/git-history/history-writer.test.ts` exit 0（回归）
- [x] `npx vitest run tests/unit/cli/mcp/git-history-analyze-tool.test.ts tests/unit/cli/mcp/analyze-tool.test.ts` exit 0，含 `gitSinceDays/gitMaxCommits` 参数透传的用例
- [x] `npm run type-check && npm run lint` exit 0

## DoD

在一个提交数超过 `maxCommits` 的真实仓库（如本仓库，`maxCommits` 取小值）上跑 `archguard_analyze` 带 `includeGit`，随后调用 `archguard_get_change_context`，响应里能读到 `truncated:true` 与实际窗口起止；把 `gitMaxCommits` 调大后 `truncated` 变为 false。

## Touches

- `src/cli/analyze/run-analysis.ts`
- `src/cli/commands/analyze.ts`
- `src/cli/mcp/analyze-tool.ts`
- `src/cli/mcp/tools/git-history-analyze-tool.ts`
- `src/analysis/git-history/git-log-reader.ts`
- `src/analysis/git-history/history-query.ts`
- `src/types/git-history.ts`
- `src/types/config-cli.ts`
- `tests/unit/analysis/git-history/git-log-reader.test.ts`
- `tests/unit/analysis/git-history/history-query.test.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`
- `tests/unit/cli/mcp/analyze-tool.test.ts`
- `tests/unit/cli/mcp/git-history-analyze-tool.test.ts`
- `tasks/TASK-94.md`
