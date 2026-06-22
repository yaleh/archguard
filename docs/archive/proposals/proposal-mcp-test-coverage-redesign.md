# Proposal: MCP Test Coverage Tool Redesign

**Status**: Draft
**Date**: 2026-03-12
**Scope**: `src/cli/mcp/tools/test-analysis-tools.ts`, `src/cli/query/query-engine.ts`, `src/types/extensions.ts`

---

## Problem Statement

`archguard_get_test_coverage` returns the full `analysis.coverageMap` array, which is the entire
`CoverageLink[]` value from `TestAnalysis.coverageMap`. `TestCoverageMapper.buildCoverageMap()`
initialises a `linkMap` entry for **every** entity in `archJson.entities` — including those with
zero coverage — so the returned array contains one entry per source entity.

For a mid-sized project (e.g. lmdeploy with ~2455 entities), the serialised JSON is approximately
400,000 characters. This consistently overflows the token budget of the MCP response, making the
tool unusable for its stated purpose.

Beyond raw size, the API surface is wrong for how LLMs actually query test quality data:

- LLMs rarely need all 2455 coverage links at once. They ask questions like "which packages are
  least covered?" or "what tests cover `LlamaModel`?".
- The flat `CoverageLink[]` structure provides no navigational signal. Every entry looks equally
  important. There are no package groupings, no ranked ordering, no entry point for exploration.
- The tool forces the LLM to receive and parse a giant payload just to answer a local question,
  wasting context budget that could be used for analysis.

The correct resolution is to make the **default path** return an aggregated summary (per-package
coverage breakdown) and provide a **drill-down path** for single-entity lookup, while removing the
unbounded flat-array response from the MCP surface entirely.

---

## Goals

1. Extend `archguard_get_test_metrics` to optionally return per-package coverage statistics so an
   LLM can identify poorly-covered areas without loading per-entity detail.
2. Add `archguard_get_entity_coverage` as a focused drill-down tool for a single entity ID.
3. Remove `archguard_get_test_coverage` from the registered MCP tool set, eliminating the token
   overflow path.
4. Keep the underlying `TestAnalysis.coverageMap: CoverageLink[]` data structure and
   `QueryEngine.getTestAnalysis()` accessor intact for programmatic/internal use.

---

## Non-Goals

- Changing how `TestCoverageMapper.buildCoverageMap()` computes scores (no algorithmic change).
- Changing the on-disk serialisation format of `test-analysis.json`.
- Adding runtime (execution) coverage; all data remains static import-analysis approximations.
- Filtering or pagination on the removed `archguard_get_test_coverage` tool.

---

## Design

### 1. Extend `archguard_get_test_metrics` with package breakdown

#### New parameter

Add an optional `includePackageBreakdown` parameter to the existing
`archguard_get_test_metrics` tool registration in
`src/cli/mcp/tools/test-analysis-tools.ts` (line 243):

```typescript
includePackageBreakdown: z
  .boolean()
  .optional()
  .default(false)
  .describe(
    'When true, appends packageCoverage[] to the response: ' +
    'per-package entity count, covered count, and coverage ratio, ' +
    'sorted ascending by coverageRatio (worst-covered first).'
  ),
```

#### New return type: `PackageCoverage`

Add the following interface to `src/types/extensions.ts`, in the Test Analysis Extension section
(after `TestMetrics`, around line 373):

```typescript
export interface PackageCoverage {
  /** Package path as derived from entity sourceLocation.file, e.g. "lmdeploy/pytorch/models" */
  package: string;
  /** Total number of entities whose sourceLocation.file falls under this package */
  totalEntities: number;
  /** Number of those entities with coverageScore > 0 in the coverageMap */
  coveredEntities: number;
  /** coveredEntities / totalEntities, 0 when totalEntities === 0 */
  coverageRatio: number;
  /** IDs of test files that contribute at least one coverage link to this package */
  testFileIds: string[];
}
```

