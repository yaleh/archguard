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

## 13:1xZ 更新（fan-in TASK-64 + TASK-62，派发 TASK-67）

1. **TASK-64 fan-in（完成）**：agent 完成（branch `task/TASK-64`，61c7e4a，18 文件 +1988）→ rebase
   干净 → merge → scoped **61 passed**（jl/ 6 文件）→ worktree/分支清理。
   - AC1/2/4/5/6 勾；**AC3 性能 spike 未勾**——环境受限（本机负载高，ml-matrix SVD 比 proposal
     假设慢 10-100×；spike 文件本身按 spec 实现）。**需外层在收尾时裁**（真回归 vs 环境限制）。
   - 发现：任务文件 Touches 写 `src/cli/mcp/server.ts` 但真实文件是 `mcp-server.ts`（registration
     落在 mcp-server.ts，DoD #8 grep 路径需更正）；`run-analysis.ts` 加 `lastArchJson` 可选字段
     （Touches 外的最小 enabling 改动）；computeK 用 ⌈⌉ 而非 proposal 的 round（308/379 vs 307/378）。
2. **TASK-62 fan-in（完成）**：agent 完成（branch `task/TASK-62`，0d49105，2 commits）→ rebase
   干净 → merge → scoped **158 passed**（9 文件）→ worktree/分支清理。AC 5 项全勾。
   - 发现：`npm run build` 不复制 `src/plugins/*/queries/*.scm` 到 dist（打包产物缺查询文件——
   需后续任务）；触及 Touches 外的共享文件（syntax-tree.ts / native/wasm-parser-backend.ts——
   需暴露 ParserSession.query，其它语言 bridge 未迁移，ArchJsonMapper 未动）；顺手修了一个潜在
   bug（collectNamespace 修 namespace 前缀）。
3. **TASK-67 补晋 + 派发（完成）**：外层 12:59Z 建的 runner 判红 bug 缺陷任务——§3.6 补晋
   todo→ready、§3.5 开括号（fm-TASK-67-1785935423711）、§4 后台派发（worktree task-67，分支
   task/TASK-67）。与在飞 62/63 并发 disjoint 核实（batch=[62,63,67]）。
4. **在飞**：TASK-63（未完成）、TASK-67。TASK-65/66 等 TASK-64 翻 done（外层收尾）后可晋。
5. **full-suite**：green（4902 passed / 0 failed）。TASK-64/62 合并未经新全量（外层下一轮验证）。

## 13:2xZ 更新（fan-in TASK-63 + 机制发现）

1. **TASK-63 fan-in（完成）**：agent 完成（branch `task/TASK-63`，a3d335f）→ rebase 干净 → merge →
   scoped **77 passed**（7 文件，pack-registry/rule-engine/packs + 回归）→ worktree/分支清理。
   AC 5 项全勾。注意：新增 `js-yaml`/`@types/js-yaml` 依赖（package.json/lock 随 merge 落地）。
2. **TASK-64/62/63 全部已合并**；TASK-67 在飞（唯一 worktree task-67）。pool=0。
3. **TASK-65/66 仍不可晋**：均 `parent: TASK-64`，TASK-64 尚未被外层翻 done → depsReady false。
   **TASK-64 翻 done 后两者可晋可派**（66 的 touches 已随 TASK-64 落地解析通过）。
4. **机制发现（有证据）**：`taskWorkLanded` 符号信号对「修既有代码的任务」误报——
   TASK-67（在飞）被 excluded 为 `not-yet-flipped`：其 AC 引用 `isFailureLine` /
   `full-suite-runner.ts` / `SUITE-RED`，**全部是已存在的被修复目标** ⇒ 符号解析误判「已落地」。
   影响：在飞期间池将其计为已落地（不阻塞——在飞另有 --in-flight/遥测跟踪）；真正风险是若该任务
   工作未落地，排除会掩盖它需要派发。属 quay canonical 机制缺陷，归 manager-inbox，本仓不改。

## 13:3xZ 更新（fan-in TASK-67 —— 全批完成；未跟踪机制文件阻挡合并的处理）

1. **TASK-67 fan-in（完成）**：agent 完成（branch `task/TASK-67`，37db5e0）→ rebase 干净 →
   **merge 被未跟踪文件阻挡**（`full-suite-runner.ts` + `suite-state-trigger.ts` 在 master 未跟踪，
   分支将其提交）→ 处理：把 2 个未跟踪工作树副本移到 `.quay/pre-task67-merge-untracked/`
   （可逆，非删除）→ merge 成功（runner/trigger 变为 master tracked）→ scoped 验证
   `--fail-fast-check` OK（真失败→red→SUITE-RED→stopSignal，exit 0）→ worktree/分支清理。
   - 合并后的 runner 修复在位：无裸 ✖ 判红（注释说明通过测试的 console 会打印 ✖），新增
     vitest 结构化判红（`Test Files X failed` / `Tests Y failed`，X|Y>0），保留 node:test/TAP 判红。
   - AC1/2/4 勾；AC3（全量）deferred（scoped-only 纪律，外层下一轮全量验证）。
2. **TASK-62/63/64/67 全批已合并**（各 scoped 全绿）；**无在飞任务、无 worktree**。pool=0。
3. **TASK-65/66 等 TASK-64 翻 done**（外层收尾）→ 之后可晋可派（66 的 touches 已解析通过）。
4. **机制归属缺口（给外层）**：merge 使 `full-suite-runner.ts` + `suite-state-trigger.ts` 变为
   tracked（此前未跟踪）。但仍有 ~24 个机制脚本未跟踪（monitor-mount-check.sh、
   session-liveness-mount.sh、capability-catalog.sh、loop-driver-check.sh、read-probe-spec.ts、
   suite-state-trigger.ts 等）——归 manager-inbox 的机制归属问题，待外层统一裁（是否一并 commit）。

