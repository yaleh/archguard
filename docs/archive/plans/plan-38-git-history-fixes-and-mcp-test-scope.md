# Plan 38: Git History Correctness Fixes, Multi-Contributor Ownership, MCP Test Scope, and Python Import Relations

**Proposal**: `docs/proposals/proposal-git-history-fixes-and-mcp-test-scope.md`
**Priority**: CRITICAL (Issues 1, 2, 4) + HIGH (Issues 3, 5, 6)
**Estimated total LOC**: ~500 (code) + ~200 (tests)

---

## Phase Overview

| Phase | Title | Issues | LOC est. | Depends on |
|-------|-------|--------|----------|------------|
| 38A | Git History Schema + SHA Dedup | #1, #2 | ~180 | — |
| 38B | Multi-Contributor Ownership | #3 | ~100 | 38A |
| 38C | Stale Path Annotation | #5 | ~80 | 38A |
| 38D | MCP Test Analysis Scope | #4 | ~100 | — |
| 38E | Python Import Relations | #6 | ~150 | — |

Phases 38A–38C are tightly coupled (all touch `history-aggregator.ts`, `git-history.ts` types,
and the MCP analyze tool). Phase 38D is independent. Phase 38E is independent.

---

## Phase 38A: Git History Schema + SHA Dedup

**Addresses**: Issue 1 (sub-package depth), Issue 2 (commit count inflation)
**Files touched**: `src/types/git-history.ts`, `src/cli/git-history/history-aggregator.ts`,
`src/cli/mcp/tools/git-history-analyze-tool.ts`

### Stage 38A-1: Type changes — add `commitShas` and `packageDepth`

**File**: `src/types/git-history.ts`
**LOC**: ~25

Changes:
1. Add `commitShas: string[]` to `FileHistoryMetrics` (bounded array of SHA strings).
2. Add `topContributors` placeholder as `[]` (will be used in Phase 38B) — defer to 38B.
3. Add `packageDepth: number` to `GitHistoryManifest`.
4. Bump manifest version type from `'1'` to `'1' | '2'`.

Acceptance:
- TypeScript compiles without errors.
- All existing tests pass (no behavioral change yet).

### Stage 38A-2: `extractPackagePath(filePath, depth)` + aggregator depth threading

**File**: `src/cli/git-history/history-aggregator.ts`
**LOC**: ~60

Changes:
1. Change `extractPackagePath(filePath: string): string` →
   `extractPackagePath(filePath: string, depth: number = 1): string`.
   Implementation: `parts.slice(0, depth).join('/')`.
2. Add `depth: number = 1` parameter to `aggregateFileMetrics(commits, depth)`.
   - In the inner per-commit loop: push `commit.sha` to a `shaSet: Set<string>` on each
     `FileAccumulator` (not the existing `commits: string[]` array which already stores SHAs).
   - In result push: set `commitShas: [...acc.shaSet]` (already deduped as a Set).
   - Thread to `extractPackagePath(acc.path, depth)` in the result push.
3. Add `depth: number = 1` parameter to `aggregatePackageMetrics(fileMetrics, depth)`.
   - Use `extractPackagePath(fm.path, depth)` instead of `fm.packagePath` for `pkg` key.
   - Replace `const commitCount = acc.files.reduce(...)` with:
     ```typescript
     const allShas = new Set(acc.files.flatMap((f) => f.commitShas ?? []));
     const commitCount = allShas.size > 0 ? allShas.size : acc.files.reduce((s, f) => s + f.commitCount, 0);
     ```
     (Fallback to sum when `commitShas` unavailable for forward-compat with old artifacts.)

Note: `FileAccumulator` already has `commits: string[]` which is used for `commitCount`. We add a
parallel `shaSet` field (or reuse `commits` with dedup at end). Either approach is valid; using a
Set from the start is cleaner.

Acceptance:
- `extractPackagePath('src/mermaid/foo.ts', 2)` → `'src/mermaid'`.
- `extractPackagePath('src/mermaid/foo.ts', 1)` → `'src'`.
- `extractPackagePath('Makefile', 1)` → `'.'`.
- Package commit count for a package where 3 commits each touch 5 files = 3 (not 15).
- Unit tests: `tests/unit/cli/git-history/history-aggregator.test.ts` (new group, 8 tests).

### Stage 38A-3: MCP analyze tool — add `packageDepth` parameter

**File**: `src/cli/mcp/tools/git-history-analyze-tool.ts`
**LOC**: ~25

Changes:
1. Add `packageDepth: z.coerce.number().int().min(1).max(5).optional().default(1)` to tool schema.
2. Thread `packageDepth` to `aggregateFileMetrics(commits, packageDepth)` and
   `aggregatePackageMetrics(fileMetrics, packageDepth)`.