#### New `QueryEngine` method

Add `getPackageCoverage()` to `src/cli/query/query-engine.ts` in the query methods section
(after `hasTestAnalysis()`, around line 248):

```typescript
/**
 * Aggregate CoverageLink[] into per-package buckets.
 *
 * Package is derived from the sourceLocation.file of each entity, relativised
 * to workspaceRoot (consistent with how TestFileInfo.id is computed in
 * TestAnalyzer.buildTestFileInfos).  The first N-1 path components are used as
 * the package key (i.e. the directory path without the filename).
 *
 * Returns entries sorted ascending by coverageRatio (worst-covered first).
 */
getPackageCoverage(): PackageCoverage[] {
  const analysis = this.getTestAnalysis();
  if (!analysis) return [];

  // Build a fast lookup: entityId → coverageScore and coveredByTestIds
  const linkByEntity = new Map<string, { score: number; testIds: string[] }>(
    analysis.coverageMap.map((l) => [
      l.sourceEntityId,
      { score: l.coverageScore, testIds: l.coveredByTestIds },
    ])
  );

  const ws = this.archJson.workspaceRoot ?? '';
  const buckets = new Map<string, { total: number; covered: number; testIds: Set<string> }>();

  for (const entity of this.archJson.entities) {
    const rawFile = entity.sourceLocation?.file ?? '';
    const relFile = ws && path.isAbsolute(rawFile) ? path.relative(ws, rawFile) : rawFile;
    const pkg = path.dirname(relFile) || '.';

    if (!buckets.has(pkg)) {
      buckets.set(pkg, { total: 0, covered: 0, testIds: new Set() });
    }
    const bucket = buckets.get(pkg)!;
    bucket.total++;

    const link = linkByEntity.get(entity.id);
    if (link && link.score > 0) {
      bucket.covered++;
      for (const tid of link.testIds) bucket.testIds.add(tid);
    }
  }

  return Array.from(buckets.entries())
    .map(([pkg, b]) => ({
      package: pkg,
      totalEntities: b.total,
      coveredEntities: b.covered,
      coverageRatio: b.total > 0 ? b.covered / b.total : 0,
      testFileIds: Array.from(b.testIds),
    }))
    .sort((a, b) => a.coverageRatio - b.coverageRatio);
}
```

The import at the top of `query-engine.ts` will need to add `PackageCoverage` to the import from
`@/types/extensions.js`:

```typescript
import type { GoAtlasLayers, TsModuleGraph, TestAnalysis, PackageCoverage, TestFileInfo } from '@/types/extensions.js';
```

#### MCP handler changes

In `test-analysis-tools.ts`, the `archguard_get_test_metrics` handler (lines 249–260) becomes:

```typescript
async ({ projectRoot, includePackageBreakdown }) => {
  try {
    const root = resolveRoot(projectRoot, defaultRoot);
    const engine = await loadEngine(path.join(root, '.archguard'));
    if (!engine.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
    const analysis = engine.getTestAnalysis()!;
    const result: Record<string, unknown> = { ...analysis.metrics };
    if (includePackageBreakdown) {
      result.packageCoverage = engine.getPackageCoverage();
    }
    return textResponse(JSON.stringify(result, null, 2));
  } catch (e: any) {
    return textResponse(`Error: ${e.message}`);
  }
}
```

The tool description string should be updated to mention the new parameter:

> "Return test quality metrics: file counts by type, entity coverage ratio, assertion density, and
> issue counts. Pass `includePackageBreakdown: true` to append per-package coverage statistics
> sorted by worst-covered first. All metrics are static approximations. Call
> archguard_detect_test_patterns first."

> **Note**: The existing schema already declares `patternConfig` as a parameter but the handler
> does not destructure or use it. When adding `includePackageBreakdown`, the `patternConfig`
> parameter should be kept in the schema (for backward-compatibility) but explicitly documented as
> unused in `get_test_metrics` since coverage map aggregation does not depend on pattern config.

