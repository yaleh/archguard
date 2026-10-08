# Proposal: 分层声明 + 确定性方向检查 + 多层架构展示（A4）

**状态**: Approved v2（2026-10-03 人审通过，范围见「评审裁定」；阶段 2–4 的入口形态待 fitness 死桩修复后裁定）+ **Phase D1 追加**（2026-10-08，语义架构 review，附加阶段，见「Phase D1」；不改变本提案确定性内核的裁决权，不是对 Approved v2 范围的替代）
**日期**: 2026-10-03（Phase D1 追加于 2026-10-08）
**关联**: `docs/experiments/layer-map/`（外部原型，提交 2a75651e）、`docs/user-guide/architecture-checking-scenarios.md`（"Limits" 一节明确写了目前没有一等的规则检查）
**来源**: archguard 自身的分层实测；quay 项目架构审查提出的 A4/B8 需求；会话「archguard 架构语义映射」的原型实测；quay GOAL-030（promotion driver 状态写入收敛到 kernel transition decision）的真实验收需求驱动了 Phase D1

---

## 评审裁定（2026-10-03）

人审结论（任务 `gap-a4-architecture-layer-check-proposal-review`）：

1. **范围与非目标**：**批准**，按原文范围。目标 1–6 与非目标（不纳入运行时耦合 A3、不重引 PlantUML、不让 LLM 判定违例、不跨 scope 补边）照单通过。
2. **实现入口形态**：**延后裁定**。先修既有 fitness 引擎的死桩——`gap-fitness-check-relations-stub`（`src/cli/commands/check.ts:59` 硬编码空 `relations`，`no-dependency` 规则永不生效）与同类缺陷 `gap-query-cycles-ignores-output-scope-package`（CLI `query --cycles` 忽略 `--output-scope`）——看到 fitness 引擎真实能力后，再定"复用扩展 `check`"还是"独立 `check-layers` 子命令"。
3. **层声明与 `architecturalLayers` 的关系**：采用**方案 1 —— 层声明为唯一正本，`architecturalLayers` 降为派生投影**。人手只写层声明；analyze 时按每个包目录对 `globs` 最长匹配，投影出 `architecturalLayers` 注入 `ArchJSON.extensions.projectSemantics`；渲染器（`generator.ts` / `ts-module-graph-renderer.ts`）**不改**；无层声明文件时现有行为不变。`project-semantics-discovery` 的产出形状随之改为「起草层声明」。
4. **分阶段起点**：先补阶段 0/1 验收 `gap-verify-module-graph-edge-completeness`（用独立的位置判定扫描对账 moduleGraph 边集合完整性与 type-only/值拆分），再进阶段 2。

**开放问题处置**（随裁定 1 一并通过）：

| # | 处置 |
|---|---|
| 1 边集合变化会改变现有数字 | 接受；由 `gap-verify-module-graph-edge-completeness` 覆盖 |
| 2 层声明的维护成本 | 接受，已由 `not-evaluated` 设计覆盖 |
| 3 多语言 | 接受，v1 只做 TS |
| 4 `architecturalLayers` 与层声明的关系 | 见裁定 3（方案 1） |
| 5 展示粒度 | 接受；阶段 3 的 AC 必须包含**浏览器目视验证**（原型仅做过字符串层验证） |
| 6 quay 的 A1/A2 | 接受，各自单独提案，排在本提案之后 |

**评审修订（相对 Draft v1）**：

- 原文称 ArchGuard「没有一等的架构规则检查」**不准确**：`archguard check` + `fitness.rules` 已有一等规则引擎（`src/analysis/fitness/`），含 `type: 'no-dependency'` 的 from/to 约束规则。真正缺的是 allowlist/分层语义、层声明载体、棘轮基线、三态、type-only 拆分与展示。修订后的表述见「背景与动机」。
- 原文以「`detect_cycles(package)` 返回 `[]`」为动机**已过时**：该缺陷已修（`src/core/query/query-engine.ts:153` 的 `getPackageCycles()`，MCP `detect_cycles(outputScope=package)` 现在能看见目录级环）。当前树实测有 4 个目录级 SCC（size 13/10/2/2）。修订后的动机是：**SCC 看得见环，但看不见单向的禁止方向**——"controller 不得直接调 repository"这类约束不是环。CLI `query --cycles` 侧仍忽略 `--output-scope`（见裁定 2 的第二个任务）。

---

## 背景与动机

`architecture-checking-scenarios.md` 的 Limits 一节写明：ArchGuard 擅长结构观察（实体、关系、依赖形状、scope 摘要），但**没有**"package A 只能依赖 package B"这类规则检查，只能靠 query 流程近似。

**修订（2026-10-03，见「评审修订」）**：`archguard check` 事实上已有一等的规则引擎（`fitness.rules`，含 `no-dependency` 的 from/to 约束规则），但它的依赖方向规则当前是**死桩**（`check.ts` 硬编码空 `relations`，永不生效），且只有 denylist，没有分层/allowlist/棘轮/三态。准确的说法是：**引擎骨架在，能力不在**。

2026-10-02 起的两次独立实验（archguard 自身、quay 项目）表明，"声明层 → 确定性检查 → 单页展示"这条流程可以跑通，并且能发现 ArchGuard 现有工具看不见的问题：

