---
id: gap-refactor-slice-expected-delta-prototype
title: Refactor Slice / Expected Delta 极小原型：显式切法 → 确定性预期 delta + 负对照（GOAL-033
  为唯一 dogfood，predicted/observed 物理分区）
status: done
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Quay GOAL-030~033 的真实重构经验暴露一个缺口：ArchGuard 现在能报"有哪些边、哪些目录在同一个 SCC"，但答不了"**如果做这一刀，预期的 architecture delta 是什么**"。GOAL-033 是最典型的例子——goal 正文与 AC-351 写下的预测是 package SCC **6 → 5**（"其余五员不动"），实测是 **6 → 4**，因为 `fan-in` 在环内的唯一入边就是 `cli -> fan-in`，删掉 `"" -> cli` 之后 `cli` 入环归零，`fan-in` 只经 `cli` 入环而随之一起离开。这个结构性事实**在动手之前用图就能算出来**，却被手写预测漏掉；GOAL-033 自己的证据文件 `.quay/goal-033-evidence/archguard-before-after.json` 的 `analysisNote` 已自认 "AC-351's `rest` expectation (with fan-in) is falsified"。

本任务落地一个**极小的确定性原型**：对**外部显式给出**的切法，计算并验证预期 delta，为 Quay/meta-driver 提供候选输入。延续 `docs/proposals/proposal-architecture-layer-check.md` 的 Phase D1 与"机械事实 / declared rules / LLM 语义"三层分区，**不另起替代 proposal**，只做增量补充。

**严格边界（本任务的核心约束，越界即停止）**：

- deterministic core **只**做事实计算与 delta 验证；**不**实现 ownership 语义推断，**不**实现自动 proposer，**不**把 ArchGuard 做成 manager agent——输出是"做这刀会怎样"的结构化事实，不是"该不该做这刀"的建议或排序。
- proposed cut 由**显式输入**提供（fixture / explicit input），ArchGuard **不发明方案**。
- **predicted 与 observed 物理分区**：`declaredPrediction`（人写，原样保留）、`computedDelta`（ArchGuard 在本图上重算）、`observedDelta`（外部后验读数，经**独立**的 `--observed` 文件传入）三者互不回灌。observed 只在最后装配对比段时被读取，**不参与任何计算**——这条由一个专门的反向测试（AC 第 4 项）机械保证，不靠约定。
- **至少一个 negative control**：恢复关键边后判据必须可证伪。输入里没有 negative control 时直接报 `not-evaluated`，不给"看起来没问题"。
- **不修改** `check-layers.mjs`，不碰 declared-rules 层的裁决权（本原型的输出**不是** gate，不进 CI 机械门）。
- 不新增 Goal；只此一个 task。

## 设计

入口：`docs/experiments/layer-map/slice-delta.mjs`（与既有 `check-layers.mjs` 并列的实验原型；独立脚本而不是给 `check-layers.mjs` 加第三个 flag，理由：`check-layers.mjs` 的退出码是 declared-rules 层的权威裁决，把"模拟一个假想的未来树"塞进同一个脚本会模糊 proposal 费力建立的三层边界，而独立脚本对既有裁决权是零风险）。

用法与退出码：

```bash
node docs/experiments/layer-map/slice-delta.mjs <current.arch.json> \
  --slice <slice.json> [--observed <observed.json>] [--json <out.json>]
# 0 = 已评估且护栏通过 | 1 = 已评估但护栏被触发 | 2 = 未评估
```

`<current.arch.json>` 是 package 级 ArchJSON（消费 `extensions.tsAnalysis.moduleGraph`）。`slice.json` 是显式输入：

```json
{
  "subject": "",                                  // 关注点所在的目录节点
  "concern": "core-root ⇄ core-cli 目录级依赖环",
  "provenance": { "repo": "...", "ref": "...", "commit": "...", "worktree": "..." },
  "proposedCut": {
    "moves": [ { "file": "cli/driver.ts", "from": "cli", "to": "",
                 "symbols": ["runDriver", "runDriverAsync", "resolveDriverInvocation", "DriverRunResult"] } ],
    "consumers": [ { "file": "serve-sessions.ts", "dir": "", "imports": ["runDriver"] } ]
  },
  "declaredPrediction": { "sccSize": 5, "sccMembers": ["","fan-in","gate","gate/config","gate/factories"], "source": "GOAL-033 正文 / AC-351（人写）" },
  "mustNotChange": { "forbiddenNewEdges": [{"from": "", "to": "fan-in"}], "untouchedDirs": ["gate","gate/config","gate/factories","kernel"] },
  "negativeControl": { "description": "...", "restoreEdges": [{"from": "", "to": "cli"}] }
}
```