## 13:4xZ 更新（红窗 forward-fix 执行 —— 外层 13:39Z 裁定）

full-suite **真红**（3 文件 6 失败，5013 passed）→ 外层裁定 forward-fix 不回滚。内层执行：

1. **cpp ArchJSON 分叉（5 失败）根因**：TASK-62 的 tree-sitter-bridge 用
   `new URL('./queries/', import.meta.url)` 解析 `.scm`；**tsc 不复制 .scm 到 dist** ⇒
   `npm pack` 出的 dist 无查询文件 ⇒ driver 路径加载空查询 → cpp 输出与直接 parseCode 分叉
   （parser-runtime-packed / install-policy）。**修复**：新增 `scripts/copy-query-files.sh`
   （build 时复制 `src/plugins/*/queries/*.scm` → `dist/plugins/*/queries/`），build 脚本接入。
   **未改任何基线/期望值**。重建后 dist 含 5 个 .scm，两条路径均查询驱动、输出一致。
2. **ADR-007 违规（1 失败）**：`archguard_get_intrinsic_dimension` MCP tool 无匹配 CLI flag
   （canonical "intrinsic-dimension"）。**修复**：query.ts 加 `--intrinsic-dimension` flag +
   handler（读持久化 arch-health 历史，镜像 MCP tool 读路径，无需 engine）。实测无历史时优雅提示。
3. **重跑全绿**：`parser-runtime-packed`（3）+ `install-policy`（8）+ `check-adr`（28）；
   query 命令 + arch-health scoped 回归（64）。type-check 0。提交 **52fa600**。
4. **state=red 期间停新批派发**（裁定）——本 tick 无派发。等外层 re-green 后 TASK-65/66 可晋。
5. TASK-62/64 保持 done，DoD（full-suite 绿）待本修复 + 外层新全量绿后勾。

## 14:1xZ 更新（full-suite re-green 中；TASK-65 派发）

1. **外层新 full-suite 已起（14:06Z，running）**——验证 forward-fix（52fa600）。TASK-64 已被外层翻
   done ⇒ TASK-65/66 parent 解除、恢复 eligible（promotions 推荐）。
2. **TASK-65/66 共享文件重叠**（都改 `src/analysis/jl/types.ts` / `arch-health-tools.ts` /
   `server.ts`）——并发闸判 deferred。按 tick「重叠 → 不同批」：**本批只派 TASK-65**，
   TASK-66 等 TASK-65 落地后派。
3. **TASK-65 补晋 + 派发**：todo→ready、§3.5 开括号（fm-TASK-65-1785939218736）、§4 后台派发
   （worktree task-65，分支 task/TASK-65）。TASK-66 保持 todo。
4. **在飞**：TASK-65。full-suite running（照常派发，red 停止条件已解除）。

## 14:2xZ 更新（full-suite green 确认 + TASK-65 agent 中断/resume）

1. **外层 tick #68（ff6ed00）**：新 full-suite **green（5019/0，14:15Z）**——forward-fix（52fa600）
   验证通过，TASK-62/64 DoD 已勾。红窗关闭。
2. **TASK-65 agent 因 API 错误中断**（connection closed mid-response），截断在测试修改中途。
   worktree 未提交工作完好（9 新文件 + 5 修改：drift-calculator / entity-aligner /
   drift-reporter 等）。已按通知 **SendMessage resume** 续跑（agent 保留上下文续完测试 + 提交）。
3. **在飞**：TASK-65（resumed）。TASK-66 等 TASK-65 落地后派（共享文件串行）。

## 14:3xZ 更新（TASK-65 fan-in + TASK-66/68 派发）

1. **TASK-65 fan-in（完成）**：resume 后 agent 完成（branch d82a9f9）→ rebase master（干净）→ merge
   → scoped **101 passed**（10 文件）→ worktree/分支清理。AC 5 项全勾。产出：JL 架构漂移
   （entity-aligner / drift-calculator / drift-exit-code / drift-reporter / drift-baseline）+
   `--drift-base`/`--drift-threshold` CLI + `archguard_get_architecture_drift` MCP tool。
   注：`reanalyzeCommitSnapshot`（git worktree 重分析）仅 type-checked，端到端留外层 e2e。
2. **TASK-66/68 补晋 + 派发**：TASK-66（JL cluster boundary）与 TASK-68（lint 13 errors 修复，
   外层 AC 审计新建）均 eligible、disjoint 同批 → todo→ready、§3.5 开括号（fm-TASK-66-… /
   fm-TASK-68-…）、§4 并发派发（worktree task-66 / task-68）。
3. **机制误报复核（TASK-66）**：ready-pool-check 将 TASK-66 excluded 为 `not-yet-flipped`
   （`taskWorkLanded=true`）——**已知符号信号误报**（同 TASK-67：TASK-65 落地后其 AC 引用的共享
   符号已存在）。实测核实：TASK-66 的 4 个 `(new)` 文件（kmeans.ts / cluster-boundary-analyzer.ts
   及测试）**均不存在**，工作未落地 → 按实测为准派发，标注外层。机制缺陷归 manager-inbox。
4. **在飞**：TASK-66、TASK-68。full-suite green（5019/0）。

