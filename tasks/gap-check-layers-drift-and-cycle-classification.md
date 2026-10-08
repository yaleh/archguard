---
id: gap-check-layers-drift-and-cycle-classification
title: check-layers.mjs 新增两个确定性结构化分析模式：--before drift 分类 + --classify-cycles 环分类
status: done
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-a4-d1-semantic-review-skill
  - gap-a4-d1-single-tree-architecture-health-mode
---
## Proposal

Quay 新会话（"Quay 架构审查与 ArchGuard 能力评估"）实际用 `arch-layer-review` skill（已发布，v0.1.38）对 quay GOAL-030 做了一轮真实 before/after 验收，并对 archguard 自身做了 single-tree 体检，逐一反馈了 5 条能力改进候选（B1–B5）。本任务落地其中经 triage 判定为 genuine-gap / partially-covered 且和 `docs/experiments/layer-map/check-layers.mjs` 直接相关的两条（B1、B2），按"deterministic 能解决的就做 deterministic，LLM 只用于语义解释"的原则实现，延续 `docs/proposals/proposal-architecture-layer-check.md` 的 Phase D1，不另起替代 proposal。

**B1（declared-rule drift 分类，genuine-gap）**：Quay 真实撞到的案例——`packages/quay/src/gate/lifecycle.ts` 新增了对 `kernel/task-transition.ts` 的 value import，`check-layers.mjs` 在 after 树上从 `status=pass` 翻成 `status=fail`（新增 1 条未声明边）。这条边语义上是对的（gate 本该从 kernel re-export），只是 quay 的 `layers.yml` 草案没跟上——但 `check-layers.mjs` 目前只能告诉你"有新违例"，分不清"这条违例是这次改动刚引入的"还是"老早就存在没人声明过"，也分不清"实现改好了声明没跟上"和"实现真的退步了"。这个区分现在只能靠人工跑两次手动 diff。

**B2（同层环/双向 allowed 的结构性失明，partially-covered）**：`gap-a4-d1-single-tree-architecture-health-mode`（已 done）已经在 `arch-layer-review` skill 里加了"跨层环覆盖"和"同层环暴露"两个问题，但做法是**让 LLM 每次读原始 `moduleGraph.cycles` + `layers.yml` 自己判断**，不是确定性计算——quay 这次 dogfooding 里具体撞到两次这类同层环（`gate <-> gate/config <-> gate/factories`、`core-root <-> core-cli`），每次都要重新人工核对。既然"某环的成员是否全部同层"是纯集合运算，不需要 LLM，应该下沉成确定性字段。

## 设计（两个独立 CLI flag，互不依赖，可分别验收）

### `--before <before-arch.json>`（B1）

- **输入**：现有的两个定位参数（`<arch.json>` `<layers.yml>`）不变；新增可选 `--before <before-arch.json>`，指向另一份独立评估过的 package 级 ArchJSON。
- **输出**：JSON 报告新增 `driftReport` 字段（数组），仅在传了 `--before` 时出现；**不传该 flag 时输出必须与当前版本逐字节相同**（纯加法，不破坏任何现有调用方——本仓库自身、quay GOAL-030 两处已经在用这个脚本）。每条 `driftReport` 记录对应一条跨层边（无论是否违例），分类为三态之一：
  - `new-and-undeclared`：该边在 before 树的 moduleGraph 里不存在，在 after 树里出现，且不在 `layers.yml` 的 `allowed` 里——这是 quay 真实撞到的那类
  - `new-and-declared`：该边在 before 不存在、after 新出现，但在 `allowed` 里（良性新增，供对照）
  - `preexisting-and-undeclared`：该边在 before、after 都存在，且一直不在 `allowed` 里（不是这次改动引入的既有债务，不该被当成"这次改坏了"）
  - 每条记录带 `edge: {from, to}`、`classification`、`evidence: {beforePresent: boolean, afterPresent: boolean, declared: boolean}`

### `--classify-cycles`（B2）

- **输出**：JSON 报告新增 `cycleClassification` 字段（数组），仅在传了该 flag 时出现，同样不传时字节不变。对 `moduleGraph.cycles` 的每个环，输出 `{cycleId, members, layerMembership: string[], classification: "intra-layer" | "cross-layer-declared" | "cross-layer-undeclared"}`——`intra-layer` = 全部成员映射到同一层；`cross-layer-declared` = 跨层但该环内每一对相邻成员的方向都在 `allowed` 里；`cross-layer-undeclared` = 跨层且至少一对方向不在 `allowed` 里。
- 另外输出 `bidirectionalAllowedPairs`（数组）：`layers.yml` 的 `allowed` 里同时出现 `A -> B` 和 `B -> A` 的层对——这类声明本身就在说"这两层互相依赖是设计选择"，值得单独列出供人复核，而不是淹没在违例列表里。

## arch-layer-review 的消费方（语义层，B1/B2 共用）

