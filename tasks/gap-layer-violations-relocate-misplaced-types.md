---
id: gap-layer-violations-relocate-misplaced-types
title: 消除 3 条分层违例 analysis→cli、core→mermaid、core→cli：把放错层的类型和常量下移，并加方向守卫测试
status: done
labels:
  - gap
  - refactor
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-02 对 archguard 自身做目录级分层检查（取边自 `extensions.tsAnalysis.moduleGraph.edges`，违例边再按位置扫描源文件行首的 import/export 语句，并用独立 grep 核对），在 CLAUDE.md 的三层架构（types/utils < core、parser < plugins、mermaid < analysis < cli）下发现 3 条"低层依赖高层"的违例，全部是**类型或常量放错了层**，不是真实的运行时耦合：

1. `analysis -> cli`（3 个文件、4 条 import，其中 3 条 type-only、1 条值依赖）：
   - `src/analysis/metric-vector-builder.ts` type-import `PackageStatEntry`（该类型已定义在 `src/core/query/arch-metrics-structure.ts`，应直接从 core 取）。
   - `src/analysis/git-history/history-query.ts` type-import `LoadedHistoryData`（定义在 `src/cli/git-history/history-loader.ts`；该类型是分析层的数据形状，应下移到 `src/analysis/git-history/`，cli 的 loader 反过来 import 它）。
   - `src/analysis/metrics-history-reader.ts` 同时 type-import `MetricsHistoryEntry`、**值依赖** `MetricsHistoryWriter`（只用了静态常量 `MetricsHistoryWriter.FILENAME`）；来自 `src/cli/metrics-history-writer.ts`。应把 `MetricsHistoryEntry` 与文件名常量下移到 analysis（或 types），cli 的 writer 反过来 import。
2. `core -> mermaid`（type-only）：`src/core/interfaces/renderer-facade.ts` import `MermaidOutputOptions`、`RenderJob`，定义在 `src/mermaid/diagram-generator.ts`。这是接口层反向依赖实现层：类型应定义在 `src/core/interfaces/`（或 `src/types`），`src/mermaid/diagram-generator.ts` 反过来 import（mermaid -> core 是允许的方向）。
3. `core -> cli`（type-only）：`src/core/query/query-engine.ts` import `QueryScopeEntry`，定义在 `src/cli/query/query-manifest.ts`。`QueryScopeEntry` 是查询引擎自己的入参形状，应下移到 `src/types`（或 `src/core/query`），`query-manifest.ts` 改为从下层 import 并保持原导出路径可用（类型 re-export），避免一次性改完全部 5 个 src 导入点和多个测试文件。

方案原则：只搬类型/常量，不改任何运行时行为；旧路径保留类型 re-export 以缩小改动面；搬完后用测试把方向固化成守卫，防止回退。

守卫测试（本任务新增）：`tests/unit/architecture/layer-imports.test.ts`，递归读取 `src/**/*.ts`，按**位置**（行首的 `import`/`export ... from`，跳过注释行）解析 `@/...` 与相对路径，断言：`src/analysis/**` 不 import `src/cli/**`；`src/core/**` 不 import `src/cli/**`、`src/mermaid/**`。**不要用关键词 grep**：注释里提到路径不算依赖（另一项目曾因关键词 grep 把注释当 import 产生误报）。此守卫不覆盖 `plugins/shared` 与 core/parser 的互指，见 gap-layer-mutual-plugin-runtime-core-parser。

不在本任务范围：`plugins/shared` ↔ `core`/`parser` 的互指（需要人先裁定解析运行时类型归哪一层）；`src/parser -> @/types` 一条别名未解析边（目录级图里看不见）。

关联（追溯用，非前置）：gap-layer-mutual-plugin-runtime-core-parser；分层检查的原型与证据见 docs/experiments/layer-map/（目前在 author 分支未提交，本任务的 AC 不依赖它）。

## AC

