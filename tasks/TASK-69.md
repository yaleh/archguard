---
id: TASK-69
title: "TASK-69: inner 派发并发上限改自适应（资源门 GO→4 / WAIT→2）"
status: todo
labels:
  - mechanism
  - throughput
  - resource-aware
parent: null
children: []
extra:
  schema: v1
  source: outer-ruling-2026-08-05（manager 转达吞吐率请求）
---
# TASK-69: inner 派发并发上限改自适应

## Proposal

**背景（manager 转达 + 外层裁定）**：机器大部分时间空闲（manager 观察 + archguard 实测一致——
负载主要来自 archguard 自己跑 vitest），但固定高并发不可行（quay 今晚 laneCount=8 在 4 核机器
三次 ABORT）。外层裁定：**自适应并发**。

**实测现状**：archguard 2 个 worktree 并发跑 vitest = 75.8% CPU → 整机 PSI 66（门槛 40）→
resource-gate WAIT。本机与 quay 共享（PSI 是全机的）。full-suite 已由资源闸串行化；**inner
的 subagent 派发目前是固定 cap 3，不查资源闸**。

**裁定档位**：
- 资源门 GO（`resource-gate.sh --for full-suite` 退出 0，PSI some avg10 < 40）：inner 并发上限 **4**
- 资源门 WAIT（退出非 0）：回落 **2**
- 判定时机：inner 每次派发前查一次 gate，按退出码定当前上限；在飞数 ≥ 上限即停派发。
- 自校正：GO 派 4 → vitest 推高 PSI → 下次派发见 WAIT 回 2 → 跑完回落再回 4。

### 选定机制

1. `fast-mode-loop-tick.md` §4「并发上限 3 个在飞 subagent」改为自适应描述：派发前跑
   `bash plugin/scripts/resource-gate.sh --for full-suite`，退出 0 → 上限 4，非 0 → 上限 2。
   在飞计数（subagent 数，按 §4b 口径）≥ 当前上限即停。
2. `ready-pool-check.ts` 的 `cap`/`floor` 联动：当前 cap 默认 3、floor=cap×4=12。若派发上限
   变 4/2，评估 pool floor 是否需调（floor 是就绪缓冲，12 对上限 4 够用，可保持；需确认
   `dispatchable_disjoint ≥ cap` 的 cap 口径随派发上限走，还是独立）。
3. 不引入新脚本——复用 `resource-gate.sh`（既有）。

## Acceptance Criteria

- [ ] `fast-mode-loop-tick.md` §4 并发上限为自适应（GO→4 / WAIT→2），不再是固定 3
- [ ] inner 派发前查 resource-gate，按退出码定上限；在飞 ≥ 上限即停
- [ ] GO 窗口实测：无依赖任务并发派发可达 4（ready-pool 有 ≥4 无冲突候选时）
- [ ] WAIT 窗口实测：并发回落 ≤2（资源闸 WAIT 时不再继续加派）
- [ ] 不破坏「两层绝不同时跑全量」纪律（subagent scoped 与 full-suite 的既有隔离）

## Touches

- `docs/analysis/fast-mode-loop-tick.md`（§4 并发上限描述）
- `plugin/scripts/ready-pool-check.ts`（cap/floor 联动评估；如需调）
- `tasks/TASK-69.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | inner 派发时的在飞 subagent 数与同时刻 resource-gate 退出码 |
| band | GO 时允许 ≤4 在飞；WAIT 时 ≤2 |
| invariant | 全量套件仍串行（两层不同时跑全量）；subagent scoped 测试秒级不冲突 |
| invoke | `bash plugin/scripts/resource-gate.sh --for full-suite` + 观察 inner 派发 |
| control | 人为制造 WAIT（压 PSI）⇒ inner 必须停止加到 2 以上（负控制：WAIT 不回落则判定失败） |
| resume | 改文档 + 评估 ready-pool-check 后实测 GO/WAIT 两档；被打断可从缺口续 |

## Definition of Done

- [ ] §4 自适应描述落地（GO→4 / WAIT→2）
- [ ] inner 派发前查 gate 生效（实测 GO 档 4 在飞、WAIT 档 ≤2）
- [ ] ready-pool-check cap/floor 联动结论写入任务体
- [ ] 外层 full-suite 绿维持（不引入回归）
