# Plan 73-81 — 格式与编码实验（Format-Encoding Experiment）

> Proposal: `docs/proposals/proposal-format-encoding-experiment.md`（预注册实验协议 v1.1）
> Status: Draft
> Priority: MEDIUM（实验 harness，**对 `src/` 零改动**）
>承接: granularity-v2.2 B4 发现（L4 JSON vs L3 Mermaid，Δ=38.4%，p=7.6×10⁻⁸）

---

## 总览

本实验把"密集形式化记号帮模型"这条经验拆解为三个机制不同的假设（H-format / H-rewrite / H-info），分别通过 Exp 1（确定性渲染，隔离 H-format）和 Exp 2（LLM 改写 pass，隔离 H-rewrite 与 H-info）进行验证。Exp 3（指令编码）明确暂缓，不在本 plan 范围内。

**硬性纪律约束（违反即协议偏离，须记入最终报告）**：

1. **schema 冻结是全实验地基**：Phase 73 是所有后续工作的强依赖，不得与任何后续 Phase 并行。
2. **冻结 tag 是分水岭**：Phase 73–76 为 tag 之前的工作（schema + 渲染器 + 往返验证 + 决策冻结）；Phase 77–81 为 tag 之后的工作（度量测量、LLM 任务、分析报告）。tag 之前与之后的工作不混入同一 Phase。
3. **事前预测严格先于 LLM 任务**：Phase 77（协变量测量与事前预测落盘并 commit）完成之前，Phase 78 的任何 LLM 任务调用**不得发起**。Phase 78 的入口验收会核对 Phase 77 落盘文件的 commit 时间戳。
4. **对 ArchGuard 核心（`src/`）的改动：零**。全部产物位于 `experiments/format-encoding/`，与既有 `experiments/granularity/` 平级；主 vitest 配置已排除 `experiments/**`，实验测试用目录内独立 vitest/pytest 运行。
5. **凭据零落盘**：任何脚本、配置、测试、文档中不得出现 API key。凭据一律经环境变量引用：`LLM_BASE_URL`、`LLM_API_KEY`。脚本启动时 fail-fast 校验环境变量存在，缺失即报错退出。

### 确认的答题模型（probe 2026-06-12）

| 模型 | 角色 | 配置 | probe OVERALL | 备注 |
|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | 主答题模型 | 默认参数，max_tokens=8192；reasoning OFF 默认 | 0.526 | 无 logprob |
| `glm-4.5-flash` | 次答题模型 | `extra_body: {thinking:{type:"disabled"}}`, max_tokens=8192 | 0.334 | 无 logprob（待最终确认）；via LiteLLM zai provider |
| 改写模型 | Exp 2 改写步 | 须与上述异家族；候选 Qwen / DeepSeek；Phase 74 冻结版本 | — | 改写质量须 smoke test 确认 |

### 与 §8 执行顺序的对应

| §8 步骤 | 内容 | 本 plan Phase |
|---|---|---|
| 1 | 锁定 C 的 schema（实体/关系字段 + 可缺省默认值 + diff 规则） | **73**（Stage 73.1–73.2） |
| 2 | 锁定假设映射、格式集、臂设计、改写模型、改写 prompt、决策表、事前预测 | **74**（Stage 74.1–74.2） |
| 3 | 写 8 个确定性渲染器 + 8 个往返解析器；写改写 prompt smoke test | **75**（Stage 75.1–75.3） |
| 4 | 往返门控（Exp 1）：`p_f(r_f(C)) = C`；未通过记录偏差并排除或修复 | **76**（Stage 76.1–76.2） |
| 5 | 冻结 git tag（所有预测与决策表锁定）。**此步之前不得跑任何 LLM 答题任务** | **76**（Stage 76.3） |
| 6 | 渲染所有格式；测量 token 数 + 结构复杂度 + 困惑度 + 关键关系位置分布 | **77**（Stage 77.1–77.2） |
| 7 | 跑 Exp 1（8 格式 × 68 任务 × 模型 × k=5）；跑 Exp 2 改写步 + 往返验证 | **78**（Stage 78.1–78.2） |
| 8 | 跑 Exp 2 答题任务 | **79**（Stage 79.1） |
| 9 | 按决策表判定；私有库复制 Exp 1 | **80**（Stage 80.1–80.2） |
| 10 | 报告全部结果，含负结果与偏差日志 | **81**（Stage 81.1） |
| 11 | 读取 Exp 1/2 结论；另行预注册 Exp 3 | （本 plan 范围外） |

### Phase 依赖与并行性

| Phase | 内容 | 依赖 | 可并行 |
|---|---|---|---|
| **73** | C schema + diff 规则冻结（文档） | 无 | 否（全局地基） |
| **74** | 假设映射、格式集、臂设计、开放问题决策（Q1-Q5）| **73** | 否（冻结前置决策） |
| **75** | 8 渲染器 + 8 解析器 + 改写 prompt smoke test | **73**（schema）、**74**（格式集）| 75.1~75.3 可内部并行 |
| **76** | 往返门控 + 冻结 tag | **75** | 否（串行闸门） |
| **77** | 协变量测量 + 事前预测落盘 | **76**（tag） | 77.1 与 77.2 可并行；77.3 依赖两者 |
| **78** | Exp 1 全量 + Exp 2 改写步 | **77.3**（预测已 commit） | 78.1 与 78.2 可并行 |
| **79** | Exp 2 答题任务 | **78**（改写产物 + 往返验证通过） | 否（依赖 78 产物） |
| **80** | 统计检验 + 决策表判定 + 私有库复制 | **78**（Exp 1 评分）、**79** | 80.1 与 80.2 可并行 |
| **81** | 最终报告 | **80** | 否 |