---

### 2. New `archguard_get_entity_coverage` MCP tool

#### Input schema

```typescript
server.tool(
  'archguard_get_entity_coverage',
  'Return coverage detail for a single source entity: coverage score, list of test file IDs ' +
    'that cover it, and key metadata for each test file. ' +
    'Entity ID format is a dotted or slash-separated path derived from the source file path, ' +
    'e.g. "lmdeploy.pytorch.models.LlamaModel" or the exact id string from archguard_find_entity. ' +
    'Call archguard_detect_test_patterns first.',
  {
    projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
    entityId: z.string().describe(
      'Exact entity ID as returned by archguard_find_entity or archguard_get_test_metrics. ' +
        'Example: "lmdeploy.pytorch.models.LlamaModel"'
    ),
  },
  async ({ projectRoot, entityId }) => { ... }
);
```

> **Note**: Unlike the other test analysis tools, `archguard_get_entity_coverage` intentionally
> omits `patternConfig` because entity coverage lookup is a pure index read from pre-computed
> analysis data — it does not re-run pattern matching.

#### Return type

The handler returns a JSON object with the following shape (no new interface needed in
`extensions.ts`; this is a projection computed at query time):

```typescript
{
  entityId: string;
  coverageScore: number;        // 0.0–1.0 from CoverageLink.coverageScore
  coveredByTestIds: string[];   // from CoverageLink.coveredByTestIds
  testFileDetails: Array<{      // joined from TestAnalysis.testFiles
    id: string;
    testType: TestFileInfo['testType'];
    testCaseCount: number;
    assertionCount: number;
    assertionDensity: number;
    frameworks: string[];
  }>;
  found: boolean;               // false only when entityId was not in archJson.entities at analysis time
}
```

When `found` is false (entity ID not present in `analysis.coverageMap`), the handler returns the
object with `coverageScore: 0`, empty arrays, and `found: false` rather than an error string.
After a successful analysis run, `buildCoverageMap()` initialises a `CoverageLink` entry for
**every** entity in `archJson.entities` — including those with zero coverage — so `found: false`
indicates the entity ID was not in `archJson.entities` at analysis time: either a genuine typo, or
an entity added to the codebase after the last analysis run.

> **Note**: If analysis data is stale, a valid new entity ID may return `found: false`. Re-run
> `archguard_detect_test_patterns` to refresh the analysis data.

#### QueryEngine method

Add `getEntityCoverage(entityId: string)` to `query-engine.ts`:

```typescript
getEntityCoverage(entityId: string): {
  entityId: string;
  coverageScore: number;
  coveredByTestIds: string[];
  testFileDetails: Array<{
    id: string;
    testType: TestFileInfo['testType'];
    testCaseCount: number;
    assertionCount: number;
    assertionDensity: number;
    frameworks: string[];
  }>;
  found: boolean;
} {
  const analysis = this.getTestAnalysis();
  if (!analysis) {
    return {
      entityId,
      coverageScore: 0,
      coveredByTestIds: [],
      testFileDetails: [],
      found: false,
    };
  }

  const link = analysis.coverageMap.find((l) => l.sourceEntityId === entityId);
  if (!link || link.coverageScore === 0) {
    return {
      entityId,
      coverageScore: link?.coverageScore ?? 0,
      coveredByTestIds: link?.coveredByTestIds ?? [],
      testFileDetails: [],
      found: link !== undefined,
    };
  }

  const testFileSet = new Set(link.coveredByTestIds);
  const testFileDetails = analysis.testFiles
    .filter((f) => testFileSet.has(f.id))
    .map((f) => ({
      id: f.id,
      testType: f.testType,
      testCaseCount: f.testCaseCount,
      assertionCount: f.assertionCount,
      assertionDensity: f.assertionDensity,
      frameworks: f.frameworks,
    }));

  return {
    entityId,
    coverageScore: link.coverageScore,
    coveredByTestIds: link.coveredByTestIds,
    testFileDetails,
    found: true,
  };
}
```

