# archguard 队列状态（单一可信状态源）

> 本文件是 fast-mode tick 文档指定的状态单一来源。compact / `/clear` 后唯一可信的状态。
> 每个 tick 结束必须写回。以实测为准（git / 脚本输出），不以本文件的旧快照为准。
> 上次写回：2026-08-05 12:1xZ（内层冷启动恢复 tick #59——外层驱动消息触发的冷启动，非 /loop）。

---

## 当前实况（2026-08-05 12:1xZ，内层冷启动恢复 tick）

| 项 | 值 | 证据 |
|---|---|---|
| master | **53c6d95**（TASK-61 已 fan-in 合并；之后无 tick 提交） | `git log --oneline -1` |
| `.halt` | 不存在（管理者 07:45 起暂停已解除，恢复运行） | `ls .halt` |
| 就绪池 pool | **1**（仅 TASK-60）/ floor 12，criterion_met false，promotions 空 | `ready-pool-check --json` |
| TASK-61 | **已 fan-in**：合并 + scoped 绿（2 tests）+ worktree/分支清理 | 见下「本 tick」 |
| TASK-60 | **fan-in 被阻**（merge-conflict，已升级外层裁定） | 见下「本 tick」+ 阻塞信号 |
| 阻塞信号 | **存在**：`merge-conflict`（TASK-60，manual），options a/b/c 待外层裁定 | `inner-blocked-signal --read` |
| 在飞 subagent | 0（`ps -e -o comm= \| grep -cx node` = 0） | 实测 |
| 遥测 inProgress | TASK-60 / TASK-61 括号**仍在**（外层冷启动未闭合——已核为滞后误报，非真超时） | `fast-mode-telemetry --report` |
| full-suite-state | 缺失（外层未跑首轮，不阻塞） | `ls .quay/full-suite-state.json` |
| Monitor | **mounted:false**（单飞锁被 quay 持有；delivered:true 共享事件仍在流） | `monitor-mount-check --json` |
| 计量 | 已闭合 7 个（TASK-53…59），mean 63.06m；tasksPerHour 0.165 | telemetry |

## 停止条件（本 tick 命中）

- **merge-conflict（TASK-60）**：`git merge --no-ff task/TASK-60` 被工作树未提交改动拒绝
  （3 个机制脚本 local changes would be overwritten）→ §2 停止本 tick 后续合并与派发，升级外层。
- **task-over-90m（auto 误报，已清）**：TASK-60/61 括号 07:45 开、外层冷启动未闭合 →
  按 tick OVER90 注意（2026-08-05）核实为异步闭合滞后，非真超时；已 `--clear` 误报 auto 块，
  改落真实 `merge-conflict` manual 块。
- 其余未命中：无 `.halt`、无真合并冲突路径（git 干净拒绝，未产生 unmerged 路径）、
  full-suite-state 缺失不阻塞、pane=waiting-input 但 consecutive 0/3（括号在飞 = 良性空闲）。

## 本 tick（内层冷启动恢复）做了什么

1. **实况建立**：读 batch2-queue-state / goals-and-ac / tick 文档；跑
   `git log`+`git status`、`task-status-drift-check`（报 2 STRANDED = TASK-60/61 待 fan-in）、
   `fast-mode-telemetry --report`（inProgress 两括号）。
2. **TASK-61 fan-in（完成）**：worktree rebase master（干净）→ `git merge --no-ff task/TASK-61`
   → scoped 测试 `npx vitest run tests/types/no-analysis-imports.test.ts` **绿（2 passed）** →
   负控制证据已在任务体（桩→红→撤→绿）→ worktree remove + branch -d。AC 4 项全勾；DoD 未勾
   （外层收尾活，预期）。