### 执行预算估算（来自 proposal §3.7 / Q1）

| 组件 | 调用量（最低，2 模型）| 调用量（2×2 交叉，4 模型组合）|
|---|---|---|
| Exp 1 主集合（8 格 × 68 × 2 模型 × k=5） | 5,440 | 10,880 |
| Exp 1 参照轨（NL-摘要 + 源码 × 2 × k=5） | 1,360 | 2,720 |
| Exp 1 解析检查子任务（8 格 × 68 × 2 模型） | 1,088 | 2,176 |
| Exp 2 改写步（3 臂 × 68 × 2 改写模型 × k=5）| 2,040 | 4,080 |
| Exp 2 答题步（5 臂 × 68 × 2 答题模型 × k=5）| 3,400 | 6,800 |
| **合计** | **≥13,328 次** | **≥26,656 次** |

> **注**：Q1 须在 Phase 74 冻结前决策：接受全量设计 / 裁剪臂（去解析检查子任务 −1,088；改写 k 从 5 降至 3 −816；跳过原始源码参照轨 −680）。裁剪决策须写入冻结文档，不得在执行中途调整。

---

## 冻结前须决策的 Gate 项（Q1–Q5）

以下五个开放问题来自 proposal §10，**须在 Phase 74（冻结前）逐一作出明确决策，写入冻结文档，然后才能进入 Phase 75**。本 plan 不替用户作决策，仅标注每个 Gate 的触发条件与选项。

| Gate | 来源 | 须决策内容 | 选项 |
|---|---|---|---|
| **Q1** | §10 Q1 / §3.7 | 实验规模是否过大？API 预算是否已批准？若不够，优先裁剪哪些臂？ | 接受全量 / 裁剪（方向见上方预算表） |
| **Q2** | §10 Q2 / §3.5 | 困惑度协变量替代方案。**探针已确认**：haiku 无 logprob（Anthropic 不提供）；glm-4.5-flash 无 logprob（冻结前最终确认）。两个主答题模型均无 logprob，方案 B 为默认路径。 | (A) GPT-4o 代测 / **(B) 放弃困惑度，改纯结构指标（默认推荐）** / (C) 加 GPT-4o 为第三答题模型 |
| **Q3** | §10 Q3 / §3.4 | 任务泄漏处置（复用 v2.2 68 题的 RLHF 偏差风险） | (A) 接受复用+声明局限 / (B) 混入 ≥20 道新题（架构师建议）/ (C) 加本地开源模型 |
| **Q4** | §10 Q4 / §3.1 | Haskell-ADT"天然无损往返"须实证验证（smoke test 通过才保留主集合） | 在 Phase 76 往返门控时执行；若有损则重设计格式或移至有损参照轨 |
| **Q5** | §10 Q5 / §4.1 | "改写-清理 prose"往返验证无确定性解析器，如何处置 H-info 控制 | (A) 接受 LLM-as-parser（须预注册解析 prompt）/ (B) 降级为人工抽样审核 10% |

---

## Phase 73 — C Schema 与 Diff 规则冻结

**依赖**：无。本 Phase 是全实验地基，完成前其他 Phase 不得开始。
**本 Phase 产出**：纯文档（`experiments/format-encoding/schema/`），零代码实现。

### Stage 73.1 — 规范结构 C 的 schema 文档

**目标**：锁定 C 的完整 schema，供所有渲染器和解析器以同一规范为准，消除后期实现分歧。

**产物文件**：`experiments/format-encoding/schema/C-schema.md`（或等价 JSON Schema 文件）

**须明确的内容**：

- **实体字段**：`id`（规范化规则：`fullyQualifiedName.toLowerCase().trim()`，或等价）、`name`、`type`（枚举：`class` / `interface` / `function` / `enum` / `type`，完整列表预注册）、`sourceFile`、`methods[]`（每个 method 含 `name`、`params[]`、`returnType`）
- **关系字段**：`from`（entity id）、`to`（entity id）、`type`（枚举预注册：`call` / `inheritance` / `composition` / `aggregation` / `dependency` / `implementation`）
- **可缺省字段默认值**（须显式声明）：例如 `params: null` ≡ `params: []`、`returnType: null` ≡ `returnType: "void"`；未在此列的 nullable 字段，`null` 与缺失视为**不等价**（保守规则）
- **id 规范化函数**：以代码级伪码写明，渲染器与解析器须使用同一函数

**验收标准**：
- `C-schema.md` 文件存在，且上述所有字段、枚举值、默认值均已明确；
- 无任何字段说"见实现"——所有语义须在文档层完全确定。

### Stage 73.2 — Diff 规则预注册

**目标**：往返门控（Phase 76）的正确性依赖 diff 算法，diff 算法须在实验前以代码级伪码锁定，避免门控产生假阳性/阴性。

**产物文件**：`experiments/format-encoding/schema/diff-rules.md`

**须明确的四条规则**（来自 proposal §2.1 架构师修订）：