#### Registration

The tool is registered inside `registerTestAnalysisTools()` in `test-analysis-tools.ts`, directly
after the existing `archguard_get_test_metrics` block (which is currently the last tool, ending at
line 261). No changes to `createMcpServer()` or `registerTools()` in `mcp-server.ts` are needed;
`registerTestAnalysisTools` is already called unconditionally at line 69.

---

### 3. Remove `archguard_get_test_coverage` from MCP surface

#### What to remove

Delete the `server.tool('archguard_get_test_coverage', ...)` block from
`src/cli/mcp/tools/test-analysis-tools.ts` (lines 196–214).

The `analysis.coverageMap` field of `TestAnalysis` and `QueryEngine.getTestAnalysis()` are
**not** removed — they remain available for internal consumers:

- `src/analysis/test-issue-detector.ts` reads `coverageMap` directly (passed in by
  `TestAnalyzer.analyze()`).
- `src/mermaid/test-coverage-renderer.ts` consumes `CoverageLink[]` for the heatmap renderer.
- `src/cli/utils/test-output-writer.ts` writes `test/metrics.md` using the coverage data.
- `src/cli/query/query-engine.ts` accesses it via `getTestAnalysis()` for the new methods
  proposed above.

None of these internal consumers go through the MCP tool registration path; they are unaffected.

#### Downstream consumers to update

The only downstream consumers of the `archguard_get_test_coverage` MCP tool name are:

1. **Tests**: `tests/unit/cli/mcp/test-analysis-mcp.test.ts` contains a test block for the
   `archguard_get_test_coverage` tool. This test must be deleted and replaced with tests for
   `archguard_get_entity_coverage` and `archguard_get_test_metrics` with
   `includePackageBreakdown: true`.

2. **Documentation**: `docs/adr/006-mcp-tool-design-standards.md` (currently untracked) and any
   usage examples in `docs/` that reference `archguard_get_test_coverage` by name must be updated.
   Check `docs/plans/` and `docs/proposals/proposal-test-analysis.md` for references.

3. **Tool description comment** at the top of `test-analysis-tools.ts` (lines 1–9) lists four
   tools. Update it to list three tools (removing `archguard_get_test_coverage`, adding
   `archguard_get_entity_coverage`).

---

## Alternatives Considered

### Option A: Split into two tools — `get_test_coverage_summary` and `get_entity_coverage`

Keeps `get_test_coverage` in some form but splits it into a summary tool and a drill-down tool.
This was rejected because it adds a fourth test-related tool to the already four-tool surface.
The "summary" data is more naturally a field on `get_test_metrics` than a standalone tool, and
the per-package aggregation is cheap to compute conditionally.

### Option B: Add `package` filter or `mode` parameter to existing `get_test_coverage`

A `package: string` filter parameter on `archguard_get_test_coverage` would reduce response size
for focused queries. This was rejected because:

- It still requires the LLM to know a package name before calling the tool. Without a prior
  summary, the LLM cannot know which packages are interesting.
- The default call (no filter) still returns the full 400K payload.
- It preserves a tool whose default behaviour is broken and relies on the LLM always passing a
  filter — a fragile contract.

### Option C (chosen): Extend metrics + new entity drill-down + remove coverage tool

Preferred because:
- The `get_test_metrics` extension gives a navigational entry point (worst-covered packages) with
  a bounded, O(packages) response size.
- `get_entity_coverage` supports the natural follow-up ("show me coverage for X") with a
  guaranteed constant-size response (one entity at a time).
- Removing `get_test_coverage` eliminates the broken default path entirely rather than patching it.
- Net tool count stays at four (replacing one tool with one new tool).

---

## Open Questions

### Should `archguard_get_test_coverage` remain as a non-MCP internal API?

