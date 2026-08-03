---
id: TASK-55
title: "TASK-55: 处理 3 个 stranded 工作树分支（task/T3、task/T50、task/T52）"
status: todo
labels:
  - cleanup
  - investigation
parent: null
extra:
  schema: v1
---
# TASK-55: 处理 3 个 stranded 工作树分支

status: todo

## Summary

`task-status-drift-check.ts --stranded`（外层 2026-08-03T16:05Z 运行）报 3 个 stranded 分支，
工作未被 master 收纳或已被 revert：

| 分支 | 分类 | 详情 |
|---|---|---|
| task/T3 | error（classification errored） | master 无 merge commit 以其 tip 为 parent |
| task/T50 | error（classification errored） | 同上 |
| task/T52 | merged-then-reverted | 2 个 merge-added 文件从 master 缺失：`docs/plans/plan-121-122-l0-agent-queue.md`、`docs/proposals/proposal-l0-agent-queue.md`（last commit 2026-06-15） |

漂移检查明确：**不要 `--clean-stale`**——merge 决定是人的事（写 `orchestration/escalations.md`）。

## 任务

1. 逐个分支 `git show <tip>` 查看内容，判断是否有未收纳的有效工作
2. 把判断结果写进 `orchestration/escalations.md`（每条：现象、内容概要、建议 merge / 放弃）
3. 不做 merge、不做删除——只做分诊记录，供人裁定
4. 若某分支内容已被后续提交覆盖（确认无丢失），在 escalate 里注明「可安全清理」

## Contract

| Key | Value |
|---|---|
| measure | `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --stranded` 的分支数 |
| band | 3 → 每条有明确处置建议（merge/放弃/安全清理）写入 escalations.md |
| invariant | 不 `--clean-stale`、不删除分支、不 merge（超出内层授权） |
| invoke | `git show <tip> --stat`；`node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --stranded` |
| control | 修复前：3 stranded 无处置记录；修复后：escalations.md 含 3 条分诊 |
| resume | 分支内容判定需要 merge-base 对比时，用 `git merge-base --is-ancestor` 核实归属 |

## 验证

```
grep -c 'task/T' orchestration/escalations.md
# 期望: 3
```

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T16:10Z |
| changed | — |
