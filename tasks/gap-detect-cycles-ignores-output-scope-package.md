---
id: gap-detect-cycles-ignores-output-scope-package
title: archguard_detect_cycles 忽略 outputScope，package 粒度对目录级环返回与"无环"同形的 []
status: ready
labels:
  - gap
  - defect
  - mcp
  - typescript
parent: null
children: []
extra:
  schema: execution
---
## Proposal

两个独立会话（archguard 自身、quay 项目）交叉复现：`archguard_detect_cycles(outputScope=package)` 对存在目录级互指/大环的 TS 项目返回 `[]`，与"确实无环"同形，调用方无法区分"无环"和"这个粒度没检测"。

根因已定位（机制，不是症状）：`src/cli/mcp/mcp-server.ts` 的 `archguard_detect_cycles` 注册了 `outputScope: outputScopeParam('class')`，但 handler 只解构 `{ projectRoot, scope }`（约第 589 行），完全没读 `outputScope`，一律返回 `ctx.engine.getCycles()`（`src/core/query/query-engine.ts:114`，即类/实体级索引的 SCC）。所以 `outputScope=package` 是空操作；类级无环（DIR-001 已修）时必然是 `[]`。

关键事实（2026-10-02 补充核实）：目录级环**已经算好**，不需要重算。`src/plugins/typescript/builders/module-graph-builder.ts:207` 在构建 `TsModuleGraph` 时已做目录级 Tarjan，结果在 `extensions.tsAnalysis.moduleGraph.cycles`（`TsModuleCycle { modules, severity }`）。archguard 自身的 overview/package.json 里该字段有 3 个环：27 个目录的大环（analysis、cli/*、core/*、mermaid、parser、plugins/golang/*、plugins/shared）、cpp 的 3 目录环、kotlin 的 2 目录环，与独立脚本（解 relation.id + Tarjan）的结果完全一致。

修复方向：
- handler 读取并尊重 `outputScope`。`class`/`method`（默认）行为与返回形状保持不变（仍是数组），不破坏现有消费者和 `cli-mcp-parity` 测试。
- `package` 时直接读 `ExtensionAccessor` 暴露的 `moduleGraph.cycles`（需要时在 `extension-accessor.ts` 增加一个取 moduleGraph 的访问器），返回 `{ granularity: 'package', evaluated: true, cycles: [...] }`，不要在查询层重新实现 SCC。
- 当没有 moduleGraph（非 TS、Go 等）时返回 `{ granularity: 'package', evaluated: false, reason: '...', cycles: [] }`，"未评估"必须有独立取值，不得与"已评估且无环"同形。
- 工具描述写明各 outputScope 的含义和返回形状。

注意数据来源：查询侧加载的是 `.archguard/query/<scope>/arch.json`，需先确认其中保留了 `extensions.tsAnalysis.moduleGraph`（`arch-metrics-structure.ts` 的 TS 路径已在读它，预期保留；若被裁剪则在本任务内补上）。

不在本任务范围：给 TS 提供基于目录的 package 图（packageGraph 能力），见 gap-ts-package-graph-capability-undeclared；overview/package.json 的 relations 与 metrics 不一致，见 gap-ts-package-json-relations-metrics-inconsistent；type-only 边与值依赖边分开计，另立。

关联（追溯用，非前置）：DIR-001（类级 types↔analysis 环，已修）、TASK-101（植入已知缺陷的对照测试，覆盖的是类/模块环）。

## AC

- [ ] `tests/unit/cli/mcp/mcp-server.test.ts` 新增用例：夹具的 `extensions.tsAnalysis.moduleGraph.cycles` 含一个环（如 a、a/b），`archguard_detect_cycles` 以 `outputScope=package` 调用，返回 `evaluated === true` 且 `cycles` 非空；同一夹具把 `cycles` 置空后返回 `evaluated === true` 且 `cycles` 为 `[]`（成对负对照）；运行 `npx vitest run tests/unit/cli/mcp/mcp-server.test.ts` 退出码 0
- [ ] 同一测试文件新增用例：夹具没有 moduleGraph（非 TS 或 Go）时，`outputScope=package` 返回 `evaluated === false` 且带非空 `reason`，与"已评估无环"不同形
- [ ] 默认（`outputScope` 缺省或 `class`）调用返回值仍是数组，且 `npx vitest run tests/unit/core/query/cli-mcp-parity.test.ts` 退出码 0
- [ ] 真实对照：对 archguard 自身重新 `node dist/cli/index.js analyze -v` 后，`archguard_detect_cycles(outputScope=package)` 返回的 `cycles` 非空且其中一个环同时包含 `src/cli` 与 `src/core`（修前同参数为 `[]`）
- [ ] `npm run type-check` 与 `npm test` 全量通过

## DoD

不是"handler 读了 outputScope、单测通过"就算完成：必须在真实 TS 项目（archguard 自身，必要时再加 quay）上，用修复后的构建真实调用 MCP 工具 `archguard_detect_cycles(outputScope=package)`，读到非空的目录级环（修前同参数为 `[]`），并确认 `class` 默认调用的返回与修前一致。"未评估"取值必须有真实触发的样本（例如对 Go scope 调用），而不只是单测里的假夹具。

## Touches

- src/cli/mcp/mcp-server.ts
- src/core/query/query-engine.ts
- src/core/query/extension-accessor.ts
- tests/unit/cli/mcp/mcp-server.test.ts
- tasks/gap-detect-cycles-ignores-output-scope-package.md
