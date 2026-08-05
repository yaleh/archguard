# archguard 队列状态（单一可信状态源）

> 本文件是 fast-mode tick 文档指定的状态单一来源。compact / `/clear` 后唯一可信的状态。
> 每个 tick 结束必须写回。以实测为准（git / 脚本输出），不以本文件的旧快照为准。
> 上次写回：2026-08-05（内层冷启动恢复 tick——本文件在 29h 停机期间丢失，重建）。

---

## 当前实况（2026-08-05 07:3xZ，内层冷启动核实）

| 项 | 值 | 证据 |
|---|---|---|
| `tasks/` 任务数 | **35**（34 done + TASK-60 todo + TASK-61 todo） | `ready-pool-check` scanned 35 |
| 就绪池 pool | **0** / floor 12，deficit 12，criterion_met false | `ready-pool-check --json` |
| 派发候选 | 无（candidates/promotions 均空） | 同上 |
| 在飞 subagent | 0（`ps -e -o comm= | grep -cx node` = 0） | 实测 |
| 遥测 inProgress | 空数组 | `fast-mode-telemetry --report` |
| `.halt` | 不存在（未暂停） | `ls .halt` |
| full-suite-state | 缺失（外层未跑首轮，不阻塞） | `ls .quay/full-suite-state.json` |
| 阻塞信号 | `inner-blocked-signal --read` = no block | 脚本输出 |
| Monitor | **mounted:false**（单飞锁被 quay 持有，archguard 会话未被监视） | `monitor-mount-check --json` |
| 方向裁定 | **等待管理者**（tick #51/#52 已升级，29h 未裁） | tick 历史 |

## 停止条件（本 tick 命中）

- **就绪队列为空**（pool=0、candidates 空、promotions 空）→ 本 tick 不派发。
- 其余未命中：无 `.halt`、无合并冲突、无在飞任务超 90m、pane=busy 无 ruling-required、
  full-suite-state 缺失不阻塞。

## 本 tick（内层冷启动恢复）做了什么

1. **closed-without-work 记账**：DIR-001 / DIR-002 / TASK-50 工作均确认已落地 master
   （fd0733c / ea13e9f / f1f4305），AC 已勾选 + 逐条验证注记写入任务体。drift-check 的
   closed-without-work 警告已消除（仅剩 3 个预存 stranded 分支，归 escalations.md）。
   - DIR-001 scoped 测试：`tests/types/no-analysis-imports.test.ts` 在 master **不存在**（见发现 4）。
   - DIR-002：13 测试绿（含碰撞检测）。TASK-50：69 测试绿。
2. **quay-tasks 存量核实**：43 个跟踪文件、6 todo + 1 ready + 2 needs-human，未接入管线
   （config 只接 `./tasks`）。确认重复：TASK-14↔TASK-50、PROBE-ITER9↔DIR-002、
   ARCH-INVERSION-001↔DIR-001。外层已建 TASK-60 作为正式核实+搬入任务，对账文档
   `docs/analysis/quay-tasks-reconciliation.md` 已补充非 todo 存量的重复核实。
3. **机制修复**：`plugin/scripts/pane-state-classify.ts` 缺失（`inner-blocked-signal.ts` 的依赖，
   quay-init 漏铺）→ 从 quay 工作区复制补上，停止条件检查恢复可用。
4. **残留 worktree 审计**：4 个 `.claude/worktrees/agent-*`（HEAD 停在 5–6 月，0 unique commit，
   脏文件内容全部已在 master 上以更完整形态存在）+ 2 个 /tmp prunable（目录已消失）→
   安全可清理，删除留给管理者。
5. **新任务**：TASK-61（types↔analysis 环回归守卫缺失，见发现 4）。

## 发现 / 待查（有证据，升格候选）

1. **TASK-60 无法晋级（机制双重问题）**：
   - `ready-pool-check` 的 `isParked` 正则 `/\*\*PARKED\b/i` 会命中 AC 正文里反引号引用的
     `**PARKED` 字面量——把「正文提及标记」误判成「任务已停泊」。TASK-60 的 AC 恰在描述
     「给 quay-tasks 原文件标 `**PARKED`」时被误排除出 candidates。注释声称「正文提及不算
     标记」但正则做不到。**建议**：修正正则（如排除反引号引用的出现）或要求标记独立成行。
   - TASK-60 缺 `## DoD`（用 `## 验证` 代替）→ contract 形状四件套不完整，eligible=false。
     **建议**：外层补 DoD 段。
2. **TASK-61 已建**（守卫缺失）：master 上 types↔analysis 环无自动化回归守卫。
   `fd0733c` 只动 3 源文件不加测试；唯一守卫在未合并的分支。TASK-61 负责移植守卫 + 负控制验证。
3. **Monitor 未监视 archguard**：单飞锁由 quay 持有者（pid 2598198）持有，其 targets 只有
   quay-outer/quay-inner；共享事件里 archguard 的旧 `inner` 事件是死亡前旧会话的历史记录。
   archguard-4 当前无人监视——内层会话死掉无 SESSION-GONE 上报。**建议**：外层确保持有者
   targets 覆盖 archguard，或协调单飞锁轮换。这是外层/跨项目协调问题。
4. **残留 worktree**：见上，安全可清理，等待管理者确认后 `git worktree remove`。

## 方向候选（tick #51/#52 升级，等管理者）

| 候选 | 说明 |
|---|---|
| A 类 E2E | 端到端验证 |
| 剩余 B 类 | 含本 tick 新增的 TASK-61（守卫）与 TASK-60（quay-tasks 搬入） |
| --prefer-offline 卫生项 | 见 tick 历史 |
| 暂停 | 停机待命 |

裁定下达前：不派发（就绪队列空 + 方向未定）。

## 计量表（fast-mode-telemetry）

- 已闭合任务：TASK-53…59（7 个，全 done），mean 63.06m，median 59.26m。
- tasksPerHour：0.19（windowStart 08-03T17:50 → windowEnd 08-05T07:23，37.5h 含 29h 停机）。
- 累计死时间：见 `fast-mode-telemetry --report` 的 halted/blocked 段（历史 1 次 ruling-required
  已清除）。

## 备份 / 参考

- 外层接管实况：`.quay/drive-text-round1.txt`（2026-08-05 07:2xZ）
- quay-tasks 对账：`docs/analysis/quay-tasks-reconciliation.md`
- 目标与 AC：`orchestration/goals-and-ac.md`
- exp6 编排文档（`orchestration/exp6-phase1-sustained-unattended-operation.md`）与
  ADR-021（`adr/ADR-021-adaptive-budget-self-regulating-methodology.md`）在冷启动时**均缺失**
  （tick 冷启动清单引用的四个文档中两个不存在；ADR 目录是 `docs/adr/` 且只有 001-008 占位符）。
  已用 `goals-and-ac.md` 替代 exp6 的职能定位。此缺失本身是文档维护项，记入待查。
