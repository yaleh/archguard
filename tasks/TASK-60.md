---
id: TASK-60
title: "TASK-60: quay-tasks 存量核实并接入晋级管线（候选源配置切断）"
status: ready
labels:
  - gap
  - promotion
  - backlog
parent: null
children: []
extra:
  schema: v1
---
# TASK-60: quay-tasks 存量核实并接入晋级管线（候选源配置切断）

status: todo

## Proposal

外层 2026-08-05 接管时发现：项目存在**两个任务库**——`tasks/`（34 个，全 done，config
`QUAY_NATIVE_TASKS_DIR: ./tasks` 接入）和 `quay-tasks/`（43 个 git 跟踪文件，含 6 todo
+ 1 ready + 2 needs-human，**从未接入晋级管线**）。就绪池 `ready-pool-check` 只扫 `./tasks`，
于是 pool=0 / dispatchable_disjoint=0 是在「存量耗尽」上计算的，而 `quay-tasks/` 的
todo 对系统不可见——**「队列空 ≠ 没活干」的直接证据**：晋级机制在跑，候选源被配置切断。

外层已做机械对账（`docs/analysis/quay-tasks-reconciliation.md`）：6 个 todo 中
TASK-14 = tasks/TASK-50（done，归档）；TASK-11/16/17/18/19 为「真新」候选（代码库无实现）。

### 选定机制

本任务是**核实 + 搬入**，不是直接搬。理由（外层裁定 + 管理者建议）：把未经 git 历史核实的
backlog 直接放 pool 会让 `dispatchable_disjoint` 失真（quay 侧吃过「池混 fixture」的亏）。

## 任务

1. **核实**：对 `quay-tasks/` 6 个 todo + 1 ready（PROBE-ITER9），逐个用 git 历史核实
   （`git log --oneline --all` 查是否被后续任务覆盖 / 是否有依赖 / 是否被方向取代），
   对照 `docs/analysis/quay-tasks-reconciliation.md` 的分类。
2. **搬入**：确认「真新」的（预计 TASK-11/16/17/18/19 中未被取代者）复制到 `tasks/<新id>.md`，
   补 `## Proposal`/`## Plan`/`## Acceptance Criteria`/`## DoD` 四件套 + `## Touches` +
   `## Contract`，加 `source:quay-tasks/<原id>` 溯源标签。原文件标 `**PARKED**`（归档，
   与 ready-pool-check 排除规则一致）。
3. **接入**：确认 `.quay/config.yml` 的 `QUAY_NATIVE_TASKS_DIR` 是否应改为同时覆盖两库，
   或维持 `./tasks`（搬入后两库合一）。**不要自己改 config**——若需改，把结论写进任务
   报告，由外层/管理者裁定。
4. **报告**：产出对账终稿 + 搬入清单，报外层。

## Acceptance Criteria

- [ ] `quay-tasks/` 6 个 todo 逐个有 git 核实结论（「真新/已覆盖/已过期」三选一，附证据命令）
- [ ] 「真新」任务已复制到 `tasks/`（四件套 + Touches + Contract 齐全，带溯源标签），原文件标 `**PARKED**`
- [ ] 搬入后 `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json` 的 `pool` > 0 或 `dispatchable_disjoint ≥ cap`（晋级机制对搬入任务生效）
- [ ] 对账终稿落盘 `docs/analysis/quay-tasks-reconciliation.md`

## Touches

- `tasks/TASK-62.md` `(new)`（第一个搬入任务；后续搬入任务逐个加，编号从 62 起——TASK-61 已被内层用于 types↔analysis 守卫，不占用）
- `tasks/TASK-60.md`（自身文件）
- `docs/analysis/quay-tasks-reconciliation.md`

## Contract

| Key | Value |
|---|---|
| measure | `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json` 的 `pool` 与 `dispatchable_disjoint` 字段 |
| band | 搬入后 pool > 0 或 dispatchable_disjoint ≥ cap（cap=3，floor=12） |
| invariant | 不把已 done 工作重新变 todo；TASK-14（=TASK-50 done）不得被搬入 |
| invoke | `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json` |
| control | 若把 TASK-14 搬入且 pool 出现重复 shape-smell 任务 ⇒ 判定不成立（该任务必须排除） |
| resume | 每核实一个任务即落盘结论到 `docs/analysis/quay-tasks-reconciliation.md`；被打断可从缺口续 |

## 验证

```
node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json
# 期望 pool > 0（真新已搬入）且无 TASK-14 重复
grep -L '\*\*PARKED' quay-tasks/TASK-1*.md  # 已归档的标了 PARKED
```

## Definition of Done

- [ ] `quay-tasks/` 6 个 todo 逐个核实完毕，结论落盘 `docs/analysis/quay-tasks-reconciliation.md`
      （真新/已覆盖/已过期三选一，附证据命令）
- [ ] 「真新」任务已复制到 `tasks/`（编号 ≥ TASK-62，四件套 + Touches + Contract 齐全，
      带 `source:quay-tasks/<原id>` 溯源标签），原文件已归档（标停泊标记）
- [ ] `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json`
      显示 `pool` > 0 或 `dispatchable_disjoint ≥ cap`（晋级机制对搬入任务生效）
- [ ] 重复项（TASK-14 / PROBE-ITER9 / ARCH-INVERSION-001）确认未搬入

## Progress

- （空——待内层执行）

## Dispatch review

| Field | Value |
|---|---|
| reviewer | outer |
| at | 2026-08-05T07:2xZ |
| changed | 任务创建时写就；Contract 每 measure 行自带命令 |
