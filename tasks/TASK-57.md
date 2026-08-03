---
id: TASK-57
title: "TASK-57: 测试套件墙钟优化（基于 TASK-56 基线，改善必须超 σ）"
status: done
labels:
  - performance
parent: null
extra:
  schema: v1
---
# TASK-57: 测试套件墙钟优化（基于 TASK-56 基线，改善必须超 σ）

status: done

## Summary

基于 TASK-56 落盘的基线数字优化测试墙钟。**判据只有一条：改善必须大于 TASK-56
实测的 run-to-run 范围（σ），否则按「无改善」记录收工**——quay 曾用两次非受控运行
报「Σ 降 8.2%」，而 σ 范围是 297.6s，改善全在噪声里。本任务不重复那个错。

来源：管理者 2026-08-03 跨项目经验传递（quay 度量经验）。外层裁定的顺序：
TASK-53（CI 绿）→ TASK-56（量基线+σ）→ 本任务。

## 前置条件

**TASK-56 done（基线报告 `docs/analysis/test-suite-baseline.md` 落盘）后才可派发。**
没有基线和 σ 就动手 = 重复 quay 的错误。

## 任务

按杠杆优先级（quay 经验排序）：

1. **最慢单文件**——墙钟硬下界是最慢单个文件（一文件一 worker、文件内串行）。
   TASK-56 的 top-5 慢文件清单是现成候选；手段：拆分文件（把独立 describe 块拆成
   并行文件）、削减文件内串行等待（公共 setup 下沉到文件级 beforeAll 而非每 test）。
2. **削减启动与等待**——quay 实测有效并行度 7.1 / 4 核，说明套件是启动与等待密集
   不是 CPU 密集；**加核/加并发消不掉等待**。找 per-file 固定开销（重复 import 重初始化、
   每文件重建的 fixture）合并或延迟。
3. 以上两者都不足以超过 σ → **记录「当前不值得优化」并报告外层**。这是合法结局，
   不要为了有改善而改。

每次改动后：拿令牌、从取令牌时刻计时、跑 ≥1 次全量与基线同口径对比；
最终验收跑 ≥3 次（与 TASK-56 同口径）。

## Contract

| Key | Value |
|---|---|
| measure | `bash -c 'TIMEFORMAT=%R; time npm test'` 的墙钟秒数（从 `bash plugin/scripts/heavy-op-token.sh --acquire archguard` 取得时刻起计，与 TASK-56 同口径） |
| band | 优化后墙钟下降幅度 > TASK-56 实测 run-to-run 范围；下降 ≤ 范围记为无改善 |
| invariant | `timeout 600 npm test; echo $?` exit 0 且 0 failed；`npm run type-check; echo $?` exit 0；`npm run lint; echo $?` 0 errors |
| invoke | 先 `bash plugin/scripts/heavy-op-token.sh --acquire archguard`，再 `bash -c 'TIMEFORMAT=%R; time npm test'`，对比 `docs/analysis/test-suite-baseline.md` 数字 |
| control | 基线：TASK-56 报告的墙钟与范围；优化后：墙钟 − 基线 > 基线范围，且 0 failed |
| resume | 若无法证明超 σ 改善，把结论与数据写回本任务报告外层，不强行改配置 |

## 验证

```
timeout 600 npm test; echo $?
# 期望: 0 failed, exit 0
bash -c 'TIMEFORMAT=%R; time npm test'   # 与 docs/analysis/test-suite-baseline.md 对比
# 期望: 墙钟下降 > 基线 run-to-run 范围（否则记录「无改善」收工）
```

## Progress（2026-08-03，内层执行 + 关闭）

### 结论：**当前不值得优化**（合法结局，改善未超 σ=62s）

**尝试的改动**（subagent，3 个 top-5 慢文件，均为 npm 装包走本地缓存）：
- `tests/integration/plugin-install.test.ts`：npm install 加 `--prefer-offline`
- `tests/integration/install-policy.test.ts`：npm install 加 `--prefer-offline`
- `tests/integration/installer-claude-user-scope.test.ts`：env 加 `NPM_CONFIG_PREFER_OFFLINE: 'true'`

**验收数据**（subagent 3 次全量，0 failed / 4507 passed / 13 skipped，墙钟从取令牌时刻起计）：
- 第 3 次验收（20:33:27 起，run log `/tmp/wt57-after3.log`）：vitest Duration **481.27s**
  （transform 12.38s + collect 40.65s + tests 430.36s）
- 前两次中间结论：改善 ~13–17s
- **对比基线**（TASK-56）：均值 ~475s，run-to-run 范围 62s（σ）
- **481s vs 475s = 无净改善，完全落在 σ 噪声内**（438–500）。~13–17s 的「改善」是 run-to-run 方差，不是真实收益——正是 σ 纪律要拦的形态。

**处置**：改动**未合并**（无超 σ 改善，合并=未证实的 churn + 多余 CI round）。改动已记录于此，`--prefer-offline` 是安全卫生项；若外层要单独采纳（不claim优化），可另行指示（3 文件 +15 行）。subagent 中途三次静默停止（等 Monitor 时），第 3 次验收由其启动的后台运行完成、我主会话收尾；令牌陈旧持有已重领并释放。

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-03T17:29Z |
| changed | — |