1. **实体集合等价**：`C.entities` 对比用 `id` 为主键的集合等价（`Set<id>`），顺序无关；每个实体字段逐字段比对，类型枚举值须大小写规范化后再比对。
2. **关系集合等价**：`C.relations` 对比用 `(from, to, type)` 三元组构成的集合（`Set<(from,to,type)>`），顺序无关；同一 `(from,to)` 的多条不同 `type` 关系均为独立成员。
3. **nullable 字段处理**：预注册每个可缺省字段的等价规则（与 Stage 73.1 保持一致）；未列出的字段，`null` 与缺失视为不等价（保守规则，触发偏差记录）。
4. **id 别名规范化**：渲染器和解析器须对实体 id 使用 Stage 73.1 定义的同一规范化函数。

**验收标准**：
- `diff-rules.md` 包含上述四条规则的伪码级描述；
- 每条规则有手工举例（正例 + 反例），足以让独立实现者写出一致的 diff 函数；
- **本 Stage 完成后，Phase 74 才可开始**。

---

## Phase 74 — 假设映射与冻结前开放问题决策

**依赖**：Phase 73 完成。
**本 Phase 产出**：冻结文档（`experiments/format-encoding/freeze/pre-freeze-decisions.md`），零代码实现。

### Stage 74.1 — Q1–Q5 开放问题决策落盘

**目标**：逐一完成 proposal §10 的五个开放问题决策，写入文档。**这五个决策是冻结的硬前置：未落盘前不得进入 Stage 74.2。**

**产物文件**：`experiments/format-encoding/freeze/pre-freeze-decisions.md`

**须落盘的内容**：

- **Q1（规模/预算）**：选定的调用量方案与预算批准记录；若裁剪，写明裁剪的臂与理由。
- **Q2（困惑度协变量）**：选定方案（A/B/C）及操作化细节；无 logprob 模型的回归方程中该协变量如何处理（NA 标注方式）。
- **Q3（任务泄漏）**：选定方案（A/B/C）；若选 B，新题的题型分布（须覆盖 B/C 类）与数量。
- **Q4（Haskell-ADT 往返验证）**：确认在 Phase 76 往返门控时执行 smoke test，并写明"若有损则移出主集合"的决策树。
- **Q5（改写-清理 prose 往返）**：选定方案（A/B）及操作化细节；若选 A，LLM-as-parser 的 prompt 文本须在此阶段草拟（Phase 75 冻结）。

**验收标准**：五个问题均有明确选择，无"待定"；涉及 prompt 文本的占位（Q5 选 A）已草拟。

### Stage 74.2 — 假设映射、格式集、臂设计、事前预测与决策表锁定

**目标**：把 proposal §1/§3.1/§3.3/§3.6/§3.8/§4.1/§4.2/§4.4 的设计，结合 Q1–Q5 决策结果，以冻结文档形式固化。

**产物文件**：`experiments/format-encoding/freeze/pre-freeze-decisions.md`（追加节）

**须落盘的内容**：

- **假设映射**（H-format / H-rewrite / H-info → 对应实验与对比）
- **Exp 1 格式主集合**（8 格）：含每种格式的操作化定义（Haskell-ADT 字段编码方式、新造 DSL 语法、NL-穷举的 prompt 结构）；NL-穷举在 Exp 1 与 Exp 2 中的双重角色及 prompt 是否等价的判定（来自 proposal §3.1 架构师修订）
- **新造 DSL 的"简"的判定规则**（来自 proposal §3.3 架构师修订）：词汇表大小 ≤ JSON-边表 且每关系 token 数 ≤ JSON-边表 × 0.8，判定成立；否则标注"简洁度相当"
- **Exp 2 臂设计**（5 臂）：确定性-Haskell / 改写-Haskell / 改写-JSON / 改写-清理 prose / 基线
- **改写模型**（家族 + 版本）：跨家族要求（来自 §4.2）；2×2 交叉设计（若 Q1 允许）或降级条件（须在此写明，来自 §4.2 架构师修订）
- **改写 prompt 文本全文**（草稿，Phase 75 冻结）
- **2×2 交叉设计的统计检验逻辑**（来自 §4.2 架构师修订）：交互效应检验方法、主效应与交互效应判定顺序、降级条件（预注册）
- **§3.6 事前预测**（H1 / H-parse / H-pretrain / H-dense / H-interact / H-归因回归）
- **§3.8 Exp 1 决策表** + **§4.4 Exp 2 决策表**
- **Exp 1 功效分析**（来自 §3.7 架构师修订）：bootstrap 功效模拟结果或分析，最小可接受功效阈值（建议 80%）；若功效不足，写明采取措施（扩任务集 / 提高 k / 接受低功效并标注）
- **偏差日志 schema**（来自 §7 架构师修订）：字段 `id`（`D-<phase>.<seq>`）、`stage`、`type`（枚举）、`description`、`impact`、`resolution`

**验收标准**：
- 所有预测与决策表以文档形式存在，无任何"见实现"或"待确认"的占位；
- 改写 prompt 草稿存在（Phase 75 做最终冻结）；
- 模型列表含每个模型的 logprob 可用性确认记录（来自 §3.5 架构师修订）；**已知**：claude-haiku-4-5-20251001 无 logprob；glm-4.5-flash 须最终确认（探针未见 logprob 字段，按无处理）；
- **本 Stage 完成后，Phase 75 才可开始**。

---

## Phase 75 — 渲染器、解析器与 Smoke Test

**依赖**：Phase 73（schema）、Phase 74（格式集与臂设计）。75.1 ~ 75.3 内部可并行。
**本 Phase 是本实验唯一大规模代码实现 Phase**，包含 8 个渲染器、8 个往返解析器和改写 prompt 冻结。

