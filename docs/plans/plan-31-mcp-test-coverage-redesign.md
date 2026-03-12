# Plan 31 — MCP Test Coverage Tools Redesign

## Overview

This plan implements the redesign described in `docs/proposals/proposal-mcp-test-coverage-redesign.md`. The existing `archguard_get_test_coverage` MCP tool returns the full `TestAnalysis.coverageMap: CoverageLink[]` — one entry per source entity — producing ~400 K characters of JSON for a mid-sized project (e.g. lmdeploy, ~2455 entities), which consistently overflows the MCP response token budget. The fix is three-part: (1) extend `archguard_get_test_metrics` with an opt-in `includePackageBreakdown` parameter backed by a new `QueryEngine.getPackageCoverage()` method; (2) add a focused `archguard_get_entity_coverage` tool backed by `QueryEngine.getEntityCoverage()`; (3) delete the `archguard_get_test_coverage` tool registration entirely, eliminating the unbounded response path from the MCP surface while leaving the underlying `TestAnalysis.coverageMap` data structure and all internal consumers untouched.

---

## Phase 1: QueryEngine additions (foundation)

### Stage 1.1 — Add `PackageCoverage` interface to `extensions.ts`

**Objective**: Introduce the typed return value for per-package coverage aggregation so that `query-engine.ts` and its tests can reference it without circular dependencies.

**Files changed**:
- `/home/yale/work/archguard/src/types/extensions.ts`

**TDD approach**:

There is no runnable test for a type-only addition, but TypeScript compilation is the gate. Write the interface first; Stage 1.2's failing test (which imports `PackageCoverage` from `@/types/extensions.js`) will fail to compile until this stage is complete.

**Implementation**:

Append the following block to `src/types/extensions.ts` immediately after the closing brace of `TestMetrics` (currently line 373):

```typescript
export interface PackageCoverage {
  /** Package path derived from entity sourceLocation.file, e.g. "lmdeploy/pytorch/models" */
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

**Acceptance criteria**:
- `npm run type-check` passes without error after adding the interface.
- `PackageCoverage` is importable from `@/types/extensions.js`.
- All 2787 existing tests still pass (`npm test`).

**Dependencies**: none.

---

### Stage 1.2 — Add `getPackageCoverage()` method to `QueryEngine`

**Objective**: Implement the per-package coverage aggregation query that will power the `includePackageBreakdown` path in the `archguard_get_test_metrics` MCP handler.

**Files changed**:
- `/home/yale/work/archguard/src/cli/query/query-engine.ts`
- `/home/yale/work/archguard/tests/unit/cli/query/query-engine.test.ts`

**TDD approach**:

Write the following failing test block in `query-engine.test.ts` (add `PackageCoverage` to the imports from `@/types/extensions.js` and add `TestAnalysis` to the imports as well) before touching `query-engine.ts`:

```typescript
// In query-engine.test.ts, add to imports:
// import type { PackageGraph, PackageCoverage } from '@/types/extensions.js';
// import type { TestAnalysis } from '@/types/extensions.js';

