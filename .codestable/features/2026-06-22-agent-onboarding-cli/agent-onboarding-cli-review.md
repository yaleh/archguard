---
doc_type: feature-review
feature: 2026-06-22-agent-onboarding-cli
status: passed
reviewed: 2026-06-22
round: 1
---

# agent-onboarding-cli Review

## Scope

- Design: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-design.md`
- Checklist: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-checklist.yaml`
- Diff reviewed: `src/cli/commands/install.ts`, `src/cli/commands/update.ts`, `src/cli/commands/config.ts`, `src/cli/commands/onboarding-shared.ts`, `src/cli/index.ts`, `src/cli/metadata/registry.ts`, provider adapter show helpers, CLI unit/E2E tests, generated docs.

## Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- `config` subcommand options are duplicated on the parent command so current top-level registry drift checks can compare Commander options. If the registry later models nested subcommands, move these option contracts to subcommand metadata instead.

### residual-risk

- `config doctor` is intentionally absent in this feature. MCP handshake validation is deferred to the next roadmap item.

## Test And QA Focus

- Verify real built CLI dry-runs write nothing for Codex and Claude.
- Verify non-dry-run install writes only temp HOME provider config.
- Verify `config show --json` contains the stable schema fields.
- Verify `config remove` refuses mutation without `--force`.
- Verify generated docs include `install`, `update`, and `config`.

## Verdict

- Status: passed
