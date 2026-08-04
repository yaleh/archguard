# Escalations — 攒给人的非常规项

> 首次创建：2026-08-03 冷启动

## 当前积压

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