### Stage 75.1 — 脚手架与共享基础设施

**目标**：建立 `experiments/format-encoding/` 目录结构和共享基础设施，后续所有渲染器、解析器和运行脚本复用。

**产物文件**：
- `experiments/format-encoding/package.json`、`tsconfig.json`、`vitest.config.ts`（不影响主套件）
- `experiments/format-encoding/lib/env.ts`：fail-fast 环境变量校验
- `experiments/format-encoding/lib/schema.ts`：C 类型定义（与 Stage 73.1 一一对应）
- `experiments/format-encoding/lib/diff.ts`：往返 diff 函数（实现 Stage 73.2 四条规则）
- `experiments/format-encoding/lib/corpus.ts`：从 ArchGuard ArchJSON 产物加载 C 实例（method 级）的加载器

**测试**：
- diff 函数单测：实体集合顺序无关、关系三元组等价、nullable 字段规则、id 规范化；每条规则正/反用例各一
- corpus 加载器单测：合法 ArchJSON → C 结构正确；缺字段时按 schema 默认值填充

**验收标准**：
- `cd experiments/format-encoding && npm install && npm test` 通过；
- 主仓库 `npm test`、`npm run type-check` 不受影响；
- `git grep -iE 'sk-|api[_-]?key\s*[:=]' experiments/format-encoding/` 无凭据字面量。

### Stage 75.2 — 8 个确定性渲染器

**目标**：实现 proposal §3.1 全部 8 种格式的纯函数确定性渲染器 $r_f: C \to \text{format}_f$，不增不删信息。

**格式集与渲染要求**：

| 格式 | 渲染要求 |
|---|---|
| JSON-邻接 | 嵌套 JSON，实体含 methods 数组 |
| JSON-边表 | 平坦：实体列表 + 关系列表，各为独立数组 |
| YAML | 缩进语义，与 JSON-邻接信息等价 |
| Markdown 表 | 实体表 + 关系表，标题行前置 |
| Mermaid | classDiagram / flowchart，箭头标注关系类型 |
| Haskell-ADT | record/ADT 构造子编码实体，类型化字段编码关系；method 详情须可还原（Q4 关键点） |
| 新造 DSL | 最小化语法，一行一条关系（`A -type-> B`）；实体单独声明块 |
| NL-穷举 | 无损逐边 prose 描述，语法固定（"Entity X of type Y has method Z(params) → returnType. X calls Y."）|

**产物**：`experiments/format-encoding/renderers/<format-name>.ts`（8 个文件）

**测试（每个渲染器）**：
- 空 C（无实体无关系）→ 不报错，输出合法空结构
- 小 fixture（3 实体 5 关系）→ 输出文本包含所有实体 id 与关系三元组
- 确定性：同输入两次输出逐字节相同
- 边界：method 含空 params / null returnType → 按 schema 默认值处理

**验收标准**：
- 全部 8 个渲染器单测通过（含空 C、小 fixture、确定性、边界四类用例）；
- 每个渲染器对小 fixture（3 实体 5 关系）的输出**非空**且**符合目标格式语法**（JSON 可被 `JSON.parse` 解析；YAML 可被 yaml 库解析；Mermaid 含 `classDiagram` 或 `flowchart` 关键字；Haskell-ADT 含 `data` 关键字；Markdown 含 `|` 表格行；新造 DSL 每行含 `->` 操作符；NL-穷举含 "Entity" 和 "calls" 字样）；
- 无任何渲染器依赖 LLM 或外部 HTTP 调用（纯函数，`grep -r 'fetch\|axios\|http' renderers/` 无结果）。

### Stage 75.3 — 8 个往返解析器 + 改写 prompt 冻结

**目标**：为每个格式实现往返解析器 $p_f$（将渲染产物解析回 C 结构），同时冻结 Exp 2 改写 prompt。

**产物**：
- `experiments/format-encoding/parsers/<format-name>.ts`（8 个文件）
- `experiments/format-encoding/freeze/rewrite-prompts/`（改写 prompt 文本，3 个目标格式 × 最终版本）

**解析器实现要求**：
- 每个解析器输出 C 结构（与 `lib/schema.ts` 类型一致）
- 解析失败（格式不合法）须抛明确错误，不得静默返回空 C
- **"改写-清理 prose"的往返解析器**：按 Q5 决策实现（LLM-as-parser 或人工抽样降级标注）；若选 LLM-as-parser，此处冻结解析 prompt 文本

**改写 prompt 冻结要求**（来自 §4.2）：
- 仅指定目标格式，**不允许**出现"补充"、"推断"、"删除模糊信息"等字样
- 每个改写 prompt 有对应的负面指令检查列表（防 H-info 污染）

**测试（每个解析器）**：
- `p_f(r_f(C_fixture)) === C_fixture`：以 diff 函数验证，小 fixture 全字段匹配
- 格式错误输入 → 解析器报明确错误（不静默）
- 改写 prompt smoke test：向 mock LLM 发送 prompt，验证 prompt 文本不含禁用字样

**验收标准**：
- 全部 8 个解析器单测通过（含往返等价、格式错误两类用例）；其中 `p_f(r_f(C_fixture)) == C_fixture` 对小 fixture 由 `diff.ts` 函数验证，全字段零偏差；
- 改写 prompt（3 个）最终文本落盘于 `freeze/rewrite-prompts/`；
- 禁用字样检查（无"补充""推断""删除"）通过；
- **本 Phase 全部 Stage 完成后，Phase 76 才可开始**。

