---
doc_type: feature-qa
feature: 2026-06-21-docs-agent-surface-generation
status: passed
tested: 2026-06-21
round: 1
---

# docs-agent-surface-generation QA Report

## 1. Scope And Inputs

- Design: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-design.md`
- Checklist: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-checklist.yaml`
- Review: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-review.md`
- Diff basis: current working tree after independent review fixes.
- Feature type: mixed
- Core evidence gate: built CLI `help --json`, in-process MCP `listTools`, generated docs stale-check, and negative stale-doc fixture.

## 2. Verification Matrix

| ID | Source | Core | Scenario / Risk | Evidence | Command Or Action | Expected | Result |
|---|---|---|---|---|---|---|---|
| QA-001 | design required command | core | TypeScript compiles after docs renderer/check script wiring | typecheck | `npm run type-check` | exit 0 | pass |
| QA-002 | design required command | core | Built CLI and dist docs renderer exist for docs/E2E checks | build | `npm run build` | exit 0 | pass |
| QA-003 | acceptance contract | core | Checked-in generated docs blocks match registry output | docs | `npm run docs:check` | exit 0 | pass |
| QA-004 | review focus | core | CLI help and MCP metadata drift guards preserve registry projections | unit | `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/mcp/mcp-metadata-drift.test.ts` | exit 0 | pass |
| QA-005 | acceptance contract | core | Full metadata surface E2E covers CLI JSON, MCP listTools, docs check, all baselines, parity mappings, and callFirst workflows | e2e | `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts` | exit 0 | pass |
| QA-006 | roadmap core path | core | Combined CLI/MCP/docs E2E suite remains green together | e2e | `npm test -- tests/integration/e2e/cli-structured-help.e2e.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts tests/integration/cli-mcp/metadata-surface-e2e.test.ts` | exit 0 | pass |
| QA-007 | acceptance contract | core | Docs stale-check fails on intentional mismatch | e2e negative path | covered by `metadata-surface-e2e.test.ts` | stale temp README exits 1 | pass |
| QA-008 | scope guard | core | Current docs/runtime guidance does not use stale `archguard analyze-git` wording | grep | `rg -n "archguard analyze-git|analyze-git|archguard_get_git_history" README.md docs/user-guide docs/adr src tests scripts .github package.json || true` | no current stale guidance | pass |
| QA-009 | goal aggregate | supporting | Full test and coverage baseline status is understood | aggregate | `npm test`; `npm run test:coverage` | no feature-specific metadata failures | pass with baseline red |
| QA-010 | goal aggregate | supporting | Lint/format baseline status is understood | aggregate | `npm run lint`; `npm run format:check` | no hidden feature gate | pass with baseline red |

## 3. Command Results

- `npm run type-check` -> exit 0.
- `npm run build` -> exit 0.
- `npm run docs:write` -> exit 0 and regenerated deterministic blocks.
- `npm run docs:check` -> exit 0.
- `npm test -- tests/unit/cli/mcp/mcp-metadata-drift.test.ts` -> exit 0, 9 tests passed.
- `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/mcp/mcp-metadata-drift.test.ts` -> exit 0, 14 tests passed.
- `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts` -> exit 0, 4 tests passed.
- `npm test -- tests/integration/e2e/cli-structured-help.e2e.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts tests/integration/cli-mcp/metadata-surface-e2e.test.ts` -> exit 0, 9 tests passed.
- `node dist/cli/index.js help --json` -> exit 0 and exposes program `archguard` with 7 commands.
- Stale wording grep -> only `tests/unit/cli/mcp/git-history-mcp.test.ts` asserts nonexistent `archguard_get_git_history` is absent; no current guidance uses stale wording.

## 4. Baseline Red Commands

- `npm run format:check` -> red on many pre-existing files across `src/` and `tests/`.
- `npm run lint` -> red with thousands of pre-existing ESLint/prettier/no-console issues.
- `npm test` -> red in baseline categories unrelated to metadata surface:
  - `tests/plugins/golang/interface-matcher.test.ts`: missing `gopls` binary.
  - Mermaid renderer/background-color tests: `CSSStyleSheet is not defined`.
  - `tests/unit/skills/project-semantics-discovery-skill.test.ts`: missing local `.agents/skills/project-semantics-discovery/references/archguard-project-semantics.json`.
- `npm run test:coverage` -> same baseline failure categories as `npm test`; metadata surface E2E passes inside the run before the unrelated failures.

## 5. Scenario Results

- [x] README and user-guide generated blocks are marker-bounded and stale-checked from registry output.
- [x] Agent surface includes Claude Code and Codex setup snippets plus shared ArchGuard workflows.
- [x] Agent surface now lists all 24 MCP tools, including `archguard_analyze`.
- [x] Docs check fails on a temp-root stale block in the E2E negative path.
- [x] Full E2E covers all 7 CLI commands, all 24 MCP tools, all query mappings, `archguard_analyze`, `archguard_analyze_git`, and workflow-dependent `Call first` guidance.
- [x] CI has an explicit `Metadata docs check` step after build and before coverage.
- [x] ADR-006 and ADR-007 document registry-owned descriptions and current `archguard analyze --include-git` parity.

## 6. Findings

### failed

- none

### blocked

- none

### residual-risk

- Full-suite, coverage, lint, and format commands remain baseline red for repository-wide or environment reasons. This is recorded for the final roadmap audit and is not a hidden gap in the docs metadata surface E2E.

## 7. Cleanliness

- Debug output: pass
- Temporary TODO/FIXME/XXX: pass
- Commented-out code: pass
- Unused imports / dead code from this feature: pass
- Out-of-scope files: pass with note that `scripts/fix-imports.sh` and `analyze-equivalence.test.ts` are benign build/test hardening discovered during this roadmap and will be surfaced in the final audit.
- Fake command shims or fake runners: pass

## 8. Verdict

- Status: passed
- Next: `cs-feat-accept`