3. **TASK-60 fan-in（被阻，升级）**：rebase 干净，但 `git merge --no-ff task/TASK-60` 被
   **工作树未提交改动**拒绝（3 个机制脚本会被覆盖）。调查结论：
   - **master HEAD 从干净检出是断的**：080c667 新建 `ready-pool-check.ts`，其 import
     `checkTaskTouchesResolve` / `expandDeclaredTouches` / `taskWorkLanded`，这三个函数
     **master HEAD 均未提交**（`git show master:...` = 0 命中）。工作树能跑通只因 3 个脚本有
     **未提交改动**（06:10Z 之后写入，+429 行，含全部三函数 + `countAcCheckboxes` +
     `hasAnyLandedNewTouch` + overshoot 修复）。
   - **TASK-60 分支**（4d7dfba）在**干净 worktree**（无工作树改动）里发现 ready-pool-check 断，
     **自己重造了**这三个函数（更简：`taskWorkLanded`=仅 `hasAnyCodeRootTouch`，**回归 overshoot
     修复**）+ TASK-62..66 搬入任务 + quay-tasks PARKED + 对账文档。**脚本改动不在声明 Touches 里**
     （声明的只有 TASK-62/自身/对账文档）——触碰声明外改动。
   - 两套实现语义有实质差异，丢弃任一侧都丢工作/回归机制 → 属判断边界「git 状态矛盾且无法判定」，
     落 `merge-conflict` 阻塞信号（options a/b/c）等外层裁定。
4. **工作树保全**：未提交改动 diff 存至 `.quay/fan-in-blocked-20260805/working-tree-diff.patch`
   （615 行），防裁定「丢弃」时不可逆丢失。quay-init 备份目录 `.quay/quay-init-backups/1785910228/`
   存的是 HEAD 版本（=06:10Z 时干净态）。
5. **就绪池核实**：TASK-61 被 `not-yet-flipped` 正确排除（工作已落地）；池仅剩 TASK-60；
   promotions/candidates 空（TASK-62..66 在被阻分支上，master 不可见）→ §2 冲突即停，本 tick 不派发。

## 发现 / 待查（有证据）

1. **master HEAD ready-pool-check 断**（见上）：080c667 提交了引用未提交函数的新脚本。
   根因待外层裁定（a/b/c）。这是本 tick 阻塞的机械根。
2. **TASK-60 分支触碰声明外文件**（3 个机制脚本）：subagent 在干净 worktree 修好了断的
   ready-pool-check，但改的是 Touches 未声明文件。合并时需裁：脚本改动算 deliverable 还是
   workaround（over-90m 括号未闭合也佐证其为修基座的 workaround 性质）。
3. **Monitor 未监视 archguard**（跨项目协调，q 见 batch2 上版）：单飞锁由 quay 持有。
4. **残留 worktree**：4 个 `.claude/worktrees/agent-*`（5–6 月，0 unique commit）+ 2 个 /tmp
   prunable——等待管理者确认后清理（既有事项）。

## 方向候选（TASK-60 裁定后）

| 候选 | 说明 |
|---|---|
| **TASK-60 落地** | 裁定 a/b/c 后 fan-in；TASK-62..66（搬入任务）随之可见，补就绪池 |
| A 类 E2E | 端到端验证（外层已裁定延后） |
| 剩余 B 类 / --prefer-offline | 既有候选项 |

TASK-60 裁定下达前：本 tick 已停派发（§2 冲突即停）。

## 计量表（fast-mode-telemetry）

- 已闭合任务：TASK-53…59（7 个，全 done），mean 63.06m，median 59.26m。
- tasksPerHour：0.165（windowStart 08-03T17:50 → windowEnd 08-05T12:16，含 29h 停机）。
- 累计死时间：历史 ruling-required（TASK-53，190s）+ 本 tick 误报 over-90m（90s，已清）。

## 备份 / 参考

- 外层驱动文本：`.quay/drive-text-round1.txt`（07:2xZ）/ `round2` / `round3`
- 工作树 diff 保全：`.quay/fan-in-blocked-20260805/working-tree-diff.patch`
- quay-init 备份：`.quay/quay-init-backups/1785910228/`（= HEAD 版本）
- quay-tasks 对账：`docs/analysis/quay-tasks-reconciliation.md`
- 目标与 AC：`orchestration/goals-and-ac.md`

