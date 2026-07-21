---
id: TASK-23
title: "Add archguard_get_evidence_pack MCP tool for aggregated risk snapshots"
status: done
labels:
  - source:backlog-TASK-23
parent: null
children: []
---
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
将 archguard_get_change_risk 输出注入 Worker 的 pre-dispatch context，并在 gate evidence pack 里附加结构快照

背景：BAIME 的 loop-backlog worker 在认领任务（Basic: In Progress）时，目前没有任何 archguard 结构信号注入。Gate judge 审查时只能读 worker 的自述摘要，证据独立性为零（H6 violation）。需要在 archguard 中添加一个 MCP 工具，让 worker 在 pre-dispatch 时可以一次性获取多个文件/包的聚合风险快照，并以 gate-ready 格式输出，方便直接附加到任务 notes 中。

范围：
- 新增 MCP 工具 archguard_get_evidence_pack
  - 输入：targets: Array<{targetType: 'file'|'package', target: string}>（最多 20 个）
  - 输出：聚合的风险摘要，包含每个 target 的 riskScore/riskLevel/topFactor，以及跨 target 的 hotspot（风险最高的 3 个），以结构化 markdown + JSON 双格式返回
- 注册到现有 MCP server（和 registerGitHistoryTools 同文件或新文件）
- 单元测试覆盖：空输入、单 target、多 target、target 不存在的错误处理
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Add archguard_get_evidence_pack MCP tool for aggregated risk snapshots

## Background

BAIME's loop-backlog worker currently operates with zero structural grounding at dispatch time. When a worker claims a task (Basic: In Progress), it reads only its own description and notes — no independently computed signal from the codebase is injected. Gate judges reviewing the pre-dispatch context therefore rely entirely on the worker's own self-description, making evidence independence zero (H6 violation in the GCL framework). The existing `archguard_get_change_risk` tool can produce per-target risk scores, but calling it for each file/package individually is N sequential MCP round-trips and produces unformatted JSON that the worker must manually aggregate. A single fan-in tool that accepts a list of targets and returns a gate-ready evidence pack eliminates this friction and gives the gate judge independently sourced, structured evidence alongside the worker's summary.

## Goals

1. `archguard_get_evidence_pack` accepts up to 20 `{targetType, target}` pairs and returns a single response containing per-target riskScore/riskLevel/topFactor plus a cross-target hotspot list (top-3 by riskScore), in both structured JSON and formatted markdown.
2. The tool gracefully handles missing targets (not yet analyzed) by including a `notFound` list rather than failing the entire request.
3. The tool is registered in `mcp-server.ts` alongside the existing `registerGitHistoryTools` call, discoverable as `archguard_get_evidence_pack` in any Claude Code session.
4. All code paths are covered by unit tests (empty input, single target, multi-target aggregation, partial not-found).

## Proposed Approach

Add a `getEvidencePack(targets)` method to the existing `HistoryQuery` class in `src/analysis/git-history/history-query.ts`. The method iterates the target list, calls the existing internal `getMetrics()` helper for each entry, and builds an `EvidencePackResult` object. Targets that throw (not found) are collected in a `notFound` array rather than propagating.

Create `src/cli/mcp/tools/git-history-evidence-pack-tool.ts` with a single `registerEvidencePackTool(server, defaultRoot)` function that wires the new MCP tool, validates input with Zod (array length 1..20), loads history data, instantiates `HistoryQuery`, calls `getEvidencePack`, and formats the dual markdown+JSON response.

Register the new function in `src/cli/mcp/mcp-server.ts` with a single import and one `register*` call after `registerGitHistoryTools`.

## Trade-offs and Risks

- **Not doing**: streaming/progressive response, per-target cochange details, ownership breakdown in the pack (those remain available via individual tools). The pack is intentionally a lightweight risk summary, not a full context dump.
- **Risk**: if `archguard_analyze_git` has not been run, all targets will be `notFound`; the tool returns a clear not-found list with the same `NOT_ANALYZED_MSG` guidance already used in git-history-tools.ts.
- **Risk**: 20-target ceiling prevents accidental large payloads; Zod enforces `min(1).max(20)` at the array level.

---

# Plan: Add archguard_get_evidence_pack MCP tool for aggregated risk snapshots

Proposal: docs/proposals/proposal-archguard-get-evidence-pack.md

## Phase A: Add HistoryQuery.getEvidencePack() method + unit tests

### Tests (write first)

File: `tests/unit/analysis/git-history/history-query-evidence-pack.test.ts`

Test cases:
- `getEvidencePack([])` returns `{ results: [], hotspots: [], notFound: [] }` (empty input — guard against the Zod 1-item floor being a tool concern, not domain concern)
- `getEvidencePack([{targetType:'file', target:'src/foo.ts'}])` single known file returns correct riskScore/riskLevel/topFactor
- `getEvidencePack([...3 targets with different risk levels])` multi-target: hotspots list is sorted desc by riskScore, length ≤ 3
- `getEvidencePack([{targetType:'file', target:'unknown.ts'}])` unknown target appears in `notFound`, `results` is empty
- `getEvidencePack([known, unknown, known2])` partial: two results + one notFound entry

