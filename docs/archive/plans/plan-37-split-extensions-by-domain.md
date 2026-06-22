# Plan 36: Split extensions.ts by Domain

**Status**: Planned
**Proposal**: [proposal-split-extensions-by-domain.md](../proposals/proposal-split-extensions-by-domain.md)
**Effort**: ~2 hours (mostly mechanical import updates)

---

## Overview

Split `src/types/extensions.ts` (387 lines, 3 domains) into a `src/types/extensions/`
directory with one file per domain. Use a barrel redirect to preserve backward
compatibility throughout all phases.

### Files to create

| File | Contents | Est. lines |
|------|----------|-----------|
| `src/types/extensions/go-atlas.ts` | Go Atlas types (20 interfaces + 2 type aliases + 1 const) | ~250 |
| `src/types/extensions/ts-analysis.ts` | TypeScript analysis types (5 interfaces + 1 const) | ~40 |
| `src/types/extensions/test-analysis.ts` | Test analysis types (8 interfaces + 1 const) | ~90 |
| `src/types/extensions/index.ts` | `ArchJSONExtensions` container + re-exports | ~30 |

### Import sites affected (source files)

22 `src/` files and 13 `tests/` files import from `@/types/extensions` or
`./extensions.js`. Phase 1 touches none of them. Phase 2 updates them in three
domain-aligned batches. Phase 3 removes the old barrel.

---

## Phase 1 — Create domain files + barrel redirect (no breaking changes)

**Goal**: New structure exists; old `extensions.ts` becomes a 1-line re-export.
All tests pass without any other changes.

### Step 1.1 — Create `src/types/extensions/go-atlas.ts`

Copy lines 20–265 from `extensions.ts` verbatim (the Go Atlas section).
Add the file header comment referencing ADR-002.

Content to include (in order):
- `GO_ATLAS_EXTENSION_VERSION` constant
- `GoAtlasExtension`, `GoAtlasLayers`, `GoAtlasMetadata`
- `PackageGraph`, `PackageCycle`, `PackageNode`, `PackageStats`, `PackageDependency`
- `CapabilityGraph`, `CapabilityNode`, `CapabilityRelation`, `ConcreteUsageRisk`
- `GoroutineLifecycleSummary`, `GoroutineTopology`, `GoroutineNode`, `GoroutinePattern`
- `SpawnRelation`, `ChannelInfo`, `ChannelEdge`
- `FlowGraph`, `EntryPoint`, `EntryPointProtocol`, `HttpMethod`, `EntryPointType` (deprecated)
- `CallChain`, `CallEdge`

### Step 1.2 — Create `src/types/extensions/ts-analysis.ts`

Copy lines 267–300 from `extensions.ts` (the TypeScript analysis section).

Content:
- `TS_ANALYSIS_EXTENSION_VERSION` constant
- `TsAnalysis`, `TsModuleGraph`, `TsModuleNode`, `TsModuleDependency`, `TsModuleCycle`

### Step 1.3 — Create `src/types/extensions/test-analysis.ts`

Copy lines 302–387 from `extensions.ts` (the test analysis section).

Content:
- `TEST_ANALYSIS_VERSION` constant
- `TestPatternConfig`, `DetectedTestPatterns`
- `TestAnalysis`, `TestFileInfo`, `CoverageLink`
- `TestIssue`, `TestMetrics`, `PackageCoverage`

### Step 1.4 — Create `src/types/extensions/index.ts`

```typescript
/**
 * ArchJSON extension types — aggregation barrel
 *
 * Single source of truth for all language-specific extension types (ADR-002).
 * Domain files hold the actual definitions; this file re-exports everything
 * and owns the ArchJSONExtensions container.
 */
export * from './go-atlas.js';
export * from './ts-analysis.js';
export * from './test-analysis.js';

import type { GoAtlasExtension } from './go-atlas.js';
import type { TsAnalysis } from './ts-analysis.js';
import type { TestAnalysis } from './test-analysis.js';

/**
 * Type-safe extension container
 */
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;
  testAnalysis?: TestAnalysis;
  // Future: javaAtlas?, rustAtlas?, ...
}
```

### Step 1.5 — Replace `src/types/extensions.ts` with barrel redirect

```typescript
/**
 * @deprecated Direct imports from this file still work but prefer
 * importing from '@/types/extensions/<domain>' for clarity.
 * This barrel will be removed in a future release.
 */
export * from './extensions/index.js';
```

### Step 1.6 — Verify

```bash
npm run type-check   # must pass with zero errors
npm test             # all 2787+ tests must pass
```

---

## Phase 2 — Update import sites (domain-precise imports)

**Goal**: Each file imports from the narrowest domain file that satisfies its needs.
This phase is **optional for correctness** but improves maintainability.

Work in three batches, one per domain. Run `npm run type-check` after each batch.

### Batch A — Go Atlas imports

Files that import only Go Atlas types:
- `src/plugins/golang/atlas/types.ts`
- `src/plugins/golang/atlas/builders/flow-graph-builder.ts`
- `src/plugins/golang/index.ts`
- `tests/plugins/golang/atlas/atlas-renderer.test.ts`
- `tests/plugins/golang/atlas/mermaid-templates.test.ts`

Change import path from `@/types/extensions` (or `../../extensions.js` etc.) to
`@/types/extensions/go-atlas.js`.

### Batch B — TypeScript analysis imports

