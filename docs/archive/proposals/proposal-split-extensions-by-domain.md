# Proposal: Split extensions.ts by Domain

**Status**: Draft
**Date**: 2026-03-13
**Related ADR**: ADR-002 (ArchJSON Extensions v1.2)

---

## Background

`src/types/extensions.ts` is the single source of truth for all ArchJSON extension types
(per ADR-002). It currently stands at **387 lines** and contains three unrelated domains:

| Domain | Lines | Interface count |
|--------|-------|-----------------|
| Go Atlas extension types (`GoAtlasExtension` + 15+ supporting interfaces) | ~245 (lines 20–265) | 20 |
| TypeScript analysis types (`TsAnalysis`, module graph) | ~34 (lines 267–300) | 5 |
| Test analysis types (`TestAnalysis`, coverage/issue/metrics) | ~85 (lines 302–387) | 8 |
| Container (`ArchJSONExtensions`) | ~6 (lines 8–18) | 1 |

The file is growing with each language plugin addition. The Go Atlas section alone
(245 lines, 20 interfaces) accounts for 63% of the file and represents Go-specific
internal types that have no bearing on TypeScript or test analysis.

### Growth trajectory

- v1.0: container + placeholder (~10 lines)
- v1.1 (Go Atlas, Plan 16): +245 lines
- v1.2 (TypeScript analysis): +34 lines
- v1.3 (Test analysis, Plan 09): +85 lines
- Future: Java atlas, Rust atlas, Python analysis — each ~50–200 lines

At current growth rate the file will exceed 600 lines within two feature cycles.

---

## Problem

1. **Cognitive load**: Opening `extensions.ts` to edit test analysis types requires
   scrolling past 265 lines of Go-specific goroutine/channel/flow types.

2. **Review noise**: A PR that adds a new `TestIssue` variant touches the same file as
   one adding a new `GoroutinePattern` variant — unrelated reviewers are notified.

3. **Import granularity**: Every file that needs only `TestAnalysis` imports from a
   monolith that also pulls in 20 Go-specific types; tree-shaking at the type level is
   impossible (though TypeScript erases types at runtime, IDE tooling and language
   server overhead grows).

4. **Discoverability**: New contributors looking for test analysis types have no
   obvious file to open; the filename `extensions.ts` gives no domain hint.

---

## Proposed Solution

Create a `src/types/extensions/` directory and split the file by domain:

```
src/types/extensions/
  go-atlas.ts        # GoAtlasExtension, GoAtlasLayers, GoAtlasMetadata,
                     # PackageGraph, CapabilityGraph, GoroutineTopology,
                     # FlowGraph, and all supporting interfaces/types
  ts-analysis.ts     # TsAnalysis, TsModuleGraph, TsModuleNode,
                     # TsModuleDependency, TsModuleCycle
  test-analysis.ts   # TestAnalysis, TestFileInfo, CoverageLink, TestIssue,
                     # TestMetrics, PackageCoverage, TestPatternConfig,
                     # DetectedTestPatterns
  index.ts           # ArchJSONExtensions container + re-exports of all three
                     # domain files + version constants
```

### Backward compatibility strategy

`src/types/extensions.ts` (the original file) becomes a **barrel redirect**:

```typescript
// src/types/extensions.ts  — backward-compat barrel (to be removed in Phase 3)
export * from './extensions/index.js';
```

This means **zero changes are required at any import site** during Phase 1.
`src/types/index.ts` already re-exports from `./extensions.js` and is unaffected.

---

## Affected Import Sites

22 source files + 14 test files currently import from `extensions.ts` directly or via
`src/types/index.ts`:

**src/ (22 files)**:
- `src/types/index.ts` (via `./extensions.js`)
- `src/core/interfaces/language-plugin.ts`
- `src/cli/query/query-engine.ts`
- `src/cli/utils/test-output-writer.ts`
- `src/cli/cache-manager.ts`
- `src/cli/processors/diagram-processor.ts`
- `src/cli/processors/arch-json-provider.ts`
- `src/cli/mcp/mcp-server.ts`
- `src/analysis/test-analyzer.ts`
- `src/analysis/test-coverage-mapper.ts`
- `src/analysis/test-issue-detector.ts`
- `src/mermaid/test-coverage-renderer.ts`
- `src/mermaid/ts-module-graph-renderer.ts`
- `src/plugins/golang/index.ts`
- `src/plugins/golang/atlas/types.ts`
- `src/plugins/golang/atlas/builders/flow-graph-builder.ts`
- `src/plugins/typescript/index.ts`
- `src/plugins/typescript/typescript-analyzer.ts`
- `src/plugins/typescript/builders/module-graph-builder.ts`
- `src/plugins/python/index.ts`
- `src/plugins/java/index.ts`
- `src/plugins/cpp/index.ts`

**tests/ (13 files, excluding poc/node_modules)**:
- `tests/plugins/golang/atlas/atlas-renderer.test.ts`
- `tests/plugins/golang/atlas/mermaid-templates.test.ts`
- `tests/unit/types/extensions.test.ts`
- `tests/unit/types/test-analysis-types.test.ts`
- `tests/unit/analysis/test-coverage-mapper.test.ts`
- `tests/unit/analysis/test-issue-detector.test.ts`
- `tests/unit/mermaid/test-coverage-renderer.test.ts`
- `tests/unit/mermaid/ts-module-graph-renderer.test.ts`
- `tests/unit/cli/mcp/mcp-server.test.ts`
- `tests/unit/cli/mcp/test-analysis-mcp.test.ts`
- `tests/unit/cli/cache-manager-composite.test.ts`
- `tests/unit/cli/utils/test-output-writer.test.ts`
- `tests/unit/cli/query/query-engine.test.ts`

Phase 1 (barrel redirect) requires touching **0** of these files.
Phase 2 (optional precision imports) updates them one domain at a time.
Phase 3 removes the old barrel.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Import path breakage during Phase 2 | Low | TypeScript compiler catches all misses; run `npm run type-check` after each batch |
| Circular dependency introduced | Low | Domain files import nothing from each other; only `index.ts` aggregates |
| `extensions.test.ts` tests break | Low | Barrel redirect keeps all symbols accessible; only path-specific tests need updating in Phase 3 |
| ADR-002 "single source of truth" violated | None | ADR-002 refers to the _concept_; the barrel `index.ts` preserves the single public surface |

---

## Non-goals

- Do **not** move `ArchJSONExtensions` out of `src/types/`; it remains the public entry
  point consumed by `ArchJSON.extensions`.
- Do **not** rename existing exported symbols.
- Do **not** split `src/types/index.ts` or `src/types/config.ts`.

---

## Success Criteria

1. `src/types/extensions.ts` is reduced to a 3-line barrel (or deleted).
2. Each domain file is ≤200 lines.
3. All 2787+ tests continue to pass.
4. `npm run type-check` passes with zero errors.
5. No import site is broken at any phase boundary.
