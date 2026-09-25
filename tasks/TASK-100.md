---
id: TASK-100
title: "TASK-100: metrics-history 快照无 scope 标识、cycleCount 恒为 0、疑有空快照"
status: ready
labels:
  - gap
  - defect
  - analysis
  - metrics
parent: null
children: []
extra: {}
---
## Proposal

`metrics-history.jsonl`（`src/cli/metrics-history-writer.ts`）每次 analyze 追加一行，存在三个问题：
1. 条目只有 `timestamp` 与 `packages`，没有 scope 标识；`run-analysis.ts` 里取的是 `processor.getLastArchJson()`（实体最多者胜），不同 scope 的快照因此混在同一序列里，`archguard_get_metric_trend` 无法按 scope 看趋势。
2. `run-analysis.ts` 的 metrics 段调用 `computeCycleMetrics([], allPackageNames)`，环列表硬编码为空数组，所以快照里的 `cycleCount` 恒为 0，趋势里的「无环」是构造出来的，不是测出来的。（本条为源码阅读发现，quay 报告未提及。）
3. 报告称有 141 条空快照（未核实）：先统计现有文件确认，再决定是否在写入端过滤空 `packages`。

方案：条目增加可选 `scopeKey` 与 `sources`；cycleCount 用真实的 SCC 结果（与 `archguard_detect_cycles` 同一来源）；写入端跳过空快照；`metrics-history-reader` 与 `archguard_get_metric_trend` 支持按 `scope` 过滤，旧条目（无 `scopeKey`）归入「unknown」而不是丢弃。

<!-- dedup-ref -->
相关但机制不同：TASK-97 的 arch-health 快照沿用同一个 scope 标识约定；TASK-91 回显查询所用 scope。本任务只处理 metrics-history 这一份文件。

## AC

- [ ] `npx vitest run tests/unit/cli/metrics-history-writer.test.ts` exit 0，新增用例：条目含 `scopeKey`；`packages` 为空时不写入
- [ ] `npx vitest run tests/unit/analysis/metrics-history-reader.test.ts` exit 0，新增用例：旧格式条目（无 `scopeKey`）仍可读，按 scope 过滤时归入 unknown
- [ ] `npx vitest run tests/unit/cli/mcp/tools/metric-trend-tool.test.ts` exit 0，新增用例：传 `scope` 只返回该 scope 的序列
- [ ] `npx vitest run tests/unit/cli/analyze/run-analysis.test.ts` exit 0，新增用例：对含一个 A↔B 环的输入，快照里相关包的 `cycleCount` 大于 0
- [ ] 本文件 `## Evidence` 小节记录对现有 `metrics-history.jsonl` 的空快照统计（总行数、空 `packages` 行数）
- [ ] `npm run type-check && npm run lint` exit 0

## DoD

对一个含已知环的真实小项目连续 analyze 两个不同 scope，`archguard_get_metric_trend` 按 scope 过滤后各自只含自己的快照，环所在包的 `cycleCount` 非零；既有的旧 `metrics-history.jsonl` 仍可读取。

## Touches

- `src/cli/metrics-history-writer.ts`
- `src/analysis/metrics-history-reader.ts`
- `src/cli/mcp/tools/metric-trend-tools.ts`
- `src/cli/analyze/run-analysis.ts`
- `tests/unit/cli/metrics-history-writer.test.ts`
- `tests/unit/analysis/metrics-history-reader.test.ts`
- `tests/unit/cli/mcp/tools/metric-trend-tool.test.ts`
- `tests/unit/cli/analyze/run-analysis.test.ts`
- `tasks/TASK-100.md`