## 12:33Z 更新（外层 tick #60：TASK-60/61 收尾 + 机制地基裁定）

1. **TASK-61 已收尾**（外层）：守卫测试独立核实（scoped 绿 2 passed + 负控制红已贴 + 已合并 53c6d95），翻 done + 关括号 fm-TASK-61。
2. **TASK-60 已收尾**（外层）：裁定方案 a 后内层执行——机制地基提交 d9dbd75（16 文件 +2947 行，工作树机制 = quay canonical，md5 逐字节核实）+ TASK-60 合并 f3b955f（15 非脚本交付物 +982 行：TASK-62..66 搬入 + quay-tasks PARKED + 对账文档）。独立核实 DoD 4 项（对账落盘/PARKED/池>0/重复未搬）→ 翻 done + 关括号 fm-TASK-60。
3. **master 从干净检出已修复**：三个函数（taskWorkLanded/checkTaskTouchesResolve/expandDeclaredTouches）已 committed。
4. **内层发现真机制 bug**：ready-pool-check not-yet-flipped 检测对 Touches `(new)` 反引号格式失效（TASK-60 工作落地未被排除）。内层在修 TASK-60.md Touches 格式。
5. **full-suite 推迟**：资源闸 WAIT（CPU some avg10≥40），且树刚稳定。待负载降 + 内层 Touches 修复落地后起。
6. **下一步**：TASK-62..66 是 todo 新候选，内层按 §3.6 补晋后派发。

## 12:4xZ 更新（内层执行裁定 a + §3.6/4 派发 TASK-62/63/64）

1. **裁定 a 执行（内层，承接外层 12:28Z 裁定）**：
   - 机制地基提交 **d9dbd75**（16 文件：11 M 脚本 + 2 tick 文档 + config/state/env，+2947 行）。
     提交后 master 从干净检出可用（三函数 committed，ready-pool-check 正常跑通）。
   - rebase task/TASK-60 → 3 脚本冲突取 master canonical（丢弃分支 workaround 重造）→ merge
     **f3b955f**（15 非脚本交付物 +982 行：TASK-62..66 + quay-tasks PARKED + 对账文档）。
   - worktree `task-60` 未清理（TASK-60 翻 done 由外层完成；worktree 遗留待确认）。
   - 阻塞信号 `merge-conflict` 已 `--clear`（等待 848s，裁定下达即恢复）。
2. **Touches 解析器 bug 定位 + 修复**：`parseTouchEntries` 对 `- \`path\` \`(new)\`（散文）` 多重
   反引号 bullet 解析出损坏路径（`"tasks/TASK-62.md\` \`(new)"`）→ `hasAnyLandedNewTouch` 失效 →
   TASK-60 落地未被 not-yet-flipped 排除。已修 tasks/TASK-60.md 该 bullet 为标准格式
   `- tasks/TASK-62.md (new)`（实测 taskWorkLanded false→true）。**解析器本体缺陷未修**（quay
   canonical，属机制归属问题，已由外层记入 manager-inbox）——留待 quay 侧修，本仓以任务文件格式
   规避。
3. **§3.6 补晋 + §4 派发（TASK-62/63/64）**：补晋 todo→ready 后 pool=3、dispatchable_disjoint=3、
   criterion_met ✓。§3.5 开括号（fm-TASK-62-1785933346103 / fm-TASK-63-1785933346498 /
   fm-TASK-64-1785933346833）。§4 并发派发 3 后台 subagent（worktree
   `/home/yale/work/archguard-worktrees/task-{62,63,64}`，分支 task/TASK-{62,63,64}），只提交不合并。
4. **TASK-65/66 依赖 TASK-64，未派发（机制正确把关）**：TASK-65 `parent: TASK-64`（depsReady=false）；
   TASK-66 Touches majority-missing（引用 TASK-64 将创建的 `src/analysis/jl/types.ts`、
   `src/cli/mcp/tools/arch-health-tools.ts`）。**TASK-64 落地翻 done 后，TASK-65/66 恢复可晋**，
   下个 tick 处理。
