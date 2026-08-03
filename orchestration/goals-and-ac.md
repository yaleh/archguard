# archguard 外层编排 —— 目标与 AC

> 写于 2026-08-03 冷启动试验收尾。archguard 处于 `.halt`，本文档只做规划，不恢复开发。
> 每个 tick 复核一次。

---

## 1. 目标

**让 archguard 的 CI 恢复全绿（test + lint + type-check 全部通过），
使其成为 quay 双层机制在第二次冷启动（真正的从零冷装，非热拷贝）中的干净验证目标。**

- **人明说的**：archguard 是 quay 双层机制的验证目标；本次冷启动是热拷贝（文件从 quay 开发目录直接复制），
  下次应是真正的从包安装冷启动；archguard 自身的 CI / 测试 / lint 问题需要修。
- **我推断的**：在 quay 交付物补齐期间（预计数天到数周），archguard 应利用这段时间把自己的基础套件修到全绿，
  这样下次冷启动时不会再把时间花在测量已知问题上。目标不是「替 quay 写代码」——那是 quay 的活。

---

## 1b. 前置条件：用安装出来的版本重做冷启动 【被阻塞】

| 项 | 值 |
|---|---|
| **阻塞源** | **人工推送**——推送 GitHub、打 release、重建 dist-plugin 均须由人显式触发，我不执行其中任何一步 |
| **阻塞链** | ① 人推送 quay 机制代码 → ② 人重建 quay dist-plugin → ③ `/plugin install` 装出真正的包 → ④ 用装出来的那份（非 `cp` 热拷贝）重做 archguard 冷启动 |
| **为何不是待办** | 步骤 ①–③ 不在我的授权范围内（见 §3 授权边界），写成待办会制造「我可以推进」的假象。步骤 ④ 才是 archguard 的活——届时本文件的所有 AC 以那次冷启动的实测数据为基线重新核定 |
| **当前状态** | 本次冷启动是 **热拷贝**（`cp` 从 quay 开发目录复制 orchestrator-loop-tick.md 等文件），不是真正的从零冷装。热拷贝已验证机制**能在第二个项目上驱动开发**，但未验证**从包安装后能否工作** |

---

## 2. AC（可执行、可复核）

每条 AC 包含：判定命令、判定字段/退出码、当前实测状态、风险。

### AC1: `npm test` 在 600s 内退出码为 0

| 项 | 值 |
|---|---|
| **判定命令** | `timeout 600 npm test; echo $?` |
| **通过条件** | 退出码 0，且 `Test Files` 行 0 failed |
| **当前实测** | ❌ 退出码 1，492s 墙钟，1 failed / 4506 passed / 13 skipped |
| **失败归因** | `tests/integration/installer-claude-user-scope.test.ts` — E404 边界断言：测试期望 archguard npm 包未发布，但 v0.1.32 已发布，安装成功 |
| **风险** | 修复该测试可能暴露更多隐藏失败（之前被 timeout 300 截断从未跑完） |

### AC2: `npm run lint` 退出码为 0

| 项 | 值 |
|---|---|
| **判定命令** | `npm run lint; echo $?` |
| **通过条件** | 退出码 0，0 errors（warnings 不计入阻塞） |
| **当前实测** | ❌ 退出码 1，234 errors，3853 warnings（eslint --fix 后；修复前为 480 errors / 4137 warnings） |
| **失败归因** | 大量 `@typescript-eslint/no-unsafe-*` 和 `@typescript-eslint/no-explicit-any` 规则违反；eslint --fix 已自动修复了 ~246 errors，剩余 234 需手动处理 |
| **风险** | 手动修复 lint 可能引入行为变更（尤其是 `any` → 具体类型的重写） |

### AC3: `npm run type-check` 退出码为 0

| 项 | 值 |
|---|---|
| **判定命令** | `npm run type-check; echo $?` |
| **通过条件** | 退出码 0 |
| **当前实测** | ✅ 退出码 0（2026-08-03 冷启动时验证） |
| **风险** | lint 修复中若修改类型注解可能破坏类型检查 |

### AC4: CI 三盏灯全绿

| 项 | 值 |
|---|---|
| **判定命令** | `gh run list --limit 1 --json conclusion,status` |
| **通过条件** | `conclusion == "success"` |
| **当前实测** | ❌ 最近 5 次全 `failure`（最早 2026-07-12） |
| **失败归因** | CI 跑 `npm test` 带有 timeout 300（必然超时 → 124）+ `npm run lint` exit 1 |
| **风险** | CI 环境的 timeout 配置需与 AC1 同步调整 |

### AC5: 内层恢复时有 ≥3 个 ready 状态的任务

| 项 | 值 |
|---|---|
| **判定命令** | `grep -rl 'status: \(todo\|ready\)' tasks/*.md \| wc -l` |
| **通过条件** | ≥ 3 |
| **当前实测** | ❌ **0**——全部 25 个任务 status: done（`TASK-29` 到 `TASK-50`，含 `DIR-001`/`DIR-002`/`GATETEST`） |
| **风险** | 内层恢复后队列为空 → 立刻停摆等指令 → 外层必须手工补任务 |
| **注意** | 建任务不等同于恢复开发——任务可以先写成 `status: todo` 但不派发。这条 AC 只要求队列有货，不要求开工 |

