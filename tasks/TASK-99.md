---
id: TASK-99
title: "TASK-99: 查询工具的适用性与输出体量——不适用语言无显式标记、package_metrics 无 topN、get_dependents
  的 outputScope 待核实"
status: ready
labels:
  - gap
  - mcp
  - query
parent: null
children: []
extra: {}
---
## Proposal

三个调用体验问题，同属「工具输出对调用方不友好」：
1. **适用性**：`archguard_detect_god_packages`、`archguard_get_package_fanin/fanout`（`src/cli/mcp/tools/atlas-analytics-tools.ts`）只支持 Go Atlas，工具描述里有写，但对 TS scope 调用时没有显式的 `applicable:false`（当前行为需要在实现前先实测确认）。`archguard_summary` 已有 `capabilities`，可据此判断。
2. **体量**：`archguard_get_package_metrics`（`src/cli/mcp/tools/package-metrics-tools.ts`）固定按包名排序，没有 `topN`/`sortBy`，一次输出约 200 行；`archguard_get_package_metrics` 的 `cyclesWith` 也无上限。
3. **outputScope**：报告称 `get_dependents` 的 `outputScope:package` 被忽略；源码里参数被传给 `engine.applyOutputOptions`（`src/cli/query/query-engine.ts`），是否真的无效未核实——先复现，确属 bug 再修，否则在本文件记录结论。

方案：(1) 对不适用的语言返回 `{applicable:false, reason, alternative}`；(2) `package_metrics` 增加 `topN`（默认不限，保持兼容）与 `sortBy`（`fanIn|fanOut|entityCount|name`）；(3) 复现并处理 outputScope。

<!-- dedup-ref -->
相关但机制不同：TASK-91（响应回显 scope）与 TASK-93（未评估形状）。适用性标记沿用 TASK-93 的 `reason` 约定，本任务不改它。

## AC

- [x] `npx vitest run tests/unit/cli/mcp/atlas-analytics-tools.test.ts` exit 0，新增用例：TS scope 上调用 god_packages 返回 `applicable:false` 且含 `reason`；Go Atlas scope 行为不变（回归）
- [x] `npx vitest run tests/unit/cli/mcp/tools/package-metrics-tool.test.ts` exit 0，新增用例：`topN=5,sortBy=fanIn` 返回 5 项且按 fanIn 降序；不传时输出与修复前逐项一致
- [x] 本文件 `## Evidence` 小节记录 `get_dependents` 的 `outputScope=package` 复现结论（有效/无效，附实测输出）；若无效，`npx vitest run tests/unit/cli/query/query-engine.test.ts` 含对应回归用例并 exit 0
- [x] `npm run type-check && npm run lint` exit 0

## DoD

对本仓库自身（TS）的真实 `.archguard` 调用 `archguard_detect_god_packages` 得到 `applicable:false`；`archguard_get_package_metrics` 加 `topN=10,sortBy=fanIn` 只返回 10 项；`get_dependents` 的 outputScope 结论有实测依据。

## Touches

- `src/cli/mcp/tools/atlas-analytics-tools.ts`
- `src/cli/mcp/tools/package-metrics-tools.ts`
- `src/cli/query/query-engine.ts`
- `tests/unit/cli/mcp/atlas-analytics-tools.test.ts`
- `tests/unit/cli/mcp/tools/package-metrics-tool.test.ts`
- `tests/unit/cli/query/query-engine.test.ts`
- `tasks/TASK-99.md`

## Evidence

实现提交：分支 `task/TASK-99`，commit 8d229968。

### 1. 适用性（对本仓库自身 TS 的真实 `.archguard`，`node dist/cli/index.js analyze -s ./src -f json` 生成）

`archguard_detect_god_packages` 实测输出：

```
{ "applicable": false,
  "reason": "No Atlas data found in this scope (language: typescript). This tool requires a Go project analyzed with Atlas mode.",
  "alternative": "Use archguard_get_package_metrics (all languages) for per-package fan-in/fan-out/cycles, or archguard_get_package_stats for package volume." }
```

`get_package_fanin` / `get_package_fanout` 同样返回该结构。`reason` 仍含 "No Atlas data"，旧断言与 mcp-server 其它工具不受影响。

### 2. 体量

`archguard_get_package_metrics({ topN: 10, sortBy: 'fanIn' })` 在真实数据上返回 10 项（`totalPackages: 44`）：`types:229 plugins/shared:113 core/interfaces:67 plugins/golang/atlas:59 types/extensions:59 analysis/jl:50 cli/query:35 plugins/golang:33 parser:27 analysis:23`。不传参数返回全部 44 项、按包名排序、键集合不变（无 `totalPackages`）。`totalPackages` 仅在 topN 实际截断时出现。`cyclesWith` 未加上限（不在方案 (1)(2) 范围内）。

### 3. `get_dependents` 的 `outputScope=package`：结论 = 有效，不是 bug

`src/cli/query/query-engine.ts` 只是 re-export shim，真实实现在 `src/core/query/query-engine.ts` 的 `applyOutputOptions` → `narrowEntities`（`src/core/query/output-scope-filter.ts`），scope 被正确应用。真实数据上 `get_dependents({name:'QueryEngine', depth:1, outputScope})` 的第一项：

- package: `{"id":"…DiagramPipelineRunner","name":"DiagramPipelineRunner","type":"class","file":"…","methodCount":0,"fieldCount":0}`（无 `visibility`）
- class:   `{…,"visibility":"public","file":"…","methodCount":0,"fieldCount":0}`
- method:  `{…,"visibility":"public","file":"…","methodCount":2,"fieldCount":0}`
- method + `verbose=true`：返回完整 entity，含 `members`（2 项）

「被忽略」的观感来源：MCP 层非 verbose 时 `applyView` 再把结果压成 `EntitySummary`，因此 package/class/method 三档只在 `visibility` 与 `methodCount/fieldCount` 上有细微差别，方法签名只有 `verbose=true` 才返回（工具描述里「with method signatures (outputScope=method by default)」对此有误导）。这属于描述/体验问题，未在本任务改 `mcp-server.ts`（不在 Touches 内，且会改变多个工具的默认输出）。

已在 `tests/unit/cli/query/query-engine.test.ts` 增加 `getDependents + applyOutputOptions` 三档 scope 回归用例（package 仅保留 identity+file；class 去 members；method 保留 members），`npx vitest run tests/unit/cli/query/query-engine.test.ts` exit 0。