3. Add `packageDepth` to `GitHistoryManifest` object before writing.
4. Bump `version: '2'` in the manifest.

Acceptance:
- `archguard_analyze_git({ packageDepth: 2 })` writes artifacts with depth-2 package keys.
- Manifest contains `"packageDepth": 2, "version": "2"`.

### Stage 38A-4: Loader version check

**File**: `src/cli/git-history/history-loader.ts`
**LOC**: ~15

Changes:
1. After reading manifest, if `manifest.version === '1'` (or missing `packageDepth`), throw a
   `GitHistoryStaleArtifactError` with message:
   `"Git history artifacts are from schema v1. Re-run archguard_analyze_git to regenerate."`.

Acceptance:
- Loading a v1 artifact throws descriptive error.
- Loading a v2 artifact succeeds.

---

## Phase 38B: Multi-Contributor Ownership

**Addresses**: Issue 3
**Files touched**: `src/types/git-history.ts`, `src/cli/git-history/history-aggregator.ts`,
`src/cli/git-history/history-query.ts`
**Depends on**: 38A (type additions)

### Stage 38B-1: Add `topContributors` to type definitions

**File**: `src/types/git-history.ts`
**LOC**: ~15

Changes:
1. Add `ContributorSummary` interface: `{ email: string; commitCount: number; share: number }`.
2. Add `topContributors: ContributorSummary[]` to `FileHistoryMetrics`.
3. Add `topContributors: ContributorSummary[]` to `PackageHistoryMetrics`.

### Stage 38B-2: Populate `topContributors` in aggregators

**File**: `src/cli/git-history/history-aggregator.ts`
**LOC**: ~40

Changes (in `aggregateFileMetrics`):
1. After computing `primaryOwner`, sort `acc.authors` desc by count, take top-5.
2. Compute share = count / commitCount for each.
3. Set `topContributors` in result push.

Changes (in `aggregatePackageMetrics`):
1. Merge `authorCommits` map across files (sum commit counts by email).
2. Sort desc, take top-5, compute shares relative to package `commitCount`.
3. Set `topContributors` in result push.
4. Replace `authorCount` approximation with `allAuthors.size` (derived from merged map).

### Stage 38B-3: Update `getOwnership()` to use `topContributors`

**File**: `src/cli/git-history/history-query.ts`
**LOC**: ~30

Changes:
1. In `getOwnership()`, return `m.topContributors` directly as `contributors`.
2. Remove the synthetic "others" contributor.
3. Recompute `activeMaintainers` = count of contributors with `share >= 0.05` (floor: 1).
4. Recompute `busFactor`:
   ```typescript
   let cumulative = 0, busFactor = 0;
   for (const c of m.topContributors) {
     cumulative += c.share;
     busFactor++;
     if (cumulative >= 0.5) break;
   }
   ```

Acceptance:
- `getOwnership('file', 'src/foo.ts')` returns `contributors` with ≥2 real email entries when file has multiple authors.
- `busFactor` = 1 when single author has ≥50% of commits.
- `busFactor` = 3 when top-3 authors needed to reach 50%.
- Unit tests: 6 new tests in `tests/unit/cli/git-history/history-query.test.ts`.

---

## Phase 38C: Stale Path Annotation

**Addresses**: Issue 5
**Files touched**: `src/types/git-history.ts`,
`src/cli/mcp/tools/git-history-analyze-tool.ts`,
`src/cli/git-history/history-query.ts`
**Depends on**: 38A (schema v2 already established)

### Stage 38C-1: Add `currentlyExists` to type

**File**: `src/types/git-history.ts`
**LOC**: ~5

Changes:
1. Add `currentlyExists?: boolean` to `FileHistoryMetrics`.
   (Optional to allow loading of artifacts written before this field was added.)

### Stage 38C-2: Annotate stale paths during analysis

**File**: `src/cli/mcp/tools/git-history-analyze-tool.ts`
**LOC**: ~30

Changes:
1. After `aggregateFileMetrics()`, batch-check existence:
   ```typescript
   await Promise.all(fileMetrics.map(async (fm) => {
     fm.currentlyExists = await fs.pathExists(path.join(projectRoot, fm.path));
   }));
   ```
2. This mutates the already-allocated array in-place before writing — no extra allocation.

### Stage 38C-3: Surface stale path warning in `getChangeContext()`

**File**: `src/cli/git-history/history-query.ts`
**LOC**: ~15

Changes:
1. Add `stalePathWarning?: string` to `ChangeContextResult`.
2. In `getChangeContext()`, if `m.currentlyExists === false`, set:
   `stalePathWarning: "This file path no longer exists in the working tree. It may have been renamed or deleted. History reflects the old path only."`