---

## Phase 76 — 往返门控与冻结 Tag

**依赖**：Phase 75 完成。本 Phase 几乎无新代码（允许 ≤ 30 行修复胶水），主体是**实测往返验证**，然后打冻结 tag。

**纪律**：**本 Phase 完成（tag 打出）之前，不得发起任何 LLM 答题任务。**

### Stage 76.1 — 往返门控实测（Exp 1 主集合）

**目标**：对每个格式在真实 C 实例上运行 `p_f(r_f(C)) == C`，确保全部 8 个主集合格式无损。

**实测规程**：
- 对 ArchGuard method 级 C 实例（从 `corpus.ts` 加载，至少 5 个不同规模的实例）逐格式跑往返验证
- 对每个 `(格式, 实例)` 记录：通过/失败；若失败，diff 输出（按 Stage 73.2 规则）
- **Haskell-ADT 的 Q4 smoke test**：在此处实证验证 method 详情是否可还原；若往返有损 → 按 Q4 决策树处置（重设计格式或移至有损参照轨），任何处置均须记为偏差日志 `D-76.x`

**验收产物**：`experiments/format-encoding/artifacts/roundtrip/roundtrip-audit.md`（每格式 × 每实例的通过/失败记录）

**验收标准**：
- 主集合 8 格式在全部测试实例上往返通过（或偏差已记录并按 §7 规则处置，处置后通过）；
- Haskell-ADT Q4 结论明确落盘（主集合 / 有损参照轨）；
- 所有失败格式的偏差日志 `D-76.x` 已建档。

### Stage 76.2 — 改写 prompt 最终 Smoke Test

**目标**：对真实 C 实例向改写模型发送 k=1 改写请求，验证改写产物格式合法且改写 prompt 未触发 H-info 行为（未增删关系）。

**实测规程**（此为本 plan 中**唯一允许在 tag 前调用真实 LLM 的操作**——smoke test 不是实验任务，且是冻结门槛的组成部分，与 granularity plan 的泄漏探针地位等同）：
- 3 个改写臂（改写-Haskell / 改写-JSON / 改写-清理 prose）各取 1 个 C 实例，发 k=1 改写请求
- 对改写产物跑往返验证（`p_f(rewrite_output) == C`）；`C' != C` 则记录偏差并检查 prompt 是否含隐含"补充"语义

**验收产物**：`experiments/format-encoding/artifacts/roundtrip/rewrite-smoke.md`（原始问答 + 往返结果 + 是否触发 H-info 记录）

**验收标准**：
- 3 个改写臂 smoke test 均记录落盘；
- 若任何臂 `C' != C`，偏差已建档（`D-76.x`）且改写 prompt 已修订（修订后须重跑 smoke test）；
- smoke test 通过的改写 prompt 版本为最终冻结版本。

### Stage 76.3 — 协议冻结与 git tag

**目标**：锁定全部预注册材料，打 git tag，建立实验的不可逆分水岭。

**冻结规程**：
- 将以下文件列入冻结清单：`schema/C-schema.md`、`schema/diff-rules.md`、`freeze/pre-freeze-decisions.md`（含假设映射、格式集、臂设计、决策表、事前预测、偏差日志 schema）、`freeze/rewrite-prompts/`（最终版本）、`artifacts/roundtrip/roundtrip-audit.md`、`artifacts/roundtrip/rewrite-smoke.md`
- 计算上述文件的 SHA-256 哈希，落盘于 `freeze/frozen-hashes.json`
- **打 git tag**（如 `format-encoding-freeze-v1.1`）
- **tag 之后，Phase 75 的任何渲染器/解析器/改写 prompt 改动均须记为协议偏离**（在最终报告 §81.1 列出）

**验收标准**：
- git tag 存在且 tag 提交包含上述全部冻结文件；
- `frozen-hashes.json` 存在且可用于后续各 Phase 的哈希比对；
- **自此，Phase 77 方可开始**。

---

## Phase 77 — 协变量测量与事前预测落盘

**依赖**：Phase 76（tag）。77.1 与 77.2 可并行，但 77.3（事前预测 commit）依赖两者。

**纪律**：本 Phase 不发起任何 LLM 答题任务。协变量测量中的困惑度调用（若选 Q2 方案 A 或 C）不是答题任务，但须在此 Phase 完成。

### Stage 77.1 — 渲染所有格式并测量结构协变量

**目标**：对全部任务相关 C 实例渲染 8 种格式，测量 proposal §2.2 与 §3.5 规定的协变量。

**测量指标**：
- **总 token 数**（用 tiktoken 或等价工具，逐格式逐实例）
- **嵌套深度**（JSON/YAML/Haskell-ADT 最大嵌套层数）
- **每边 token 数**（relations 数目 / 总 token 数）
- **分隔符密度**（每 100 token 中分隔符字符数）
- **关键关系位置分布**：call 边与 inheritance 边在序列中的位置中位数；前 20% token 内出现的关键关系比例

**产物**：`experiments/format-encoding/artifacts/covariates/structural-metrics.json`（格式 × 实例 × 指标矩阵）

**验收标准**：所有 8 格式的全部协变量测量值落盘；token 测量工具版本记录在案；新造 DSL 的"简"的判定（词汇表大小 + 每关系 token 数）依照 Stage 74.2 预注册规则执行并落盘判定结果。