**模拟规则（全部是图上的集合运算，用的是 ArchGuard 真有的字段 `importedNames`，不是被喂答案）**：目录级图里"这条边为什么会消失"不能靠人写"删掉 `-> cli`"，而要由图自己判断。对每条进入 moved-from 目录 B 的内部边 `A -> B`：取其 `importedNames`，若这些名字**全部**被声明从 B 搬走的符号覆盖，则该边被这次搬迁完整解释——`A === 目的地目录` 时它退化成目录内边（**removed**），否则它是被改指（**removed + added** `A -> 目的地`）。若只覆盖了一部分，本原型**无法**在目录粒度上对账，报 `not-evaluated`（不猜、不按比例折算）。`consumers` 里目录内可见的声明消费者与图上对账；目录内不可见的（同目录 import 搬走后会变成新的跨目录边）按其声明记入 `addedEdges` 并标 `source: "declared-consumer"`，如实标注这是**声明**而非图推断。

**自校验**：脚本自己按 Tarjan 从 `mg.edges` 重算全部 size>1 的 SCC，与 `mg.cycles` 做集合级比对；不一致即 `not-evaluated`（在这张图上不可信的模拟一律不出结论）。

输出报告字段（覆盖任务要求的最小集）：`status`、`subject`、`concern`、`provenance`（analysis / slice / observed / tool / `provenanceConsistency`）、`current`（`sccMembers`/`sccSize`/相关边/`subjectFanIn`）、`proposedCut`、`affectedConsumers`、`computedDelta`（`removedEdges`/`addedEdges`/`sccBefore`/`sccAfter`/`sccLeft`/`sccRemaining`/`subjectFanInAfter`）、`mustNotChange`、`negativeControl`、`declaredPrediction`、`observedDelta`、`predictionComparison`。

**唯一 dogfood case = quay GOAL-033**：本任务不泛化。fixture 是 fork point 真实子树（`git rev-parse 1ac06fd85094a58d4954640811a787873f8ad2a1:packages/quay/src` = `5213eb614130bf9f8ade9e38b46da7e60fb1c536`，与 GOAL-033 证据文件记录的 `treeSha` 一致）由 ArchGuard 单根分析（`sources:["packages/quay/src"]`）得到的真实 package 级 ArchJSON，随任务提交进 `tests/fixtures/`，使 dogfood 可离线复现、不依赖 quay 的 `.archguard/query/` 偶然残留（那些 scope 目录会被 `cache prune-scopes` 清掉）。**回归的定论点是 before 图 + 显式切法能够算出观测到的 6 → 4**，观测值单独作为 `--observed` 传入，不参与计算。

## AC

