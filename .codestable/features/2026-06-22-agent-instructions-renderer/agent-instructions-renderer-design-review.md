---
doc_type: feature-design-review
feature: 2026-06-22-agent-instructions-renderer
status: passed
reviewed: 2026-06-22
round: 2
---

# agent-instructions-renderer feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-design.md`
- Checklist: `.codestable/features/2026-06-22-agent-instructions-renderer/agent-instructions-renderer-checklist.yaml`
- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Related docs: `.codestable/attention.md`, `.codestable/architecture/ARCHITECTURE.md`, `docs/adr/007-cli-mcp-interface-parity.md`
- Code facts checked: `src/cli/metadata/registry.ts`, `src/cli/metadata/docs-renderer.ts`, `src/cli/index.ts`, `package.json`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `3f52902a-c8e0-4a3a-b8a7-fe7e4efbb280`
- Raw output: Paseo activity; findings merged into this round.
- Merge policy: findings were fact-checked and design/checklist were updated before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: render Claude/Codex agent instructions from registry metadata and expose a read-only CLI command.
- Key contracts: `InstructionRenderInput`, `InstructionRenderResult`, deterministic `sourceMetadataHash`, `agent` command metadata/baseline, docs renderer reuse.
- Steps: pure renderer, command metadata, CLI command, docs connection, real E2E coverage.

## 3. Findings

### blocking

- none

### important

- Resolved: reviewer flagged undefined `includeInstallBlock`; it was removed from the renderer contract.
- Resolved: reviewer flagged `--write` ambiguity; design now explicitly excludes `--write` from this feature.
- Resolved: reviewer flagged E2E directory ownership; design/checklist now require `tests/e2e/` creation if needed and a non-empty `npm run test:e2e`.
- Resolved: reviewer requested deterministic hash semantics; design now specifies SHA-256 over canonical metadata JSON excluding `generatedAt`.
- Resolved: reviewer asked whether docs renderer reuses the instruction renderer; design now says it must.

### residual-risk

- The canonical JSON helper must be shared or deterministic enough that docs and CLI hash checks do not diverge.

## 4. User Review Focus

- Confirm the first user-visible loop is intentionally read-only: `archguard agent instructions codex|claude`.

## 5. Verdict

- Status: passed
- Next: user design confirmation.