- `plugin/skills/arch-layer-review/SKILL.md`（与 `.agents/skills/arch-layer-review/SKILL.md` 保持逐字节同步，这是上一个任务踩过的坑——两份必须同一次编辑产生）的 Step 1/3 更新：当 `--before`/`--classify-cycles` 可用时优先调用、引用其结构化输出作为 evidence，而不是让 LLM 从头手算。
- **不新增第 5 个 verdict 状态**（仍是 `converged`/`cosmetic`/`regressed`/`not-evaluated`，不proliferate 状态）：在相关 judgment 结论上新增一个**独立于 verdict 的标注字段** `declarationStatus: "current" | "stale" | "not-evaluated"` + `recommendedDeclarationUpdate: string | null`——`driftReport` 里出现 `new-and-undeclared` 且该边能被判断为"符合这次改动的声明意图"（比如 goal/acceptance-protocol 里写明了这是预期方向）时标 `stale` 并给出具体建议（如"把 'core-gate -> core-kernel' 加进 layers.yml 的 allowed"），不是笼统判 `regressed`；`preexisting-and-undeclared` 则标注"不是本次改动引入"，不归咎于当前这次变更。
- 新增 worked example（基于 quay GOAL-030 的真实案例，不是泛化占位）：`plugin/skills/arch-layer-review/references/goal-030-drift-and-stale-declaration-example.json`（同步 `.agents/skills/` 副本），体现 `gate/lifecycle.ts -> kernel/task-transition.ts` 这条真实边被正确分类为 `new-and-undeclared` + `declarationStatus: "stale"`。

## AC

- [x] `node docs/experiments/layer-map/check-layers.mjs <arch.json> <layers.yml>`（不传 `--before`/`--classify-cycles`）的输出与改动前逐字节相同——用改动前后各跑一次存量 fixture 做 diff 核对，证明纯加法
- [x] 合成 fixture：准备一对 before/after moduleGraph JSON，after 比 before 多一条未声明跨层边，`--before` 模式下该边必须落在 `driftReport` 的 `new-and-undeclared`；另一条 before/after 都有的未声明边必须落在 `preexisting-and-undeclared`；零新增边的 fixture 必须返回空 `driftReport` 数组，而不是省略该字段或报 pass
- [x] 合成 fixture：一个全部成员同层的环，`--classify-cycles` 下必须标 `intra-layer`，不能从 `cycleClassification` 里静默消失；一个双向都 `allowed` 的层对必须出现在 `bidirectionalAllowedPairs`
- [x] 用 quay GOAL-030 的真实材料复现：`packages/quay/src/gate/lifecycle.ts -> kernel/task-transition.ts` 这条边在 `--before` 模式下必须分类为 `new-and-undeclared`（需要 quay 仓库 goal 分支 fork 点与当前 tip 各一份 ArchJSON 快照，可以是本任务实现者自己跑出来存在 `/tmp`，不提交进 archguard 仓库）
- [x] `SKILL.md`（plugin + .agents 两份逐字节相同）新增消费 `--before`/`--classify-cycles` 的说明，且明确写出"不新增第5个verdict状态，`declarationStatus`是独立标注字段"这句等价表述
- [x] 新增 worked example JSON 存在、合法、`judgment.conclusions` 至少一条含 `declarationStatus: "stale"` 且 `recommendedDeclarationUpdate` 非空字符串，`evidence` 引用真实的 `gate/lifecycle.ts -> kernel/task-transition.ts` 边
- [x] `tests/unit/skills/arch-layer-review-skill.test.ts` 新增断言覆盖上述 example 的结构，且不破坏任何既有断言（`git diff` 核对原有测试用例文字未被改动，只新增）
- [x] `npm test`、`npm run type-check` 通过

## DoD

不是"脚本加了两个 flag + 测试绿"就算完成，必须证明：

1. **纯加法，零行为回归**：两个新 flag 都是可选的，省略时行为与现状字节级相同；这条由 AC 第一项的真实 diff 核对，不是读代码猜测。
2. **drift 分类不是靠字符串匹配猜出来的，是真的比较两份独立的边集合**——`new-and-undeclared` vs `preexisting-and-undeclared` 的判定必须真的读了 before 树的 `moduleGraph.edges`，不能用启发式（比如"文件修改时间"之类）代替。
3. **quay GOAL-030 真实案例复现**：不能只用合成 fixture 交差，AC 里专门要求用 quay 仓库的真实 before/after 快照验证那条真实边被正确分类——这是本任务存在的原始理由，合成 fixture 只是补充的正反对照，不能替代真实复现。
4. **declarationStatus 不喧宾夺主**：通读改动后的 `SKILL.md`，确认 `declarationStatus` 读起来是对 `verdict` 的补充说明，不会让人误以为它是另一套独立的判定结果——如果实现中发现很难不引入歧义，先停下来，不要为了交差硬塞一个混乱的字段。

## Touches

- docs/experiments/layer-map/check-layers.mjs
- plugin/skills/arch-layer-review/SKILL.md
- .agents/skills/arch-layer-review/SKILL.md
- plugin/skills/arch-layer-review/references/goal-030-drift-and-stale-declaration-example.json
- .agents/skills/arch-layer-review/references/goal-030-drift-and-stale-declaration-example.json
- tests/unit/skills/arch-layer-review-skill.test.ts
- tasks/gap-check-layers-drift-and-cycle-classification.md
