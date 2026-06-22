# Goal Feature: agent-instructions-renderer

- Roadmap item: `agent-instructions-renderer`
- Feature dir: `.codestable/features/2026-06-22-agent-instructions-renderer`
- Design: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-design.md`
- Checklist: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-checklist.yaml`
- Design review: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-design-review.md`
- Review output: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-review.md`
- QA output: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-qa.md`
- Acceptance output: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-acceptance.md`
- Depends on: `registry-agent-guidance-contract`
- Feature nature: `mixed`

## Core Runtime Path

node dist/cli/index.js agent instructions codex and claude after build.

## Mandatory Commands

- `npm run build`
- `node dist/cli/index.js agent instructions codex`
- `node dist/cli/index.js agent instructions claude`
- `npm test -- tests/unit/cli/instruction-renderer.test.ts`
- `npm run test:e2e`
- `npm run docs:check`

## Acceptance Evidence

- built CLI output for codex and claude
- deterministic sourceMetadataHash
- non-empty tests/e2e execution
- docs renderer reuses instruction renderer

## Deliverables

- 从 registry 生成 Claude/Codex instructions，并提供只读 CLI。
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