- archguard 自身：按 CLAUDE.md 的分层声明检查出 5 条方向违例（其中 3 条只是类型放错层，2 条是 `plugins/shared` 与 core/parser 互指），已分别立任务并完成/裁定。当时目录级存在一个 27 目录的大环，而 `detect_cycles(package)` 返回 `[]`——该缺陷此后已修（见「评审修订」），但**环 ≠ 方向**：单向的禁止方向，SCC 永远看不见。
- quay：目录级互指（`gate ↔ gate/config`、`src ↔ src/cli`）在当时的 `detect_cycles(package)` 下同样是 `[]`。

这些问题靠 grep 或人眼很难稳定发现，也很容易出错：quay 会话曾因**关键词 grep 把注释当 import** 报出 4 条假违例后撤回。需要一个**按位置判定、结果三态、可固化为基线**的内置能力。

## 目标

1. 一份由人审定的**层声明文件**（glob → 层、允许/禁止的依赖方向、已知违例基线），作为"层映射"的唯一正本。
2. 一个**确定性**（不含 LLM）的检查器：输入 ArchGuard 产出的目录级依赖图 + 层声明，输出 **pass / fail / not-evaluated** 三态结果。
3. 对违例边区分 **type-only 与值依赖**。
4. 支持**棘轮基线**：已知违例只许减不许增；基线里已消除的项要提示可删除。
5. 输出**单页展示**（分层框图 + 违例表 + 覆盖缺口），以及可被 CI 使用的退出码和 JSON。
6. 一个**编排型 skill**，引导"分析 → 起草层声明 → 人审 → 检查 → 展示"的完整流程。

## 非目标

- 不做运行时/编排层（进程、文件载体、git refs）的耦合发现。该类耦合不在 import 图里，quay 提出的 A3（从 spawn/fs 字符串字面量推断读写矩阵）是启发式、置信度低，**不纳入本提案**，更适合项目自己的生成器。
- 不重新引入 PlantUML 输出（项目已迁移到 Mermaid，见 `docs/user-guide/migration-v2.0.md`）。
- 不让 LLM 判定"是否违例"。LLM 只用于**起草**层声明初版，人审后才生效。
- 不跨 scope 补边（多 sources 拆成多个 scope 时的跨 scope 边，见相关实验与文档任务）。

## 设计

### 1. 层声明文件

沿用原型 `docs/experiments/layer-map/layers.yml` 的结构，已在 archguard 自身跑通：

```yaml
layers:
  <name>: { rank: <int>, globs: ["src/x", "src/x/**"] }   # 最长字面前缀优先
ignore: ["tests/**", ...]                                   # 非生产目录，不算覆盖缺口
allowed:  ["A -> B", ...]                                   # 未列出的跨层方向 = 禁止（同层除外）
known_violations: [{ edge: "A -> B", evidence: "..." }]     # 棘轮基线
```

要点：
- 层的归属必须**人审**：机械按目录名归层会出错（原型中 `plugins/shared` 若并入 `plugins` 会把正常依赖误报成违例）。
- 与 `project-semantics.json` 的关系（**裁定 3 / 方案 1**）：现有 `architecturalLayers` 只是 `Record<路径, 层名>`，**表达不了方向**，本提案**不扩展**该字段。层声明是「路径 → 层」的唯一正本；analyze 时按每个包目录对 `globs` 最长匹配，把结果投影成 `architecturalLayers` 注入 `ArchJSON.extensions.projectSemantics`（不落新文件、渲染器不改）。无层声明文件时，`architecturalLayers` 的现有行为完全不变。好处是「路径 → 层」只有一处人手作者，不存在漂移。

### 2. 取边与 type-only 拆分

- 取边：`extensions.tsAnalysis.moduleGraph.edges`（目录级）。**前提**：该图的边集合要完整。2026-10-03 发现它漏掉 `export ... from` 重导出、字面量动态 `import()`，并把裸 `@/types` 别名记成外部包——见 `gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges`。
- type-only 拆分：边上增加 `typeOnlyStrength` / `valueStrength`（不变式 `strength = 二者之和`），由 ts-morph 的 `isTypeOnly()` 判定——见 `gap-ts-module-graph-type-only-edge-split`。原型是在外部按位置扫描源文件补出来的，内置后不再需要。
- 注释与字符串里的路径提及**不得**产生边：ArchGuard 的 TS 边收集基于 AST（`getImportDeclarations()` 等），天然满足；检查器自身不再读源文件。
- 反面同样必须成立：**真实代码不得被当成注释**。quay 会话的扫描器曾用朴素正则剥块注释，被字符串里的 `/*` 错配而吞掉真实代码（83 个载体名应为 84，24 个应为 26）。这两类错误同属"文本扫描不如 AST"，是内置检查器基于 AST 而不是正则的依据；检查器的夹具要同时覆盖这两面。
- 独立佐证（quay 试验，2026-10-03）：用共同上层根分析 396 个 `.ts`，按行首语句解析的真值与 ArchGuard 的文件对对账，漏掉的 11 条边中 9 条是 `export ... from` / `export * from`，0 误报——与阶段 0 发现的"重导出不产生边"一致。

### 3. 检查器与三态结果

- `pass`：评估了至少一条层间边，且没有**新增**违例（相对基线）。
- `fail`：存在不在基线里的违例。
- `not-evaluated`：读不懂输入、没有 moduleGraph、没有 internal 目录、**没有评估到任何层间边**（例如 glob 全不匹配）。**不得与 pass 同形**。原型曾犯过一次：对空图返回了 pass，对照测试发现后修复。
- 覆盖缺口单独列出而不是静默忽略：未映射到任何层的目录、解析不了的别名边、被忽略的外部依赖边数。
- 退出码：0 通过 / 1 有新增违例 / 2 未评估。

