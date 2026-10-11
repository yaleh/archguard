---
id: gap-slice-delta-unreferenced-declared-symbols
title: slice-delta 对「声明了但图上任何边都不引用」的符号完全静默：产出与基线逐字节相同的 delta
  且无任何诊断，消费者只能靠近似代理自检（实测误报 6/16）
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

**实测复现（0.1.40 已发布产物，非源码构建）**：在一条 move 的 `symbols` 里加入一个图上**任何地方都不存在**的名字 `thisSymbolDoesNotExistAnywhere12345`，结果是：

- `status: evaluated`、**exit 0**；
- `computedDelta` 与未加该名字的基线**逐字节相同**；
- 该名字在报告里**只出现在 `proposedCut.moves[0].symbols`（输入回显）**——递归扫描确认没有任何诊断字段点名它，`unknowns` 段也没有。

也就是说：**声明一个不存在的符号，与什么都没声明，在产物上完全无法区分**。

**这不是理论问题，已有下游实测代价。** Quay 的端到端架构自举实验在做一个 repair loop，因为原语静默接受编造符号，他们必须在**自己那边**做存在性校验；但目录级图上可用的代理（"该名字是否出现在某条跨目录边上"）在真实候选上**把 16 个真符号里的 6 个判成了编造**。他们据此另立了 Quay 侧任务修那个代理——本任务修的是**让他们不得不依赖代理**的那个根因。

**为什么这与本工具自己的原则相冲突**：本实现通篇是 fail-closed + "声明，不许猜"。覆盖不足那条（有名字没被声明 ⇒ `not-evaluated`）是这条原则的一面；而**声明了一个图上根本不存在的名字**是它的镜像，却被无条件放行。两边不对称，且不对称的那一侧会让调用方对产物过度信任。

## 设计（必须诚实：**这不是一个确定性的"编造检测器"**）

目录级图**无法**区分这三种情况：
1. 调用方编造了一个不存在的符号；
2. 符号真实存在，但**只在它自己所在目录内被 import**（目录级图不表示同目录 import，见 `simulate.ts` 的既有 `assumptions` 第一条）；
3. 符号真实存在，但当前切法确实没有把它卷进任何被对账的边。

所以**不许**把它做成硬门（硬拒会误伤第 2 种，那是最常见的合法情形）。正确做法是给一个**精确的、可复算的**事实，并把它自己的局限写清楚：

- 新增诊断（形状与既有 `unknowns.nameCollisionEdges` / `barrelEdges` 同构）：把 `proposedCut.moves[].symbols` 与 `proposedCut.stays[].symbols` 里**不出现在任何 internal 边的 `importedNames` 上**的名字，逐个列进 `unknowns.unreferencedSymbols[]`（命名可调，但必须是"未被引用"这一事实，不能叫 `fabricated`/`unknown` 之类暗示已判定的词）。
- 该字段**只在非空时发出**（与既有 partial diagnostics 一致的加法式语义，不改变既有夹具的逐字节输出）。
- 报告里同时写明这一条的边界：*"未被任何目录级边引用"不等于"不存在"——同目录 import 在目录级图上不可见*。**不许把该字段描述成编造检测。**

## AC

- [ ] **复现用例**：在任一条 move 的 `symbols` 里加入一个图上不存在的名字 → 该名字出现在 `unknowns.unreferencedSymbols`（今天：报告里除输入回显外**没有任何地方**出现它）
- [ ] **行为不变（关键负对照）**：上一条施加前后的 `status` 与 `computedDelta` **逐字节相同**（仍然是 `evaluated`、exit code 不变）——这是一条诊断加法，**不是新门**。若实现让它变成 `not-evaluated` 或改变了任何 delta，说明它误伤了"只在同目录被引用"的合法符号，**停下来**
- [ ] **真符号不误报**：一个确实出现在某条 internal 边 `importedNames` 上的符号（含**只**经 barrel/re-export 边出现的）**不得**出现在该字段里
- [ ] `stays[].symbols` 同样纳入（只查 `moves` 是不完整的）
- [ ] **legacy 逐字节**：既有全部夹具在未触发该字段时输出与改动前逐字节相同；且字段非空时才出现（用递归 key 扫描断言空数组不被无条件发出）
- [ ] **文案不越界**：该字段的 note / 用户文档 / 工具描述里，必须出现等价于"同目录 import 在目录级图上不可见，因此'未被引用'≠'不存在'"的说明；**不得**出现 `fabricated` / `hallucinated` 这类暗示已判定编造的措辞（grep 可核对）
- [ ] **CLI/MCP parity**：同一输入两个面产出 `unknowns` 逐字节相同
- [ ] `npm test`、`npm run type-check`、`npm run lint`（不新增 error）、`npm run check:adr` 通过

## DoD

1. **不许把它做成一个假装确定性的编造检测器**——上面三种情况在目录级图上不可分，实现与文案都必须承认这点。把它写成"编造检测"会诱导下游把它当门用，那正是这次要修的过度信任。
2. **不许降低既有安全判据，也不许新增误伤**——纯加法：`status`、`computedDelta`、`guards`、`negativeControl` 在有/无该字段时完全一致（AC 第 2、3 条是正反对照）。
3. **精确而非代理**——判定必须是集合运算（该名字是否出现在任一 internal 边的 `importedNames` 里），**不许**用启发式（如"是否出现在跨目录边上"）——那正是下游代理误报 6/16 的成因，原语若复制它就没有价值。
4. **能解释下游那个数字**：本任务落地后，用 Quay 那个真实候选重跑一次，报告里这 16 个符号有几个落进 `unreferencedSymbols`，并说明差额（若仍与 6 不符，说明"跨目录边"与"任何 internal 边"两个判据的差异正是下游误报的来源，把差额写进任务报告）。

## Touches

- src/analysis/slice-delta/simulate.ts
- src/analysis/slice-delta/types.ts
- src/analysis/slice-delta/index.ts
- src/cli/mcp/tools/slice-delta-tool.ts
- docs/user-guide/slice-delta.md
- tests/unit/analysis/slice-delta/simulate.test.ts
- tests/unit/analysis/slice-delta/cli.test.ts
- tests/unit/analysis/slice-delta/parity.test.ts
- tests/unit/cli/mcp/slice-delta-tool.test.ts
- tasks/gap-slice-delta-unreferenced-declared-symbols.md
