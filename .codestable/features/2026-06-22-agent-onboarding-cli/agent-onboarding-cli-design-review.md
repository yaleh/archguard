---
doc_type: feature-design-review
feature: 2026-06-22-agent-onboarding-cli
status: passed
reviewed: 2026-06-22
round: 2
---

# agent-onboarding-cli feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-design.md`
- Checklist: `.codestable/features/2026-06-22-agent-onboarding-cli/agent-onboarding-cli-checklist.yaml`
- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Related docs: `.codestable/attention.md`, `README.md`, `docs/user-guide/mcp-usage.md`
- Code facts checked: `src/cli/index.ts`, `src/cli/commands`, `src/cli/metadata/registry.ts`, `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `3f52902a-c8e0-4a3a-b8a7-fe7e4efbb280`
- Raw output: Paseo activity; findings merged into this round.
- Merge policy: findings were fact-checked and design/checklist were updated before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: expose safe user-facing install/update/config show/remove commands that reuse adapters, renderer, and registry metadata.
- Key contracts: provider/scope/home parsing, `ConfigShowResult`, write-mode flags, dry-run, force-protected remove.
- Steps: command shells, agent command extension, adapter orchestration, docs/metadata refresh.

## 3. Findings

### blocking

- none

### important

- Resolved: reviewer flagged missing dependency on install/config metadata. Items now explicitly depend on `registry-install-config-contract`.
- Resolved: reviewer flagged undefined `update --instructions-only`; design now defines it as instructions-only refresh that skips MCP config writes.
- Resolved: reviewer flagged missing `config show --json` schema. Design now defines `ConfigShowResult`.
- Resolved: reviewer flagged remove safety. Design now requires `--force` for non-dry-run removal.
- Resolved: reviewer flagged install write-mode ambiguity. Design now adds `--mcp-only` and `--instructions-only`.
- Resolved: reviewer flagged command ownership overlap. Design now states `agent.ts` comes from the renderer feature and may only be extended for write support here.

### residual-risk

- Command output wording must remain agent-parseable in JSON mode while still useful for humans in text mode.

## 4. User Review Focus

- Confirm default `install` writes both MCP config and generated instructions, with explicit flags to narrow the write.

## 5. Verdict

- Status: passed
- Next: user design confirmation.
