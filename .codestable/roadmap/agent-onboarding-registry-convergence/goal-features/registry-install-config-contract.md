# Goal Feature: registry-install-config-contract

- Roadmap item: `registry-install-config-contract`
- Feature dir: `.codestable/features/2026-06-22-registry-install-config-contract`
- Design: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-design.md`
- Checklist: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-checklist.yaml`
- Design review: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-design-review.md`
- Review output: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-review.md`
- QA output: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-qa.md`
- Acceptance output: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-acceptance.md`
- Depends on: `registry-agent-guidance-contract`
- Feature nature: `non-functional`

## Core Runtime Path

none; registry contract feature, verified by type/unit/docs/drift checks.

## Mandatory Commands

- `npm run type-check`
- `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts`
- `npm run docs:check`

## Acceptance Evidence

- help immediate baseline enforcement
- install/update/config staged metadata without CLI drift
- surfacePolicy/install validators

## Deliverables

- 扩展 install/config metadata 合同，含 staged command metadata 与 validators。
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
