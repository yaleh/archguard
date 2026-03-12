# Plan 09 — Test System Analysis

> Branch: `feat/test-analysis`
> Proposal: `docs/proposals/proposal-test-analysis.md` (rev 2.2)
> Status: Draft
>
> **Note (2026-03-12)**: The `archguard_get_test_coverage` MCP tool defined in Phase C (Component 5) of this plan has been superseded by `archguard_get_entity_coverage` (see `docs/plans/plan-31-mcp-test-coverage-redesign.md`). The underlying `TestAnalysis.coverageMap` data structure is unchanged. All other components of this plan remain in effect.

---

## Overview

Add static test-system analysis capability to ArchGuard. Using a two-phase cooperative
architecture (Proposal Method C), ArchGuard extracts test structure from source code
without executing tests, producing test coverage maps, quality issue lists, and four
MCP query tools.

The design follows the same extension pattern as the existing Go Atlas (`goAtlas`) and
TypeScript analysis (`tsAnalysis`) slots defined in ADR-002. Test analysis output is
stored in `ArchJSONExtensions.testAnalysis` and is **per-language** — TypeScript and
Go analyses live in their respective `ArchJSON` objects and are not merged.

### Key design constraints carried forward from the proposal

- **Pattern-First**: AI callers must first invoke `archguard_detect_test_patterns` to
  obtain a `TestPatternConfig`, review the returned `notes`, then pass the (optionally
  corrected) config to analysis tools. Every analysis tool description must include
  this instruction.
- **Behaviour-first `testType`**: `assertionCount === 0 && testCaseCount > 0` →
  `'debug'`. This override happens in `TestAnalyzer`, not the plugin layer.
- **`micromatch` as direct dependency**: `"micromatch": "^4.0.8"` in `dependencies`,
  `"@types/micromatch"` in `devDependencies`. Must not rely on transitive presence.
- **Go workspace-wide scan**: When `plugin.metadata.fileExtensions.includes('.go')`,
  `TestAnalyzer.discoverTestFiles` scans `workspaceRoot` recursively instead of the
  default candidate-directory list, because `_test.go` files live beside source files.
- **Cache key**: `hash(sourceFiles) + hash(testFiles) + hash(patternConfig ?? 'auto')`.
- **`TEST_ANALYSIS_VERSION = '1.0'`** constant defined in `src/types/extensions.ts` and
  re-exported from `src/types/index.ts`, following the same pattern as
  `GO_ATLAS_EXTENSION_VERSION`.
- **MCP tools use Zod schemas**, not bare JSON Schema objects. `patternConfig` is
  `z.object({...}).optional()`.
- **`resolveImportedEntityIds`** is a method of `TestAnalyzer` (private), called inside
  `buildTestFileInfos` to populate `TestFileInfo.coveredEntityIds`.

### Delivery phases

| Phase | Components | Gate |
|-------|-----------|------|
| **A** | Component 2 (ArchJSON types) + Component 1 (interface extension) | Type-check passes; existing tests still pass |
| **B** | Component 3 — `TestAnalyzer`, `TestCoverageMapper`, `TestIssueDetector` | Unit tests pass; `TestAnalyzer` produces correct `TestAnalysis` from fixture data |
| **C** | Component 4 (CLI flags + cache key) + Component 5 (MCP tools) | E2E: `--include-tests` generates `test/issues.md` + `test/metrics.md`; MCP tools queryable |
| **D** | Component 6 (Coverage heatmap) | `test/coverage-heatmap.md` generated; four buckets correct |

---

## Phase A — Core Infrastructure (Components 1 + 2)

Phase A is fully specified. It must be completed before any other phase begins.

### Objectives

1. Add `TestPatternConfig`, `DetectedTestPatterns`, `TestAnalysis`, `TestFileInfo`,
   `CoverageLink`, `TestIssue`, `TestMetrics` to `src/types/extensions.ts`.
2. Add `testAnalysis?` slot to `ArchJSONExtensions`.
3. Export `TEST_ANALYSIS_VERSION` constant from `src/types/extensions.ts` and
   re-export it from `src/types/index.ts`.
4. Add `RawTestCase`, `RawTestFile` types to `src/core/interfaces/language-plugin.ts`.
5. Add optional `isTestFile?()` and `extractTestStructure?()` methods to
   `ILanguagePlugin`.
