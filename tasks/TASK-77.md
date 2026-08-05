---
id: TASK-77
title: "TASK-77: 验证 9 项旧任务未勾 AC（真实环境，外层无法独立验证的项）"
status: todo
labels:
  - bookkeeping
  - verification
parent: null
children: []
extra:
  schema: v1
  source: outer-ac-audit-closeout-2026-08-05
---
# TASK-77: 验证 9 项旧任务未勾 AC

## Proposal

外层 AC 审计收尾（2026-08-05）后剩 **9 项未勾 AC**，均需真实环境验证（install/reload/凭据）或
证据调查，外层无法独立验证。逐项核实，能勾则勾（附证据），不能勾写理由（按「勾不上写理由」纪律）。

**清单（9 项）**：
| 任务 | 未勾 AC | 需要的验证 |
|---|---|---|
| DIR-001 | Cycle broken / Semantic info preserved | archguard 自身环检测 + 类型可访问性判断 |
| DIR-002 | nodeId collision fixed / Collision detection test added / diagrams regenerated | nodeId 碰撞证据调查（外层 grep 空）+ quay 图 |
| TASK-31 | deprecated installer 不再写注册 / reload 后 claude mcp list 显示 | 真实 install + reload 环境 |
| TASK-35 | clean install + upgrade 后 claude mcp list | 真实 install 环境 |
| TASK-49 | 有凭据时测试运行 | 凭据条件环境 |

### 选定机制

逐项在真实环境验证（跑 install 测试、检查 mcp list、调查 nodeId 碰撞代码路径），能勾则勾 +
贴证据；不能勾（环境/凭据不可得）写理由，不盲勾。

## Acceptance Criteria

- [ ] 9 项逐项有结论（勾选 + 证据 或 理由 + 留待）
- [ ] 勾选的项有可复核证据（测试输出 / grep 结果 / 行为记录）
- [ ] 未勾的项有具体理由（不是跳过）
- [ ] 涉及改动的文件 lint-clean（若改动测试文件——治本规则）

## Touches

- `tasks/DIR-001.md` / `DIR-002.md` / `TASK-31.md` / `TASK-35.md` / `TASK-49.md`（勾 AC）
- `tasks/TASK-77.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 9 项的勾选数 + 理由数（应 = 9） |
| band | 每项有结论（勾 + 证据 或 理由）；不盲勾 |
| invariant | 不改旧任务 status（除非发现工作未落地） |
| invoke | 逐项跑对应验证命令 |
| control | 某 AC 实际不满足却勾了 ⇒ 判定失败（必须诚实） |
| resume | 每项落盘；被打断可从缺口续 |

## Definition of Done

- [ ] 9 项逐项结论落盘（勾 + 证据 或 理由）
- [ ] 勾选数 + 理由数 = 9
- [ ] 未改任何旧任务 status（只勾 AC / 写理由）