### 4. 展示

单页 HTML：层按 rank 分行的框图、违例表（方向、状态[基线/新增]、目录级边数、值依赖数、type-only 数、示例文件）、覆盖缺口说明。输出必须**确定**（排序稳定，不嵌入生成时间；数据时间戳作为输入的一部分单独显示），以支持 `--check` 模式（盘上产物与重新生成不一致则非零退出）。Mermaid component 图作为可选输出，沿用现有 Mermaid 渲染链路。

### 5. 形态（入口形态待裁定 2 的 A0 完成后确定）

- **确定性内核**：一个 CLI 入口（独立子命令 `archguard check-layers`，或扩展 `archguard check` 的 fitness 规则类型 —— **未定**）和一个对应的 MCP 工具；原型 `check-layers.mjs` 的逻辑迁入 `src/`，带单元测试。
- **编排 skill**：引导 1→5 步（分析、起草层声明、人审、检查、展示），把已知陷阱写进 skill：关键词 grep 会把注释当 import；读了旧的产物目录（用独立 `--output-dir` 并核对数据时间戳）；别名路径造成重复 scope。
- **subagent**：仅用于"起草层声明初版"，输出必须标注"未经人审"。

### 6. Phase D1 — Semantic Architecture Review（2026-10-08 追加，附加阶段）

**这不是对阶段 2–4 的替代，是在阶段 2–4 的确定性内核之上追加的一层。** 阶段 0–4 的全部产出（moduleGraph、层声明、`check-layers.mjs` 的 pass/fail/not-evaluated 判定）在 Phase D1 里**只被消费，不被改写**——Phase D1 不产生新的确定性 gate，也不取代 `check-layers.mjs` 的裁决权（见下面"三层区分"）。

**动机**：阶段 0–4 回答的是"declared 的层方向有没有被违反"，这是**声明层**的问题——层声明本身（谁属于哪一层、哪个方向允许）仍需要人审。但 quay GOAL-030 这类重构 goal 提出了另一类问题：**"状态转移 ownership 是不是真的从 orchestration 层收敛到了 kernel 层"**——这个问题即使 `layers.yml` 没有任何新增违例（因为旧实现和新实现可能落在同一层的 glob 之内，或者改动者只是在同一层内部把函数名换了），也可能完全没有发生。阶段 0–4 的确定性边数/环数/三态结果**答不了**这类"结构变化是真收敛还是只是搬了个壳"的问题——这正是 Phase D1 要补的缺口，具体案例见本文件"Phase D1 的首个真实案例：quay GOAL-030"一节。

#### 输入

- ArchGuard 的 module/package/entity graph（`extensions.tsAnalysis.moduleGraph`）、`cycles`、package 级 `metrics`（fileCount/entityCount/outDegree 等）
- 阶段 2 的声明层产物：`layers.yml`（声明本身）+ 确定性检查器的判定结果（`pass`/`fail`/`not-evaluated` 三态，含违例清单与覆盖缺口）
- **可选** before/after diff：两次独立评估（before 树、after 树）各自的上述产物，用于判断"这次改动让结构往声明的方向走近了还是只是换了位置"
- **可选** repo docs / project semantics：`project-semantics-discovery` 的既有产出（`architecturalLayers` 投影）、proposal/plan/ADR 原文、以及人审过的"验收协议"（一份列明判断陷阱的清单，如本文件下面 GOAL-030 案例给出的四项检查）

#### 输出

**evidence-backed semantic interpretation，不是新的 deterministic gate。** 具体地：

- 每条结论必须引用支撑它的"输入"里的具体条目（某条 moduleGraph 边、某个 entityCount 差值、`check-layers.mjs` 报告里的某一行），不允许悬空下结论
- 结论带四态读数（真收敛 / 形似但未竟 / 回归 / 未评估），**不是 pass/fail**——这四态是语义判断的结果标签，不是退出码，不进 CI 机械门
- 不可重放到同一个"退出码"——两次调用同一输入允许文字表述不同，但引用的证据条目必须一致（证据可重放，叙述不要求逐字节相同，这是和阶段 2 确定性检查器"同一输入连续两次产物逐字节一致"的刻意区别，见"三层区分"）

#### MVP 范围："薄语义层"——只覆盖这四类判断

第一版**只**回答以下四类问题，不做更多：

1. **ownership 是否收敛**：某个职责（如一类状态转移）的决策与执行逻辑，是不是真的只在声明该职责所属的那一层（如 kernel）存在一份实现，而不是旧层依然保留一份、新层又加一份（"第三套实现"）。
2. **职责是否从错误层迁移到正确层**：声明为"该在 X 层"的职责，是否真的从 Y 层（declared 之外）的代码里消失了，而不是 Y 层继续保留一份"看起来没用但其实还在被调用"的实现。
3. **orchestrator 是否仍直接持有 domain state**：驱动/编排层（如 `plugin/scripts` 一类文件）在改动后是否还在直接做"读状态、判断是否合法、写状态"的三件事，还是已经变成"把意图传给 domain 层，由 domain 层判断并执行"。
4. **结构变化是否只是搬文件/换壳**：新增的模块/文件是否只是把旧实现的代码体复制过去、import 路径换了个方向，但旧实现的调用方和旧文件的语义角色都没有真正改变（比如新 kernel 模块的函数体内部仍然 `import` 回旧文件的底层写入原语）。