6. Add `testStructureExtraction?: boolean` to `PluginCapabilities`.
7. Add `micromatch` and `@types/micromatch` to `package.json`.
8. Write the Phase A test file; verify type-check passes.

### Stage A-0 — Add path aliases for `@/core` and `@/analysis`

**Add explicit path aliases for `@/core` and `@/analysis` to both `vitest.config.ts`
and `tsconfig.json` before writing any other code.**

**`vitest.config.ts`** — add two entries to the `resolve.alias` object:

```typescript
'@/core': resolve(__dirname, './src/core'),
'@/analysis': resolve(__dirname, './src/analysis'),
```

So the full alias block becomes:

```typescript
resolve: {
  alias: {
    '@': resolve(__dirname, './src'),
    '@/parser': resolve(__dirname, './src/parser'),
    '@/generator': resolve(__dirname, './src/generator'),
    '@/cli': resolve(__dirname, './src/cli'),
    '@/types': resolve(__dirname, './src/types'),
    '@/utils': resolve(__dirname, './src/utils'),
    '@/ai': resolve(__dirname, './src/ai'),
    '@/core': resolve(__dirname, './src/core'),       // NEW (Stage A-0)
    '@/analysis': resolve(__dirname, './src/analysis'), // NEW (Stage A-0)
  }
}
```

**`tsconfig.json`** — add two entries to the `paths` object:

```json
"@/core/*": ["src/core/*"],
"@/analysis/*": ["src/analysis/*"]
```

So the full paths block becomes:

```json
"paths": {
  "@/*": ["src/*"],
  "@/parser/*": ["src/parser/*"],
  "@/generator/*": ["src/generator/*"],
  "@/cli/*": ["src/cli/*"],
  "@/types/*": ["src/types/*"],
  "@/utils/*": ["src/utils/*"],
  "@/ai/*": ["src/ai/*"],
  "@/core/*": ["src/core/*"],
  "@/analysis/*": ["src/analysis/*"]
}
```

**Verification test**: Add one import in the Phase A test file that exercises the
`@/core/...` path to confirm resolution at test-run time:

```typescript
// In tests/unit/types/test-analysis-types.test.ts
import type { ILanguagePlugin } from '@/core/interfaces/language-plugin.js';

it('ILanguagePlugin is importable via @/core alias', () => {
  // compile-time check only — no runtime assertion needed
  const _: ILanguagePlugin | undefined = undefined;
  expect(true).toBe(true);
});
```

### Stage A-1 — ArchJSON extension types (TDD)

**Write failing tests first**, then implement.

#### Test files

Primary type-export tests belong in:

`tests/unit/types/test-analysis-types.test.ts`

Interface behaviour tests (separate file):

`tests/unit/core/interfaces/language-plugin-test-extension.test.ts`

**`tests/unit/types/test-analysis-types.test.ts`** — type export tests (all must fail
before implementation):

```typescript
// Test: TEST_ANALYSIS_VERSION is exported from src/types/index.ts
import { TEST_ANALYSIS_VERSION } from '@/types/index.js';
it('TEST_ANALYSIS_VERSION equals "1.0"', () => {
  expect(TEST_ANALYSIS_VERSION).toBe('1.0');
});

// Test: ArchJSONExtensions accepts testAnalysis slot
import type { ArchJSONExtensions, TestAnalysis } from '@/types/extensions.js';
it('ArchJSONExtensions.testAnalysis is optional', () => {
  const ext: ArchJSONExtensions = {};       // must compile without testAnalysis
  const ext2: ArchJSONExtensions = { testAnalysis: undefined };  // must compile
});

// Test: TestFileInfo.testType includes 'debug'
import type { TestFileInfo } from '@/types/extensions.js';
it('TestFileInfo.testType union includes "debug"', () => {
  const t: TestFileInfo['testType'] = 'debug';
  expect(t).toBe('debug');
});

// Test: TestIssue.type union covers all four issue types
import type { TestIssue } from '@/types/extensions.js';
it('TestIssue.type union covers all four types', () => {
  const types: Array<TestIssue['type']> = [
    'zero_assertion', 'orphan_test', 'skip_accumulation', 'assertion_poverty'
  ];
  expect(types).toHaveLength(4);
});

// Test: TestPatternConfig is structurally assignable with no fields
import type { TestPatternConfig } from '@/types/extensions.js';
it('TestPatternConfig can be empty object', () => {
  const cfg: TestPatternConfig = {};
  expect(cfg).toBeDefined();
});

// Test: @/core alias resolves correctly (Stage A-0 verification)
import type { ILanguagePlugin } from '@/core/interfaces/language-plugin.js';
it('ILanguagePlugin is importable via @/core alias', () => {
  const _: ILanguagePlugin | undefined = undefined;
  expect(true).toBe(true);
});
```

