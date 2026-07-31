---
id: TASK-25
title: 'Refactor: move MCP tool business logic into analysis layer (ADR-006)'
status: 'Basic: Done'
assignee: []
created_date: '2026-06-30 05:19'
updated_date: '2026-06-30 05:22'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
将 src/cli/mcp/tools/test-analysis-tools.ts 中的 buildSuggestedPatternConfig 等构建/计算逻辑迁移到 src/analysis/ 层，MCP 工具文件只保留 schema 验证和格式化，遵循 ADR-006"工具应该薄"原则。同步检查其他 MCP 工具文件中是否有类似违规。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Move MCP tool business logic into analysis layer (ADR-006)

## Background

ADR-006 establishes MCP tool design standards (naming, descriptions, schema, output format, error handling). The underlying architectural principle — tools should be thin wrappers — is violated in two tool files:

**test-analysis-tools.ts (368 lines)**
- `buildSuggestedPatternConfig(frameworks)` (lines 21-100): 80-line pure function that maps framework names (vitest, jest, junit4, gtest, pytest, etc.) to assertion regex patterns. This is domain logic, not tool wiring.
- `buildZeroTestsDiagnosticResponse(archDir)` (lines 114-141): async helper that reads the manifest and assembles a formatted diagnostic. Borderline — involves async I/O tied to the MCP error presentation path; treat as presentation helper and leave in tool layer.

**atlas-analytics-tools.ts (289 lines)**
- `computePackageFanMetrics(graph)` (lines 36-49): pure computation of fan-in/fan-out counts from a PackageGraph. Already exported.
- `enrichPackageNodes(nodes, fanIn, fanOut)` (lines 55-65): pure node enrichment transform. Already exported.
- `EnrichedPackageNode` interface (line 26): domain type, should travel with the functions.
- Tests in `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` already cover these functions by importing from the tools file; they will need import path updates after migration.

## Goals

1. Extract `buildSuggestedPatternConfig` → `src/analysis/pattern-config-builder.ts`
2. Extract `computePackageFanMetrics`, `enrichPackageNodes`, `EnrichedPackageNode` → `src/analysis/package-fan-metrics.ts`
3. Tool files retain only: schema definitions, `resolveRoot`/`loadEngine` calls, `textResponse` formatting, `server.tool()` registration
4. All existing tests pass unchanged (only import paths update in atlas test file)
5. New unit tests in `tests/unit/analysis/` cover the migrated functions in their new home

## Findings: ADR-006 Scope Note

ADR-006 explicitly governs description quality, naming, schema completeness, output format, and error handling — not file placement of business logic. The refactoring is architecturally sound ("thin tools"), but should be framed as an architectural hygiene task that is inspired by the thin-tool principle implicit in ADR-006 rather than a direct compliance fix.

## Proposed Approach

1. Create `src/analysis/pattern-config-builder.ts` — move `buildSuggestedPatternConfig`, export it
2. Create `src/analysis/package-fan-metrics.ts` — move `computePackageFanMetrics`, `enrichPackageNodes`, `EnrichedPackageNode`, export all
3. Update tool files to import from new modules
4. Update `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` import path
5. Add new dedicated unit tests in `tests/unit/analysis/`

## Trade-offs and Risks

- MCP tool external API (tool names, inputSchema, output format) unchanged — zero consumer impact
- `EnrichedPackageNode` moves from tools file to analysis layer; atlas-analytics-tools.test.ts must re-export or update its import — low risk, mechanical change
- `buildZeroTestsDiagnosticResponse` stays in tools layer (async I/O + MCP presentation concern)
- No scope creep into other tool files beyond test-analysis-tools.ts and atlas-analytics-tools.ts

---

# Plan: Move MCP tool business logic into analysis layer (ADR-006)

## Phase A: Extract buildSuggestedPatternConfig → src/analysis/pattern-config-builder.ts

