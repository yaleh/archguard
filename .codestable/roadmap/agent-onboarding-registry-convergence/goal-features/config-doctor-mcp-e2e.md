# Goal Feature: config-doctor-mcp-e2e

- Roadmap item: `config-doctor-mcp-e2e`
- Feature dir: `.codestable/features/2026-06-22-config-doctor-mcp-e2e`
- Design: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-design.md`
- Checklist: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-checklist.yaml`
- Design review: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-design-review.md`
- Review output: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-review.md`
- QA output: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-qa.md`
- Acceptance output: `.codestable/features/2026-06-22-config-doctor-mcp-e2e/config-doctor-mcp-e2e-acceptance.md`
- Depends on: `agent-onboarding-cli`
- Feature nature: `functional`

## Core Runtime Path

built CLI installs Codex/Claude in temp HOME, then config doctor launches independent stdio archguard mcp and listTools succeeds.

## Mandatory Commands

- `npm run build`
- `npm run test:e2e`
- `node dist/cli/index.js install codex --home <tmp-home>`
- `node dist/cli/index.js config doctor codex --home <tmp-home> --json`
- `node dist/cli/index.js install claude --home <tmp-home>`
- `node dist/cli/index.js config doctor claude --home <tmp-home> --json`
- `npm run docs:check`

## Acceptance Evidence

- stdio listTools includes ArchGuard MCP tools
- child process teardown within 500ms
- broken config fixtures fail with recovery
- ADR-007 verification rule recorded

## Deliverables

- 新增 config doctor、独立 stdio MCP probe 和真实 E2E 收口。
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
