---
doc_type: feature-acceptance
feature: 2026-06-21-cli-help-from-registry
status: passed
accepted: 2026-06-21
round: 1
---

# cli-help-from-registry 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-06-21
> 关联方案 doc：`.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-design.md`

## 1. 接口契约核对

- [x] Structured help noun: `src/cli/commands/help.ts` exposes `createStructuredHelp()` with `program`, `schemaVersion`, and registry-backed `commands`.
- [x] Command schema: each structured command includes `name`, `description`, `category`, `options`, `agent`, and `examples`.
- [x] Option schema: structured options include `flags`, `description`, optional defaults/allowed values, and `mapsToMcpTool`.
- [x] Registry consumer: `src/cli/index.ts` uses registry descriptions through `withRegistryDescription`.

## 2. 行为与决策核对

- [x] `archguard help --json` is the structured help entrypoint and emits JSON only.
- [x] `archguard --help` remains human-readable Commander help.
- [x] `archguard query --help` remains human-readable and lists existing query flags.
- [x] `archguard help` and `archguard help query` preserve human help fallback after independent review.
- [x] No command handlers for analyze/query/cache/init/mcp/diff/check were rewritten.
- [x] Unknown structured mode with extra command argument fails clearly.

## 3. 验收场景核对

- [x] Structured help includes all 7 CLI business commands.
  - Evidence: `node dist/cli/index.js help --json` parse smoke reported `commands=7`.
- [x] Query option MCP mapping is present.
  - Evidence: query `--summary` maps to `archguard_summary`.
- [x] Drift tests enumerate runtime Commander commands/options, not source grep.
  - Evidence: `tests/unit/cli/cli-metadata-drift.test.ts` traverses `createCLI().commands`.
- [x] Drift tests are bidirectional.
  - Evidence: Commander options must exist in registry and registry options must exist in Commander.
- [x] Human help output shape is E2E-tested.
  - Evidence: `tests/integration/e2e/cli-structured-help.e2e.test.ts`.
- [x] Review QA focus covered.
  - Evidence: independent review blocking findings fixed and QA passed.
- [x] QA report source: `.codestable/features/2026-06-21-cli-help-from-registry/cli-help-from-registry-qa.md`.
  - failed / blocked items: none.

## 4. 术语一致性

- `Structured help`, `Human help`, `CLI drift test`, and `registry` are used consistently across design, code, and tests.

## 5. 架构归并

- [x] `.codestable/architecture/ARCHITECTURE.md`: updated to document `src/cli/commands/help.ts` as the registry-derived `archguard help --json` CLI catalog surface and to record Commander human help as the separate human surface.

## 6. requirement 回写

- No separate requirement document is referenced by this feature. No requirement backfill needed.

## 7. roadmap 回写

- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-items.yaml`: `cli-help-from-registry` marked `done`.
- [x] `.codestable/roadmap/command-metadata-registry/command-metadata-registry-roadmap.md`: execution status updated.

## 8. attention.md 候选盘点

- Candidate: built CLI tests depend on running `npm run build` before E2E tests under `tests/integration/e2e/cli-structured-help.e2e.test.ts`. This is feature-specific enough to keep in QA/acceptance rather than global attention for now.

## 9. 遗留

- Option description text is not yet generated into Commander option registration. Drift tests prove flag presence and MCP mappings, not text equality. This remains a staged migration boundary for later surface adapter work.

## 10. 最终审计

- 验证证据来源：`cli-help-from-registry-qa.md`
- 聚合命令：
  - `npm run type-check` -> exit 0
  - `npm test -- tests/unit/cli/help-command.test.ts tests/unit/cli/cli-metadata-drift.test.ts` -> exit 0
  - `npm test -- tests/unit/cli/metadata-registry.test.ts tests/unit/cli/command.test.ts tests/unit/cli/commands/query.test.ts` -> exit 0
  - `npm run build` -> exit 0
  - `npm run test:e2e -- tests/integration/e2e/cli-structured-help.e2e.test.ts` -> exit 0
  - `node dist/cli/index.js help --json` parsed successfully
- 场景复核：re-verified 7 / trust-prior-verify 0
- 交付物复核：code, tests, E2E, architecture, roadmap, and checklist passed.
- 完整工作区复核：feature files are present in git status; generated `dist/` remains ignored.
- diff 清洁度：passed.
- 知识沉淀出口：no immediate `attention.md` update required.
- 结论：通过.