- [x] 位置判定下 `src/analysis/**` 无对 `@/cli`、`../cli` 的 import：`grep -rnE "^\s*(import|export)[^;]*from '(@/cli|(\.\./)+cli)" src/analysis` 无输出（退出码 1）
- [x] `src/core/**` 无对 cli、mermaid 的 import：`grep -rnE "^\s*(import|export)[^;]*from '(@/(cli|mermaid)|(\.\./)+(cli|mermaid))" src/core` 无输出（退出码 1）
- [x] 新增 `tests/unit/architecture/layer-imports.test.ts`，其中成对负对照：对一个内存里构造的违规源文本（如 `src/core/x.ts` 含 `import type { A } from '@/cli/y.js'`）断言守卫判定为违例，对只在注释里提到 `@/cli/y.js` 的源文本断言不判违例；运行 `npx vitest run tests/unit/architecture/layer-imports.test.ts` 退出码 0
- [x] 旧导出路径仍可用（类型 re-export）：`npx vitest run tests/unit/analysis/metrics-history-reader.test.ts tests/unit/cli/metrics-history-writer.test.ts tests/unit/cli/query/query-manifest.test.ts` 退出码 0，且这些测试文件不需要修改 import 路径
- [x] 运行时行为不变：`npm run type-check` 与 `npm test` 全量通过
- [x] 真实对照：重新 `node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/<dir>` 后，从 `overview/package.json` 的 `extensions.tsAnalysis.moduleGraph.edges` 取目录边，`src/analysis*` 到 `src/cli*`、`src/core*` 到 `src/cli*`、`src/core*` 到 `src/mermaid*` 的边数均为 0（修前分别为 3、1、1）

## Evidence

- 分层方向：`grep -rnE "^\s*(import|export)[^;]*from '(@/cli|(\.\./)+cli)" src/analysis` 与对 `src/core` 的 CLI/mermaid 版本均无输出（退出码 1）。
- 守卫测试 `tests/unit/architecture/layer-imports.test.ts`：9 passed；含违规文本（`@/cli`、相对 `../../cli`、`@/mermaid`、多行 import）报违例的成对负对照，以及注释提及路径不报违例。
- 旧路径可用：`tests/unit/analysis/metrics-history-reader.test.ts`、`tests/unit/cli/metrics-history-writer.test.ts`、`tests/unit/cli/query/query-manifest.test.ts` 共 25 passed，测试文件的 import 路径未改动。
- 运行时行为不变：`npm run type-check` 通过；受影响面 44 个测试文件 892 passed。
- 真实对照：主检出（develop 基线）分析得 analysis→cli=3、core→cli=1、core→mermaid=1；worktree 重构建后分析得 0/0/0（`extensions.tsAnalysis.moduleGraph.edges`）。

## DoD

不是"类型搬了、测试通过"就算完成：必须在重新构建后的真实 archguard 上重新分析，目录级边里这三个方向都为 0（修前 3/1/1），同时 `metrics-history-reader`、`query-manifest`、`renderer-facade` 的运行行为不变（现有单测与全量套件为证）。守卫测试必须有成对负对照（违规文本报违例、只在注释里提到路径不报），不接受只有"正例通过"的守卫。

## Touches

- src/analysis/metric-vector-builder.ts
- src/analysis/git-history/history-query.ts
- src/analysis/git-history/history-types.ts
- src/analysis/git-history/index.ts
- src/analysis/metrics-history-reader.ts
- src/analysis/metrics-history-types.ts
- src/cli/metrics-history-writer.ts
- src/cli/git-history/history-loader.ts
- src/cli/query/query-manifest.ts
- src/core/query/query-engine.ts
- src/core/interfaces/renderer-facade.ts
- src/core/interfaces/renderer-types.ts
- src/mermaid/diagram-generator.ts
- src/types/query-scope.ts
- tests/unit/architecture/layer-imports.test.ts
- tests/unit/analysis/metrics-history-reader.test.ts
- tests/unit/cli/metrics-history-writer.test.ts
- tests/unit/cli/query/query-manifest.test.ts
- tasks/gap-layer-violations-relocate-misplaced-types.md
