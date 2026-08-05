# quay-tasks 存量对账（外层 2026-08-05 裁定）

> 背景：外层接管时发现第二个任务库 `quay-tasks/`（43 个 git 跟踪文件），含
> 6 todo + 1 ready + 2 needs-human，但 `.quay/config.yml` 的 `QUAY_NATIVE_TASKS_DIR: ./tasks`
> 只接入 `./tasks`，`quay-tasks/` 从未进入晋级管线——就绪池 pool=0 / dispatchable_disjoint=0
> 是在对 `./tasks`（34 全 done）计算，`quay-tasks/` 存量对系统不可见。
> 这是「队列空 ≠ 没活干」在本项目的直接证据：晋级机制在跑，但候选源被配置切断。
>
> 管理者裁定：处置归 archguard 外层；建议先机械对账分三类，只搬「真新」进 `./tasks`，
> 其余归档。理由：晋级管线输入质量比数量重要。

## 对账方法

按**标题 + Proposal 主题**比对两库（`quay-tasks/` 6 个 todo 无 `## Touches` 段，故 Touches
不可比，用标题+内容）；再对「无 tasks/ 对应」的查 `src/` 代码库是否已有实现。

## 结论（6 个 todo）

| quay-tasks 任务 | 标题主题 | tasks/ 对应 | 代码库实现 | 分类 |
|---|---|---|---|---|
| TASK-14 | Shape smell literal dispersion | **tasks/TASK-50（done）**，标题几乎逐字相同 | `src/analysis/shape-smells/` 已存在 | **已在 tasks/ 完成** |
| TASK-11 | Tree-sitter query 外部化（QueryLoader + .scm） | 无（TASK-37 是「Decouple runtime types」，主题不同） | 无 QueryLoader/.scm | **真新**（未落地） |
| TASK-16 | PackRegistry + RuleEngine 语言知识注册表 | 无 | 无 | **真新**（未落地） |
| TASK-17 | JL intrinsic dimension（Phase 4） | 无 | 无 | **真新**（未落地） |
| TASK-18 | JL architecture drift（Phase 4） | 无 | 无 | **真新**（未落地） |
| TASK-19 | JL cluster boundary（Phase 4） | 无 | 无 | **真新**（未落地） |

> 注：JL 三连（TASK-17/18/19）同属一个 Phase 4 路线，互相依赖；搬入时需确认是否保留
> 拆分。quay-tasks/TASK-14 与 tasks/TASK-50 标题差一个「for TypeScript」后缀，属同主题。

## 处置裁定

1. **TASK-14** → 归档（`labels: archived` 或移入归档区），不搬——工作已在 tasks/TASK-50 完成。
2. **TASK-11/16/17/18/19** → 5 个「真新」候选。**先不直接搬**：这些是 7 月的 backlog 任务，
   与当前项目方向（fast-mode 已跑完 TASK-29→59）的关系需内层核实（是否有前置依赖、是否
   已被后续方向取代）。搬入动作由内层在下一批队列补充时执行，并附 `source:quay-tasks/<id>`
   溯源标签。
3. 归档执行：把这些任务标 `**PARKED**` 或移入 `tasks/archive/`（与 ready-pool-check 的
   `**PARKED` 排除规则一致）。

## 为什么「先不直接搬」

- 管理者提醒：把混着重复项（TASK-14）的 6 个 todo 直接放进 pool，会让 `dispatchable_disjoint`
  数字失真（quay 侧刚吃过「池里混 fixture 任务」的亏）。
- TASK-11/16/17/18/19 是 6 月底–7 月初的 backlog，可能已被后续任务覆盖或方向取代；
  无 grep 证据 ≠ 无历史，需内层用 git 历史核实再搬。
