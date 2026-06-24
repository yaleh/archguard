---
id: TASK-21
title: >-
  Metrics history JSONL: append per-analyze snapshot and get_metric_trend MCP
  tool
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 15:38'
updated_date: '2026-06-23 15:39'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
历史趋势 JSONL：在每次 analyze 后将包级结构指标（fan-in、fan-out、cycle count、包大小等）追加写入 .archguard/metrics-history.jsonl，并通过新增 MCP 工具 get_metric_trend 返回指定包或全局的历史时间序列，供 LLM 判断指标是否在持续恶化。纯数据记录，无语义处理，无 LLM 依赖。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Plan: Metrics history JSONL

## Phase A: MetricsHistoryWriter — 追加写入 JSONL
### Tests (write first)
- tests/unit/cli/metrics-history-writer.test.ts
  - append() 在文件不存在时创建文件并写入第一行
  - append() 在文件已存在时追加新行（不覆盖）
  - 每行是合法 JSON，含 timestamp、packages 数组
  - packages 数组每项含 name、fanIn、fanOut、cycleCount

### Implementation
- src/cli/metrics-history-writer.ts（新建）
  - MetricsHistoryWriter 类，append(packages: PackageMetrics[], outputDir: string): Promise<void>
  - 追加写入 outputDir/metrics-history.jsonl
- src/cli/commands/analyze.ts
  - analyze 完成后调用 MetricsHistoryWriter.append()

### DoD
- [ ] `npm test -- --run tests/unit/cli/metrics-history-writer.test.ts`
- [ ] `grep -q "MetricsHistoryWriter" src/cli/commands/analyze.ts`

## Phase B: get_metric_trend MCP 工具
### Tests (write first)
- tests/unit/cli/mcp/tools/metric-trend-tool.test.ts
  - 无历史文件时返回空数组
  - 有历史文件时返回时间序列（数组长度 = 快照数）
  - 指定包名时只返回该包的历史
  - 返回数据含 timestamp 和指标数值

### Implementation
- src/cli/mcp/tools/metric-trend-tools.ts（新建）
  - 注册 get_metric_trend 工具
  - 读取 .archguard/metrics-history.jsonl，按包名过滤
- src/cli/mcp/mcp-server.ts
  - 导入并注册 metric-trend-tools

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/tools/metric-trend-tool.test.ts`
- [ ] `grep -q "get_metric_trend" src/cli/mcp/mcp-server.ts`

## Constraints
- JSONL 只追加，不修改历史记录
- 返回纯数值时间序列，不含趋势判断或语义标注

## Acceptance Gate
- [ ] `npm test`
- [ ] `grep -q "metrics-history.jsonl" src/cli/metrics-history-writer.ts`
<!-- SECTION:PLAN:END -->