### Tests (write first)
- Create `tests/unit/analysis/pattern-config-builder.test.ts`
- Cases: typescript/js frameworks (vitest/jest/mocha/jasmine → `\bexpect\s*\(`), Java (junit4/junit5/testng/assertj/jmh), Go (testify/testing), C++ (gtest/catch2/doctest/assert), Python (pytest/unittest), playwright/cypress, empty input → `{}`
- Deduplication: [vitest, jest] → single `\bexpect\s*\(` pattern
- At least 10 it-blocks covering all switch branches

### Implementation
1. Create `src/analysis/pattern-config-builder.ts`:
   - Export `buildSuggestedPatternConfig(frameworks: string[]): Record<string, string[]>`
   - Move full switch-case body verbatim from test-analysis-tools.ts
2. Update `src/cli/mcp/tools/test-analysis-tools.ts`:
   - Add `import { buildSuggestedPatternConfig } from '@/analysis/pattern-config-builder.js'`
   - Delete the local `buildSuggestedPatternConfig` function body

### DoD
- [ ] `npm test -- --run tests/unit/analysis/pattern-config-builder.test.ts` passes
- [ ] `! grep -q 'function buildSuggestedPatternConfig' src/cli/mcp/tools/test-analysis-tools.ts`

---

## Phase B: Extract computePackageFanMetrics + enrichPackageNodes → src/analysis/package-fan-metrics.ts

### Tests (write first)
- Create `tests/unit/analysis/package-fan-metrics.test.ts`
- Mirror existing tests from `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` (computePackageFanMetrics and enrichPackageNodes describe blocks) but import from `@/analysis/package-fan-metrics.js`
- At least 6 it-blocks (fan-in count, fan-out count, zero-edge node, enrichment, absent-node defaults, multi-edge)

### Implementation
1. Create `src/analysis/package-fan-metrics.ts`:
   - Export `EnrichedPackageNode` interface
   - Export `computePackageFanMetrics(graph: PackageGraph): { fanIn: Map<string, number>; fanOut: Map<string, number> }`
   - Export `enrichPackageNodes(nodes: PackageNode[], fanIn: Map<string, number>, fanOut: Map<string, number>): EnrichedPackageNode[]`
2. Update `src/cli/mcp/tools/atlas-analytics-tools.ts`:
   - Replace local definitions with `import { computePackageFanMetrics, enrichPackageNodes, type EnrichedPackageNode } from '@/analysis/package-fan-metrics.js'`
   - Remove the three local definitions
3. Update `tests/unit/cli/mcp/atlas-analytics-tools.test.ts`:
   - Change imports of `computePackageFanMetrics`, `enrichPackageNodes`, `EnrichedPackageNode` to come from `@/analysis/package-fan-metrics.js` (not from the tools file)

### DoD
- [ ] `npm test -- --run tests/unit/analysis/package-fan-metrics.test.ts` passes
- [ ] `npm test -- --run tests/unit/cli/mcp/atlas-analytics-tools.test.ts` passes
- [ ] `! grep -q 'function computePackageFanMetrics' src/cli/mcp/tools/atlas-analytics-tools.ts`

---

## Constraints
- MCP tool external interface (tool name, inputSchema, output JSON shape) unchanged
- `buildZeroTestsDiagnosticResponse` stays in test-analysis-tools.ts (async I/O + MCP error presentation)
- Do not modify ADR-006
- Migrated functions must have dedicated unit tests in `tests/unit/analysis/`

## File Change Map
| Action | File |
|--------|------|
| CREATE | `src/analysis/pattern-config-builder.ts` |
| CREATE | `src/analysis/package-fan-metrics.ts` |
| MODIFY | `src/cli/mcp/tools/test-analysis-tools.ts` |
| MODIFY | `src/cli/mcp/tools/atlas-analytics-tools.ts` |
| MODIFY | `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` |
| CREATE | `tests/unit/analysis/pattern-config-builder.test.ts` |
| CREATE | `tests/unit/analysis/package-fan-metrics.test.ts` |

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test
- [ ] #2 npm run type-check
- [ ] #3 npm run lint
<!-- DOD:END -->
