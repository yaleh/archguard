# Escalations — 攒给人的非常规项

> 首次创建：2026-08-03 冷启动

## 当前积压

### ~~会话存活监测缺位：单飞锁被 quay 持有且只盯 quay~~【已裁决：维持现状，等 quay 出绿后 manager 重挂 6 目标】（2026-08-05）

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

**manager 裁决（2026-08-05 07:3xZ）**：选「暂不动」，理由比选项更硬——quay 内层 07:18 落地
M3 接管修复（takeover count race），但验证它的全量在 07:26 被 quay 外层为资源安全杀掉（load
31.74），接管路径「改过但从未绿证」。重挂需 kill 当前持有者 + 依赖接管路径顶替；在未验证状态
下做 = 三项目同时失去存活观察。**等 quay 出一轮绿全量后 manager 重挂 6 目标**
（quay/meta-cc/archguard × outer/inner）。在此之前 archguard 存活由 manager 侧盯（每 17 分钟
查提交 + pane）。**本条不再升级**。

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

### 外层停止条件触发（2026-08-05 21:52Z）——8.5h 自主运转完成点

**现象**：连续 3 个 idle tick（#100/#101/#102）无任务推进。**完成点非卡住**。
**三次 tick 观察**：#100 任务库 62 全 done/套件绿/AC 审计基本完成；#101 无方向/manager 报告 #9/#10 未读；#102 同上。
**本会话成果**：11:40→21:52 自主运转 511 分钟；TASK-53→79 全 done；2 真实缺陷修复（ADR-007 三连、mcp-launcher）；3 治本规则落档；AC 审计闭环（仅 TASK-49 凭据项）。
**超授权/需人裁定**：新能力 roadmap 方向；TASK-49 凭据环境；TASK-31/35 公开发布决策。
**建议选项**：① 提供新方向（新能力/验证项）继续管线；② 接受完成点，循环待新指令；③ TASK-31/35 发布 + TASK-49 凭据环境后收尾。

### 冷启动种子弧完成点（2026-08-11 19:2xZ）——TASK-81→86 六连闭合，就绪池空待方向

**现象**：本轮冷启动（manager 重启 outer 会话，修复 bypassPermissions / env / excludeDynamic）的种子弧完成：
TASK-81（自分析种子）→82（原生 grammar 缺口 397→0）→83（布局契约对齐，output/ 嵌套=意图）→
84（池 size 机器依赖 1→0，**本地 full-suite 首次全绿 5183/0**）→85（500-edge 渲染上限降级，产品硬化）
→86（v0.4.0 6 盲区矩阵重跑）。就绪池空，无自产新任务方向。

**本会话成果**：6 任务全落地 master；本地 `npx vitest run` 首次全绿（5183 passed / 0 failed / exit 0）；
2 真实修复（原生 grammar 缺口、500-edge 硬失败→降级）；v0.4.0 机制复核 misjudges **4/6→1/6**
（verify-delivery-surface 0/6→5/6 COVERED 等）。root node_modules 已由外层 npm ci 恢复（B3 full-suite 首次可跑）。

**超授权/需人裁定**（08-05 同项仍未决）：新能力 roadmap 方向；TASK-49 凭据环境；TASK-31/35 公开发布
决策（mcp-launcher TASK-78 修复已就绪待发布 + 插件启用）。

**quay 侧新增发现（需 manager/quay 路由，非 archguard 能改）**：
1. **`slot-refill.sh --cap 3` 报 `charter not found: --cap`**（exit 2）——wrapper 参数解析损坏；与
   archguard 安装的 `ready-pool-check` dist / `slot-free-trigger` dist 同形（旧版 charter 解析器
   regress）。archguard 运行侧已绕（用 .ts 源 / 不传 --cap）。
2. **`laydown-set-check` 消费方 0-derived fail-closed 假阴性仍未改**（TASK-80 盲区 #6 仍存）。

**建议选项**：① 提供新方向（新能力/验证项）继续管线；② 接受完成点，循环待新指令（cron `0df88682` /
两 Monitor 保持存活）；③ 执行 TASK-31/35 发布（发布含 TASK-78 修复的包 + 启用插件复验 Connected）
+ 路由两条 quay 侧缺陷到 quay 台账。

**更新（2026-08-11 20:0xZ）**：TASK-87 已完成发布准备——`@yalehwang/archguard-claude-plugin@0.1.33`
打包验证毕（TASK-78 修复在产物、依赖匹配、未发布/未启用/未改 ~/.claude），发布检查清单已落盘。
**发布决策现在是一键可执行**：`cd plugin && npm publish`（产出 0.1.33）→ 启用插件 →
`claude mcp list` 复验 Connected。附带小项：`.claude-plugin/plugin.json` 的 version 显示字段仍 0.1.32，
发布时可同步这一行。
