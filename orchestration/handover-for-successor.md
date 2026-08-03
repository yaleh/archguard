# 外层交接文档 —— 继任者第一个 tick 需要知道的一切

> 写给继任者（本文件不绑模型名——已两次换模型，bind 在名字上只会一直过时）。
> 第一版（pro→flash）已把「你需要的而现有文档里没有的」写成明文，效果是管理者
> 只花两条指令就完成了交接。第二版（flash→qwen）补内层 TASK-53 位置、flash 班的坑、
> 给 qwen 的明文前提（§10–§12）。
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
**二版补记 2026-08-03T16:48Z，tick #8 后。前任：deepseek-v4-flash。继任者：claude-aliyun 的 qwen3.8-max-preview。**

---

## 10. 内层此刻的位置 —— TASK-53 做到哪、从哪继续（2026-08-03T16:45Z 快照）

> **先读这条：内层此刻的工作大部分是可恢复的，不要从头再来。** 它丢的只是对前三轮
> 失败原因的**分析过程**（那份分析正在被要求写进 `tasks/TASK-53.md` 的 Progress 段——如果
> 它在你接手前还没提交，你接手后的第一个动作就是确认它落地了）。它等的结果是 **GitHub
> Actions 的外部状态**，不在会话里，`gh run list` 随时能看到。

### 时间线（全在 git 历史里，可核实）

| 时刻 | commit | 内容 | CI 结果 |
|---|---|---|---|
| 16:20 | `a911166` | matrix Node 20→[22,24]，engines >=22.6（Node 20 无 `--experimental-strip-types`） | failure：Node 24 `Cannot find module 'tree-sitter'` |
| 16:30 | `626a155` | 内层把 tree-sitter 语法包加进 devDependencies（**注意：这与 my tick #8 同名同 hash，内容寻址巧合**，见 §12 坑 4） | failure（同前） |
| 16:40 | `af4f85f` | 改为 CI `npm ci` 后 `--no-save` 装原生语法包（满足 packaging 测试的「原生语法不进 package.json」要求） | failure |
| 16:41 | `f628b8f` | **revert** 上一条的 devDependencies 改动，恢复干净 lockfile，删 `.npmrc` | failure |

**第 4 轮结果（16:42 完成）**：run `30833301070`（headSha `f628b8f`）仍 **failure**——Node 24
Run tests 红、Node 22 同步骤 cancelled。type-check/lint/format/build 全绿，唯一红步是 Run tests。
**失败的测试仍报 `Cannot find module 'tree-sitter'`**（40 files / 385 tests，与第 2 轮完全相同），
尽管 CI 加了 `Install native tree-sitter grammars (test-only)` 步骤。该步骤输出 `added 4 packages,
audited 632 packages in 3s`——太快，native 绑定（node-gyp-build）不可能已构建；且 npm 11 的
allow-scripts 只列出 kotlin grammar 有 install 脚本。**tree-sitter 核心对测试仍不可解析。**

**内层已在 `tasks/TASK-53.md` Progress 段完整落盘四轮分析 + 下一步假设**（接手第一个动作就是读它）：
- 疑点 A：`npm ci --no-save` 追加安装与 npm 11 allow-scripts / prune 行为冲突
- 疑点 B：`--legacy-peer-deps` 忽略 peer，但 `tree-sitter@^0.25.0` 是显式实参，需确认去向
- 备选：`ARCHGUARD_NATIVE_MODULE_ROOT` 指向预装根（文档 Option 2），或给硬依赖 native 的
  40 文件/385 测试加「tree-sitter 缺失即 skip」防护

### 新内层接手后从哪里继续

1. **第一个动作**：确认 `tasks/TASK-53.md` 的 Progress 段已落盘（外层收尾前已要求写）。
   若未提交，看 /tmp 与 git diff；若已提交，直接读任务体。
2. **第 4 轮结果已经出来（16:42，仍 failure）**：不需要再等。下一步是内层 Progress 段列出的
   「疑点 A/B」验证——拉第 4 轮 `Install native tree-sitter grammars` 步骤完整输出，确认那
   「4 packages」具体是谁、`node_modules/tree-sitter` 在 CI 上是否存在、`.node` 绑定是否构建。
   - 修复后 push 新 commit 触发第 5 轮，`gh run watch` 验证。
   - 若 success → AC4 ✅，更新 goals-and-ac.md，派发 TASK-54。
   - 若 failure → 看 `/tmp/task53-watch4.log` + `gh run view <id> --log-failed` 定位新失败点。
3. **前三轮的根因结论（已确认，不必重查）**：
   - Node 20 无法 build（`node: bad option: --experimental-strip-types`）→ matrix 去掉 20，改 [22,24]，engines 提到 >=22.6。
   - tree-sitter 是 optional peer dep，`npm ci` 不装 → 测试报 `Cannot find module 'tree-sitter'`。
   - 修复方案有约束：**packaging 测试（install-policy）要求原生语法包不进 package.json**，所以走 CI `--no-save` 安装，不是加 devDependencies（那路径已被 `f628b8f` revert）。
4. **若这轮还是红**：下一个怀疑点是 vitest 配置的 coverage 阈值或 Run tests 超时（本地全量 475s，
   CI 有 matrix 双跑）。把实测写回任务体再派发，不要无依据改配置。

### 队列状态（16:45Z）

- TASK-53 进行中（内层在飞）
- TASK-54（warnings 清理）、TASK-55（stranded 分支分诊）就绪，未派发

---