#### File changes for Stage A-1

**`src/types/extensions.ts`** — append after the `TsModuleCycle` block:

```typescript
// ========== Test Analysis Extension ==========

export const TEST_ANALYSIS_VERSION = '1.0';

export interface TestPatternConfig {
  assertionPatterns?: string[];
  testCasePatterns?: string[];
  skipPatterns?: string[];
  testFileGlobs?: string[];
  typeClassificationRules?: Array<{
    pathPattern: string;
    type: 'unit' | 'integration' | 'e2e' | 'performance';
  }>;
}

export interface DetectedTestPatterns {
  detectedFrameworks: Array<{
    name: string;
    confidence: 'high' | 'medium' | 'low';
    evidenceFiles: string[];
  }>;
  suggestedPatternConfig: TestPatternConfig;
  notes: string[];
}

export interface TestAnalysis {
  version: string;
  patternConfigSource: 'auto' | 'user';
  testFiles: TestFileInfo[];
  coverageMap: CoverageLink[];
  issues: TestIssue[];
  metrics: TestMetrics;
}

export interface TestFileInfo {
  id: string;
  filePath: string;
  frameworks: string[];
  testType: 'unit' | 'integration' | 'e2e' | 'performance' | 'debug' | 'unknown';
  testCaseCount: number;
  assertionCount: number;
  skipCount: number;
  assertionDensity: number;
  coveredEntityIds: string[];
}

export interface CoverageLink {
  sourceEntityId: string;
  coveredByTestIds: string[];
  coverageScore: number;
}

export interface TestIssue {
  type:
    | 'zero_assertion'
    | 'orphan_test'
    | 'skip_accumulation'
    | 'assertion_poverty';
  severity: 'warning' | 'info';
  testFileId: string;
  message: string;
  suggestion?: string;
}

export interface TestMetrics {
  totalTestFiles: number;
  byType: Record<TestFileInfo['testType'], number>;
  entityCoverageRatio: number;
  assertionDensity: number;
  skipRatio: number;
  issueCount: Record<TestIssue['type'], number>;
}
```

**`src/types/extensions.ts`** — update `ArchJSONExtensions`:

```typescript
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;
  testAnalysis?: TestAnalysis;  // NEW (Phase A)
}
```

**`src/types/index.ts`** — add re-export alongside `GO_ATLAS_EXTENSION_VERSION`:

```typescript
export { GO_ATLAS_EXTENSION_VERSION, TEST_ANALYSIS_VERSION, TS_ANALYSIS_EXTENSION_VERSION } from './extensions.js';
```

Also add `TS_ANALYSIS_EXTENSION_VERSION` to the re-export list (it is currently missing
despite being defined in `extensions.ts`). The combined version-constant export line must
include all three: `GO_ATLAS_EXTENSION_VERSION`, `TEST_ANALYSIS_VERSION`, and
`TS_ANALYSIS_EXTENSION_VERSION`.

Also add to the named type exports block:

```typescript
export type {
  // ... existing exports ...
  TestPatternConfig,
  DetectedTestPatterns,
  TestAnalysis,
  TestFileInfo,
  CoverageLink,
  TestIssue,
  TestMetrics,
} from './extensions.js';
```

### Stage A-2 — ILanguagePlugin interface extension (TDD)

#### File changes

**`src/core/interfaces/language-plugin.ts`**

Add import at top:

```typescript
import type { TestPatternConfig } from '@/types/extensions.js';
```

Add new types before `PluginCapabilities`:

