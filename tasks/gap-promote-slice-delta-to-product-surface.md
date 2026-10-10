---
id: gap-promote-slice-delta-to-product-surface
title: 把 slice-delta 原型提升为稳定产品面：src/analysis/slice-delta 库 API + archguard
  slice-delta CLI + archguard_simulate_refactor_slice MCP，全部随发布产物可达
status: todo
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

`gap-refactor-slice-expected-delta-prototype`（done）已经在 `docs/experiments/layer-map/slice-delta.mjs` 落地并验证了语义：显式切法 → 确定性预期 delta + 负对照 + 三层读数分区。但那是一个**实验路径**——Quay/meta-driver 要消费它就得依赖 `docs/experiments/...` 这种源码位置，这在本仓库是不可接受的（不是发布产物、路径会漂、也不是稳定契约）。本任务把已验证的语义**移植到稳定产品面**，让消费者只依赖 `@yalehwang/archguard` 的发布产物。

本任务**不重新设计语义**：`slice-delta.mjs` 里已经验证过的判定规则、fail-closed 行为、三层分区一律原样迁移，判据是「同一输入下库实现与实验脚本输出一致」（AC 里的 parity 测试）。也不新增 Goal。

**发布不在本任务范围内**（GOAL-001：发布由人在 Claude Code 会话中触发）。本任务只负责让能力在 `dist/` 里可达；打 tag / npm publish / 推进 master 由发布流程单独做。

## 设计

### 1. 确定性库 API（正本）

新增 `src/analysis/slice-delta/`：

- `types.ts` — 输入/输出类型。**图类型直接复用既有的 `TsModuleGraph`（`src/types/extensions/ts-analysis.ts`），不要另造一份图类型。**
- `simulate.ts` — 纯函数核心，**⛔ 不得 import `fs` / `path` / `child_process`**（无 I/O、无 git 探测；provenance 一致性检查这类需要 I/O 的东西留在 CLI/MCP 适配层，不进核心）。
- `index.ts` — 再导出。

```ts
export interface RefactorSliceDeclaration {
  subject: string;
  concern?: string;
  provenance?: Record<string, unknown>;
  proposedCut: { moves: SliceMove[]; consumers?: SliceConsumer[] };
  declaredPrediction?: { sccSize?: number; sccMembers?: string[]; source?: string };
  mustNotChange?: { forbiddenNewEdges?: SliceEdge[]; untouchedDirs?: string[] };
  negativeControl: { description?: string; restoreEdges: SliceEdge[] };
}
export interface SliceMove { file?: string; from: string; to: string; symbols: string[]; note?: string }
export interface SliceConsumer { file?: string; dir: string; imports: string[] }
export interface SliceEdge { from: string; to: string }

/** 唯一入口：纯函数，不抛业务异常。 */
export function simulateRefactorSlice(input: {
  graph: TsModuleGraph;
  slice: RefactorSliceDeclaration;
  observed?: Record<string, unknown>;   // 后验读数，只进对比段
}): SliceDeltaReport;
```

`SliceDeltaReport` 至少含（字段名沿用 `slice-delta.mjs` 的既有命名，别改名）：

- `status: 'evaluated' | 'not-evaluated'`（not-evaluated 时给 `reason: string`，且**不得**出现半份 computedDelta）
- `current`: `sccMembers` / `sccSize` / `subjectFanIn` / `targets` / `relevantEdges`
- `computedDelta`: `inputsUsed` / `removedEdges` / `addedEdges` / `strengthenedEdges` / `sccBefore` / `sccAfter` / `sccLeft` / `sccRemaining` / `targetsAfter` / `whyLeft`
- `affectedConsumers` + `declaredConsumers`
- `proposedCut`（原样回显 + `assumptions`）
- `mustNotChange`: `{ forbiddenNewEdges, untouchedDirs, violations }`
- `negativeControl`: `{ restoreEdges, leftDirs, leftDirsRejoined, restoresBeforeMembership, falsified }`
- `guards`: `{ clean: boolean, violations: number, negativeControlFalsified: boolean }`
- `declaredPrediction` / `observedDelta` / `predictionComparison`
- `provenance` 段由调用方注入（核心只负责把它放进报告，不自己去读环境）

