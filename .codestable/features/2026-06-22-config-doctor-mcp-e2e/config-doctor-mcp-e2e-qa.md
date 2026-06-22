---
doc_type: feature-qa
feature: 2026-06-22-config-doctor-mcp-e2e
status: passed
reviewed: 2026-06-22
---

# config-doctor-mcp-e2e QA

## Validation Commands

- `npm test -- tests/unit/cli/config-doctor.test.ts tests/unit/cli/onboarding-cli.test.ts tests/unit/cli/cli-metadata-drift.test.ts`
  - Result: passed
  - Evidence: 15 tests passed, including doctor pass/fail/skipped behavior and broken fixtures.
- `npm run type-check`
  - Result: passed
  - Evidence: `tsc --noEmit` exited 0.
- `npx eslint src/cli/agent/doctor.ts src/cli/agent/mcp-probe.ts src/cli/commands/config.ts tests/unit/cli/config-doctor.test.ts tests/e2e/config-doctor.e2e.test.ts --ext .ts`
  - Result: passed
  - Evidence: targeted lint for doctor/probe files exited 0.
- `npm run build`
  - Result: passed
  - Evidence: TypeScript build, alias rewrite, import fixing, and CLI chmod completed.
- `node dist/cli/index.js install codex --home <tmp-home>`
  - Result: passed
  - Evidence: command exited 0 and wrote only temp HOME Codex config.
- `node dist/cli/index.js config doctor codex --home <tmp-home> --json`
  - Result: passed
  - Evidence: result `ok: true`, `codex.config.archguard-entry: pass`, `mcp.stdio.list-tools: pass`, independent MCP process listed 24 tools, teardown took 17ms.
- `node dist/cli/index.js install claude --home <tmp-home>`
  - Result: passed
  - Evidence: command exited 0 and wrote only temp HOME Claude config.
- `node dist/cli/index.js config doctor claude --home <tmp-home> --json`
  - Result: passed
  - Evidence: result `ok: true`, `claude.config.archguard-entry: pass`, `mcp.stdio.list-tools: pass`, independent MCP process listed 24 tools, teardown took 18ms.
- `npm run test:e2e`
  - Result: passed
  - Evidence: 3 E2E files ran, 4 tests passed, including `config-doctor.e2e.test.ts`.
- `npm run docs:check`
  - Result: passed
  - Evidence: metadata docs are up to date.

## Scenario Coverage

- Doctor fails with recovery before provider config exists: covered by unit and E2E.
- Doctor succeeds after install for Codex and Claude: covered by built CLI commands and E2E.
- Stdio MCP probe lists ArchGuard MCP tools: covered by built CLI doctor and E2E.
- Broken config fixtures fail: covered by unit tests for TOML other-only, JSON `{}`, and missing executable command.
- Doctor without provider omits top-level provider and returns multi-provider checks: covered by unit test.
- E2E writes only temp HOME: tests use `fs.mkdtemp` home and cleanup.
- ADR verification rule recorded: ADR-007 updated.

## Residual Risk

- Full repository `npm run lint` remains red from existing lint baseline; new doctor/probe files pass targeted lint.

## Verdict

- Status: passed
