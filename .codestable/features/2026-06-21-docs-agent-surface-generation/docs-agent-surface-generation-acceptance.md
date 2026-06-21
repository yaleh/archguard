---
doc_type: feature-acceptance
feature: 2026-06-21-docs-agent-surface-generation
status: passed
accepted: 2026-06-21
round: 1
---

# docs-agent-surface-generation Acceptance Report

> Phase: 3 acceptance
> Acceptance date: 2026-06-21
> Design: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-design.md`

## 1. Interface Contract Check

- [x] Docs renderer: `src/cli/metadata/docs-renderer.ts` renders deterministic blocks from registry metadata.
- [x] Docs checker: `scripts/check-metadata-docs.mjs` verifies or writes marker-bounded generated blocks and checks dist freshness.
- [x] Docs surfaces: README, CLI usage, MCP usage, and agent surface docs include generated sections.
- [x] Agent surface: `docs/user-guide/agent-surface.md` covers Claude Code and Codex setup plus shared ArchGuard workflows.
- [x] E2E: `tests/integration/cli-mcp/metadata-surface-e2e.test.ts` covers CLI structured help, in-process MCP metadata, docs check, and stale-doc failure.

## 2. Behavior And Decision Check

- [x] CLI command/tool runtime behavior was not intentionally changed by docs generation.
- [x] Generated docs blocks are narrow and marker-bounded.
- [x] The docs check is verify-only by default and does not rewrite in CI.
- [x] `docs:write` is explicit and deterministic.
- [x] CI runs `npm run docs:check` after `npm run build`.
- [x] Current git-history guidance uses `archguard analyze --include-git`.

## 3. Acceptance Scenario Check

- [x] Review report exists and passed: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-review.md`
- [x] QA report exists and passed: `.codestable/features/2026-06-21-docs-agent-surface-generation/docs-agent-surface-generation-qa.md`
- [x] QA covered design required commands and review focus.
- [x] failed / blocked QA items: none
- [x] residual-risk does not carry a core metadata surface E2E gap.
- [x] Checklist steps are `done` and checks are `passed`.

## 4. Terminology Consistency

- Registry terms used consistently: CLI metadata, MCP metadata, query mappings, agent guidance, generated block, stale-doc check, and agent surface.
- Setup names distinguish Claude Code project-scope registration from Codex user-scope/config registration without changing ArchGuard capability semantics.

## 5. Architecture Merge

- [x] `.codestable/architecture/ARCHITECTURE.md` records the docs renderer/checker and agent surface docs as registry consumers.
- [x] Architecture notes now state that CLI, MCP, docs, and agent surface descriptions are projected from `src/cli/metadata/`, with drift checks and E2E enforcing alignment.

## 6. Requirement Backfill

- No standalone requirement document was referenced by this feature. This feature completes the `command-metadata-registry` roadmap.

## 7. Roadmap Update

- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml` updated for `docs-agent-surface-generation`.
- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md` updated to mark all features done.
- [x] Goal state updated to mark this feature accepted and advance `current_feature_index` to 4.

## 8. Attention Candidates

- No new recurring environment note needs to be added to `.codestable/attention.md`.
- Learning candidate: dist-backed docs checks need freshness guards or they can validate stale generated output.

## 9. Leftovers

- Full repository lint/format/test/coverage commands remain baseline red for unrelated issues documented in QA and final audit.
- Future improvement: expose `ARCHGUARD_DOCS_ROOT` as contributor-facing docs-check fixture guidance if contributors need temp-root docs validation.

## 10. Final Audit

- Verification evidence source: QA report.
- Aggregate commands:
  - `npm run type-check` -> exit 0
  - `npm run build` -> exit 0
  - `npm run docs:check` -> exit 0
  - `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/mcp/mcp-metadata-drift.test.ts` -> exit 0
  - `npm test -- tests/integration/e2e/cli-structured-help.e2e.test.ts tests/integration/e2e/mcp-agent-descriptions.e2e.test.ts tests/integration/cli-mcp/metadata-surface-e2e.test.ts` -> exit 0
- Scenario review: re-verified 8 / trust-prior-verify 2.
- Deliverable review: renderer, script, docs, tests, package scripts, CI, ADRs, architecture, roadmap state all present.
- Full working tree review: current untracked CodeStable/source/test/doc files are intentional roadmap deliverables.
- Diff cleanliness: pass.
- Knowledge exits: learning candidate recorded above; no attention update needed.
- Conclusion: passed.