### 2. 必须原样迁移的语义（这是本任务的实质）

1. **anti-stuffing / 三层物理分区**：`computedDelta` 与 `negativeControl` **只**由 `(graph, slice.proposedCut, slice.mustNotChange, slice.negativeControl)` 算出；`declaredPrediction` 与 `observed` **只**在最后装配对比段时被读，任何路径都不得写回计算字段。`computedDelta.inputsUsed` 要如实列出用了哪些输入。
2. **覆盖不足 fail-closed**：进入 moved-from 目录的边，其 `importedNames` 只被切法覆盖一部分时 → `not-evaluated` + reason 点名那条边与未覆盖的名字。**不按比例折算、不猜。** 没有 `importedNames` 的边同理。
3. **自校验**：按 Tarjan 从 `graph.edges` 重算 size>1 的 SCC，与 `graph.cycles` 做集合比对；不一致 → `not-evaluated`（reason 要点明是自校验失败）。`graph.cycles` 为空数组是合法的（无环），不得因此 not-evaluated。
4. **negative control 由机制强制**：`slice.negativeControl.restoreEdges` 缺失或为空 → `not-evaluated`。判据**相对 before-SCC**：`falsified = (sccLeft 非空) && (恢复后 SCC 成员集合恰好等于 before 成员集合)`。⛔ 不许用「subject 落在 size>1 的环里」当判据（关注点本来就可能停在剩余环里，那样会被一条无关边轻易满足）。
5. **must-not-change**：`forbiddenNewEdges` 只在「切法后存在、切法前不存在」时报 `violations`；`untouchedDirs` 的任一侧被切法碰到就报 violations。
6. **strengthened 而非静默丢弃**：切法产生的边若本来就存在，记入 `strengthenedEdges`（`effect: 'strengthens-existing-edge'`），并**注明强度增量算不出来**（目录级图不携带「符号→文件」定位）。同理，目录内不可见的消费者（同目录 import 变跨目录）只能由 `consumers` 声明，标 `source: 'declared-consumer'`。
7. **whyLeft 是算出来的**：对每个离开环的目录给 `leftBecause: 'own-in-edges-removed' | 'transitively-via'` 与 `via`（GOAL-033 的 `fan-in` 属于 latter，via `cli`）。
8. **退出码三态**（CLI 层）：`0` 已评估且护栏干净 / `1` 已评估但护栏被触发 / `2` 未评估。**⛔ 不产出 `pass`/`fail`/`exitCode` 这类字段名**——报告里用 `evaluated`/`not-evaluated` 与 `guards.clean`。

### 3. CLI 子命令

新增 `src/cli/commands/slice-delta.ts`，在 `src/cli/index.ts` 注册：

```bash
archguard slice-delta --slice <slice.json> [--root <dir>] [--scope <key>] \
                      [--arch <arch.json>] [--observed <observed.json>] [--json <out>] \
                      [--project-root <dir>]
```

- 图来源：`--arch <file>` 显式给了就用它；否则从 `<projectRoot>/.archguard/query/` 按 `--scope` 解析（沿用其它 MCP 工具用的同一套 scope/manifest 解析，别自己重写一套），解析不到就走 **not-evaluated（退出码 2）**，⛔ 不得静默退回空图。
- `provenance` 段：`analysis`（`workspaceRoot` / `timestamp` / 数据来源路径）、`slice`（声明里的 provenance 原样）、`observed`（或 null）、`tool`（**从 `package.json` 读 archguard 版本**——发布后这一项要能证明是哪个版本产出的）、`provenanceConsistency`（`match` / `mismatch` / `not-checked` 三态，`--root` 不是 git work tree 时如实报 `not-checked` 并给理由）。I/O 与 git 探测**只在这一层**。