```typescript
/**
 * A single test case's raw structure (plugin layer output).
 */
export interface RawTestCase {
  /** Test name from the first argument of it()/test()/func Test...(). */
  name: string;
  /** True when the case is marked skip/todo/xtest/t.Skip. */
  isSkipped: boolean;
  /**
   * Static lower-bound count of assertion calls matching patternConfig.assertionPatterns.
   * Custom helpers not covered by patterns are not counted.
   */
  assertionCount: number;
}

/**
 * A test file's raw structure (plugin layer output).
 */
export interface RawTestFile {
  filePath: string;
  /** Detected test frameworks; may be multiple (e.g. ['vitest', 'playwright']). */
  frameworks: string[];
  /**
   * Plugin's path-based type hint.
   * TestAnalyzer applies behaviour-first override (assertionCount === 0 → 'debug').
   * Note: 'debug' is intentionally absent — it is only assigned by TestAnalyzer.
   */
  testTypeHint: 'unit' | 'integration' | 'e2e' | 'performance' | 'unknown';
  testCases: RawTestCase[];
  /** Absolute paths of project-internal source files imported by this test file. */
  importedSourceFiles: string[];
}
```

Update `PluginCapabilities`:

```typescript
export interface PluginCapabilities {
  singleFileParsing: boolean;
  incrementalParsing: boolean;
  dependencyExtraction: boolean;
  typeInference: boolean;
  /**
   * Whether the plugin implements isTestFile() and extractTestStructure().
   * Defaults to false for existing plugins that do not add these methods.
   */
  testStructureExtraction?: boolean;
}
```

Add optional methods to `ILanguagePlugin` (after `readonly validator?`):

```typescript
/**
 * Determine whether a given file path is a test file.
 *
 * When patternConfig.testFileGlobs is provided, those globs take precedence.
 * Otherwise the plugin uses its built-in language defaults:
 *   TypeScript: /\.(test|spec)\.(ts|tsx|js|jsx)$/
 *   Go: /_test\.go$/
 *
 * Uses micromatch for glob matching.
 */
isTestFile?(filePath: string, patternConfig?: TestPatternConfig): boolean;

/**
 * Extract raw test structure from a single test file (pure static analysis).
 *
 * Requirements:
 * - Must not execute any code.
 * - When patternConfig is provided, use its assertionPatterns / testCasePatterns /
 *   skipPatterns instead of built-in defaults.
 * - importedSourceFiles must contain only project-internal absolute paths
 *   (exclude node_modules, vendor).
 * - Return null if the file cannot be parsed; TestAnalyzer will skip it.
 *
 * @param filePath     Absolute path to the test file.
 * @param code         File content (avoid re-reading from disk).
 * @param patternConfig Optional project-specific patterns from the AI caller.
 */
extractTestStructure?(
  filePath: string,
  code: string,
  patternConfig?: TestPatternConfig
): RawTestFile | null;
```

#### Tests for Stage A-2

Add to `tests/unit/core/interfaces/language-plugin-test-extension.test.ts`:

```typescript
import type { ILanguagePlugin, RawTestFile, RawTestCase } from '@/core/interfaces/language-plugin.js';

// Test: RawTestFile.testTypeHint does NOT include 'debug'
it('RawTestFile.testTypeHint union does not include "debug"', () => {
  // This is a compile-time check: the next line must compile.
  const hint: RawTestFile['testTypeHint'] = 'unknown';
  expect(['unit','integration','e2e','performance','unknown']).toContain(hint);
});

// Test: ILanguagePlugin methods are optional (existing mock still assignable)
it('ILanguagePlugin without test methods is still valid', () => {
  const minimal: Partial<ILanguagePlugin> = {
    metadata: {} as any,
    initialize: async () => {},
    canHandle: () => false,
    dispose: async () => {},
    supportedLevels: [],
    parseCode: () => ({} as any),
    parseProject: async () => ({} as any),
  };
  expect(minimal.isTestFile).toBeUndefined();
  expect(minimal.extractTestStructure).toBeUndefined();
});

// Test: PluginCapabilities.testStructureExtraction is optional
import type { PluginCapabilities } from '@/core/interfaces/language-plugin.js';
it('PluginCapabilities without testStructureExtraction is valid', () => {
  const caps: PluginCapabilities = {
    singleFileParsing: true,
    incrementalParsing: false,
    dependencyExtraction: false,
    typeInference: false,
  };
  expect(caps.testStructureExtraction).toBeUndefined();
});
```

