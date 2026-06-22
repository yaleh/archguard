---
doc_type: feature-acceptance
feature: 2026-06-22-registry-agent-guidance-contract
status: passed
accepted: 2026-06-22
---

# registry-agent-guidance-contract Acceptance

## Summary

Implemented the approved metadata guidance contract extension:

- Added `avoidWhen` and `freshness` to `AgentGuidance`.
- Added `DocsContract` and optional `docs` policy to metadata entries.
- Backfilled registry entries through existing helper constructors.
- Added validator rules for workflow-dependent freshness and agent/docs surface policy.
- Added unit coverage for validator failures and retained metadata import side-effect regression.

## Evidence

- `npm test -- tests/unit/cli/metadata-registry.test.ts`: passed
- `npm run type-check`: passed
- `npm run build`: passed
- `npm run docs:check`: passed
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`: passed

## Checklist Audit

- All implementation steps are `done`.
- All acceptance checks are `passed`.
- Review report status is `passed`.
- QA report status is `passed`.

## Architecture / Requirement Updates

- No architecture document update required. This feature extends the existing metadata registry contract without changing runtime CLI/MCP topology.

## Verdict

- Status: passed
