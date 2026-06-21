# command-metadata-registry-core Goal Feature Spec

## Roadmap Link

- Roadmap item: `command-metadata-registry-core`
- Feature type: `functional`
- Dependencies: none

## Source Documents

- Design: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-design.md`
- Checklist: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-checklist.yaml`
- Design review: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-design-review.md`
- Implementation review: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-review.md`
- QA report: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-qa.md`
- Acceptance report: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-acceptance.md`

## Core Running Path

Import the new registry module in a real TypeScript test, validate the complete baseline inventory, and prove the import has no Commander or MCP SDK side effects.

## Mandatory Commands

- `npm run type-check`
- `npm test -- tests/unit/cli/metadata-registry.test.ts`
- `npm test -- tests/unit/cli/command.test.ts tests/unit/cli/mcp/mcp-server.test.ts`

## Acceptance Evidence

- Registry exports exactly 7 CLI command IDs: `analyze`, `cache`, `check`, `diff`, `init`, `mcp`, `query`.
- Registry exports exactly 24 MCP tool names from the roadmap baseline.
- Registry records the ADR-007 parity map plus `archguard_analyze` -> `archguard analyze` and `archguard_analyze_git` -> `archguard analyze --include-git`.
- Workflow-dependent tools have explicit `callFirst` guidance for query-artifact, test-analysis, git-history, and Atlas categories.
- Every entry has non-empty `summary`, `agent.useWhen`, `agent.failureRecovery`, `agent.limitations`, examples, and verification hints that reference real commands or test files.
- Negative validator evidence proves missing baseline metadata fails.
- Import side-effect evidence proves the metadata module does not import Commander or the MCP SDK.

## Deliverables

- `src/cli/metadata/` typed model, registry, exports, and validators.
- Focused registry unit tests.
- Architecture or ADR note candidate recording that the registry is the source of command/tool inventory and agent guidance.

## Cleanliness Rules

- Do not change CLI command names, flags, MCP tool names, schemas, handlers, QueryEngine behavior, analysis output, or docs rendering.
- Do not add TODO/FIXME placeholders to registry entries.
- Do not import heavy runtime modules from metadata.
- Do not generate unchecked files.

## Failure Recovery Boundaries

- If current tests are red before implementation, record baseline evidence and re-run after the registry change.
- If a new tool/command appears during implementation, update the baseline intentionally in design/checklist evidence or hand off if it changes roadmap scope.
- If validator failures show an incomplete inventory, fix registry data before moving to review.
- If type/test tooling is missing, add normal project dependencies or use existing runners; do not add fake shims or fake passing tests.
