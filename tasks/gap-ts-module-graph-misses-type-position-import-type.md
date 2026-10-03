---
id: gap-ts-module-graph-misses-type-position-import-type
title: moduleGraph 漏掉类型位置的 import('...')（TSImportType）导致的 type-only 边缺失
status: done
labels:
  - gap
  - typescript
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`ModuleGraphBuilder`（`src/plugins/typescript/builders/module-graph-builder.ts`）用 `getDescendantsOfKind(SyntaxKind.CallExpression)` 找动态 `import()`，这只能命中**值位置**的调用表达式；**类型位置**的 `import('...')`（TS 的 `TSImportType` / ts-morph `ImportTypeNode`）扫不到。例如：

- `config: import('@/core/interfaces/parser.js').ParseConfig`
- `type T = import('./t1.js').X`
- `Promise<import('./t2.js').Y>`
- `readonly import('@/types').Relation[]`

这类写法是模块引用，且**是类型位置的**——编译期擦除、运行时无耦合，正是层间 type-only 违例的证据来源。

由 `gap-verify-module-graph-edge-completeness` 的独立对账发现（脚本 `docs/experiments/layer-map/verify-edge-completeness.mjs`，结论见 `docs/proposals/proposal-architecture-layer-check.md` 的「阶段 0/1 验证记录」）：archguard 自身扫到 16 处类型位置 `import()`，其中 13 处解析到项目内目录。**其中 3 条边在 moduleGraph 里完全不存在**（`cli/analyze -> core/interfaces`、`cli/processors -> core/interfaces`——该目录对这两个模块的唯一引用就是这个类型位置 import），另 9 条只是 strength 少计（builder 少算了一条贡献语句）。quay 侧为 0 处，因此在 archguard 自身可复现、可验收。

影响：阶段 2 的层检查器要区分 type-only 与值依赖；「只被类型位置 import type 引用」的目录对在图上完全没有边，这类 type-only 层间违例会漏报。

## AC

- [x] `ModuleGraphBuilder` 识别类型位置的 `import('...')`（ts-morph `ImportTypeNode`，含 `readonly`/联合/`Promise<>` 嵌套等包装形式），为其产出 type-only 边：计入 `typeOnlyStrength`、**不计** `valueStrength`、`strength` 同步 +1；参数非字符串字面量时照旧不产边
- [x] 字符串字面量与注释里的 `import(` 不被误判为类型位置引用（负对照）
- [x] 单元测试覆盖：`type T = import('./x.js').X`、`interface I { p: import('./y.js').Y }`、`Promise<import('./z.js').Z>`、`readonly import('./w.js').W[]`、非字面量参数
- [x] 在 archguard 自身重跑 `node dist/cli/index.js analyze -s src -f json --output-dir <tmp> --work-dir <tmp>` 后，`cli/analyze -> core/interfaces` 与 `cli/processors -> core/interfaces` 两条边出现在 `extensions.tsAnalysis.moduleGraph.edges`，且 `typeOnlyStrength >= 1`、`valueStrength === 0`
- [x] `node docs/experiments/layer-map/verify-edge-completeness.mjs <archguard package.json>` 复跑：`typePositionImpact.edgeAbsent` 由 3 降为 0、`edgeUnderCounted` 由 9 降为 0，且 `missedInternal`/`extraInternal` 仍为 0
- [x] quay 侧复跑对账仍为 `status=pass`（external caveat 允许存在）

## DoD

不是「builder 多识别一种语法」就算完成：必须证明修复后**独立对账**在两个真实项目上仍无 internal 漏边/多报（archguard 0/0、quay 0/0），且类型位置 import 的归因计数归零；负对照（注释/字符串里的 `import(`）必须真的测到。若顺带发现新的漏边类型，另立 gap，不在本任务内顺手修。

## Touches

- src/plugins/typescript/builders/module-graph-builder.ts
- tests/unit/plugins/typescript/builders/module-graph-builder.test.ts
- docs/proposals/proposal-architecture-layer-check.md
- tasks/gap-ts-module-graph-misses-type-position-import-type.md
- docs/experiments/layer-map/verify-edge-completeness.mjs
