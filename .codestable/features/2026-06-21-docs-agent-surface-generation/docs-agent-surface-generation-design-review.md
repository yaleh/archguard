---
doc_type: feature-design-review
feature: 2026-06-21-docs-agent-surface-generation
status: passed
reviewed: 2026-06-21
round: 2
---

# docs-agent-surface-generation feature design Review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-design.md`
- Checklist: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-checklist.yaml`
- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Related docs: `.codestable/attention.md`, `README.md`, `docs/user-guide/cli-usage.md`, `docs/user-guide/mcp-usage.md`, `.github/workflows/ci.yml`
- Code facts checked: `package.json`, `.github/workflows/ci.yml`, `src/cli/commands/query.ts`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `accb4f24-702d-4958-8210-97fcf4e1a44a`
- Raw output: Paseo activity; findings merged.
- Merge policy: the E2E breadth blocking finding and all important findings were fact-checked and incorporated into design/checklist.
- Gate effect: none.

## 2. Design Summary

- Goal: registry-backed docs/agent surface generation with full CLI/MCP/docs E2E.
- Key contracts: marker-bounded docs, stale-doc check, full surface E2E over all baseline commands/tools/mappings.
- Steps: 7; includes stale runtime wording cleanup and ADR update.
- Checks: 10; include full E2E breadth and CI/test:coverage reachability.
- Baseline / validation: build, docs check, E2E, npm test/test:coverage or explicit CI docs step.

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

- A full metadata E2E must compare the complete surface, not a single representative command/tool.

### praise

- The final feature now owns the full cross-surface verification and ADR/doc cleanup.

## 4. User Review Focus

- Confirm the full E2E path is sufficient: all 7 CLI commands, all 24 MCP tools, all parity mappings, workflow-dependent callFirst categories, and docs stale-check.

## 5. Residual Risk

- The E2E test may need to build missing harness around in-process MCP listTools metadata.
- Generated docs must keep marker blocks narrow to avoid noisy review diffs.

## 6. Verdict

- Status: passed
- Next: user design review.