Acceptance:
- A renamed file's `FileHistoryMetrics.currentlyExists === false` after analysis.
- `getChangeContext('file', 'old/path.ts')` includes `stalePathWarning` in result.
- Unit tests: 4 tests (2 aggregator, 2 query).

---

## Phase 38D: MCP Test Analysis Scope

**Addresses**: Issue 4
**Files touched**: `src/cli/mcp/tools/test-analysis-tools.ts`
**Independent of 38A–38C**

### Stage 38D-1: Add `scope` parameter to all test analysis tools

**File**: `src/cli/mcp/tools/test-analysis-tools.ts`
**LOC**: ~40

Changes:
1. Add `scope: z.string().optional().describe('Query scope key (e.g. "global"). Defaults to widest available scope.')` to all four tool schemas.
2. Thread `scope` to `loadEngine(path.join(root, '.archguard'), scope)`.

### Stage 38D-2: Actionable diagnostic when `testFileCount === 0`

**File**: `src/cli/mcp/tools/test-analysis-tools.ts`
**LOC**: ~35

The `loadEngine()` call resolves the scope internally. To build the diagnostic, use
`readManifest()` (exported from `engine-loader.ts`) before or after `loadEngine()` to get
scope metadata.

Changes:
1. In `archguard_detect_test_patterns`, after loading engine, check:
   ```typescript
   const analysis = engine.getTestAnalysis();
   if (!analysis || analysis.metrics.totalTestFiles === 0) {
     // Read manifest to show available scopes in diagnostic
     const archDir = path.join(root, '.archguard');
     let availableScopes = '';
     try {
       const manifest = await readManifest(archDir);
       availableScopes = manifest.scopes.map(s => `${s.key} (${s.label})`).join(', ');
     } catch { /* ignore */ }
     return textResponse(JSON.stringify({
       detectedFrameworks: [],
       suggestedPatternConfig: {},
       notes: [
         'No test files found in the loaded scope.',
         'This scope likely covers only src/ and excludes tests/.',
         'Fix: Re-run archguard_analyze with --include-tests flag, or pass scope:"global" if a global scope exists.',
         availableScopes ? `Available scopes: ${availableScopes}` : 'Run archguard_analyze first.',
       ],
     }, null, 2));
   }
   ```
2. Apply the same `testFileCount === 0` check in `archguard_get_test_metrics` and
   `archguard_get_test_issues`, replacing the generic `NOT_ANALYZED_MSG` with a scoped
   diagnostic. Import `readManifest` from `'../../query/engine-loader.js'`.
3. The `hasTestAnalysis()` check in existing handlers maps to `getTestAnalysis() !== null`.
   Keep the existing `NOT_ANALYZED_MSG` for the case where `loadEngine()` itself throws (no
   prior analysis at all). The new diagnostic applies only when the engine loads successfully
   but returns 0 test files.

Acceptance:
- When loaded scope has 0 test files, response includes the scope name and re-analyze hint.
- When `scope: "global"` is passed and global scope has test files, results are non-empty.
- Unit tests: 6 tests in `tests/unit/cli/mcp/test-analysis-scope.test.ts`.

---

## Phase 38E: Python Import Relations

**Addresses**: Issue 6
**Files touched**: new `src/plugins/python/import-extractor.ts`,
`src/plugins/python/archjson-mapper.ts`, `src/plugins/python/index.ts`
**Independent of 38A–38D**

### Stage 38E-1: `PythonImportExtractor`

**File**: `src/plugins/python/import-extractor.ts` (new)
**LOC**: ~80

Interface:
```typescript
export interface ImportRelation {
  sourceModuleId: string;
  targetModuleId: string;
}

export class PythonImportExtractor {
  extract(tree: Tree, currentModuleId: string, knownModuleIds: Set<string>): ImportRelation[];
}
```

Algorithm:
1. Walk AST for `import_statement` nodes → extract module name → check in `knownModuleIds`.
2. Walk AST for `import_from_statement` nodes → extract module path → resolve relative imports
   using `currentModuleId` as base.
3. Skip: (a) modules not in `knownModuleIds`, (b) self-imports, (c) `__future__` imports.
4. Return deduped list of `{ sourceModuleId, targetModuleId }`.

Relative import resolution:
```
from . import utils   → base = currentModuleId parent → base + '.utils'
from .. import models → parent of parent → parent + '.models'
```

### Stage 38E-2: Integrate into `ArchJsonMapper`

**File**: `src/plugins/python/archjson-mapper.ts`
**LOC**: ~35

