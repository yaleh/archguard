---
id: TASK-25
title: "Refactor: move MCP tool business logic into analysis layer (ADR-006)"
status: done
labels:
  - refactor
  - source:backlog-TASK-25
parent: null
children: []
extra:
  acceptance: npm run type-check && npm test -- --run
    tests/unit/cli/mcp/test-analysis-mcp.test.ts
    tests/unit/cli/mcp/atlas-analytics-tools.test.ts
    tests/unit/cli/mcp/tools/package-metrics-tool.test.ts
    tests/unit/cli/mcp/tools/metric-trend-tool.test.ts
---
Move build/compute logic (e.g. `buildSuggestedPatternConfig`) from `src/cli/mcp/tools/test-analysis-tools.ts` into the `src/analysis/` layer; MCP tool files keep only schema validation + formatting, per ADR-006 ("tools should be thin"). Also check other MCP tool files for similar violations.

Source: archguard backlog TASK-25 (kind:basic). Seeded 2026-07-20 as a real quay-native task to bootstrap a quay-loop board on archguard (DIR-036-B plumbing).