# Proposal: TypeScript Test Analysis Accuracy

**Status**: Draft
**Date**: 2026-03-13
**Author**: ArchGuard Team

---

## 1. Background

### Current state

The TypeScript plugin's `extractTestStructure()` method in `src/plugins/typescript/index.ts` performs two operations that produce systematically incorrect results for real-world TypeScript projects:

1. **Assertion counting** (lines 429–431): counts assertions in a fixed 20-line window starting at the `it(`/`test(` line. Integration and E2E tests routinely have 50–90 lines of setup code before the first `expect()`.
2. **Import extraction** (lines 442–457): matches only imports whose specifier starts with `.` (relative paths). TypeScript projects using path aliases (`@/parser`, `@/cli`, etc.) have all alias-based imports silently dropped from `importedSourceFiles`.

### Root cause

**Issue 1 — 20-line window:**

```typescript
// src/plugins/typescript/index.ts lines 429–431
const assertionCount = lines
  .slice(_idx, Math.min(_idx + 20, lines.length))
  .filter((l) => assertionPatterns.some((ap) => l.includes(ap))).length;
```

The window is hard-coded at 20 lines. A typical integration test in ArchGuard looks like:

```typescript
it('should parse a TypeScript project', async () => {
  const parser = new TypeScriptParser('/some/path');   // line 1
  const config = { ... };                               // lines 2–15 setup
  const archJson = await parser.parseProject(          // line 16
    workspaceRoot,
    config
  );
  // ... 40 more lines of assertions below the window  // lines 19+
  expect(archJson.entities.length).toBeGreaterThan(0);
  expect(archJson.relations.length).toBeGreaterThan(0);
```

The first `expect()` at line 19+ is outside the 20-line window, so `assertionCount = 0`.

**Issue 2 — Path alias blindness:**

```typescript
// src/plugins/typescript/index.ts line 443
const importPattern = /import\s+.*?from\s+['"](\.[^'"]+)['"]/g;
```

The regex character class `[\.]` (actually `[^'"]` after `\.`) starting with `\.` in `(\.[^'"]+)` requires the path to start with `.`. Any import like:

```typescript
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { ProgressReporter } from '@/cli/progress.js';
```

is silently dropped because `@/...` does not start with `.`. With 168 test files and 140 using `@/` imports, this causes a 94% false orphan rate in the MCP test analysis for ArchGuard itself.

### Impact

- **zero_assertion false positives**: integration test files report `assertionCount = 0` on all test cases, causing them to be flagged as assertion-free or debug-type tests.
- **False orphan rate**: `importedSourceFiles` is empty for 140/168 test files in ArchGuard, meaning the import-analysis layer in `test-coverage-mapper.ts` links 0 entities for those files. `coveredEntityIds` is empty, so the orphan detector flags all entities they cover as untested.
- **Corrupted metrics**: `assertionDensity`, `zeroAssertionRatio`, and `entityCoverageRatio` are all unreliable for TypeScript projects with path aliases.

---

## 2. Proposed Solution

### Approach

**Fix 1 — Full test-body brace scan:**

Replace the 20-line window with a forward scan that tracks brace depth to find the actual end of the test function body. Start scanning at the `it(`/`test(` line; count opening `{` and closing `}` characters until the brace depth returns to 0 — that is the closing `}` of the callback. Count assertions within the scanned range. This correctly handles tests of any length.

**Fix 2 — Path alias import resolution:**

Extend `extractTestStructure()` to also extract `@/`-prefixed imports using a second regex pattern. The plugin already calls `findTsConfigPath` and `loadPathAliases` through `initTsProject()`. A lightweight call to `findTsConfigPath(path.dirname(filePath))` in `extractTestStructure()` resolves the tsconfig; then `paths` entries map `@/*` → `src/*` (or equivalent), letting us resolve `@/parser/foo.js` → `<workspaceRoot>/src/parser/foo.ts`. Resolved paths are pushed to `importedSourceFiles` alongside relative imports.

### Key changes

| File | Change |
|---|---|
| `src/plugins/typescript/index.ts` | Replace 20-line slice with brace-depth forward scan |
| `src/plugins/typescript/index.ts` | Add `@/`-alias import extraction with tsconfig.paths resolution |
| `tests/unit/plugins/typescript/typescript-plugin-test-structure.test.ts` | New test file covering both fixes |

---

## 3. Acceptance Criteria

1. A test case with `expect()` 50 lines after the `it(` line is counted with `assertionCount >= 1`.
2. A test file importing `@/parser/foo.js` has `importedSourceFiles` containing the resolved absolute path.
3. A test file that imports only via `@/` aliases produces non-empty `importedSourceFiles`.
4. A test with all assertions genuinely absent (no `expect` in the entire test body) still reports `assertionCount = 0`.
5. Existing assertion counting for tests with `expect()` within the first 20 lines is unchanged.
6. `extractTestStructure()` works when no tsconfig.json is found (graceful fallback: only relative imports resolved).

---

## 4. Out of Scope

- Resolving non-`@/` custom path aliases (e.g., `#internal/foo`). The fix targets `@/` exclusively as the dominant convention in TypeScript projects.
- Modifying the import regex for Go, Python, C++, or Java plugins (each has its own `extractTestStructure` implementation).
- Changing the `importedSourceFiles` data structure or downstream consumers (TestCoverageMapper uses it as-is).