## 15:0xZ 更新（ADR-007 复发修复 + TASK-66/68 fan-in 完成）

1. **ADR-007 复发修复（外层 14:57Z 裁定，TASK-65 引入）**：`archguard_get_architecture_drift`
   MCP tool 缺 `--architecture-drift` query flag。修复：query.ts 加 `--architecture-drift` flag +
   handler（复用 TASK-65 drift-baseline/drift-reporter/drift-calculator，镜像 MCP tool 读路径）。
   **验证**：check-adr 0 violations + check-adr.test 28 green + type-check 0 + prettier 已格式化。
   提交 **439e5d3**。这是 ADR-007 第二次同类复发——外层已记 manager-inbox（建议建 MCP tool 的
   任务 AC 加 check-adr 0 项）。
2. **TASK-68 fan-in（完成）**：lint 修复（eslint.config.js ignores 排除 `.quay/**`/`vendor/**` +
   prettier + 去除 6 处断言）。merge 后 lint **0 errors / 3925 warnings**（AC 通过）。与 ADR-007 的
   query.ts 改动 rebase 自动合并无冲突。
3. **TASK-66 fan-in（完成）**：JL cluster boundary（kmeans + cluster-boundary-analyzer）。
   merge 后 scoped **111 passed**（5 文件）。
4. **TASK-62/63/64/65/66/67/68 全部已合并**（各 scoped 全绿）；**无在飞、无 worktree**。
5. **full-suite**：green（5019/0）为 ADR-007 修复前状态；ADR-007 修复 + 66/68 合并待外层新全量验证。
6. **机制备注**：TASK-68 任务文件建议的 `.eslintignore` 在 ESLint v9 flat config 下已废弃
   （实测 warning），agent 改用等效 `eslint.config.js ignores`——DoD 第 2 行未勾，交外层判断。

## 15:2xZ 更新（ADR-007 第三次复发修复 + 治本规则落档）

1. **ADR-007 复发 #3（外层 15:15Z 裁定，TASK-66 引入）**：`archguard_get_cluster_boundary`
   缺 `--cluster-boundary` query flag。修复：query.ts 加 flag + handler（复用 TASK-66
   cluster-boundary analyzer：buildAdjacencyMatrix + ClusterBoundaryAnalyzer，避免拖入 MCP SDK）。
   **验证**：check-adr 0 violations + check-adr.test 28 green + type-check 0 + prettier。
   提交 **daec6ea**。
2. **治本（外层裁定 2 执行）**：扫描全部非 done 任务——**唯一 MCP-tool 任务是 TASK-66（已合并）**；
   **无已建未派发的 MCP-tool 任务、无涉及 MCP tool 的池候选** ⇒「补 AC」无对象。
   **规则落档（强制继承）**：**后续任何新增/修改 MCP tool 的任务，AC 必须含
   「`node --experimental-strip-types scripts/check-adr.ts` 0 violations」**（ADR-007 CLI/MCP parity
   闸，三次实锤）。本规则写在此队列状态源，冷启动/新会话会读到。也归 manager-inbox。
3. **三次复发的机制教训**：MCP tool 与 CLI flag 的对齐靠 scoped 测不到、靠 full-suite 兜底太晚——
   治本已转为「任务内可测 AC」+「队列状态源规则继承」双保险。
4. **full-suite**：待外层新全量验证（ADR-007 修复 daec6ea + TASK-66/68 合并）。
   TASK-62/63/64/65/66/67/68 全部已合并；无在飞、无 worktree。

## 15:4xZ 更新（re-green 确认 + TASK-66 lint 14 errors 修复 + lint 治本规则）

1. **re-green 确认**：full-suite green（351 文件 / 5090 passed / 0 failed，外层 15:36Z）——
   ADR-007 #3（cluster-boundary）修复有效，stop-dispatch 撤。
2. **TASK-66 lint 14 errors 修复（外层指令 1）**：`npm run lint` 复现 LINT_EXIT=1（14 errors）——
   TASK-66 测试文件引入。修复：
   - `cluster-boundary-analyzer.test.ts`：prettier 格式 + 删 unused `repeatRows` / unused forEach 参数
     `p` + 去 4 处多余 `!` 断言（no-unnecessary-type-assertion + no-non-null-assertion）。
   - `kmeans.test.ts`：prettier 格式。
   - 验证：全量 `npm run lint` **0 errors / 3947 warnings**（exit 0）；两文件 scoped 测试 24 passed；
     type-check 0。
3. **lint 治本规则（外层指令 2，落档强制继承）**：**后续任何新增/修改代码的任务（不只 MCP tool），
   AC 应含「`npm run lint` 0 errors」**——任务新代码必须 lint-clean，不再靠外层复验。
   与 check-adr 规则并列写入本队列状态源。
4. **TASK-50 #4 / TASK-62 #8 / TASK-64 #11 的 lint DoD 项**：本指令修完 lint 后，外层可重勾。

## 15:5xZ 更新（下一批派发：TASK-70/71）

1. **外层 15:48Z 方向裁定**：lint 确认 0 errors（TASK-66 修复生效）；TASK-50/62/64 lint DoD
   已由外层重勾。下一批：**TASK-70**（--prefer-offline 卫生项，TASK-57 遗留）+ **TASK-71**
   （kotlin 插件分支密集路径直接 import 单测，TASK-59 边界清单剩余）。TASK-72（core generator）、
   A 类 E2E 延后。
