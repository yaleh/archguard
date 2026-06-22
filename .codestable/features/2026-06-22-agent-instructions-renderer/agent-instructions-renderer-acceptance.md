---
doc_type: feature-acceptance
feature: 2026-06-22-agent-instructions-renderer
status: passed
accepted: 2026-06-22
---

# agent-instructions-renderer Acceptance

## Summary

Implemented the approved instruction-renderer feature:

- Added pure `renderAgentInstructions` with Claude/Codex profiles and deterministic `sourceMetadataHash`.
- Added read-only `archguard agent instructions [provider]`.
- Added `agent` command metadata and CLI baseline entry.
- Rewired generated agent-surface docs to use the instruction renderer.
- Added unit and E2E coverage for provider output and hash determinism.

## Evidence

- `npm test -- tests/unit/cli/instruction-renderer.test.ts tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/help-command.test.ts`: passed
- `npm run build`: passed
- `node dist/cli/index.js agent instructions codex`: passed
- `node dist/cli/index.js agent instructions claude`: passed
- `npm run test:e2e`: passed
- `npm run docs:check`: passed
- `npm run type-check`: passed
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`: passed

## Checklist Audit

- All implementation steps are `done`.
- All acceptance checks are `passed`.
- Review report status is `passed`.
- QA report status is `passed`.

## Architecture / Requirement Updates

- `.codestable/architecture/ARCHITECTURE.md` now records `src/cli/metadata/instruction-renderer.ts` as a metadata adapter for Claude Code and Codex instructions.

## Verdict

- Status: passed
