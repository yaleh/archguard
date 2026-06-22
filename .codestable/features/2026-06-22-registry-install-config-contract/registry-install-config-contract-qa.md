---
doc_type: feature-qa
feature: 2026-06-22-registry-install-config-contract
status: passed
reviewed: 2026-06-22
---

# registry-install-config-contract QA

## Validation Commands

- `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/help-command.test.ts tests/unit/cli/instruction-renderer.test.ts`
  - Result: passed
  - Evidence: 31 tests passed, including staged metadata, help baseline, surface policy, and install/docs validator cases.
- `npm run type-check`
  - Result: passed
  - Evidence: `tsc --noEmit` exited 0.
- `npm run build`
  - Result: passed
  - Evidence: TypeScript build and dist import fix completed.
- `npm run docs:check`
  - Result: passed after `npm run docs:write`
  - Evidence: metadata docs are up to date.
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`
  - Result: passed
  - Evidence: 2 tests passed; structured help, MCP metadata, and docs blocks remain aligned.
- `node dist/cli/index.js help --json`
  - Result: passed
  - Evidence: runtime structured help commands are `analyze,agent,cache,check,diff,help,init,mcp,query`; staged `install/update/config` are not exposed yet.

## Scenario Coverage

- `help` command is present as cli-only metadata: covered by metadata unit tests and CLI drift test.
- `help` includes real examples and help-command verification: covered by metadata unit test.
- `install/update/config` metadata exists without runtime drift: covered by staged metadata unit test and `help --json` inspection.
- `install/update/config` entries declare `InstallContract`: covered by staged metadata unit test.
- `writesInstructions` requires `includeInAgentSurface`: covered by validator failure test.
- Provider `all` is distinct from scope: covered by `InstallContract` type and staged metadata assertions using `configScope: user`.
- Surface policy validators reject inconsistent surfaces: covered by validator failure test.

## Residual Risk

- No blocking residual risk for this metadata contract feature.

## Verdict

- Status: passed