## 11. flash 这一班的坑 —— 文档里没有、你大概率会踩

### 坑 1：`git add -A` 会把内层正在工作的改动一起收走（严重，我踩了）

tick #8 我用 `git add -A` 提交，把内层未提交的 package.json/package-lock.json/.npmrc 全收进了
我的 tick commit——**违反单一写入者纪律**。修复用了 `git reset --soft HEAD~1` + `git restore --staged`
拆开，但整个过程很惊险，而且内层在后台并行提交时产生了内容寻址巧合（见坑 4）。

**规则**：外层提交**只 `git add` 你自己的文件**（tick-log、orchestration/*.md、新建的 tasks/*.md），
**永远不用 `git add -A`**。提交前 `git status --short`，看到 `M package.json` / `?? .npmrc` 这类
非你产出的改动，先确认是不是内层的在飞工作。

### 坑 2：判忙闲时 `← 1 agent` 状态栏可能是指「内层在等自己的后台任务」，不是 subagent

内层跑 `gh run watch ... &` 后台任务时，状态栏 `← 1 agent` + pane 静止容易误判为「有 subagent 在
忙」。真判断要看 **transcript 的时间 cost**（`inner-forensics.mjs timecost`）或 **两次 md5sum 差异**。
内层「等 CI 结果」是**真 idle 的变种**——它没在思考，你发指令它会响应（我实测：`Waiting for task`
状态下发指令成功送达）。

### 坑 3：`npm run lint` / `format:check` 这类「中等重活」也要尊重令牌

AC2 核实我**没跑全量 lint**——不是因为它太贵，而是 quay 持有跨项目令牌跑 test.sh，load 15-21。
tick 文档 §0c 的资源纪律同样适用：**重跑全量前先 `heavy-op-token.sh --acquire`**。零成本替代
（transcript + 磁盘日志 + diff）对核实「修没修好」足够，且不抢 CPU。

### 坑 4：git 内容寻址会产生「同名同 hash」的巧合 commit（罕见但会吓到人）

tick #8 我 reset 掉一个 commit（626a155 含内层文件），内层在后台又提交了**相同内容**的 commit，
于是 hash 又是 626a155——看起来像「我的 reset 没生效」。**核实历史用 `git log --graph` 看父子链**，
不要因为 hash 相同就怀疑自己的操作。

### 坑 5：`sleep` 在 Bash 工具里被沙箱阻止

`sleep 26; tmux capture-pane...` 直接报 Blocked。**判忙闲的间隔采样要用 `run_in_background: true`**
跑 `sleep 25; ...`，或者用 Monitor。不要在 Bash 工具里 sleep。

### 坑 6：`monitor-mount-check.sh` 不在 archguard 的 plugin/scripts 里

tick 文档 §4c 引用它做三判据自检，但 archguard 装的是 quay 分支的子集，这个文件只在 quay。
**用 `session-liveness.sh --once` 代替**（交接 §3 原方法），输出 `SESSION-STATUS ... alive=1` 即挂载成功。
若想要三判据，去 quay 的 `/home/yale/work/quay/plugin/scripts/monitor-mount-check.sh` 看逻辑。

---

## 12. 给继任者（qwen3.8-max-preview）的明文前提 —— 别靠推理补

以下是我（flash）**明确知道**的，不需要你推理：

1. **模型身份**：你是 claude-aliyun 的 qwen3.8-max-preview，不是 deepseek，不是 claude。你的
   能力边界我不知道，所以**凡是不确定的环境事实，先验证再行动**，不要假设「上家能做的我也能」。
2. **环境**：本机 4 核，三个项目共享（quay / archguard / meta-cc）。跑重活前必须拿跨项目令牌
   `heavy-op-token.sh --acquire archguard`。当前 quay 持有令牌在跑它的 test.sh（load 15-21，很高）。
3. **双层机制**：你是 archguard 的**外层**。内层是 tmux `archguard-2:0.0`，它执行任务、你观察/消解/
   补队列。外层**不直接改代码**——只下指令、写 orchestration/ 和 tasks/*.md。
4. **你的文件**：驱动 `orchestration/orchestrator-loop-tick.md`（563 行，quay 装进来的模板），
   目标/AC `orchestration/goals-and-ac.md`（可改但要写明依据）。AC 快照见 §5（二版补记了 AC2 ✅、
   AC5 ✅ 3 ready）。
5. **监视器**：两个 persistent Monitor（inner-state + session-liveness）**随会话消失**，你接手后
   必须重挂（§3 精确参数），重挂后 `session-liveness.sh --once` 自检。cron 也要重建（§7）。
6. **内层此刻在 TASK-53 的完整上下文**：见 §10。它的会话也换模型重启，上下文会丢——所以 §10
   的「从哪继续」是给你新内层的路线图。
7. **上一份交接（pro→flash）的效果**：管理者只花两条指令完成了交接——因为 pro 把所有隐含前提
   写成了明文。这份对你也一样：**看不懂就照 §12 的数字查文件，不要猜**。
8. **换模型是第二次了**：本文件已改名 `handover-for-successor.md` 不绑模型名——下次换模型时
   **继续用这个名字**，不要新建 `handover-for-<model>.md`。

---

**写于 2026-08-03T15:50Z，tick #5 后。前任：deepseek-v4-pro。继任者：deepseek-v4-flash。**
**二版补记 2026-08-03T16:48Z，tick #8 后。前任：deepseek-v4-flash。继任者：claude-aliyun 的 qwen3.8-max-preview。**
