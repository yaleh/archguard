---
id: gap-cross-scope-merged-graph
title: 多 sources 各成独立 scope：提供跨 scope 合并依赖视图，让 monorepo 跨 root 边可见
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 关联已落地文档任务 gap-doc-multi-source-scope-cross-directory-edges（它把「真正支持跨 scope 边」明确留作后续实验）；本任务即该实验的落地。

`archguard_analyze({sources:["server","src"]})` 生成两个独立 scope，一个查询看不到跨 root 的真实 import 边（monorepo 更痛）。已实测确认：单一上层根能看到 `q→p`，拆成两个 sources 后该边从两个 scope 的 moduleGraph 里都消失。修法：提供跨 scope 的合并依赖视图（或显式跨 scope 边枚举），供 monorepo/多子系统分层检查使用，不改变单 source 的现有行为。

## AC

- [ ] 新增能力让 `sources:["p","q"]` 时能查询到 `q→p` 的跨 scope 边（合并 moduleGraph 视图或显式 cross-scope edge 枚举）；新增用例到 `tests/unit/cli/processors/query-scope-collector.test.ts` 或等价处
- [ ] 最小夹具 `p/`、`q/`（`q/x.ts` import `../p/y.ts`）在两个 sources 下能产出跨 scope 边 `q→p`，而单一上层根路径行为不变
- [ ] 现有单 scope 查询与 `gap-doc-multi-source-scope-cross-directory-edges` 文档结论不被破坏

## DoD

在 claudecodeui 的 `sources:["server","src"]` 上，能查到 `src` 依赖 `server`（或反向）的跨 scope 边——monorepo 跨子系统分层不再需要 grep 补查。

## Touches

- src/cli/processors/query-scope-collector.ts
- src/cli/query/engine-loader.ts
- src/core/query/query-engine.ts
- tests/unit/cli/processors/query-scope-collector.test.ts
- tasks/gap-cross-scope-merged-graph.md