---
id: gap-layer-ratchet-scc-leaf-baseline
title: 层守卫升级为 ratchet：目录级 SCC 基线 + 新目录必须是叶子 + manifest/PIN 双登记
status: done
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

archguard 已有 `tests/unit/architecture/layer-imports.test.ts` 的硬方向守卫（LAYER_RULES 硬禁 analysis→cli / core→cli,mermaid,plugins.shared / parser↔plugins.shared），但缺 AC-394 形状的两件事：(b) 把目录级 SCC 钉成基线（只降不升），(c)「新目录必须是叶子 + directoryManifest/PIN 双登记」。对照 claudecodeui 的 `server-import-cycle-budget.test.ts`：缺的是 SCC 基线、新目录叶子规则、manifest/PIN 双登记，以及证明判据能区分的 fixture 用例。

修复方向（只扩展现有 `layer-imports.test.ts`，不新建脚本）：用 TypeScript 语法树（ts.createSourceFile，不用 grep 文本）解析 import 边 → 目录级聚合 → Tarjan 求 SCC，把 SCC 与 directoryManifest 钉成测试内常量，新增「新目录必须是叶子 + 双登记」与 false-form fixture 用例。

## AC

- [x] `tests/unit/architecture/layer-imports.test.ts` 新增：目录级依赖图（TS 语法树解析、注释不算边）+ Tarjan SCC，SCC 钉成基线常量（固定槽位、只降不升）；断言当前树 SCC 与基线逐成员相等；`npx vitest run tests/unit/architecture/layer-imports.test.ts` exit 0
- [x] 新增 directoryManifest 常量 + `nodeCount === manifest.length` 断言；manifest 之外的目录必须是叶子：出边只能指向自身或已登记共享层，且不能被其它模块目录 import；合成 fixture 断言「新目录 import 同级目录」判红
- [x] 双登记：新增合法目录须同时改 manifest 常量与 nodeCount（+1）并写 RECORDED CHANGE；fixture 断言「只改一处」判红
- [x] false-form 用例：注入一条反向边 / 一个环 → 判红并点名成员；未改动树保持绿
- [x] `npm run type-check` 通过

## DoD

在合成树上演练：新增一个 import 同级目录的目录 → 判据点名该目录与 leaf 判红；还原 → 全绿——「SCC 基线 + 新目录叶子」可机械判定，基线只降不升，而非靠人肉看依赖图。

## Touches

- tasks/gap-layer-ratchet-scc-leaf-baseline.md
- tests/unit/architecture/layer-imports.test.ts