### Stage 77.2 — 困惑度测量（仅有 logprob 模型）

**目标**：按 Q2 选定方案，对有 logprob 的模型测量每种格式的困惑度（熟悉度代理）。

**操作规程**（按 Q2 决策）：
- **方案 A**（GPT-4o 代测）：向 GPT-4o API 发送 8 格式样本，计算 per-token log-prob 均值；记录：此困惑度为 GPT-4o 专属，不代表 Claude 熟悉度，在报告中标注
- **方案 B**（放弃困惑度）：跳过本 Stage，H-归因回归中困惑度列标记 NA
- **方案 C**（GPT-4o 为第三答题模型）：本 Stage 仅测 GPT-4o 的格式困惑度；答题阶段的 GPT-4o 调用在 Phase 78 执行

**产物**：`experiments/format-encoding/artifacts/covariates/perplexity.json`（若方案 A/C）或 `perplexity-skipped.md`（若方案 B，含跳过原因）

**验收标准**：困惑度结果（或跳过记录）落盘；无 logprob 模型明确标注 NA；测量时间戳记录在案。

### Stage 77.3 — 事前预测落盘（Phase 78 的硬前置）

**目标**：将 Stage 74.2 中锁定的 §3.6 事前预测（H1 / H-parse / H-pretrain / H-dense / H-interact / H-归因回归）以带时间戳的方式 git commit，作为"事前"的机械证明。

**产物**：`experiments/format-encoding/artifacts/predictions/pre-registered-predictions.json`（含每条假设的操作化判定条件、所用检验、阈值、时间戳）

**验收标准**：
- predictions commit 存在，commit 哈希与文件哈希记录在案；
- 此时 `artifacts/runs/` 为空（尚无任何 LLM 任务产物）——作为"事前"的机械证据；
- **自此 Phase 78 方可开始**。

---

## Phase 78 — Exp 1 全量运行 + Exp 2 改写步

**依赖**：Stage 77.3 已 commit；Phase 75（渲染器/解析器已冻结）。
**入口检查（强制）**：核对 `artifacts/predictions/` 的 commit 时间戳早于本 Phase 一切产物；核对 git tag 后工具零改动（有改动则列偏离清单）。

78.1（Exp 1）与 78.2（Exp 2 改写步）可并行，但 Exp 2 答题步（Phase 79）须在 78.2 完成后才可开始。

### Stage 78.1 — Exp 1 全量：8 格式答题任务

**目标**：运行 Exp 1 全部答题任务，获得每格式在 68（或 68+新题）任务上的准确率矩阵。

**运行规程**：
- `run-tasks.ts`（或等价脚本）：8 格式 × 任务集 × 答题模型 × k=5
- 参照轨（NL-摘要 + 原始源码）：若 Q1 未裁剪，一并运行
- 解析检查子任务（让模型把格式解析回 C 的子集）：若 Q1 未裁剪，一并运行
- 凭据仅经 `LLM_BASE_URL`/`LLM_API_KEY` 环境变量；断点续跑按 `(任务, 格式, 模型, k)` 键
- **max_tokens=8192**（来自 v2.2 D-71.2 教训，写入运行配置）
- 模型回退链按 Stage 74.2 预注册，不得临时替换（替换须记偏差日志）

**产物**：`experiments/format-encoding/artifacts/runs/exp1/`（原始响应 + 种子 + 采样参数）

**验收标准**：全部调用结果与种子/采样参数落盘；断点续跑日志完整（无重复计费）；**NL-穷举的答题数据同时标注为 Exp 2 基线臂数据**（双重角色，若 Exp 1 与 Exp 2 的 NL-穷举 prompt 等价，则不重复跑；不等价则分开跑并标注差异，来自 §3.1 架构师修订）。

### Stage 78.2 — Exp 2 改写步 + 往返验证

**目标**：运行 Exp 2 的三个改写臂（改写-Haskell / 改写-JSON / 改写-清理 prose），对改写产物跑往返验证，分离 H-info 实例。

**运行规程**：
- 3 改写臂 × 68 任务 × 改写模型 × k=5 改写
- 改写模型须与答题模型不同家族（来自 §4.2 强制要求），按 Stage 74.2 预注册的模型版本
- 对每个改写产物运行 `p_f(rewrite_output)`：
  - `C' == C`（往返通过）→ 标注为 H-rewrite 候选实例
  - `C' != C`（往返失败）→ **标注为 H-info 实例，移出等价比较，单列报告**；记偏差日志 `D-78.x`
- "改写-清理 prose"按 Q5 决策执行（LLM-as-parser 或人工抽样），结论强度标注

**产物**：
- `experiments/format-encoding/artifacts/runs/exp2-rewrite/`（改写产物 + 往返结果）
- `experiments/format-encoding/artifacts/runs/exp2-rewrite/h-info-instances.json`（H-info 实例清单）

**验收标准**：
- 全部改写产物带往返结果落盘；H-info 实例已单列；
- 偏差日志 `D-78.x` 建档完整；
- **本 Stage 完成后，Phase 79 方可开始**。

---

## Phase 79 — Exp 2 答题任务

**依赖**：Stage 78.2 完成（改写产物 + 往返验证通过的实例集已确定）。

### Stage 79.1 — Exp 2 全量：5 臂答题

**目标**：对 Exp 2 全部 5 臂（确定性-Haskell + 改写-Haskell + 改写-JSON + 改写-清理 prose + 基线）运行答题任务。

