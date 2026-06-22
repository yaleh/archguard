# Plan 51 — LLM Semantic Exploration Before Analysis

> Proposal: `docs/proposals/proposal-llm-semantic-exploration.md` (v2 — reviewed)
> ADR: `docs/adr/008-llm-semantic-exploration-before-analysis.md`
> Status: Draft
> Priority: MEDIUM (improves FIM accuracy and test analysis for non-standard projects)
> Estimated total changes: ~650 lines source + ~550 lines test

---

## Overview

Insert an LLM semantic exploration layer before the analysis pipeline. The LLM
reads the project's directory tree, config file names, and README excerpt to
produce a structured `ProjectSemantics` JSON. This replaces hardcoded denylist
rules (e.g. `NON_PRODUCTION_PREFIXES` in `fim-builder.ts`) with project-specific
knowledge while preserving graceful degradation when no LLM is available.

Three-layer priority chain:
```
archguard.config.json (user)  >  .archguard/project-semantics.json (LLM)  >  hardcoded defaults
```

### Key design decisions (from architect review)

- `barrelFiles` is a **candidate list** — AST verification happens in the pipeline
- `nonProductionPatterns` uses **prefix semantics** in Phase 1 (matching existing `isProductionPackage`)
- `customAssertionPatterns` are **regex strings** (unified with `buildSuggestedPatternConfig` output)
- Zod schema validation on LLM output (consistent with MCP tool schemas)
- Security: reject paths containing `..`, absolute paths, or null bytes
- Cache invalidation: depth-2 directory hash + config file list hash + schema version check
- `source` field replaced with per-field provenance tracking or removed (metadata only in cache)

### Delivery phases

| Phase | Scope | Gate |
|-------|-------|------|
| **1** | `ProjectSemantics` types + Zod schema + injection into `isProductionPackage` + config support | Unit tests pass; existing behavior unchanged when no semantics provided |
| **2** | `ProjectSemanticsExplorer` + LLM call + cache + CLI flags | Mock-LLM integration tests pass; cache invalidation works correctly |
| **3** | Test analysis extension: `additionalTestPatterns` + `customAssertionPatterns` injection | Test analysis accuracy maintained; regex assertion patterns work across all plugins |
| **4** | `architecturalLayers` for diagram grouping + `suggestedDepth` parameterization | Package diagrams reflect layer labels; multi-depth FIM reports |

---

## Phase 1 — ProjectSemantics Types + Injection Points

**Depends on**: Nothing (greenfield types + backward-compatible signature changes)
**Estimated lines**: ~150 source + ~160 test
**Files**:
- `src/types/extensions/project-semantics.ts` (new)
- `src/types/extensions/index.ts` (modify — re-export + add to `ArchJSONExtensions`)
- `src/types/config-global.ts` (modify — add `projectSemantics` to `GlobalConfig`)
- `src/analysis/fim/fim-builder.ts` (modify — `isProductionPackage`, `filterProductionCoverage`, `filterProductionPackages`)
- `tests/unit/types/project-semantics.test.ts` (new)
- `tests/unit/analysis/fim/fim-builder.test.ts` (modify)

> **NOTE**: The `src/types/extensions/` directory already contains `go-atlas.ts`, `test-analysis.ts`, `ts-analysis.ts`, and `index.ts`. The new `project-semantics.ts` follows this existing pattern.

### Stage 1A — Define ProjectSemantics type + Zod schema (~60 lines source + ~50 lines test)

**File**: `src/types/extensions/project-semantics.ts` (new)

Define the `ProjectSemantics` interface and its Zod runtime schema:

```typescript
import { z } from 'zod';

export const PROJECT_SEMANTICS_VERSION = '1.0';

export interface ProjectSemantics {
  version: '1.0';
  nonProductionPatterns: string[];
  barrelFiles: string[];
  additionalTestPatterns: string[];
  customAssertionPatterns: string[];  // regex strings
  architecturalLayers?: Record<string, string>;
  suggestedDepth?: number;
  confidence: number;
  _dirTreeHash?: string;
  _generatedAt?: string;
}

export const ProjectSemanticsSchema = z.object({
  version: z.literal('1.0'),
  nonProductionPatterns: z.array(z.string()),
  barrelFiles: z.array(z.string()),
  additionalTestPatterns: z.array(z.string()),
  customAssertionPatterns: z.array(z.string()),
  architecturalLayers: z.record(z.string()).optional(),
  suggestedDepth: z.number().int().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1),
  _dirTreeHash: z.string().optional(),
  _generatedAt: z.string().optional(),
});
```