2. **§3.6 补晋 + §4 派发**：TASK-70/71 资格全通过（self-touch OK、touches resolve、并发 disjoint
   同批、lint gate 在 AC）→ todo→ready、§3.5 开括号（fm-TASK-70-… / fm-TASK-71-…）、§4 并发派发
   （worktree task-70 / task-71）。派发 prompt 含 **lint gate**（新代码 lint-clean）。
3. **在飞**：TASK-70、TASK-71（2 后台 subagent）。full-suite green（5090/0）。

## 16:0xZ 更新（TASK-70/71 fan-in 完成）

1. **TASK-70 fan-in（完成）**：--prefer-offline 卫生项（3 集成测试文件加 npm install 参数/env，
   无测试语义改动、无性能 claim）。merge 后 scoped **55 passed**（3 集成文件，~3min）。
2. **TASK-71 fan-in（完成）**：kotlin 插件分支密集路径直接 import 单测（6 新文件 +51 测试，
   基线 135→186）。merge 后 scoped **186 passed**（15 文件）。负控制已验证新测试真抓分支。
3. **TASK-62/63/64/65/66/67/68/70/71 全部已合并**（各 scoped 全绿）；**无在飞、无 worktree**。
4. **full-suite**：green（5090/0）为 TASK-70/71 合并前状态；待外层下一轮全量验证。
5. **池**：pool=2（TASK-70/71 done 待外层翻，不会重派）；无新候选。

## 16:1xZ 更新（TASK-72 派发）

1. **外层 16:10Z 方向**：TASK-70/71 已收尾（done + 关括号）；full-suite 验证中。下一批
   **TASK-72**（core mermaid generator 深层分支直接 import 单测，TASK-59 边界清单剩余，含 lint gate）。
   A 类 E2E 延后（TASK-72 落地后再裁是否分批）。
2. **§3.6 补晋 + §4 派发**：TASK-72 资格通过（self-touch OK、touches resolve、lint gate 在位）→
   todo→ready、§3.5 开括号（fm-TASK-72-…）、§4 后台派发（worktree task-72）。
3. **在飞**：TASK-72。full-suite green（验证 70/71 中）。

## 16:2xZ 更新（TASK-72 fan-in 完成）

1. **TASK-72 fan-in（完成）**：core mermaid generator 深层分支直接 import 单测（13 测试，纯测试
   不改源码）。merge 后 scoped **13 passed**。负控制已验证（变异 same-package skip 条件 → 测试红）。
   发现：`groupEntitiesByPackage` 私有函数（L516-532）确认死代码（未调用）；防御性/死分支
   刻意不测（TASK-58/59 逐边界判断）。
2. **TASK-62/63/64/65/66/67/68/70/71/72 全部已合并**（各 scoped 全绿）；**无在飞、无 worktree**。
3. **full-suite**：green（5090/0）为 TASK-70/71 合并前状态；TASK-70/71/72 待外层全量验证。
4. **池**：pool=1（TASK-72 done 待外层翻）；无新候选。**任务库耗尽**——剩 A 类 E2E 待裁。

## 16:3xZ 更新（TASK-73 派发）

1. **外层 16:30Z 方向**：TASK-72 已收尾（done + 关括号）；full-suite 验证中。下一批
   **TASK-73**（A 类 E2E 第一批——CLI analyze/init/cache 用户入口契约 E2E 稳定化：审计
   tests/integration/cli/ 覆盖 + 补契约断言，**不改造 CLI 实现**，含 lint gate）。
   后续 A 类分批（config 语义 / 输出格式契约 / 插件注册表）待 TASK-73 落地后再裁。
2. **§3.6 补晋 + §4 派发**：TASK-73 资格通过（self-touch OK、resolve 1/3 missing 多数解析、lint
   gate 在位）→ todo→ready、§3.5 开括号（fm-TASK-73-…）、§4 后台派发（worktree task-73）。
3. **在飞**：TASK-73。full-suite green（验证 70/71/72 中）。

## 16:4xZ 更新（TASK-73 fan-in + TASK-74 派发）

1. **TASK-73 fan-in（完成）**：A 类 E2E 第一批（CLI analyze/init/cache 用户入口契约）。新
   `tests/integration/cli/user-entry-contract.test.ts`（7 测试，exit code + 关键输出契约）。
   未改 CLI 实现。merge 后 scoped **7 passed**。
2. **TASK-74 补晋 + 派发**：A 类第二批（config 语义 E2E 稳定化，外层已建，只读审计
   config-loader）——资格通过（self-touch OK、resolve 1/3 missing 多数解析、lint gate 在位）→
   todo→ready、§3.5 开括号（fm-TASK-74-…）、§4 后台派发（worktree task-74）。TASK-73 落地满足
   「第二批前提」。
3. **在飞**：TASK-74。TASK-62~73 全部已合并。

## 16:5xZ 更新（TASK-74 fan-in 完成）

1. **TASK-74 fan-in（完成）**：A 类第二批（config 语义 E2E 稳定化）——只读审计 config-loader，
   `custom-config-path.test.ts` 加 10 契约断言（默认值 / deepMerge 覆盖 / 非法报错格式）。
   未改实现。merge 后 scoped **24 passed**（config 17 + cli 契约 7）。
2. **TASK-62/63/64/65/66/67/68/70/71/72/73/74 全部已合并**（各 scoped 全绿）；**无在飞、无 worktree**。
3. **full-suite**：green（5090/0）为 70/71/72 合并前状态；TASK-70~74 待外层全量验证。
4. **池**：pool=1（TASK-74 done 待外层翻）；**无新候选**——任务库再次耗尽。剩余 A 类分批
   （输出格式契约 / 插件注册表）待外层补建。