### Stage A-3 — package.json dependency (no tests required)

Edit `package.json`:

- Add `"micromatch": "^4.0.8"` to `dependencies` (alphabetical order, after `isomorphic-mermaid`).
- Add `"@types/micromatch": "^4.0.0"` to `devDependencies` (after `@types/node`).

Run `npm install` to update `package-lock.json`.

### Phase A acceptance criteria

- `npm run type-check` passes with zero errors.
- `npm test` passes all pre-existing tests (no regression).
- The new test file `tests/unit/types/test-analysis-types.test.ts` passes all assertions
  (including the `@/core` alias verification import).
- The interface test file `tests/unit/core/interfaces/language-plugin-test-extension.test.ts`
  passes all assertions.
- `TEST_ANALYSIS_VERSION` is importable from `@/types/index.js`.
- `ArchJSONExtensions` accepts `{ testAnalysis: undefined }` and `{}` without type
  errors.
- `RawTestFile['testTypeHint']` does not include `'debug'`.
- `PluginCapabilities` without `testStructureExtraction` is assignable to the interface.

### Phase A dependencies

None. This phase has no external dependencies.

---

## Phase B — TestAnalyzer Layer (Component 3)

### Objectives

- Create `src/analysis/test-analyzer.ts` — `TestAnalyzer` class, main two-phase
  coordinator. Includes `buildTestFileInfos` (behaviour-first `testType` classification)
  and private `resolveImportedEntityIds` method. For Go plugins (detected via
  `plugin.metadata.fileExtensions.includes('.go')`), `discoverTestFiles` scans the
  entire `workspaceRoot` recursively.
- Create `src/analysis/test-coverage-mapper.ts` — `TestCoverageMapper` class with two
  mapping layers: import analysis (confidence weight 0.85) and path-convention matching
  (confidence weight 0.6).
- Create `src/analysis/test-issue-detector.ts` — `TestIssueDetector` class detecting
  four issue types: `zero_assertion`, `orphan_test`, `skip_accumulation`,
  `assertion_poverty`. The `debug` test type is exempt from `orphan_test` detection.
- Implement `isTestFile()` and `extractTestStructure()` on `TypeScriptPlugin`
  (`src/plugins/typescript/index.ts`) and `GoPlugin` (`src/plugins/golang/index.ts`).
- Implement stubs on `src/plugins/java/index.ts`, `src/plugins/python/index.ts`, and
  `src/plugins/cpp/index.ts`. Stub behaviour: `isTestFile()` returns `false` (never
  `null`); `extractTestStructure()` returns `null`. Neither method throws.
- Write unit tests:
  - `tests/unit/analysis/test-analyzer.test.ts`
  - `tests/unit/analysis/test-coverage-mapper.test.ts`
  - `tests/unit/analysis/test-issue-detector.test.ts`

### Go test file discovery — important note

Go test file discovery MUST scan `workspaceRoot` independently using a glob for
`**/*_test.go`, because `GoPlugin.parseProject()` excludes test files by default
(`excludeTests: true`). `TestAnalyzer.discoverTestFiles()` for Go bypasses the plugin's
`parseProject` filter and directly globs for `_test.go` files from `workspaceRoot`.
Use `globby(workspaceRoot + '/**/*_test.go', { onlyFiles: true, absolute: true })` —
`globby` is already in the project's dependencies.
This is the only correct approach — do not call `GoPlugin.parseProject()` with modified
options as a workaround.

### TestCoverageMapper — `resolveImportedEntityIds` normalization

In `TestCoverageMapper.resolveImportedEntityIds`, normalize both `importedSourceFiles`
entries and `entity.sourceLocation.file` to paths relative to `workspaceRoot` using
`path.relative(workspaceRoot, path)` before comparing with `===`. This ensures that
absolute paths from the plugin layer match the relative paths stored in ArchJSON entity
source locations regardless of how the project root is expressed.

### Dependencies

Phase A must be complete.

### Phase B Acceptance Criteria

