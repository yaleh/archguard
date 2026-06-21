---
doc_type: roadmap-goal-audit
roadmap: command-metadata-registry
status: passed
audited: 2026-06-21
round: 1
---

# command-metadata-registry Goal 最终审计

## 1. Scope

- Roadmap: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`
- Items: `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml`
- Goal plan: `.codestable/roadmap/command-metadata-registry/goal-plan.md`
- Features: 4
- Feature type summary: functional 1 / non-functional 0 / mixed 3

## 2. Roadmap State

- Items done/dropped/pending: 4 done / 0 dropped / 0 pending
- Goal-state current_feature_index: 4
- Goal-state status before audit close: ready-to-dispatch
- Feature statuses: 4 accepted / 0 pending / 0 blocked
- Feature reports: all 4 features have passed review, passed QA, and passed acceptance reports.

## 3. Final Aggregate Commands

| 命令 | 类型 | 核心性 | 退出码 | 结果 | 说明 |
|---|---|---|---|---|---|
| `npm run type-check` | typecheck | core | 0 | pass | TypeScript compiles with metadata registry, CLI/MCP adapters, docs renderer, and tests. |
| `npm run build` | build | core | 0 | pass | Built CLI and `dist/cli/metadata/docs-renderer.js` generated successfully. |
| `npm run docs:check` | docs | core | 0 | pass | Registry-backed README/user-guide/agent-surface blocks are up to date. |
| `node dist/cli/index.js help --json` | smoke | core | 0 | pass | Built CLI structured help returns program `archguard` and 7 commands. |
| `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/mcp/mcp-metadata-drift.test.ts` | unit | core | 0 | pass | 14 tests passed; CLI help and MCP metadata drift guards are green. |
| `npm test -- tests/integration/e2e/cli-structured-help.e2e.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts tests/integration/cli-mcp/metadata-surface-e2e.test.ts` | e2e | core | 0 | pass | 9 tests passed; built CLI help, in-process MCP metadata, docs check, parity mappings, call-first workflows, and stale-doc negative fixture are covered. |
| `npm run format:check` | format | supporting | 1 | baseline red | 90 pre-existing files fail Prettier check. This is repo-wide baseline debt, not metadata surface behavior. |
| `npm run lint` | lint | supporting | 1 | baseline red | 4452 problems reported, mostly existing Prettier, strict TypeScript, and console rules across the repo. |
| `npm test` | full suite | supporting | 1 | baseline red | 5 failed files / 227 passed / 2 skipped; 42 failed / 3959 passed / 8 skipped / 2 todo. Metadata E2E passed inside the run. |
| `npm run test:coverage` | coverage | supporting | 1 | baseline red | Same 5 failed files and 42 failed tests as `npm test`; metadata E2E passed inside the run. |

## 4. Core Acceptance Paths

| ID | 路径 | Feature / Roadmap 来源 | 证据 | 结果 |
|---|---|---|---|---|
| CORE-001 | Registry inventories current surface | command-metadata-registry-core | `tests/unit/cli/metadata-registry.test.ts` and accepted feature 1 reports | pass |
| CORE-002 | CLI structured help consumes registry | cli-help-from-registry | `npm test -- tests/integration/e2e/cli-structured-help.e2e.test.ts`; `node dist/cli/index.js help --json` | pass |
| CORE-003 | MCP listTools exposes registry-derived descriptions | mcp-agent-descriptions-from-registry | `npm test -- tests/unit/cli/mcp/mcp-metadata-drift.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts` | pass |
| CORE-004 | README/user-guide/agent-surface docs are registry-backed and stale-checked | docs-agent-surface-generation | `npm run docs:check`; generated blocks in README and user guides | pass |
| CORE-005 | Full cross-surface E2E covers all commands/tools/mappings/workflows | roadmap goal plan | `npm test -- tests/integration/cli-mcp/metadata-surface-e2e.test.ts` inside the combined E2E command | pass |
| CORE-006 | Stale-doc negative path fails | docs-agent-surface-generation | `metadata-surface-e2e.test.ts` temp `ARCHGUARD_DOCS_ROOT` fixture exits 1 on stale README block | pass |

## 5. Deliverables And Writebacks

- Deliverables: present
  - `src/cli/metadata/*` typed registry, validators, CLI adapter, docs renderer.
  - `src/cli/commands/help.ts` structured help surface.
  - `src/cli/mcp/metadata.ts` registry-derived MCP description helper.
  - `scripts/check-metadata-docs.mjs` docs check/write script with dist freshness guard.
  - Generated docs blocks in `README.md`, `docs/user-guide/cli-usage.md`, `docs/user-guide/mcp-usage.md`, and `docs/user-guide/agent-surface.md`.
  - Drift and E2E tests for CLI, MCP, and docs surfaces.
  - CI `Metadata docs check` step and package scripts `docs:check` / `docs:write`.
- Architecture writeback: pass, `.codestable/architecture/ARCHITECTURE.md` records CLI/MCP/docs/agent-surface registry consumers.
- Requirement writeback: not applicable, no standalone requirement document existed for this roadmap.
- Roadmap writeback: pass, items.yaml and roadmap execution status mark all 4 features done.

## 6. QA Residual Risk Review

| Feature | Residual risks | Core gap hidden? | Trust-prior items | Action |
|---|---|---|---|---|
| command-metadata-registry-core | none affecting core path | no | prior accepted report commands | pass |
| cli-help-from-registry | none affecting core path | no | prior accepted human help compatibility evidence, rechecked by E2E | pass |
| mcp-agent-descriptions-from-registry | parameter descriptions still mirrored inline and registry-side, guarded by drift tests | no | representative MCP behavior tests from prior accepted QA | pass |
| docs-agent-surface-generation | repo-wide lint/format/full-suite baseline red | no | none for core metadata E2E; core path re-verified | pass |

- Core gaps hidden in residual-risk: none.
- Non-core residual risks:
  - `npm run lint` and `npm run format:check` remain repository-wide baseline red.
  - `npm test` and `npm run test:coverage` remain baseline red in unrelated Mermaid/gopls/skill-fixture categories.
- Trust-prior items: prior feature-specific behavior-preservation suites for feature 1-3; final audit re-ran the roadmap-level core CLI/MCP/docs E2E.

## 7. Workspace And Cleanliness

- git status summary: roadmap implementation files are modified/untracked and intentional; no unrelated revert was performed.
- untracked/staged/unstaged review: all untracked files are CodeStable reports or new metadata/help/docs/tests/scripts for this roadmap.
- debug/TODO/shim/temp files:
  - No fake command runner, same-name validation shim, or temp bypass file was added.
  - `scripts/check-metadata-docs.mjs` contains `console.log` for normal CLI command output.
  - Existing compatibility shim references in `src/cli/query/*` and docs/proposals are pre-existing architecture artifacts, not validation bypasses.
- Current stale guidance scan: no current README/user-guide/ADR/src/script/package guidance uses `archguard analyze-git`; the only `archguard_get_git_history` current hit is a negative MCP test asserting the nonexistent tool is absent.

## 8. Verdict

- Status: passed
- Coverage: 6 re-verified core paths / 2 trust-prior supporting paths
- Blocking gaps: none
- Baseline red disclosed: lint, format, full test, and coverage are red outside the metadata registry core path.
- Completion condition: all roadmap features accepted; final core CLI/MCP/docs E2E is real and passing.

## 9. Learning Reflection

### Pitfall candidates

- Dist-backed docs checks must verify build freshness; otherwise registry/doc checks can silently validate stale built output.
- Full-suite red should be separated from feature core path evidence when the repository baseline has unrelated environment failures.

### Knowledge candidates

- A command/tool metadata registry becomes credible only when each consumer has a drift check or generated projection: CLI help, MCP metadata, docs blocks, and agent surface docs all need independent guards.
- Agent-oriented tool descriptions need explicit `callFirst`, recovery, and limitations preservation tests; concise rendering alone can accidentally drop important usage warnings.

### Not worth archiving

- Exact temporary failure paths under `/var/folders` and `/tmp`.
- One-off CodeStable execution state for this roadmap.

Recommended next step: run `cs-docs-neat` after user confirmation to reconcile docs/memory.