**明确 NOT in MVP**（第一版不做，不是"暂时忘了"，是刻意排除）：

- 完整 DDD（领域驱动设计）建模——不产出聚合根/值对象/领域事件的完整划分
- OOD（面向对象设计）评审——不产出类职责划分、继承/组合建议
- 架构风格诊断——不判断"这是不是微服务/分层架构/六边形架构"之类的风格归类
- 全局系统设计评分——不产出任何形式的"架构健康度打分"或排名

这四类不在 MVP 范围，是因为它们需要的判断依据（领域模型、团队约定、非功能需求）超出了"ArchGuard 机械输出 + 声明层产物"能提供的证据面——MVP 只处理"文中四类问题"所需、能被机械事实或声明直接或间接证明的部分。

#### 三层区分（必须物理分区，不能混写）

| 层 | 产出 | 谁说了算 | 可重放性 |
|---|---|---|---|
| **机械事实** | moduleGraph 边/环/entityCount 等原始读数 | ArchGuard 的 `analyze` 输出，唯一真相 | 同一输入逐字节一致 |
| **declared architecture rules** | `layers.yml` 声明 + `check-layers.mjs` 的 pass/fail/not-evaluated | 人审过的声明文件 + 阶段 2–3 的确定性检查器，**裁决权在这一层，Phase D1 不染指** | 同一输入逐字节一致（阶段 2–3 的既有要求不变） |
| **LLM semantic interpretation** | Phase D1 的四态判断 + 引用的证据条目 | LLM，**仅供参考，不是 gate**，人/任务门决定是否采信 | 证据引用可重放，叙述文字不要求逐字节一致 |

这与阶段 3"验证方式"一节"同一输入连续两次生成，产物逐字节一致"的要求不冲突——那条要求继续只约束前两层；Phase D1 是第三层，明确放宽到"证据可核实，叙述允许变化"，且**永远不能冒充前两层的确定性结果**。

#### 可复用资产（不从零设计）

| 资产 | 现状 | Phase D1 里的角色 |
|---|---|---|
| `archguard analyze -f json`（CLI） | 已发布 | 事实层唯一数据源，原样调用；注意从非项目自身目录跑，避免继承当前仓库 `archguard.config.json` 的 exclude（实测会吞掉 `**/scripts/**`） |
| `extensions.tsAnalysis.moduleGraph` | 已是稳定字段 | 事实层核心：cycles、目录级边、nodes.stats 直读，不经 `detect_cycles` MCP 工具 |
| `docs/experiments/layer-map/check-layers.mjs` + `layers.yml` | 本提案阶段 0–1 的既有原型 | **原样调用，不改**——declared architecture rules 层的唯一判定来源 |
| HTML/JSON output（阶段 3 设计，`check-layers.mjs` 已有雏形） | 已有单页 HTML 渲染雏形 | Phase D1 复用同一渲染风格，但报告里明确物理分区"机械事实/声明判定/语义解读"三块，不能合并展示成一个表 |
| `project-semantics-discovery` skill（已发布） | 方向是"把语义知识喂给 ArchGuard"，产出 `architecturalLayers` 投影 | **可选兜底输入**：仅当没有 `layers.yml` 时，取它的分组提示喂给语义判断步骤做弱提示，不替代层声明（遵守"评审裁定 3 / 方案 1"——层声明是唯一正本） |
| `cognitive-analysis` skill（`.claude/skills/`，未随插件发布） | probe→focus→deepDive→synthesize→cache 五步模板，文件级认知负荷分类 | **复用"形状"不复用工具**：Phase D1 的语义判断步骤沿用同一"先收集确定性信号、再分类、再给结构化双表输出"的模式，粒度从单文件换成"职责/ownership" |

#### Phase D1 的首个真实案例：quay GOAL-030

GOAL-030 的切片是"promotion driver 的 todo→ready / ready→todo 两条状态写入收敛到 kernel transition decision"。**只看 edge count 判断不了 ownership 是否真的收敛**，原因和判断方法如下（均为本次 before 基线实测，未改 quay 代码）：