### 4. MCP 工具

新增 `src/cli/mcp/tools/slice-delta-tool.ts`（AD​R-006 惯例：业务逻辑在 `src/analysis/slice-delta/`，工具是薄适配器），在 `src/cli/mcp/mcp-server.ts` 注册：

- 工具名 **`archguard_simulate_refactor_slice`**
- 入参：`projectRoot?`、`scope?`、`slice`（**对象**，不是文件路径）、`observed?`（对象，可选）
- 图从 scope 解析（与分析产物同一来源），解析不到返回 `isError` 并给出「先跑 `archguard analyze`」的可操作提示
- 返回报告 JSON 文本

### 5. 原型的处置

`docs/experiments/layer-map/slice-delta.mjs` 与其既有 17 个测试**保持不动**（冻结的参考实现，记录原型）。用 parity 测试锁住两者不漂移：同一 GOAL-033 fixture 下，库实现与实验脚本的 `computedDelta` / `negativeControl` / `sccAfter` 必须一致（实验脚本用子进程跑）。

**明确不做**：不删除实验脚本、不改 `check-layers.mjs` / `layers.yml`、不做 ownership 语义推断、不做自动 proposer、不替调用方选 slice、不做发布动作。

## AC

- [ ] `src/analysis/slice-delta/{types,simulate,index}.ts` 存在；`simulate.ts` 不 import `fs`/`path`/`child_process`（`grep -nE "node:(fs|path|child_process)|from 'fs'|from 'path'" src/analysis/slice-delta/simulate.ts` 无输出）
- [ ] `src/index.ts` 导出 `simulateRefactorSlice`；`npm run build` 后 `node -e "const m=require('./dist/index.js');console.log(typeof m.simulateRefactorSlice)"` 打印 `function`（**这是「发布产物可达」的机械证据**，不是读源码猜）
- [ ] `archguard slice-delta --help` 退出 0 并列出用法；对 GOAL-033 fixture（`tests/fixtures/slice-delta/goal-033-fork-point.arch.json` + `goal-033-slice.json`，`--arch` 显式给图）运行退出 0，报告 `current.sccSize===6`、`computedDelta.sccAfter` 恰为 4 员（`""`、`gate`、`gate/config`、`gate/factories`）、`sccLeft` 含 `cli` 与 `fan-in`、`removedEdges` 恰一条 `-> cli`、`addedEdges` 无任何 `-> fan-in`
- [ ] MCP 工具 `archguard_simulate_refactor_slice` 已注册（`grep -n archguard_simulate_refactor_slice src/cli/mcp/mcp-server.ts` 有输出），且有单测直接调用其 handler：给定 fixture 图 + GOAL-033 slice 得到 6→4；scope 解析不到时返回 isError 且提示可操作
- [ ] **退出码三态**：护栏干净→0；把 `restoreEdges` 换成无关边（`kernel -> ts-demo`）→`falsified=false` 且退出 **1**；让 `"" -> fan-in` 成为新边→`violations` 非空且退出 **1**；`negativeControl` 缺失→**2**；切法符号覆盖不全→**2** 且 reason 点名未覆盖的名字；篡改 `edges` 使重算 SCC 与 `cycles` 不一致→**2** 且 reason 说明是自校验失败
- [ ] **anti-stuffing（反向测试，逐字节）**：同一 `(graph, slice)` 下分别传 (a) observed=6→4、(b) 篡改 observed=999→1、(c) 不传 observed，三种情形 `JSON.stringify(report.computedDelta)` 与 `JSON.stringify(report.negativeControl)` **完全相同**；差异只允许出现在 `observedDelta` / `predictionComparison`
- [ ] **negative control 判据相对 before**：单测断言 `falsified` 为 `sccLeft 非空 && 恢复后成员集合 === before 成员集合`；另有一个「切法不改变 SCC（`sccLeft` 为空）」的合成用例 → `falsified === false` 且带 reason，**不得**因为「subject 在 size>1 环里」而误判为 true
- [ ] **parity 测试**：`tests/unit/analysis/slice-delta/` 下有一个用例以子进程运行 `docs/experiments/layer-map/slice-delta.mjs`，与库实现对同一 fixture 的输出比较 `computedDelta` / `negativeControl` / `sccAfter` 一致（两者分叉即红）
- [ ] `src/` 下没有任何文件 import `docs/experiments/**`（`grep -rn "docs/experiments" src/` 无输出）
- [ ] 报告里**没有** `pass`/`fail`/`exitCode` 字段名（递归扫描报告 key 断言）
- [ ] `provenance.tool.archguardVersion` 非空且等于 `package.json` 的 version；`provenance` 五段齐全（`analysis`/`slice`/`observed`/`tool`/`provenanceConsistency`）
- [ ] 提供面向消费者的稳定调用示例文档（库 API / CLI / MCP 三段，各含一段可直接复制的代码或命令），并说明「切法由调用方给出、ArchGuard 不选 slice」
- [ ] `docs/experiments/layer-map/README.md` 加一句指向新产品面（说明实验脚本已被 `archguard slice-delta` / `archguard_simulate_refactor_slice` 取代，保留为冻结参考）
- [ ] `npm test`、`npm run type-check`、`npm run lint` 通过（lint 不新增 error）

