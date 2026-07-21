---
id: TASK-26
title: "Test: add integration tests for aggregated MCP tools (evidence_pack, metric_trend)"
status: ready
labels:
  - source:backlog-TASK-26
parent: null
children: []
---
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
为 archguard_get_evidence_pack、archguard_get_metric_trend 等聚合型 MCP 工具补充端到端集成测试，覆盖工具调用路径、数据格式正确性及异常处理。MCP 工具是 AI Agent 的直接接口，其正确性对下游使用影响大，但当前集成测试偏少（全项目仅 22 个集成测试文件）。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Add integration tests for aggregated MCP tools

## Background
ArchGuard 当前全项目仅有 22 个集成测试文件，而 MCP 工具层（10 个工具文件）的集成覆盖严重不足。聚合型工具如 `archguard_get_evidence_pack`（汇总 git 历史、变更风险、CCB 等多源数据）和 `archguard_get_metric_trend`（读取 JSONL 历史快照、计算趋势）逻辑复杂且涉及多个数据源，单元测试无法覆盖端到端数据流的正确性。MCP 工具是 AI Agent 的直接接口，错误的工具输出会直接误导 LLM 决策，因此集成测试的优先级高于普通功能模块。

现有集成测试范例（`tests/integration/cli-mcp/atlas-analytics-tools.integration.test.ts`）使用 `InMemoryTransport + createMcpServer` 模式，通过 MCP Client 直接调用工具，无需真实网络；这是本任务应遵循的测试架构。

## Goals
1. 为 `archguard_get_evidence_pack` 添加集成测试，覆盖：正常调用返回结构校验、缺少 git 历史时的降级行为、输出字段完整性
2. 为 `archguard_get_metric_trend` 添加集成测试，覆盖：JSONL 快照存在时的趋势计算、快照为空时的响应格式、多个快照时的时序保留、按 packageName 过滤
3. 新增集成测试文件 ≥2 个，新增测试 case ≥10 个，所有测试在 CI 中可稳定通过

## Proposed Approach
1. 参照 `tests/integration/cli-mcp/atlas-analytics-tools.integration.test.ts` 的 `InMemoryTransport + createMcpServer` 模式
2. 为 `evidence_pack` 在 tmp 目录创建最小化 git history fixture（manifest.json + package-metrics.json + file-metrics.json），验证输出 markdown + JSON schema
3. 为 `metric_trend` 在 tmp 目录写入临时 `metrics-history.jsonl` 文件，验证趋势计算和过滤逻辑
4. 异常路径：无历史数据时 `evidence_pack` 返回 not-analyzed 提示，`metric_trend` 返回空 snapshots 数组
5. 所有测试用 `beforeAll/afterAll` 管理 tmp 目录生命周期，确保 CI 隔离

## Trade-offs and Risks
- 集成测试依赖文件系统，需在 CI 环境中正确隔离 tmp 目录（`os.tmpdir()` + 随机后缀）
- 范围控制在 `evidence_pack` 和 `metric_trend` 两个工具，不扩散到其余 8 个工具
- `evidence_pack` 的 fixture 需要符合 `GitHistoryManifest + FileHistoryMetrics[] + PackageHistoryMetrics[]` 的完整 schema，需仔细参考 `src/types/git-history.ts`

---

# Plan: Add integration tests for aggregated MCP tools

## Phase A：为 archguard_get_evidence_pack 添加集成测试

### Tests（先写）
- 新建 `tests/integration/cli-mcp/evidence-pack.integration.test.ts`
- 使用 `InMemoryTransport + createMcpServer(tmpRoot)` 模式
- Fixture：在 `tmpRoot/.archguard/query/git-history/` 写入：
  - `manifest.json`：`{ version: "2", generatedAt: "...", packageDepth: 1, ... }`
  - `package-metrics.json`：含 1 条 `PackageHistoryMetrics`（src/cli）
  - `file-metrics.json`：含 1 条 `FileHistoryMetrics`（src/cli/index.ts）
- 测试 case（≥5 个）：
  1. 正常路径 file target：调用 handler，返回文本含 `## Evidence Pack` 标题
  2. 正常路径 package target：返回结果含 riskScore、riskLevel、topFactor 字段（JSON 块内）
  3. 输出含 hotspots：文本含 `## Hotspots`
  4. notFound 路径：target 为不存在的路径，返回文本含 `## Not Found`
  5. 无历史数据（无 manifest）：返回文本含 `Run \`archguard_analyze_git\``

### DoD
- `npm test -- --run tests/integration/cli-mcp/evidence-pack.integration.test.ts` 全绿
- `grep -q "describe.*evidence.pack" tests/integration/cli-mcp/evidence-pack.integration.test.ts`

---

## Phase B：为 archguard_get_metric_trend 添加集成测试

### Tests（先写）
- 新建 `tests/integration/cli-mcp/metric-trend.integration.test.ts`
- 使用 `InMemoryTransport + createMcpServer(tmpRoot)` 模式
- Fixture：在 `tmpRoot/.archguard/metrics-history.jsonl` 写入 2 条 JSONL 快照（不同 timestamp）
- 测试 case（≥5 个）：
  1. 无 JSONL 文件：返回 `{ snapshots: [] }`（空数组）
  2. 有 2 条快照：返回 snapshots 数组长度为 2
  3. 快照时序保留：timestamps 顺序与写入顺序一致
  4. packageName 过滤：指定存在的 package，返回 snapshots 每条 packages 只含该 package
  5. packageName 过滤（不存在）：返回空 snapshots 数组
  6. 损坏 JSONL 行（混入一行非 JSON）：其余有效行仍被解析，snapshots.length 为有效行数

### DoD
- `npm test -- --run tests/integration/cli-mcp/metric-trend.integration.test.ts` 全绿
- `grep -q "describe.*metric.trend" tests/integration/cli-mcp/metric-trend.integration.test.ts`

---

## Constraints
- 测试不依赖真实外部网络或 Claude CLI
- 测试后通过 `afterAll` 清理所有 tmp 目录
- 不修改被测工具的对外 API schema 或 MCP tool 注册名称

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test
- [ ] #2 npm run type-check
<!-- DOD:END -->