- **陷阱 1（搬壳不搬心）**：如果 after 树里 `plugin/scripts -> packages/quay/src/kernel` 的边强度上升了（看起来"更依赖 kernel 了"），但新 kernel 模块的函数体内部仍然 `import` 回 `plugin/scripts/task-ops.ts` 的 `patchStatusField`/`commitTaskFile` 做真正的落盘——edge count 上升是真的，但决策的"心脏"仍在 orchestration 层，ownership 没有收敛。Phase D1 的判断方法：不只读目录级边，还要读新模块自身的 import 语句，确认它的出边只指向 kernel 目录内部 + 外部包（node 内建/npm），一条都不指回 `plugin/scripts`。quay 自带的 `import-graph-check.ts` 的"kernel 边界"规则（`kernelChecked`/`kernelViolations`）恰好是这条判断的机械佐证，但它只能回答"有没有违反"，回答不了"为什么没有违反就等于收敛了"——例如 kernel 新模块完全没有被任何调用方使用（孤岛代码），`kernelViolations` 仍然是 `[]`，但 ownership 同样没有收敛，因为没人真的把决策权交给它。
- **陷阱 2（只改一侧）**：`packages/quay/src/gate/lifecycle.ts` 的 `runPromote`/`runRetreat` 当前完全不依赖 kernel（`gate -> kernel` 边读数为 0）。如果 after 树只把 `ready-pool-check.ts` 的两条写入切到了新 kernel 模块，但 `gate/lifecycle.ts` 继续维护自己的一份 `TRANSITIONS`——edge count 和层声明都可能"看起来没问题"（因为 `gate/lifecycle.ts` 没有新增违反声明方向的边），但这是"新增了第三套实现"而不是"收敛成一套"。Phase D1 的判断方法：显式检查 `LIFECYCLE_EDGES`/等价的转移规则表在全仓是否仍然只有一处定义，且该定义位于声明的那一层（kernel）——这条判断无法从边数或环数推出，必须读两处代码的实际内容做比对。
- **陷阱 3（接口形状不变 = 边界没有变清楚）**：即使两条写入函数本体真的搬进了 kernel，如果调用方传入的仍然是一个未类型化的大 `opts` 对象（当前 `applyPromotions(opts)` 的形状），"领域边界更明确"这个目标就没有真正达成——这条同样不是 edge count 能回答的，需要读函数签名的语义。

Phase D1 对 GOAL-030 的输出骨架（节选，`verdict` 为语义判断，`evidence` 字段引用机械事实/声明判定具体条目）：

```json
{
  "ownershipConvergence": {
    "verdict": "converged | cosmetic | regressed | not-evaluated",
    "evidence": [
      "facts.after.edges['packages/quay/src/gate->packages/quay/src/kernel']",
      "declaredRules.after.checkLayers.violations（应为空或与基线一致）",
      "extraCheckers.after['import-graph-check'].kernelViolations（应为 []）"
    ],
    "trapChecklist": [
      { "trap": "新 kernel 模块是否反向 import plugin/scripts 的写入原语", "hit": false },
      { "trap": "gate/lifecycle.ts 是否仍维护独立一份 TRANSITIONS", "hit": false }
    ]
  }
}
```

这与 Phase D1 的 MVP 四类问题逐条对应：问题 1→陷阱 2、问题 3→orchestrator 是否仍直接持有 state（即"决策权是否转移"）、问题 4→陷阱 1（搬壳不搬心）。

#### Single-tree / Architecture-Health 模式（2026-10-08 追加）

**动机**：上面的四类 MVP 问题全部要求"一次具体的改动"（旧实现 vs 新实现）才能判断——2026-10-08 对 archguard 自身做 Phase D1 dogfooding 自查时实测到：没有 before/after 时，四问里"orchestrator domain state"与"shell move vs real move"结构性答不出来（不是证据不够，是问题本身没有可比较的对象），只能诚实标 `not-evaluated`，但另外两问（ownership convergence、responsibility migration）在"声明文件自带已消除基线的叙述"时仍可退化成静态快照判断。这次 dogfooding 同时发现 `check-layers.mjs` 本身对**同层环**（如 archguard 自身 `src/cli` 内部 10 目录、31 条边、89 值依赖的环）结构性不可见——它只比较跨层边，`pass` 不代表"没有环"，只代表"没有跨层方向违例"。这是一个比"要不要 before/after"更根本的缺口：即使完全不做重构对比，单纯问"这棵树现在架构健不健康"，现有四问也没有一个能直接回答。

**新增能力，不是新机制**：仍然是消费同一批既有产出（moduleGraph、`check-layers.mjs`、layers.yml），仍然遵守三层物理分区，仍然不新增确定性检查器、不改变 `check-layers.mjs` 的裁决权——只是追加一套**专为单棵树设计的问题集**，与原四问并存（原四问用于 before/after 比较场景，新问题集用于"体检当前这棵树"场景；调用方按场景选择问题集，不是互相替代）。

**单树体检问题集（4 问，均可从单棵树 + 声明文件直接或间接回答，不要求 diff）**：

1. **跨层环覆盖**（cross-layer cycle coverage）：每一个跨层目录环的成员对，是否在 `layers.yml` 的 `allowed` 里都有对应方向的声明？有声明 → 这是设计选择（如 archguard 自身 `plugin-runtime <-> plugins` 的动态装配边），标注清楚、不算违例；没有声明但 `check-layers.mjs` 仍判 `pass`（因为这对边本身恰好没有被判例命中）→ 要显式指出这是一个覆盖缺口，不能被 `pass` 掩盖。
2. **同层环暴露**（intra-layer cycle exposure）：对 `moduleGraph.cycles` 里每一个环，判断其成员是否全部落在 `layers.yml` 的同一个层。全部同层 → 这是 `check-layers.mjs` 结构性看不见的一类环，必须在报告里单独列出并标注"declared rules 对此环未评估"，不能因为 `check-layers.mjs` 报 `pass` 就略过不提。
3. **叶子层纯净度**（leaf-layer purity）：对声明里被最多其它目录依赖、本身应该是叶子的层/目录（典型如 `utils`/`types`/`shared` 一类命名），检查其出边是否存在"反向进入调用方所在环"的边——这是 2026-10-08 发现 `src/cli/utils -> src/cli/analyze`/`-> src/cli/processors` 两条反向边的同一类判断，泛化成可对任意项目重复执行的问题。
4. **声明覆盖缺口**（declaration coverage gap）：`check-layers.mjs` 输出里的"未映射目录"列表，以及这些目录的 `entityCount` 占全树 `entityCount` 的比例——避免"声明只覆盖了一小部分代码却看起来全绿"的假象。

