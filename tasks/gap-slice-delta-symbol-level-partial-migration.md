---
id: gap-slice-delta-symbol-level-partial-migration
title: slice-delta 支持 symbol-level 切片与单边 importedNames 部分迁移（新增显式 stays
  声明），保留未声明即 fail-closed，并把 alias/reexport/dynamic 的 unknown 显式化
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
## Proposal

`archguard_simulate_refactor_slice`（0.1.39 产品面）在**真实跨项目实测**中挡住了一类正当的小切片。ClaudeCodeUI 的架构审查（`docs/experiments/2026-10-10-archguard-ownership-architecture-review.md`，§3 Candidate 3）要搬**单个符号** `readDeviceName`（从 `modules/settings` 到 `shared`）以缩小前端 42 包环，工具连续三次 `not-evaluated`。本机对今日 claudecodeui `src` 复现，两条拒绝理由与报告逐字一致：

1. 覆盖不足（exit 2）：
   `切法覆盖不足：边 modules/settings -> modules/settings/hooks 的 importedNames=[readDeviceName, readMcpNavigationPolicy, writeMcpNavigationPolicy, McpNavigationPolicy, useSettingsController, useWebPush] 中 [readMcpNavigationPolicy, writeMcpNavigationPolicy, McpNavigationPolicy, useSettingsController, useWebPush] 未被任何 move 的 symbols 覆盖`
2. 混合目的地（exit 2）：调用方把另外 5 个符号声明成"原地不动"的 move（`from === to`）后
   `边 modules/settings -> modules/settings/hooks 的 importedNames 被搬向不同目录（shared, modules/settings/hooks）：无法在目录粒度上对账`

**根因不是语义漏洞，是词汇缺口**：工具没有让调用方表达"这些名字我核对过了，它们留下"。没有这个词，任何**部分迁移**都只能靠人的手算（本轮已发生：见与 Quay GOAL-034 会话的往返），或者被迫先做文件级拆分。

**本任务的性质：加法，不是重写。** 未声明 `stays` 的输入**行为必须逐字节不变**（含 `not-evaluated` 的分支）——现有 `fail-closed` 语义一条不丢，只是给调用方补一个**显式**的声明通道。不新增 Goal。

## 设计

### 1. 新契约（全部可加，不破坏既有输入）

```jsonc
"proposedCut": {
  "moves": [ { "file?": "...", "from": "<dir>", "to": "<dir≠from>", "symbols": ["..."] } ],
  "stays": [ { "dir": "<dir>", "symbols": ["..."], "note?": "..." } ],   // 新增：显式声明这些符号原地不动
  "consumers": [ ... ]
}
```

- **`stays` 是本次扩展的核心**：它让"一条目录边的多个 `importedNames` 里只有一部分真的搬走"第一次**可表达**。
- **`from === to` 的 move 明确报错**并把调用方指向 `stays`（此前它落在"混合目的地"分支，报错文本指错方向）。
- **混合目的地改为合法**（当每个名字的目的地都被显式声明时）：一条边的名字分别落到 D1/D2/原地 ⇒ 产出 `A -> D1`、`A -> D2` 两条 added 边 + 存活的原边。每个名字的目的地是**声明**出来的，不是猜的。
- **`subject` 接受目录节点 id 或文件路径**（文件路径归一化到其所在 internal 目录）。实测摩擦点之一就是它只收目录节点 id。

### 2. 判定规则（在图上是集合运算，和现有一致，只是覆盖来源多一个）

对每条进入 moved-from 目录 B 的内部边 `A -> B`，取 `importedNames`，逐个名字定目的地：被 `moves` 覆盖 ⇒ 去该 move 的 `to`；被 `stays` 覆盖 ⇒ 留在 B。

- **全部名字都已声明** ⇒ 可评估。按目的地分组：每个 `D ≠ B` 产出 added 边 `A -> D`；若有名字留在 B，则原边 `A -> B` **存活**（其强度增量不可算，`strength: null` + note，与既有 `strengthenedEdges` 同一套诚实标注）。
- **有名字既未被 move 也未被 stays 覆盖** ⇒ **仍然 `not-evaluated`**（exit 2），reason 点名未覆盖的名字。**这就是被保留的 fail-closed**，也是它当初发现"第二个真消费者"的价值所在，不能因为要放行部分迁移就顺手删掉。

### 3. 新增报告段（把"unknown"显式化，不伪造确定性）

