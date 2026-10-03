---
id: gap-ts-module-graph-external-edge-resolution-dependent
title: moduleGraph 的 external 边是否出现取决于 ts-morph 能否解析到 node_modules
status: todo
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

`ModuleGraphBuilder.resolveTarget`（`src/plugins/typescript/builders/module-graph-builder.ts`）优先使用 ts-morph 的 `getModuleSpecifierSourceFile()`：裸包名若能解析到 `node_modules` 里的真实文件，该文件不在 `fileToModule` 中 → 返回 `{kind:'skip'}`（**不产边**）；只有解析不到时才走最后的 external 分支产边。而动态 `import()` 不走 ts-morph 解析（CallExpression 参数无法解析），一律落到 external 分支 → **一定有边**。

后果：同一个依赖在 moduleGraph 里「有边 / 无边」取决于 ts-morph 的解析结果，而不是依赖本身；静态 import 的 external 边集合既不完整也不稳定。

由 `gap-verify-module-graph-edge-completeness` 的独立对账量化（脚本 `docs/experiments/layer-map/verify-edge-completeness.mjs`，结论见 `docs/proposals/proposal-architecture-layer-check.md` 的「阶段 0/1 验证记录」）：archguard 自身 **漏 31 条 external 边**（`fs-extra` 23、`micromatch` 6、`cli-progress` 1、`js-yaml` 1），另 2 条只是少计；quay 侧 0 条。

对阶段 2 的层检查器**不阻塞**（`check-layers.mjs` 只消费 internal 边，external 仅计入覆盖缺口数字），但覆盖缺口里的「外部依赖边数」会系统性偏小。

## AC

- [ ] 明确 external 边的语义并写进 `TsModuleDependency` 的文档注释：external 边表示「该模块引用了这个包」，与「ts-morph 能否解析到它」无关
- [ ] 使静态 `import ... from '<裸包名>'` / `export ... from '<裸包名>'` 与字面量 `import('<裸包名>')` 对同一个包产出一致的 external 边（要么都有、要么都无）
- [ ] 单元测试：一个能解析到 node_modules 的包与一个解析不到的包，静态 import 与动态 import() 各自产边一致（不得因解析成功而丢边）
- [ ] archguard 自身复跑对账：external 漏边由 31 降为 0，`missedInternal`/`extraInternal`/`strengthMismatch(internal)` 仍为 0
- [ ] quay 复跑对账 `status=pass` 不变，且 external 边数修复前后有对照记录（写进任务 body 或 body 引用的验证记录）
- [ ] 修复前后的 external 边数对照补进 `docs/proposals/proposal-architecture-layer-check.md` 的「阶段 0/1 验证记录」相应段落

## DoD

不是「把 skip 改成 external」就算完成：必须先明确 external 边的语义（是「引用了这个包」而不是「解析到了这个文件」），再让静态与动态两条路径一致，并用**独立对账脚本**在两个真实项目上证明 internal 边集合没有被这次改动破坏（archguard 0/0、quay 0/0）。改动若使 external 节点数显著增加，需在结论里说明对下游展示（节点数、覆盖缺口）的影响。

## Touches

- src/plugins/typescript/builders/module-graph-builder.ts
- tests/unit/plugins/typescript/builders/module-graph-builder.test.ts
- docs/proposals/proposal-architecture-layer-check.md
- tasks/gap-ts-module-graph-external-edge-resolution-dependent.md