describe('getPackageCoverage', () => {
  function makeTestAnalysisArchJson(entities: Entity[], coverageMap: TestAnalysis['coverageMap']): ArchJSON {
    const testAnalysis: TestAnalysis = {
      version: '1.0',
      patternConfigSource: 'auto',
      testFiles: [
        {
          id: 'tests/foo.test.ts',
          filePath: '/ws/tests/foo.test.ts',
          frameworks: ['vitest'],
          testType: 'unit',
          testCaseCount: 2,
          assertionCount: 4,
          skipCount: 0,
          assertionDensity: 2.0,
          coveredEntityIds: entities.map(e => e.id),
        },
      ],
      coverageMap,
      issues: [],
      metrics: {
        totalTestFiles: 1,
        byType: { unit: 1, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
        entityCoverageRatio: 0.5,
        assertionDensity: 2.0,
        skipRatio: 0,
        issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
      },
    };
    return makeArchJson({ entities, extensions: { testAnalysis } });
  }

  it('returns empty array when no test analysis is present', () => {
    const engine = createEngine(baseArchJson);
    expect(engine.getPackageCoverage()).toEqual([]);
  });

  it('groups entities by directory and computes coverageRatio', () => {
    const entities = [
      makeEntity('e1', 'Foo', { sourceLocation: { file: 'src/a/foo.ts', startLine: 1, endLine: 10 } }),
      makeEntity('e2', 'Bar', { sourceLocation: { file: 'src/a/bar.ts', startLine: 1, endLine: 10 } }),
      makeEntity('e3', 'Baz', { sourceLocation: { file: 'src/b/baz.ts', startLine: 1, endLine: 10 } }),
    ];
    const coverageMap: TestAnalysis['coverageMap'] = [
      { sourceEntityId: 'e1', coveredByTestIds: ['tests/foo.test.ts'], coverageScore: 0.8 },
      { sourceEntityId: 'e2', coveredByTestIds: [], coverageScore: 0.0 },
      { sourceEntityId: 'e3', coveredByTestIds: ['tests/foo.test.ts'], coverageScore: 0.6 },
    ];
    const engine = createEngine(makeTestAnalysisArchJson(entities, coverageMap));
    const result = engine.getPackageCoverage();
    const pkgA = result.find(p => p.package === 'src/a');
    const pkgB = result.find(p => p.package === 'src/b');
    expect(pkgA).toBeDefined();
    expect(pkgA!.totalEntities).toBe(2);
    expect(pkgA!.coveredEntities).toBe(1);
    expect(pkgA!.coverageRatio).toBeCloseTo(0.5);
    expect(pkgB!.totalEntities).toBe(1);
    expect(pkgB!.coveredEntities).toBe(1);
    expect(pkgB!.coverageRatio).toBeCloseTo(1.0);
  });

  it('sorts ascending by coverageRatio (worst-covered first)', () => {
    const entities = [
      makeEntity('e1', 'A', { sourceLocation: { file: 'src/good/a.ts', startLine: 1, endLine: 5 } }),
      makeEntity('e2', 'B', { sourceLocation: { file: 'src/bad/b.ts', startLine: 1, endLine: 5 } }),
    ];
    const coverageMap: TestAnalysis['coverageMap'] = [
      { sourceEntityId: 'e1', coveredByTestIds: ['tests/a.test.ts'], coverageScore: 0.9 },
      { sourceEntityId: 'e2', coveredByTestIds: [], coverageScore: 0.0 },
    ];
    const engine = createEngine(makeTestAnalysisArchJson(entities, coverageMap));
    const result = engine.getPackageCoverage();
    expect(result[0].coverageRatio).toBeLessThanOrEqual(result[result.length - 1].coverageRatio);
  });

  it('accumulates testFileIds from all covered entities in the package', () => {
    const entities = [
      makeEntity('e1', 'A', { sourceLocation: { file: 'src/mod/a.ts', startLine: 1, endLine: 5 } }),
      makeEntity('e2', 'B', { sourceLocation: { file: 'src/mod/b.ts', startLine: 1, endLine: 5 } }),
    ];
    const coverageMap: TestAnalysis['coverageMap'] = [
      { sourceEntityId: 'e1', coveredByTestIds: ['tests/a.test.ts'], coverageScore: 0.7 },
      { sourceEntityId: 'e2', coveredByTestIds: ['tests/b.test.ts'], coverageScore: 0.5 },
    ];
    const engine = createEngine(makeTestAnalysisArchJson(entities, coverageMap));
    const result = engine.getPackageCoverage();
    const mod = result.find(p => p.package === 'src/mod')!;
    expect(mod.testFileIds).toContain('tests/a.test.ts');
    expect(mod.testFileIds).toContain('tests/b.test.ts');
    expect(mod.testFileIds).toHaveLength(2);
  });
});
```

These tests fail (method does not exist). Then implement `getPackageCoverage()` in `query-engine.ts` to make them pass.

**Implementation**:

1. Update the import line at line 11 of `query-engine.ts`:

   ```typescript
   import type { GoAtlasLayers, TsModuleGraph, TestAnalysis, PackageCoverage, TestFileInfo } from '@/types/extensions.js';
   ```

2. Add the `getPackageCoverage()` method to the `QueryEngine` class immediately after `hasTestAnalysis()` (currently ending at line 247), before `getPackageStats()` (currently starting at line 249):

   ```typescript
   /**
    * Aggregate CoverageLink[] into per-package buckets.
    *
    * Package is derived from the sourceLocation.file of each entity, relativised
    * to workspaceRoot. The directory component (path.dirname) is used as the
    * package key. Returns entries sorted ascending by coverageRatio (worst first).
    */
   getPackageCoverage(): PackageCoverage[] {
     const analysis = this.getTestAnalysis();
     if (!analysis) return [];

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

Note: `this.archJson` is declared `private` in the class. The method accesses it directly as other methods do (e.g. `getTestAnalysis()` accesses `this.archJson.extensions?.testAnalysis`). No visibility change is needed.

**Acceptance criteria**:
- All 4 new `getPackageCoverage` tests pass.
- `npm run type-check` passes.
- All existing 2787 tests still pass.

**Dependencies**: Stage 1.1 must be complete (`PackageCoverage` and `TestFileInfo` must be exported from `extensions.ts`; `TestFileInfo` is already exported at line 336, so only `PackageCoverage` is new).

---

### Stage 1.3 — Add `getEntityCoverage()` method to `QueryEngine`

**Objective**: Implement the single-entity coverage drill-down query that will back the new `archguard_get_entity_coverage` MCP tool.

**Files changed**:
- `/home/yale/work/archguard/src/cli/query/query-engine.ts`
- `/home/yale/work/archguard/tests/unit/cli/query/query-engine.test.ts`

**TDD approach**:

Write the following failing test block before implementing the method (reuse the `makeTestAnalysisArchJson` helper from Stage 1.2 tests if they are in the same `describe` scope, or define it locally):

```typescript
describe('getEntityCoverage', () => {
  const coveredEntity = makeEntity('entity-covered', 'Covered', {
    sourceLocation: { file: 'src/covered.ts', startLine: 1, endLine: 20 },
  });
  const uncoveredEntity = makeEntity('entity-uncovered', 'Uncovered', {
    sourceLocation: { file: 'src/uncovered.ts', startLine: 1, endLine: 10 },
  });

  const testAnalysis: TestAnalysis = {
    version: '1.0',
    patternConfigSource: 'auto',
    testFiles: [
      {
        id: 'tests/covered.test.ts',
        filePath: '/ws/tests/covered.test.ts',
        frameworks: ['vitest'],
        testType: 'unit',
        testCaseCount: 3,
        assertionCount: 9,
        skipCount: 0,
        assertionDensity: 3.0,
        coveredEntityIds: ['entity-covered'],
      },
    ],
    coverageMap: [
      { sourceEntityId: 'entity-covered', coveredByTestIds: ['tests/covered.test.ts'], coverageScore: 0.85 },
      { sourceEntityId: 'entity-uncovered', coveredByTestIds: [], coverageScore: 0.0 },
    ],
    issues: [],
    metrics: {
      totalTestFiles: 1,
      byType: { unit: 1, integration: 0, e2e: 0, performance: 0, debug: 0, unknown: 0 },
      entityCoverageRatio: 0.5,
      assertionDensity: 3.0,
      skipRatio: 0,
      issueCount: { zero_assertion: 0, orphan_test: 0, skip_accumulation: 0, assertion_poverty: 0 },
    },
  };

  function createEntityCoverageEngine(): QueryEngine {
    return createEngine(
      makeArchJson({
        entities: [coveredEntity, uncoveredEntity],
        extensions: { testAnalysis },
      })
    );
  }

  it('returns found=false with empty arrays when no test analysis is present', () => {
    const engine = createEngine(baseArchJson);
    const result = engine.getEntityCoverage('entity-covered');
    expect(result.found).toBe(false);
    expect(result.coverageScore).toBe(0);
    expect(result.coveredByTestIds).toEqual([]);
    expect(result.testFileDetails).toEqual([]);
  });

  it('returns found=true, coverageScore, and testFileDetails for a covered entity', () => {
    const engine = createEntityCoverageEngine();
    const result = engine.getEntityCoverage('entity-covered');
    expect(result.found).toBe(true);
    expect(result.entityId).toBe('entity-covered');
    expect(result.coverageScore).toBeCloseTo(0.85);
    expect(result.coveredByTestIds).toContain('tests/covered.test.ts');
    expect(result.testFileDetails).toHaveLength(1);
    expect(result.testFileDetails[0].id).toBe('tests/covered.test.ts');
    expect(result.testFileDetails[0].testType).toBe('unit');
    expect(result.testFileDetails[0].assertionCount).toBe(9);
    expect(result.testFileDetails[0].assertionDensity).toBeCloseTo(3.0);
  });

  it('returns found=true, coverageScore=0, empty testFileDetails for zero-coverage entity', () => {
    const engine = createEntityCoverageEngine();
    const result = engine.getEntityCoverage('entity-uncovered');
    expect(result.found).toBe(true);
    expect(result.coverageScore).toBe(0);
    expect(result.coveredByTestIds).toEqual([]);
    expect(result.testFileDetails).toEqual([]);
  });

  it('returns found=false for an entity ID not in the coverage map', () => {
    const engine = createEntityCoverageEngine();
    const result = engine.getEntityCoverage('entity-does-not-exist');
    expect(result.found).toBe(false);
    expect(result.coverageScore).toBe(0);
    expect(result.coveredByTestIds).toEqual([]);
    expect(result.testFileDetails).toEqual([]);
  });
});
```

These tests fail. Then add `getEntityCoverage()` to `query-engine.ts` to make them pass.

**Implementation**:

Add the `getEntityCoverage()` method immediately after `getPackageCoverage()` (after Stage 1.2 insertion), still before `getPackageStats()`:

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
    return { entityId, coverageScore: 0, coveredByTestIds: [], testFileDetails: [], found: false };
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

**Acceptance criteria**:
- All 4 new `getEntityCoverage` tests pass.
- `npm run type-check` passes.
- All existing tests (including Stage 1.2 additions) still pass.

**Dependencies**: Stage 1.1 (`PackageCoverage` and `TestFileInfo` exported), Stage 1.2 (import line already updated with `TestFileInfo`).

---

## Phase 2: MCP tool surface changes

### Stage 2.1 — Extend `archguard_get_test_metrics` with `includePackageBreakdown`

**Objective**: Expose the `getPackageCoverage()` result through the existing `archguard_get_test_metrics` tool via an optional boolean parameter, keeping response size bounded.

**Files changed**:
- `/home/yale/work/archguard/src/cli/mcp/tools/test-analysis-tools.ts`
- `/home/yale/work/archguard/tests/unit/cli/mcp/test-analysis-mcp.test.ts`

**TDD approach**:

Write the following failing tests in `test-analysis-mcp.test.ts` (inside the `'test analysis MCP tools — analysis present'` describe block, after the existing `archguard_get_test_metrics returns metrics` test):

```typescript
it('archguard_get_test_metrics without includePackageBreakdown does not include packageCoverage', async () => {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  const tools = collectTools(server);
  const cb = tools.get('archguard_get_test_metrics')!;
  const result = await cb({});
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.packageCoverage).toBeUndefined();
});

it('archguard_get_test_metrics with includePackageBreakdown: true appends packageCoverage array', async () => {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  const tools = collectTools(server);
  const cb = tools.get('archguard_get_test_metrics')!;
  const result = await cb({ includePackageBreakdown: true });
  const parsed = JSON.parse(result.content[0].text);
  expect(Array.isArray(parsed.packageCoverage)).toBe(true);
  // sampleAnalysis has one entity in src/foo.ts → package 'src'
  expect(parsed.packageCoverage.length).toBeGreaterThan(0);
  const entry = parsed.packageCoverage[0];
  expect(typeof entry.package).toBe('string');
  expect(typeof entry.totalEntities).toBe('number');
  expect(typeof entry.coveredEntities).toBe('number');
  expect(typeof entry.coverageRatio).toBe('number');
  expect(Array.isArray(entry.testFileIds)).toBe(true);
});

it('archguard_get_test_metrics with includePackageBreakdown: true still includes base metrics', async () => {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  const tools = collectTools(server);
  const cb = tools.get('archguard_get_test_metrics')!;
  const result = await cb({ includePackageBreakdown: true });
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.totalTestFiles).toBe(1);
  expect(parsed.assertionDensity).toBe(3.0);
});
```

Note: the `sampleAnalysis` fixture in the test file has `entity-1` with `sourceLocation: { file: 'src/foo.ts', ... }`, so `getPackageCoverage()` will produce one entry with `package: 'src'`.

These tests fail. Then update `test-analysis-tools.ts` to make them pass.

**Implementation**:

1. Update the `archguard_get_test_metrics` tool description string (line 245) to:

   ```typescript
   'Return test quality metrics: file counts by type, entity coverage ratio, assertion density, and issue counts. Pass includePackageBreakdown: true to append per-package coverage statistics sorted by worst-covered first. All metrics are static approximations. Call archguard_detect_test_patterns first.',
   ```

2. Update the schema object for `archguard_get_test_metrics` (lines 247–249) to add `includePackageBreakdown`:

   ```typescript
   {
     projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
     patternConfig: patternConfigSchema,
     includePackageBreakdown: z
       .boolean()
       .optional()
       .default(false)
       .describe(
         'When true, appends packageCoverage[] to the response: ' +
         'per-package entity count, covered count, and coverage ratio, ' +
         'sorted ascending by coverageRatio (worst-covered first).'
       ),
   },
   ```

3. Update the handler function signature and body (lines 250–260):

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

**Acceptance criteria**:
- All 3 new `archguard_get_test_metrics` tests pass.
- The existing `archguard_get_test_metrics returns metrics` test still passes (no regression).
- The existing `archguard_get_test_metrics accepts patternConfig without crashing` test still passes.
- `npm run type-check` passes.

**Dependencies**: Stage 1.2 (`getPackageCoverage()` must exist on `QueryEngine`).

---

### Stage 2.2 — Add `archguard_get_entity_coverage` tool

**Objective**: Register a new focused drill-down MCP tool that delegates to `QueryEngine.getEntityCoverage()` and returns a bounded constant-size response.

**Files changed**:
- `/home/yale/work/archguard/src/cli/mcp/tools/test-analysis-tools.ts`
- `/home/yale/work/archguard/tests/unit/cli/mcp/test-analysis-mcp.test.ts`

**TDD approach**:

Add the following failing tests to `test-analysis-mcp.test.ts` in the `'test analysis MCP tools — analysis present'` describe block. Note: `sampleAnalysis` (already defined at line 50 of the test file) has `entity-1` with `coverageScore: 0.9` and `coveredByTestIds: ['tests/unit/foo.test.ts']`.

```typescript
describe('archguard_get_entity_coverage', () => {
  it('returns found=true with coverage details for a covered entity', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_entity_coverage')!;
    const result = await cb({ entityId: 'entity-1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.found).toBe(true);
    expect(parsed.entityId).toBe('entity-1');
    expect(parsed.coverageScore).toBeCloseTo(0.9);
    expect(parsed.coveredByTestIds).toContain('tests/unit/foo.test.ts');
    expect(Array.isArray(parsed.testFileDetails)).toBe(true);
    expect(parsed.testFileDetails[0].id).toBe('tests/unit/foo.test.ts');
    expect(parsed.testFileDetails[0].testType).toBe('unit');
  });

  it('returns found=false for an unknown entity ID', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_entity_coverage')!;
    const result = await cb({ entityId: 'entity-does-not-exist' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.found).toBe(false);
    expect(parsed.coverageScore).toBe(0);
    expect(parsed.coveredByTestIds).toEqual([]);
    expect(parsed.testFileDetails).toEqual([]);
  });

  it('returns NOT_ANALYZED_MSG when no test analysis is present', async () => {
    loadEngineMock.mockResolvedValueOnce(createEngineWithoutAnalysis());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_get_entity_coverage')!;
    const result = await cb({ entityId: 'entity-1' });
    expect(result.content[0].text).toBe(NOT_ANALYZED_MSG);
  });
});
```

These tests fail (tool is not registered). Then add the `server.tool(...)` block to `test-analysis-tools.ts` to make them pass.

**Implementation**:

Add the following block to `registerTestAnalysisTools()` in `test-analysis-tools.ts` directly after the closing of the `archguard_get_test_metrics` block (after line 261):

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
  async ({ projectRoot, entityId }) => {
    try {
      const root = resolveRoot(projectRoot, defaultRoot);
      const engine = await loadEngine(path.join(root, '.archguard'));
      if (!engine.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
      return textResponse(JSON.stringify(engine.getEntityCoverage(entityId), null, 2));
    } catch (e: any) {
      return textResponse(`Error: ${e.message}`);
    }
  }
);
```

**Acceptance criteria**:
- All 3 new `archguard_get_entity_coverage` tests pass.
- All previously passing tests still pass.
- `npm run type-check` passes.

**Dependencies**: Stage 1.3 (`getEntityCoverage()` must exist on `QueryEngine`), Stage 2.1 (avoids merge conflicts in the same file).

---

### Stage 2.3 — Remove `archguard_get_test_coverage` tool

**Objective**: Delete the `archguard_get_test_coverage` `server.tool(...)` registration from `test-analysis-tools.ts` and update all affected tests and documentation.

**Files changed**:
- `/home/yale/work/archguard/src/cli/mcp/tools/test-analysis-tools.ts`
- `/home/yale/work/archguard/tests/unit/cli/mcp/test-analysis-mcp.test.ts`

**TDD approach**:

Before deleting the tool registration, update the test file first so the test suite reflects the intended post-deletion state. The test suite must pass after the test changes and tool deletion together.

**Test changes** (in `test-analysis-mcp.test.ts`):

1. **Delete** the following 3 test cases entirely (they test the tool being removed):

   - Line 144–150: `it('archguard_get_test_coverage returns NOT_ANALYZED_MSG', ...)` in the `'test analysis MCP tools — no analysis present'` describe block.
   - Line 185–193: `it('archguard_get_test_coverage returns coverage map', ...)` in the `'test analysis MCP tools — analysis present'` describe block.
   - Line 308–313: `it('archguard_get_test_coverage accepts patternConfig without crashing', ...)` in the `'test analysis MCP tools — analysis present'` describe block.

2. **Update in place** the `it('registers all four test analysis tools', ...)` test at line 269:
   - Rename the description to `'registers four test analysis tools'`.
   - Replace `tools.has('archguard_get_test_coverage')` with `tools.has('archguard_get_entity_coverage')`.

   After the change the test reads:

   ```typescript
   it('registers four test analysis tools', () => {
     const server = new McpServer({ name: 'test', version: '1.0.0' });
     const tools = collectTools(server);
     expect(tools.has('archguard_detect_test_patterns')).toBe(true);
     expect(tools.has('archguard_get_entity_coverage')).toBe(true);
     expect(tools.has('archguard_get_test_issues')).toBe(true);
     expect(tools.has('archguard_get_test_metrics')).toBe(true);
   });
   ```

**Tool deletion** (in `test-analysis-tools.ts`):

Delete lines 196–214 (the entire `server.tool('archguard_get_test_coverage', ...)` block including its closing `);`):

```typescript
  server.tool(
    'archguard_get_test_coverage',
    'Return per-entity coverage links inferred by static import-path matching ...',
    {
      projectRoot: z.string().optional().describe('Project root (default: server startup cwd)'),
      patternConfig: patternConfigSchema,
    },
    async ({ projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const engine = await loadEngine(path.join(root, '.archguard'));
        if (!engine.hasTestAnalysis()) return textResponse(NOT_ANALYZED_MSG);
        const analysis = engine.getTestAnalysis()!;
        return textResponse(JSON.stringify(analysis.coverageMap, null, 2));
      } catch (e: any) {
        return textResponse(`Error: ${e.message}`);
      }
    }
  );
```

**File-level comment update** (lines 1–9 of `test-analysis-tools.ts`):

Replace the existing four-tool list with the updated three+one list:

```typescript
/**
 * MCP tools for test system analysis.
 *
 * Four tools following the Pattern-First workflow:
 * 1. archguard_detect_test_patterns  — MUST be called first
 * 2. archguard_get_test_issues
 * 3. archguard_get_test_metrics      — pass includePackageBreakdown: true for per-package summary
 * 4. archguard_get_entity_coverage   — drill-down for a single entity
 */
```

**Acceptance criteria**:
- `npm test` passes with no failures. Test count decreases by 3 (the 3 deleted test cases) and increases by the tests added in Stages 2.1 and 2.2.
- `tools.has('archguard_get_test_coverage')` is false in the updated registration test.
- `tools.has('archguard_get_entity_coverage')` is true.
- `npm run type-check` passes.
- No internal consumers are changed: `src/analysis/test-issue-detector.ts`, `src/mermaid/test-coverage-renderer.ts`, and `src/cli/utils/test-output-writer.ts` continue to use `TestAnalysis.coverageMap` directly and are unaffected.

**Dependencies**: Stage 2.2 must be complete so that `archguard_get_entity_coverage` is registered before the registration test is updated to expect it.

---

## Phase 3: Test and documentation updates

### Stage 3.1 — Update `test-analysis-mcp.test.ts`

This stage is fully covered inline in Stages 2.1, 2.2, and 2.3 above. There are no additional test file changes beyond what those stages describe. The complete set of test mutations is:

| Location | Action | Description |
|---|---|---|
| `tests/unit/cli/query/query-engine.test.ts` | Add | +4 tests for `getPackageCoverage()` (Stage 1.2) |
| `tests/unit/cli/query/query-engine.test.ts` | Add | +4 tests for `getEntityCoverage()` (Stage 1.3) |
| Line 144–150 | Delete | `archguard_get_test_coverage returns NOT_ANALYZED_MSG` |
| Line 185–193 | Delete | `archguard_get_test_coverage returns coverage map` |
| Line 269–276 | Update in place | Rename to `'registers four test analysis tools'`; swap `archguard_get_test_coverage` → `archguard_get_entity_coverage` |
| Line 308–313 | Delete | `archguard_get_test_coverage accepts patternConfig without crashing` |
| After line 227 | Add | 3 new `archguard_get_test_metrics` / `includePackageBreakdown` tests (Stage 2.1) |
| New describe block | Add | 3 new `archguard_get_entity_coverage` tests (Stage 2.2) |

Final test count delta: −3 (deleted) + 3 (Stage 2.1) + 3 (Stage 2.2) = +3 net new tests.

**Acceptance criteria**: `npm test` passes; test count is 2787 + 4 (Stage 1.2) + 4 (Stage 1.3) + 3 (Stage 2.1) + 3 (Stage 2.2) − 3 (Stage 2.3 deletions) = **2798** total passing tests.

**Dependencies**: All of Phases 1 and 2.

---

### Stage 3.2 — Update docs

**Objective**: Remove all references to `archguard_get_test_coverage` from user-facing documentation and add documentation for the two new API additions.

**Files changed** (check each for references using `grep -r archguard_get_test_coverage docs/`):

- `docs/user-guide/mcp-usage.md` — has a dedicated `### archguard_get_test_coverage` section with approximately 5 references; replace with `### archguard_get_entity_coverage` documentation and update `### archguard_get_test_metrics` to show the new `includePackageBreakdown` parameter.
- `docs/user-guide/architecture-checking-scenarios.md` — 1 reference to update.
- `docs/adr/006-mcp-tool-design-standards.md` (currently untracked) — check for references and update.
- `docs/proposals/proposal-test-analysis.md` — check for references; update or annotate as superseded.
- Any files under `docs/plans/` — check for references and update.

**Acceptance criteria**:
- `grep -r 'archguard_get_test_coverage' docs/` returns no results.
- `grep -r 'archguard_get_entity_coverage' docs/` returns at least one result (the new documentation).
- `grep -r 'includePackageBreakdown' docs/` returns at least one result in the metrics tool documentation.

**Dependencies**: Stage 2.3.

---

## Execution order

```
Stage 1.1  →  Stage 1.2  →  Stage 1.3
                                      \
                                       Stage 2.1  →  Stage 2.2  →  Stage 2.3  →  Stage 3.2
```

Stage 3.1 is spread across Stages 2.1, 2.2, and 2.3 and has no separate step.

Each stage is independently compilable and testable. A CI run after each stage must show zero failures before the next stage begins.
