---
id: gap-a4-d1-semantic-review-skill
title: A4 Phase D1：实现 arch-layer-review 语义架构 review MVP skill（薄语义层，不新增
  deterministic gate）
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`docs/proposals/proposal-architecture-layer-check.md`（A4，Approved v2）已在 2026-10-08 追加「Phase D1 — Semantic Architecture Review」一节（见该文件「### 6. Phase D1」及「分阶段」表格新增的 D1 行），裁定 D1 是**阶段 0–4 之上的附加层，不替代、不阻塞、不依赖阶段 2–4 尚未裁定的入口形态**——D1 直接消费已落地的 `extensions.tsAnalysis.moduleGraph` 和既有原型 `docs/experiments/layer-map/check-layers.mjs`（原样调用，不改）。

本任务落地 D1 的 MVP：一个纯编排型 Claude Code skill（无新增确定性检查代码，无新 CLI/MCP 工具），遵循本仓库 `project-semantics-discovery`/`cognitive-analysis` 两个既有 skill 的同构惯例（`.claude/skills/<name>/SKILL.md` + 结构化 example + 对应单测，`project-semantics-discovery` 也是零新增脚本的纯 prompt 编排 skill）。

**MVP 范围（只做这四类判断，proposal 原文「MVP 范围」一节逐字对应）**：
1. ownership 是否收敛（职责的决策+执行是否只在声明的那一层有一份实现）
2. 职责是否从错误层迁移到正确层（旧层是否真的不再保留一份"看起来没用但还在被调用"的实现）
3. orchestrator 是否仍直接持有 domain state（驱动/编排层是否还在自己做"读状态判断写状态"三件事）
4. 结构变化是否只是搬文件/换壳（新模块是否反向 import 回旧实现的底层原语）

**明确 NOT in MVP**（proposal 原文同一节）：完整 DDD 建模、OOD 评审、架构风格诊断、全局系统设计评分。

**三层物理分区**（proposal「三层区分」表）：机械事实（ArchGuard 的 moduleGraph/cycles/metrics 原始读数）/ declared architecture rules（`layers.yml` + `check-layers.mjs` 的 pass/fail/not-evaluated，裁决权仍在这一层）/ LLM semantic interpretation（D1 的输出，四态判断 + evidence 引用，**不是 gate**，不产生新退出码）。三层在 skill 的输出契约里必须各自独立成段，不能合并展示。

**首个真实验收案例**：quay GOAL-030（promotion driver 状态写入收敛到 kernel transition decision）。proposal 「Phase D1 的首个真实案例」一节已写明三个具体陷阱（搬壳不搬心 / 只改一侧形成第三套实现 / 接口形状不变导致边界未清晰）和对应的输出骨架——本任务要求的 example 输出必须真实体现这三个陷阱的判断结构，不是泛化占位 JSON。

<!-- dedup-ref -->
与 `gap-a4-architecture-layer-check-proposal-review`（已 done，范围评审本身）、`gap-verify-module-graph-edge-completeness`/`gap-ts-module-graph-type-only-edge-split` 等阶段 0/0.5/1 任务（均已 done，是 D1 的事实层前提）不是同一机制：那些任务做的是"让 moduleGraph 边集合完整/可信"，本任务做的是"在已经可信的 moduleGraph 之上加一层 LLM 语义判断"，两者是层叠关系不是重复。

## AC

- [ ] `.claude/skills/arch-layer-review/SKILL.md` 存在，且其 frontmatter 含非空 `name`/`description` 字段（与 `cognitive-analysis`/`project-semantics-discovery` 同构）——用 `node -e "require('fs').readFileSync('.claude/skills/arch-layer-review/SKILL.md','utf8')"` 读取后人工/脚本核对 frontmatter 字段非空
- [ ] `SKILL.md` 正文同时出现以下关键词（grep 可核对）：`check-layers.mjs`（声明原样复用、不新增确定性检查器）、`moduleGraph`、`not-evaluated`、`evidence`、以下四个判断主题逐一出现——"ownership"、"orchestrator"、"domain state"、"搬壳"或"搬文件"——以及 NOT-in-MVP 排除项关键词：`DDD`、`OOD`、`架构风格`、`评分`
- [ ] 提供 `.claude/skills/arch-layer-review/references/goal-030-example-output.json`：合法 JSON，顶层字段至少含 `facts`、`declaredRules`、`judgment` 三个 key（对应三层物理分区），`judgment` 下每条结论对象都含非空 `evidence` 数组
- [ ] 上一条 example JSON 中，对 JSON 文本做字符串扫描，**不得**出现 `"exitCode"`、`"pass":` 或 `"fail":` 这三类会被误读成确定性 gate 退出码/布尔判定的字段写法（防止语义判断伪装成机械 PASS/FAIL；允许出现在自由文本叙述里，但不能作为 JSON 字段名/值出现在 `judgment` 节点下）
- [ ] example JSON 的 `judgment` 节点覆盖 proposal "Phase D1 的首个真实案例" 一节列出的三个陷阱（搬壳不搬心 / 第三套实现 / 接口形状未变），每个陷阱有独立的 `trapChecklist` 式条目（命中/未命中 + 理由）
- [ ] 新增 `tests/unit/skills/arch-layer-review-skill.test.ts`：至少覆盖——(a) SKILL.md 与 example JSON 文件存在；(b) example JSON 可解析且满足上面"三个顶层 key + evidence 非空"的结构断言；(c) example JSON 不含 `exitCode`/`pass`/`fail` 字段名（用 `JSON.stringify` 后的字符串匹配或递归 key 扫描）；(d) SKILL.md 文本包含上面列出的关键词断言
- [ ] `npm test`（或该测试文件的 scoped 等效命令）全绿，`npm run type-check` 通过

## DoD

不是"文件写出来 + 测试绿"就算完成。必须额外证明：

1. **没有引入新的确定性 gate**：通读 `SKILL.md` 全文和 example JSON，确认整个 skill 的输出契约里不存在任何会被下游（人或自动化）误当成机械判定依据的字段/退出码——这条不是靠关键词扫描能完全替代的，需要读一遍确认"四态判断"读起来确实是建议性叙述而不是伪装的 pass/fail。
2. **example 输出是真实的语义判断，不是占位填空**：三个陷阱各自的 `evidence` 字段必须能对应回 proposal 原文或本次会话已经做过的 GOAL-030 before 基线里的具体读数（例如 `plugin/scripts -> packages/quay/src/kernel` 的边强度、`gate -> kernel` 边是否存在、`LIFECYCLE_EDGES` 的定义处是否唯一），不能是"ownership looks fine"这类空洞描述。
3. **`SKILL.md` 明确声明它不改变 `check-layers.mjs` 的裁决权**——即 declared rules 层的 pass/fail/not-evaluated 结果仍然只能由 `check-layers.mjs` 产出，D1 的 skill 只读取、引用该结果，不重新计算、不覆盖。
4. 若实施过程中发现"需要新写一个确定性检查脚本才能回答某个判断"，先停下来判断这是否越过了"D1 不新增 gate"的边界（多半意味着那个判断本该留给未来的阶段 2–4，而不是塞进 D1），不要顺手加确定性代码到这个任务里。

## Touches

- .claude/skills/arch-layer-review/SKILL.md (new)
- .claude/skills/arch-layer-review/references/goal-030-example-output.json (new)
- tests/unit/skills/arch-layer-review-skill.test.ts (new)
- tasks/gap-a4-d1-semantic-review-skill.md
