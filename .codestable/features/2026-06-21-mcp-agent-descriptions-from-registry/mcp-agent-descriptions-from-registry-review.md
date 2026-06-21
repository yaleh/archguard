---
doc_type: feature-review
feature: 2026-06-21-mcp-agent-descriptions-from-registry
status: passed
reviewed: 2026-06-21
round: 1
---

# mcp-agent-descriptions-from-registry Code Review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-checklist.yaml`
- Implementation evidence: current working tree diff plus passing validation commands.
- Diff basis: `git status --short` showed registry, MCP adapter, MCP tests, E2E tests, and CodeStable docs in the working tree.
- Baseline dirty files: prior accepted feature 1/2 files are still present in the same working tree; this review only judges MCP metadata changes and directly related registry/test edits.

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `9d85f856-a5e5-48c8-9240-68b9bca5c776`
- Raw output: returned in conversation; two important findings and several nits/suggestions.
- Merge policy: findings were locally verified against current code and tests before acceptance.
- Gate effect: both important findings were fixed before this report was marked passed.

## 2. Diff Summary

- Added: `src/cli/mcp/metadata.ts`, `tests/unit/cli/mcp/mcp-metadata-drift.test.ts`, `tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts`
- Modified: MCP registration files under `src/cli/mcp/`, `src/cli/metadata/registry.ts`, `tests/unit/cli/mcp/analyze-tool.test.ts`
- Deleted: none
- Risk hotspots: MCP tool metadata surface and schema drift assertions. Handler logic and payload output were not intentionally changed.

## 3. Findings

### blocking

- none

### important

- [x] REV-001 `src/cli/mcp/metadata.ts` Rendered descriptions were too verbose for the concise ADR-006-style contract.
  - Evidence: independent reviewer showed the initial renderer emitted summary plus separate Use when / Call first / Recovery / Limit sentences.
  - Fix: renderer now keeps the summary as sentence one and compresses guidance into a semicolon-separated second sentence.
  - Verification: `npm test -- tests/unit/cli/mcp/mcp-metadata-drift.test.ts` passed after adding length and duplicate-call-first guards.

- [x] REV-002 `src/cli/metadata/registry.ts` The generated useWhen text produced broken grammar such as `when return`.
  - Evidence: registry used `Use ${toolName} when ${summary.toLowerCase()}`.
  - Fix: useWhen now renders as `Use <tool> to <lowercase summary>`.
  - Verification: drift test now rejects `when return|analyze|detect|find|list|get`.

### nit

- REV-003 `src/cli/mcp/metadata.ts` `mcpParamDescription` is currently consumed by tests rather than registration sites.
  - Decision: accepted for this feature because design permits inline parameter descriptions when covered by drift tests.

### suggestion

- Future hardening can derive `workflowDependentMcpTools` from registry entries that have `agent.callFirst`, reducing manual list maintenance.

### learning

- Schema shape drift needs both field-set equality and requiredness equality. One-way field inclusion is not enough for MCP compatibility.

### praise

- The implementation keeps handlers and Zod validators local and behavior-preserving while moving tool-selection text to the registry.

## 4. Test And QA Focus

- QA must run the in-process MCP metadata drift test and verify all 24 tools keep names, descriptions, schema fields, requiredness, and parameter descriptions aligned.
- QA must run the in-process E2E metadata test and verify workflow-dependent tools expose `Call first` and `Recovery`.
- QA must run representative MCP behavior tests and CLI/MCP analyze equivalence to prove handler behavior did not change.

## 5. Residual Risk

- Parameter descriptions remain inline in Zod schemas and mirrored in registry metadata. This is covered by strict drift tests but still has dual-edit maintenance cost.

## 6. Verdict

- Status: passed
- Next: `cs-feat-qa`
