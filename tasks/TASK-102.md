---
id: TASK-102
title: "TASK-102: 函数体重复检测（v1：归一化结构哈希，独立按需扫描，不扩大 Entity 模型）"
status: ready
labels:
  - gap
  - feature
  - analysis
parent: null
children: []
extra: {}
---
## Proposal

09-24 的一次真实任务是「找项目里的重复函数」，archguard 没有函数体重复检测，最后不得不改用自写的 TypeScript 编译器抽取脚本：脚本得到 15359 个实体，archguard 对同一目录只有 3525 个。

## Finding

`src/parser/function-extractor.ts`（源码核实）只抽取**导出**的顶层函数：导出的 `function` 声明，以及导出的 `const` 箭头函数 / 函数表达式。没有进入实体的是：未导出的函数、嵌套函数、类方法（作为类实体的 member 存在，不是独立实体）、对象字面量方法。因此 3525 对 15359 的差距很可能主要来自这些，而不是箭头函数语法本身。差距的具体构成尚未测量：实现的第一步就是用同一批文件分别统计各形态的数量，写进本节的 `## Evidence`。

## Design

选定（用户 2026-09-25 确认）：v1 只做精确结构重复（Type-1/2），近似重复（Type-3，n-gram Jaccard）留到 v2。
1. **不扩大 Entity 模型。** 把所有函数升为实体会让实体数从约 3.5k 涨到约 15k，冲击所有图、指标、聚类与缓存。`function-extractor.ts` 保持不变；重复检测是独立的函数体索引，落盘到 `.archguard/query/duplicates/`（参照 `src/analysis/shape-smells/persistence.ts` 的先例）。
2. **独立、按需的一遍扫描，不进 analyze 主路径。** 提取层放在 parser 层（`src/parser/function-fingerprint.ts`，ts-morph 只做语法解析、不做类型解析，覆盖函数声明、箭头函数、函数表达式、方法、嵌套函数）；分组与持久化放在 `src/analysis/duplicates/`。扫描范围取 manifest 中 scope 的 `sources`。代价是多解析一遍；好处是不改解析缓存格式、不拖慢常规 analyze。
3. **判据：归一化 AST 的结构哈希。** 局部变量与参数按首次出现顺序编号、字面量按类型占位、去掉注释与空白；被调用函数名与属性名**保留**（它们体现语义，归一化掉会大量误报）。按哈希分组，结果确定、可解释。
4. **误报控制：** 默认 `minStatements=6` 且 `minTokens=50`（可调）；排除测试文件（`*.test.*`、`*.spec.*`、`tests/`）、`.d.ts`、`dist/`；排除重载签名。
5. **输出：** MCP 工具 `archguard_detect_duplicates`（参数 `scope`、`minStatements`、`minTokens`、`topN`、`includeTests`），返回重复组：哈希、归一化 token 数、成员（file、startLine、endLine、name、kind），按「可省行数」`(成员数-1) × 行数` 降序。CLI 侧在 `query` 命令加 `--duplicates`（不使用 ADR-007 的 `adr-ok` 豁免，因为「找重复函数」本就是命令行场景）。

<!-- dedup-ref -->
与 TASK-96 无关：那里是既有工具对 TS 失效，这里是新增能力。TASK-101 的正对照测试文件届时追加重复函数的正对照。

## Evidence

### 函数形态统计（本仓库 `src/`，293 个非测试 `.ts` 文件，排除 `.d.ts`/`dist`/测试）

同一批文件上，用 ts-morph 遍历全部带函数体的函数类节点（与 `query --duplicates` 的 `scannedFunctions=2286` 一致），按 形态 | 嵌套 | 导出 分类：

| 形态 | 顶层/嵌套 | 导出 | 数量 |
|---|---|---|---|
| function 声明 | 顶层 | 导出 | 237 |
| function 声明 | 顶层 | 未导出 | 182 |
| function 声明 | 嵌套 | 未导出 | 1 |
| 箭头函数 | 顶层 const | 未导出 | 13 |
| 箭头函数 | 嵌套（回调等） | 未导出 | 900 |
| 函数表达式 | 嵌套 | 未导出 | 1 |
| 类方法 | 顶层类 | 导出类 | 853 |
| 类方法 | 顶层类 | 未导出类 | 6 |
| 构造函数 | 顶层类 | 导出类 / 未导出类 | 76 / 2 |
| get/set 访问器 | 顶层类 | 导出类 | 13 |
| 对象字面量方法 | 嵌套 | 未导出 | 2 |
| **合计** | | | **2286** |

