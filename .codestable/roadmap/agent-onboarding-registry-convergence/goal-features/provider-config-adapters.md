# Goal Feature: provider-config-adapters

- Roadmap item: `provider-config-adapters`
- Feature dir: `.codestable/features/2026-06-22-provider-config-adapters`
- Design: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-design.md`
- Checklist: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-checklist.yaml`
- Design review: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-design-review.md`
- Review output: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-review.md`
- QA output: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-qa.md`
- Acceptance output: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-acceptance.md`
- Depends on: `registry-install-config-contract, agent-instructions-renderer`
- Feature nature: `functional`

## Core Runtime Path

unit tests with temp HOME proving Claude JSON and Codex TOML round-trip preserve unrelated config.

## Mandatory Commands

- `npm run type-check`
- `npm run lint`
- `npm test -- tests/unit/cli/agent/provider-config-adapters.test.ts`

## Acceptance Evidence

- Claude user/project path detection
- Codex user/project path detection
- smol-toml dependency and lockfile
- dry-run no mutation
- backup before overwrite

## Deliverables

- 实现 Claude/Codex provider adapters，支持 show/write/remove/dry-run/backup。
- Update tests/docs/architecture relationships required by the approved design.

## Cleanliness Rules

- Do not write real user HOME in tests.
- Do not broaden provider scope beyond Claude and Codex.
- Keep command metadata, help, docs, and MCP/agent surfaces derived from registry contracts.
- Do not fabricate validation by adding fake runner shims or empty tests.

## Failure Recovery Boundary

- If implementation requires changing an approved interface contract, stop and print `CS_ROADMAP_GOAL_HANDOFF`.
- If a mandatory command is unavailable because the owning feature has not run yet, defer it until that feature and record the reason.
- If a mandatory E2E path cannot be run after the owning feature, treat it as blocking unless the design explicitly permits a conditional skip.
