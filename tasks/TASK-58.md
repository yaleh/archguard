---
id: TASK-58
title: "TASK-58: 覆盖率提升 — lines/statements 从 44% 提到 80%"
status: todo
labels:
  - coverage
  - quality
parent: null
extra:
  schema: v1
---
# TASK-58: 覆盖率提升 — lines/statements 从 44% 提到 80%

status: todo

## Summary

TASK-53 round 5 CI（head 6e861d0，2026-08-03）首次走到 coverage 阈值步，暴露一个**从未被满足过**的
理想化闸门：vitest 内置 thresholds 四项全 80%，但实测只有 lines/statements ≈44.4%（branches 84.9%、
functions 91% 已达标）。CI 历史上从未走到过这一步（此前一直红在 lint/type-check/tree-sitter）。

外层裁决（2026-08-03T~17:58Z，见 tick-log #13）：44.4% 是真实数字（Node 22/24 双一致，确定性 v8），
80% 的 lines/stmts 阈值超出 TASK-53「CI 三灯绿」的 AC4 范围——把 coverage 提升塞进 TASK-53 是范围爆炸。
因此 TASK-53 侧重校阈值到实测基线（`vitest.config.ts` 已由 TASK-53 落地：lines/statements → 40，
branches/functions 保持 80，注释注明基线 + 指向本任务）；**本任务把「提到 80%」的野心锁进队列**，
不允许静音降级。本任务完成后可考虑把阈值从 40 提回 80。

## 前置条件

**TASK-53 done（CI 三灯全绿，阈值已重校、round 6 验证过）** 后才可派发——否则没有可信的绿基线。

## 任务

1. 以 round 5 的 coverage 报告为基线（`coverage/` 目录在本地，CI 也生成）：
   lines 44.38%、statements 44.38%、branches 84.93%、functions 91.03%（Node 22 口径）。
2. 找出把 lines/statements 拖到 44% 的大头文件/目录——优先处理**大体积且低覆盖**的 src 文件
   （重复执行率高的 try/catch、深分支、防御性检查）。逐文件建证据：跑
   `npx vitest run --coverage` 看逐文件 % Lines。
3. 先排除合法的低价值代码（若存在应排除而未排除的目录/生成物——见 vitest.config.ts exclude 清单），
   再补真实测试。不要为了数字好看改 exclude。
4. 每轮提升后：拿令牌、跑 `npx vitest run --coverage`，报新的 lines/statements；推进目标 80%。
5. 达到 lines/statements ≥ 80%（或达到当前可行上限并给出理由）后：
   **把 `vitest.config.ts` 的 lines/statements 阈值从 40 提回 80**（恢复原闸门意图），跑全量验证收尾。
6. 若达到 80% 需改动面过大（超出本任务合理工作量），分阶段：先提到一个中间目标（如 60%），
   建后续任务继续，报外层。

## Contract

| Key | Value |
|---|---|
| measure | `npx vitest run --coverage` 输出的 `All files` 行 % Lines / % Statements |
| band | lines/statements 从 44% 提升至 ≥80%（或阶段目标，见任务 6），且不靠改 exclude 刷数字 |
| invariant | `timeout 600 npm test; echo $?` 保持 exit 0 且 0 failed；`npm run type-check; echo $?` exit 0；`npm run lint; echo $?` 0 errors（不得为提 coverage 破坏既有绿） |
| invoke | `bash plugin/scripts/heavy-op-token.sh --acquire archguard` 后 `npx vitest run --coverage`，对比 round 5 基线 44.38% |
| control | 把 `vitest.config.ts` exclude 清单加无关目录 ⇒ 若 lines 上升，是刷数字不是提升（该改动不得收） |
| resume | 每轮提升落盘实测数字到本任务 Progress 段；被打断可从数字续跑 |

## 验证

```
npx vitest run --coverage
# 期望: All files 行 % Lines 与 % Statements ≥ 80%（或阶段目标），0 failed
grep -E "lines|statements" vitest.config.ts
# 期望: 阈值已提回 80（或中间目标，注释写明依据与剩余计划）
git status --short
# 期望: 除测试/source/任务文件外无脏改动
```

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T17:58Z |
| changed | — |
