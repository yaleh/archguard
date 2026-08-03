# 外层交接文档 —— 继任者第一个 tick 需要知道的一切

> 写给 deepseek-v4-flash（不是 pro）。你的前任是 pro，
> 本文档把你需要而现有文档里没有的东西写成明文。
> 读完本文档后，按 `orchestrator-loop-tick.md` 冷启动步骤执行。

---

## 1. 你现在是谁、在哪

你是 **archguard 双层机制的外层**。内层是 tmux `archguard-2:0.0`（deepseek-v4-flash）。

| 你的文件 | 路径 |
|---|---|
| tick 指令（你该做什么） | `orchestration/orchestrator-loop-tick.md`（563 行） |
| 你的 AC | `orchestration/goals-and-ac.md`（149 行） |
| 冷启动差异清单 | `orchestration/cold-start-gaps.md`（95 行） |
| tick 历史 | `orchestration/tick-log.md` |
| 升级积压（给人看的） | `orchestration/escalations.md` |
| 内层 tick 指令 | `docs/analysis/fast-mode-loop-tick.md` |
| 内层队列 | `tasks/*.md`（27 个任务） |
| 监视器脚本 | `plugin/scripts/inner-state.sh`、`plugin/scripts/session-liveness.sh` |
| 跨项目令牌 | `plugin/scripts/heavy-op-token.sh` |
| 资源闸 | `plugin/scripts/resource-gate.sh` |
| 遥测 | `plugin/scripts/fast-mode-telemetry.ts --report --json` |

### 项目拓扑

本机 4 核，三个项目共享 CPU：

```
/home/yale/work/quay        — quay（可能正在跑，用 heavy-op-token.sh 协调）
/home/yale/work/archguard   — 你在这里
/home/yale/work/meta-cc     — meta-cc（可能正在跑）
```

**跑重活（全量测试、lint 全量）前必须用 `plugin/scripts/heavy-op-token.sh --acquire archguard` 拿令牌。**
三个项目的令牌是同一把——先拿到的先跑，后来的等。

---

## 2. 内层此刻在做什么——以及如何恢复

**内层正在执行 TASK-52（lint 234 errors → 0）。**

### 如何判断它是否还在跑

**不要读 TUI 内容来判断。** 用 md5sum 方法：

```bash
# 取两次，间隔 25 秒以上
tmux capture-pane -p -t archguard-2:0.0 | md5sum
# ...等 25 秒...
tmux capture-pane -p -t archguard-2:0.0 | md5sum
# 两次相同 = 空闲（可能需要你发指令）
# 两次不同 = 正在工作（不要打断）
```

### 如果内层空闲且 TASK-52 未完成

说明它停下来了——可能完成了当前步骤、在等你确认、或遇到了问题。
看 `tasks/TASK-52.md` 的 status 字段和最后一段输出来判断。然后重新派发或给下一步指令。

### 如果内层空闲且 TASK-52 已完成

检查 `tasks/TASK-52.md` 的 status。如果 status: done：
1. 跑 `npm run lint; echo $?` 独立验证（这需要先拿令牌）
2. 若 lint exit 0 → AC2 ✅，更新 goals-and-ac.md
3. 若仍有 errors → 把剩余数写回 TASK-52 的 Completion 段，重新派发

### 如何给内层发指令

**三个 tmux send-keys 分开调用，不能合并：**

```bash
tmux send-keys -t archguard-2:0.0 C-u          # 清空输入框（C-u 是清除，必须做——输入框里可能有 ghost 建议）
tmux send-keys -t archguard-2:0.0 "你的指令"    # 指令文本
tmux send-keys -t archguard-2:0.0 Enter         # 提交
```

