---
id: gap-bridge-keystone-edge-deletion-ranking
title: 内建 bridge/keystone 分析：单边删除对 maxScc 的影响排名
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

没有内建的 bridge/keystone 分析：要找出「删除哪条边最能拆散 SCC」只能外部对 107 条内部边逐个 Tarjan 暴力算。修法：在 TS moduleGraph 的内建分析里，对每条内部包边计算「单边删除后 maxScc 的变化」，产出 bridge/keystone 候选排名，直接喂分级器。

## AC

- [ ] 新增查询/工具（如 `archguard_detect_bridges` 或 package-cycle 输出里的 bridge 字段）：对每条内部包边给出 `{from, to, specifier, maxSccBefore, maxSccAfter, delta}`；新增用例到 `tests/unit/plugins/typescript/builders/module-graph-builder.test.ts` 或等价处
- [ ] 夹具：一个 SCC 里，删某条边使 maxScc 下降、删另一条边不变——前者被排为 bridge 候选，后者不是
- [ ] 无 TS moduleGraph 时返回 not-evaluated 带 reason（不伪造空读数）

## DoD

在 claudecodeui 的 src 42 包 SCC（或等价 fixture）上，能按 `delta` 排出一份「删除后 maxScc 下降最多」的边清单——keystone 边不再需要外部逐个 Tarjan 暴力算。

## Touches

- src/plugins/typescript/builders/module-graph-builder.ts
- src/core/query/query-engine.ts
- tests/unit/plugins/typescript/builders/module-graph-builder.test.ts
- tasks/gap-bridge-keystone-edge-deletion-ranking.md