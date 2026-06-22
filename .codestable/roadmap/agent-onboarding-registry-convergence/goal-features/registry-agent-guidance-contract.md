# Goal Feature: registry-agent-guidance-contract

- Roadmap item: `registry-agent-guidance-contract`
- Feature dir: `.codestable/features/2026-06-22-registry-agent-guidance-contract`
- Design: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-design.md`
- Checklist: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-checklist.yaml`
- Design review: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-design-review.md`
- Review output: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-review.md`
- QA output: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-qa.md`
- Acceptance output: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-acceptance.md`
- Depends on: `none`
- Feature nature: `non-functional`

## Core Runtime Path

none; metadata contract feature, verified by type/unit/docs/metadata E2E checks.

## Mandatory Commands

- `npm run type-check`
- `npm test -- tests/unit/cli/metadata-registry.test.ts`
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`
- `npm run docs:check`

## Acceptance Evidence

- validator tests for freshness/docs policy
- side-effect import regression
- metadata E2E and docs check

## Deliverables

- 扩展 agent guidance metadata 合同，补 freshness/docs policy/validator。
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