**输出契约不变**：仍是 `facts`/`declaredRules`/`judgment` 三个顶层 key；`judgment` 仍是四态（`converged`/`cosmetic`/`regressed`/`not-evaluated`——单树场景下，"converged" 读作"当前已符合声明"而非"收敛动作完成"，"regressed" 读作"存在声明之外的真实耦合"）；每条结论仍要求非空 `evidence`；仍不得出现 `pass`/`fail`/`exitCode` 字段名。

## 分阶段（2026-10-03 按裁定修订）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| 0 | moduleGraph 边集合完整（重导出、动态 import、别名） | `gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges` |
| 1 | 边上的 type-only / 值依赖拆分 | `gap-ts-module-graph-type-only-edge-split` |
| 0.5 | 阶段 0/1 验收补回：独立位置判定对账（见下方「阶段 0/1 验证记录」） | `gap-verify-module-graph-edge-completeness` |
| A0 | 修 fitness 引擎死桩：`check` 空 relations；CLI `query --cycles` 忽略 `--output-scope` | `gap-fitness-check-relations-stub`、`gap-query-cycles-ignores-output-scope-package` |
| 2 | 检查器内核 + 层声明 schema 校验 + 基线。**入口形态（复用 `check` / 独立子命令、命令名、是否同给 MCP 工具、skill 是否入 plugin）待 A0 完成后裁定** | 0.5、A0 |
| 3 | 单页展示 + 确定性输出 + `--check`（含浏览器目视验证） | 阶段 2 |
| 4 | 编排 skill + 起草 subagent；`project-semantics-discovery` 改为起草层声明 | 阶段 2、3 |
| **D1** | **Semantic Architecture Review（2026-10-08 追加）**：薄语义层 skill，消费阶段 0.5/1 的 moduleGraph + `check-layers.mjs`（原样调用，不等阶段 2 的内核落地）+ 可选 extra-checker/acceptance-protocol，产出 evidence-backed 四态判断（非 gate）。两套问题集并存：原四问用于 before/after 重构对比，**single-tree / architecture-health 四问**（2026-10-08 追加，见上方同名小节）用于单棵树体检 | 0.5、1（**不依赖阶段 2–4**——`check-layers.mjs` 原型已可直接消费，入口形态裁定不阻塞 D1 上线；待阶段 2 落地后 D1 可切换到新的确定性 CLI 入口，不改 D1 自身契约） |

阶段 0/1 的**真实对照验证**见下文「阶段 0/1 验证记录」——两个项目上 internal 边集合完整、拆分与独立扫描一致；
但发现阶段 0 未覆盖的一类漏边（类型位置的 `import('...')`），已另立 gap 任务。

原建议（`gap-layer-mutual-plugin-runtime-core-parser` 完成后把 archguard 自身基线定为"零违例"）**已满足**：当前树实测 25 条层间边、0 违例、0 覆盖缺口（2026-10-03，`docs/experiments/layer-map/check-layers.mjs` 退出码 0）。

## 阶段 0/1 验证记录（2026-10-03）

阶段 0/1 两个 gap 任务各自的 AC 是在**修前树**上写的、只验证了自己的缺口。在把阶段 2 的内核建在其上之前，
用一条**不读 moduleGraph** 的独立路径重新取边对账。脚本：`docs/experiments/layer-map/verify-edge-completeness.mjs`
（实验产物，不是阶段 2 的内核）。

**独立性**：边由脚本自己按位置扫描源文件得出（行首 `import/export … from` 语句、`export * from`、字面量
`import()`），不调用 ts-morph、不读 `moduleGraph.edges` 推导任何一条边；specifier → 目录的解析（相对路径候选扩展、
tsconfig `paths` 别名、裸包名）与注释屏蔽均为独立实现，只从 tsconfig 读 `baseUrl`/`paths`。注释屏蔽是
字符串/正则感知的状态机——`--self-test` 用 5 组成对负对照守住两面：注释/字符串里的路径**不产生**边，
字符串里的 `/*` **不吞掉**后续真实代码（proposal §2 记录的 quay 事故）。同一输入连跑两次产物逐字节一致。

复现：

```bash
node dist/cli/index.js analyze -s <项目源码根> -f json --output-dir /tmp/out --work-dir /tmp/work
node docs/experiments/layer-map/verify-edge-completeness.mjs --self-test
node docs/experiments/layer-map/verify-edge-completeness.mjs /tmp/out/overview/package.json --label <名字> --json /tmp/r.json --md /tmp/r.md
```

### 结果

| 项目 | 文件 | 独立边 / internal 内建边 | (a) 漏边 internal | (a) 多报 internal | (b) 拆分母等式违例 | (b) type-only 判定不符（internal） | 判定 |
|---|---|---|---|---|---|---|---|
| archguard 自身 | 306 | 348 / 197 | **0** | **0** | 0 | 0 | pass |
| quay（`packages/`） | 125 | 93 / 28 | **0** | **0** | 0 | 0 | pass |

两边的 `mg.unresolved`（0）与 `mg.unevaluatedDynamicImports`（archguard 4、quay 1）也与独立扫描逐一吻合，
即阶段 0 声称覆盖的三类（重导出、字面量动态 `import()`、裸 `@/` 别名）在两个项目上都成立。

