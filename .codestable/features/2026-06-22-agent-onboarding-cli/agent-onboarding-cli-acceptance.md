---
doc_type: feature-acceptance
feature: 2026-06-22-agent-onboarding-cli
status: passed
accepted: 2026-06-22
---

# agent-onboarding-cli Acceptance

## Summary

Implemented the approved onboarding CLI feature:

- Added runtime `archguard install`, `archguard update`, and `archguard config show/remove`.
- Kept provider-specific config parsing/writing behind provider adapters.
- Promoted `install`, `update`, and `config` into the runtime metadata baseline as experimental commands.
- Added temp HOME unit coverage and built CLI E2E for Codex and Claude onboarding.
- Refreshed generated README/user-guide/agent-surface docs blocks.

## Evidence

- `npm test -- tests/unit/cli/onboarding-cli.test.ts tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/help-command.test.ts`: passed
- `npm run type-check`: passed
- targeted onboarding lint command: passed
- `npm run build`: passed
- built CLI `install codex --dry-run`, `install claude --dry-run`, `config show codex --json`, `config remove codex --dry-run`: passed
- `npm run test:e2e`: passed
- `npm run docs:check`: passed

## Checklist Audit

- All implementation steps are `done`.
- All acceptance checks are `passed`.
- Review report status is `passed`.
- QA report status is `passed`.

## Architecture / Requirement Updates

- `.codestable/architecture/ARCHITECTURE.md` now records the onboarding command modules and the runtime experimental metadata baseline.

## Verdict

- Status: passed
