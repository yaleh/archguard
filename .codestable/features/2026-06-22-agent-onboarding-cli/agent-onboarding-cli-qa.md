---
doc_type: feature-qa
feature: 2026-06-22-agent-onboarding-cli
status: passed
reviewed: 2026-06-22
---

# agent-onboarding-cli QA

## Validation Commands

- `npm test -- tests/unit/cli/onboarding-cli.test.ts tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/help-command.test.ts`
  - Result: passed
  - Evidence: 32 tests passed, including temp HOME onboarding flows and metadata drift.
- `npm run type-check`
  - Result: passed
  - Evidence: `tsc --noEmit` exited 0.
- `npx eslint src/cli/commands/install.ts src/cli/commands/update.ts src/cli/commands/config.ts src/cli/commands/onboarding-shared.ts src/cli/agent/**/*.ts tests/unit/cli/onboarding-cli.test.ts tests/e2e/agent-onboarding-cli.e2e.test.ts --ext .ts`
  - Result: passed
  - Evidence: targeted lint for new onboarding files exited 0.
- `npm run build`
  - Result: passed
  - Evidence: TypeScript build, alias rewrite, import fixing, and CLI chmod completed.
- `node dist/cli/index.js install codex --home <tmp-home> --dry-run`
  - Result: passed
  - Evidence: command exited 0 and `<tmp-home>/.codex/config.toml` did not exist afterward.
- `node dist/cli/index.js install claude --home <tmp-home> --dry-run`
  - Result: passed
  - Evidence: command exited 0 and `<tmp-home>/.claude/mcp.json` did not exist afterward.
- `node dist/cli/index.js config show codex --home <tmp-home> --json`
  - Result: passed
  - Evidence: after real install, JSON included provider `codex`, exists `true`, command `archguard`, args `["mcp"]`, and a metadata hash.
- `node dist/cli/index.js config remove codex --home <tmp-home> --dry-run`
  - Result: passed
  - Evidence: command exited 0 without removing the Codex ArchGuard entry.
- `npm run test:e2e`
  - Result: passed
  - Evidence: 2 E2E files ran; built CLI onboarding E2E covered Codex and Claude against temp HOME.
- `npm run docs:write && npm run docs:check`
  - Result: passed
  - Evidence: generated docs were updated and then reported fresh.

## Scenario Coverage

- Codex dry-run writes nothing: covered by built CLI command and E2E.
- Claude dry-run writes nothing: covered by built CLI command and E2E.
- Non-dry-run install writes temp HOME config for both providers: covered by unit and E2E.
- `config show --json` stable schema: covered by unit and built CLI command.
- `install --mcp-only` and `--instructions-only`: covered by unit tests.
- `update --instructions-only` skips MCP rewrite and writes instructions: covered by unit test.
- `config remove` force gate: covered by unit test.
- Runtime registry/docs include new commands: covered by metadata drift and docs check.

## Residual Risk

- Full repository `npm run lint` remains red from the existing lint baseline recorded in the previous feature. New onboarding files pass targeted lint.

## Verdict

- Status: passed
