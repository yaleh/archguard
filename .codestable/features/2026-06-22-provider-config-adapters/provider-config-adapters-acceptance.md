---
doc_type: feature-acceptance
feature: 2026-06-22-provider-config-adapters
status: passed
accepted: 2026-06-22
---

# provider-config-adapters Acceptance

## Summary

Implemented the approved provider adapter feature:

- Added shared provider adapter types and result contracts under `src/cli/agent/`.
- Added Claude Code JSON adapter for user/project config paths.
- Added Codex TOML adapter using `smol-toml` for user/project config paths.
- Added safe write/remove/instruction operations with dry-run, backup, and force semantics.
- Added temp HOME unit coverage for Claude and Codex config preservation.

## Evidence

- `npm test -- tests/unit/cli/agent/provider-config-adapters.test.ts`: passed
- `npm run type-check`: passed
- `npm run build`: passed
- `npx eslint src/cli/agent/**/*.ts tests/unit/cli/agent/provider-config-adapters.test.ts --ext .ts`: passed
- `npm run lint`: failed on existing repository-wide lint baseline; recorded in QA as non-blocking because new adapter files are lint-clean.

## Checklist Audit

- All implementation steps are `done`.
- All acceptance checks are `passed`.
- Review report status is `passed`.
- QA report status is `passed`.

## Architecture / Requirement Updates

- `.codestable/architecture/ARCHITECTURE.md` now records `src/cli/agent/` as the provider onboarding subsystem and documents that config mutation must go through structured adapters.

## Verdict

- Status: passed
