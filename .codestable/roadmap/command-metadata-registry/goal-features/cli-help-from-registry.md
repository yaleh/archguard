# cli-help-from-registry Goal Feature Spec

## Roadmap Link

- Roadmap item: `cli-help-from-registry`
- Feature type: `mixed`
- Dependencies: `command-metadata-registry-core`

## Source Documents

- Design: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-design.md`
- Checklist: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-checklist.yaml`
- Design review: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-design-review.md`
- Implementation review: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-review.md`
- QA report: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-qa.md`
- Acceptance report: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-acceptance.md`

## Core Running Path

Build or run the CLI entrypoint, execute `archguard help --json`, parse stdout as JSON, and compare it with registry metadata and Commander runtime command/option objects.

## Mandatory Commands

- `npm run type-check`
- `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/cli-metadata-drift.test.ts`
- `npm test -- tests/unit/cli/command.test.ts tests/unit/cli/commands/query.test.ts`
- `npm run build`
- `node dist/cli/index.js help --json`

## Acceptance Evidence

- `archguard help --json` emits deterministic valid JSON and no progress/log text.
- `archguard --help` and `archguard query --help` remain human-readable Commander help.
- Structured help includes all 7 CLI commands.
- Structured help includes query option MCP mappings where present, including `query --summary` -> `archguard_summary`.
- CLI drift tests enumerate `createCLI().commands` and each command `.options[]`; they do not grep source text.
- Human help output shape is snapshot-tested or equivalently asserted.
- No command handler behavior changes.

## Deliverables

- New `help` command or equivalent structured help entrypoint.
- Registry-backed CLI help/catalog serializer.
- CLI drift and structured-help tests.
- Any architecture note needed to document `archguard help --json` as the agent-readable CLI catalog.

## Cleanliness Rules

- Keep option registration behavior stable, especially in `query.ts`.
- Do not mix JSON with extra stdout output.
- Do not hand-author a duplicate long command table outside the registry.
- Do not migrate MCP or docs surfaces in this feature.

## Failure Recovery Boundaries

- If Commander `help` conflicts with the new command name, adjust the command implementation while preserving `archguard help --json` as the external contract; hand off if that contract must change.
- If human help snapshots fail because of expected registry-derived wording, update the assertions with explicit compatibility rationale.
- If CLI drift tests reveal missing metadata, fix the registry or option metadata before review.
- If build/test tooling is missing, use normal project dependencies or existing runners; do not add fake command shims.
