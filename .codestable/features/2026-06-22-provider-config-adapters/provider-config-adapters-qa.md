---
doc_type: feature-qa
feature: 2026-06-22-provider-config-adapters
status: passed
reviewed: 2026-06-22
---

# provider-config-adapters QA

## Validation Commands

- `npm test -- tests/unit/cli/agent/provider-config-adapters.test.ts`
  - Result: passed
  - Evidence: 7 tests passed, covering Claude and Codex detection, write, remove, dry-run, backup, and instruction writes.
- `npm run type-check`
  - Result: passed
  - Evidence: `tsc --noEmit` exited 0.
- `npm run build`
  - Result: passed
  - Evidence: TypeScript build, alias rewrite, import fixing, and CLI chmod completed.
- `npx eslint src/cli/agent/**/*.ts tests/unit/cli/agent/provider-config-adapters.test.ts --ext .ts`
  - Result: passed
  - Evidence: targeted lint exited 0 for the new adapter implementation and test.
- `npm run lint`
  - Result: failed, non-blocking for this feature because the failure is the existing repository-wide lint baseline.
  - Evidence: command reported 4299 problems across existing files such as `src/analysis/fitness/*`, `src/cli/commands/analyze.ts`, and many legacy tests. The adapter-specific lint command above passes.

## Scenario Coverage

- Claude adapter can read/write/remove ArchGuard MCP server entry in temp HOME: covered by unit test.
- Codex adapter can read/write/remove ArchGuard MCP server entry in temp HOME: covered by unit test using `smol-toml` parse assertions.
- Detection returns documented user and project paths: covered by unit test for Claude and Codex.
- Existing unrelated config survives round-trip: covered by Claude `other` MCP server and Codex `model`/`other` server assertions.
- Dry-run does not mutate disk: covered by Codex dry-run file content assertion.
- Backup behavior is deterministic enough for callers: covered by backup path existence on existing config and no backup for newly created config.
- WriteOptions includes `scope`, `dryRun`, `force`, and `backup`: covered by type-check and test usage.
- Codex instructions serialize multi-line content without changing MCP entries: covered by unit test.

## Residual Risk

- Full repository lint remains red due unrelated existing lint debt. This feature did not normalize the repository lint baseline.

## Verdict

- Status: passed