Add a `sanitizeProjectSemantics(raw: ProjectSemantics): ProjectSemantics` function:
- Filter out entries containing `..`, absolute paths (`/` prefix), or null bytes from all string arrays
- Return sanitized copy

**File**: `src/types/extensions/index.ts` (modify)

Add re-export: `export * from './project-semantics.js';`
Add `projectSemantics?: ProjectSemantics` to `ArchJSONExtensions`.

**File**: `tests/unit/types/project-semantics.test.ts` (new)

Tests (TDD — write first):
1. Valid ProjectSemantics passes Zod validation
2. Missing `version` field rejected
3. `confidence` as string rejected
4. `confidence` > 1 rejected
5. `sanitizeProjectSemantics` strips `../etc` paths
6. `sanitizeProjectSemantics` strips absolute paths `/home/user`
7. `sanitizeProjectSemantics` strips entries with null bytes
8. Valid entries preserved after sanitization

**Acceptance criteria**:
- `npm run type-check` passes
- All 8 tests pass
- Zod schema matches TypeScript interface

---

### Stage 1B — Add `projectSemantics` to ArchGuardConfig (~15 lines source + ~20 lines test)

**File**: `src/types/config-global.ts` (modify)

Add optional field to `GlobalConfig`:
```typescript
import type { ProjectSemantics } from './extensions/project-semantics.js';

export interface GlobalConfig {
  // ... existing fields ...
  projectSemantics?: Partial<ProjectSemantics>;
}
```

**File**: `tests/unit/types/project-semantics.test.ts` (extend)

Tests:
1. Config with `projectSemantics` field type-checks (compile-time only — verified by `npm run type-check`)
2. Partial `projectSemantics` (only `nonProductionPatterns`) is valid

**Acceptance criteria**:
- `npm run type-check` passes
- Existing config loading tests still pass

---

### Stage 1C — Inject into isProductionPackage + filterProductionCoverage (~50 lines source + ~60 lines test)

**File**: `src/analysis/fim/fim-builder.ts` (modify)

Change `isProductionPackage` signature:
```typescript
export function isProductionPackage(name: string, extraPatterns?: string[]): boolean {
  if (name === '.') return false;
  const first = name.split('/')[0]?.toLowerCase() ?? '';
  const allPatterns = [...NON_PRODUCTION_PREFIXES, ...(extraPatterns ?? [])];
  return !allPatterns.some((prefix) => first.startsWith(prefix.toLowerCase()));
}
```

Update `filterProductionCoverage` to accept and forward `extraPatterns`:
```typescript
export function filterProductionCoverage(
  coverage: CoverageMatrix,
  extraPatterns?: string[]
): CoverageMatrix
```

Update `filterProductionPackages` similarly:
```typescript
export function filterProductionPackages(
  coverage: CoverageMatrix,
  extraPatterns?: string[]
): FisherInformationResult
```

Implement `mergeProjectSemantics(user, llm, defaults)` as a standalone exported function in `src/types/extensions/project-semantics.ts` (not in `fim-builder.ts`, since it is reused by Phase 2C and Phase 3C):
- Arrays: union with `!`-prefix exclusion support (e.g. `!tools` removes `tools` from merged set)
- Scalars: first defined wins (user > llm > default)
- `architecturalLayers`: `Object.assign(llmLayers, userLayers)`

**File**: `tests/unit/analysis/fim/fim-builder.test.ts` (modify — add new describe block)

