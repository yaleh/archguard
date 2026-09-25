---
id: TASK-97
title: "TASK-97: MCP archguard_analyze 无法触发 arch-health，intrinsic_dimension 在
  MCP 侧永远无数据"
status: ready
labels:
  - gap
  - mcp
  - analysis
parent: null
children: []
extra: {}
---
## Proposal

`--arch-health`（计算并写入 `.archguard/arch-health-history.json`）只接在 CLI 的 `src/cli/commands/analyze.ts`（约 245-340 行，选项类型 `archHealth` 在 `src/types/config-cli.ts`），`runAnalysis`（`src/cli/analyze/run-analysis.ts`）和 MCP 的 `archguard_analyze` 都没有这个入口。结果：`archguard_get_intrinsic_dimension`、`archguard_get_architecture_drift` 依赖的历史文件无法通过 MCP 产生，调用方只能拿到「无数据」。

方案：把 arch-health 的计算与落盘从 `commands/analyze.ts` 抽成可复用函数，`runAnalysis` 在 `cliOptions.archHealth` 为真时调用（CLI 与 MCP 共用同一路径，CLI 行为不变）；`archguard_analyze` 增加 `archHealth` 布尔参数并透传。快照需带 scope 标识（与 TASK-100 的 metrics-history 用同一字段约定），避免多 scope 的快照混在同一序列里。

<!-- dedup-ref -->
相关但机制不同：TASK-93 统一「未评估」的返回形状；本任务让 MCP 侧有办法产生数据。TASK-64/65（arch-health 原始实现，已完成）定义了历史文件格式，本任务不改格式。

## AC

- [x] `npx vitest run tests/unit/cli/analyze/run-analysis.test.ts` exit 0，新增用例：`cliOptions.archHealth=true` 时 `arch-health-history.json` 被写入一个快照；未设置时不写
- [x] `npx vitest run tests/unit/cli/mcp/analyze-tool.test.ts` exit 0，新增用例：`archHealth:true` 透传到 `runAnalysis`
- [x] `npx vitest run tests/unit/cli/analyze-command.test.ts` exit 0（CLI `--arch-health` 回归）
- [x] `npx vitest run tests/unit/cli/mcp/tools/arch-health-tools.test.ts` exit 0（回归）
- [x] `npm run type-check && npm run lint` exit 0

## DoD

从零开始的 `.archguard` 目录，仅通过 MCP `archguard_analyze`（`archHealth:true`）后，再调用 `archguard_get_intrinsic_dimension` 得到 `current` 非空；CLI `analyze --arch-health` 产出的历史文件与重构前逐字段一致。

## Touches

- `src/cli/commands/analyze.ts`
- `src/cli/analyze/run-analysis.ts`
- `src/cli/mcp/analyze-tool.ts`
- `src/types/config-cli.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`
- `tests/unit/cli/mcp/analyze-tool.test.ts`
- `tasks/TASK-97.md`
