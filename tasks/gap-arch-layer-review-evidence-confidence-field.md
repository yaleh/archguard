---
id: gap-arch-layer-review-evidence-confidence-field
title: arch-layer-review 的 judgment evidence 加 confidence/caveat 字段，不让低置信度证据悄悄混进结论
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-a4-d1-semantic-review-skill
---
## Proposal

Quay 的"Quay 架构审查与 ArchGuard 能力评估"会话用 `arch-layer-review` skill（v0.1.38）做了一轮真实 single-tree 体检后反馈：自己手动记得要给 `get_cluster_boundary` 的某条证据加一句"该工具自报 `silhouetteScore=0.037`，置信度低"的提示，但 skill 当前的输出契约（`plugin/skills/arch-layer-review/SKILL.md` 的"Output contract"一节）里没有任何字段**强制**这类提示必须随证据走——换一个人跑同一个 case，很可能漏掉这句话，证据的真实强度就悄悄从报告里消失了。triage 结论：genuine-gap，完全是 `arch-layer-review` 自己的输出契约缺口，没有任何已有任务/proposal 提过。

本任务按对方自己评估的最小范围落地：**只改 skill 的输出契约文档 + worked example，不写新代码**（与 B1/B2 那个任务不同，这个缺口不涉及 `check-layers.mjs`，纯粹是 `arch-layer-review` 自己 judgment 结构的事）。延续 `docs/proposals/proposal-architecture-layer-check.md` 的 Phase D1，不另起 proposal。

## 设计

- `plugin/skills/arch-layer-review/SKILL.md`（与 `.agents/skills/arch-layer-review/SKILL.md` 保持逐字节同步，同一次编辑产生）的"Output contract"一节，给 `judgment.conclusions[].evidence[]` 的每一条证据项新增**必填**字段 `confidence`：
  ```
  confidence: {
    source: "deterministic" | "proxy-metric" | "single-reading" | "corroborated-by-2-methods",
    caveat: string | null
  }
  ```
  - `deterministic`：直接读自 ArchGuard 机械输出或 `check-layers.mjs` 的确定性判定（如一条 moduleGraph 边、一次 `pass`/`fail` 结果）——`caveat` 通常为 `null`
  - `proxy-metric`：引用的是一个代理指标，不是对目标问题的直接度量（如用 `silhouetteScore` 代表"分组是否合理"，但该指标本身有已知局限）——`caveat` **必填非空**，写明局限是什么
  - `single-reading`：只有一次读数，没有交叉验证（比如只在一个环境上跑过一次）
  - `corroborated-by-2-methods`：至少两种独立方法/数据源互相印证（如目录级边 + 独立 grep 对账都指向同一结论）
  - 规则：当某个 MCP 工具/底层数据源自己声明了置信度警告（如 `silhouetteScore` 之类的自报指标、或任何工具输出里包含"低置信度"/"low confidence"/"heuristic"字样），引用它作为证据时 `caveat` **必须非空**且复述该警告，不能悄悄吞掉。
- 更新两份既有 worked example（`goal-030-example-output.json`、`archguard-selfreview-example-output.json`，plugin + .agents 各一份，共 4 个文件）：每条现有 evidence 补上 `confidence` 字段——`goal-030` 案例里引用的那些 moduleGraph 边读数都是 `deterministic`；若 `archguard-selfreview` 案例里有引用过代理指标/单次读数的证据，相应标注；若两份 example 里都没有天然的"低置信度"场景，额外补一条**新的** conclusion（或扩展现有一条）体现 `proxy-metric` + 非空 `caveat` 的真实用法，不能让这个分支永远测不到。

## AC

- [ ] `plugin/skills/arch-layer-review/SKILL.md` 的"Output contract"一节包含 `confidence` 字段定义，四个 `source` 枚举值全部出现在文本里（grep 可核对：`deterministic`、`proxy-metric`、`single-reading`、`corroborated-by-2-methods`）
- [ ] 文本明确写出"工具自报低置信度时 caveat 必填"这条规则的等价表述（grep `caveat`/"必填"或"required"类关键词）
- [ ] 两份既有 example JSON（plugin + .agents 共 4 个文件，两两逐字节相同）的**每一条** `judgment.conclusions[].evidence[]` 对象都带非空 `confidence.source`（合法枚举值之一）
- [ ] 至少一条 evidence 的 `confidence.source` 是 `proxy-metric` 或 `single-reading`，且其 `caveat` 为非空字符串（真实体现"低置信度被标注"这个场景，不能全是 `deterministic`/`null` 糊弄过去）
- [ ] `tests/unit/skills/arch-layer-review-skill.test.ts` 新增断言：对两份 example 递归扫描所有 evidence 对象，要求 `confidence` 字段存在且 `source` 是四个合法值之一；再新增一条断言专门核对"至少一条 `caveat` 非空"这个场景确实被覆盖了；不得修改任何既有断言的文字
- [ ] `npm test`、`npm run type-check` 通过

## DoD

不是"文档加了字段定义、JSON 补了属性"就算完成，必须证明：

1. **不是形式主义补字段**——挑一条真实加了 `proxy-metric`/`caveat` 的 evidence，读一遍确认那句 caveat 文字本身有信息量（点出具体局限是什么），不是"置信度较低"这种空话。
2. **四份文件（SKILL.md 两份、example JSON 各两份共四份）两两保持同步**——用 `diff` 核对 plugin/ 与 .agents/ 的对应文件逐字节相同，这是上一个任务已经踩过一次的坑，本任务必须亲自核对，不能假设工具自动做到。
3. **没有改动既有判断逻辑**——这是纯粹的"结构要求"（字段必须存在），不要求实现者重新判断每条证据的置信度打分准不准；如果发现某条既有证据的置信度分类有争议，按最保守的（更低置信度）标注，而不是停下来重新论证整个判断。

## Touches

- plugin/skills/arch-layer-review/SKILL.md
- .agents/skills/arch-layer-review/SKILL.md
- plugin/skills/arch-layer-review/references/goal-030-example-output.json
- .agents/skills/arch-layer-review/references/goal-030-example-output.json
- plugin/skills/arch-layer-review/references/archguard-selfreview-example-output.json
- .agents/skills/arch-layer-review/references/archguard-selfreview-example-output.json
- tests/unit/skills/arch-layer-review-skill.test.ts
- tasks/gap-arch-layer-review-evidence-confidence-field.md