## 17:1xZ 更新（TASK-75 派发）

1. **外层 17:08Z 方向**：TASK-73/74 已收尾（done + 关括号）；full-suite 验证中。下一批
   **TASK-75**（A 类第三批——输出格式契约 E2E 稳定化：ArchJSON/mermaid/SVG 渲染，只读审计
   tests/integration/mermaid/，含 lint gate）。A 类剩余：插件注册表（后续分批）。
2. **§3.6 补晋 + §4 派发**：TASK-75 资格通过（self-touch OK、resolve 多数解析、lint gate 在位）→
   todo→ready、§3.5 开括号（fm-TASK-75-…）、§4 后台派发（worktree task-75）。
3. **在飞**：TASK-75。TASK-62~74 全部已合并。

## 17:2xZ 更新（TASK-75 fan-in 完成）

1. **TASK-75 fan-in（完成）**：A 类第三批（输出格式契约 E2E 稳定化）——SVG/PNG/mermaid 结构/
   ArchJSON 实体/关系 schema 契约断言，**零实现改动**。merge 后 scoped **14 passed**（mermaid 8 +
   archjson 6）。
2. **TASK-62/63/64/65/66/67/68/70/71/72/73/74/75 全部已合并**（各 scoped 全绿）；
   **无在飞、无 worktree**。
3. **full-suite**：green（5090/0）为 70/71/72 合并前状态；TASK-70~75 待外层全量验证。
4. **池**：pool=1（TASK-75 done 待外层翻）；**无新候选**——任务库再次耗尽。A 类剩余：
   插件注册表（后续分批）。

## 17:3xZ 更新（TASK-76 派发）

1. **外层 17:29Z 方向**：TASK-75 已收尾（done + 关括号）；full-suite 验证中。下一批
   **TASK-76**（A 类最后一批——插件注册表/外部插件加载 E2E 稳定化：内置插件枚举、外部路径加载、
   非法报错，只读审计，含 lint gate）。**A 类分批（CLI/config/输出格式/插件注册表）至此全建。**
2. **§3.6 补晋 + §4 派发**：TASK-76 资格通过（self-touch OK、resolve 多数解析、lint gate 在位）→
   todo→ready、§3.5 开括号（fm-TASK-76-…）、§4 后台派发（worktree task-76）。
3. **在飞**：TASK-76。TASK-62~75 全部已合并。

## 17:4xZ 更新（TASK-76 fan-in 完成 —— A 类全齐）

1. **TASK-76 fan-in（完成）**：A 类最后一批（插件注册表/外部插件加载 E2E 稳定化）——13 新测试
   （内置枚举 / 外部路径加载 / 非法报错），**零实现改动**。merge 后 scoped **13 passed**。
2. **TASK-62/63/64/65/66/67/68/70/71/72/73/74/75/76 全部已合并**（各 scoped 全绿）；
   **无在飞、无 worktree**。**A 类分批（CLI/config/输出格式/插件注册表）全部落地。**
3. **full-suite**：green（5090/0）为 70/71/72 合并前状态；TASK-70~76 待外层全量验证。
4. **池**：pool=1（TASK-76 done 待外层翻）；**无新候选**——任务库耗尽。下一批方向待外层裁
   （A 类 E2E 已完成，无剩余方向候选）。

## 18:0xZ 更新（空闲心跳：管线自然排空，等外层方向）

1. **实况**：master @ 9b4f9a5（外层 tick #89：full-suite green **5188/0**、TASK-76 DoD、
   boundary list complete 里程碑）。**50 任务全 done**、drift-check 干净（无 stranded/closed-without-work/
   reverse-drift）、无在飞、无 worktree、无候选/无 promotions、无阻塞信号。
2. **计量改善**：tasksPerHour **0.477**（自 0.165 提升——本会话消费了 quay-tasks 搬入 + A 类
   E2E 全批，管线产出显著）。
3. **空闲性质**：就绪队列空是自然排空（任务库 + 方向候选表均耗尽），非等待裁定——不写阻塞信号。
   等外层补建新任务/新方向后恢复。

## 18:1xZ 更新（TASK-77 派发）

1. **外层 18:05Z 方向**：任务库此前耗尽，建收尾任务 **TASK-77**——验证 9 项旧任务未勾 AC
   （DIR-001/002、TASK-31/35/49），真实环境逐项核：能勾则勾 + 贴证据，不能勾写理由（诚实，不盲勾；
   install/reload/凭据项环境不可得则写理由）。
2. **§3.6 补晋 + §4 派发**：TASK-77 资格通过（self-touch OK、resolve 多数解析）→ todo→ready、
   §3.5 开括号（fm-TASK-77-…）、§4 后台派发（worktree task-77）。派发 prompt 强调诚实核实、
   不盲勾、只编辑指名的 5 个任务文件。
3. **在飞**：TASK-77。

## 18:2xZ 更新（TASK-77 fan-in 完成 + 真实缺陷发现）

1. **TASK-77 fan-in（完成）**：AC 验证收尾任务——9 项旧任务 AC 真实环境逐项核：**6 项满足**
   （DIR-001 环破/语义保留、DIR-002 nodeId 碰撞修复/碰撞测试/图重生成、TASK-31 安装器不写注册，
   证据落盘）+ **3 项诚实写理由**（TASK-31/TASK-35 的 `claude mcp list` Connected、TASK-49 凭据
   测试）。