Tests (TDD) for `isProductionPackage` + `filterProductionCoverage`:
1. `isProductionPackage('playground', [])` returns true (no extra patterns, playground not in defaults)
2. `isProductionPackage('playground', ['playground'])` returns false (matches extra pattern)
3. `isProductionPackage('test', [])` returns false (existing behavior — test is in NON_PRODUCTION_PREFIXES)
4. `isProductionPackage('src', ['playground'])` returns true (src not matched)
5. `filterProductionCoverage` with extra patterns excludes additional packages
6. Backward compat: `isProductionPackage('vendor')` still returns false (no second arg)

**File**: `tests/unit/types/project-semantics.test.ts` (extend — add merge tests)

Tests (TDD) for `mergeProjectSemantics`:
7. Arrays union correctly
8. `!`-prefix exclusion removes entries
9. Scalar override (user > llm)
10. `architecturalLayers` merge via Object.assign

**Acceptance criteria**:
- All 10 new tests pass
- All existing FIM tests pass unchanged
- `npm run type-check` passes
- `npm test` passes (full suite)

**Verification**:
```bash
npm run type-check
npm test -- --reporter=verbose tests/unit/types/project-semantics.test.ts
npm test -- --reporter=verbose tests/unit/analysis/fim/fim-builder.test.ts
npm test
```

---

## Phase 2 — LLM Exploration + Cache

**Depends on**: Phase 1 (ProjectSemantics type + Zod schema)
**Estimated lines**: ~200 source + ~160 test
**Files**:
- `src/analysis/project-semantics-explorer.ts` (new)
- `src/analysis/project-semantics-cache.ts` (new)
- `src/cli/analyze/run-analysis.ts` (modify)
- `src/cli/commands/analyze.ts` (modify — CLI flags)
- `tests/unit/analysis/project-semantics-explorer.test.ts` (new)
- `tests/unit/analysis/project-semantics-cache.test.ts` (new)

### Stage 2A — Directory tree collector + cache hash (~60 lines source + ~50 lines test)

**File**: `src/analysis/project-semantics-cache.ts` (new)

Implement:
1. `computeDirTreeHash(projectRoot: string): string`
   - Read depth-2 directory listing (non-hidden dirs only)
   - Include config file presence check: `jest.config.js`, `vitest.config.ts`, `pytest.ini`, `go.mod`, `Cargo.toml`, `CMakeLists.txt`, `pom.xml`, `build.gradle`, `pyproject.toml`, `package.json`
   - SHA-256 hash of sorted dir list + `---` separator + sorted config file list
2. `loadCachedSemantics(outputDir: string, currentHash: string): ProjectSemantics | null`
   - Read `.archguard/project-semantics.json`
   - Return null if: file missing, `_dirTreeHash` mismatch, `version !== PROJECT_SEMANTICS_VERSION`
   - Zod validate on load; return null if invalid
3. `saveSemanticsCache(outputDir: string, semantics: ProjectSemantics): Promise<void>`
   - Write to `.archguard/project-semantics.json` with `_warning` field
4. `collectDirectoryTree(projectRoot: string, maxDepth: number): string`
   - Generate tree-like output (depth 3) for LLM prompt
   - Truncate at 6KB with `... (truncated, N more directories)` summary

**File**: `tests/unit/analysis/project-semantics-cache.test.ts` (new)

Tests (TDD):
1. `computeDirTreeHash` produces stable hash for same input
2. `computeDirTreeHash` changes when directory added
3. `computeDirTreeHash` changes when config file added
4. `loadCachedSemantics` returns null for missing file
5. `loadCachedSemantics` returns null for hash mismatch
6. `loadCachedSemantics` returns null for version mismatch
7. `loadCachedSemantics` returns valid cached semantics
8. `saveSemanticsCache` writes valid JSON
9. `collectDirectoryTree` respects depth limit
10. `collectDirectoryTree` truncates at 6KB threshold

**Acceptance criteria**:
- All 10 tests pass
- Cache round-trip: save then load returns same data
- Hash is deterministic (no timestamp/random component)

---

### Stage 2B — LLM exploration call (~90 lines source + ~60 lines test)

**File**: `src/analysis/project-semantics-explorer.ts` (new)

Implement `ProjectSemanticsExplorer` class:

```typescript
export class ProjectSemanticsExplorer {
  constructor(private cliCommand: string, private cliArgs: string[]) {}

  async explore(projectRoot: string): Promise<ProjectSemantics | null>
}
```

