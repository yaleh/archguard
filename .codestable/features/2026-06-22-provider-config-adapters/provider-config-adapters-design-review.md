---
doc_type: feature-design-review
feature: 2026-06-22-provider-config-adapters
status: passed
reviewed: 2026-06-22
round: 2
---

# provider-config-adapters feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-design.md`
- Checklist: `.codestable/features/2026-06-22-provider-config-adapters/provider-config-adapters-checklist.yaml`
- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Related docs: `.codestable/attention.md`, `README.md`, `docs/user-guide/mcp-usage.md`
- Code facts checked: `package.json`, `docs/user-guide/mcp-usage.md`, `src/cli/metadata/types.ts`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `3f52902a-c8e0-4a3a-b8a7-fe7e4efbb280`
- Raw output: Paseo activity; findings merged into this round.
- Merge policy: findings were fact-checked and design/checklist were updated before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: add safe Claude/Codex provider adapters for structured config show/write/remove/instructions operations.
- Key contracts: `AgentProviderAdapter`, `ProviderContext`, `WriteOptions`, default provider paths, `smol-toml` for Codex.
- Steps: shared types, Claude JSON adapter, Codex TOML adapter, dry-run/backup/remove tests.

## 3. Findings

### blocking

- none

### important

- Resolved: reviewer flagged adapter signature drift. Roadmap/design now use `ProviderContext` and pass it to write/remove/instruction methods.
- Resolved: reviewer flagged hidden dependency on renderer. Items/design now explicitly depend on `agent-instructions-renderer`.
- Resolved: reviewer flagged TOML dependency uncertainty. Design now chooses `smol-toml`.
- Resolved: reviewer flagged missing default paths. Design now records Codex user/project and Claude user/project config paths from current docs.
- Resolved: reviewer flagged incomplete `WriteOptions`. Design now lists `scope`, `dryRun`, `force`, and `backup`.
- Resolved: reviewer requested broader validation; design adds lint to required commands.

### residual-risk

- Provider path conventions can drift in future Claude/Codex releases; doctor will surface detection/recovery rather than silently assuming success.

## 4. User Review Focus

- Confirm `smol-toml` is acceptable as a new runtime dependency for preserving Codex TOML safely.

## 5. Verdict

- Status: passed
- Next: user design confirmation.
