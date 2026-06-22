---
doc_type: feature-review
feature: 2026-06-22-agent-instructions-renderer
status: passed
reviewed: 2026-06-22
round: 1
---

# agent-instructions-renderer Review

## Scope

- Design: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-design.md`
- Checklist: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-checklist.yaml`
- Diff reviewed: `src/cli/metadata/instruction-renderer.ts`, `src/cli/commands/agent.ts`, `src/cli/index.ts`, `src/cli/metadata/*`, `tests/unit/cli/instruction-renderer.test.ts`, `tests/e2e/agent-instructions.e2e.test.ts`, generated docs blocks.

## Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- Later registry convergence work can model nested CLI subcommands/options so `agent instructions --format` appears in structured help. The current registry baseline remains top-level command oriented, so this is intentionally out of scope.

### residual-risk

- The generated agent-surface block currently uses the Codex profile as the shared rendered profile. This satisfies the single renderer reuse requirement; later provider-specific docs can add separate generated blocks if needed.

## Test And QA Focus

- Verify built CLI output for both `codex` and `claude`.
- Verify `npm run test:e2e` runs a real E2E file and not an empty directory.
- Verify no `--write` option or filesystem writes exist in the agent command.
- Verify docs renderer calls the instruction renderer.

## Verdict

- Status: passed
