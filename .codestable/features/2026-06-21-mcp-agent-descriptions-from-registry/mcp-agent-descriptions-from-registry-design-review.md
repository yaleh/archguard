---
doc_type: feature-design-review
feature: 2026-06-21-mcp-agent-descriptions-from-registry
status: passed
reviewed: 2026-06-21
round: 2
---

# mcp-agent-descriptions-from-registry feature design Review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-mcp-agent-descriptions-from-registry/mcp-agent-descriptions-from-registry-checklist.yaml`
- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Related docs: `.codestable/attention.md`, `docs/adr/006-mcp-tool-design-standards.md`, `docs/adr/007-cli-mcp-interface-parity.md`
- Code facts checked: `src/cli/mcp/mcp-server.ts`, `src/cli/mcp/analyze-tool.ts`, `src/cli/mcp/tools/*.ts`, `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `accb4f24-702d-4958-8210-97fcf4e1a44a`
- Raw output: Paseo activity; findings merged.
- Merge policy: schema-shape and workflow coverage findings were fact-checked and added to design/checklist.
- Gate effect: none.

## 2. Design Summary

- Goal: registry-backed MCP tool/parameter descriptions and agent guidance.
- Key contracts: preserve 24 names, schema field names/requiredness, handlers; use in-process MCP verification.
- Steps: 6; includes schema-shape preservation and MCP E2E metadata.
- Checks: 7; include 24-tool schema assertions.
- Baseline / validation: MCP unit/integration tests.

## 3. Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- none

### learning

- Description refactors need schema-shape tests because text changes share the same registration sites as schemas.

### praise

- The design correctly excludes hosted Claude Code MCP as validation evidence.

## 4. User Review Focus

- Confirm parameter descriptions may be registry-derived where practical and drift-tested where left inline.

## 5. Residual Risk

- Existing MCP tests may need harness additions to expose listTools metadata and schema descriptions.

## 6. Verdict

- Status: passed
- Next: user design review.

