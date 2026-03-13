# Proposal: Git History Correctness Fixes, Multi-Contributor Ownership, MCP Test Scope, and Python Import Relations

## Background

Architecture analysis of the `src/cli/git-history/` subsystem and `src/plugins/python/` has
identified six bugs and missing features: three CRITICAL correctness defects, one HIGH-severity
data-model limitation, and two HIGH-severity missing capabilities. Each issue is independently
addressable but they share a single theme — data that is collected but silently discarded, or
scopes that are too narrow to produce meaningful output.

The issues were identified through code review of:
- `src/cli/git-history/history-aggregator.ts`
- `src/cli/git-history/history-query.ts`
- `src/cli/git-history/git-log-reader.ts`
- `src/cli/git-history/history-loader.ts`
- `src/cli/git-history/history-writer.ts`
- `src/cli/mcp/tools/git-history-tools.ts`
- `src/cli/mcp/tools/git-history-analyze-tool.ts`
- `src/cli/mcp/tools/test-analysis-tools.ts`
- `src/cli/query/engine-loader.ts`
- `src/plugins/python/index.ts`

---

## Issues

### Issue 1 (CRITICAL): Git History Sub-Package Queries Always Fail

**Location**: `history-aggregator.ts` — `extractPackagePath()` (line 413) and
`aggregateFileMetrics()` (line 108), `aggregatePackageMetrics()` (line 204).

**Root cause**: `extractPackagePath()` always returns `parts[0]` — the first path segment only.
`fileMetrics.packagePath` and the keys of the `pkgMap` in `aggregatePackageMetrics()` are
therefore always single-segment strings (e.g. `src`, `cmd`, `internal`).

When `getPackageStats(depth=2)` or `getPackageStats(depth=3)` is requested, the caller queries
`packageMetrics.get('src/mermaid')` but the map has only the key `src`. The lookup returns
`undefined` → "Target not found" error, and all sub-package data is silently discarded.

For most real-world repositories (Go monorepos, TypeScript projects with `src/xxx/`, C++ with
`ggml/src/ggml-vulkan/`) every query at depth ≥ 2 fails. This is the **primary use-case** of the
git history feature.

**Fix**: Make `extractPackagePath(filePath, depth)` take a configurable depth. Pass depth through
`aggregateFileMetrics()` and `aggregatePackageMetrics()`. The package metrics map keys must use
the same depth that callers expect.

Add a prefix-match fallback in `HistoryQuery.getMetrics()` so that if the exact key is missing,
the closest ancestor package is returned with a warning in the result.

---

### Issue 2 (CRITICAL): Package Commit Count Inflated (Dead Code Bug)

**Location**: `history-aggregator.ts` `aggregatePackageMetrics()` lines 154–170.

**Root cause**: The accumulator struct declares `commitShas: Set<string>` but the aggregation loop
never calls `acc.commitShas.add(...)`. Package commit count is therefore computed as:

```typescript
const commitCount = acc.files.reduce((s, f) => s + f.commitCount, 0);
```

This **sums** raw per-file commit counts without SHA deduplication. A commit that touches 10 files
in `cmd/` is counted 10 times. For busy packages with many files the inflation factor is 5×–50×.
Users see "779 commits" for a package that had 43 actual commits.

**Fix**: The `aggregatePackageMetrics()` function currently receives only `FileHistoryMetrics[]`
which has already lost the individual SHAs (only raw counts remain). Two options:

1. **Preferred**: Pass `CommitRecord[]` (the original raw commits) alongside `fileMetrics` so that
   SHAs can be deduplicated during package rollup. The `FileHistoryMetrics` type keeps only a
   `commitCount: number` — we add a `commitShas?: string[]` field (optional, for rollup use) and
   populate it in `aggregateFileMetrics()`.

2. **Acceptable short-term**: Add `commitShas: string[]` to `FileHistoryMetrics`, populated in
   `aggregateFileMetrics()`, so `aggregatePackageMetrics()` can union them.

Option 2 is simpler and avoids passing the full CommitRecord slice through multiple layers.

---

