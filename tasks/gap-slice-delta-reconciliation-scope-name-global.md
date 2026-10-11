---
id: gap-slice-delta-reconciliation-scope-name-global
title: slice-delta 对账范围泄漏：move 的符号名在图上是全局匹配的，导致未进入 moved-from 目录的边被静默判为
  removed（与自身文档假设矛盾，实测可复现）
status: ready
labels:
  - gap
  - architecture
  - product-surface
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

本任务报告一个**实测可复现的错 delta**（不是理论担忧）。构造最小无环图：内部目录 `""`、`X`、`Y`、`D`，边 `"" -> X` 与 `"" -> Y` 的 `importedNames` **都只有一个名字 `foo`**。切法只有一条 move：`foo` 从 `X` 搬到 `D`（**没有 `stays`**，没有 `consumers`）。命令：

```
node dist/cli/index.js slice-delta --arch g.arch.json --slice s.json
```

实测输出（`status: evaluated`）：

```json
removedEdges: [" -> X (retargeted-to:D)", " -> Y (retargeted-to:D)"]
addedEdges  : [" -> D"]
```

**`"" -> Y` 被判定为"随搬迁消失并改指到 D"——但 `Y` 根本不是 moved-from 目录，它的 `foo` 与本次搬迁无关，这条边在现实里原封不动。** 这是一个被静默写进 `computedDelta` 的**错边**，会连带影响 `sccBefore/sccAfter`、`sccLeft` 与 negative control 的判定。这属于"编造依赖 delta"的形态（虽然不是为了凑通过率）。

**根因**：对账循环遍历**全部** internal 边（`simulate.ts:365-368` 的 `orderedEdges` 两段拼接），而判定用的三处查询都**按符号名全局匹配、从不看 `e.to`**：

```
:381  const affected  = names.some((n) => destOfSymbol.has(n));
:382  const uncovered = names.filter((n) => !destOfSymbol.has(n) && !stayedSymbolDir.has(n));
:388  const staying   = names.filter((n) => stayedSymbolDir.has(n));
```

`destOfSymbol`（符号→move）与 `stayedSymbolDir`（符号→stays 目录）都是**只有符号作键**的 Map。于是"X 里有个叫 foo 的符号被搬走"被当成了"图上任何地方叫 foo 的符号都被搬走"。

**这与本实现自己写下的假设直接矛盾。** `simulate.ts:338` 的 `assumptions` 第一条明写：

> 本实现只对账「进入 moved-from 目录的边」。

代码却对账了所有边（只要名字撞上）。**要么代码错了，要么注释错了，不存在第三种解释** —— 而注释描述的是安全得多的语义（也是上游消费者（Quay ownership-active 适配器）在依赖的语义）。

**为什么 barrel 分支不是借口**：确实存在一个**有意**的放宽——进入某个 re-export/barrel 目录、再转发被搬名字的边，也应当被对账（`:350-352` 注释）。但代码里**已经有**这个集合：`reexportsFromMoved`（`:332-333`）。所以正确做法是把放宽**限定在那一集合**，而不是把"名字相同"当成"同一个实体"的通行证。目录级图无法证明两个同名符号是同一个实体，当前实现默认它们是——这就是错边的来源。

## 设计

把"非 moved-from 目录的边"的对账**限定在结构性可证的范围**：

- 边 `A -> B` 且 `B` 不是 moved-from 目录：
  - `B ∈ reexportsFromMoved`（结构性 re-export，已算出）→ 保持现有对账（**这是唯一被证明可以放宽的情形**）
  - 否则 → **不得**因为名字撞上就把它判成 removed；该边原样保留。若本次切法的符号确实出现在这条边上（即存在真实的同名歧义），**不要猜**：把这条边标 `certainty: 'unknown'` 并进 `unknowns`（或按既有 fail-closed 精神 `not-evaluated`，实现二选一但要在文档里写明），**绝不静默删除**。
- `moves` 侧的同名冲突规则不变（`:274-278` 已拒"同一符号搬向两个目录"）；`stays` 侧同理（`:296-302`）。
- 文档与代码必须一致：修好后 `assumptions` 那句要么与实现相符，要么改成实现真正做的事。

## AC

- [ ] **复现用例变绿**：上面的最小图 + 单条 move（无 `stays`）→ `removedEdges` **不含** `" -> Y"`，含 `" -> X (retargeted-to:D)"`；`" -> Y"` 要么原样保留、要么出现在 `unknowns`/`certainty: 'unknown'` 里（取决于实现选的那条路），**不得**出现在 `removedEdges`
- [ ] **barrel 语义不丢**：进入一个**结构性 re-export from moved-from dir** 的目录的边，仍然被对账（用一条这样的边做正例；这正是 `reexportsFromMoved` 存在的理由）
- [ ] **文档与代码一致**：`simulate.ts` 的 `assumptions` 关于"只对账进入 moved-from 目录的边"的表述与实现相符（二选一改哪边都行，但不许继续矛盾）；并有一条测试断言实际参与对账的边集合
- [ ] **legacy 逐字节**：`tests/fixtures/slice-delta/` 下全部既有夹具（`goal-033-*`、`claudecodeui-*`、`synthetic-small`、`partial-migration-cases`）输出与改动前**逐字节相同**（它们的同名撞车若存在，必须在 `unknowns` 里可见而不是靠改数字糊过去）
- [ ] **不新增假 red**：既有夹具一个都不许从 `evaluated` 掉到 `not-evaluated`（若某条夹具真的命中同名歧义，如实记录并说明，不许为了好看放宽回去）
- [ ] **CLI/MCP parity**：同一输入经 CLI 与 MCP 调用，`computedDelta`/`negativeControl`/`guards` 逐字节相同
- [ ] `npm test`、`npm run type-check`、`npm run lint`（不新增 error）、`npm run check:adr` 通过

## DoD

1. **不许拿"barrel 可能"当借口继续全局匹配**：实现里每一个"非 moved-from 目录却被对账"的边，都必须能指到一个结构性证据（`reexportsFromMoved` 命中）。指不到的，就必须保留原边或标 unknown。
2. **不许为了少改而放宽**：修完不得让任何既有夹具的 delta 变大（多出 removed/added 边）。这个缺陷的方向是"多删"，修它只会让结果更保守。
3. **实证而非推理**：AC 第 1 条的最小图是这次修复的证伪点——它必须在修复前**红**（现在的代码确实把 `" -> Y"` 判掉了），修复后**绿**。若实施者发现自己"改了实现但这个用例本来就是绿的"，说明改错了地方，停下来。
4. **诚实记录**：这是本能力的**剩余限制**之一（目录级图无法判定两个同名符号是否同一实体）。报告/文档要把这条写清，而不是假装已经彻底解决——`certainty: 'unknown'` 是这条限制的出口，不是装饰。

## Touches

- src/analysis/slice-delta/simulate.ts
- src/analysis/slice-delta/types.ts
- src/analysis/slice-delta/index.ts
- docs/user-guide/slice-delta.md
- tests/unit/analysis/slice-delta/simulate.test.ts
- tests/unit/analysis/slice-delta/cli.test.ts
- tests/unit/analysis/slice-delta/parity.test.ts
- tests/unit/cli/mcp/slice-delta-tool.test.ts
- tasks/gap-slice-delta-reconciliation-scope-name-global.md
