---
id: gap-detect-cycles-ignores-output-scope-package
title: archguard_detect_cycles 忽略 outputScope，package 粒度对目录级环返回与"无环"同形的 []
status: todo
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

实测对照（archguard 自身，2026-10-02，读 `.archguard/output/archguard/overview/package.json` 的 relation.id 解出目录级边，再做 Tarjan SCC）：`detect_cycles(package)` 返回 `[]`，而目录级存在一个含 27 个目录的 SCC（analysis、cli/*、core/*、mermaid、parser、plugins/golang/*、plugins/shared），另有 cpp、kotlin 两个小 SCC。同时同一文件里 `metrics.stronglyConnectedComponents=4` 与 `metricVector.sccCount=0` 互相矛盾（见相关任务的 package.json 不一致问题）。

修复方向：
- handler 读取并尊重 `outputScope`。`class`/`method`（默认）行为与返回形状保持不变（仍是数组），不破坏现有消费者和 `cli-mcp-parity` 测试。
- `package` 时基于 TS 的 moduleGraph 目录级边（`extensions.tsAnalysis.moduleGraph`，经 `ExtensionAccessor`）计算目录级 SCC，返回 `{ granularity: 'package', evaluated: true, cycles: [...] }`。
- 当输入读不到目录级边（非 TS、无 moduleGraph、Go 等）时返回 `{ granularity: 'package', evaluated: false, reason: '...', cycles: [] }`，"未评估"必须有独立取值，不得与"已评估且无环"同形。
- 工具描述写明各 outputScope 的含义和返回形状。

不在本任务范围：给 TS 提供基于目录的 package 图（packageGraph 能力），见 gap-ts-package-graph-capability-undeclared；type-only 边与值依赖边分开计，另立。

关联（追溯用，非前置）：DIR-001（类级 types↔analysis 环，已修）、TASK-101（植入已知缺陷的对照测试，覆盖的是类/模块环）。

## AC

- [ ] `tests/unit/cli/mcp/mcp-server.test.ts` 新增用例：构造含目录级互指（如 a→a/b、a/b→a）的 TS ArchJSON 夹具，`archguard_detect_cycles` 以 `outputScope=package` 调用，返回 `evaluated === true` 且 `cycles` 非空；去掉互指后 `evaluated === true` 且 `cycles` 为 `[]`（成对负对照）；运行 `npx vitest run tests/unit/cli/mcp/mcp-server.test.ts` 退出码 0
- [ ] 同一测试文件新增用例：夹具缺少目录级边（如非 TS 或无 moduleGraph）时，`outputScope=package` 返回 `evaluated === false` 且带非空 `reason`，与"已评估无环"不同形
- [ ] 默认（`outputScope` 缺省或 `class`）调用返回值仍是数组，且 `npx vitest run tests/unit/core/query/cli-mcp-parity.test.ts` 退出码 0
- [ ] 真实对照：对 archguard 自身重新 `node dist/cli/index.js analyze -v` 后，`archguard_detect_cycles(outputScope=package)` 返回的 `cycles` 非空且包含 `src/cli` 与 `src/core`（修前同参数为 `[]`）
- [ ] `npm run type-check` 与 `npm test` 全量通过

## DoD

不是"handler 读了 outputScope、单测通过"就算完成：必须在真实 TS 项目（archguard 自身，必要时再加 quay）上，用修复后的构建真实调用 MCP 工具 `archguard_detect_cycles(outputScope=package)`，读到非空的目录级环（修前同参数为 `[]`），并确认 `class` 默认调用的返回与修前一致。"未评估"取值必须有真实触发的样本（例如对 Go scope 调用），而不只是单测里的假夹具。

## Touches

- src/cli/mcp/mcp-server.ts
- src/core/query/query-engine.ts
- src/core/query/extension-accessor.ts
- tests/unit/cli/mcp/mcp-server.test.ts
- tasks/gap-detect-cycles-ignores-output-scope-package.md