### Issue 3 (HIGH): Ownership Returns Only Binary (Primary + "Others")

**Location**: `history-query.ts` `getOwnership()` lines 188–202;
`history-aggregator.ts` `aggregatePackageMetrics()` lines 193–195.

**Root cause**: The `FileAccumulator.authors` map (`Map<email, count>`) is correctly populated
during `aggregateFileMetrics()` but discarded before serialization — `FileHistoryMetrics` has
only `primaryOwner` and `primaryOwnerShare` scalars. Similarly `PackageHistoryMetrics` loses the
per-author breakdown.

`getOwnership()` reconstructs a fake "others" entry from `commitCount - primaryOwnerCommits`.
Bus-factor analysis requires the top-N contributor list to compute how many people cover, say,
80% of commits. The current data model makes accurate bus-factor impossible.

**Fix**:
1. Add `topContributors: { email: string; commitCount: number; share: number }[]` to both
   `FileHistoryMetrics` and `PackageHistoryMetrics` (top-5, bounded to keep artifact size small).
2. Populate during aggregation: sort `acc.authors` by count desc, take top-5, compute shares.
3. Update `getOwnership()` to use `topContributors` directly instead of synthesizing "others".
4. Recompute `activeMaintainers` as the number of contributors with share ≥ 5% (floor 1).
5. Recompute `busFactor` as the minimum contributors whose cumulative share crosses 50%.

---

### Issue 4 (CRITICAL): MCP Test Analysis Tools Return 0 Test Files

**Location**: `src/cli/mcp/tools/test-analysis-tools.ts` and
`src/cli/query/engine-loader.ts` (referenced as `../../query/engine-loader.js`).

**Root cause**: `loadEngine(path.join(root, '.archguard'))` resolves the widest scope from the
manifest. For a TypeScript project analyzed with `archguard analyze -s ./src`, the scope covers
only `src/`. Test files in `tests/` are excluded from the ArchJSON. `engine.hasTestAnalysis()`
returns false because `test-analysis.json` references entity IDs in `tests/` that were not
included in the scope.

No error or warning is emitted. The caller receives `NOT_ANALYZED_MSG` or empty results, with no
indication of _why_.

**Fix**:
1. When `engine.hasTestAnalysis()` returns false (or `testFileCount === 0`), build a diagnostic
   message that lists: (a) which scope was loaded, (b) what paths it covers, (c) how to re-analyze
   with a broader scope (e.g. `--include-tests` or `-s .`).
2. Add a `scope` parameter to `archguard_detect_test_patterns`, `archguard_get_test_metrics`,
   `archguard_get_test_issues`, and `archguard_get_entity_coverage` MCP tools. Pass it through to
   `loadEngine(archDir, scope)`.
3. Add a `testScope` parameter to `archguard_analyze` that includes `tests/` (or any caller-
   specified additional paths) in the analyzed ArchJSON so that test analysis has access to all
   test files.

---

### Issue 5 (HIGH): Git History Reports Stale/Renamed File Paths

**Location**: `src/cli/git-history/git-log-reader.ts` — `parseGitLogOutput()`.

**Root cause**: `git log --numstat` reports all historical file paths including paths that no
longer exist due to renames/deletions. Paths expressed with brace notation
(`src/{old => new}/file.ts`) are currently skipped (line 155), but the pre-rename path is still
emitted on separate lines in `git log`. These phantom paths appear in top-churned lists without
any annotation.

**Fix**:
1. Add `currentlyExists: boolean` to `FileHistoryMetrics`.
2. After `aggregateFileMetrics()` returns, cross-reference each path against the working tree
   using `fs.pathExists(path.join(repoRoot, fm.path))`. This is a one-shot batch check on the
   result set (bounded: default ≤500 files).
3. Add `stalePathWarning?: string` to `ChangeContextResult` in `history-query.ts`. When
   `currentlyExists === false`, populate the warning.
4. Filter or mark stale paths in `getChangeRisk()` and `getPackageStats()` output so callers
   can exclude phantom files from risk calculations.

---

### Issue 6 (HIGH): Python Plugin Produces 0 Inter-Package Relations

