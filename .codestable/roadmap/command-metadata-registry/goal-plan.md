# command-metadata-registry Goal Plan

- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Items: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml`
- Protocol: `.codestable/roadmap/command-metadata-registry/goal-protocol.md`
- State: `.codestable/roadmap/command-metadata-registry/goal-state.yaml`

## Feature Order

1. `command-metadata-registry-core` - functional foundation: typed registry, baseline inventory, callFirst matrix, validators.
2. `cli-help-from-registry` - mixed: CLI adapter, human help compatibility, structured `archguard help --json`.
3. `mcp-agent-descriptions-from-registry` - mixed: MCP metadata adapter, schema-shape preservation, agent descriptions.
4. `docs-agent-surface-generation` - mixed: generated/stale-checked docs and full cross-surface E2E.

## Roadmap-Level Core Validation Path

The roadmap is complete only when a real registry entry can be verified across:

1. registry inventory and validators;
2. CLI structured help via `node dist/cli/index.js help --json`;
3. in-process MCP metadata for all 24 tools;
4. docs stale-check for registry-backed README/user-guide/agent-surface sections;
5. full E2E test comparing all 7 CLI commands, all 24 MCP tools, all parity mappings, and workflow-dependent callFirst categories.

## Key Assumptions

- Commander, Zod, and the MCP SDK remain runtime registration mechanisms.
- Existing CLI command names, flags, MCP tool names, and handler behavior are compatibility boundaries.
- Generated docs use narrow marker-bounded sections.
- In-process MCP metadata inspection is available or can be added without using hosted Claude Code MCP.

## Top 3 Risks

1. **Registry becomes another copy** - mitigated by consumer drift tests per CLI/MCP/docs layer.
2. **Schema/help behavior changes accidentally** - mitigated by human help snapshots and 24-tool MCP schema-shape assertions.
3. **E2E is too narrow** - mitigated by final all-surface E2E breadth requirements, not single-sample checks.

## Mandatory Commands

- `npm run type-check`
- `npm run build`
- `npm test`
- `npm run test:coverage` or CI proof that docs checks are separately run
- targeted commands named in each feature spec

## Final Aggregate Commands

- `npm run type-check`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm test`
- `npm run test:coverage`
- docs check command added by the implementation, for example `npm run docs:check`
- `node dist/cli/index.js help --json`

## Preflight Strategy

Run cheap baseline commands first (`type-check`, targeted tests where available). If a command is red before relevant implementation, record it as baseline risk and do not attribute it to the current feature until reproduced after changes.

## Missing Tool Recovery

If a real runner or test dependency is missing, add project dependency/configuration or use an existing runner. Do not add local same-name shims or fake passing tests.

## Final Audit Artifacts

- All four feature review/QA/acceptance reports.
- Updated checklist steps/checks.
- Roadmap items marked done.
- Architecture/ADR/docs updates.
- Full metadata surface E2E evidence.
- `goal-audit.md` with aggregate commands and skipped items.

