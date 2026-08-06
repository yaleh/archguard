---
id: TASK-80
title: "TASK-80: quay 新机制落地后的实证验证矩阵（含已知 6 盲区）"
status: todo
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

**已知盲区（静态分析 + 本次实证）**：
1. **verify-delivery-surface 报 0/6 假阴性**（实证：跑 quay 脚本对 archguard 根 = 0/6，因查
   quay 自家布局 plugin/loop/ 等，非消费方布局 orchestration/+docs/analysis/）。
2. **self-report-vocab 假警报**（实证：停止态内层自报 idle heartbeat 会被判非收敛——工厂语义
   假设活跃派发循环）。
3. **claim-task 不适用**（单机无共享裸仓）。
4. **slot-refill 阈值不匹配**（cap 3 vs quay）。
5. **taskWorkLanded 第三信号收尾时序超报**（内外层分工勾选）。
6. **laydown-set-check / dead-loop-check / 多源心跳** 静态判兼容，需实证确认。

### 选定机制

升级通道修复后，安装新机制 → 逐项跑验证矩阵（每条盲区 → 一个可证伪测试），报每条
`compatible|misjudges` + 证据。不能安装则记录阻塞。

## Acceptance Criteria

- [ ] 6 盲区逐项实证（compatible / misjudges + 证据）
- [ ] verify-delivery-surface 对 archguard 的正确结果（非 0/6 假阴性）——若判据不认消费方布局则报 misjudges
- [ ] 内层自报词汇在活跃态 vs 停止态的 audit 行为记录
- [ ] 涉及改动的文件 lint-clean（若改动——治本规则）

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
