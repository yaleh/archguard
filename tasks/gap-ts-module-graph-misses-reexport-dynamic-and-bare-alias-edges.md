---
id: gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges
title: TS moduleGraph 漏边：export-from 重导出、字面量动态 import 不产生边，裸 @/ 别名解析失败被记成外部包
status: ready
labels:
  - gap
  - defect
  - typescript
  - arch-json
parent: null
children: []
extra:
  schema: execution
---
## Proposal

目录级依赖图（`extensions.tsAnalysis.moduleGraph`，被 `detect_cycles(package)`、package 层 JSON、mermaid package 图和外部分层检查共同使用）在 TS 上有三类漏边/误分类。根因都在 `src/plugins/typescript/builders/module-graph-builder.ts` 的边收集循环（约第 55–135 行），2026-10-03 读代码并在 archguard 自身上量化：

1. **`export ... from` 重导出不产生边**：循环只遍历 `sf.getImportDeclarations()`，没有遍历 `sf.getExportDeclarations()`。archguard `src` 里有 99 条跨目录的 `export ... from`（grep 位置判定），多数是 cli 指向 core/analysis/parser 的兼容 re-export（如 `src/cli/query/query-engine.ts: export { QueryEngine } from '@/core/query/query-engine.js'`）。如果出现"低层 re-export 高层"，目录级分层检查和环检测都看不见。
2. **字面量动态 `import('@/...')`/`import('./...')` 不产生边**：本仓库有 45 处内部路径的动态 import（grep），同样不在边里。
3. **裸别名 `@/types` 解析失败后被记成外部包**：tsconfig 的 `paths` 只有 `@/*`、`@/types/*` 等带通配的条目，裸 `@/types`（目录 index）ts-morph 解析不到，落入"裸包名"分支（第 105–107 行 `specifier.startsWith('@') ? first 2 segments`），变成 `@/types` 外部节点。archguard 的 `src/parser` 下有 5 个文件这样 import，因此 `src/parser -> src/types` 这条内部边被替换成了指向外部节点 `@/types` 的边。

修复方向（让边集合完整，且"解析不了"必须可见，不得静默变成外部包）：
- 在同一循环里同时处理 `getExportDeclarations()` 里带 module specifier 的声明（含 `export * from`、`export type ... from`），以及字面量参数的动态 `import()`（`CallExpression` 且 callee 为 import keyword、第一个参数是字符串字面量；非字面量一律不产生边并计入未评估计数）。
- 别名解析：当 specifier 以项目别名前缀（从 tsconfig `paths` / `ts-morph` 的 compilerOptions 读取，不要硬编码 `src/`）开头而 ts-morph 解析不到时，按 paths 映射手工解析并复用 `fileToModule`；仍然解析不了时**不要**记成外部节点，而是计入新增的 `unresolved`（具体字段名由实现决定，需在 `TsModuleGraph` 类型里声明为可选字段，旧消费者不受影响）。
- 保持现有字段不变，只增加边和新增可选字段；`strength` 仍表示该目录对之间的语句条数。

注意：增加边会改变 `moduleGraph.cycles` 与 package 层 metrics 的数值（可能新增环）；AC 里要求给出修前修后对照，且对"新出现的环"逐个确认是真实的而不是误报。

不在本任务范围：type-only 与值依赖的拆分（见 gap-ts-module-graph-type-only-edge-split，应在本任务之后做，使拆分覆盖完整的边集合）。

关联（追溯用，非前置）：gap-detect-cycles-ignores-output-scope-package（done，读取 `moduleGraph.cycles`）、gap-ts-package-json-relations-metrics-inconsistent（done）。

## AC

- [x] `tests/unit/plugins/typescript/builders/module-graph-builder.test.ts` 新增用例：夹具里 `a/x.ts` 含 `export { Y } from '../b/y.js'`，`buildModuleGraph` 返回的 edges 含 `a -> b`；对照夹具里只有注释写了 `export ... from '../b/y.js'` 时没有该边（成对负对照）
- [x] 同一测试文件新增用例：`a/x.ts` 含 `await import('../b/y.js')`（字面量）产生 `a -> b` 边；含 `import(someVar)`（非字面量）不产生边且未评估计数加一
- [x] 同一测试文件新增用例：夹具 tsconfig `paths` 为 `{"@/*": ["src/*"]}`，`a/x.ts` 含裸 `import type { T } from '@/types'`（ts-morph 解析不到目录 index），edges 含指向 `src/types` 的内部边，且 nodes 里**没有** id 为 `@/types` 的外部节点；解析不了的别名 specifier 进入 unresolved 字段而不是外部节点
- [x] 运行 `npx vitest run tests/unit/plugins/typescript/builders/module-graph-builder.test.ts tests/plugins/typescript/builders/module-graph-builder.test.ts` 退出码 0，且原有用例不改动仍通过
- [x] 真实对照：对 archguard 自身重新 `node dist/cli/index.js analyze -f json --diagrams package --output-dir /tmp/<dir>` 后，`moduleGraph.nodes` 中不再有 id 以 `@/` 开头的节点，存在 `src/parser -> src/types` 边，`src/cli -> src/core` 的 `strength` 大于修前（含 re-export）；给出修前修后的 edges 总数与 `moduleGraph.cycles` 对照，并对新增的环逐个说明
- [x] `npm run type-check` 与 `npm test` 全量通过

## DoD

必须在真实 TS 项目（archguard 自身）上用修复后的构建重新生成 `overview/package.json`，用脚本读取 `moduleGraph`，给出修前修后的对照：边总数、`@/` 外部节点数（修前 1）、`src/parser -> src/types` 是否存在（修前不存在）、`cycles` 个数与成员；并核实 package 层 JSON 的自洽性（relations 两端都在 entities 里）没有被新增的边破坏。不接受只靠夹具单测通过。

## Touches

- src/plugins/typescript/builders/module-graph-builder.ts
- src/types/extensions/ts-analysis.ts
- tests/unit/plugins/typescript/builders/module-graph-builder.test.ts
- tests/plugins/typescript/builders/module-graph-builder.test.ts
- tasks/gap-ts-module-graph-misses-reexport-dynamic-and-bare-alias-edges.md
