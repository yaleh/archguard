---
id: gap-slice-delta-unreferenced-declared-symbols
title: slice-delta 对「声明了但图上任何边都不引用」的符号完全静默：产出与基线逐字节相同的 delta
  且无任何诊断，消费者只能靠近似代理自检（实测误报 6/16）
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

**实测复现（0.1.40 已发布产物，非源码构建）**：在一条 move 的 `symbols` 里加入一个图上**任何地方都不存在**的名字 `thisSymbolDoesNotExistAnywhere12345`，结果是：

- `status: evaluated`、**exit 0**；
- `computedDelta` 与未加该名字的基线**逐字节相同**；
- 该名字在报告里**只出现在 `proposedCut.moves[0].symbols`（输入回显）**——递归扫描确认没有任何诊断字段点名它，`unknowns` 段也没有。

也就是说：**声明一个不存在的符号，与什么都没声明，在产物上完全无法区分**。

**下游已有实测代价。** Quay 的端到端架构自举实验在做 repair loop，因为原语对此静默，他们必须在自己那边做存在性校验；其代理判据在真实候选上把 16 个声明符号里的 6 个划为"未出现"。他们据此另立了 Quay 侧任务。本任务处理的是**让他们不得不各自发明这个判据**的根因。

**为什么这与本工具自己的原则相冲突**：本实现通篇是 fail-closed + "声明，不许猜"。覆盖不足那条（有名字没被声明 ⇒ `not-evaluated`）是这条原则的一面；而**声明了一个任何边都不承载的名字**是它的镜像，却被无条件放行。不对称的那一侧会让调用方对产物过度信任。

## 关键事实（已核实，决定了本任务的真实价值边界 —— 实现前必读）

`src/plugins/typescript/builders/module-graph-builder.ts:113`：

```ts
// Skip self-imports
if (fromModule === toModule) return;
```

目录级 moduleGraph **不产生自环**。直接推论：

1. **同目录 import 在目录级图上是结构性不可见的**，不是"暂时没实现"，而是这个粒度的定义决定的。
2. 因此"出现在任一 internal 边的 `importedNames` 上"**等价于**"出现在某条跨目录边上"——**不存在比下游代理更强的目录级判据**。
3. 所以那 6/16 **很可能不是他们代理的 bug，而是一个"未被任何跨目录边引用"问题的正确答案**：那 6 个是真实符号，只是仅在自己目录内被使用（或尚未接线）。他们的闸把"未被引用"读成了"编造"——那是**读法**的问题，不是判据的问题。

**于是本任务的价值必须如实设定为：把这个判据在产物里定成唯一、有测试、有文档的一处定义，并把它自己的边界写在脸上**，让每个消费者不必各自发明一个会漂移的近似；**不是**提供更强的判别力——在目录级上不存在这种东西。

**一处确实可精确化的地方**：模块图对**外部**边同样记录 `importedNames`（`case 'external': record(fromModule, resolution.name, names, isTypeOnly)`，`record` 里 `acc.importedNames.add(name)`）。所以"是否被引用"的**精确**集合应当是**所有边（internal + external）**的 `importedNames` 之并，而不是只查 internal/跨目录边。请按这个精确集合实现，并在文档里把边界写清楚。

## 设计

目录级图**无法**区分这三种情况：
1. 名字确实不存在；
2. 名字真实存在，但**只在自己所在目录内被 import**（见上方核实：自环被跳过）；
3. 名字真实存在，但当前切法确实没有把它卷进任何被对账的边。

所以**不许**把它做成硬门（硬拒会误伤第 2 种，而第 2 种恰恰是最常见的合法情形）。做法是给一个**精确的、可复算的**事实，并把它自己的局限写在产物里：

- 新增诊断（形状与既有 `unknowns.nameCollisionEdges` / `barrelEdges` 同构）：把 `proposedCut.moves[].symbols` 与 `proposedCut.stays[].symbols` 里**不出现在任何边（internal 或 external）的 `importedNames` 上**的名字，逐个列进 `unknowns.unreferencedSymbols[]`。命名必须是"未被引用"这一事实本身，**不许**出现 `fabricated` / `hallucinated` / `unknown` 这类暗示已判定编造的词。
- 该字段**只在非空时发出**（与既有 partial diagnostics 一致的加法式语义，不改变既有夹具的逐字节输出）。
- 报告里同时写明边界：*"未被任何边引用"不等于"不存在"——同目录 import 在目录级图上不可见（构建器跳过自环）*。**不许把该字段描述成编造检测。**

## AC

