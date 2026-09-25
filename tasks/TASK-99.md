---
id: TASK-99
title: "TASK-99: 查询工具的适用性与输出体量——不适用语言无显式标记、package_metrics 无 topN、get_dependents
  的 outputScope 待核实"
status: todo
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

- [ ] `npx vitest run tests/unit/cli/mcp/atlas-analytics-tools.test.ts` exit 0，新增用例：TS scope 上调用 god_packages 返回 `applicable:false` 且含 `reason`；Go Atlas scope 行为不变（回归）
- [ ] `npx vitest run tests/unit/cli/mcp/tools/package-metrics-tool.test.ts` exit 0，新增用例：`topN=5,sortBy=fanIn` 返回 5 项且按 fanIn 降序；不传时输出与修复前逐项一致
- [ ] 本文件 `## Evidence` 小节记录 `get_dependents` 的 `outputScope=package` 复现结论（有效/无效，附实测输出）；若无效，`npx vitest run tests/unit/cli/query/query-engine.test.ts` 含对应回归用例并 exit 0
- [ ] `npm run type-check && npm run lint` exit 0

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