2. **真实缺陷发现（新任务方向）**：包已发布（@yalehwang/archguard-claude-plugin@0.1.32），真实
   `claude plugin install` 成功，但 **`plugin/mcp-launcher.mjs` 依赖解析与 Claude Code 2.1.222
   插件缓存布局不兼容**（deps 装进兄弟 `plugins/npm-cache/node_modules/`，launcher 的
   `createRequire(import.meta.url)` 向上解析够不到，claude 不设 NODE_PATH）→ MCP 连接失败
   （-32000 Connection closed）。NODE_PATH 实验证明诊断（设 NODE_PATH 即成功）。**需后续修复
   launcher**——外层可立案。
3. **drift-check**：干净（51 任务无 suspects）。
4. **任务库**：TASK-77 后再次耗尽（收尾任务）。TASK-77 待外层翻 done。

## 19:1xZ 更新（空闲心跳：状态无变化，等外层）

1. **实况**：master @ 9a52eb5（外层 tick #93 仅转发重锚）；状态与 18:0xZ 空闲检查一致——
   全任务 done、无在飞、无候选/promotions、full-suite green（17:55Z 5188/0）、`.halt` 无、
   无阻塞信号。**无新任务/无方向动作**。
2. **mcp-launcher 缺陷**：仍待外层立案（已记录于 18:2xZ 段 + 外层 tick #92）。若数 tick 后仍未
   立案，内层按「有证据建任务」自行创建（TASK-78）。

## 19:3xZ 更新（TASK-78 立案 + 派发）

1. **外层 19:25Z 立案裁定**：TASK-78（mcp-launcher MCP 连接缺陷）——真实证据（createRequire
   无法解析 npm-cache 布局核心包，NODE_PATH 可复现）+ 阻塞 TASK-31/35 两个 AC。内层按
   「有证据建任务」建四件套 + Contract + lint gate（`tasks/TASK-78.md`，证据：launcher:19
   createRequire + 根因 + 复现闭环 + 修复方向）。
2. **§3.6 补晋 + §4 派发**：资格通过（self-touch OK、resolve 0/2 missing）→ todo→ready、
   §3.5 开括号（fm-TASK-78-…）、§4 后台派发（worktree task-78）。派发 prompt 强调构造 npm-cache
   布局复现 + 保持不依赖全局 install 纪律。
3. **在飞**：TASK-78。

## 19:5xZ 更新（TASK-78 agent 中断/resume）

1. **TASK-78 agent 因 API 错误中断**（connection closed mid-response），截断在调查 archguard 插件
   enablement 状态中途。worktree 未提交工作完好：`plugin/mcp-launcher.mjs` 已改动（解析改为
   ①插件自身树 → ②回退发现兄弟 `npm-cache/node_modules`——正是任务修复方向，未完成/未提交）。
   已 **SendMessage resume** 续跑（保留上下文续完修复 + 构造布局实测 + 提交）。
2. **在飞**：TASK-78（resumed）。

## 19:4xZ 更新（TASK-78 fan-in 完成）

1. **TASK-78 fan-in（完成）**：mcp-launcher MCP 连接缺陷修复——`resolveArchguardEntry()`：
   ①插件自身树（createRequire）→ ②回退发现兄弟 `npm-cache/node_modules`。构造布局实测：
   npm-cache 布局 exit 0 + MCP initialize OK；负控制（无缓存干净 exit 1）；回归（自身树 OK）；
   NODE_PATH 注入 OK。lint 0 errors。merge 后 scoped **10 passed**（plugin-package）。
2. **AC**：AC1-4 勾（npm-cache 布局/负控制/环境不可得理由/lint）；AC5（TASK-31/35 Connected）
   未勾——真实 `claude mcp list` 不列出 archguard（settings.json `enabledPlugins` 未启用 archguard；
   已装 0.1.32 仍带旧 launcher）。**TASK-31/35 的 Connected AC 需启用插件 + 发布带修复的新包 + 重装**
   后才能勾——待外层处理。
3. **任务库**：TASK-78 后再次耗尽。TASK-78 待外层翻 done。

## 20:0xZ 更新（空闲心跳：状态无变化）

1. **实况**：master @ 357e186（外层 tick #95：TASK-78 closed；**full-suite deferred，gate WAIT**）。
   全任务 done、无在飞、无候选/promotions、`.halt` 无、无阻塞信号。最后全量 green（17:55Z 5188/0，
   在 TASK-78 合并前）；TASK-78 合并待 gate GO 后新全量验证。
2. **空闲性质**：任务库耗尽、方向候选表耗尽（A 类全齐 + B 类/卫生/缺陷全消费）——自然排空，非阻塞。
   等外层补建新任务/方向。

## 20:3xZ 更新（TASK-79 派发）

1. **外层 20:26Z 方向**：TASK-79（TASK-78 修复后验证 TASK-31/35 的 `claude mcp list` Connected
   AC——本地 build + 安装 + `claude mcp list` 实测，**不要求公开发布**；若需外层启用插件/发布则
   明确列出）。
2. **§3.6 补晋 + §4 派发**：资格通过（self-touch OK、resolve 1/2 missing 多数解析、lint gate 在位）
   → todo→ready、§3.5 开括号（fm-TASK-79-…）、§4 后台派发（worktree task-79）。
3. **在飞**：TASK-79。

## 13:28Z 更新（外层 tick #64：TASK-62/63/64/67 收尾）