`explore()` method:
1. Collect directory tree (depth 3, via `collectDirectoryTree`)
2. List config files found in project root
3. Read README first 50 lines (if exists)
4. Build prompt with one-shot JSON example (per reviewer feedback)
5. Call LLM via CLI subprocess (`child_process.execFile`):
   - Reuse `--cli-command` from global config (default: `claude`)
   - Pass prompt as stdin or argument
   - Set timeout (30s)
6. Parse JSON response
7. Zod validate with `ProjectSemanticsSchema`
8. Sanitize with `sanitizeProjectSemantics`
9. Reject if `confidence < 0.5` (return null, log warning) — note: proposal risk table says `< 0.7` for degradation; use 0.5 as hard reject, 0.5-0.7 as "low confidence" warning in verbose mode
10. On any failure (parse error, validation, timeout): return null, log warning

Prompt template includes:
- Project tree output
- Config files found
- README excerpt (first 50 lines)
- ProjectSemantics JSON schema
- One-shot example output
- Guidelines for each field

**File**: `tests/unit/analysis/project-semantics-explorer.test.ts` (new)

Tests (TDD — mock `child_process.execFile`):
1. Valid JSON from CLI -> returns ProjectSemantics
2. Invalid JSON from CLI -> returns null
3. CLI timeout -> returns null
4. CLI not found -> returns null
5. `confidence < 0.5` -> returns null
6. Path traversal in response filtered by sanitize
7. Prompt includes directory tree
8. Prompt includes config file list
9. Prompt includes one-shot example
10. Prompt truncates tree at 6KB

**Acceptance criteria**:
- All 10 tests pass
- No actual LLM calls in unit tests (all mocked)
- Graceful fallback on every failure mode

---

### Stage 2C — CLI flags + pipeline wiring (~50 lines source + ~50 lines test)

**File**: `src/cli/commands/analyze.ts` (modify)

Add Commander options:
- `--explore` — explicitly trigger LLM exploration (default: auto when LLM available)
- `--no-explore` — disable LLM exploration entirely

**File**: `src/cli/analyze/run-analysis.ts` (modify)

Wire exploration into `runAnalysis()` between config loading and diagram processing:
1. Check `--no-explore` flag; if set, skip
2. Check cache via `loadCachedSemantics`; if valid, use it
3. If no cache and `--no-cache` not set, attempt LLM exploration
4. Merge: `mergeProjectSemantics(config.projectSemantics, llmSemantics, defaults)`
5. Pass merged `nonProductionPatterns` to FIM pipeline: add `nonProductionPatterns?: string[]` to `ComputeImportApproximationFIMOptions` (in `src/analysis/fim/fim-analysis.ts`) and forward to `filterProductionCoverage(coverage, extraPatterns)`
6. Store merged semantics on the config/context object for downstream consumption

**File**: `tests/unit/analysis/project-semantics-explorer.test.ts` (extend)

Tests:
1. `--no-explore` skips exploration entirely
2. Cached semantics used when hash matches
3. Cache miss triggers exploration
4. User config overrides LLM result
5. No LLM available -> falls back to defaults

**Acceptance criteria**:
- All tests pass
- `npm run type-check` passes
- `--no-explore` produces identical behavior to current codebase
- Existing `npm test` suite unaffected

**Verification**:
```bash
npm run type-check
npm test -- --reporter=verbose tests/unit/analysis/project-semantics-explorer.test.ts
npm test -- --reporter=verbose tests/unit/analysis/project-semantics-cache.test.ts
npm test
npm run build
# Self-validation (no LLM needed — falls back to defaults):
node dist/cli/index.js analyze --no-explore -v
```

---

## Phase 3 — Test Analysis Extension