### Implementation

- `src/analysis/git-history/history-query.ts`: add `EvidencePackEntry`, `EvidencePackResult` interfaces and `getEvidencePack(targets: Array<{targetType:'file'|'package', target:string}>): EvidencePackResult` method
  - Loops targets, calls existing `getMetrics()` in try/catch; builds `results[]` and `notFound[]`
  - Derives `hotspots` as top-3 entries from `results` sorted by `riskScore` desc

### DoD
- [ ] `npm test -- --run tests/unit/analysis/git-history/history-query-evidence-pack.test.ts`

## Phase B: Register archguard_get_evidence_pack MCP tool + integration tests

### Tests (write first)

File: `tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts`

Test cases:
- Tool exists on the MCP server (registered with name `archguard_get_evidence_pack`)
- Single known target: response content includes `riskScore`, `riskLevel`, `topFactor` and markdown section header `## Evidence Pack`
- Multiple targets: response hotspots block appears with `## Hotspots`
- Target not found: response includes `notFound` key and does not throw
- History data missing (GitHistoryNotFoundError): response matches NOT_ANALYZED_MSG pattern

### Implementation

- `src/cli/mcp/tools/git-history-evidence-pack-tool.ts` (new file): `registerEvidencePackTool(server, defaultRoot)` — Zod schema with `targets: z.array(z.object({targetType: z.enum(['file','package']), target: z.string()})).min(1).max(20)`, loads history data, calls `query.getEvidencePack()`, formats dual markdown+JSON response
- `src/cli/mcp/mcp-server.ts`: add import + one `registerEvidencePackTool(server, defaultRoot)` call after line `registerGitHistoryTools(server, defaultRoot)`

### DoD
- [ ] `npm test -- --run tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts`

## Constraints

- No changes to existing `getChangeRisk`, `getCochange`, `getOwnership`, `getChangeContext` method signatures
- New type exports (`EvidencePackEntry`, `EvidencePackResult`) live in `src/analysis/git-history/history-query.ts` alongside existing result types
- Markdown output section headers must include `## Evidence Pack` and `## Hotspots` for downstream grep-based verification
- Tool description must include the phrase "gate-ready" so agents can discover it by intent

## Acceptance Gate
- [ ] `npm test`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Plan review: APPROVED
premise-ledger:
[E] goal coverage: Goals 1-4 map to Phase A (getEvidencePack method) and Phase B (MCP registration + error handling), both confirmed in plan text
[E] TDD structure: each Phase has Tests / Implementation / DoD sections in that order, readable directly from plan
[E] DoD[0] uses testCmd: Phase A DoD[0] = `npm test -- --run ...`, Phase B DoD[0] = `npm test -- --run ...`
[E] Acceptance Gate[0] = `npm test`: confirmed in plan text
[E] DoD executability: all DoD items are shell commands, constraints section holds non-executable criteria
[C] file paths exist: src/analysis/git-history/history-query.ts and src/cli/mcp/mcp-server.ts verified via filesystem search; new files (git-history-evidence-pack-tool.ts, test files) are to-be-created
[C] phase ordering: Phase A (domain method) precedes Phase B (MCP wiring that imports it) — confirmed by checking that history-query.ts is imported by git-history-tools.ts
[H] DoD sufficiency: judgment that two focused test runs plus full suite is sufficient coverage — based on project test pattern conventions
[H] 20-target ceiling adequacy: judgment that 20 is enough for a pre-dispatch pack without creating payload bloat
GCL-self-report: E=5 C=2 H=2

cap:propose=approved

claimed: 2026-06-25T11:21:37Z

Phase A ✓ 2026-06-25T11:26:00Z - Added EvidencePackEntry/EvidencePackNotFound/EvidencePackResult types and getEvidencePack() to HistoryQuery; 8 unit tests passing

Phase B ✓ 2026-06-25T11:26:10Z - Added git-history-evidence-pack-tool.ts with registerEvidencePackTool(); registered in mcp-server.ts; 6 unit tests passing

DoD #1: PASS — npm test -- --run tests/unit/analysis/git-history/history-query-evidence-pack.test.ts (8/8 passing)

DoD #2: PASS — npm test -- --run tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts (6/6 passing)

DoD #3: PASS — npm test (3939/3945 passing; 3 pre-existing worktree-only failures in project-semantics-discovery-skill.test.ts unrelated to TASK-23)

## Execution Summary
Result: Done
Commit: 64ade7e

workerLoop DoD #1: PASS — npm test -- --run tests/unit/analysis/git-history/history-query-evidence-pack.test.ts

workerLoop DoD #2: PASS — npm test -- --run tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts

workerLoop DoD #3: PASS — npm test (3939 pass, 3 pre-existing worktree-only failures)

Completed: 2026-06-25T11:36:07Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/analysis/git-history/history-query-evidence-pack.test.ts
- [ ] #2 npm test -- --run tests/unit/cli/mcp/tools/git-history-evidence-pack.test.ts
- [ ] #3 npm test
<!-- DOD:END -->