### 逐条归因的偏差

1. **external（node_modules）边集合既不完整也不稳定**——archguard 漏 31 条、其中 2 条只是少计；quay 0 条。
   目标包：`fs-extra`(23)、`micromatch`(6)、`cli-progress`(1)、`js-yaml`(1)。
   根因：`ModuleGraphBuilder.resolveTarget` 先看 ts-morph 的 `getModuleSpecifierSourceFile()`；裸包名若能解析到
   `node_modules` 里的文件，该文件不在 `fileToModule` → 返回 `skip`（不产边），解析不到才落到 external 分支。
   于是同一个包在不同目录下「有边 / 无边」取决于 ts-morph 是否解析得到它。动态 `import()` 不走 ts-morph 解析，
   一律落到 external——所以只有被 `await import` 过的包才一定出现在图里。
   **对阶段 2 无阻塞**：层间检查只消费 internal 边（`check-layers.mjs` 只把 external 计入覆盖缺口数字），
   但覆盖缺口里的「外部依赖边数」会偏小。（已由 `gap-ts-module-graph-external-edge-resolution-dependent` 修复，
   见下方「补记：external 边的解析无关性已修复」。）
2. **类型位置的 `import('...')`（TSImportType）整类不产边**——archguard 16 处、quay 0 处。
   builder 只扫 `SyntaxKind.CallExpression`，而 `config: import('@/core/interfaces/parser.js').ParseConfig`
   是 ImportTypeNode。16 处中 13 处解析到项目内目录：**3 条的边在 moduleGraph 里完全不存在**
   （`cli/analyze -> core/interfaces`、`cli/processors -> core/interfaces`——该目录对这两个模块的唯一引用就是它），
   另 9 条只是 strength 少计。
   **对阶段 2 有影响**：检查器要区分 type-only 与值依赖，而「只被类型位置 import type 引用」的目录对
   在图上**完全没有边**，这类 type-only 层间违例会被漏掉（archguard 自身 3 条，quay 0 条）。
   （已由 `gap-ts-module-graph-misses-type-position-import-type` 修复，见下方「补记」。）

### 结论：阶段 0/1 的产物是否足以支撑阶段 2 的检查器

- **值依赖与具名 import 的边集合：足够。** 两个真实项目的 internal 边在两套独立实现下无缺无溢（0/0），
  边强度逐条相等，`strength === typeOnlyStrength + valueStrength` 在全部边上成立，type-only 判定与独立扫描一致。
- **有一个已知的、有界的盲区：类型位置 `import('...')`。** 影响面是可枚举的（archguard 3 条边整条缺失、
  9 条少计；quay 0 条），且会以「整条边不存在」的形式让极少数 type-only 层间违例漏报。
  按本任务 DoD「发现新的漏边须立新 gap 任务而不是顺手修」，已另立
  `gap-ts-module-graph-misses-type-position-import-type`；external 边的不稳定另立
  `gap-ts-module-graph-external-edge-resolution-dependent`（低优先，不阻塞阶段 2）。
  两个 gap 任务均已落地（见两条「补记」），两个项目的对账现均为 `status=pass` 且 external/internal 漏边全 0。
- 因此**阶段 2 可以开工**；阶段 3 的「覆盖缺口」展示仍须把 external 边（解析无关）与 type-only 拆分明示，
  不得让它们表现为"零违例"。

### 补记：类型位置 `import('...')` 已修复（2026-10-03）

`gap-ts-module-graph-misses-type-position-import-type` 已落地：`ModuleGraphBuilder` 新增对 ts-morph
`ImportTypeNode`（`SyntaxKind.ImportType`）的扫描，覆盖 `config: import('@/x.js').Cfg`、
`type T = import('./x.js').X`、`Promise<import('./y.js').Y>`、`readonly import('./z.js').W[]`、
`typeof import('./v.js').V` 等包装形式，为其产出 **type-only** 边（计入 `typeOnlyStrength`、不计 `valueStrength`）；
参数非字符串字面量时照旧不产边。`ImportTypeNode` 不是 `CallExpression`，故与既有的动态 `import()` 扫描互不重叠。

独立对账脚本（`verify-edge-completeness.mjs`）同步把类型位置 `import('...')` 计为 type-only 边，并把
`typePositionImpact` 改为描述「修复后残余影响」。用更新后的脚本在**修前树 / 修后树**（同一份 `src`，仅
`module-graph-builder` 不同）各跑一次：

| 指标 | 修前树 | 修后树 |
|---|---|---|
| `typePositionImpact.edgeAbsent` | 3 | **0** |
| `typePositionImpact.edgeUnderCounted` | 9 | **0** |
| 漏边 internal | 2 | **0** |
| 多报 internal | 0 | **0** |
| 判定 | fail | **pass**（external caveat 不变） |

修后 archguard 自身出现 `cli/analyze -> core/interfaces`、`cli/processors -> core/interfaces` 两条此前完全缺失的
type-only 边（`typeOnlyStrength >= 1`、`valueStrength = 0`）。quay（`packages/`）复跑仍 `status=pass`
（该仓库 0 处类型位置 `import()`）。因此阶段 2 检查器不再有「只被类型位置 import 引用的目录对在图上无任何边」
这一漏报面。

### 补记：external 边的解析无关性已修复（2026-10-03）

