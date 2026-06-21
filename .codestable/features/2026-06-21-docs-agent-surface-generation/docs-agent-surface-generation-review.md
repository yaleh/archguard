---
doc_type: feature-review
feature: 2026-06-21-docs-agent-surface-generation
status: passed
reviewed: 2026-06-21
round: 1
---

# docs-agent-surface-generation Code Review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-design.md`
- Checklist: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-checklist.yaml`
- Implementation evidence: current working tree diff plus passing targeted validation commands.
- Diff basis: registry docs renderer, docs check script, generated README/user-guide blocks, agent surface guide, package/CI wiring, drift/E2E tests, ADR updates, and stale runtime wording cleanup.
- Baseline dirty files: prior accepted roadmap feature files are still present in the same working tree; this review only judges docs surface generation and directly related metadata/test fixes.

### Independent Review

- Status: completed
- Detection: paseo-subagent
- Provider / agent: `claude/opus`, agent `6662583e-7c2e-4ffe-a070-64593ef93527`
- Raw output: returned in conversation and merged before this verdict.
- Gate effect: all important findings were fixed before this report was marked passed.

## 2. Diff Summary

- Added: `src/cli/metadata/docs-renderer.ts`, `scripts/check-metadata-docs.mjs`, `docs/user-guide/agent-surface.md`, `tests/integration/cli-mcp/metadata-surface-e2e.test.ts`.
- Modified: `README.md`, `docs/user-guide/cli-usage.md`, `docs/user-guide/mcp-usage.md`, `package.json`, `.github/workflows/ci.yml`, `docs/adr/006-mcp-tool-design-standards.md`, `docs/adr/007-cli-mcp-interface-parity.md`, and stale git-history guidance in `src/cli/commands/query.ts`.
- Related hardening: `tests/unit/cli/mcp/mcp-metadata-drift.test.ts` now preserves high-value MCP guidance after registry rendering.
- Risk hotspots: generated docs freshness, all-surface E2E breadth, and preserving agent guidance density while rendering from one registry.

## 3. Findings

### blocking

- none

### important

- [x] REV-001 Agent surface doc omitted the `analysis` category, so `archguard_analyze` appeared in workflows but not in the generated tool list.
  - Fix: `renderAgentSurface()` now renders an `## Analysis Tools` section from `toolsByCategory(registry, 'analysis')`.
  - Verification: `tests/integration/cli-mcp/metadata-surface-e2e.test.ts` asserts the agent surface contains every tool in `mcpToolBaseline`, including `archguard_analyze`.

- [x] REV-002 Registry-derived MCP descriptions dropped high-value agent hints from several pre-existing descriptions.
  - Fix: registry limitations now retain the key hints for `archguard_summary`, `archguard_get_dependencies`, `archguard_find_callers`, and `archguard_analyze`; `mcpToolDescription()` renders all limitations; the length guard was raised to allow useful but still bounded descriptions.
  - Verification: `tests/unit/cli/mcp/mcp-metadata-drift.test.ts` includes explicit assertions for these preserved hints.

- [x] REV-003 `docs:check` depended on `dist/` and could validate against a stale build locally.
  - Fix: `scripts/check-metadata-docs.mjs` now requires `dist/cli/metadata/docs-renderer.js` to exist and be newer than `src/cli/metadata`.
  - Verification: `npm run docs:check` passed after `npm run build`; script failure mode now prints `Run: npm run build`.

### nit

- [x] REV-004 Recovery Rules rendered `first; If` capitalization in generated text.
  - Fix: recovery rules now end the prerequisite sentence before appending the recovery sentence.

### suggestion

- Future hardening can derive generated docs block coverage from `metadataDocsBlocks` and add a small comment for the two README blocks sharing one file. Current script behavior is correct because it re-reads the target file per block.

### learning

- Docs generators that import built `dist/` need explicit freshness checks; otherwise stale build artifacts can make a registry/docs check look green while source metadata changed.

### praise

- The final E2E is a real cross-surface test: it runs built CLI structured help, in-process MCP `listTools`, docs freshness checking, parity mappings, workflow call-first categories, and stale-doc negative testing.

## 4. Test And QA Focus

- QA must run `npm run build` before `npm run docs:check` and built-CLI E2E.
- QA must verify docs check pass and negative stale-doc failure.
- QA must verify all 7 CLI commands, all 24 MCP tools, all parity mappings, and workflow-dependent call-first categories in the full metadata surface E2E.
- QA must verify no stale current `archguard analyze-git` guidance remains outside historical or negative-test contexts.
- QA must record baseline lint/format/full-suite failures separately from feature regressions.

## 5. Residual Risk

- `npm test` and `npm run test:coverage` are red in the current repository baseline for environment/pre-existing reasons unrelated to this feature: missing `gopls`, `CSSStyleSheet` in Mermaid tests, and missing local skill fixture data. The new metadata surface E2E passes when run directly and under the built-dist path.
- `npm run lint` and `npm run format:check` are red against the existing repository formatting/lint baseline. The feature-specific changed files are covered by typecheck/build and targeted tests.

## 6. Verdict

- Status: passed
- Next: `cs-feat-qa`
