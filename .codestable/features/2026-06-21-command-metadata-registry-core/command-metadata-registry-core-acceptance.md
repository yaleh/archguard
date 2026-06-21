---
doc_type: feature-acceptance
feature: 2026-06-21-command-metadata-registry-core
status: passed
accepted: 2026-06-21
round: 1
---

# command-metadata-registry-core Acceptance Report

> Phase: 3, acceptance closure
> Related design: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-design.md`

## 1. Interface Contract Check

- [x] Metadata registry types exist in `src/cli/metadata/types.ts`.
  - Evidence: `npm run type-check` passes and registry tests import `@/cli/metadata`.
- [x] Registry source exists in `src/cli/metadata/registry.ts`.
  - Evidence: exports include CLI command baseline, MCP tool baseline, query options, mappings, workflow-dependent tools, and registry object.
- [x] Validators exist in `src/cli/metadata/validators.ts`.
  - Evidence: tests verify valid registry, missing baseline failure, and unknown `callFirst` failure.
- [x] Side-effect boundary is preserved.
  - Evidence: metadata sources import only local metadata modules; static test scans for Commander and MCP SDK imports.

## 2. Behavior And Decision Check

- [x] Requirement summary satisfied: repository can assert every current CLI command and MCP tool has metadata with agent guidance and verification hints.
  - Evidence: `tests/unit/cli/metadata-registry.test.ts` checks exact 7 CLI commands and exact 24 MCP tools.
- [x] Explicit non-goals respected: no Commander registration, MCP registration, README/user-guide, command handler, schema, QueryEngine, or analysis output changes were made.
  - Evidence: runtime changes are limited to new `src/cli/metadata/` module; existing CLI/MCP tests pass.
- [x] `archguard_analyze_git` maps to current CLI fact `archguard analyze --include-git`.
  - Evidence: registry mapping and unit assertion.
- [x] Workflow-dependent tools have callFirst matrix entries.
  - Evidence: test covers query-artifact, test-analysis, git-history, and Atlas representative assertions and all entries in `workflowDependentMcpTools`.
- [x] Mount points match design.
  - Evidence: `src/cli/metadata/index.ts`, `types.ts`, `registry.ts`, `validators.ts`, and `tests/unit/cli/metadata-registry.test.ts` exist.

## 3. Acceptance Scenario Check

- [x] Registry covers 7 CLI commands.
  - Evidence: `npm test -- tests/unit/cli/metadata-registry.test.ts` passes.
- [x] Registry covers 24 MCP tools.
  - Evidence: same registry test passes.
- [x] Registry includes query/MCP parity map plus analyze equivalents.
  - Evidence: same registry test asserts mapping count 24 and the analyze mappings.
- [x] Every entry has required agent guidance and verification hints.
  - Evidence: same registry test iterates all CLI/MCP entries.
- [x] Validator negative tests exist.
  - Evidence: same registry test verifies missing `archguard_summary` and unknown `archguard_missing` failures.
- [x] Runtime behavior remains unchanged.
  - Evidence: `npm test -- tests/unit/cli/command.test.ts tests/unit/cli/mcp/mcp-server.test.ts` passes.
- [x] Review focus covered.
  - Evidence: review passed; QA passed with command matrix and cleanliness checks.

## 4. Terminology Consistency

- Metadata registry, surface baseline, drift test, and callFirst matrix terms align with the approved design.
- New code uses `AgentGuidance`, `CliCommandMetadata`, `McpToolMetadata`, `QueryMappingMetadata`, and `VerificationHint` consistent with design concepts.
- No conflicting terminology was introduced.

## 5. Architecture Merge

- [x] `.codestable/architecture/ARCHITECTURE.md` updated to record `src/cli/metadata/` as the typed command/tool metadata registry.
- [x] Architecture notes state that runtime CLI/MCP registration remains in existing command/server modules until later adapter features migrate them.

## 6. Requirement Backwrite

- No requirement document is linked by this roadmap or feature design.
- This is an internal architecture/refactor foundation rather than a new standalone user capability, so no requirement backfill is required for this feature.

## 7. Roadmap Backwrite

- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml` updated: `command-metadata-registry-core` is `done`.
- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md` updated with execution status.
- [x] YAML validation passed for items and checklist.

## 8. attention.md Candidate Review

- No new recurring environment or workflow note needs to be added to `.codestable/attention.md`.
- PyYAML is not installed, so the local validator reported fallback-parser warnings. This is non-blocking and already known from the generated tool behavior; it is not specific enough to this feature to add as a project attention note.

## 9. Residuals

- Later features must migrate/verify CLI, MCP, and docs consumers from the registry and run their own E2E checks.
- Stale `archguard analyze-git` wording remains outside this feature's scope and is explicitly assigned to the docs/agent-surface feature.
- No implementation-stage side discoveries require a new issue.

## 10. Final Audit

- Verification evidence source: `.codestable/features/2026-06-21-command-metadata-registry-core/command-metadata-registry-core-qa.md`
- Aggregate commands:
  - `npm run type-check` -> exit 0
  - `npm test -- tests/unit/cli/metadata-registry.test.ts` -> exit 0, 10 tests passed
  - `npm test -- tests/unit/cli/command.test.ts tests/unit/cli/mcp/mcp-server.test.ts` -> exit 0, 76 tests passed
  - `.codestable/tools/validate-yaml.py --file ... --yaml-only` for items/checklist -> exit 0
- Scenario review: re-verified 7 / trust-prior-verify 0
- Deliverable review: code, tests, architecture, checklist, QA, review, roadmap items, and roadmap status are present.
- Full worktree review: untracked files are this roadmap/feature package plus new metadata/test files.
- Diff cleanliness: pass; no feature debug output, temporary TODO/FIXME/XXX, or out-of-scope runtime source changes.
- Knowledge outlet: no attention/learning/decision/guide/libdoc candidate for this feature beyond later roadmap docs work.
- Conclusion: passed.