**Depends on**: Phase 1 (types + merge), Phase 2 not strictly required (can inject via config)
**Estimated lines**: ~160 source + ~140 test
**Files**:
- `src/types/extensions/test-analysis.ts` (modify — extend `TestPatternConfig` with `customAssertionRegexes`)
- `src/plugins/typescript/index.ts` (modify)
- `src/plugins/python/index.ts` (modify)
- `src/plugins/cpp/index.ts` (modify)
- `src/plugins/golang/index.ts` (modify)
- `src/analysis/fim/coverage-parser.ts` (modify — `isTestLikePath` extra patterns)
- `src/analysis/test-analyzer.ts` (modify — pass ProjectSemantics to test discovery)
- `tests/unit/plugins/typescript/typescript-plugin-test-structure.test.ts` (modify)
- `tests/unit/plugins/python/python-plugin.test.ts` (modify)
- `tests/unit/analysis/test-coverage-mapper.test.ts` (modify)

### Stage 3A — Inject additionalTestPatterns into isTestFile (~50 lines source + ~50 lines test)

**File**: `src/analysis/test-analyzer.ts` (modify)

Modify `TestAnalyzer` to accept `ProjectSemantics` and pass `additionalTestPatterns` to plugin `isTestFile()`.

> **Note**: There are two independent test file discovery paths:
> - `TestAnalyzer.discoverTestFiles()` in `src/analysis/test-analyzer.ts` — used by `--include-tests`
> - `discoverTestFiles()` in `src/analysis/fim/fim-analysis.ts` — used by `--fim`
>
> Both must be updated to forward `additionalTestPatterns` (merged into `patternConfig.testFileGlobs`).

Each language plugin's `isTestFile()` currently takes `(filePath: string, patternConfig?: TestPatternConfig)`. The `TestPatternConfig` already has an optional `testFileGlobs` field. Two approaches:

**(a) Extend `TestPatternConfig`** — add `additionalTestPatterns` to `TestPatternConfig` and let the existing second parameter carry it through. This avoids a third parameter.

**(b) Add a third parameter** — `isTestFile?(filePath: string, patternConfig?: TestPatternConfig, additionalPatterns?: string[])`.

**Recommended: approach (a)** — extend `TestPatternConfig` (in `src/types/extensions/test-analysis.ts`) with a new optional field. This is less invasive since all call sites already pass `patternConfig`. The `additionalTestPatterns` from `ProjectSemantics` are merged into `patternConfig.testFileGlobs` before passing to the plugin. No interface change needed.

**Files**: `src/plugins/typescript/index.ts`, `src/plugins/golang/index.ts`, `src/plugins/python/index.ts`, `src/plugins/cpp/index.ts` (modify)

In each plugin's `isTestFile`, after existing checks, test `additionalPatterns` with `micromatch.isMatch(filePath, additionalPatterns)` (micromatch already a dependency).

**File**: `src/analysis/fim/coverage-parser.ts` (modify)

Modify `isTestLikePath()` to accept optional extra test globs. When provided, test `micromatch.isMatch(filePath, additionalPatterns)` as an additional condition (OR with existing regex checks):
```typescript
export function isTestLikePath(filePath: string, additionalTestGlobs?: string[]): boolean
```

**Tests** (across plugin test files — using `patternConfig.testFileGlobs` to carry extra patterns):
1. TS `isTestFile('src/foo.integration.ts', { testFileGlobs: ['**/*.integration.ts'] })` returns true
2. TS `isTestFile('src/foo.integration.ts')` returns false (backward compat)
3. Python `isTestFile('bench_test_foo.py', { testFileGlobs: ['bench_test_*.py'] })` returns true
4. C++ `isTestFile('custom-test.cpp', { testFileGlobs: ['custom-test*.cpp'] })` returns true
5. Go `isTestFile('foo_bench_test.go', { testFileGlobs: ['*_bench_test.go'] })` returns true
6. `isTestLikePath` with extra patterns
7. Backward compat: no extra patterns -> same behavior

**Acceptance criteria**:
- All 7 new tests pass
- All existing test analysis tests pass unchanged
- No change in behavior when `additionalTestPatterns` is empty/undefined

---

### Stage 3B — Inject customAssertionPatterns into extractTestStructure (~60 lines source + ~50 lines test)

**File**: `src/plugins/typescript/index.ts` (modify)

In `extractTestStructure`, when `patternConfig.assertionPatterns` is provided:
- Current: `line.includes(pattern)` for each pattern
- New: `new RegExp(pattern).test(line)` for each pattern