1. **本轮 4 任务已 fan-in 合并**：TASK-62（QueryLoader/CaptureMapper/C++，5c03e2d+bbec226）、TASK-63（PackRegistry/RuleEngine，b10586a+c70e754）、TASK-64（JL SVD/arch-health，7e8174b+37198b5）、TASK-67（runner 结构化判红修复，1c02f46+765566b）。
2. **外层收尾**：关 4 括号（fm-TASK-62/63/64/67）+ 翻 4 done + verification-round #1 记录。inProgress 空。
3. **新 full-suite 起跑**（13:27，--maxWorkers=8）：验证 4 合并 + 机制 + TASK-60/61。runner 已带 TASK-67 修复——此轮判红应真实（不再匹配裸 ✖）。
4. **TASK-67 闭环**：外层 12:59 立案 → 内层 13:0x 起执行 → 13:1x 合并。快速闭环实证（外层立案 → 内层执行 → fan-in 全自主）。
5. **下一步**：TASK-65/66 待派发（TASK-64 落地后可晋，66 已解析通过，65 解除 parent 阻塞）。内层计划中。
6. **遗留 AC**：TASK-64 AC3（perf spike 环境受限）记理由；4 任务 DoD 待新全量绿后勾。

## 13:40Z 更新（红窗分诊：真红 → forward-fix 指令已发）

1. **full-suite 真红**（5013 passed / 6 failed / 3 文件）：install-policy 3、parser-runtime-packed 2、check-adr 1。runner 的 TASK-67 修复生效（结构化判红，真失败）。
2. **归因**：
   - cpp ArchJSON 分叉（5 失败）：TASK-62 重写 tree-sitter-bridge + 外部化 .scm 后，`expectedArchJson`（直接 parseCode）与 `runDriver()`（driver 路径）不一致。上轮 4902/0 绿 = merge 引入。
   - ADR-007 违规（1 失败）：TASK-64 arch-health 工具/CLI flag 命名不匹配。
3. **裁定**：forward-fix 不回滚。禁改基线/期望值，查 driver↔parseCode 分叉根因（首查 .scm 路径解析），修 ADR-007，重跑 3 失败文件。裁定已送达内层（transcript 核实），内层开工。
4. **TASK-62/64** 保持 done，DoD 待修复 + 新全量绿。TASK-65/66 派发暂缓（套件 red = stop-dispatch）。
5. **verification-round #1** 的 suiteGreen 需回看：当时 recorded true（running），最终 red——本轮收尾的 4 任务待修复后新全量验证。

## 14:26Z 发现（lint 不通过：13 errors）

AC 审计勾 TASK-50 #4（npm run lint）时发现：**lint 当前 13 errors / 3880 warnings**（`npm run lint` 不通过）。full-suite 是 vitest-only，不跑 lint——所以 5019/0 绿但 lint 有错误。来源待查（TASK-62/63/64 新代码 vs 既有）。已重跑 lint 全量输出（btex2ch9h 后台）定位错误文件。**TASK-50 #4 保持未勾**（lint 现不通过，勾不上）。若 13 errors 来自本轮 merge 新代码 → 建任务修 lint hygiene；若既有 → 另议。

## 14:31Z lint 发现定位（TASK-68 已立案）

13 errors 分解（lint 全量输出 /tmp/archguard-lint-full.log）：
1. `.quay/` 备份目录 4 Parsing error（pre-task67-merge-untracked/ + quay-init-backups/ 的 experimental-syntax .ts）——无 .eslintignore，`eslint .` 扫了瞬态备份。
2. `vendor/quay/dist/*.js` 7 rule-not-found（vendor 打包 JS 内联引用未加载的 @typescript-eslint 规则）——vendor 被 lint。
3. `src/cli/commands/query.ts` 2 formatting（TASK-64 ADR-007 修复新代码，prettier 可修）。
处置：**TASK-68 已建**（加 .eslintignore 排除 .quay/vendor + prettier 修 query.ts + 重跑 lint 0 errors）。TASK-62 DoD #8 / TASK-64 DoD #11（npm run lint）因实测不通过已**撤销勾选**（待 TASK-68 修好 lint 后重勾）。

## 15:05Z 更新（manager 转达吞吐率请求 → 自适应并发裁定 + TASK-69）

1. **manager 请求**：机器大部分空闲，考虑提高吞吐率（含调高 inner 并发 subagent 数）。建议自适应（GO 高并发 / WAIT 回落），裁定权在外层。实测：archguard 2 worktree 并发 = 75.8% CPU → PSI 66（门槛 40）→ WAIT，因与 quay 共享机。
2. **外层裁定**：**自适应并发**——GO（gate 退出 0）→ inner 并发上限 4；WAIT → 回落 2。固定高并发不可行（quay laneCount=8 三次 ABORT 实锤）。自校正：GO 派 4 → vitest 推高 PSI → 下派见 WAIT 回 2 → 回落再回 4。
3. **TASK-69 已建**（实施）：fast-mode-loop-tick.md §4 并发上限改自适应 + inner 派发前查 gate + ready-pool-check cap/floor 联动评估。内层当前批次（ADR-007 + TASK-66/68）完成后执行。
4. **已回复 manager**（archguard-20260805-150500Z.md）：裁定 + 数字 + 边界（两层不同时跑全量不变）。

## 15:10Z 更正（manager 撤回吞吐率/自适应并发请求）

