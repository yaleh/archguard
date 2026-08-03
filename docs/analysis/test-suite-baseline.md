# 测试套件基线度量（TASK-56）

> 日期: 2026-08-03
> 任务: TASK-56 — 只测不改，套件基线（Σ/墙钟/并行度/范围）
> 环境: worktree `/tmp/quay-wt-task56` @ `task/TASK-56`（master `506f593`），Node v26.5.0，vitest 3.2.4
> 配置: `pool=forks, singleFork=true`（串行），`testTimeout=30000`，294 个测试文件 / 4520 个用例

## 方法（实测口径）

- 测量命令: `npx vitest run --reporter=json --outputFile=<run>.json --reporter=default`
- vitest 3.2.4 的 JSON reporter 在每文件（`testResults[i]`）上**没有 duration 字段**，
  只有 `startTime`/`endTime`（测试执行 span，不含 beforeAll/afterAll hook 时间）。
  按任务规范「除非 JSON 缺字段才考虑改解析」，额外挂 default reporter 取每文件真实时长
  （`file.result.duration`，含 hook）。
  - **Σ_true** = Σ 每文件真实时长（default reporter 每行 `✓ <file> (N tests) Xms`，292 文件求和），
    与 vitest 自报 `tests NNN.Ns` 完全一致。
  - **Σ_json** = Σ (`endTime − startTime`)（JSON 口径的测试执行 span，不含 hook）。
- **墙钟**: 从 `heavy-op-token.sh --acquire archguard` 取得令牌的 `date -u` 时刻起，到 vitest 进程结束。
- **并行度** = Σ / 墙钟。
- 全量运行 5 次（≥3）。其中 run3/run4/run5 为同一组合 reporter 命令；diag（仅 default）与
  run2（仅 json）为另外两次全量墙钟数据点（reporter 差异不影响测试执行，墙钟口径相同）。

## 结果

### 各次墙钟（从取令牌时刻起计）

| 运行 | 取令牌(UTC) | 结束(UTC) | 墙钟(s) |
|---|---|---|---|
| diag | 18:21:08Z | 18:29:26Z | 498 |
| run2 | 18:30:35Z | 18:38:55Z | 500 |
| run3 | 18:42:54Z | 18:50:51Z | 477 |
| run4 | 18:51:00Z | 18:58:31Z | 451 |
| run5 | 18:58:44Z | 19:06:02Z | 438 |

### Σ 与并行度

| 运行 | 墙钟(s) | Σ_true(s) | Σ_json(s) | 并行度 Σ_true/墙钟 | 并行度 Σ_json/墙钟 |
|---|---|---|---|---|---|
| diag | 498 | 445.81 | — | 0.90 | — |
| run2 | 500 | — | 340.28 | — | 0.68 |
| run3 | 477 | 423.90 | 326.45 | 0.89 | 0.68 |
| run4 | 451 | 402.07 | 307.64 | 0.89 | 0.68 |
| run5 | 438 | 389.74 | 295.80 | 0.89 | 0.68 |

- Σ_true 与 vitest 自报 `tests` 一致：run3 423.90 / run4 402.07 / run5 389.75（diag 445.82）。
- Σ_true 均值 ≈ **415s**；并行度（Σ_true/墙钟）稳定 ≈ **0.89**。
- Σ_json（仅测试执行 span）均值 ≈ **318s**；并行度 ≈ **0.68**。

### run-to-run 范围

- 5 次墙钟: 498 / 500 / 477 / 451 / 438 → **max − min = 500 − 438 = 62s**。
- 同命令（组合 reporter）3 次: 477 / 451 / 438 → 范围 **39s**。
- 参考基线 AC1 单次 475.78s，落在实测范围 [438, 500] 内。

### 最慢 5 个单文件（Σ_true 口径，4 次有数据的运行逐次时长）

| 排名 | 文件 | 行数 | 各次时长(s) | 均值(s) |
|---|---|---|---|---|
| 1 | `tests/integration/plugin-install.test.ts` | 339 | 77.05 / 79.39 / 81.59 / 77.20 | ~78.8 |
| 2 | `tests/integration/installer-claude-user-scope.test.ts` | 749 | 65.47 / 57.44 / 56.40 / 51.70 | ~57.8 |
| 3 | `tests/integration/parser-pool.test.ts` | 176 | 58.28 / 54.17 / 46.22 / 40.02 | ~49.7 |
| 4 | `tests/integration/install-policy.test.ts` | 398 | 45.91 / 39.52 / 38.11 / 38.64 | ~40.5 |
| 5 | `tests/integration/mermaid/e2e.test.ts` | 367 | 21.82 / 20.82 / 21.57 / 22.21 | ~21.6 |

> 第 6 名 `tests/integration/installer-codex-user-scope.test.ts`（1017 行，~21.0s）与第 5 名接近。
>
> 任务候选按行数列的 5 个大文件（capability-graph-builder 2683 行、flow-graph-builder 2550 行、
> diagram-processor 2219 行、generator 1889 行、query-engine 1783 行）实测均不在 top-5；
> 最慢的是做真实外部操作（npm pack/install、MCP 握手、gopls、子进程）的集成测试。
> 候选中最接近的是 `tests/unit/cli/processors/diagram-processor.test.ts`（第 8 名，~14s）。

### 通过/失败统计（5 次全绿，均 exit 0）

- Test Files: 292 passed | 2 skipped (294)
- Tests: 4507 passed | 13 skipped | **0 failed** (4520)

## 异常事件（无测试失败）

- 首次 `--reporter=json` 尝试（run1，后被中止重跑）: vitest 进程运行约 112s、仅跑完
  `plugin-install.test.ts` 一个文件后以 exit 1 退出，JSON 显示其余 293 文件 0 断言。
  该现象在后续 run2-5（同命令）**未复现**，判定为一次性瞬时事件，非测试 flaky
  （无任何测试失败，5 次有效运行全绿）。

## 令牌 / 资源闸

- 唯一令牌等待: 首次运行前 quay 持牌（`held_ms≈845s`），acquire 循环等待 **90s** 后取得；
  此后 5 次测量运行全部 `waited_ms=0` 立即取得（窗口内无排队，墙钟未混入等待）。
- 资源闸: 每次运行前均输出 `GO`，无 `WAIT`。

## 口径说明（对抗自查）

- Σ_true / Σ_json / 墙钟均用独立脚本（`verify.mjs`，不复用解析函数）从原始 JSON、运行日志
  重算核对，与上表一致（Σ_true 同时与 vitest 自报 `tests` 总数交叉验证）。
- vitest 3.2.4 JSON 每文件无 duration 字段 → 按任务规范改解析：Σ_true 为主口径，
  Σ_json 为次口径并列记录。
