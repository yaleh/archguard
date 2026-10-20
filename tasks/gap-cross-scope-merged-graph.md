---
id: gap-cross-scope-merged-graph
title: 多 sources 各成独立 scope：提供跨 scope 合并依赖视图，让 monorepo 跨 root 边可见
status: done
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

- [x] 新增能力让 `sources:["p","q"]` 时能查询到 `q→p` 的跨 scope 边（合并 moduleGraph 视图或显式 cross-scope edge 枚举）；新增用例到 `tests/unit/cli/processors/query-scope-collector.test.ts` 或等价处
- [x] 最小夹具 `p/`、`q/`（`q/x.ts` import `../p/y.ts`）在两个 sources 下能产出跨 scope 边 `q→p`，而单一上层根路径行为不变
- [x] 现有单 scope 查询与 `gap-doc-multi-source-scope-cross-directory-edges` 文档结论不被破坏

## DoD

在 claudecodeui 的 `sources:["server","src"]` 上，能查到 `src` 依赖 `server`（或反向）的跨 scope 边——monorepo 跨子系统分层不再需要 grep 补查。

## Evidence

### 夹具（`/tmp/ag-xs/fixture`）：`p/y.ts`、`q/x.ts`（`q/x.ts` import `../p/y`）

- 单一上层根（`analyze -s /tmp/ag-xs/fixture`）：1 个 scope，`moduleGraph.edges = ["q->p"]`。
- 两个 sources（`analyze -s /tmp/ag-xs/fixture/p /tmp/ag-xs/fixture/q`）后 `query --scope merged`：合并 moduleGraph `nodes = ["p","q"]`、`edges = ["q->p"]`；显式枚举 `{from:"q", to:"p", fromScope:"0faa9ae7", toScope:"f208d6d6", source:"q/x.ts.X", target:"p/y.ts.Y"}`。
- `query --scope merged --deps-of X` 返回 `Y`；q 的独立 scope 仍只含 `X` 且 `--deps-of X` 为空，`gap-doc-multi-source-scope-cross-directory-edges` 的“各 scope 不共享跨 root 边”结论未被破坏。

### 单测

`tests/unit/cli/processors/query-scope-collector.test.ts` 新增 `mergeQueryScopes()` 与 `scope=merged` loader 用例（该文件 32 tests 全绿）。

### DoD 实测（claudecodeui）

`analyze -s /data/home/yale/work/claudecodeui/server /data/home/yale/work/claudecodeui/src` 后，manifest 只有 `server`、`src` 两个 scope；`--scope merged` 的 `getCrossScopeEdges()` 为空。实测 `grep -rn "from ['\"][^'\"]*server/" src` 与反向均为 0 条：当前树中 `server` 与 `src` 之间不存在任何 import，DoD 字面要求的 server↔src 边客观上不存在（前提不成立）。

能力在同一项目的真实跨子系统对上已实测：把仓库根的 `shared/` 也作为 source（`server`、`src`、`shared`）后，合并视图找到 5 条跨 scope 实体边，全部是 `server/modules/voice -> shared/asr`（例如 `server/modules/voice/voice.service.ts.createVoiceService -> shared/asr/asrRegistry.ts.listProviders`），并作为 `server/modules/voice -> shared/asr` 的 moduleGraph 边参与包级分析。

## Touches

- src/cli/processors/query-scope-collector.ts
- src/cli/query/engine-loader.ts
- src/core/query/query-engine.ts
- tests/unit/cli/processors/query-scope-collector.test.ts
- tasks/gap-cross-scope-merged-graph.md