Files that import only TypeScript analysis types:
- `src/plugins/typescript/builders/module-graph-builder.ts`
- `src/plugins/typescript/typescript-analyzer.ts`
- `src/plugins/typescript/index.ts`
- `src/mermaid/ts-module-graph-renderer.ts`
- `tests/unit/mermaid/ts-module-graph-renderer.test.ts`

Change import path to `@/types/extensions/ts-analysis.js`.

### Batch C — Test analysis imports

Files that import only test analysis types:
- `src/analysis/test-analyzer.ts`
- `src/analysis/test-coverage-mapper.ts`
- `src/analysis/test-issue-detector.ts`
- `src/mermaid/test-coverage-renderer.ts`
- `src/cli/utils/test-output-writer.ts`
- `src/cli/query/query-engine.ts`
- `src/cli/mcp/mcp-server.ts`
- `tests/unit/analysis/test-coverage-mapper.test.ts`
- `tests/unit/analysis/test-issue-detector.test.ts`
- `tests/unit/mermaid/test-coverage-renderer.test.ts`
- `tests/unit/cli/mcp/test-analysis-mcp.test.ts`
- `tests/unit/cli/utils/test-output-writer.test.ts`
- `tests/unit/cli/query/query-engine.test.ts`

Change import path to `@/types/extensions/test-analysis.js`.

### Batch D — Mixed-domain imports (update last)

Files that import from multiple domains (keep importing from the barrel `index.ts`):
- `src/types/index.ts` — imports everything; keep `./extensions/index.js`
- `src/core/interfaces/language-plugin.ts` — check which types; update to specific domain or barrel as appropriate
- `src/cli/processors/diagram-processor.ts`
- `src/cli/processors/arch-json-provider.ts`
- `src/cli/cache-manager.ts`
- `src/plugins/python/index.ts`
- `src/plugins/java/index.ts`
- `src/plugins/cpp/index.ts`
- `tests/unit/types/extensions.test.ts`
- `tests/unit/types/test-analysis-types.test.ts`
- `tests/unit/cli/mcp/mcp-server.test.ts`
- `tests/unit/cli/cache-manager-composite.test.ts`

For each file: inspect which types it actually uses, route to the narrowest domain
file(s), or keep the barrel import if it uses types from more than one domain.

### Verify after each batch

```bash
npm run type-check
npm test
```

---

## Phase 3 — Remove old barrel

**Goal**: `src/types/extensions.ts` no longer exists. The canonical entry point is
`src/types/extensions/index.ts` and its siblings.

### Step 3.1 — Confirm no direct imports remain

```bash
grep -r "from.*types/extensions'" src/ tests/ --include="*.ts"
# Should show only extensions/go-atlas, extensions/ts-analysis,
# extensions/test-analysis, or extensions/index
```

If any file still imports from `@/types/extensions` (the old root path), update it
to `@/types/extensions/index.js` or the appropriate domain file.

### Step 3.2 — Update `src/types/index.ts`

Change the import/export lines that reference `./extensions.js` to
`./extensions/index.js`:

```typescript
// Before
export type { ArchJSONExtensions } from './extensions.js';
export type { GoAtlasExtension, ... } from './extensions.js';
export { GO_ATLAS_EXTENSION_VERSION, ... } from './extensions.js';

// After
export type { ArchJSONExtensions } from './extensions/index.js';
export type { GoAtlasExtension, ... } from './extensions/go-atlas.js';
export type { TsAnalysis, ... } from './extensions/ts-analysis.js';
export type { TestAnalysis, ... } from './extensions/test-analysis.js';
export { GO_ATLAS_EXTENSION_VERSION, ... } from './extensions/go-atlas.js';
export { TS_ANALYSIS_EXTENSION_VERSION } from './extensions/ts-analysis.js';
export { TEST_ANALYSIS_VERSION } from './extensions/test-analysis.js';
```

### Step 3.3 — Delete `src/types/extensions.ts`

```bash
rm src/types/extensions.ts
```

### Step 3.4 — Final verification

```bash
npm run type-check     # zero errors
npm test               # all 2787+ tests pass
npm run build          # dist/ builds cleanly
node dist/cli/index.js analyze -f json  # smoke test
```

---

## Completion Checklist

- [ ] Phase 1: `src/types/extensions/` directory created with 4 files
- [ ] Phase 1: `src/types/extensions.ts` reduced to barrel redirect
- [ ] Phase 1: `npm run type-check` passes
- [ ] Phase 1: All tests pass
- [ ] Phase 2: Batch A (Go Atlas) — 5 files updated
- [ ] Phase 2: Batch B (TS analysis) — 5 files updated
- [ ] Phase 2: Batch C (Test analysis) — 13 files updated
- [ ] Phase 2: Batch D (Mixed/barrel) — 12 files reviewed and updated
- [ ] Phase 2: `npm run type-check` passes after each batch
- [ ] Phase 3: No remaining imports from old `@/types/extensions` path
- [ ] Phase 3: `src/types/index.ts` updated to domain-precise re-exports
- [ ] Phase 3: `src/types/extensions.ts` deleted
- [ ] Phase 3: Final `npm run build` + smoke test passes

---

## Notes

- Each phase is independently committable. Phase 1 alone delivers the structural
  improvement; Phases 2–3 are polish.
- The `extensions/index.ts` barrel means any file that imports from
  `@/types/extensions/index.js` will always get the full public surface, so mixed
  importers never need to import from multiple domain files unless they want to be
  explicit.
- If a new language plugin (e.g. Java Atlas) needs its own extension types, add
  `src/types/extensions/java-atlas.ts` and re-export from `extensions/index.ts`.
  This plan establishes the pattern.
