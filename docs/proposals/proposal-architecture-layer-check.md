# Proposal: 分层声明 + 确定性方向检查 + 多层架构展示（A4）

**状态**: Approved v2（2026-10-03 人审通过，范围见「评审裁定」；阶段 2–4 的入口形态待 fitness 死桩修复后裁定）
**日期**: 2026-10-03
**关联**: `docs/experiments/layer-map/`（外部原型，提交 2a75651e）、`docs/user-guide/architecture-checking-scenarios.md`（"Limits" 一节明确写了目前没有一等的规则检查）
**来源**: archguard 自身的分层实测；quay 项目架构审查提出的 A4/B8 需求；会话「archguard 架构语义映射」的原型实测

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
   但覆盖缺口里的「外部依赖边数」会偏小。
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
- 因此**阶段 2 可以开工**，但阶段 3 的「覆盖缺口」展示里必须把这两类缺口显式列出，不得让它们表现为"零违例"。

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
这一漏报面；`gap-ts-module-graph-external-edge-resolution-dependent`（external 边不稳定）仍未处理，不阻塞阶段 2。

## 风险与开放问题

1. **边集合变化会改变现有数字**：阶段 0 增加边后，`moduleGraph.cycles` 与 package 层 metrics 可能出现新环/新数值，需要逐个确认真实性。
2. **层声明的维护成本**：目录重组时 glob 会失效；检查器对"glob 全不匹配"必须返回 `not-evaluated`，而不是 pass。
3. **多语言**：本提案只覆盖 TS（目录级 moduleGraph）。Go 已有 Atlas 包图；Java/Python 等需要另行评估，先不承诺。
4. ~~**`architecturalLayers` 与层声明的关系**~~：已裁定为**方案 1**（层声明为正本，`architecturalLayers` 为派生投影），见「评审裁定」3。
5. **展示粒度**：单页 HTML 只在字符串层面验证过，没有在浏览器里目视验证，阶段 3 需要补。
6. **quay 提出的 A1（type alias 与非导出声明纳入实体）、A2（字面量数据表抽取）**：与本提案互相独立，且会改变实体数与现有基线，建议单独提案，排在本提案之后。

## 验证方式（落地时）

- 内核单测：三态各一组夹具，含"注释里提到路径不算依赖"的成对负对照、空图与 glob 全不匹配的 not-evaluated 用例、基线只减不增的用例。
- 真实对照：在 archguard 自身（层声明已提交）与 quay（需要其层声明）各跑一次，结果与独立的位置判定 grep 核对。
- 确定性：同一输入连续两次生成，产物逐字节一致；`--check` 在人为改动产物后返回非零。
