---
id: TASK-80
title: "TASK-80: quay 新机制落地后的实证验证矩阵（含已知 6 盲区）"
status: ready
labels:
  - verification
  - mechanism
parent: null
children: []
extra:
  schema: v1
  source: outer-2026-08-06（manager 提醒用既有机制打破空转）
---
# TASK-80: quay 新机制实证验证矩阵

## Proposal

quay 今晚 15 个机制合并无法经升级通道到达 archguard（config 冲突，quay 侧已立案
config-preserving 修复）。**升级通道修复后**，需对新机制做**实证验证**（非静态分析）——对照
已发现的盲区逐项测。本任务在升级落地后执行。

**已知盲区（静态分析 + 实证 2026-08-06）**：
1. **verify-delivery-surface 报 0/6 假阴性**（实证：跑 quay 脚本对 archguard 根 = 0/6，因查
   quay 自家布局 plugin/loop/ 等，非消费方布局 orchestration/+docs/analysis/）——**misjudges**。
2. **self-report-vocab 假警报**（实证：停止态内层自报 idle heartbeat 被判非收敛——工厂语义假设
   活跃派发循环）——**misjudges**。
3. **claim-task 不适用**（单机无共享裸仓）——**不适用**。
4. **slot-refill 兼容**（实证：空队列 → no-refill 正确，--cap 3 生效）——**compatible**。
5. **taskWorkLanded 第三信号收尾时序超报**（内外层分工勾选——静态判，待安装后实证）。
6. **laydown-set-check 报 red 假阴性**（实证：0 derived test files，fail-closed——archguard 机制
   测试存在但派生不到）——**misjudges**。
7. **dead-loop-check 语义观察**（实证：停止但存活的 archguard 报 alive——判「会话存活」非「工作
   推进」，无法区分活着但没干活）——**观察**。

### 选定机制

升级通道修复后，安装新机制 → 逐项跑验证矩阵（每条盲区 → 一个可证伪测试），报每条
`compatible|misjudges` + 证据。不能安装则记录阻塞。

## Acceptance Criteria

- [x] 6 盲区逐项实证（compatible / misjudges + 证据）—— 6/6 结论落盘 `docs/analysis/batch2-queue-state.md`（见下「实证结果」）
- [x] verify-delivery-surface 对 archguard 的正确结果（非 0/6 假阴性）——若判据不认消费方布局则报 misjudges —— 实跑 = 0/6，判据 MANIFEST 钉死 quay 工厂布局、不认消费方布局 → **misjudges**（archguard 六类均有自家布局交付）
- [x] 内层自报词汇在活跃态 vs 停止态的 audit 行为记录 —— 活跃态工厂词表（rolling dispatch/verification-round ×3）→ CONVERGED；停止态 idle heartbeat：全量 18 条 → CONVERGED，稀疏 1/2 条（< window 3）→ NOT-CONVERGED（0 命中 batch 仍非收敛，fail-closed 按自报量假警报）
- [x] 涉及改动的文件 lint-clean（若改动——治本规则）—— 改动仅 `.md`（batch2-queue-state.md + 本文件），无 .ts/.sh 改动，scoped eslint 0 errors 不适用

## 实证结果（2026-08-06 06:41Z）

执行方式：升级通道仍阻塞（quay config 冲突已立案），按 Contract 只读验证——直接跑 quay 仓库
（`/home/yale/work/quay`）机制脚本对 archguard 根（`--root /home/yale/work/archguard`），未安装/re-lay
任何 quay 新机制。完整矩阵落盘 `docs/analysis/batch2-queue-state.md`（06:41Z 更新节）。

| # | 机制 | 结论 | invoke 实跑证据 |
|---|------|------|------|
| 1 | verify-delivery-surface | **misjudges** | `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface --root <archguard>` → `surface_categories_covered=0/6`, FAIL, exit=1 |
| 2 | self-report-vocab | **misjudges** | 停止态 idle heartbeat（window 3）：全量 18 条 → CONVERGED；稀疏 1/2 条 → `inner_self_report_vocab=0 · NOT-CONVERGED (reports_total < 3)`（fail-closed 按自报量假警报）；活跃态工厂词表 ×3 → CONVERGED |
| 3 | slot-refill | **compatible** | `node --experimental-strip-types plugin/scripts/slot-refill.ts --root <archguard> --cap 3` → `slots_free:3, pool:0, should_refill:false, no_refill_reason:"no dispatchable candidate passes step-4 checks"` |
| 4 | taskWorkLanded 第三信号 | **misjudges**（时序超报） | `taskWorkLanded(TASK-80.md)` = **true** 而工作未落地——派发提交 ff663db（subject 含 TASK-80 + 改 declared touch `docs/analysis/batch2-queue-state.md`）提前触发 git-history 信号 |
| 5 | laydown-set-check | **misjudges** | `bash plugin/scripts/laydown-set-check.sh --root <archguard>` → `laydown_set_green: red`, "0 test files resolved… fail-closed", exit=1 |
| 6 | dead-loop-check | **观察** | `bash plugin/scripts/dead-loop-check.sh --root <archguard> --window 30` → `loop_alive=alive, has_transcript_user_msg=1, has_git_commit=1`（停止态仍 alive = 判会话存活非工作推进） |

附：**claim-task** 不适用（单机无共享裸仓，remote = 普通 GitHub 远端）。升级通道修复状态：未达下游。

## Touches

- `plugin/scripts/*`（若安装后验证需触碰——只读验证）
- `docs/analysis/batch2-queue-state.md`（结果落盘）
- `tasks/TASK-80.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 6 盲区的实证结论数（每条 compatible/misjudges） |
| band | 每条有证据结论；判据盲区如实报 |
| invariant | 不改 quay 机制（只验证）；不破坏 archguard 既有机制 |
| invoke | 安装后逐项跑验证矩阵命令 |
| control | 判据盲区不报 ⇒ 失败（必须如实） |
| resume | 每条落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 6 盲区实证结论落盘
- [ ] 判据盲区清单更新（含本次新增的 verify-delivery-surface 布局假阴性）
- [ ] 升级通道修复状态记录