This is a **breaking change** in pattern format for the TypeScript plugin. Existing substring patterns (e.g. `'expect('`) must be migrated to regex equivalents (e.g. `'\\bexpect\\s*\\('`). The default patterns baked into the plugin remain as substrings internally; only externally injected patterns use regex.

Alternative (safer): keep internal defaults as substring match, and only apply regex for `customAssertionPatterns` from ProjectSemantics. This avoids breaking existing `TestPatternConfig` users.

**Recommended approach**: Add `customAssertionPatterns` to `TestPatternConfig` (in `src/types/extensions/test-analysis.ts`) as a new optional `customAssertionRegexes?: string[]` field. Internal default patterns stay as substring match. When `customAssertionRegexes` is present, each regex is compiled with `new RegExp(pattern)` and tested against each line. This preserves the MCP `TestPatternConfig` workflow exactly — the `extractTestStructure` signature remains `(filePath, code, patternConfig?)` with no change.

**Files**: `src/types/extensions/test-analysis.ts` (modify — add `customAssertionRegexes` to `TestPatternConfig`), `src/plugins/python/index.ts`, `src/plugins/cpp/index.ts` (modify)

Same pattern: accept `customAssertionPatterns` as regex strings, match with `new RegExp(pattern).test(line)`, appended to existing assertion counting.

**File**: `src/analysis/test-analyzer.ts` (modify)

Pass `projectSemantics.customAssertionPatterns` to each plugin's `extractTestStructure`.

Priority chain enforcement: if `patternConfig` (from MCP tool) provides `assertionPatterns`, those take precedence over `ProjectSemantics.customAssertionPatterns`.

**Tests**:
1. TS plugin: custom regex pattern `'\\bverify\\s*\\('` matches `verify(result)`
2. TS plugin: no custom patterns -> existing behavior
3. Python plugin: custom pattern `'\\bassert_close\\s*\\('` matches `assert_close(a, b)`
4. C++ plugin: custom pattern `'\\bMY_CHECK\\s*\\('` matches `MY_CHECK(x)`
5. MCP `patternConfig` assertion patterns override `customAssertionPatterns`
6. Invalid regex in `customAssertionPatterns` -> skip with warning, not crash
7. Empty `customAssertionPatterns` -> no change

**Acceptance criteria**:
- All 7 new tests pass
- Existing assertion counting tests pass unchanged
- MCP `TestPatternConfig` workflow unaffected

---

### Stage 3C — Integration wiring for Phase 3 (~50 lines source + ~40 lines test)

**File**: `src/cli/analyze/run-analysis.ts` (modify)

Pass merged `ProjectSemantics` to `TestAnalyzer`:
- `additionalTestPatterns` -> test file discovery
- `customAssertionPatterns` -> assertion counting

Ensure priority chain: MCP `patternConfig` > user `projectSemantics` > LLM `projectSemantics` > defaults.

**Tests**:
1. `TestAnalyzer` with `projectSemantics.additionalTestPatterns` discovers extra test files
2. `TestAnalyzer` with `projectSemantics.customAssertionPatterns` counts custom assertions
3. `TestAnalyzer` without `projectSemantics` -> unchanged behavior
4. MCP-provided `patternConfig` takes precedence over `customAssertionPatterns`

**Acceptance criteria**:
- All 4 new tests pass
- Full test suite passes

**Verification**:
```bash
npm run type-check
npm test -- --reporter=verbose tests/unit/plugins/typescript/typescript-plugin-test-structure.test.ts
npm test -- --reporter=verbose tests/unit/plugins/python/python-plugin.test.ts
npm test -- --reporter=verbose tests/unit/analysis/test-coverage-mapper.test.ts
npm test
```

---

## Phase 4 — Architecture Layers + Depth Suggestion

**Depends on**: Phase 1 (types + merge), Phase 2 (LLM provides values)
**Estimated lines**: ~140 source + ~90 test
**Files**:
- `src/analysis/fim/fim-builder.ts` (modify)
- `src/analysis/fim/fim-analysis.ts` (modify)
- `src/mermaid/generator.ts` (modify)
- `tests/unit/analysis/fim/fim-builder.test.ts` (modify)
- `tests/unit/mermaid/generator.test.ts` (modify)

