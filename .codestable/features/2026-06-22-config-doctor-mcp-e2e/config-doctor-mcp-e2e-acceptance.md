---
doc_type: feature-acceptance
feature: 2026-06-22-config-doctor-mcp-e2e
status: passed
accepted: 2026-06-22
---

# config-doctor-mcp-e2e Acceptance

## Summary

Implemented the approved doctor/E2E closing feature:

- Added `archguard config doctor` with JSON and human output.
- Added provider config diagnostics for missing config, missing ArchGuard entry, missing instructions, and missing command path.
- Added independent stdio MCP probe that launches `node dist/cli/index.js mcp`, calls `listTools`, and records teardown timing.
- Added unit tests for pass/fail/skipped and broken config fixtures.
- Added E2E coverage for install/config/instructions/doctor against temp HOME.
- Updated ADR-007 and architecture notes with the “do not use current agent-hosted MCP for verification” rule.

## Evidence

- `npm test -- tests/unit/cli/config-doctor.test.ts tests/unit/cli/onboarding-cli.test.ts tests/unit/cli/cli-metadata-drift.test.ts`: passed
- `npm run type-check`: passed
- targeted doctor/probe lint command: passed
- `npm run build`: passed
- built CLI Codex install + doctor: passed, independent MCP listed 24 tools
- built CLI Claude install + doctor: passed, independent MCP listed 24 tools
- `npm run test:e2e`: passed
- `npm run docs:check`: passed

## Checklist Audit

- All implementation steps are `done`.
- All acceptance checks are `passed`.
- Review report status is `passed`.
- QA report status is `passed`.

## Architecture / Requirement Updates

- `.codestable/architecture/ARCHITECTURE.md` now records the doctor/probe subsystem.
- `docs/adr/007-cli-mcp-interface-parity.md` now explicitly requires independent stdio process verification for current build MCP E2E.

## Verdict

- Status: passed