5. **遥测括号**：TASK-60/61 已由外层闭合（inProgress 空）；TASK-62/63/64 新开在飞。
6. **full-suite 状态**：外层 12:33Z 记 resource-gate WAIT，全量推迟。

## 12:48Z 更新（外层 tick #61：full-suite 启动）

1. **内层已派发 TASK-62/63/64**：三 worktree（task-62/63/64，基于 ffdb6c4）+ 三遥测括号在飞，等后台 agent（良性空闲）。TASK-65/66 依赖 TASK-64 的文件，待其落地后可晋。
2. **full-suite 已起**（外层后台，验证机制地基 + TASK-61/60）：资源闸 GO。**首次 `--test-concurrency=8` 被 vitest 3.2.4 拒绝**（CACError: Unknown option）——`--test-concurrency` 是文档虚构 flag（vitest 真 flag 是 `--maxWorkers`），无 wrapper 消费。误报红后改 `--maxWorkers=8` 重起，state=running（12:47），SUITE-RUNNING 已发。
3. **发现/待查**：`--test-concurrency` 文档 bug（quay 交付的 fast-mode 文档指令不存在的 flag）——证据：vitest 3.2.4 报 CACError。归 quay 机制文档，报 manager。
4. **红窗分诊记录**：12:46:33 的 SUITE-RED 是误报（我的命令 flag 错），非真测试失败；12:47:23 转 RUNNING 已撤信号。无真回归。

## 12:59Z 更新（红窗分诊：runner 假阳性红 → 已纠正 + TASK-67 立案）

1. **full-suite 完成（12:57）**：vitest 摘要 **4902 passed / 0 failed / 13 skipped / exit 0**——机制地基 + TASK-61/60 合并全绿。
2. **假阳性红**：runner 因 `✖ Diagram test failed...`（来自**通过**的负控制测试 console 输出）触发 early-red，state=red 错误在位（stop-dispatch 信号）。
3. **分诊**（外层，SUITE-RED 即触发）：核实 vitest 摘要（0 失败）→ 判为 runner 检测 bug 假阳性 → 手动纠正 state=green（12:58:49 SUITE-GREEN 已发，信号清除）。
4. **TASK-67 已建**（todo）：修 `full-suite-runner.ts:68` 的 `/✖/` 判红——匹配到通过测试的 console 输出。选定机制：结构化判红（vitest 失败文件行/汇总行），保留 node:test/TAP 模式。四件套+Contract 齐全。
5. **全量套件验证通过**：本轮合并（机制 + TASK-61/60）经 4902 测试验证，DoD 可勾（收尾 pass 后续执行）。

## 13:0xZ 更新（内层兜底心跳：TASK-62/63/64 在飞，无停止条件）

1. **TASK-62/63/64 均仍在飞（健康）**：三个 worktree 均有实际进展（未提交）——
   task-62（src/plugins/cpp/shared 实现 + 测试）、task-63（pack-registry/rule-engine + fixtures）、
   task-64（src/analysis/jl + mcp arch-health-tools）。worktree HEAD 均停在基址 ffdb6c4（未 commit）。
   4 个 claude agent 进程在跑。遥测三括号在飞（外层待闭合）。
2. **停止条件**：detect-stop 无命中、无阻塞；full-suite green（4902 passed/0 failed/exit 0）；
   `.halt` 无。Monitor 仍 mounted:false（既有跨项目 gap，delivered:true）。
3. **就绪池**：pool=0（62/63/64 在飞）；TASK-65/66 依赖 TASK-64 文件未落地，仍不可晋。
4. **本 tick 无合并/派发**（agent 未完成）。等待 task-notification 后按 §2 fan-in；
   TASK-64 落地后 TASK-65/66 恢复可晋（§3.6/4）。