### Stage 4A — Parameterize suggestedDepth in FIM + package derivation (~50 lines source + ~40 lines test)

**File**: `src/analysis/fim/fim-builder.ts` (modify)

The `aggregateToPackageLevel(coverage, fileIds, depth = 1)` function already accepts a `depth` parameter (default: 1, not 2 as stated in the proposal — see correction note below). Wire `suggestedDepth` from `ProjectSemantics` through the FIM pipeline:

> **Correction**: The proposal states `derivePackageNames() depth=2` but the actual function is `aggregateToPackageLevel()` with `depth = 1`. The proposal has been updated to match.

**File**: `src/analysis/fim/fim-analysis.ts` (modify)

In `computeImportApproximationFIM`, accept optional `suggestedDepth` and `nonProductionPatterns` (the latter may already be added in Stage 2C wiring) and pass to `aggregateToPackageLevel` and `filterProductionCoverage` respectively:
```typescript
export interface ComputeImportApproximationFIMOptions {
  // ... existing fields ...
  nonProductionPatterns?: string[];  // may already exist from Stage 2C
  suggestedDepth?: number;
}
```

Add multi-depth comparison: when `suggestedDepth` differs from default (1), compute FIM at both depths and include both in the result artifact.

**Tests**:
1. `suggestedDepth=3` produces different package names than depth=1 for deep paths
2. `suggestedDepth=2` produces finer packages than depth=1
3. `suggestedDepth=undefined` defaults to 1 (backward compat — matches current `aggregateToPackageLevel` default)
4. Multi-depth report includes both depth-1 and depth-N results

**Acceptance criteria**:
- All 4 new tests pass
- Default depth-2 behavior unchanged when `suggestedDepth` not provided

---

### Stage 4B — Architectural layer labels in package diagrams (~60 lines source + ~30 lines test)

**File**: `src/mermaid/generator.ts` (modify)

When `architecturalLayers` is provided in `ProjectSemantics`:
- In package-level flowchart generation, add Mermaid `subgraph` blocks for each layer
- Packages whose directory prefix matches a layer key are grouped under that layer's subgraph
- Unmatched packages go into an "Other" subgraph (or no subgraph)

```mermaid
subgraph Domain
  domain/model
  domain/service
end
subgraph Infrastructure
  infra/database
  infra/http
end
```

**File**: `tests/unit/mermaid/generator.test.ts` (modify)

Tests:
1. `architecturalLayers` provided -> output contains `subgraph` blocks
2. Package mapped to correct layer based on directory prefix
3. Unmatched package excluded from layer subgraphs
4. No `architecturalLayers` -> no subgraph blocks (backward compat)

**Acceptance criteria**:
- All 4 new tests pass
- Generated Mermaid is valid (parseable)
- No subgraph blocks when `architecturalLayers` not provided

---

### Stage 4C — Multi-depth FIM report output (~30 lines source + ~20 lines test)

**File**: `src/analysis/fim/fim-analysis.ts` (modify)

When `suggestedDepth` is provided and differs from 1 (the current default), include a comparison section in the FIM artifact output:
- `depth1`: FIM result at default depth
- `depthN`: FIM result at suggested depth
- `depthComparison`: delta in kappa, N_eff, uncovered count

**Tests**:
1. Multi-depth artifact contains both `depth1` and `depthN` sections
2. Single-depth artifact (no `suggestedDepth`) has no comparison section

**Acceptance criteria**:
- All 2 new tests pass
- FIM artifact format backward compatible (new fields are additive)

**Verification**:
```bash
npm run type-check
npm test -- --reporter=verbose tests/unit/analysis/fim/fim-builder.test.ts
npm test -- --reporter=verbose tests/unit/mermaid/generator.test.ts
npm test
npm run build
node dist/cli/index.js analyze --no-explore --fim -v
```

---

## Test Strategy