Changes:
1. Accept `importRelations: ImportRelation[]` as parameter in `mapRelations()`.
2. For each `ImportRelation`, create `Relation { from, to, type: 'dependency' }` using
   `createRelation()` helper.
3. Dedup by `from:to` key.
4. Merge with existing `Relation[]` in the result.

### Stage 38E-3: Wire into `PythonPlugin.parseProject()`

**File**: `src/plugins/python/index.ts`
**LOC**: ~25

Changes:
1. After all files are parsed and entities collected, build `knownModuleIds` set from entity IDs.
2. Instantiate `PythonImportExtractor`, call `extract()` per file with the cached parse tree.
3. Pass collected `ImportRelation[]` to `ArchJsonMapper.mapRelations()`.

Acceptance:
- `from lmdeploy.messages import Foo` in `lmdeploy/pytorch/models.py` creates
  `Relation { from: 'lmdeploy.pytorch.models', to: 'lmdeploy.messages', type: 'dependency' }`.
- Third-party imports (e.g. `import torch`) produce no Relation (not in `knownModuleIds`).
- Relative import `from . import utils` in `lmdeploy.pytorch.models` →
  `Relation { from: '...models', to: 'lmdeploy.pytorch.utils', type: 'dependency' }`.
- Unit tests: `tests/unit/plugins/python/python-import-extractor.test.ts` (12 tests).
- Integration: lmdeploy class diagram shows cross-package edges (manual validation).

---

## Test Strategy

- **TDD**: Write failing tests for each stage before implementing.
- **Coverage target**: ≥80% for new/modified files.
- **Unit test locations**:
  - `tests/unit/cli/git-history/history-aggregator.test.ts` — 38A, 38B aggregator tests
  - `tests/unit/cli/git-history/history-query.test.ts` — 38B query tests
  - `tests/unit/cli/git-history/history-loader.test.ts` — 38A-4 version check
  - `tests/unit/cli/mcp/test-analysis-scope.test.ts` — 38D tests
  - `tests/unit/plugins/python/python-import-extractor.test.ts` — 38E tests
- **No E2E required**: git history E2E requires a real git repo and network; unit tests use
  synthetic `CommitRecord[]` arrays.
- **No regression**: All 2787 existing tests must continue to pass. Default `depth=1` ensures
  backward-compatible behavior for all existing callers.

---

## Dependency Graph

```
38A-1 (types: commitShas, packageDepth)
  └─ 38A-2 (aggregator: depth threading + SHA dedup)
       ├─ 38A-3 (MCP tool: packageDepth param)
       │    └─ 38A-4 (loader: version check)
       ├─ 38B-1 (types: topContributors)
       │    └─ 38B-2 (aggregator: populate topContributors)
       │         └─ 38B-3 (query: use topContributors)
       └─ 38C-1 (types: currentlyExists)
            └─ 38C-2 (annotate in MCP tool)
                 └─ 38C-3 (surface in getChangeContext)

38D-1 (scope param)
  └─ 38D-2 (diagnostic message)

38E-1 (PythonImportExtractor)
  └─ 38E-2 (ArchJsonMapper integration)
       └─ 38E-3 (PythonPlugin.parseProject wiring)
```

Notes:
- 38B-1/38C-1 depend on 38A-2 (aggregator changes must exist before type extensions work correctly).
- 38A-3 and 38A-4 can be done in parallel with 38B after 38A-2 is complete.
- 38D and 38E are fully independent and can be implemented concurrently with 38A–38C.

---

## Acceptance Criteria (Phase-level)

| Phase | Acceptance |
|-------|-----------|
| 38A | `getPackageStats(depth=2)` returns non-empty results; package commit counts match SHA dedup; manifest version='2' |
| 38B | `getOwnership()` returns ≥2 real email contributors; bus-factor computed correctly |
| 38C | Renamed files annotated with `currentlyExists: false`; `getChangeContext()` includes `stalePathWarning` |
| 38D | Scope param accepted; 0-test-file response includes scope name + re-analyze instructions |
| 38E | Python class diagram has inter-package dependency edges; `from x import y` creates Relation |

---

## Migration Notes

1. Existing `.archguard/query/git-history/` artifacts at schema v1 must be regenerated. The
   loader throws `GitHistoryStaleArtifactError` on version mismatch.
2. The `FileHistoryMetrics.commitShas` field IS persisted in `file-metrics.json`. For large repos
   (1000 files × 200 avg commits) this adds ~1.4 MB. This is acceptable. If artifact size
   becomes a concern in a future version, `commitShas` can be replaced with a deduplicated
   side-table in `manifest.json`. For now, the field must be in the serialized type to support
   package-level dedup.
3. Python plugin change is additive — projects without cross-module imports will have an empty
   relations array as before.