1. `TestAnalyzer.analyze()` produces `TestAnalysis` with correct `metrics.totalTestFiles`
   count from a 3-file fixture (i.e. `metrics.totalTestFiles === 3`).
2. TypeScript plugin's `extractTestStructure()` correctly counts `describe`/`it`/`test`
   assertions via regex from fixture source.
3. Go workspace-wide scan discovers all `_test.go` files from `workspaceRoot`
   regardless of `GoPlugin.parseProject()` exclusions — verified by a test that places
   `_test.go` files beside source files and confirms they are discovered.
4. Zero-assertion test files (where `assertionCount === 0 && testCaseCount > 0`) are
   classified as `testType: 'debug'`, not `'unknown'`.
5. Java/Python/C++ plugin stubs: `isTestFile()` returns `false`, `extractTestStructure()`
   returns `null`, without throwing.

---

## Phase C — CLI + MCP Integration (Components 4 + 5)

### Objectives

- Add `--include-tests` and `--tests-only` CLI flags to
  `src/cli/commands/analyze.ts`.
- Update `src/types/config.ts` to add `includeTests?: boolean` and
  `testsOnly?: boolean` to `CLIOptions`.
- Update `src/cli/analyze/run-analysis.ts` to invoke `TestAnalyzer.analyze()` when
  either flag is set. The concrete integration path is:
  1. `run-analysis.ts` calls `DiagramProcessor.processAll()`, which now exposes
     `getLastArchJson(): ArchJSON | null` returning the ArchJSON from the diagram scope
     whose `role === 'primary'` (i.e., the first scope group with a `primary` role,
     which is the main parsed ArchJSON for the project). If no primary role exists,
     return the first successfully parsed ArchJSON. Store it internally as
     `private _lastArchJson: ArchJSON | null = null` updated once (on first assignment)
     inside `processAll()`.
  2. After `processAll()` returns, `run-analysis.ts` calls
     `processor.getLastArchJson()` to obtain `archJson`.
  3. If `CLIOptions.includeTests || CLIOptions.testsOnly`, `run-analysis.ts` calls
     `TestAnalyzer.analyze(archJson, plugin, opts)`.
  4. The result is attached to `archJson.extensions.testAnalysis`.
  - When `--tests-only` is set, add `loadCachedTestAnalysis(compositeKey: string): TestAnalysis | null`
    to `CacheManager`. Cache storage location: `<cacheDir>/test-analysis-<compositeKey>.json`.
    In `run-analysis.ts`, when `testsOnly` is set, call `loadCachedTestAnalysis(compositeKey)`
    before calling `TestAnalyzer.analyze()` — if found, skip `DiagramProcessor.processAll()`
    entirely.
- Create `src/cli/utils/test-output-writer.ts` — writes `test/issues.md` and
  `test/metrics.md` under the configured output directory.
- Update `src/cli/cache-manager.ts` to include test file hashes and `patternConfig`
  hash in the cache key. New method `getCompositeKey(files: string[], configBlob: string): string`.
  Also add `loadCachedTestAnalysis(compositeKey: string): TestAnalysis | null` with
  cache storage at `<cacheDir>/test-analysis-<compositeKey>.json`.
- Create directory `src/cli/mcp/tools/` (new subdirectory). New file
  `src/cli/mcp/tools/test-analysis-tools.ts` — exports
  `registerTestAnalysisTools(server: McpServer, defaultRoot: string): void` which
  registers all four tools using Zod schemas:
  `archguard_detect_test_patterns`, `archguard_get_test_coverage`,
  `archguard_get_test_issues`, `archguard_get_test_metrics`. The `patternConfig`
  parameter uses `z.object({...}).optional()`. When `hasTestAnalysis()` returns false,
  all four tools must return a descriptive error via `textResponse()`:
  `'No test analysis data found. Run \`archguard_analyze\` with \`includeTests: true\` first.'`
- In `createMcpServer()` in `src/cli/mcp/mcp-server.ts`, call
  `registerTestAnalysisTools(server, defaultRoot)` after the existing `registerTools()`
  and `registerAnalyzeTool()` calls. All four tools use the stateless pattern
  (`loadEngine` per call, reading `archJson.extensions.testAnalysis`).