Yes. `QueryEngine.getTestAnalysis()` already exposes `TestAnalysis.coverageMap: CoverageLink[]`
and is used by internal consumers (`test-issue-detector.ts`, `test-coverage-renderer.ts`,
`test-output-writer.ts`). No changes to these internal paths are needed or proposed. The removal
is MCP-surface only.

### Should `PackageCoverage[]` be sorted ascending by `coverageRatio` (worst-covered first)?

Yes, ascending sort is the correct default. The primary use case for an LLM calling
`get_test_metrics` with `includePackageBreakdown: true` is to identify **gaps** in test coverage.
Presenting the most poorly-covered packages first means the LLM can read the first N entries to
get the most actionable signal without parsing the full list.

A reverse sort (best-covered first) would only be useful for confirming what is already well-
tested, which is a lower-priority query. If both orderings become needed, a `sortOrder` parameter
can be added later. Sorting ascending is a reasonable and opinionated default for the initial
implementation.

### What is the expected response size for `includePackageBreakdown: true`?

For a project with 2455 entities spread across, say, 40 packages, each `PackageCoverage` entry is
roughly 100–200 characters of JSON. The full `packageCoverage` array would be approximately
4,000–8,000 characters — a 50x reduction from the current 400K flat-array response.

### Should `getEntityCoverage` accept a partial name in addition to an exact entity ID?

Not in this proposal. Entity IDs are stable and exact (they are generated by the respective
language plugin's `generateEntityId()` function and stored in `arch.json`). LLMs can obtain an
exact ID from `archguard_find_entity` before calling `archguard_get_entity_coverage`. Supporting
fuzzy matching would complicate the return type (multiple results) and is out of scope.

---

## Implementation Checklist

- [ ] Add `PackageCoverage` interface to `src/types/extensions.ts`
- [ ] Add `getPackageCoverage()` method to `src/cli/query/query-engine.ts`
- [ ] Add `getEntityCoverage(entityId)` method to `src/cli/query/query-engine.ts`
- [ ] Update import line in `query-engine.ts` to include `PackageCoverage` and `TestFileInfo`
- [ ] Extend `archguard_get_test_metrics` handler with `includePackageBreakdown` parameter
- [ ] Register `archguard_get_entity_coverage` tool in `registerTestAnalysisTools()`
- [ ] Remove `archguard_get_test_coverage` `server.tool(...)` block from `test-analysis-tools.ts`
- [ ] Update file-level comment block in `test-analysis-tools.ts`
- [ ] Update `tests/unit/cli/mcp/test-analysis-mcp.test.ts`:
  - Remove the 3 test cases for `archguard_get_test_coverage`: "returns NOT_ANALYZED_MSG",
    "returns coverage map", and "accepts patternConfig without crashing"
  - Update the `it('registers four test analysis tools', ...)` block **in place** (do not delete
    the whole `it()` block): rename the description from "registers all four test analysis tools"
    to "registers four test analysis tools", and replace the
    `tools.has('archguard_get_test_coverage')` expectation with
    `tools.has('archguard_get_entity_coverage')`
  - Add tests for `includePackageBreakdown: true` on `archguard_get_test_metrics`
  - Add tests for `archguard_get_entity_coverage` (found entity, zero-coverage entity, unknown ID)
- [ ] Search `docs/` for `archguard_get_test_coverage` references and update them:
  - `docs/user-guide/mcp-usage.md` — has a dedicated `### archguard_get_test_coverage` section
    with 5 references; replace with `### archguard_get_entity_coverage` documentation and update
    `### archguard_get_test_metrics` to show the new `includePackageBreakdown` parameter
  - `docs/user-guide/architecture-checking-scenarios.md` — 1 reference to update
  - `docs/adr/006-mcp-tool-design-standards.md` (currently untracked) and any usage examples in
    `docs/plans/` and `docs/proposals/proposal-test-analysis.md` for remaining references
