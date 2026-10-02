---
id: gap-layer-mutual-plugin-runtime-core-parser
title: plugins/shared 与 core、parser 互指：先由人裁定解析运行时类型归属，再消除两条分层违例
status: needs-human
labels:
  - gap
  - refactor
  - architecture
  - needs-ruling
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-layer-violations-relocate-misplaced-types
---
## Proposal

2026-10-02 对 archguard 自身做目录级分层检查，`src/plugins/shared`（解析运行时、语法树类型、插件工厂）与 `src/core`、`src/parser` 互相依赖：

- `core -> plugins/shared`：`src/core/rule-engine/{ast-node,rule-based-plugin,rule-engine}.ts` 依赖 `@/plugins/shared/syntax-tree.js`、`parser-backend.js`、`parser-runtime.js`（`SyntaxNodeLike`、`ParserSession`、`selectParserBackendFor` 等）。
- `parser -> plugins/shared`：`src/parser/{parse-worker,parse-worker-pool,process-parse-worker-pools,parallel-parser}.ts` 依赖 `@/plugins/shared/syntax-tree.js`、`parser-backend.js`。
- `plugins/shared -> core`（type-only）：`src/plugins/shared/plugin-factory.ts` 依赖 `@/core/interfaces/language-plugin.js`（`ILanguagePlugin`）。
- `plugins/shared -> parser`（**值依赖**）：`src/plugins/shared/query-loader.ts` 依赖 `@/parser/errors.js`（`ParseError`）。

后两条与前两条构成目录级互指，`archguard_detect_cycles(outputScope=package)` 会把它们报出。影响范围大：`ParserSession` 有 28 个依赖者、`SyntaxNodeLike` 有 40 个（`archguard_summary` 实测）；按文件计，`src` 下有 34 个文件、连同 `tests` 共 102 个文件 import `syntax-tree`/`parser-backend`/`parser-runtime` 三个模块（2026-10-02 用 grep 实测）。所以这不是机械搬迁，**需要人先裁定"解析运行时类型归哪一层"**，不允许 worker 自行决定。

候选方案（起草供裁定，非结论）：

- **A（推荐起草）**：把 `plugins/shared` 里与具体语言无关的解析运行时部分（`syntax-tree.ts`、`parser-backend.ts`、`parser-runtime.ts`）下移到 core 层（如 `src/core/parser-runtime/`），`plugins/shared` 只保留插件工厂、查询加载等"插件胶水"；`ParseError` 下移到 `src/types` 或 core。结果：core/parser/plugins 都只依赖 core，`plugins/shared -> core/parser` 变成合法的向下依赖。代价：上述 34 个 src 文件和 102 个含测试的文件要改导入，应在旧路径保留类型 re-export 分批迁移。
- **B**：保持 `plugins/shared` 为最底层，把 `src/core/rule-engine` 整体移出 core（并入 plugins 层）。代价：rule-engine 被 core/query 等引用的地方要核实，且违背 "core 放通用引擎" 的现有意图。
- **C**：接受互指并在 `layers.yml`（或等价声明）里把 core、parser、plugins/shared 合并成一层，只靠守卫禁止它们依赖 cli/mermaid/analysis。代价：层级粒度变粗，放弃目录级互指的检出。

## 人的裁定

（待填：选 A/B/C 或其他方案；若选 A，写明目标目录名与是否分批迁移。裁定写入后，把本任务状态改为 todo 并按所选方案补全 AC 的具体命令。）

## AC

- [ ] 人的裁定已写入上面"## 人的裁定"一节，且任务状态已由人改为 todo（本项未满足前，worker 不得开始实现）
- [ ] 按裁定实施后，位置判定下 `src/plugins/shared/**` 对 `@/core`、`@/parser` 的值依赖与类型依赖，以及 `src/core/**`、`src/parser/**` 对 `@/plugins/shared` 的依赖，不再构成互指：重新分析后从 `moduleGraph.edges` 取目录边，`src/plugins/shared*` 与 `src/core*`、`src/parser*` 之间不同时存在两个方向的边
- [ ] 重新分析后 `moduleGraph.cycles` 中不再包含同时含 `src/plugins/shared` 与 `src/core` 的环（修前该环包含二者；以实测为准）
- [ ] 若采用分批迁移，旧路径保留类型 re-export，且 `npm run type-check` 与 `npm test` 全量通过
- [ ] 新增的方向守卫测试（沿用 gap-layer-violations-relocate-misplaced-types 的 `tests/unit/architecture/layer-imports.test.ts`）扩展覆盖本任务裁定的方向，并带成对负对照

## DoD

必须先有人的裁定。完成的标准不是"文件搬完"，而是在重新构建后的真实 archguard 上重新分析，`plugins/shared` 与 core、parser 之间的目录级互指消失（边只剩单向），`archguard_detect_cycles(outputScope=package)` 返回的环里不再同时含这两组目录，并且全量测试套件通过、运行行为不变。如果裁定选 C（接受互指），则 DoD 改为：层声明已更新并经人确认，守卫测试固化了新的允许方向。

## Touches

- src/core/rule-engine/ast-node.ts
- src/core/rule-engine/rule-based-plugin.ts
- src/core/rule-engine/rule-engine.ts
- src/parser/parse-worker.ts
- src/parser/parse-worker-pool.ts
- src/parser/process-parse-worker-pools.ts
- src/parser/parallel-parser.ts
- src/plugins/shared/plugin-factory.ts
- src/plugins/shared/query-loader.ts
- src/plugins/shared/syntax-tree.ts
- src/plugins/shared/parser-backend.ts
- src/plugins/shared/parser-runtime.ts
- tests/unit/architecture/layer-imports.test.ts
- tasks/gap-layer-mutual-plugin-runtime-core-parser.md
