---
id: TASK-20
title: 'Package metrics aggregation MCP tool: fan-in, fan-out, cycle count'
status: 'Basic: Done'
assignee: []
created_date: '2026-06-23 15:37'
updated_date: '2026-06-23 15:56'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
原始指标聚合 MCP 工具：为 LLM 消费者提供客观的包级结构指标，包括 fan-in（被依赖数）、fan-out（依赖数）、cycle count（所在循环依赖数），不做加权或语义判断，直接暴露原始数值供 LLM 分析。指标通过新增 MCP 工具返回，复用 ArchGuard 现有的 get_package_fanin、get_package_fanout、detect_cycles 能力并聚合为单一接口。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Plan: Package metrics aggregation MCP tool

## Phase A: 实现 archguard_get_package_metrics MCP 工具

### Tests (write first)
- tests/unit/cli/mcp/tools/package-metrics-tool.test.ts
  - archguard_get_package_metrics 返回 fanIn、fanOut、cycleCount 字段
  - 不指定包名时返回所有包列表
  - 指定包名时只返回该包数据
  - cycleCount 为 0 时 cyclesWith 为空数组
  - cycleCount > 0 时 cyclesWith 包含相关包名（从 CycleInfo.memberNames 过滤）

### Implementation

**src/cli/mcp/tools/package-metrics-tools.ts（新建）**
- 注册 `archguard_get_package_metrics` 工具
- 参数：projectRoot、scope（可选）、packageName（可选，过滤单个包）
- 内部逻辑：
  1. `loadEngine` 获取 engine
  2. `engine.getPackageStats()` → 从 `packages` 数组得到每个包的 fileCount/entityCount（无内置 fanIn/fanOut）
  3. `engine.getCycles()` → `CycleInfo[]`；对每个包，统计其出现在多少 SCC 中（cycleCount）及相关 memberNames（cyclesWith）
  4. fan-in/fan-out 复用 `computePackageFanMetrics`（已在 atlas-analytics-tools.ts 导出）或直接从 ArchJSON relations 计算
  5. 聚合为 `{ packageName, fanIn, fanOut, cycleCount, cyclesWith }[]` 后 JSON 返回

**src/cli/mcp/mcp-server.ts**
- 在现有 tool 注册区域后调用 `registerPackageMetricsTools(server, defaultRoot)`

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/tools/package-metrics-tool.test.ts`
- [ ] `grep -q "archguard_get_package_metrics" src/cli/mcp/mcp-server.ts`

## Constraints
- 返回纯数值，不含任何分数或语义评价
- 复用现有 QueryEngine 方法（getCycles、getPackageStats）和 computePackageFanMetrics helper，不重复实现 fanin/fanout/cycle 逻辑
- fan-in/fan-out 基于 ArchJSON.relations，与现有 atlas-analytics-tools 逻辑一致

## Key Types (for implementer reference)
- `PackageStatEntry` (src/core/query/arch-metrics.ts): { package, fileCount, entityCount, methodCount, fieldCount }
- `CycleInfo` (src/types/index.ts): { size, members, memberNames, files }
- `computePackageFanMetrics` (src/cli/mcp/tools/atlas-analytics-tools.ts): exported pure function

## Acceptance Gate
- [ ] `npm test`
- [ ] `grep -q "archguard_get_package_metrics" src/cli/mcp/tools/package-metrics-tools.ts
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-23T15:42:36Z

Phase A ✓ TDD + implementation complete. 10/10 tests pass. New files: src/cli/mcp/tools/package-metrics-tools.ts, tests/unit/cli/mcp/tools/package-metrics-tool.test.ts. Extended ExtensionAccessor with getRelations()+getEntityIds(). Package names derived from entity IDs (dot-separator) for language-agnostic support. Registered in mcp-server.ts.

WARNING: agent-summary missing — execution trace unavailable

Completed: 2026-06-23T15:56:59Z
<!-- SECTION:NOTES:END -->