- [x] **复现用例**：在任一条 move 的 `symbols` 里加入一个图上不存在的名字 → 该名字出现在 `unknowns.unreferencedSymbols`（今天：报告里除输入回显外**没有任何地方**出现它）
- [x] **行为不变（关键负对照）**：上一条施加前后的 `status` 与 `computedDelta` **逐字节相同**（仍然是 `evaluated`、exit code 不变）——这是一条诊断加法，**不是新门**。若实现让它变成 `not-evaluated` 或改变了任何 delta，说明它误伤了合法符号，**停下来**
- [x] **真符号不误报**：一个确实出现在某条边 `importedNames` 上的符号（含**只**经 barrel/re-export 边、或**只**经 external 边出现的）**不得**出现在该字段里
- [x] `stays[].symbols` 同样纳入（只查 `moves` 是不完整的）
- [x] **legacy 逐字节**：既有全部夹具在未触发该字段时输出与改动前逐字节相同；且字段非空时才出现（用递归 key 扫描断言空数组不被无条件发出）
- [x] **判定是明确定义的集合运算**：实现里必须能一眼看出它并的是哪些边的 `importedNames`（internal + external），不得留含糊；并把该集合写进文档
- [x] **文案不越界**：该字段的 note / 用户文档 / 工具描述里，必须出现等价于"同目录 import 在目录级图上不可见，因此'未被引用'≠'不存在'"的说明；**不得**出现 `fabricated` / `hallucinated` 这类暗示已判定编造的措辞（grep 可核对）
- [x] **CLI/MCP parity**：同一输入两个面产出 `unknowns` 逐字节相同
- [x] `npm test`、`npm run type-check`、`npm run lint`（不新增 error）、`npm run check:adr` 通过

## DoD

1. **不许把它做成一个假装确定性的编造检测器**——上面三种情况在目录级图上不可分（自环被跳过是结构性的），实现与文案都必须承认这点。把它写成"编造检测"会诱导下游把它当门用，那正是这次要修的过度信任。
2. **不许降低既有安全判据，也不许新增误伤**——纯加法：`status`、`computedDelta`、`guards`、`negativeControl` 在有/无该字段时完全一致（AC 第 2、3 条是正反对照）。
3. **定义精确、边界写明**：判定是"名字是否出现在任一 internal 或 external 边的 `importedNames` 里"这一集合运算；文档要写明它**包含什么、不包含什么**（尤其：不含同目录 import）。
4. **用真实候选解释那个数字，并如实归因**：落地后用 Quay 那个真实候选重跑一次，报告这 16 个符号里有几个落进 `unreferencedSymbols`。**预期是接近 6**——若接近 6，则该数字**印证了下游代理是忠实的**，"6 个被当成编造"是**读法**问题而非判据问题，请如实这样写。若与 6 有明显差额，则指出差额由哪一类边解释（例如 external 边的计入），把差额写进任务报告。**无论结果如何，不得为凑一个"更好看"的数字而调整判据。**

## 落地报告（worker）

**DoD 4 — 真实候选重跑（在落地后的构建上）**：对 2026-10-11 盲测候选（carrier `.quay/ownership-shadow-proposals.jsonl` 第 91 条，commit `ec00fcc00`，3 个 move 共 **16** 个符号）在同一棵树的 package 级 ArchJSON 上重跑 `archguard slice-delta`：

- `status: evaluated`（沿用 adapter 产出的 `stays`：28 个声明符号 = 16 move + 12 stay），`unknowns.unreferencedSymbols` = `["AcceptanceResult","AcceptanceVerdict","GateDefinition","GateVerdict","GateVerdictKind","NotEvaluatedCause"]` —— **恰好 6 个**。
- 与下游代理的 6 个**完全一致（同集合）**。**如实归因**：该数字**印证了下游代理的判据是忠实的**；"6 个被当成编造"是**读法**问题（把"未被任何边引用"读成"编造"），不是判据问题。按 DoD 4，**不为凑数字调整判据**。
- 差额为 0 的原因：这 6 个名字在**任何边**（internal 或 external）上都不出现（是 `gate/types.ts` / `gate/acceptance-runner.ts` 的真实导出，只在同目录内被用或尚未接线）；把 external 边计入 reference set 对本候选不改变集合（其余 10 个都在 internal 边上）。

**实现**：`referenced := ⋃ { e.importedNames : e ∈ moduleGraph.edges }`（internal + external）；`unreferencedSymbols := declaredNames \ referenced`（排序，非空才发出，附 `unreferencedSymbolsNote` 边界串）。纯加法，不进 `computedDelta`：`status` / `computedDelta` / `guards` / `negativeControl` 在有/无该字段时逐字节一致（负对照已测）。

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