- Update `.archguard/index.md` generation to include links to `test/` outputs.
- Write unit tests:
  - `tests/unit/cli/commands/analyze.test.ts` — `--include-tests` option parsing
  - `tests/unit/cli/cache-manager.test.ts` — `patternConfig` change invalidates cache
  - `tests/unit/cli/mcp/mcp-server.test.ts` — four new tools callable

### Dependencies

Phase B must be complete.

### Phase C Acceptance Criteria

1. `npm run build` succeeds; `npm run type-check` passes with zero errors.
2. `node dist/cli/index.js analyze -s ./tests/fixtures --include-tests` generates
   `test/issues.md` and `test/metrics.md` in the output directory.
3. `node dist/cli/index.js analyze --tests-only` loads cached ArchJSON and runs
   `TestAnalyzer` without re-parsing source files.
4. All four MCP tools (`archguard_detect_test_patterns`, `archguard_get_test_coverage`,
   `archguard_get_test_issues`, `archguard_get_test_metrics`) respond without error when
   `archGuardRoot` points to a valid analyzed project.
5. `CLIOptions.includeTests` and `CLIOptions.testsOnly` are present in the type
   definition in `src/types/config.ts`.

---

## Phase D — Coverage Heatmap (Component 6)

### Objectives

- Create `src/mermaid/test-coverage-renderer.ts` — generates a four-bucket Mermaid
  `graph TD` diagram: "Well Tested (score ≥ 0.7)", "Partially Tested (0.3 ≤ score < 0.7)",
  "Not Tested (score < 0.3)", "Debug Only (zero assertions)".
- Add `generateTestCoverageHeatmap()` to
  `src/cli/processors/diagram-processor.ts`.
- Emit `test/coverage-heatmap.md` to the output directory.
- Write unit tests:
  - `tests/unit/mermaid/test-coverage-renderer.test.ts` — four-bucket thresholds,
    node label format, truncation of oversized buckets.

**Call sequence**: `generateTestCoverageHeatmap()` is NOT called inside
`DiagramProcessor.processAll()`. Instead, it is called from `run-analysis.ts` (or a
dedicated `DiagramProcessor.analyzeTests()` method) after `TestAnalyzer.analyze()`
completes and `testAnalysis` is available. This ensures the heatmap always reflects the
freshly computed `TestAnalysis` rather than stale or partial data.

### Dependencies

Phase C must be complete. This phase may be deferred or iterated independently after
Phase C ships.

---

## Summary of all file changes

### Phase A

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Add `TEST_ANALYSIS_VERSION`, `TestPatternConfig`, `DetectedTestPatterns`, `TestAnalysis`, `TestFileInfo`, `CoverageLink`, `TestIssue`, `TestMetrics`; add `testAnalysis?` to `ArchJSONExtensions` |
| `src/types/index.ts` | Re-export `TEST_ANALYSIS_VERSION` and new types from `extensions.js`; also add `TS_ANALYSIS_EXTENSION_VERSION` to the version-constant re-export (currently missing) |
| `src/core/interfaces/language-plugin.ts` | Add `RawTestCase`, `RawTestFile`; add `testStructureExtraction?` to `PluginCapabilities`; add `isTestFile?()` and `extractTestStructure?()` to `ILanguagePlugin`; import `TestPatternConfig` |
| `package.json` | Add `micromatch@^4.0.8` to `dependencies`; add `@types/micromatch` to `devDependencies` |
| `vitest.config.ts` | Add `'@/core': resolve(__dirname, './src/core')` and `'@/analysis': resolve(__dirname, './src/analysis')` to `resolve.alias` |
| `tsconfig.json` | Add `"@/core/*": ["src/core/*"]` and `"@/analysis/*": ["src/analysis/*"]` to `paths` |
| `tests/unit/types/test-analysis-types.test.ts` | New test file — primary type-export tests (TDD — written before implementation) |
| `tests/unit/core/interfaces/language-plugin-test-extension.test.ts` | New test file — interface behaviour tests (TDD — written before implementation) |

### Phase B

