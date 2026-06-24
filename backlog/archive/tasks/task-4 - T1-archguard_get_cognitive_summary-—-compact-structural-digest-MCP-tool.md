---
id: TASK-4
title: 'T1: archguard_get_cognitive_summary — compact structural digest MCP tool'
status: 'Basic: Proposal'
assignee: []
parent_task_id: TASK-3
created_date: '2026-06-22 16:04'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement archguard_get_cognitive_summary MCP tool at src/cli/mcp/tools/cognitive-summary-tool.ts.
Returns compact structural digest (<2KB/entity) assembled from existing .archguard/ artifacts.
Fields per entity: name, type, file, methodCount, fieldCount, inDegree, outDegree,
top5Dependents, top5Dependencies, testCoverage (ratio), gitRisk (from change_risk data).
Add CognitiveSummaryEntry type to src/types/extensions/. Register in src/cli/mcp/mcp-server.ts.
Unit tests: single entity, batch of 10, missing entity (3 tests minimum).
Update docs/user-guide/mcp-usage.md with tool description.
<!-- SECTION:DESCRIPTION:END -->