- **TDD**: All stages write tests before implementation
- **Coverage target**: >= 80% line coverage for new files in `src/analysis/project-semantics-*` and `src/types/extensions/project-semantics.ts`
- **Mock LLM**: All unit tests mock `child_process.execFile`; no actual LLM calls
- **Integration test gate**: One integration test in `tests/integration/` that runs with `skip-helper.ts` pattern (skipped when Claude CLI unavailable)
- **Backward compatibility**: Every modified function must have a test showing unchanged behavior when `ProjectSemantics` is not provided
- **Regression**: Existing 3141+ tests must continue passing after each stage
- **Security**: Sanitization tests cover path traversal, absolute paths, null bytes

## Dependency Summary

```
Phase 1:
  Stage 1A (types + Zod) → Stage 1B (config field) → Stage 1C (injection + merge)

Phase 2 (depends on Phase 1):
  Stage 2A (cache + hash) → Stage 2C (CLI wiring)
  Stage 2B (LLM explorer)  → Stage 2C (CLI wiring)

Phase 3 (depends on Phase 1; Phase 2 optional):
  Stage 3A (test patterns) ──┐
  Stage 3B (assertions)    ──┤→ Stage 3C (integration)
                              │
Phase 4 (depends on Phase 1):
  Stage 4A (depth) ──────────┤
  Stage 4B (layers) ─────────┤→ Stage 4C (multi-depth report)
```

Phases 3 and 4 are independent of each other and can be implemented in parallel.
Phase 2 is required for LLM-generated semantics but Phase 3/4 can work with
user-provided `projectSemantics` in `archguard.config.json` alone.

## Line Budget Summary

| Stage | Source lines | Test lines | Total |
|-------|-------------|------------|-------|
| 1A    | ~60         | ~50        | ~110  |
| 1B    | ~15         | ~20        | ~35   |
| 1C    | ~50         | ~60        | ~110  |
| 2A    | ~60         | ~50        | ~110  |
| 2B    | ~90         | ~60        | ~150  |
| 2C    | ~50         | ~50        | ~100  |
| 3A    | ~50         | ~50        | ~100  |
| 3B    | ~60         | ~50        | ~110  |
| 3C    | ~50         | ~40        | ~90   |
| 4A    | ~50         | ~40        | ~90   |
| 4B    | ~60         | ~30        | ~90   |
| 4C    | ~30         | ~20        | ~50   |
| **Total** | **~625** | **~520** | **~1145** |

Phase 1: ~255 lines. Phase 2: ~360 lines. Phase 3: ~300 lines. Phase 4: ~230 lines.
All phases within the 500-line budget. Each stage under 200 lines.

## Out of Scope

Per architect review, these items are **not** part of this plan:
- **`import type` fix**: Separate bug in `relation-extractor.ts` — track as independent issue
- **MCP tool for ProjectSemantics**: Deferred to post-Phase 3 (internal pipeline only first)
- **Glob pattern semantics for `nonProductionPatterns`**: Phase 1 uses prefix matching; glob support can be added later
- **Per-subproject semantics for monorepos**: Single `ProjectSemantics` per workspace for now

## References

- `docs/proposals/proposal-llm-semantic-exploration.md` (v2 — reviewed)
- `docs/adr/008-llm-semantic-exploration-before-analysis.md`
- `src/analysis/fim/fim-builder.ts` — `NON_PRODUCTION_PREFIXES`, `isProductionPackage`, `filterProductionPackages`
- `src/analysis/fim/fim-analysis.ts` — `ComputeImportApproximationFIMOptions`, `computeImportApproximationFIM`
- `src/analysis/fim/coverage-parser.ts` — `isTestLikePath`
- `src/types/extensions/test-analysis.ts` — `TestPatternConfig`, `TestAnalysis`
- `src/types/config-global.ts` — `GlobalConfig`, `ArchGuardConfig`
- `src/cli/mcp/tools/test-analysis-tools.ts` — `buildSuggestedPatternConfig` (regex pattern reference)
- `src/analysis/test-coverage-mapper.ts` — path-convention coverage mapping
- `src/analysis/test-analyzer.ts` — `TestAnalyzer` orchestrator
- `src/cli/analyze/run-analysis.ts` — analysis pipeline entry point