`gap-ts-module-graph-external-edge-resolution-dependent` 已落地。`ModuleGraphBuilder.resolveTarget` 不再把
「ts-morph 把裸包名解析到 `node_modules` 里的文件」当作 `skip`：裸包名（非 `.` 开头、且不匹配 tsconfig `paths`
别名）一旦解析到源码根外，就按 **specifier 自身** 产出 external 边——与解析不到时落到的那条 external 分支同一口径。
相对的 / 别名 specifier 逃出源码根仍 `skip`（不造幻影 external 节点）。语义写进 `TsModuleDependency.to` 的文档注释：
external 边表示「该模块 **引用了** 这个包」，与解析器能否在磁盘上找到它无关，故静态 `import ... from '<pkg>'`、
`export ... from '<pkg>'` 与字面量 `import('<pkg>')` 对同一个包产出一致的 external 边。

用同一份 `src`（仅 `module-graph-builder` 不同）在 archguard 自身与 quay 各跑一次独立对账（`verify-edge-completeness.mjs`）：

| 项目 | 指标 | 修前 | 修后 |
|---|---|---|---|
| archguard 自身 | 漏边 external | **31** | **0** |
| archguard 自身 | 漏边 internal | 0 | 0 |
| archguard 自身 | 多报 internal / external | 0 / 0 | 0 / 0 |
| archguard 自身 | strength 与独立扫描不符（internal） | 0 | 0 |
| archguard 自身 | external 边数 | 120 | **151**（+31） |
| archguard 自身 | external 节点数 | 36 | **39**（+3） |
| archguard 自身 | external 边 strength 合计 | 250 | 318 |
| archguard 自身 | internal 边数 | 200 | 200 |
| archguard 自身 | 判定 | pass | pass |
| quay（`packages/`） | 漏边 internal / external | 0 / 0 | 0 / 0 |
| quay（`packages/`） | external 边数 / 节点数 | 65 / 13 | 65 / 13 |
| quay（`packages/`） | internal 边数 | 28 | 28 |
| quay（`packages/`） | 判定 | pass | pass |

archguard 自身 +31 条 external 边恰好等于此前逐条归因的 31 条（`fs-extra` 23、`micromatch` 6、`cli-progress` 1、
`js-yaml` 1），新增 3 个 external 节点（`micromatch`、`cli-progress`、`js-yaml`；`fs-extra` 此前已因动态 `import()`
存在）。external 边 strength 合计 250→318，超出 +31 的部分对应此前「只是少计」的 2 条
（`cli/analyze -> fs-extra`、`cli/mcp/tools -> fs-extra` 各自补足到独立扫描值）。internal 边集在两套独立实现下
仍逐条一致（archguard 200/200、quay 28/28），internal 漏边/多报/strength 判定仍全 0，即本次改动未破坏 internal
边集合。quay 的 external 节点集合、边数与 strength 修复前后逐项相同（`status=pass` 不变）——该校验仓库的 external
边此前已完整，没有一条源自杀 `skip`。

下游展示影响：archguard 自身 external 节点 36→39、external 边 120→151（+26%），覆盖缺口里的「外部依赖边数」
从此前系统性偏小上升为真实值；internal 模块数（47）与 internal 边数（200）不变，故阶段 2 层间检查的判定面不受影响。

## 风险与开放问题

1. **边集合变化会改变现有数字**：阶段 0 增加边后，`moduleGraph.cycles` 与 package 层 metrics 可能出现新环/新数值，需要逐个确认真实性。
2. **层声明的维护成本**：目录重组时 glob 会失效；检查器对"glob 全不匹配"必须返回 `not-evaluated`，而不是 pass。
3. **多语言**：本提案只覆盖 TS（目录级 moduleGraph）。Go 已有 Atlas 包图；Java/Python 等需要另行评估，先不承诺。
4. ~~**`architecturalLayers` 与层声明的关系**~~：已裁定为**方案 1**（层声明为正本，`architecturalLayers` 为派生投影），见「评审裁定」3。
5. **展示粒度**：单页 HTML 只在字符串层面验证过，没有在浏览器里目视验证，阶段 3 需要补。
6. **quay 提出的 A1（type alias 与非导出声明纳入实体）、A2（字面量数据表抽取）**：与本提案互相独立，且会改变实体数与现有基线，建议单独提案，排在本提案之后。
7. **（D1 专属风险）LLM 判断被误用为机械 gate**：Phase D1 的四态判断（真收敛/形似但未竟/回归/未评估）结构上很像阶段 2–3 的 pass/fail/not-evaluated 三态，容易被下游消费者（人或自动化）误当成同等裁决力使用。缓解：D1 的输出契约强制要求每条判断带 `evidence` 字段引用机械事实/声明判定的具体条目，报告里三层（机械事实/declared rules/语义解读）必须物理分区展示，不能合并成一张表；D1 不写回任何状态机或 gate 结果。

## 验证方式（落地时）

- 内核单测：三态各一组夹具，含"注释里提到路径不算依赖"的成对负对照、空图与 glob 全不匹配的 not-evaluated 用例、基线只减不增的用例。
- 真实对照：在 archguard 自身（层声明已提交）与 quay（需要其层声明）各跑一次，结果与独立的位置判定 grep 核对。
- 确定性：同一输入连续两次生成，产物逐字节一致；`--check` 在人为改动产物后返回非零。
