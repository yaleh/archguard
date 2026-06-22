---
doc_type: feature-design-review
feature: 2026-06-22-registry-agent-guidance-contract
status: passed
reviewed: 2026-06-22
round: 2
---

# registry-agent-guidance-contract feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-design.md`
- Checklist: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-checklist.yaml`
- Roadmap: `.codestable/roadmap/agent-onboarding-registry-convergence/agent-onboarding-registry-convergence-roadmap.md`
- Related docs: `.codestable/attention.md`, `.codestable/architecture/ARCHITECTURE.md`, `docs/adr/006-mcp-tool-design-standards.md`, `docs/adr/007-cli-mcp-interface-parity.md`
- Code facts checked: `src/cli/metadata/types.ts`, `src/cli/metadata/registry.ts`, `src/cli/metadata/validators.ts`, `tests/unit/cli/metadata-registry.test.ts`, `tests/unit/cli/mcp/mcp-metadata-drift.test.ts`

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent id `3f52902a-c8e0-4a3a-b8a7-fe7e4efbb280`
- Raw output: Paseo activity; findings merged into this round.
- Merge policy: blocking/important findings were fact-checked against local files and resolved in design/checklist before this verdict.
- Gate effect: none.

## 2. Design Summary

- Goal: extend the metadata registry with the minimum guidance fields needed by generated agent instructions.
- Key contracts: `avoidWhen`, `freshness`, `DocsContract`, validator coverage, and side-effect-free metadata imports.
- Steps: type extension, validator rules, registry backfill, side-effect regression, surface regression.
- Baseline / validation: type-check, metadata unit tests, metadata surface E2E, docs check.

## 3. Findings

### blocking

- none

### important

- Resolved: reviewer noted the freshness backfill mixed categories and existing registry constants. Design now names `workflowDependentMcpTools` as the source of truth and limits category wording to current `MetadataCategory` values.
- Resolved: reviewer noted conditional `mcp-metadata-drift.test.ts` scope was ambiguous. Design now says it is not modified by default and only changes if MCP description rendering is affected.
- Resolved: reviewer requested import side-effect coverage. Checklist now includes a specific side-effect regression step.

### residual-risk

- The exact import-side-effect assertion style is left to implementation, but it must prove metadata modules do not import Commander or MCP SDK.

## 4. User Review Focus

- Confirm that this first contract feature intentionally stays limited to instruction-rendering fields and does not absorb install/config metadata.

## 5. Verdict

- Status: passed
- Next: user design confirmation.
