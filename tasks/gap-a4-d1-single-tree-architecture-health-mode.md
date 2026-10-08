---
id: gap-a4-d1-single-tree-architecture-health-mode
title: A4 Phase D1：给 arch-layer-review 加 single-tree / architecture-health
  问题集（不改既有 before/after 四问）
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
---
## Proposal

`docs/proposals/proposal-architecture-layer-check.md` 的「Phase D1」一节已在 2026-10-08 追加「Single-tree / Architecture-Health 模式」小节（见该文件该节全文），裁定内容：既有 `arch-layer-review` skill（`gap-a4-d1-semantic-review-skill`，已 done）的四类 MVP 问题全部假设"有一次具体改动"（旧实现 vs 新实现）才能判断；对 archguard 自身做 Phase D1 dogfooding 自查时实测到，没有 before/after 时，"orchestrator domain state"与"shell move vs real move"两问结构性答不出来（不是证据不够，是问题本身没有可比较对象），只能标 `not-evaluated`；同时发现 `check-layers.mjs` 的 `pass` 对**同层环**（如 archguard 自身 `src/cli` 内部 10 目录、31 条边、89 值依赖的真实环）结构性不可见——它只比较跨层边。这是一个单纯问"这棵树现在架构健不健康"都答不出来的缺口，不是"要不要 before/after"的缺口。

本任务落地 proposal 新增小节定义的**第二套问题集**，与原四问并存（不替代、不删除、不修改原四问的任何文字），供"单棵树体检"场景使用：

1. **跨层环覆盖**：每个跨层环的成员对是否在 `layers.yml` 的 `allowed` 里有声明；有声明是设计选择（如 archguard 自身 `plugin-runtime <-> plugins` 的动态装配边，已用 `src/plugins/shared -> src/core/parser-runtime` 强度10 等真实边验证过），要标注清楚、不算违例；没有声明但 `check-layers.mjs` 碰巧判 `pass` 的要显式指出是覆盖缺口。
2. **同层环暴露**：对 `moduleGraph.cycles` 里每个环，判断成员是否全部同层；全部同层的环必须单独列出并标注"declared rules 对此环未评估"（dogfooding 实测的例子：archguard 自身 `src/cli` 10 目录环，`check-layers.mjs` 报 pass 但对它完全没有评估力）。
3. **叶子层纯净度**：对声明中应为叶子的层/目录（典型命名 `utils`/`types`/`shared`），检查其出边是否存在"反向进入调用方所在环"的边（dogfooding 实测例子：`src/cli/utils -> src/cli/analyze`（值）、`-> src/cli/processors`（type-only），已另立 `gap-cli-utils-leaf-dependency-cleanup` 去修——本任务只落地"检测"这一问，不负责修复具体代码）。
4. **声明覆盖缺口**：`check-layers.mjs` 的"未映射目录"列表及其 `entityCount` 占全树比例。

**三层分区与输出契约不变**：仍是 `facts`/`declaredRules`/`judgment` 三个顶层 key，`judgment` 仍四态、仍要求非空 `evidence`、仍不得出现 `pass`/`fail`/`exitCode` 字段名——这四条新问题只是在同一个契约下多了一组 `question`，不是新的输出形态。

<!-- dedup-ref -->
依赖 `gap-a4-d1-semantic-review-skill`（已 done，落地了 skill 本体与既有四问）；与 `gap-cli-utils-leaf-dependency-cleanup`（本任务发现的叶子纯净度问题 3 的一个真实实例，正在修复代码）不是同一机制——那个任务改 `src/cli` 的实际代码，本任务只扩展检测用的 skill 文档和示例，互不重叠。

## AC

- [x] `.claude/skills/arch-layer-review/SKILL.md` 新增一节（可命名"Single-tree / Architecture-Health Mode"或等价标题），正文同时包含以下关键词（grep 可核对）：`cross-layer`（或"跨层环覆盖"）、`intra-layer`（或"同层环暴露"）、`leaf`（或"叶子层纯净度"）、`coverage gap`（或"声明覆盖缺口"）；且该节明确写出"与 before/after 四问并存，不替代"这句话的等价表述
- [x] `SKILL.md` 原有四问（ownership convergence/responsibility migration/orchestrator domain state/shell move vs real move）的文字**逐字未被改动**——用 `git diff` 核对本次改动只在 `SKILL.md` 里新增内容，没有删除或改写原四问段落
- [x] 新增 `.claude/skills/arch-layer-review/references/archguard-selfreview-example-output.json`：合法 JSON，顶层字段仍是 `facts`/`declaredRules`/`judgment` 三个 key；`judgment` 数组覆盖上面 4 类新问题，每条有非空 `evidence`；至少一条 evidence 直接引用 2026-10-08 dogfooding 的真实读数（`src/cli/utils -> src/cli/analyze` 或 `-> src/cli/processors` 边、或 `src/plugins/shared -> src/core/parser-runtime` 边、或 archguard 自身 `src/cli` 10 目录环），不是泛化占位文本
- [x] 上一条 example JSON 同样不得出现 `"exitCode"`、`"pass":`、`"fail":` 这三类字段写法（与既有 `goal-030-example-output.json` 的同一条约束一致）
- [x] `tests/unit/skills/arch-layer-review-skill.test.ts` 新增断言覆盖：(a) 新 example JSON 文件存在且可解析，满足三个顶层 key + evidence 非空；(b) 新 example JSON 不含 `exitCode`/`pass`/`fail` 字段名；(c) `SKILL.md` 文本包含上面列出的新增关键词；(d) `SKILL.md` 原有四问关键词断言（`ownership`/`orchestrator`/`domain state`/"搬壳"或"搬文件"）仍然存在——防止本任务改坏了既有断言
- [x] `npm test`（或该测试文件的 scoped 等效命令）全绿，`npm run type-check` 通过

## DoD

不是"加了一段 Markdown + 一份 JSON + 测试绿"就算完成。必须额外证明：

1. **新问题集是对 dogfooding 实测发现的真实回应，不是凭空扩写**：example JSON 里引用的至少一条 evidence 必须能对应回本次会话已经做过的 archguard 自身 `analyze` 读数（cli 环成员、cli/utils 的两条反向边、plugin-runtime/plugins 的双向 allowed 边），而不是重新编造的占位数据。
2. **没有破坏原四问的任何既有契约**：`git diff` 必须证明本次改动是纯追加（原四问文字、原 `goal-030-example-output.json`、原测试断言全部原样保留），不是重写 `SKILL.md`。
3. **没有新增确定性检查器代码**：本任务只扩展 prompt/文档/示例，不写任何新脚本——如果实施中发现"这四问里有一条需要新写代码才能机械判断"，先停下来判断这是否越过了 D1 的边界（多半意味着这一问本该是阶段 2–4 的确定性检查器职责，不该塞进这个纯编排 skill），不要顺手加代码。

## Touches

- .claude/skills/arch-layer-review/SKILL.md
- .claude/skills/arch-layer-review/references/archguard-selfreview-example-output.json
- tests/unit/skills/arch-layer-review-skill.test.ts
- tasks/gap-a4-d1-single-tree-architecture-health-mode.md
