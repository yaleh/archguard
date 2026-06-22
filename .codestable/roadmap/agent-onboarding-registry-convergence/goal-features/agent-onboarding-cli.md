# Goal Feature: agent-onboarding-cli

- Roadmap item: `agent-onboarding-cli`
- Feature dir: `.codestable/features/2026-06-22-agent-onboarding-cli`
- Design: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-design.md`
- Checklist: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-checklist.yaml`
- Design review: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-design-review.md`
- Review output: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-review.md`
- QA output: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-qa.md`
- Acceptance output: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-acceptance.md`
- Depends on: `registry-install-config-contract, agent-instructions-renderer, provider-config-adapters`
- Feature nature: `functional`

## Core Runtime Path

built CLI dry-run/show/remove flows in temp HOME for Codex and Claude.

## Mandatory Commands

- `npm run build`
- `node dist/cli/index.js install codex --home <tmp-home> --dry-run`
- `node dist/cli/index.js install claude --home <tmp-home> --dry-run`
- `node dist/cli/index.js config show codex --home <tmp-home> --json`
- `node dist/cli/index.js config remove codex --home <tmp-home> --dry-run`
- `npm test -- tests/unit/cli/onboarding-cli.test.ts`
- `npm run test:e2e`
- `npm run docs:check`

## Acceptance Evidence

- dry-run writes nothing
- non-dry-run temp HOME write only ArchGuard entries
- ConfigShowResult JSON schema
- remove requires --force unless dry-run
- generated docs blocks

## Deliverables

- 新增 install/update/config show/remove CLI，复用 adapters 和 renderer。
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