## DoD

不是「代码搬进 src/ + 测试绿」就算完成，必须证明：

1. **语义是迁移不是重写**——parity 测试是关键证据：库实现与冻结的实验脚本在同一输入上必须给出相同的 `computedDelta`/`negativeControl`/`sccAfter`。若实现中发现两者无法一致，**先停下来**判断是原型有洞还是迁移有误，不要改 parity 测试的容差去凑。
2. **发布产物真的可达**——AC 里 `npm run build` 后从 `dist/index.js` 取 `simulateRefactorSlice`、以及 CLI 从 `dist/cli/index.js` 跑通，是「消费者只依赖发布产物」的机械证明；只保证 `src/` 里有函数不算完成。
3. **fail-closed 语义一条都没丢**——逐条对照上面「必须原样迁移的语义」8 条，每条都有对应用例；特别是「覆盖不足不猜」与「自校验不一致即 not-evaluated」这两条最容易被顺手写成「尽力而为」，那正是本能力存在的理由。
4. **没有越过边界**——没有 ownership 语义推断、没有自动 proposer、没有替调用方选 slice、没有产出会被误读成机械门禁的 `pass`/`fail` 字段；也没有做任何发布动作（打 tag / publish / 推 master 都不在范围内）。
5. **没有把实验脚本改坏**——`docs/experiments/layer-map/slice-delta.mjs` 与其既有 17 个测试逐字节未被修改（`git diff` 核对）。

## Touches

- src/analysis/slice-delta/types.ts (new)
- src/analysis/slice-delta/simulate.ts (new)
- src/analysis/slice-delta/index.ts (new)
- src/index.ts
- src/cli/commands/slice-delta.ts (new)
- src/cli/index.ts
- src/cli/mcp/tools/slice-delta-tool.ts (new)
- src/cli/mcp/mcp-server.ts
- tests/unit/analysis/slice-delta/simulate.test.ts (new)
- tests/unit/analysis/slice-delta/parity.test.ts (new)
- tests/unit/analysis/slice-delta/cli.test.ts (new)
- tests/unit/cli/mcp/slice-delta-tool.test.ts (new)
- docs/user-guide/slice-delta.md (new)
- docs/experiments/layer-map/README.md
- tasks/gap-promote-slice-delta-to-product-surface.md
