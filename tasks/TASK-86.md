---
id: TASK-86
title: "TASK-86: v0.4.0 机制升级后的实证复核——TASK-80 6 盲区矩阵重跑（消费方布局）"
status: done
labels:
  - verification
  - mechanism
parent: null
children: []
extra: {}
---
# TASK-86: v0.4.0 机制升级后的实证复核——TASK-80 6 盲区矩阵重跑（消费方布局）

## Proposal

TASK-80（2026-08-06，archguard 仍 v0.3.13 旧机制）实证 6 盲区矩阵，4/6 misjudges：
verify-delivery-surface 0/6（查 quay 工厂布局、不认消费方布局）、self-report-vocab 停止态假警报、
laydown-set-check fail-closed（0 derived test 假阴性）、dead-loop-check 语义观察。

commit `441960d8` 已把 archguard 升级到 **v0.4.0**（78/78 铺设集绿，drift 0/缺失 0），且新铺设集
含 `dist/verify-delivery-surface.js`、`dist/self-report-vocab-audit.js`、`laydown-set-check.sh`、
`dead-loop-check.sh`、`slot-refill.sh` 等。**重跑 6 盲区矩阵**，验证升级后 misjudges 是否仍在
（机制是否改了布局判据），逐条 `compatible | misjudges` + 证据（before vs after 对照）。

只读验证——不改任何机制脚本。

## Acceptance Criteria

- [x] 确认 v0.4.0 铺设集在位（verify-delivery-surface / self-report-vocab-audit / laydown-set-check / dead-loop-check / slot-refill）
- [x] 重跑 6 盲区逐条：verify-delivery-surface / self-report-vocab / slot-refill / taskWorkLanded / laydown-set-check / dead-loop-check（对照 TASK-80 每条结论）
- [x] 每条报 compatible / misjudges + 证据（命令 + 输出；before vs after）
- [x] 盲区清单更新：仍存 / 已修 / 新增，各有证据
- [x] 只读验证——不改任何机制脚本（含 plugin/scripts/*）

## Touches

- `docs/analysis/batch2-queue-state.md`（结果落盘，TASK-80 实证节追加 v0.4.0 delta）
- `tasks/TASK-86.md`（自身文件）

## Contract

| Key | Value |
|---|---|
| measure | 6 盲区逐条重跑结论 + 证据（命令输出） |
| band | 每条有可复核证据；misjudges 是否仍存如实报 |
| invariant | 只读——不改任何机制脚本 |
| invoke | 各机制脚本 `--root /home/yale/work/archguard`（见 TASK-80 矩阵命令） |
| control | n/a（纯验证，如实报，不构造） |
| resume | 从「确认铺设集 + 首条盲区」续 |

## Definition of Done

- [x] 6 盲区逐条重跑结论落盘（对照 TASK-80 before）
- [x] misjudges 仍存/已修各有证据
- [x] 盲区清单 delta 更新（新增盲区如实记）

## Evidence (2026-08-11, outer dispatch tick — v0.4.0 重跑)

**铺设集确认（AC1）**：`quay-init-state.json` `pluginVersion: 0.4.0`；`plugin/scripts/dist/` 含
`verify-delivery-surface.js` / `self-report-vocab-audit.js` / `self-report-vocab-check.js` /
`slot-refill.js`；`laydown-set-check.sh` / `dead-loop-check.sh` 在位。**注**：这些 `.js`/`.sh` 均为
quay-init 铺设的 gitignored 机制产物（主仓在位，worktree fork 不携带）——验证在**主仓根**直跑
（TASK-86 只读验证，不依赖 worktree node_modules）。

**6 盲区重跑矩阵（对照 TASK-80 v0.3.13）**：

| # | 盲区 | TASK-80 (v0.3.13) | v0.4.0 实测 | 判定 |
|---|---|---|---|---|
| 1 | verify-delivery-surface | **misjudges** 0/6（消费方布局假阴性） | `surface_categories_covered=5/6`，5 类 COVERED，1 MISSING（observation-and-verification，缺失 `verify-delivery-surface.ts`/`l1-delivery-surface-check.ts` = 脚本自引用 .ts 源，dist 只有 .js）；exit 1（band=6 未满） | **已修（部分）**：0/6→5/6 |
| 2 | self-report-vocab | **misjudges**（稀疏自报→NOT-CONVERGED 假警报） | `self-report-vocab-check` count=0 → `OK — no batch-style inner self-report` **exit 0**；audit `reports_total 0 · NOT-CONVERGED` 也 **exit 0**（NOT-CONVERGED 非阻塞） | **已修**：假警报不再阻塞 |
| 3 | slot-refill | **compatible** | `ready-pool-check` pool=1 <floor 12 → criterion_met=false（no-refill 语义正确）；**但** `slot-refill.sh --cap 3` 报 `ERROR: charter not found: --cap` exit 2（wrapper 把 --cap 透传给不吃它的内层 concurrent-batch-scheduler） | **compatible（语义）** + **新增缺陷**（wrapper --cap 坏） |
| 4 | taskWorkLanded 第3信号 | **misjudges**（派发提交误触发→未落地报 true） | `ready-pool-check` TASK-86 在 `ready` 且 **`excluded: []`**——未落地任务不再被误排除（not-yet-flipped 正确检出） | **已修** |
| 5 | laydown-set-check | **misjudges**（0 derived test fail-closed 假阴性） | 仍 `laydown_set_green: red`，`derivation produced an empty set (no plugin/scripts/ refs in skills/loop docs)`，exit 1 | **仍存**（消费方布局假阴性未改） |
| 6 | dead-loop-check | **观察**（alive=会话存活非工作推进） | `loop_alive=alive`（git_last_commit_min=13 <30）+ **`liveness_independent_of_backlog=1`** 新 invariant + next_step 分类（restart/human-needed/backlog-empty，不报「已完成」） | **已改进**（语义区分 backlog-empty） |

**汇总**：TASK-80 = 4 misjudges + 1 观察 + 1 compatible；v0.4.0 = **3 已修 + 1 仍存 + 1 已改进 + 1 compatible（语义）**。
misjudges 从 4/6 → **1/6 仍存**（laydown-set-check），另加 **1 新增缺陷**（slot-refill wrapper --cap）。

**盲区清单 delta**：
- **已修**：verify-delivery-surface（0/6→5/6，消费方布局获认）、self-report-vocab（NOT-CONVERGED 非阻塞）、taskWorkLanded（未落地正确检出，excluded:[]）。
- **已改进**：dead-loop-check（liveness_independent_of_backlog + next_step 分类）。
- **仍存**：laydown-set-check（消费方 0 derived 仍 fail-closed red）——派生源仍 quay 专属。
- **新增**：slot-refill.sh wrapper 的 `--cap` 参数坏（透传给不吃 cap 的内层）；slot-refill.js `--cap`/`--help` 均 `charter not found`。

**只读不变性（AC5）**：未改任何机制脚本（`plugin/scripts/*` 零改动，git status 仅 task 文件）。
