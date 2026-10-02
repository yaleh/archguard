---
id: gap-ts-package-graph-capability-undeclared
title: TS 上 packageGraph 恒 false 且 package fanin/fanout/atlas 工具无明确不可用声明与替代路径
status: ready
labels:
  - gap
  - mcp
  - typescript
parent: null
children: []
extra:
  schema: execution
---
## Proposal

两个独立会话（archguard 自身、quay 项目）复现：TS 项目的 `archguard_summary.capabilities.packageGraph` 恒为 `false`，导致 `archguard_get_package_fanin`、`archguard_get_package_fanout`、`archguard_get_atlas_layer` 在 TS 上只能得到 `applicable:false`，调用方需要先试错才知道不可用，也不知道该改用什么。

根因（机制）：`src/core/query/query-engine.ts:144` 把 `packageGraph` 直接设为 `hasAtlas`（Go Atlas 扩展是否存在），语义是"有无 Go Atlas 包图"，而不是"有无任何包图"。TS 项目的目录级依赖实际存在（`extensions.tsAnalysis.moduleGraph`，并编码在 overview/package.json 的 relation.id 里，archguard 自身有 178 条 src 内部目录边），只是没有被暴露成该能力。

本任务只做"声明"，不新增图能力（改动面小、可独立验证）：
- `capabilities` 在 TS 上显式区分：`packageGraph` 保持 Atlas 语义不变但补充一个说明字段，或新增 `packageGraphKind`（`'go-atlas' | 'none'`）与 `packageGraphReason`，让调用方一次 `summary` 调用就能知道这三个工具在当前 scope 不可用及原因。
- 三个工具的 MCP 描述首句写明"仅 Go Atlas 可用"，并在 `applicable:false` 返回的 `alternative` 里指向 TS 上可用的替代（`archguard_get_package_stats`、`archguard_summary(outputScope=package)`，以及 gap-detect-cycles-ignores-output-scope-package 修复后的 `archguard_detect_cycles(outputScope=package)`）。

不在本任务范围：为 TS 提供基于目录的 package 图（即真正让 fanin/fanout 在 TS 上可用）——这会改变 ArchJSON 输出结构（overview/package.json 的 relations 当前把 source/target 折叠成顶层包名，目录边只在 id 里，metrics 与 relations 也不一致），需要单独出方案，另立。

关联（追溯用，非前置）：gap-detect-cycles-ignores-output-scope-package（同一"粒度未评估须有独立取值"原则）。

## AC

- [x] `tests/unit/cli/mcp/mcp-server.test.ts` 新增用例：对 TS（非 Atlas）夹具调用 `archguard_summary`，返回的 capabilities 中 `packageGraph === false` 且带非空的原因/种类字段；对 Go Atlas 夹具该字段表明可用；运行 `npx vitest run tests/unit/cli/mcp/mcp-server.test.ts` 退出码 0
- [x] 同一测试文件新增用例：TS 夹具调用 `archguard_get_package_fanin` 返回 `applicable === false`，其 `alternative` 非空且包含 `archguard_get_package_stats`
- [x] 三个工具（fanin、fanout、get_atlas_layer）的注册描述首句包含"Go Atlas"限定语：`grep -c "Go Atlas" src/cli/mcp/mcp-server.ts` 不少于修前计数加 3 或等价断言
- [x] `npm run type-check` 与 `npm test` 全量通过

## DoD

必须用修复后的构建在真实 TS 项目（archguard 自身）上真实调用 `archguard_summary` 并读到新增的能力说明字段，再真实调用 `archguard_get_package_fanin`，读到带替代工具指引的 `applicable:false`，而不是只靠单测夹具；同时在一个 Go Atlas scope 上确认原有能力判断没有被改坏。

## Touches

- src/core/query/query-engine.ts
- src/cli/mcp/mcp-server.ts
- tests/unit/cli/mcp/mcp-server.test.ts
- tasks/gap-ts-package-graph-capability-undeclared.md