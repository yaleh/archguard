---
id: gap-slice-delta-explicit-new-destination-dir
title: slice-delta 支持「显式声明的新目的地目录」：ownership-first 的「抽取新模块」才可被模拟，未声明仍
  fail-closed 且不伪造新节点读数
status: done
labels:
  - gap
  - architecture
  - product-surface
parent: null
children: []
extra:
  schema: execution
---
---
id: gap-slice-delta-explicit-new-destination-dir
title: slice-delta 支持「显式声明的新目的地目录」：ownership-first 的「抽取新模块」才可被模拟，未声明仍
  fail-closed 且不伪造新节点读数
status: ready
labels:
  - gap
  - architecture
  - product-surface
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Quay 的 ownership-active 投研环在真库上跑了 90 条记录、21 个候选、**0 个准入**；其中 **11 条**带着 `slice_delta`，**11/11 全是 `not-evaluated`，没有一条算出过 delta**（carrier: quay `.quay/ownership-shadow-proposals.jsonl`，本次逐条读出）。按拒绝原因分类：

| 原因 | 条数 | 目的地 |
|---|---|---|
| `MOVE_TO_NOT_AN_INTERNAL_DIR` | **4** | `gate/core`、`gate/contract`、`gate/runtime`、`model` |
| `切法覆盖不足`（未声明 `stays`） | 2 | `cli -> gate/config`、`gate -> gate/config` |
| `NO_EDGE_EXPLAINED_BY_MOVES`（Quay 前置守卫，未调用 ArchGuard） | 5 | — |

**4 条的目标目录本机核实全部 ABSENT（磁盘上不存在）**——判据在提的正是 ownership-first 的主干预：**抽出一个新模块/新领域对象**。而 `simulate.ts:242-245` 要求 `move.to` 必须是本图已有的 internal 节点，所以这类切法**结构性不可表达**，不是"证据不足"，也不是"模型乱写"。

**边界必须写清，别把通过率算在本任务头上**：另外 7 条不是 ArchGuard 缺口——2 条是判据没声明 `stays`（`stays` 已存在且未用；Quay 侧适配器已经算出了 `restore` 的完整覆盖边，因此同样能推出"留在原地"的名字集，属于 **proposer/adapter 侧的机械可修**），5 条是 Quay 自己的 pre-flight（`docs/analysis/ownership-active-slice-adapter.mjs:93`）在调用 ArchGuard 之前就拒了。本任务最多让 **4/11** 变成可计算。

**本任务不做**：不为新目录**编造**任何 delta（新节点不得带伪造的 fileCount/stats）；不放松未声明时的 fail-closed；不碰 Quay 侧的 proposer/adapter。

## 设计

新增一个**显式声明**：某个目的地目录是**新建的**（除本次搬入的符号外为空）。据此才允许把它当图上的一个新 internal 节点参与模拟。

- 声明形态（加法，不破坏既有输入）：`proposedCut.moves[].toIsNew?: boolean`，或 `proposedCut.newDirs?: string[]`（实现任选其一，但只能有一个正本，写进工具描述与 `docs/user-guide/slice-delta.md`）。**本实现选定 `proposedCut.newDirs?: string[]` 作为唯一正本**（未实现 `toIsNew`）。
- 语义：被声明为新的目录 → 在模拟图里成为新节点；指向它的边照常 retarget；SCC 照常用含新节点的图重算；`accounting.destinations` 列出它。
- **新节点的读数是 unknown，不是 0**：`fileCount` / `stats` 一律缺值或显式 `null` + note（缺值=未查，与本仓库既有 hard rule 一致）。新节点的"入边/出边"只由本次切法产生，这一点要在报告里写明。
- **fail-closed 保留**：`move.to` 既不是本图 internal 节点、也没有被声明为新 → 仍然 `not-evaluated`（exit 2），reason **同时**列出可用于对照的合法 internal 目录节点清单 **和** 修复动作（"要么改成既有节点，要么显式声明它是新目录"）。这条是把"猜"和"声明"分开的关键。
- 目的地冲突仍拒：同一符号既搬向新目录又被 `stays` 声明留在某既有目录 → `not-evaluated`（既有规则不变）。

## AC