**运行规程**：
- 5 臂 × 68 任务（仅往返通过的实例）× 答题模型 × k=5
- 基线（NL-穷举）数据：若与 Stage 78.1 的 Exp 1 NL-穷举数据等价，直接复用，不重复跑
- 2×2 交叉设计（若 Q1 允许）：{改写家族 A，改写家族 B} × {答题模型 X，答题模型 Y}，按 Stage 74.2 预注册的统计检验逻辑执行
- 断点续跑按 `(任务, 臂, 模型, k)` 键；模型回退链按预注册，替换须记偏差日志

**产物**：`experiments/format-encoding/artifacts/runs/exp2-answers/`（原始响应 + 种子 + 采样参数）

**验收标准**：
- 全部调用结果落盘，含改写家族与答题模型的对应关系；
- H-info 实例（Stage 78.2 标注的）已从主比较中排除，单独存档；
- 断点续跑日志完整。

---

## Phase 80 — 统计检验、决策表判定与私有库复制

**依赖**：Stage 78.1（Exp 1 答题数据）、Stage 79.1（Exp 2 答题数据）。80.1 与 80.2 可并行。

### Stage 80.1 — Exp 1 统计检验与决策表判定

**目标**：对 Exp 1 结果运行预注册的统计检验，按 §3.8 决策表判定每条假设。

**检验清单**（来自 proposal §3.7）：
- **Friedman 检验**（8 格式主效应，α=0.05/BH-FDR）→ H1 判定
- **成对 Wilcoxon + BH-FDR 修正**（28 成对比较，q=0.05）→ H-parse / H-pretrain / H-dense 判定
- **Token 调整后排名分析**：控制 token 数后格式排名是否存活 → H-dense 精化（"密集编码本身有效 vs 仅省 token"）
- **混合效应回归**：`accuracy ~ 困惑度(若可测) + 解析负担 + tokens + 局部密度分布 + 任务类` → H-归因回归判定
- **格式 × 任务类交互**（A 类 vs B/C 类）→ H-interact 判定

**产物**：`experiments/format-encoding/artifacts/analysis/exp1-results.json`（每条假设的检验统计量 + 判定位 + BH-FDR 调整后 p 值）

**验收标准**：
- H1 / H-parse / H-pretrain / H-dense / H-interact / H-归因回归 各有明确判定位（成立/不成立/无法判定）；
- 决策表（§3.8）每行均有对应的判定结论；
- **负结果如实落盘**，不得仅报告显著结果。

### Stage 80.2 — Exp 2 统计检验与私有库复制

**目标**：对 Exp 2 结果运行统计检验，按 §4.4 决策表判定；在私有库数据集上复制 Exp 1 关键对比，验证泛化性。

**Exp 2 检验清单**（来自 §4.3 预注册推断逻辑）：
- **对比 1**：改写-Haskell vs 确定性-Haskell（往返通过实例）→ H-rewrite 判定（Wilcoxon）
- **对比 2**：三个改写臂互比（Wilcoxon + BH-FDR）→ 改写动作是否与记号无关
- **关键判别器**：改写-清理 prose vs 改写-Haskell → 是改写动作还是 Haskell 记号
- **2×2 交互效应**（若完整设计）：`rewriter_family × answer_model` 交互项 → 家族偏差判定
- **H-info 量化**：H-info 实例的准确率 vs 往返通过实例的准确率（信息变化量与提升量相关性）

**私有库复制**（来自 §3.4）：
- 对 1–2 个 TypeScript 私有库运行 Exp 1 关键对比（至少：JSON-邻接 vs Mermaid、Haskell-ADT vs JSON-边表）
- 若非 TypeScript 须确认等价 callgraph 工具（须在 Stage 74.2 已预注册）

**产物**：
- `experiments/format-encoding/artifacts/analysis/exp2-results.json`
- `experiments/format-encoding/artifacts/analysis/generalization-results.json`（私有库复制结果）

**验收标准**：
- §4.4 决策表每行有对应判定结论；
- 家族交互效应结论明确（显著 = 报各格，不显著 = 合并）；
- 私有库复制结果与 ArchGuard 结果方向一致性记录落盘；
- 偏差日志 `D-80.x` 建档完整（包含任何模型替换、数据排除记录）。

---

## Phase 81 — 最终报告

**依赖**：Phase 80 完成。

### Stage 81.1 — 报告与 Exp 3 预注册准备

**目标**：报告全部结果（含负结果），记录协议偏离，为后续 Exp 3 单独预注册提供输入。

**报告须包含（来自 proposal §9）**：

**Exp 1 产出**（须与 §3.8 决策表逐行对应）：
- **H1 判定**：格式主效应是否显著（Friedman p 值 + BH-FDR 修正后结论）
- **ArchGuard 默认数据格式建议**：H1 成立时给出最优格式 + 量化 Δ；H1 不成立时明确声明"当前规模格式效应不显著"
- **机制判定（H-parse / H-pretrain）**：H-parse 显著 / H-pretrain 不显著 → 解析负担为主因，工程行动：压平语法；H-pretrain 显著 / H-parse 不显著 → 熟悉度为主因，工程行动：对齐预训练分布；两者均显著 → 报相对权重
- **H-dense 判决**：token 调整后 Haskell-ADT 是否仍赢 JSON-边表（密集编码本身有效 vs 仅省 token）
- **H-interact 判定**：格式 × 任务类交互是否显著，若显著则格式路由须任务类感知
- 格式排名 + 每格式 token 数 + 各协变量系数（完整回归结果）

