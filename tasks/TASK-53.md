---
id: TASK-53
title: "TASK-53: AC4 — CI 三盏灯全绿"
status: todo
labels:
  - defect
  - ci
parent: null
extra:
  schema: v1
---
# TASK-53: AC4 — CI 三盏灯全绿

status: todo

## Summary

CI（`.github/workflows/ci.yml`）最近 3 次全 failure（最后一次 2026-07-31，早于 TASK-51/52 修复）。
依赖 AC2（lint 0 errors，已 done）——AC2 完成后本任务解锁。

CI 步骤：type-check → lint → format:check → build → test:coverage → coverage 阈值 → codecov 上传。

当前已知状态（外层 2026-08-03T16:1xZ 实测）：
- lint ✅（TASK-52 修复，0 errors）
- format:check ✅（prettier 全过）
- type-check ✅（AC3）
- test:coverage ❓ 未在 CI 重跑过（本地 475s 全量套件 + coverage 开销可能超时）

## 任务

1. 查看最近 CI 失败明细：`gh run list --limit 5` + `gh run view <id> --log-failed`
2. 定位剩余红步（预期是 test:coverage 超时或 coverage 阈值）
3. 修复后 push，`gh run watch` 验证三盏灯绿
4. 若 test:coverage 在 GitHub runner 上超时：为 CI 的 Run tests 步骤加 `timeout-minutes`
   并确认 vitest coverage 配置（`coverage/coverage-summary.json` 是否生成、阈值判定是否生效）

## Contract

| Key | Value |
|---|---|
| measure | `gh run list --limit 1 --json conclusion,status` 的 `conclusion` |
| band | `conclusion == "success"` |
| invariant | `npm run type-check` 保持 exit 0；`npm run lint` 保持 0 errors（不破坏 TASK-52 成果） |
| invoke | `gh run list --limit 1 --json conclusion,status`；`gh run view <id> --log-failed` |
| control | 修复前：最近 3 次 conclusion=failure；修复后：最新一次 conclusion=success |
| resume | 若 CI 超时是 GitHub runner 与本地差异（无 coverage 缓存等），把实测数据写回本任务并报告外层 |

## 验证

```
gh run list --limit 1 --json conclusion,status
# 期望: "conclusion":"success"
```

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T16:1xZ |
| changed | — |