manager 更正上一条：**撤回**「自适应并发档位归 archguard 判断」。正确形态 = 并发上限、资源门联动
属 quay 两层循环基础设施（fast-mode-loop-tick.md 模板 + resource-gate.sh + concurrent-batch-scheduler.ts），
archguard 是采纳这套机制的消费者，**不该自己发明**（会造成机制分叉 = 交付面漂移，今晚多次实测）。
并发上限调整由 quay 设计后经正常升级同步（git pull）传导，届时按新版 fast-mode-loop-tick.md 执行。
**已删 TASK-69**（我过度动作的自适应并发实施任务）。后续：资源门 WAIT 时按现有机制正常遵守，
不独立实现。继续任务队列 + 产品工作。

## 15:30Z lint 复验（TASK-68 修复生效，但 TASK-66 引入 14 新 error）

TASK-68 的修复对旧错误**生效**（.quay/vendor/query.ts 的解析/rule-not-found/格式错误已消，单文件 eslint 0 errors）。但 **TASK-66 的测试文件引入 14 个新 lint error**：
- `tests/unit/analysis/jl/cluster-boundary-analyzer.test.ts`（10）：unused vars（repeatRows/p）+ prettier 格式 + 多余断言
- `tests/unit/analysis/jl/kmeans.test.ts`（4）：prettier 格式
**`npm run lint` 仍 LINT_EXIT=1（14 errors）**。full-suite 是 vitest-only 不覆盖 lint——re-green 会过，但 lint 独立红。
**系统性模式**：任务新代码不跑 lint（同 check-adr 族）——治本规则应扩展到 lint（新增/修改代码的任务 AC 加 lint gate）。TASK-50 #4/TASK-62 #8/TASK-64 #11 的 lint DoD 仍待 TASK-66 lint 修复后勾。

## 15:45Z 更新（外层 tick #78：任务库耗尽 → 下一批方向）

1. **内层**：修 TASK-66 lint（8de7fec）+ 治本规则落档。TASK-62~68 全 done，**43 任务全 done，池空**，套件绿。
2. **方向裁定**（外层）：① **TASK-70**（--prefer-offline 卫生项，TASK-57 遗留，3 文件 +15 行，卫生采纳非优化 claim）；② **TASK-71**（B 类 kotlin 插件分支密集单测，TASK-59 边界清单剩余）。均含 lint gate（治本规则）。延后：TASK-72（core generator）、A 类 E2E。
3. **lint 验证**：后台跑（bp1yh4vn5），确认 0 errors 后重勾 TASK-50 #4/TASK-62 #8/TASK-64 #11 的 lint DoD。
4. **下一批**：TASK-70/71 待内层 §3.6 晋级后派发。

## 16:31Z 状态快照（context 100%——为 compact/重启保险）

**当前态**：full-suite 验证 TASK-72（后台 byq3jpcp5，~16:26 起）。TASK-73（A 类 CLI E2E）已派发（内层晋级中）。套件 green（TASK-72 合并前状态）。
**本会话成果**（11:40 起，~291 分钟自主）：TASK-53→73 全部 done（除在飞的 73），机制地基提交 d9dbd75，ADR-007 三连修复 + 治本规则，lint 修复 + 治本规则，runner 判红修复（TASK-67），--prefer-offline 卫生采纳（TASK-70）。
**持久状态位置**：本文件（单一可信源）+ orchestration/tick-log.md（tick #1-81）+ manager-inbox 报告 #1-8。
**待办**：TASK-73 收尾（full-suite 后）；A 类分批（config/输出格式/插件注册表）；8 旧任务 AC 未勾（DIR-001 2/DIR-002 3/TASK-31 2/TASK-35 1/TASK-49 1）；quay 侧 3 修 + 2 建议。
**机制缺口**（已报 manager）：send-keys welcome/非空框不可用；--test-concurrency 文档虚构；runner 判红 canonical 待同步；ready-pool not-yet-flipped 误报 2 次。

## 17:59Z AC 审计收尾结论

AC 审计：19 未勾 → **9 剩余**。9 项均无法由外层独立验证（勾不上写理由）：
- DIR-001（2）：Cycle broken（需 archguard 自身环检测工具验证）、Semantic info preserved（判断题）
- DIR-002（3）：nodeId collision fixed/test added（grep 无证据，ea13e9f 是 renderer 非 nodeId）、diagrams regenerated（需 quay 侧图）
- TASK-31（2）/TASK-35（1）：installer 相关（需真实 install/reload 环境 + `claude mcp list`）
- TASK-49（1）：凭据条件（需环境有凭据）
**处置**：留待内层在真实环境验证（或有相关任务时顺带核），不盲勾。若需，内层可建「验证 9 项旧 AC」任务。

## 18:15Z AC 审计完成（TASK-77 真实环境验证）

9 项旧 AC 由 TASK-77 在真实环境核完：
- **6 项确认满足**（外层勾 DoD）：DIR-001 x2（环检测 []、语义保留 tsc 干净）、DIR-002 x3（nodeId 碰撞修复+测试+图）、TASK-31 deprecated installer（33/33 过）
- **2 项被真实缺陷阻塞**：TASK-31/35 的 `claude mcp list Connected`——安装/升级机制成功但 **MCP 连接失败**（mcp-launcher createRequire 无法解析 npm-cache 布局里的核心包）。内层立案 **TASK-78**（修 plugin/mcp-launcher.mjs MCP 连接缺陷）。
- **1 项缺凭据**：TASK-49（OPENAI_API_KEY 环境无，测试干净跳过 44|1）。
**价值**：外层原判「9 项无法独立验证」——交给内层真实环境核后，揭示 2 项 AC 实际未满足（真实缺陷）+ 1 项环境阻塞。外层视角盲区被内层实测闭合。