**Exp 2 产出**（须与 §4.4 决策表逐行对应）：
- **H-rewrite 判定**：改写-Haskell vs 确定性-Haskell（往返通过实例）—— 改写动作是否有净效应
- **记号无关性判定**：三个改写臂互比 —— 是"改写 pass 本身有效"还是"Haskell 记号有特异性"；关键判别器为改写-清理 prose vs 改写-Haskell 的对比
- **记号特异性结论**：若改写-Haskell > 改写-清理 prose，须回 Exp 1 确定性臂交叉确认（排除重构功劳）
- **H-info 实例单列报告**：往返不通过实例的数量与准确率对比（信息变化量与提升量的相关性）
- **改写家族交互效应**：2×2 设计中 `rewriter_family × answer_model` 交互项是否显著；若显著则报各格数字，结论须跨家族一致方可推广

**与 granularity-v2.2 的叠加**：v2.2 确定了"按任务类路由粒度"（A→L0，B/C→L3 method 级）；本实验给出"在最优粒度内用最优格式"的结论，两者组合为完整桥-设计规则。

**报告须包含的强制节**：
1. **协议偏离清单**：tag 后工具改动、哈希不一致、模型替换记录（含每次替换的 `D-x.y` 编号）、H-info 实例排除记录、作废重跑批次
2. **偏差日志汇总**：按 Stage 74.2 预注册的偏差日志 schema，列出全部 `D-<phase>.<seq>` 条目
3. **成本实数 vs 预估**：实际 LLM 调用量（Exp 1 + Exp 2）vs Phase 77 前估算
4. **开放问题探索性分析**（来自 §7，非验证性）：(1) Haskell-ADT 在哪些模型上困惑度反而比 Mermaid 低；(2) 格式 × 任务类 × 模型家族三方交互；(3) Exp 2 H-info 实例中信息增量的类型（边 vs 类型）
5. **已知局限声明**（若选 Q3 方案 A）：任务集与 v2.2 完全重叠，结论适用于该任务集，跨任务集泛化须独立验证
6. **Exp 3 输入节**：基于 Exp 1/2 结论，写明 Exp 3（指令编码实验）的设计建议与须在独立预注册中解决的约束（指令等价验证弱于数据往返等）

**产物**：`experiments/format-encoding/REPORT.md`（实验产物，非项目文档）

**验收标准**：
- 报告落盘于 `experiments/format-encoding/REPORT.md`；
- §3.8 与 §4.4 判定结论与决策表行号一一对应；
- 偏差日志汇总包含全部 `D-x.y` 条目（无遗漏）；
- 无任何"按结果改预测"痕迹（预测文件哈希与 Stage 77.3 commit 一致）；
- **Exp 3 输入节存在**，并明确声明 Exp 3 须另行独立预注册，本 plan 不覆盖其执行。

---

## 测试策略

**TDD**：Phase 75 全部渲染器/解析器/共享库先写测试再实现；TS 用目录内 vitest（`experiments/format-encoding/` 局部安装），Python（若有分析脚本）用 pytest。**覆盖率门槛：harness 源码 ≥ 80%**。

**关键单测点（必有）**：
- `diff.ts` 四条 diff 规则，每条正/反用例（Stage 75.1）
- 每个渲染器：确定性 + 边界 + fixture 全字段覆盖（Stage 75.2）
- 每个解析器：`p_f(r_f(C)) == C` + 格式错误报明确异常（Stage 75.3）
- 改写 prompt 的禁用字样检查（Stage 75.3）

**实测验证环节（非单测，以落盘证据验收）**：
- 往返门控全量实测（Stage 76.1）：真实 C 实例 × 8 格式
- Haskell-ADT Q4 smoke test（Stage 76.1）：method 详情还原验证
- 改写 prompt smoke test（Stage 76.2）：向真实改写模型发 k=1 请求
- 协变量测量（Stage 77.1–77.2）：token 数 + 困惑度
- 事前预测 commit 时间戳验证（Phase 78 入口检查）

**凭据纪律**：全部单测用 mock HTTP/LLM client，CI 可在无凭据环境运行；实跑脚本仅经 `LLM_BASE_URL`/`LLM_API_KEY` 环境变量取凭据，任何文件不落盘 key。

---

## 关键 Gate 汇总

| Gate | Phase | 触发条件 | 失败处置 |
|---|---|---|---|
| **Q1–Q5 全部决策落盘** | 74.1 | 进入 Stage 74.2 前 | 补齐决策后方可继续 |
| **往返门控通过** | 76.1 | 任意格式往返失败 | 修复渲染器/解析器，重跑往返门控；记偏差日志；若 Haskell-ADT 有损则移至参照轨并调整 §3.3 对比设计 |
| **改写 prompt smoke test 通过** | 76.2 | 改写产物 `C' != C` 且疑似 prompt 含隐含补充语义 | 修订 prompt，重跑 smoke test；记偏差日志 |
| **冻结 tag 打出** | 76.3 | tag 前 | LLM 任务不得开始；任何 Phase 75 工具改动须记偏差日志 |
| **事前预测 commit 完成** | 77.3 | Exp 1/2 运行前 | `artifacts/runs/` 必须为空才算"事前" |
| **H-info 实例分离** | 78.2 | 改写产物往返失败 | 该实例移出等价比较，单列 H-info 报告；记偏差日志 |
