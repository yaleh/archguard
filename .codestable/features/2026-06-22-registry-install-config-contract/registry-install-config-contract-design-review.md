---
doc_type: feature-design-review
feature: 2026-06-22-registry-install-config-contract
status: passed
reviewed: 2026-06-22
round: 2
---

# registry-install-config-contract feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-design.md`
- Checklist: `.codestable/features/2026-06-22-registry-install-config-contract/registry-install-config-contract-checklist.yaml`
- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Related docs: `.codestable/attention.md`, `.codestable/architecture/ARCHITECTURE.md`, `docs/adr/006-mcp-tool-design-standards.md`, `docs/adr/007-cli-mcp-interface-parity.md`
- Code facts checked: `src/cli/metadata/types.ts`, `src/cli/metadata/registry.ts`, `src/cli/metadata/validators.ts`, `tests/unit/cli/cli-metadata-drift.test.ts`, `tests/unit/cli/help-command.test.ts`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `3f52902a-c8e0-4a3a-b8a7-fe7e4efbb280`
- Raw output: Paseo activity; findings merged into this round.
- Merge policy: blocking/important findings were resolved in design/checklist before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: extend metadata for lifecycle, surface policy, artifacts, install/config commands, and install contract.
- Key contracts: `SurfacePolicy`, `Lifecycle`, `ArtifactContract`, `InstallContract`, staged command metadata, validator rules.
- Steps: types, validators, immediate `help` baseline, staged install/update/config metadata, docs checks.

## 3. Findings

### blocking

- none

### important

- Resolved: reviewer flagged `DocsContract` duplicate ownership. Design now says `DocsContract` is owned by `registry-agent-guidance-contract` and only consumed here.
- Resolved: reviewer flagged baseline drift red windows. Design now enforces `help` immediately but stages `install`/`update`/`config` until runtime command shells exist.
- Resolved: reviewer flagged `agent` command ownership. Design now leaves `agent` metadata to `agent-instructions-renderer`.
- Resolved: reviewer flagged `configScope: both`; contract now only allows `user | project`, with provider `all` handled by per-provider reporting.
- Resolved: reviewer requested explicit `surfacePolicy` validators and `help` metadata quality; design/checklist now include both.

### residual-risk

- The staged metadata mechanism must be implemented so generated docs can include planned commands without making runtime CLI drift tests fail.

## 4. User Review Focus

- Confirm the staged metadata approach is acceptable: command facts can exist before command shells, but runtime baseline enforcement waits for registration.

## 5. Verdict

- Status: passed
- Next: user design confirmation.