**Location**: `src/plugins/python/index.ts`; new file `src/plugins/python/import-extractor.ts`.

**Root cause**: `ArchJsonMapper` in `src/plugins/python/archjson-mapper.ts` builds entities from
class/function definitions but does not parse `import` or `from ... import` statements. The
`DependencyExtractor` (pip metadata) handles external packages only. There are zero
`Relation(type='dependency')` entries across modules, so the Python class diagram has no edges.

For a project like `lmdeploy`, the entire architecture graph is disconnected — each module is an
isolated island with no cross-package dependencies visible.

**Fix**: Create `PythonImportExtractor` in `src/plugins/python/import-extractor.ts` that:
1. Scans each parsed Python file's AST (`import_statement` and `import_from_statement` nodes).
2. Resolves relative (`from . import`, `from .. import`) and absolute imports to module IDs using
   the same dotted-path scheme as `ArchJsonMapper.generateModuleId()`.
3. For each cross-module import, emits `Relation { from: currentModuleId, to: importedModuleId, type: 'dependency' }`.
4. Filters out: (a) third-party imports not present in the ArchJSON entity set, (b) self-imports.

Integrate into `PythonPlugin.parseProject()` after entity extraction, adding relations to the
ArchJSON output.

---

## Goals

1. Fix sub-package depth keying so `getPackageStats(depth=2)` returns correct data.
2. Deduplicate commit SHAs so package commit counts are accurate.
3. Expose top-N contributor list for accurate bus-factor computation.
4. Make MCP test analysis tools actionable when test scope is narrow — either auto-widen or
   provide clear diagnostics.
5. Annotate stale/renamed file paths to prevent false-positive risk signals.
6. Extract Python inter-package relations to make the class diagram connected.

---

## Design Decisions

### Depth parameter threading

The `depth` parameter must flow through the entire pipeline:
`readGitLog → aggregateFileMetrics(depth) → aggregatePackageMetrics(depth) → writeHistoryArtifacts`

The entry point is `archguard_analyze_git` in `git-history-analyze-tool.ts`, which currently
calls `aggregateFileMetrics(commits)` and `aggregatePackageMetrics(fileMetrics)` without depth.
A new `packageDepth` parameter must be added to the MCP tool and threaded through to both
aggregators.

The `extractPackagePath(path, depth)` helper changes from a private implementation detail to a
key invariant: it must produce the same output for a given (path, depth) pair regardless of where
in the pipeline it is called. The `packagePath` field in `FileHistoryMetrics` must reflect the
configured depth.

The `GitHistoryManifest` type (in `src/types/git-history.ts`) must add a `packageDepth: number`
field so that `loadHistoryData()` and `HistoryQuery` can verify that stored artifacts match the
depth a caller expects. The manifest is written by `history-writer.ts` and read by
`history-loader.ts` — both are straightforward to update.

This is a **breaking change** to the git-history artifact schema (v1 → v2 for `manifest.version`).
Existing `.archguard/git-history/` artifacts at depth 1 will be invalidated and re-read as
shallow-only. The `history-loader.ts` should detect version mismatch and throw a
`GitHistoryNotFoundError` variant prompting re-analysis rather than silently loading stale data.

### commitShas persistence

Persisting `commitShas: string[]` in `FileHistoryMetrics` increases artifact size. For a repo
with 1000 files × 200 commits average = 200 000 strings. Using a short SHA (7 chars) adds ~1.4 MB
to the artifact. This is acceptable for the correctness fix. If size becomes a concern, SHAs can
be stored in a deduplicated side table and referenced by index.

### topContributors field

Bounded to top-5 contributors per entity. This is sufficient for bus-factor-1/2/3 analysis and
keeps the artifact small. The `primaryOwner` and `primaryOwnerShare` scalars are retained for
backward compatibility.

### MCP scope parameter

The `scope` parameter maps to the existing `scopeKey` in `resolveScope()` in
`src/cli/query/engine-loader.ts`. No new loading logic is required beyond threading
the parameter through the MCP tool handlers. The `loadEngine(archDir, scopeKey)` signature
already accepts an optional scope key.