- `accounting`：逐条受影响边给出 `{ edge, names, moving: [{name,to}], staying: [...], unaccounted: [...], destinations: [...], barrel: boolean }`。ClaudeCodeUI 那三条拒绝理由在这里变成**信息**而不是拒答——调用方一眼看到 co-traveling 符号和它漏掉的第二个消费者（`modules/chat/hooks`）。
- `unknowns`：图中与本次切法相关的**未解析别名**（`moduleGraph.unresolved` 里 `from` 落在切法相关目录的条目）、`unevaluatedDynamicImports` 计数、以及涉及 re-export/barrel 的边。这些**不参与 delta 计算**，只作为"这里可能有图上看不见的耦合"的显式声明。
- 每条 added/removed 边带 `certainty: 'deterministic' | 'unknown'`。

### 4. fail-closed 清单（明确保留 + 新增一条）

保留：SCC 自校验与 `moduleGraph.cycles` 不一致；进入 moved-from 目录的边**没有** `importedNames`；名字未被 move/stays 覆盖；`negativeControl.restoreEdges` 为空。

新增：**未解析别名 ref 的 `from` 目录参与本次切法**（moved-from / 目的地 / subject）⇒ `not-evaluated`。理由：`unresolved` 意味着那条边在图上缺失，此时 delta 的**边集合本身**不完整，不能出数（claudecodeui 实测有 100 条 unresolved ref、2 处 unevaluated dynamic import，不是理论担忧）。

### 5. 文档（报告明确点名的缺口）

`archguard_simulate_refactor_slice` 的工具描述目前只写到 `subject / proposedCut{moves,consumers} / ...` 一层，`moves[]` 字段名、覆盖规则、`stays` 全靠试错（报告 §5 原话）。本任务把完整 slice schema（含 `stays`、目的地规则、fail-closed 清单、`accounting`/`unknowns` 的读法）写进工具描述与 `docs/user-guide/slice-delta.md`。

**明确不做**：不做 ownership 语义推断、不自动选 slice、不给方案排序；不改 `check-layers.mjs` / `layers.yml`；**不动冻结的原型** `docs/experiments/layer-map/slice-delta.mjs`；不做发布动作。

## AC

- [x] **真实负例 → 新正例**：以本机今日 claudecodeui `src` 的真实 package 级图（137 节点 / 549 边 / 96 internal / 42 员环 / `unresolved` 100 条 / `unevaluatedDynamicImports` 2）为 fixture（`tests/fixtures/slice-delta/claudecodeui-frontend.arch.json`，moduleGraph 投影，注明是真实 `analyze` 产物的投影）。**同一份单符号切法**（`from: modules/settings/hooks`, `to: shared`, `symbols: ["readDeviceName"]`）在改动前必须 `not-evaluated` 且 reason 逐字等于本任务 Proposal 第 1 条引用的那句（可作为回归基线断言）；**补上 `stays` 声明**（把 `readMcpNavigationPolicy`/`writeMcpNavigationPolicy`/`McpNavigationPolicy`/`useSettingsController`/`useWebPush` 声明为留在 `modules/settings/hooks`）后必须 `evaluated` 且 exit 0
- [x] 上一条的 `evaluated` 报告里：`shared/context -> modules/settings`（该边 `importedNames` 恰为 `["readDeviceName"]`，被完整覆盖）被判为 removed/retarget 到 `shared`；`modules/settings -> modules/settings/hooks` 判为**存活**且 `accounting` 里 5 个 staying 名字齐备、`unaccounted` 为空
- [x] **legacy 兼容（逐字节）**：既有 `tests/fixtures/slice-delta/goal-033-slice.json`（无 `stays`）对既有 GOAL-033 fixture 的输出与改动前**逐字节相同**（`computedDelta` / `negativeControl` / `sccAfter` 全等，仍 6→4、exit 0）
- [x] **fail-closed 未被削弱**：不声明 `stays` 的 claudecodeui 单符号切法仍 `not-evaluated`、exit 2、reason 点名未覆盖的 5 个名字（同一个负例既是新正例的前半，也是这条的断言）
- [x] **mixed destinations 负对照**：同一个符号被两条 move/stays 声明到**不同**目的地 ⇒ `not-evaluated`、exit 2；`from === to` 的 move ⇒ `not-evaluated`、exit 2 且 reason **指向 `stays`**（不是指向"混合目的地"）
- [x] **mixed destinations 正例**：一条边的名字被显式声明到两个**不同**目的地 ⇒ `evaluated`，added 边每个目的地各一条，且 `accounting.destinations` 列出两者
- [x] **缺漏 consumer 仍可见**：切法漏掉一个图上真实存在的消费者 ⇒ `not-evaluated` 且 reason 点名那条边与未覆盖名字；在 `accounting`（或等价段）里该消费者的 `sourceDir` 可被定位（`modules/chat/hooks` 这一条在真实 fixture 上可复现）
- [x] **unknown 显式化且不伪造**：报告含 `unknowns` 段，列出与切法相关的 unresolved 别名 ref、`unevaluatedDynamicImports` 计数、barrel/re-export 边；这些**不**进入 delta 计算；**新增**的 fail-closed（unresolved ref 的 `from` 参与切法 ⇒ not-evaluated）有专门用例
- [x] **`subject` 接受文件路径**：给 `modules/settings/hooks/useMcpNavigationSettings.ts` 这类文件路径时归一化到所在 internal 目录并正常评估；给不存在的路径/节点 ⇒ `not-evaluated` 且 reason 说明（不静默取空）
- [x] **CLI/MCP parity**：同一（真实 fixture + 含 `stays` 的 slice）分别经 `archguard slice-delta` 与 `archguard_simulate_refactor_slice` 调用，`computedDelta` / `negativeControl` / `guards` **逐字节相同**
- [x] **规模回归**：真实 claudecodeui 图（137/549）上的 CLI 调用在合理时间内完成（目标 < 5s，与既有规模同数量级），且 `npm test` 全量通过
- [x] 工具描述（`slice-delta-tool.ts` 的 description 与 zod `.describe`）与 `docs/user-guide/slice-delta.md` 更新为**完整** slice schema：`moves[]`/`stays[]` 字段名、目的地规则、fail-closed 清单、`accounting`/`unknowns` 的读法
- [x] 报告里仍**没有** `pass`/`fail`/`exitCode` 字段名；`git diff` 证明 `docs/experiments/layer-map/slice-delta.mjs` 与其 17 个既有测试**逐字节未改**
- [x] `npm test`、`npm run type-check`、`npm run lint`（不新增 error）、`npm run check:adr` 通过

