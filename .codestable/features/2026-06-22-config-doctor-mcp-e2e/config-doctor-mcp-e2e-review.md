---
doc_type: feature-review
feature: 2026-06-22-config-doctor-mcp-e2e
status: passed
reviewed: 2026-06-22
round: 1
---

# config-doctor-mcp-e2e Review

## Scope

- Design: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-design.md`
- Checklist: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-checklist.yaml`
- Diff reviewed: `src/cli/agent/doctor.ts`, `src/cli/agent/mcp-probe.ts`, appended `config doctor` in `src/cli/commands/config.ts`, unit/E2E tests, ADR-007, architecture notes.

## Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- Future doctor extensions can add query artifact checks as warn-level diagnostics. Current scope correctly focuses on provider config and MCP availability.

### residual-risk

- `command === "archguard"` is treated as PATH-resolved and therefore runnable. This is acceptable for install defaults and current E2E, but a future doctor could optionally resolve PATH for stricter validation.

## Test And QA Focus

- Verify doctor fails before install with recovery.
- Verify doctor passes after Codex and Claude install.
- Verify stdio MCP probe launches the current built CLI and lists registry tools.
- Verify broken TOML/JSON fixtures and missing command entries fail.
- Verify E2E is real and writes only temp HOME.

## Verdict

- Status: passed
