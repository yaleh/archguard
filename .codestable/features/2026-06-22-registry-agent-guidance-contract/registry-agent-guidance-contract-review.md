---
doc_type: feature-review
feature: 2026-06-22-registry-agent-guidance-contract
status: passed
reviewed: 2026-06-22
round: 1
---

# registry-agent-guidance-contract Review

## Scope

- Design: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-design.md`
- Checklist: `.codestable/features/2026-06-22-registry-agent-guidance-contract/registry-agent-guidance-contract-checklist.yaml`
- Diff reviewed: `src/cli/metadata/types.ts`, `src/cli/metadata/registry.ts`, `src/cli/metadata/validators.ts`, `tests/unit/cli/metadata-registry.test.ts`

## Findings

### blocking

- none

### important

- none

### nit

- none

### suggestion

- Later instruction-renderer work should consume `agent.freshness` directly rather than deriving stale-data wording a second time.

### residual-risk

- The `DocsContract` is now present and validated, but renderers do not yet filter on it. That is acceptable for this feature because renderer behavior is owned by later roadmap items.

## Test And QA Focus

- Confirm validator fails when a workflow-dependent MCP tool lacks `freshness`.
- Confirm validator fails when an agent-facing entry lacks docs include policy.
- Confirm metadata imports remain free of Commander and MCP SDK imports.
- Confirm existing docs and metadata E2E behavior remains green.

## Verdict

- Status: passed
