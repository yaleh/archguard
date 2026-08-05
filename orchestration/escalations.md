# Escalations — 攒给人的非常规项

> 首次创建：2026-08-03 冷启动

## 当前积压

### 会话存活监测缺位：单飞锁被 quay 持有且只盯 quay，archguard/meta-cc 会话无人盯（2026-08-05）

**现象**：archguard 冷启动重挂 session-liveness Monitor（4b 步骤）时，挂载返回
「已有活持有者（属主 quay，pid 2598198）——空操作 exit 0」。`monitor-mount-check.sh --json`
三判据：`mounted=false`（本仓无 session-liveness 进程）、`delivered=true`（共享事件通道通）、
`targets=[]`（本仓无目标）。共享事件文件 `.quay-global/session-liveness/events.jsonl` 只含
quay 事件（`quay-inner` SESSION-IDLE / quay HEARTBEAT），**archguard 与 meta-cc 的会话
存活事件从未产生**。

**根因**：session-liveness 单飞锁（AC20）只有一个持有者——quay 的 pid 2598198，其
`SESSION_TARGETS=quay-outer /home/yale/work/quay quay-0:outer` **只盯 quay 会话**。其余项目
挂载一律空操作。而本仓 `orchestration/session-liveness.env` 配了 `SESSION_TMUX_SESSION=archguard-4`
（quay-init 铺的默认目标），说明设计上 archguard 应有自己的观测——但锁被 quay 持有后，
archguard 会话（含内层 76bbb31e）的 GONE/OVERDUE/IDLE 事件永远不产生。

**外层已尝试**：挂载（空操作）、确认 quay 持有者目标范围、核对共享事件文件。

**为什么超出授权**：涉及 session-liveness 单飞持有者的**目标范围**（quay 持有者应否同时
盯 archguard/meta-cc，还是各项目自己的外层持有——manager 2026-08-03 曾裁「各项目外层持有
其内层」，但 AC20 单飞锁与「多项目各自持有」冲突）。这是机制归属问题，不是 archguard 单方
能解决的。

**建议选项**：
1. quay 持有者的 `SESSION_TARGETS` 扩为三项目全部会话（单一持有者看全部）；
2. 按 manager 旧裁定「各项目外层持有其内层」，放弃全局单飞、改按项目持有（需改 AC20 文档）；
3. 接受现状——archguard 会话存活靠外层 20 分钟 tick 轮询兜底（降级，非事件式）。

### TASK-55 分诊 — 3 个 stranded 分支（2026-08-04）

漂移检查 `task-status-drift-check.ts --stranded` 报 3 个 stranded 分支。逐支 `git show`
考古 + `git merge-base --is-ancestor` 归属核实，3 条全部核实为**无内容丢失**，建议
「可安全清理」。不做 merge / 不删分支 / 不 `--clean-stale`，等人裁定。

1. **task/T3**（分类：error）
   - 现象：master 无 merge commit 以 tip `af8985a` 为 parent，分类器报 error。
   - 内容概要：tip 为 `af8985a`（2026-06-15，+128 行）——`.claude/loop.md`（L0 worker prompt）、
     `.github/ISSUE_TEMPLATE/l0-task.md`、`scripts/setup-l0-labels.sh`。与 T50 同 tip。
   - 归属核实：`git rev-list --count master..T3` = **0**（无独立未收纳提交）；三文件在
     master 均存在且被后续演化（abc311e/fc6600d/fd0733c 改 loop.md）。af8985a 经 T52 lineage
     进入 master。
   - 建议：**可安全清理**。理由：内容已全部被 master 收纳（零 ahead），无丢失。

2. **task/T50**（分类：error）
   - 现象：同 T3，master 无 merge commit 以 tip 为 parent，分类器报 error。
   - 内容概要：tip 与 T3 同为 `af8985a`，历史完全相同，无独立提交。
   - 归属核实：`git rev-list --count master..T50` = **0**；内容归属同 T3。
   - 建议：**可安全清理**。理由：冗余分支（与 T3 同 tip），内容已全部在 master。

3. **task/T52**（分类：merged-then-reverted）
   - 现象：漂移检查报 2 个 merge-added 文件从 master 缺失：
     `docs/plans/plan-121-122-l0-agent-queue.md`、`docs/proposals/proposal-l0-agent-queue.md`。
   - 内容概要：tip `20ee1df`（feature-to-issues skill + label setup，closes #52）。Land merge
     `e7e156d` 添加 7 文件：loop.md / feature-to-issues SKILL.md / issue template / setup 脚本 /
     implemented 记录 + 2 个 plan/proposal 文档。
   - 归属核实：2 个「缺失」文件实际被 `a1ea947`（2026-06-22）**纯 rename 到
     `docs/archive/`**——`git diff` 证实 archive 版与分支版**逐字节一致**（非 revert，是归档）；
     其余 5 个 merge-added 文件在 master 均存在；`git rev-list --count master..T52` = **0**。
   - 建议：**可安全清理**。理由：merged-then-reverted 是误报（归档 rename 导致
     `cat-file -e master:<原路径>` 落空），内容无丢失。

## 已处理

（暂无——3 条 TASK-55 分诊见上「当前积压」，等人工裁定）

## 升级规则

以下不自行决定，写进本文档等人：
- 同一失败在外层消解后再次出现——循环不收敛
- 需要改变方向或范围的决定
- 外层自己的停止条件触发（连续 3 tick 无推进）

每条升级：现象 + 外层已尝试什么 + 为什么超出授权 + 建议的两个以上选项