### AC6: 外层可通过至少一种轻量手段获取内层状态（不依赖 capture-pane TUI 抓取）

| 项 | 值 |
|---|---|
| **判定命令** | `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json 2>&1` |
| **通过条件** | 5s 内返回合法 JSON，含 `inProgress` 字段 |
| **当前实测** | ❌ 文件不存在（`plugin/scripts/fast-mode-telemetry.ts` 是 quay 专属代码，未随 tick 文档移植） |
| **为何这是 AC** | 2026-08-03 冷启动中，四个取状态手段全不存在，外层被迫用 `tmux capture-pane \| md5sum` 高频轮询判断内层忙/闲——这正是 quay 顶层约定（CLAUDE.md:151）明确禁止的做法。这条 AC 是把「被禁止的降级路径」堵上 |
| **替代方案** | 如果 fast-mode-telemetry.ts 移植成本太高，至少需 `orchestration/watch/inner-state.sh`（事件式 Monitor）工作 |
| **风险** | 若 archguard 没有 quay 的遥测基础设施（task tracker / workflow events），可能需要先建那套东西——这本身就是一个大任务 |

### AC7: 存在资源闸，重操作前可程序化判断是否安全

| 项 | 值 |
|---|---|
| **判定命令** | `bash scripts/resource-gate.sh --for full-suite; echo $?` |
| **通过条件** | 退出码 0（允许）或非零带原因说明（拒绝）；拒绝时给出 `some avg10` 阈值和当前值 |
| **当前实测** | ❌ 文件不存在 |
| **为何这是 AC** | 冷启动中外层直接派发全量 `npm test`，没有检查 quay/meta-cc 是否也在跑重活。本机只有 4 核，跑满会把其他项目的 timeout 余量压成 flaky（quay 的 tick 文档 §0c 自己就记录过这个事故）。资源闸把「现在能不能跑」变成一个可核对的数字而不是惯例 |
| **风险** | 资源闸依赖 `/proc/pressure/cpu`（Linux 特有），macOS 上需要降级方案 |

---

## 3. 明确不是我的 AC

以下事项**不在 archguard 外层 AC 范围内**——它们属于 quay 交付物或 quay 的产品化工作：

| 事项 | 归属 | 说明 |
|---|---|---|
| quay 方法论文档不在 npm 包里（`files` 字段只含 `README/CHANGELOG/LICENSE/bin/src/dist`） | quay 交付物 | 这是 quay 打包配置缺陷，不是 archguard 的问题 |
| `orchestration/exp6-phase1-sustained-unattended-operation.md` 等 12 个文件从 quay 移植 | quay 交付物 | 这些文件在 quay 开发目录里但不在 npm 包里，下次冷启动应随包安装 |
| quay-init 真正冷装可用 | quay 产品化 | quay 的双层机制产品化交付物，不是 archguard 的活 |
| quay 自身 CI / 测试 / lint | quay | 同理 |
| meta-cc 的任何事项 | meta-cc | 独立项目 |
| **双层机制本身的架构决策**（如外层该不该直接写 `tasks/`、tick 间隔是否该调整） | 机制设计（属于 quay 的 exp6 范围） | archguard 是机制的**消费者**，不是设计者。若发现机制缺陷，记入 `cold-start-gaps.md` 并升级，但不自行修改 tick 文档 |

### 边界澄清

- **修改 `orchestration/orchestrator-loop-tick.md`**：不在我的 AC 内。那是从 quay 移植过来的机制文档，修改它等于修改机制设计——这属于 quay 的 exp6 范围。
- **创建新的 `orchestration/` 文件**（如本文档）：在我的 AC 内——archguard 自己的规划文档。
- **创建 `tasks/` 下的任务**：在我的 AC 内（外层可以建任务，见 tick 文档的授权边界裁定）。
- **修改 `src/` `tests/` 下的代码**：**不在**我的 AC 内——外层不直接改代码，由内层执行。

---

## 4. 当前实测状态汇总（2026-08-03T10:11Z）

| AC | 状态 | 关键数据 |
|---|---|---|
| AC1 — npm test 绿 | ❌ | exit 1, 492s, 1 failed (E404 boundary) |
| AC2 — lint 绿 | ❌ | exit 1, 234 errors, 3853 warnings |
| AC3 — type-check 绿 | ✅ | exit 0 |
| AC4 — CI 全绿 | ❌ | 最近 5 次全 failure（自 2026-07-12） |
| AC5 — 队列有货 | ❌ | 25/25 done, 0 ready |
| AC6 — 状态工具可用 | ❌ | 四个取状态工具全不存在 |
| AC7 — 资源闸存在 | ❌ | 文件不存在 |

---

## 5. 复核节奏

- **每个 tick 复核一次**（按 orchestrator-loop-tick.md §1 的观察步骤）。
- AC 状态变化时更新本文件对应条目。
- 若连续 3 个 tick AC 状态无变化（无推进），触发外层停止条件 → 升级给人。