发完后用 `tmux capture-pane -p -t archguard-2:0.0 | grep -c "你的指令关键词"` 确认送达（结果 ≥ 1 即送达）。
**不要用 capture-pane 读内层的输出内容来判断结果**——结果从 git log、日志文件、tasks/*.md 读取。

---

## 3. 你挂的监视器——怎么挂的、参数是什么

两个监视器都是 persistent Monitor，都在本会话内（会话结束就没了，新会话必须重挂）。

### inner-state.sh — 看内层工作状态

```bash
Monitor({
  command: "/home/yale/work/archguard/plugin/scripts/inner-state.sh",
  description: "内层状态转变",
  persistent: true,
  timeout_ms: 3600000
})
```

**事件含义**（它只在状态转变时发声，不刷屏）：

| 事件 | 含义 | 你该做什么 |
|---|---|---|
| IDLE | 在飞任务清空 | 检查内层是否在等裁定（看 tasks/*.md + capture-pane 末行是否有问题） |
| START | 新一批任务开工 | 记录，不需要行动 |
| OVER90 | 单任务超 90 分钟 | 判断是任务过大（指示拆分）还是卡住（指示放弃+建后续） |
| ORPHAN | 有 `--task-start` 无 `--task-end` | 检查遥测，确认是否真的孤儿 |
| RISKY | master 出现 revert/force 类提交 | 核实——可能只是提交消息里带了 "revert" 字样而不是真 revert |
| BLOCKED | 内层主动写 `.quay/inner-blocked.json` | **这是内层在等你裁决**——读文件内容，里面有 reason 和 question |

**⚠️ 新检测器的第一条事件默认当作误报，先验证再行动。** 这是前 5 个 tick 里被反复证明的——首次 IDLE 可能只是 subagent 在工作、首次 RISKY 可能匹配的是提交消息措辞。

### session-liveness.sh — 看会话本身还在不在

```bash
Monitor({
  command: "/home/yale/work/archguard/plugin/scripts/session-liveness.sh",
  description: "会话存活（进程活/死/忙/闲/心跳逾期）",
  persistent: true,
  timeout_ms: 3600000
})
```

**事件含义**：

| 事件 | 含义 | 你该做什么 |
|---|---|---|
| SESSION-GONE | 会话进程消失 | **紧急**——内层可能崩溃了，立刻检查 `tmux list-panes` |
| SESSION-BACK | 会话恢复 | 记录，不需要行动 |
| SESSION-STALL | 活着但 ≥45 分钟无新提交 | 检查内层是否卡住 |
| SESSION-OVERDUE | 心跳文件 ≥45 分钟未更新 | **在外层刚启动时正常**（tick-log 还没写）；若持续出现 = 会话可能已死 |
| SESSION-IDLE | 相邻两轮 pane 哈希相同=空闲 | 正常收尾时的 SESSION-IDLE 在心跳 < LOOP_MIN 时静默；不静默的 = 真停了 |
| SESSION-RESUMED | 从空闲恢复活动 | 正常——说明你在工作。**这是唯一能确认会话还在按期活动的正向信号** |

### 为什么不合并

`inner-state.sh` 只看工作产出——内层死了它只会看到「没有新遥测」，与「在思考难题」同形。
`session-liveness.sh` 补的正是这个洞——它看进程存活和心跳。
**合并会让一种失效掩盖另一种。**

### 挂载后验证

重挂后立刻跑自检，不要靠「看起来挂上了」：

```bash
bash plugin/scripts/session-liveness.sh --once
```

应输出一行 SESSION-STATUS，确认 alive=1。

---

## 4. 前 5 个 tick 踩过的坑——文档里没写的

### 坑 1：外层被逼进 capture-pane 忙等（tick #1-2）

**现象**：你要知道内层在做什么，但四个取状态工具全不存在（tick 文档引用的 fast-mode-telemetry.ts、inner-state.sh、inner-forensics.mjs、workflow-events 在热拷贝时一个都没有）。

**已解决**：AC3 冷启动后，这些文件已从 dist artifact 安装到 `plugin/scripts/`。**今后直接用 Monitor + telemetry，不要再高频 capture-pane。**

**如果又出现工具缺失**：结果一律看 git log / git status / tasks/*.md / 日志文件。capture-pane 只用于确认 send-keys 送达和判断忙/闲（md5sum 方法）。

### 坑 2：hostname `vhs` 没有 `/usr/bin/time`（tick #1）

**现象**：内层用 `/usr/bin/time -v` 包装 npm test，exit 127（命令未找到）。

**教训**：本机是精简环境，不要假设 GNU time 存在。用 bash 内置 `time` + `TIMEFORMAT`。

### 坑 3：pgrep -f 把自己算进去（tick #1-2）

**现象**：用 `pgrep -f "npm test"` 查并发套件，得到 3 且「在上涨」，几乎据此误报——实际是 0 个真进程，pgrep 匹配了自己的命令行。

**正确做法**：
- 数进程用 `ps -e -o comm= | grep -cx node-MainThread`（精确匹配 comm）
- 或用 `pgrep -xc node`（-x 精确匹配）
- **Node 进程的 comm 是 `node-MainThread`，不是 `node`。** `comm=node` 永远不匹配。

### 坑 4：任务文件缺少 YAML frontmatter → web dashboard 500（tick #4）

**现象**：手写的 TASK-51.md 和 TASK-52.md（`# TASK-51: ...` + `status: todo`）导致 `http://100.87.141.82:4174/` 报 500。

**原因**：quay 的 task provider 在 taskList 时对整个任务库解析 YAML frontmatter。一个文件没有 → 抛异常 → 整页不可用。

**正确格式**（照 DIR-001 的模板）：

```yaml
---
id: TASK-NN
title: "TASK-NN: 标题"
status: todo
labels:
  - defect
parent: null
extra:
  schema: v1
---
# TASK-NN: 标题

status: todo
...正文...
```

**建新任务时直接用这个模板，不要只写 `# TASK-NN: ...` + `status: todo`。**

### 坑 5：grep 关键词核实修复 → 命中的是缺陷文档本身（tick #2）

**现象**：为核实修复是否落地，grep 了缺陷关键词，命中了——但命中是注释里写的「为什么这个缺陷是错的」。

**教训**：grep 关键词用来查「缺陷还在不在」是反向指标——修复的说明里必然写着缺陷的名字。
核实修复要读 diff（`git show`）或看行为（重跑测试），不能 grep 关键词。

### 坑 6：`--report` 是纯读，但 session-liveness.sh 不是（tick #4）

**现象**：session-liveness.sh --once 会 touch 心跳检测用的状态，导致工作树出现未提交修改（`.quay/quay-init-state.json`）。

**教训**：观测命令理想上不改变被观测对象。session-liveness.sh 是例外——它的心跳写盘是有意设计的。
tick 结束时 `git add -A` 会包含它。

---

## 5. 当前 AC 快照（2026-08-03 ~15:50Z）

| AC | 状态 | 关键数据 | 下一步 |
|---|---|---|---|
| AC1 — npm test 绿 | ✅ | exit 0, 475.78s, 0 failed | 保持，每次 tick 可抽样验证 |
| AC2 — lint 绿 | ❌ **进行中** | 内层正在修 TASK-52，234→0 | 等内层完成 → 验证 `npm run lint` exit 0 |
| AC3 — type-check 绿 | ✅ | exit 0 | 保持 |
| AC4 — CI 全绿 | ❌ | 依赖 AC2 | AC2 完成后检查 `gh run list` |
| AC5 — 队列有货 | ✅ | TASK-51 done, TASK-52 进行中 | 队列消耗后补货 |
| AC6 — 状态工具 | ✅ | 文件存在，监视器已挂载 | 继续使用 Monitor |
| AC7 — 资源闸 | ✅ | 文件存在 | 跑重活前用它 |

### AC 判定命令速查

```
AC1: timeout 600 npm test; echo $?          # 期望 0
AC2: npm run lint; echo $?                  # 期望 0
AC3: npm run type-check; echo $?            # 期望 0
AC4: gh run list --limit 1 --json conclusion,status  # 期望 "success"
AC5: grep -rl 'status: \(todo\|ready\)' tasks/*.md | wc -l  # 期望 ≥3
AC6: node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json  # 期望 5s 内合法 JSON
AC7: bash plugin/scripts/resource-gate.sh --for full-suite; echo $?  # 期望 0 或带原因的非零
```

---

## 6. Tick 操作清单（每次 tick 按此顺序）

```
1. date -u '+%H:%MZ'                                    # 记录时刻
2. tmux capture-pane -p -t archguard-2:0.0 | md5sum     # 内层快照
3. git log --oneline -5 && git status --short           # git 实况
4. node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json  # 遥测
5. 判断内层忙/闲（两次 md5sum 比对）
6. 分类 tick 类型（no-action / unblock / correct / escalate）
7. 按内层停摆原因消解（见 orchestrator-loop-tick.md §3）
8. 队列不足时补货（建任务用 §4 的 YAML 模板）
9. 写 tick-log.md（时刻用 date -u，不许估）
10. git add -A && git commit
11. ScheduleWakeup 或依赖 cron 自动触发
```

---

## 7. Cron 与 Monitor 重建（新会话必须做这两步）

**Cron**：前一个会话的 cron 随会话结束消失。新会话必须重建：

```
CronCreate(cron="7,27,47 * * * *", prompt="执行 /home/yale/work/archguard/orchestration/orchestrator-loop-tick.md 中的 tick 指令。archguard 项目，内层 tmux archguard-2:0.0。按 tick 文档冷启动步骤执行：观察 → 分类 → 消解 → 补队列 → 写回。", recurring=true)
```

**Monitor**：同样随会话消失。重挂命令见 §3。

---

## 8. 停止条件（外层自己的）

连续 3 个 tick 没有推进任何任务状态 → 停止，写 `orchestration/escalations.md`，等人。

「推进」的定义：有任务状态变化、有 commit 落地、或有升级项产生。
三次都是 no-action 且内层无进展 = 系统卡住了。

---

## 9. 一份你可能会用到的快速命令

```bash
# 看内层最后 20 行（用于判断是否在问问题，不用于读结果）
tmux capture-pane -p -t archguard-2:0.0 | tail -20

# 三个项目的 .halt 状态
for d in /home/yale/work/{quay,archguard,meta-cc}; do printf "%-12s %s\n" "$(basename $d)" "$([ -f "$d/.halt" ] && echo "暂停: $(head -c 80 $d/.halt)" || echo 运行中)"; done

# 跨项目令牌（跑重活前）
bash plugin/scripts/heavy-op-token.sh --acquire archguard --timeout 0

# 资源闸（跑全量套件前）
bash plugin/scripts/resource-gate.sh --for full-suite

# 数真实 node 进程（不要用 pgrep -f）
ps -e -o comm= | grep -cx node-MainThread
```

---

**写于 2026-08-03T15:50Z，tick #5 后。前任：deepseek-v4-pro。继任者：deepseek-v4-flash。**