## DoD

不是"加了 `stays` 字段 + 测试绿"就算完成，必须证明：

1. **是加法不是重写**——未声明 `stays` 的一切输入行为逐字节不变（AC 里的 legacy 兼容与"fail-closed 未被削弱"两条是机械证据）。若实现中发现某条既有 `not-evaluated` 分支被顺手改成 `evaluated`，**停下来**：那说明范围越界了，本任务只新增显式通道。
2. **放行的是"已声明的部分迁移"，不是"猜出来的部分迁移"**——检查实现：每一个被判定留在原地的名字，都必须能被指到一条 `stays` 声明；没有任何一条路径把"未声明的名字"默认成"留下"。这条是本次扩展的整个安全性所在。
3. **不伪造确定性**——surviving 边的强度增量仍为 `null`（不允许按名字个数折算）；涉及 unresolved 别名 / dynamic import / barrel 的边必须带 `certainty: 'unknown'` 或在 `unknowns` 里出现，不得混进确定性的 added/removed 计数。
4. **真实案例是真的跑通**：AC 用的不是合成图，是 claudecodeui 今日真实 package 级图；`readDeviceName` 单符号切法从 `not-evaluated` 变成 `evaluated` 是这次扩展存在的理由。若真实图上补 `stays` 后仍 `not-evaluated`，**先停下来**判断是图的未知项（unresolved/dynamic）导致的还是实现有洞，不要为了让 AC 变绿去放宽 fail-closed。
5. **保留了发现力**：不声明 `stays` 时仍然拒答——这是该工具此前"发现第二个消费者"的能力来源，不能因为要放行而变成"静默按部分覆盖出数"。

## Touches

- src/analysis/slice-delta/types.ts
- src/analysis/slice-delta/simulate.ts
- src/analysis/slice-delta/index.ts
- src/cli/commands/slice-delta.ts
- src/cli/mcp/tools/slice-delta-tool.ts
- docs/user-guide/slice-delta.md
- tests/fixtures/slice-delta/claudecodeui-frontend.arch.json (new)
- tests/fixtures/slice-delta/claudecodeui-readdevicename-slice.json (new)
- tests/fixtures/slice-delta/partial-migration-cases.json (new)
- tests/unit/analysis/slice-delta/simulate.test.ts
- tests/unit/analysis/slice-delta/parity.test.ts
- tests/unit/analysis/slice-delta/cli.test.ts
- tests/unit/cli/mcp/slice-delta-tool.test.ts
- tasks/gap-slice-delta-symbol-level-partial-migration.md
