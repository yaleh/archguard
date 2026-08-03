# cold-start-gaps.md — archguard 冷启动差异清单

移植自 quay 开发目录（2026-08-03），按 COLD-START-SEED.md 的要求记录
每一处照做时发现不成立、缺失、或需要人工补的地方。

分类：**已回填 / 属 archguard 特有 / 交付物缺失**

---

## 交付物缺失（quay 方法论文档不在 npm 包里）

| 缺失项 | 引用来源 | 说明 |
|---|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | orchestrator-loop-tick.md §1 | quay 的目标/AC/DoD 文档，archguard 没有 |
| `orchestration/tick-log.md` | orchestrator-loop-tick.md §1, §8 | tick 历史记录，首次冷启动创建 |
| `orchestration/escalations.md` | orchestrator-loop-tick.md §1, §5 | 升级积压，首次冷启动创建 |
| `docs/analysis/batch2-queue-state.md` | orchestrator-loop-tick.md §1 | 内层自报队列状态，首次冷启动创建 |
| `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` | orchestrator-loop-tick.md §1 | ADR 文档，archguard 无此编号 |
| `plugin/scripts/fast-mode-telemetry.ts` | orchestrator-loop-tick.md §1, §2 冷启动 | 遥测脚本，archguard 无 plugin/scripts 目录 |
| `plugin/scripts/task-status-drift-check.ts` | orchestrator-loop-tick.md §1, §2 冷启动 | 任务状态漂移检查，不存在 |
| `plugin/scripts/task-contract-check.ts` | orchestrator-loop-tick.md §0c | 契约检查器，不存在 |
| `plugin/scripts/touches-orthogonality-check.ts` | orchestrator-loop-tick.md §4 | 正交性检查，不存在 |
| `orchestration/watch/inner-forensics.mjs` | orchestrator-loop-tick.md §1 | 内层取证工具，不存在 |
| `orchestration/watch/inner-state.sh` | orchestrator-loop-tick.md §0b | 状态监测脚本，不存在 |
| `scripts/resource-gate.sh` | orchestrator-loop-tick.md §0c | 资源闸，不存在 |
| `orchestration/watch/inner-state.sh` | orchestrator-loop-tick.md §0b, §4b | 状态监测脚本，不存在 → Monitor 无法挂载 |

### 关键缺失：四个取状态手段全不存在 → 外层静默降级到顶层约定禁止的方法

tick 文档引用的四个取状态手段在 archguard 一个都不存在：

| 手段 | 作用 | 替代 |
|---|---|---|
| `fast-mode-telemetry.ts --report` | 遥测当前状态 | 无 |
| `inner-state.sh` (Monitor) | 事件式监测 | 无 |
| `inner-forensics.mjs verify/timecost` | 取证核实 | 无 |
| `.workflow-events` | 工作流事件流 | 无 |

**这不是硬失败——是让外层静默降级**到 quay 顶层约定（CLAUDE.md:151）明确禁止的方法：
`capture-pane` 反复读 TUI 取结果。

在它们被补齐之前，合规回退：
- 结果一律看 **git log / git status / tasks/\*.md / 日志文件**
- `capture-pane` 只用于两件事：**确认 send-keys 送达**、**判断内层忙/空闲**（两次 md5sum 相同 = 空闲）

## 属 archguard 特有

| 差异 | 说明 |
|---|---|
| 无 `exp6` 上下文 | archguard 没有 quay 的 exp6 实验历史，AC/DoD 需从头定义 |
| 无 ADR-021 | archguard 的 ADR 编号体系不同（当前最大约 ADR-020），需确认是否有对应文档 |
| 测试套件不同 | quay 用 `scripts/test.sh`，archguard 用 `npm test`（vitest）。已知 lint 480 errors，type-check 干净 |
| 内层模型不同 | quay 内层是 deepseek-v4-flash（同 quay 当前），archguard 也是。但 archguard 没有 quay 的 exp 历史 |
| 已发现的真实问题 | CI 连续失败、测试套件超时（124 exit）、lint 480 errors——这些是 archguard 特有的待修项 |

## 已回填

| 项 | 说明 |
|---|---|
| （暂无） | 冷启动过程中发现并修复的项记在这里 |

---

## 冷启动实测结论（2026-08-03）

### npm test 真实耗时

| 指标 | 先前（被 timeout 掩盖） | 实测（无 timeout） |
|---|---|---|
| 墙钟耗时 | 300s（被 timeout 杀） | **491.97s（≈ 8.2 分钟）** |
| 退出码 | 124（timeout 击杀码） | **1**（vitest 有失败测试） |
| Test Files | 未知 | 1 failed / 291 passed / 2 skipped（294） |
| Tests | 未知 | 1 failed / 4506 passed / 13 skipped（4520） |

**结论**: `timeout 300` 的 124 确实掩盖了真实退出码（1）。真实耗时 492s > 300s，所以 300s 的 timeout 必然在测试跑完前就杀进程。

### 唯一失败

`tests/integration/installer-claude-user-scope.test.ts` — E404 边界断言：测试期望 `claude plugin install archguard@archguard` 以 E404 失败（包未发布到 npm），但 archguard 已发布 v0.1.32，安装成功（退出码 0）。

### CI 连红

`gh run list` 最近 5 次全 `failure`，最早 2026-07-12。根因是 lint（480 errors）和测试超时导致。

### 冷启动执行的步骤

1. 读 orchestrator-loop-tick.md
2. 建立实况（git log、tmux 会话、.halt 状态）
3. 建 gaps 清单（本文件）
4. 建 cron（*/20 min tick）
5. 给内层派发第一条指令：测 npm test 真实耗时 → 已完成
6. 第二条指令：lint errors 分析（eslint --fix 正在跑，留给 archguard 后续处理）

### 当前状态（2026-08-03T10:05Z）

- **quay**: `.halt` → 即将解除，恢复产品化交付
- **archguard**: 即将 `.halt`，把资源交还 quay
- **meta-cc**: 运行中
- **本机**: 4 核
- **eslint --fix**: 内层正在后台跑（`npm run lint:fix`），留给 archguard 下次恢复时处理
