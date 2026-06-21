# docs-agent-surface-generation Goal Feature Spec

## Roadmap Link

- Roadmap item: `docs-agent-surface-generation`
- Feature type: `mixed`
- Dependencies: `cli-help-from-registry`, `mcp-agent-descriptions-from-registry`

## Source Documents

- Design: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-design.md`
- Checklist: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-checklist.yaml`
- Design review: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-design-review.md`
- Implementation review: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-review.md`
- QA report: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-qa.md`
- Acceptance report: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-acceptance.md`

## Core Running Path

Run the full metadata surface E2E: registry data must appear consistently in CLI structured help, in-process MCP metadata, generated or stale-checked docs blocks, and agent-surface documentation.

## Mandatory Commands

- `npm run type-check`
- `npm run build`
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`
- `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/mcp/mcp-metadata-drift.test.ts`
- docs check command added by this feature, for example `npm run docs:check`
- `npm test`
- `npm run test:coverage` or CI proof that `npm run docs:check` runs separately

## Acceptance Evidence

- README and user-guide surface sections are generated or stale-checked from registry metadata.
- `docs/user-guide/agent-surface.md` exists and covers Claude and Codex workflows, including setup differences where MCP registration differs.
- Agent workflows cover analyze -> summary/query, analyze with tests -> test metrics/issues/coverage, analyze with git -> change context/cochange/risk/ownership, and Go Atlas analysis -> Atlas layers/analytics.
- Docs stale-check passes on checked-in docs and fails on an intentional mismatch in a test or equivalent negative fixture.
- Full E2E verifies all 7 CLI commands, all 24 MCP tools, all 22 ADR-007 query mappings plus `archguard_analyze` and `archguard_analyze_git`, workflow-dependent callFirst categories, and docs stale-check.
- CI or `npm run test:coverage` runs the relevant drift/E2E/docs checks.
- Current user-facing guidance uses `archguard analyze --include-git`; no stale `archguard analyze-git` wording remains outside historical discussion.
- ADR-006/ADR-007 are updated or a new ADR documents registry-owned descriptions and parity metadata.

## Deliverables

- Deterministic docs render/check script.
- Marker-bounded generated or stale-checked README/user-guide blocks.
- `docs/user-guide/agent-surface.md`.
- Full metadata surface E2E test.
- Package script and CI/test wiring for docs drift checks.
- ADR update/new ADR for registry source-of-truth responsibilities.

## Cleanliness Rules

- Keep generated blocks narrow and deterministic.
- Do not hand-edit generated sections without changing renderer/check output.
- Do not change command/tool runtime behavior.
- Do not add fake command shims, fake test runners, or tests that bypass real CLI/MCP code paths.

## Failure Recovery Boundaries

- If docs check is flaky or noisy, narrow marker blocks or deterministic ordering before review.
- If full E2E cannot inspect MCP metadata, add a real in-process harness; do not substitute hosted Claude Code MCP evidence.
- If CI cannot run docs checks through coverage, add an explicit CI `npm run docs:check` step and record it in QA.
- If stale runtime wording is found in current user-facing messages, fix the source text and rerun search plus tests.
