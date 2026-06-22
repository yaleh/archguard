---
doc_type: feature-qa
feature: 2026-06-22-agent-instructions-renderer
status: passed
reviewed: 2026-06-22
---

# agent-instructions-renderer QA

## Validation Commands

- `npm test -- tests/unit/cli/instruction-renderer.test.ts tests/unit/cli/metadata-registry.test.ts tests/unit/cli/cli-metadata-drift.test.ts tests/unit/cli/help-command.test.ts`
  - Result: passed
  - Evidence: 27 tests passed.
- `npm run build`
  - Result: passed
  - Evidence: TypeScript build and import fix completed.
- `node dist/cli/index.js agent instructions codex`
  - Result: passed
  - Evidence: output starts with `# ArchGuard Instructions for Codex`, includes `archguard_analyze`, freshness, and recovery guidance.
- `node dist/cli/index.js agent instructions claude`
  - Result: passed
  - Evidence: output starts with `# ArchGuard Instructions for Claude Code`, includes `archguard_analyze_git`, freshness, and recovery guidance.
- `npm run test:e2e`
  - Result: passed
  - Evidence: `tests/e2e/agent-instructions.e2e.test.ts` ran 2 tests for built CLI Codex and Claude output.
- `npm run docs:check`
  - Result: passed after `npm run docs:write`
  - Evidence: generated README, CLI guide, and agent-surface blocks are up to date.
- `npm run type-check`
  - Result: passed
  - Evidence: `tsc --noEmit` exited 0.
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts`
  - Result: passed
  - Evidence: 2 tests passed; structured help, MCP metadata, and docs blocks remain aligned.

## Scenario Coverage

- Codex instructions are generated from registry metadata: covered by unit and built CLI E2E.
- Claude instructions are generated from registry metadata: covered by unit and built CLI E2E.
- Output includes call-first guidance for analyze/test/git/Atlas workflows: covered by unit assertions and CLI output inspection.
- Output includes freshness and recovery guidance: covered by unit assertions and CLI output inspection.
- Command does not write config files: source review found no filesystem writes and no HOME write path in `src/cli/commands/agent.ts`.
- Command does not expose `--write`: source review and CLI command definition contain no `--write` option.
- `sourceMetadataHash` deterministic: covered by unit test.
- Agent command metadata exists before registration: covered by CLI metadata drift tests.

## Residual Risk

- No blocking residual risk for this feature.

## Verdict

- Status: passed