- [x] 把一个符号搬向**本图不存在**的目录、并显式声明该目录为新 → `status === 'evaluated'`；`computedDelta` 里该新节点出现在 `accounting.destinations`（以及受影响的 added/removed 边与 `sccAfter` 的成员里，若它确实参与环）
- [x] 上一条报告里新节点的 `fileCount`/`stats` 是 **null/缺值 + note**，**不是 0 也不是任何编造数字**（用递归扫描断言：新节点对象上不存在被猜出来的计数）
- [x] **同一切法、去掉"新目录"声明 → 仍然 `not-evaluated`、exit 2**，且 reason 同时包含 (a) 至少一个合法 internal 目录节点名 与 (b) 指向"声明为新目录"的修复动作
- [x] **真实案例复现**：按 carrier 里第 11 条的形状（目标 `gate/runtime`）构造输入，声明前后分别是 `not-evaluated` → `evaluated`（这是本任务存在的理由，不能只用合成夹具交差）
- [x] **legacy 回归（逐字节）**：既有 `tests/fixtures/slice-delta/` 下全部既有夹具（`goal-033-*`、`claudecodeui-*`、`synthetic-small`、`partial-migration-cases`）的输出与改动前**逐字节相同**（不传新增字段 ⇒ 行为不变）
- [x] **unknown 不被新目录掩盖**：`unresolved` 别名 / `unevaluatedDynamicImports` / barrel 边的既有 `certainty: 'unknown'` 与 `unknowns` 段在含新目录的切法上照常出现
- [x] **negative control 仍然强制**：含新目录的切法若 `negativeControl.restoreEdges` 为空 → `not-evaluated`（exit 2），不因为"新目录"而放行
- [x] **CLI/MCP parity**：同一（含新目录声明的）输入经 `archguard slice-delta` 与 `archguard_simulate_refactor_slice` 调用，`computedDelta`/`negativeControl`/`guards` **逐字节相同**
- [x] 目的地冲突：同一符号既搬向新目录、又被 `stays` 留在既有目录 → `not-evaluated`（既有冲突规则未被绕过）
- [x] 工具描述（`slice-delta-tool.ts`）与 `docs/user-guide/slice-delta.md` 记录新字段、新节点的 unknown 语义、以及 fail-closed 的边界
- [x] `npm test`、`npm run type-check`、`npm run lint`（不新增 error）、`npm run check:adr` 通过

## DoD

不是"多认一个目录就完事"，必须证明：

1. **不伪造**——新节点除"本次搬入的符号"外**没有任何被猜出来的读数**：没有 fileCount、没有 stats、没有强度增量。报告要把"这个节点的内容只有切法声明的那部分"写出来。若实现中发现某处必须给新节点一个数值才能跑通，**停下来**：那说明这个模拟在编数字。
2. **"声明"与"猜"严格分开**——检查实现：每一个被当成新节点处理的目录，都必须能指到一条显式声明；没有任何路径把"图里没有的目录"默认当成新目录。这是本任务安全性的全部。
3. **fail-closed 一条不丢**——未声明的非法目标是仍然 `not-evaluated` 且给出**可操作**的两条修法（改既有节点 / 显式声明为新），不是一句"非法"。
4. **不夸大战果**——报告/README/CHANGELOG 里不得声称"通过率提升"，只能写"让 4/11 那类可计算"；另外 7 条的成因（2 条未声明 `stays`、5 条 Quay pre-flight）属于 Quay 侧，不在本任务范围。
5. **可证伪**——AC 第 3 条（去掉声明就退回 not-evaluated）与第 6 条（unknown 不被掩盖）是反向对照：只要有一条不成立，就说明这次放宽多放行了东西。

## Touches

- src/analysis/slice-delta/types.ts
- src/analysis/slice-delta/simulate.ts
- src/analysis/slice-delta/index.ts
- src/cli/commands/slice-delta.ts
- src/cli/mcp/tools/slice-delta-tool.ts
- docs/user-guide/slice-delta.md
- tests/unit/analysis/slice-delta/simulate.test.ts
- tests/unit/analysis/slice-delta/cli.test.ts
- tests/unit/analysis/slice-delta/parity.test.ts
- tests/unit/cli/mcp/slice-delta-tool.test.ts
- tests/fixtures/slice-delta/quay-gate-cycle.arch.json
- tests/fixtures/slice-delta/legacy-reports.golden.json
- tasks/gap-slice-delta-explicit-new-destination-dir.md
