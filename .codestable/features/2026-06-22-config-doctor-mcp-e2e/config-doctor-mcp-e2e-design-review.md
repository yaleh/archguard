---
doc_type: feature-design-review
feature: 2026-06-22-config-doctor-mcp-e2e
status: passed
reviewed: 2026-06-22
round: 2
---

# config-doctor-mcp-e2e feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-design.md`
- Checklist: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-checklist.yaml`
- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Related docs: `.codestable/attention.md`, `docs/adr/007-cli-mcp-interface-parity.md`, `docs/user-guide/mcp-usage.md`
- Code facts checked: `src/cli/commands/mcp.ts`, `src/cli/mcp`, `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `3f52902a-c8e0-4a3a-b8a7-fe7e4efbb280`
- Raw output: Paseo activity; findings merged into this round.
- Merge policy: findings were fact-checked and design/checklist were updated before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: add `config doctor` and real E2E tests that validate install/config/instructions against the built CLI and independent MCP stdio process.
- Key contracts: `DoctorResult`, `McpProbeOptions`, provider-optional multi-provider checks, teardown guarantees, broken config fixtures.
- Steps: MCP probe helper, doctor aggregation, CLI output, E2E flows, fixtures/ADR note.

## 3. Findings

### blocking

- none

### important

- Resolved: reviewer requested process teardown semantics. Design now specifies SIGTERM, 500ms wait, then SIGKILL fallback.
- Resolved: reviewer flagged no-provider `DoctorResult` ambiguity. Design now says provider omitted means multi-provider checks with provider-qualified ids.
- Resolved: reviewer flagged E2E empty-run risk. Design/checklist now require non-empty `npm run test:e2e` with named E2E files.
- Resolved: reviewer requested broken fixture details. Design/checklist now list JSON `{}`, TOML `[other]` only, and missing-command ArchGuard entry.
- Resolved: reviewer requested concrete knowledge-backfill target. Design now names `docs/adr/007-cli-mcp-interface-parity.md`.
- Resolved: reviewer flagged config command overlap. Design now says this feature only appends/registers `doctor` in `config.ts`.

### residual-risk

- Stdio MCP probe can still be timing-sensitive; implementation must use protocol readiness and bounded teardown rather than sleeps.

## 4. User Review Focus

- Confirm that E2E must use the built CLI and an independent stdio MCP process; current agent-hosted MCP tools are not accepted as verification evidence.

## 5. Verdict

- Status: passed
- Next: user design confirmation.
