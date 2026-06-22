---
doc_type: feature-acceptance
feature: 2026-06-22-registry-install-config-contract
status: passed
accepted: 2026-06-22
---

# registry-install-config-contract Acceptance

## Summary

Implemented the approved install/config metadata contract:

- Added `SurfacePolicy`, `Lifecycle`, `ArtifactContract`, and `InstallContract`.
- Added `help` to the enforced CLI baseline and registry metadata as `cli-only`.
- Added staged `install`, `update`, and `config` metadata with experimental lifecycle and install contracts.
- Added validator rules for surface policy and install/docs relationships.
- Updated docs generated blocks and architecture notes.

## Evidence

- `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/help-command.test.ts tests/unit/cli/instruction-renderer.test.ts`: passed
- `npm run type-check`: passed
- `npm run build`: passed
- `npm run docs:check`: passed
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`: passed
- `node dist/cli/index.js help --json`: passed

## Checklist Audit

- All implementation steps are `done`.
- All acceptance checks are `passed`.
- Review report status is `passed`.
- QA report status is `passed`.

## Architecture / Requirement Updates

- `.codestable/architecture/ARCHITECTURE.md` now records staged onboarding command metadata as a validated but not-yet-runtime baseline.

## Verdict

- Status: passed