`FunctionExtractor.extract()` 在这批文件上产出 **237** 个实体，恰等于「导出的顶层 function 声明」一行：本仓库没有导出的箭头 const，所以 extractor 只看到 237 / 2286 ≈ 10.4%。

### 与 3525 / 15359 的差距解释

差距不来自箭头函数语法：extractor 支持导出的箭头/函数表达式 const，只是它们只占很小一部分。缺口由四类**结构性不可见**的函数构成，在本仓库上按占比：类方法+构造函数+访问器 942（41.2%）——作为类实体的 member 存在而非独立实体；嵌套箭头/回调 900（39.4%）；未导出的顶层 function 182 + 箭头 13（8.5%）；其余嵌套 function/表达式/对象字面量方法 4。用户那次 3525 vs 15359（23%）的比例与此同量级：可见集合只是「导出的顶层函数」，缺口主要是类方法、嵌套回调与未导出函数，与 Finding 的推断一致。

### 实体数不变的证明（DoD）

`git diff develop -- src/parser/function-extractor.ts` 为空。用 develop 构建的 dist 与本任务构建的 dist，分别对同一目录（本 worktree 的 `src/`）跑 `analyze -s <src> -f json --no-cache`：两边 `class/all-classes.json` 均为 779 实体 / 2186 关系（function 237、interface 391、class 151），逐行 diff 只有 `timestamp` 一行不同。

### 自检：本仓库上的重复组（DoD）

`node dist/cli/index.js query --duplicates`（scannedFiles=293，scannedFunctions=2286，totalGroups=9）。按可省行数最高的若干组，人工对读源码后确认为真重复：

- `src/mermaid/validator-quality.ts:286` `calculateNestingDepth` ≡ `src/mermaid/validator-render.ts:142` `calculateNestingDepth`（15 行，逐字符相同：按 `{`/`}` 计数求最大嵌套深度）。**核对结论：确为重复。**
- `src/parser/parallel-parser.ts:378` `deduplicateRelations` ≡ `src/parser/typescript-parser.ts:393` `deduplicateRelations`（14 行，按 `type:source:target` 去重）。**核对结论：确为重复。**

另有 `resolveAbsoluteImport`/`resolveToKnown`（python 插件）、`compare`（fitness/gim）等，属于「变量名/被调用名不同但结构相同」的 Type-2 组，未逐一核对。

## AC

- [x] 本文件 `## Evidence` 小节记录同一批文件上各函数形态（导出/未导出、顶层/嵌套、方法、对象字面量方法）的数量，并解释与 3525 / 15359 的差距（`grep -n "^## Evidence" tasks/TASK-102.md` 有结果）
- [x] `npx vitest run tests/unit/parser/function-fingerprint.test.ts` exit 0：标识符不同、结构相同的两个函数得到相同哈希；结构不同（含不同的被调用函数名）得到不同哈希；覆盖嵌套函数与方法
- [x] `npx vitest run tests/unit/analysis/duplicates/duplicates.test.ts` exit 0：植入 2 份相同函数体的 fixture 报出 1 个重复组；低于 `minStatements` / `minTokens` 的不报；测试文件默认排除，`includeTests:true` 时纳入；组按可省行数降序
- [x] `npx vitest run tests/unit/cli/mcp/tools/duplicate-tools.test.ts` exit 0：MCP 工具返回结构与参数生效；scope 不存在时返回明确错误而不是空结果
- [x] `node dist/cli/index.js query --duplicates` 在本仓库上 exit 0（先 `npm run build`），输出为合法 JSON
- [x] `npm run check:adr` exit 0
- [x] `npm run type-check && npm run lint` exit 0

## DoD

对本仓库自身实际运行 `archguard_detect_duplicates` 与 `query --duplicates`，输出中至少有一组经人工核对确为重复的函数（在 `## Evidence` 里贴出该组的成员与核对结论）；`function-extractor.ts` 与既有实体数、图输出不因本任务改变（用改动前后同一目录的实体数对比证明）。

## Touches

- `src/parser/function-fingerprint.ts`
- `src/analysis/duplicates/types.ts`
- `src/analysis/duplicates/group.ts`
- `src/analysis/duplicates/persistence.ts`
- `src/cli/mcp/tools/duplicate-tools.ts`
- `src/cli/mcp/mcp-server.ts`
- `src/cli/commands/query.ts`
- `tests/unit/parser/function-fingerprint.test.ts`
- `tests/unit/analysis/duplicates/duplicates.test.ts`
- `tests/unit/cli/mcp/tools/duplicate-tools.test.ts`
- `tasks/TASK-102.md`
