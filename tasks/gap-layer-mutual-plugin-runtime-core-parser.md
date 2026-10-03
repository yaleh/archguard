---
id: gap-layer-mutual-plugin-runtime-core-parser
title: plugins/shared 与 core、parser 互指：先由人裁定解析运行时类型归属，再消除两条分层违例
status: ready
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

后两条与前两条构成目录级互指。影响范围大：`ParserSession` 有 28 个依赖者、`SyntaxNodeLike` 有 40 个（`archguard_summary` 实测）；按文件计，`src` 下有 34 个文件、连同 `tests` 共 102 个文件 import `syntax-tree`/`parser-backend`/`parser-runtime` 三个模块（2026-10-02 grep 实测）。

**裁定 A 落地前的已验证事实（2026-10-03，读代码确认，会改变做法）**：

1. `syntax-tree.ts` 没有任何 import，是纯类型，可整体下移。
2. `parser-backend.ts` 与 `parser-runtime.ts` **不是纯类型**：`parser-backend.ts` 在 `resolveParserBackend` 里动态 `import('./wasm-parser-backend.js')`、`import('./native-parser-backend.js')`；`parser-runtime.ts` 静态 import `native-parser-backend.js` 并动态 import `wasm-parser-backend.js`。这两个具体后端依赖 tree-sitter 原生/WASM 绑定。若按原文把这两个文件整体搬进 core，core 要么直接依赖 tree-sitter 绑定，要么反过来 import `plugins/shared` 的具体后端——互指不会消失，只是换了位置。
3. core、parser 对这两个文件的**值依赖**只有两处：`src/core/rule-engine/rule-based-plugin.ts` 用 `selectParserBackendFor`（来自 `parser-runtime.ts`），`src/parser/parse-worker.ts` 用 `resolveParserBackend`（来自 `parser-backend.ts`）。其余 core/parser 文件对这三个模块都是 type-only。
4. 仓库里已存在**另一个** `ParseError`：`src/core/interfaces/errors.ts:104`（`extends PluginError`），与 `src/parser/errors.ts` 的（`extends Error`，带 `filePath/line/column`）不是同一个类。`plugins/shared/query-loader.ts` 用的是后者。不得把两者合并，除非逐个确认构造签名与调用点语义一致。

## 人的裁定

**已裁定：方案 A，并确认细化 A'**（用户，2026-10-03）：把 `plugins/shared` 里与具体语言无关的解析运行时部分下移到 core 层（`src/core/parser-runtime/`），`plugins/shared` 只保留插件工厂、查询加载等"插件胶水"；旧路径保留类型 re-export，分批迁移。细化 A' 已获同意，内容如下：

- 下移到 `src/core/parser-runtime/` 的只有**接口层**：`syntax-tree.ts` 全部；`parser-backend.ts` 里的类型（`ParserBackend`、`ParserLanguage`）与 `ParserInitializationError`；`parser-runtime.ts` 里不依赖具体后端的类型与策略判断。
- **具体后端与选择逻辑留在 `plugins/shared`**：`native-parser-backend.ts`、`wasm-parser-backend.ts`、`resolveParserBackend`、`selectParserBackendFor` 及其对具体后端的 import。
- core、parser 里那两处值依赖（`rule-based-plugin.ts`、`parse-worker.ts`）改为**依赖注入**：core 层定义一个 `ParserBackendResolver` 之类的端口接口，由组合根（插件装配处，位于 plugins/cli 层）把 `plugins/shared` 的实现注入，core/parser 不再 import `plugins/shared`。这是本任务里唯一涉及运行时装配的改动，需要保持行为不变。
- `ParseError`：不合并两个同名类。把 `src/parser/errors.ts` 的 `ParseError` 原样迁到 `src/core/parser-runtime/parse-error.ts`（保持类名与构造签名），`src/parser/errors.ts` 改为 re-export；`plugins/shared/query-loader.ts` 从 core 路径 import。
- 分批：先迁文件并在旧路径留 re-export（零导入点改动，测试不改）；再把 core、parser、plugins 的 src 导入点切到新路径（只切违例相关的，使 `core/parser -> plugins/shared` 的边消失）；测试文件保持旧路径 re-export，不在本任务内批量改。

## AC

- [x] 用户已确认上面的细化 A'，且任务状态已由人改为 todo（2026-10-03）
- [x] 位置判定下 `src/core/**`、`src/parser/**` 不再 import `@/plugins/shared`：`grep -rnE "^\s*(import|export)[^;]*from '(@/plugins/shared|(\.\./)+plugins/shared)" src/core src/parser` 无输出（退出码 1）
- [x] 位置判定下 `src/plugins/shared/**` 不再 import `@/parser`：`grep -rnE "^\s*(import|export)[^;]*from '(@/parser|(\.\./)+parser)" src/plugins/shared` 无输出（退出码 1）
- [x] 重新 `node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/<dir>` 后，从 `overview/package.json` 的 `moduleGraph.edges` 取目录边，`src/plugins/shared*` 与 `src/core*`、`src/parser*` 之间不同时存在两个方向的边；`moduleGraph.cycles` 中不再有同时含 `src/plugins/shared` 与 `src/core` 的环（修前该环包含二者）
- [x] `src/core/parser-runtime/` 下的文件不 import `tree-sitter`、`web-tree-sitter` 或任何 `plugins/shared` 具体后端：`grep -rnE "tree-sitter|native-parser-backend|wasm-parser-backend" src/core/parser-runtime` 无 import 语句命中（注释除外，按位置判定）
- [x] `tests/unit/architecture/layer-imports.test.ts` 扩展：新增断言 `src/core/**`、`src/parser/**` 不 import `plugins/shared`，`src/plugins/shared/**` 不 import `parser`，保持成对负对照（违规文本报违例、只在注释里提到路径不报）；运行 `npx vitest run tests/unit/architecture/layer-imports.test.ts` 退出码 0
- [x] 运行行为不变：解析路径的现有单测（含 parse-worker、rule-engine、query-loader 相关）不改动仍通过，`npm run type-check` 与 `npm test` 全量通过
- [x] `docs/experiments/layer-map/layers.yml` 的 `allowed` 与 `known_violations` 同步更新（`plugin-runtime -> core`、`plugin-runtime -> parser` 改为允许方向，移除对应基线项，删掉 `core -> plugin-runtime`、`parser -> plugin-runtime`），并用 `node docs/experiments/layer-map/check-layers.mjs <新分析的 overview/package.json>` 验证退出码 0 且无已消除的基线项残留

## DoD

完成的标准不是"文件搬完"，而是在重新构建后的真实 archguard 上重新分析，`plugins/shared` 与 core、parser 之间的目录级互指消失（边只剩 `plugins/shared` 向下依赖 core/parser 的单向），`moduleGraph.cycles` 里不再同时含这两组目录，core 层没有引入对 tree-sitter 具体后端的依赖，并且解析运行行为不变（全量测试套件通过，且对本仓库自身重新执行一次 `analyze` 的实体数与修前一致）。

## Touches

- src/core/rule-engine/ast-node.ts
- src/core/rule-engine/rule-based-plugin.ts
- src/core/rule-engine/rule-engine.ts
- src/core/parser-runtime/syntax-tree.ts
- src/core/parser-runtime/parser-backend.ts
- src/core/parser-runtime/parser-runtime.ts
- src/core/parser-runtime/parse-error.ts
- src/parser/errors.ts
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
- docs/experiments/layer-map/layers.yml
- tasks/gap-layer-mutual-plugin-runtime-core-parser.md
