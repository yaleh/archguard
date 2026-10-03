# Proposal: 分层声明 + 确定性方向检查 + 多层架构展示（A4）

**状态**: Draft v1（待人审，未立项实现）
**日期**: 2026-10-03
**关联**: `docs/experiments/layer-map/`（外部原型，提交 2a75651e）、`docs/user-guide/architecture-checking-scenarios.md`（"Limits" 一节明确写了目前没有一等的规则检查）
**来源**: archguard 自身的分层实测；quay 项目架构审查提出的 A4/B8 需求；会话「archguard 架构语义映射」的原型实测

---

## 背景与动机

`architecture-checking-scenarios.md` 的 Limits 一节写明：ArchGuard 擅长结构观察（实体、关系、依赖形状、scope 摘要），但**没有**"package A 只能依赖 package B"这类规则检查，只能靠 query 流程近似。

2026-10-02 起的两次独立实验（archguard 自身、quay 项目）表明，"声明层 → 确定性检查 → 单页展示"这条流程可以跑通，并且能发现 ArchGuard 现有工具看不见的问题：

- archguard 自身：`detect_cycles(package)` 返回 `[]`，但目录级存在一个 27 目录的大环；按 CLAUDE.md 的分层声明检查出 5 条方向违例（其中 3 条只是类型放错层，2 条是 `plugins/shared` 与 core/parser 互指），已分别立任务并完成/裁定。
- quay：目录级互指（`gate ↔ gate/config`、`src ↔ src/cli`）在 `detect_cycles(package)` 下同样是 `[]`。

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
- 与 `project-semantics.json` 的关系：现有 `architecturalLayers` 只是 `Record<路径, 层名>`，**表达不了方向**。本提案**不扩展**该字段，层声明另起文件，避免两份依赖声明并存；后续是否把 `architecturalLayers` 作为 glob→层名的子集由层声明引用，可作为开放问题。

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

### 5. 形态

- **确定性内核**：一个 CLI 子命令（暂名 `archguard check-layers`）和一个对应的 MCP 工具；原型 `check-layers.mjs` 的逻辑迁入 `src/`，带单元测试。
- **编排 skill**：引导 1→5 步（分析、起草层声明、人审、检查、展示），把已知陷阱写进 skill：关键词 grep 会把注释当 import；读了旧的产物目录（用独立 `--output-dir` 并核对数据时间戳）；别名路径造成重复 scope。
- **subagent**：仅用于"起草层声明初版"，输出必须标注"未经人审"。

## 分阶段

| 阶段 | 内容 | 依赖 |
|---|---|---|
| 0 | moduleGraph 边集合完整（重导出、动态 import、别名） | `gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges` |
| 1 | 边上的 type-only / 值依赖拆分 | `gap-ts-module-graph-type-only-edge-split` |
| 2 | 检查器内核（CLI + MCP 工具）+ 层声明 schema 校验 + 基线 | 阶段 1 |
| 3 | 单页展示 + 确定性输出 + `--check` | 阶段 2 |
| 4 | 编排 skill + 起草 subagent | 阶段 2、3 |

建议在 `gap-layer-mutual-plugin-runtime-core-parser` 完成后再把 archguard 自身的基线定为"零违例"，使其成为检查器的第一个真实样本。

## 风险与开放问题

1. **边集合变化会改变现有数字**：阶段 0 增加边后，`moduleGraph.cycles` 与 package 层 metrics 可能出现新环/新数值，需要逐个确认真实性。
2. **层声明的维护成本**：目录重组时 glob 会失效；检查器对"glob 全不匹配"必须返回 `not-evaluated`，而不是 pass。
3. **多语言**：本提案只覆盖 TS（目录级 moduleGraph）。Go 已有 Atlas 包图；Java/Python 等需要另行评估，先不承诺。
4. **`architecturalLayers` 与层声明的关系**：是否让层声明引用 `project-semantics.json` 的分组，开放。
5. **展示粒度**：单页 HTML 只在字符串层面验证过，没有在浏览器里目视验证，阶段 3 需要补。
6. **quay 提出的 A1（type alias 与非导出声明纳入实体）、A2（字面量数据表抽取）**：与本提案互相独立，且会改变实体数与现有基线，建议单独提案，排在本提案之后。

## 验证方式（落地时）

- 内核单测：三态各一组夹具，含"注释里提到路径不算依赖"的成对负对照、空图与 glob 全不匹配的 not-evaluated 用例、基线只减不增的用例。
- 真实对照：在 archguard 自身（层声明已提交）与 quay（需要其层声明）各跑一次，结果与独立的位置判定 grep 核对。
- 确定性：同一输入连续两次生成，产物逐字节一致；`--check` 在人为改动产物后返回非零。