The diagnostic message on `testFileCount === 0` should suggest the user either:
- Re-run `archguard analyze -s . --include-tests` to include `tests/` in the scope, or
- Pass `scope: "global"` if a global scope covering the full project already exists.

Note: the `test-analysis.json` is written as a standalone file at
`<archDir>/query/test-analysis.json` (not per-scope) by `engine-loader.ts` line 154. This means
test analysis is already scope-independent; the real problem is that the _entity IDs_ in
`test-analysis.json` must correspond to entities in the _loaded_ scope. If the loaded scope is
`src/` only, test files referencing `tests/` entity IDs will have unresolvable coverage links.
The fix should therefore focus on: (a) the diagnostic message, and (b) allowing the user to
request a broader scope that was analyzed with `--include-tests`.

### Python import resolution

Module IDs follow the dotted-path convention already established in `ArchJsonMapper`. For
`from lmdeploy.messages import Foo`, the imported module ID is `lmdeploy.messages`. For
relative imports (`from . import utils`), the base package is inferred from the current file's
module ID. Unknown/external imports (not present in the entity map) are silently dropped.

---

## Trade-offs and Risks

| Concern | Impact | Mitigation |
|---|---|---|
| Artifact schema change (depth field) | Existing cached artifacts need re-gen | Bump `manifest.version` to `'2'`; add migration note |
| `commitShas` size increase | ~1–5 MB per large repo | Optional field; omit in future compact mode |
| Python import resolution accuracy | False positives for re-exported names | Filter by entity set; log unresolved count |
| MCP scope widening silently fails | If global scope is missing, error still thrown | Improve diagnostic with actionable message |
| Stale path check I/O | N fs.pathExists calls | Batch async check; only for top-K churned files (K ≤ 500) |

---

## Architectural Review Notes

The following gaps were identified during architect review (2026-03-13):

1. **`aggregatePackageMetrics` receives only `FileHistoryMetrics[]`** — the current function
   signature has no access to raw commit SHAs. For Issue 2 (SHA deduplication), the cleanest fix
   is to add `commitShas: string[]` to `FileHistoryMetrics` in `src/types/git-history.ts` so the
   package aggregator can union them. Passing full `CommitRecord[]` down would require changing
   the `writeHistoryArtifacts` call site in `git-history-analyze-tool.ts`.

2. **`archguard_analyze_git` orchestrates all aggregation** — depth threading must go through
   this MCP tool and the CLI equivalent. The MCP tool signature must add `packageDepth?: number`
   (default 1, backward-compatible).

3. **Manifest schema is versioned** — the `GitHistoryManifest.version` field is `'1'` (string
   literal). Version bump to `'2'` requires updating the type in `src/types/git-history.ts` to
   `'1' | '2'` (or just `string`) and adding a version-check in `history-loader.ts`.

4. **`test-analysis.json` is path-global but entity-scoped** — the `engine-loader.ts` injects
   it unconditionally at line 154–163. The real fix for Issue 4 is ensuring the analyzed ArchJSON
   scope includes both `src/` and `tests/` when `--include-tests` is used; the MCP `scope`
   parameter is a secondary lookup mechanism, not the primary fix.

5. **Stale path check async batch** — `history-writer.ts` writes artifacts synchronously.
   The stale-path annotation should be applied _before_ writing (inside the MCP analyze tool),
   not on read. Adding it to the writer pipeline is cleaner than annotating on every query.

6. **Python import extractor tree-sitter nodes** — the Python tree-sitter grammar exposes
   `import_statement` (e.g. `import os`) and `import_from_statement` (e.g. `from x import y`).
   Both node types are available in `tree-sitter-python`. The extractor can reuse the existing
   `TreeSitterBridge` parse results rather than re-parsing files.

## Out of Scope

- Re-implementing the full git rename tracking (`git log --follow`) — too invasive for this round.
- Python type inference for resolving `from x import *` wildcard imports.
- Real-time git history streaming (all operations remain batch/offline).
- CLI `analyze-git` command (out of scope; only MCP tool updated for this proposal).