| File | Change |
|------|--------|
| `src/analysis/test-analyzer.ts` | New file: `TestAnalyzer` class |
| `src/analysis/test-coverage-mapper.ts` | New file: `TestCoverageMapper` class; `resolveImportedEntityIds` normalizes paths to `workspaceRoot`-relative before comparing |
| `src/analysis/test-issue-detector.ts` | New file: `TestIssueDetector` class |
| `src/plugins/typescript/index.ts` | Implement `isTestFile()` and `extractTestStructure()` |
| `src/plugins/golang/index.ts` | Implement `isTestFile()` and `extractTestStructure()`; `discoverTestFiles` uses `globby(workspaceRoot + '/**/*_test.go', { onlyFiles: true, absolute: true })` |
| `src/plugins/java/index.ts` | Stub: `isTestFile()` returns `false`; `extractTestStructure()` returns `null`; neither throws |
| `src/plugins/python/index.ts` | Same stubs as Java |
| `src/plugins/cpp/index.ts` | Same stubs; test file patterns for reference: `*_test.{cpp,cc}`, `*Test.cpp`, `*_test.h` |
| `tests/unit/analysis/test-analyzer.test.ts` | New: behaviour-first `testType`; `patternConfig` override; Go workspace-wide scan |
| `tests/unit/analysis/test-coverage-mapper.test.ts` | New: import-layer, path-layer, score accumulation |
| `tests/unit/analysis/test-issue-detector.test.ts` | New: four issue types; debug-type orphan exemption |

### Phase C

| File | Change |
|------|--------|
| `src/cli/commands/analyze.ts` | Add `--include-tests`, `--tests-only` options |
| `src/types/config.ts` | Add `includeTests?: boolean` and `testsOnly?: boolean` to `CLIOptions` |
| `src/cli/analyze/run-analysis.ts` | Call `processor.getLastArchJson()` after `processAll()`; call `loadCachedTestAnalysis(compositeKey)` when `testsOnly` set (skip `processAll()` on cache hit); call `TestAnalyzer.analyze(archJson, plugin, opts)` when flags set; attach result to `archJson.extensions.testAnalysis` |
| `src/cli/processors/diagram-processor.ts` | Expose `getLastArchJson(): ArchJSON \| null` method; returns ArchJSON from the first scope group with `role === 'primary'`, or first successfully parsed ArchJSON if no primary role exists; stored as `private _lastArchJson: ArchJSON \| null = null` updated once (on first assignment) inside `processAll()` |
| `src/cli/utils/test-output-writer.ts` | New file: Markdown serializer for `test/issues.md` and `test/metrics.md` |
| `src/cli/cache-manager.ts` | Add `getCompositeKey(files, configBlob)` method; add `loadCachedTestAnalysis(compositeKey: string): TestAnalysis \| null` with cache storage at `<cacheDir>/test-analysis-<compositeKey>.json` |
| `src/cli/mcp/tools/test-analysis-tools.ts` | New file (in new `src/cli/mcp/tools/` subdirectory): exports `registerTestAnalysisTools(server, defaultRoot)` with four tool definitions using Zod schemas; when `hasTestAnalysis()` returns false, all four tools return `textResponse('No test analysis data found. Run \`archguard_analyze\` with \`includeTests: true\` first.')` |
| `src/cli/mcp/mcp-server.ts` | Call `registerTestAnalysisTools(server, defaultRoot)` in `createMcpServer()` after existing `registerTools()` and `registerAnalyzeTool()` calls |
| `src/cli/query/query-engine.ts` | Add `getTestAnalysis(): TestAnalysis \| undefined` and `hasTestAnalysis(): boolean` public methods, following the `getAtlasLayer()` / `hasAtlasExtension()` pattern |
| `tests/unit/cli/commands/analyze.test.ts` | New cases: `--include-tests` / `--tests-only` option parsing |
| `tests/unit/cli/cache-manager.test.ts` | New cases: `patternConfig` change causes cache miss |
| `tests/unit/cli/mcp/mcp-server.test.ts` | New cases: four test-analysis tools callable; patternConfig propagated |

### Phase D

| File | Change |
|------|--------|
| `src/mermaid/test-coverage-renderer.ts` | New file: four-bucket Mermaid heatmap generator |
| `src/cli/processors/diagram-processor.ts` | Add `generateTestCoverageHeatmap()` (called from `run-analysis.ts`, not from `processAll()`) |
| `tests/unit/mermaid/test-coverage-renderer.test.ts` | New: bucket thresholds and node truncation |
