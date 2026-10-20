---
id: gap-module-graph-root-dynamic-import-attribution
title: detect_cycles 的 (root)↔子目录假环：修 root/动态 import 边归因并让证据回显 specifier
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`detect_cycles(outputScope=package)` 在 server scope 上报 `{size:2, modules:["","modules/browser-use"]}` 的假环：独立源码扫描复现不到 `browser-use → root` 边（真实单边是 `server/modules/cli/cli.module.ts:88` 的 `await import('../../index.js')`，且 `server/index.ts` 不 import cli）。`(root)` 是空模块 id 的显示名（`module-graph-builder.ts:294` `name: moduleId || '(root)'`），动态/barrel import 的目录归属在 `ModuleGraphBuilder` 里不可靠。修法：修 root/动态 import 边归因，并让报告能回显底层 specifier 用于自查。

## AC

- [ ] 复现夹具：`root/index.ts` 不 import `modules/browser-use`、`modules/browser-use/*.ts` 不 import root 时，`detect_cycles(outputScope=package)` 不报 `{ "", "modules/browser-use" }` 假环；新增用例到 `tests/unit/plugins/typescript/builders/module-graph-builder.test.ts`
- [ ] 字面量动态 `import('../../index.js')` 的边归属到正确源模块（`modules/cli`，而非无关的 `modules/browser-use`），并有断言
- [ ] package cycle 证据里回显每条边的 `specifier` + `file:line`，使假环能被自查（与 gap-package-cycle-count-and-evidence 的边证据输出互通）

## DoD

在 claudecodeui server scope 上重跑 `detect_cycles(outputScope=package)`，要么不再出现 `["","modules/browser-use"]` SCC，要么该 SCC 的证据里给出真实 specifier（`cli.module.ts:88` 的 `../../index.js`）——即「root 假环」能被归因或证明。

## Touches

- src/plugins/typescript/builders/module-graph-builder.ts
- tests/unit/plugins/typescript/builders/module-graph-builder.test.ts
- tasks/gap-module-graph-root-dynamic-import-attribution.md