- [x] `docs/experiments/layer-map/slice-delta.mjs` 存在；无参数调用时打印用法并以退出码 2 结束（不是抛异常崩溃）
- [x] 用 quay GOAL-033 的真实 fixture（`tests/fixtures/slice-delta/goal-033-fork-point.arch.json` + `goal-033-slice.json`）运行：`current.sccSize === 6` 且成员含 `""`、`cli`、`fan-in`；`computedDelta.sccAfter` 恰为 4 员（`""`、`gate`、`gate/config`、`gate/factories`，**不含** `cli`、**不含** `fan-in`）；`computedDelta.removedEdges` 恰有一条 `-> cli`；`addedEdges` 里没有任何 `-> fan-in` 边
- [x] **predicted 6→5 与 observed 6→4 被区分**：slice 里 `declaredPrediction.sccSize=5` 时，报告里 `declaredPrediction` 原样是 5、`computedDelta.sccAfter` 是 4、`predictionComparison.declaredVsComputed` 标不与预期一致；`--observed goal-033-observed.json`（6→4）时 `observedDelta` 原样保留且与 `computedDelta` 判为一致
- [x] **防倒灌（机械反向测试）**：同一 `<current.arch.json>` + 同一 `slice.json`，分别传 (a) observed = 6→4、(b) observed = 999→1 的篡改文件、(c) 完全不传 `--observed`，三种情形下 `computedDelta` 与 `negativeControl` 两个段的 `JSON.stringify` 结果**逐字节相同**；差异只允许出现在 `observedDelta`/`predictionComparison` 里
- [x] **negative control 可证伪**：GOAL-033 输入下 `negativeControl.subjectBackInScc === true`、`falsified === true`；把 `restoreEdges` 换成一条与关注点无关的边（如 `kernel -> ts-demo`）时 `falsified === false` 且进程退出码为 1
- [x] **must-not-change 可触发**：构造一份切法会让 `"" -> fan-in` 新出现的输入，`mustNotChange.violations` 非空且退出码为 1
- [x] **自校验失败降级**：从 fixture 的 `mg.edges` 里删掉一条构成环的边使重算 SCC 与 `mg.cycles` 不一致 → `status === "not-evaluated"`、退出码 2、reason 里点明是自校验失败（不是静默出一份看着合理的报告）
- [x] **覆盖不足不猜**：构造一条进入 moved-from 目录、但 `importedNames` 只被切法覆盖一部分的边 → `status === "not-evaluated"`、退出码 2，reason 点名那条边与未覆盖的名字
- [x] `provenance` 段含：`analysis`（`workspaceRoot`、`timestamp`）、`slice`（声明的 `repo`/`ref`/`commit`/`worktree` 原样）、`tool`（本仓库 `package.json` 的 archguard 版本 + 脚本相对路径）、`observed`（或 null）、以及 `provenanceConsistency`（`match`/`mismatch`/`not-checked` 三态——`workspaceRoot` 不是 git work tree 时如实报 `not-checked` 并给理由）
- [x] 没有 negative control（`negativeControl.restoreEdges` 缺失或为空）时 `status === "not-evaluated"`、退出码 2——"至少一个负对照"由机制强制，不靠人记得
- [x] `tests/unit/architecture/slice-delta.test.ts` 存在并覆盖上述各项（含防倒灌的逐字节断言）；`npm test` 与 `npm run type-check` 通过
- [x] `docs/proposals/proposal-architecture-layer-check.md` 增补一节（**纯追加**，不改既有 D1 文字），说明该原型的输入/输出/退出码与"不是 gate、不发明方案、不改 `check-layers.mjs` 裁决权"的边界；`git diff` 核对只有新增
- [x] `docs/experiments/layer-map/README.md` 增补该脚本的用法与边界说明

## DoD

不是"脚本能跑 + 测试绿"就算完成，必须证明：

1. **computedDelta 是被算出来的，不是被喂出来的**——切法输入里**没有**任何形如"删掉 A -> B"的边级指令；只有文件搬迁意图与符号名。对账必须真的用 `importedNames` 做集合判定。读一遍 `slice-delta.mjs` 确认没有任何一条路径把 `declaredPrediction` 或 `observed` 的值写进 `computedDelta`（AC 第 4 项的逐字节反向测试是这条的机械证据，不是替代品）。
2. **GOAL-033 的 6 → 4 是本原型算出来的，且能解释预测为什么错**——报告要能指出 `fan-in` 离开的原因（它的唯一入边是 `cli -> fan-in`），并且这个解释来自**重算可达性**，不是照抄证据文件的 `whyFanInAlsoLeft` 文字。若实现中发现算不出 4 只能算出 5，**停下来**：那说明本原型的模拟规则有洞，不要改 fixture 或改断言去凑答案，如实报 `not-evaluated` 并记录原因。
3. **predicted / observed / declared 三者物理分离**——通读报告结构，确认 `declaredPrediction`（人写的 6→5）在报告里没有被"修正"成 4、`observedDelta` 也没有被用来回填任何计算字段；`predictionComparison` 读起来是"三个独立读数之间的对比"，而不是"ArchGuard 判定谁对谁错"。
4. **没有越过 manager agent 的边界**——通读输出，确认没有"建议做这刀/不建议"、没有方案排序、没有优先级、没有自动生成的切法；`proposedCut` 段是输入的回显 + 可对账性检查。如果实现中觉得"顺手可以推荐一个更好的切法"，那是另一个 task 的事，本任务不做。
5. **没有碰 declared-rules 层的裁决权**——`git diff` 证明 `check-layers.mjs` 与 `layers.yml` 逐字节未改；本脚本不产出 `pass`/`fail` 这类会被误读成 gate 的字段名（用 `evaluated`/`not-evaluated` 与护栏 `violations` 表述）。

## Touches

- docs/experiments/layer-map/slice-delta.mjs (new)
- docs/experiments/layer-map/README.md
- docs/proposals/proposal-architecture-layer-check.md
- tests/fixtures/slice-delta/goal-033-fork-point.arch.json (new)
- tests/fixtures/slice-delta/goal-033-slice.json (new)
- tests/fixtures/slice-delta/goal-033-observed.json (new)
- tests/fixtures/slice-delta/synthetic-small.arch.json (new)
- tests/unit/architecture/slice-delta.test.ts (new)
- tasks/gap-refactor-slice-expected-delta-prototype.md
