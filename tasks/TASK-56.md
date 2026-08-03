---
id: TASK-56
title: "TASK-56: 测试套件基线度量（Σ/墙钟/并行度/σ）——只测不改"
status: todo
labels:
  - measurement
  - performance
parent: null
extra:
  schema: v1
---
# TASK-56: 测试套件基线度量（Σ/墙钟/并行度/σ）——只测不改

status: todo

## Summary

管理者 2026-08-03 从 quay 传来跨项目经验（人问 archguard 的测试过程可否度量优化），
外层裁定：**接受并排队，顺序锁死**——TASK-53（CI 绿）→ 本任务（量基线+σ）→ TASK-57
（才谈优化）。理由：本地绿 CI 红时套件说不出可信的话，不能优化一个结论不可信的过程；
quay 曾拿两次非受控运行报「Σ 降 8.2%」，而 σ 实测 run-to-run 范围 297.6s——改善完全
在噪声里。**本任务只度量，不做任何优化改动。**

## 前置条件

**TASK-53 done（CI 三灯全绿）后才可派发。** CI 红时本地度量结果无法与 CI 交叉验证。

## 任务

1. 拿跨项目令牌：`bash plugin/scripts/heavy-op-token.sh --acquire archguard`，
   **用 `date -u` 记录取到令牌的时刻**——墙钟计时从这一刻开始，不是从发起命令开始。
   原因：令牌与 quay/meta-cc 共享（quay 曾一次 fan-in 占用约 1 小时），从发起计时会
   把排队等待算进自己的耗时。
2. 跑 `npx vitest run --reporter=json`，从输出提取每个测试文件的 duration：
   **Σ = 所有文件 duration 之和（总工作量）**；**墙钟 = 步骤 1 起计的实际经过时间**。
   有效并行度 = Σ / 墙钟。
3. 重复全量运行**至少 3 次**（每次都要先拿令牌、从取令牌时刻计时），
   报 run-to-run 范围（max − min）。**不要只用 2 次——quay 的教训就在上面。**
4. 列出最慢的 5 个单文件。墙钟的硬下界是最慢单个文件（一个文件一个 worker、
   文件内串行）。现成大文件候选（外层实测行数）：
   - `tests/plugins/golang/atlas/capability-graph-builder.test.ts`（2683 行）
   - `tests/plugins/golang/atlas/flow-graph-builder.test.ts`（2550 行）
   - `tests/unit/cli/processors/diagram-processor.test.ts`（2219 行）
   - `tests/unit/mermaid/generator.test.ts`（1889 行）
   - `tests/unit/cli/query/query-engine.test.ts`（1783 行）
5. 把全部数字写进 `docs/analysis/test-suite-baseline.md`：Σ、墙钟、并行度、
   3+ 次运行各自墙钟与范围、top-5 慢文件。**只写实测数字，不写优化结论。**
6. 参考基线：AC1 单次实测 475.78s 墙钟、0 failed / 4507 passed / 13 skipped。

## quay 经验（可搬 / 不可搬）

| 经验 | 可搬性 |
|---|---|
| 区分 Σ（总工作量）与墙钟，比值 = 有效并行度；quay 实测 7.1 / 4 核 → 套件是启动与等待密集不是 CPU 密集，加核消不掉等待 | ✅ 可搬 |
| 墙钟硬下界 = 最慢单文件（一文件一 worker、文件内串行） | ✅ 可搬 |
| 先测方差再报改善 | ✅ 可搬（本任务的 ≥3 次运行就是它） |
| quay 的 `measure-suite.mjs` | ❌ 不可直接搬——它解析 `node --test` 输出，archguard 用 vitest。用 `--reporter=json`，除非 JSON 缺字段才考虑改解析 |

## Contract

measure   sigma_files = `npx vitest run --reporter=json` stdout 的每文件 duration 字段（Σ = 逐文件求和，单位秒）
measure   suite_wall  = `bash -c 'TIMEFORMAT=%R; time npm test'` 的 REAL 秒数（从令牌取得时刻起计）
measure   run_range   = `timeout 600 npm test; echo $?` 重复 ≥3 次墙钟的 max−min 秒数
band      baseline    = Σ、墙钟、并行度（Σ/墙钟）、≥3 次范围、top-5 慢文件全部落盘 docs/analysis/test-suite-baseline.md，均实测值、无优化结论
invariant pure_measure = 完成后 `git status --short` 除任务文件与报告外为空（不改 src/tests/配置/脚本）
invariant suite_green  = `timeout 600 npm test; echo $?` 保持 exit 0 且 Test Files 行 0 failed
invoke    `bash plugin/scripts/heavy-op-token.sh --acquire archguard` 后 `date -u '+%H:%M:%SZ'` 记录取得时刻，再 `npx vitest run --reporter=json`
control   把计时起点从取令牌时刻改成发起时刻 ⇒ 若他项目持牌排队，墙钟必须变大；两者相同说明窗口内无排队（证伪「等待混入执行」）
resume    若多次运行出现不同失败（flaky），停下 σ 计算，把 flaky 清单本身作为发现写回本任务并报告外层

## 验证

```
cat docs/analysis/test-suite-baseline.md
# 期望: 含 Σ、墙钟、并行度、≥3 次运行范围、top-5 慢文件，均为实测数字
git status --short
# 期望: 除任务文件与报告外无改动（纯度量）
```

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T17:29Z |
| changed | — |
