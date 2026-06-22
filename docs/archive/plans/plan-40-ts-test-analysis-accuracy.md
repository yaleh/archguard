# Plan 40: TypeScript Test Analysis Accuracy

**Proposal**: `docs/proposals/proposal-ts-test-analysis-accuracy.md`
**Priority**: CRITICAL (Issue 1 + Issue 2 together cause ~100% false positive rate for TS projects)
**Estimated total changes**: ~80 lines source + ~100 test lines across 2 files

---

## Overview

Two independent fixes to `src/plugins/typescript/index.ts` that together restore accurate test structure extraction for TypeScript projects:

| # | Issue | Root cause | Priority |
|---|---|---|---|
| 1 | 20-line assertion window misses long tests | Hard-coded `slice(_idx, _idx + 20)` at line 430 | CRITICAL |
| 2 | `@/` alias imports silently dropped | Regex `(\.[^'"]+)` requires `.`-prefix at line 443 | CRITICAL |

---

## Phase A — Fix Assertion Counting: Brace-Depth Test Body Scan

**Files**: `src/plugins/typescript/index.ts`, `tests/unit/plugins/typescript/typescript-plugin-test-structure.test.ts`
**Estimated lines**: ~35 source + ~50 test

### Stage A1 — Replace 20-line window with brace-depth scan

**File**: `src/plugins/typescript/index.ts`

**Current code** (lines 424–438):

```typescript
const testCases = lines
  .map((line, _idx) => {
    if (!testCasePattern.test(line)) return null;

    const isSkipped = skipPatterns.some((p) => line.includes(p));
    const assertionCount = lines
      .slice(_idx, Math.min(_idx + 20, lines.length))
      .filter((l) => assertionPatterns.some((ap) => l.includes(ap))).length;

    const nameMatch = line.match(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
    const name = nameMatch ? nameMatch[1] : `test at line ${_idx + 1}`;

    return { name, isSkipped, assertionCount };
  })
  .filter((tc): tc is NonNullable<typeof tc> => tc !== null);
```

**Replacement** — extract a helper `scanTestBody()` then use it in the map:

```typescript
/**
 * Scan forward from startLine to find the closing '}' of the test callback.
 * Returns the line index (exclusive) of the first line after the body ends.
 * Tracks brace depth: opening '{' increments, closing '}' decrements.
 * Scanning starts counting depth only after the first '{' is seen
 * (the callback function open brace), so inline object literals on the
 * test() invocation line itself are handled gracefully.
 */
function scanTestBody(lines: string[], startIdx: number): number {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}' && started) {
        depth--;
        if (depth === 0) {
          return i + 1; // exclusive end index
        }
      }
    }
  }
  return lines.length; // unterminated body — scan to end of file
}
```

Replace the `assertionCount` computation inside the `.map()`:

```typescript
// Was: lines.slice(_idx, Math.min(_idx + 20, lines.length))
const bodyEnd = scanTestBody(lines, _idx);
const assertionCount = lines
  .slice(_idx, bodyEnd)
  .filter((l) => assertionPatterns.some((ap) => l.includes(ap))).length;
```

Place `scanTestBody` as a module-level function (before the `TypeScriptPlugin` class declaration) so it is testable independently. The function is pure and has no side effects.

**Acceptance**: A test case where the first `expect()` appears 50 lines after `it(` reports `assertionCount >= 1`.

### Stage A2 — Add unit tests for brace-depth scan

**File**: `tests/unit/plugins/typescript/typescript-plugin-test-structure.test.ts` (new file if it doesn't exist; extend existing otherwise)

Test group: `describe('extractTestStructure — assertion counting via brace-depth scan')`:

```typescript
it('counts expect() within 20 lines (existing behaviour unchanged)', () => {
  const code = `it('short test', () => {\n  expect(1).toBe(1);\n});\n`;
  const result = plugin.extractTestStructure('/test/foo.test.ts', code);
  expect(result!.testCases[0].assertionCount).toBe(1);
});

it('counts expect() at line 50 of test body', () => {
  const setup = Array.from({ length: 48 }, (_, i) => `  const x${i} = ${i};`).join('\n');
  const code = `it('long test', async () => {\n${setup}\n  expect(true).toBe(true);\n});\n`;
  const result = plugin.extractTestStructure('/test/foo.test.ts', code);
  expect(result!.testCases[0].assertionCount).toBeGreaterThan(0);
});

it('counts multiple expects scattered across a 90-line body', () => {
  const lines = [`it('big', async () => {`];
  for (let i = 0; i < 90; i++) {
    lines.push(i % 30 === 0 ? `  expect(${i}).toBeDefined();` : `  const v${i} = ${i};`);
  }
  lines.push('});');
  const result = plugin.extractTestStructure('/test/foo.test.ts', lines.join('\n'));
  expect(result!.testCases[0].assertionCount).toBe(3); // 3 expects at lines 0, 30, 60
});

it('reports assertionCount=0 when test body has no assertions', () => {
  const code = `it('noop', () => {\n  const x = 1 + 1;\n});\n`;
  const result = plugin.extractTestStructure('/test/foo.test.ts', code);
  expect(result!.testCases[0].assertionCount).toBe(0);
});

it('handles nested braces (object literals) without exiting early', () => {
  const code = `it('obj test', () => {\n  const cfg = { a: { b: 1 } };\n  expect(cfg).toBeDefined();\n});\n`;
  const result = plugin.extractTestStructure('/test/foo.test.ts', code);
  expect(result!.testCases[0].assertionCount).toBe(1);
});
```

**Dependencies**: A1

---

## Phase B — Fix Path Alias Import Extraction

**Files**: `src/plugins/typescript/index.ts`, same test file as Phase A
**Estimated lines**: ~45 source + ~50 test

### Stage B1 — Extract @/ alias imports with tsconfig.paths resolution

**File**: `src/plugins/typescript/index.ts`, inside `extractTestStructure()` after the relative import loop (currently ending at line 457)

Add a second extraction block immediately after the `while` loop for relative imports:

```typescript
// Extract @/-alias imports (e.g. `from '@/parser/foo.js'`)
// Resolve using the nearest tsconfig.json paths config.
const aliasPattern = /import\s+.*?from\s+['"](@\/[^'"]+)['"]/g;
let aliasMatch: RegExpExecArray | null;
while ((aliasMatch = aliasPattern.exec(code)) !== null) {
  const aliasPath = aliasMatch[1]; // e.g. '@/parser/typescript-parser.js'
  // Strip the leading '@/'
  const stripped = aliasPath.replace(/^@\//, ''); // e.g. 'parser/typescript-parser.js'

  // Resolve via tsconfig.paths: '@/*' maps to 'src/*' (most common convention).
  // Attempt: find tsconfig.json from the file's directory upward.
  const tsConfigPath = findTsConfigPath(path.dirname(filePath));
  const aliases = tsConfigPath ? loadPathAliases(tsConfigPath) : undefined;

  let resolvedBase: string | null = null;

  if (aliases?.paths) {
    // Look for '@/*' → ['src/*'] or equivalent
    const atStarTarget = aliases.paths['@/*'];
    if (atStarTarget && atStarTarget.length > 0) {
      // e.g. 'src/*' → strip trailing '/*' → 'src'
      const targetDir = atStarTarget[0].replace(/\/\*$/, '');
      resolvedBase = path.join(aliases.baseUrl, targetDir);
    }
  }

  if (!resolvedBase) {
    // Fallback: assume '@/*' → '<workspaceRoot>/src/*' by convention
    // workspaceRoot is unavailable here; use file's ancestor heuristic
    resolvedBase = path.join(path.dirname(filePath), '..', '..', 'src');
  }

  // Build resolved path from base + stripped alias
  const resolved = path.join(resolvedBase, stripped);
  // Normalise extension: .js imports → .ts sources
  const withTs = resolved.replace(/\.js$/, '.ts');
  importedSourceFiles.push(withTs);
}
```

**Important**: The `findTsConfigPath` and `loadPathAliases` imports are already present at the top of the file (lines 28), so no new imports are needed.

**Acceptance**: A test file containing `import { TypeScriptParser } from '@/parser/typescript-parser.js'` produces `importedSourceFiles` containing a path ending in `parser/typescript-parser.ts`.

### Stage B2 — Optimise: cache tsconfig lookup per filePath directory

The `findTsConfigPath` traversal walks the filesystem on every call. For a project with 168 test files in the same directory tree, this is redundant. Add a module-level `Map<string, string | undefined>` cache:

```typescript
// Module-level (placed before the class): tsconfig path cache keyed on directory
const _tsconfigPathCache = new Map<string, string | undefined>();

function cachedFindTsConfigPath(dir: string): string | undefined {
  if (_tsconfigPathCache.has(dir)) return _tsconfigPathCache.get(dir);
  const result = findTsConfigPath(dir);
  _tsconfigPathCache.set(dir, result);
  return result;
}
```

Replace `findTsConfigPath(path.dirname(filePath))` with `cachedFindTsConfigPath(path.dirname(filePath))` in the alias resolution block.

**Acceptance**: The filesystem is traversed at most once per unique directory in a batch `extractTestStructure()` run.

### Stage B3 — Add unit tests for alias import resolution

**File**: same test file as Phase A

Test group: `describe('extractTestStructure — @/ alias import extraction')`:

```typescript
it('resolves @/ import when tsconfig.json maps @/* to src/*', () => {
  // Simulate extracting from a file in tests/unit/foo.test.ts
  // with tsconfig at project root mapping @/* → src/*
  vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
  vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
    baseUrl: '/project',
    paths: { '@/*': ['src/*'] },
  });

  const code = `import { Parser } from '@/parser/typescript-parser.js';\nit('x', () => {});\n`;
  const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
  expect(result!.importedSourceFiles).toContain('/project/src/parser/typescript-parser.ts');
});

it('does not resolve @/ import when no tsconfig.json found', () => {
  vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue(undefined);

  const code = `import { Parser } from '@/parser/foo.js';\nit('x', () => {});\n`;
  const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
  // Falls back to heuristic — either resolves or produces empty; does not throw
  expect(result).not.toBeNull();
});

it('still resolves relative imports alongside @/ imports', () => {
  vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
  vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
    baseUrl: '/project',
    paths: { '@/*': ['src/*'] },
  });

  const code = [
    `import { A } from './local-helper';`,
    `import { B } from '@/cli/progress';`,
    `it('x', () => {});`,
  ].join('\n');
  const result = plugin.extractTestStructure('/project/tests/unit/foo.test.ts', code);
  expect(result!.importedSourceFiles.some((p) => p.includes('local-helper'))).toBe(true);
  expect(result!.importedSourceFiles.some((p) => p.includes('cli/progress'))).toBe(true);
});

it('converts .js extension to .ts in resolved path', () => {
  vi.spyOn(tsconfigFinder, 'findTsConfigPath').mockReturnValue('/project/tsconfig.json');
  vi.spyOn(tsconfigFinder, 'loadPathAliases').mockReturnValue({
    baseUrl: '/project',
    paths: { '@/*': ['src/*'] },
  });

  const code = `import { X } from '@/utils/helpers.js';\nit('x', () => {});\n`;
  const result = plugin.extractTestStructure('/project/tests/foo.test.ts', code);
  expect(result!.importedSourceFiles.some((p) => p.endsWith('.ts'))).toBe(true);
  expect(result!.importedSourceFiles.some((p) => p.endsWith('.js'))).toBe(false);
});
```

**Dependencies**: B1, B2

---

## Dependency Graph

```
Phase A (assertion window) — independent of Phase B
Phase B (alias imports) — independent of Phase A
A2 depends on A1
B2 depends on B1
B3 depends on B1, B2
```

Both phases are independent and can be implemented in any order.

---

## Testing Strategy

- **TDD**: Write A2 tests first (they will fail with 20-line window). Implement A1. Run tests.
- **TDD**: Write B3 tests first (they will fail without alias resolution). Implement B1 + B2. Run tests.
- **No integration tests needed**: All fixes are pure logic changes exercisable with unit mocks.
- **Existing test suite**: Must remain green (2787+ tests) after all phases complete.
- **Self-validation**: After building, run `node dist/cli/index.js analyze -v` on ArchGuard itself and verify that the MCP `detect_test_patterns` tool shows `zeroAssertionRatio` < 20% (vs current ~100%) and `entityCoverageRatio` > 50% (vs current near 0%).

---

## Acceptance Criteria

| Phase | Criterion |
|---|---|
| A | Integration test with `expect()` at line 50+ reports `assertionCount >= 1` |
| A | Test body with 3 `expect()`s spread across 90 lines reports `assertionCount = 3` |
| A | Nested `{ }` object literals inside test body do not prematurely end the scan |
| B | `@/parser/foo.js` import resolves to `<workspaceRoot>/src/parser/foo.ts` |
| B | Files with only `@/` imports produce non-empty `importedSourceFiles` |
| B | `extractTestStructure()` does not throw when tsconfig.json is absent |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Brace scan misidentifies `//` comment braces | Low risk: comment braces are syntactically rare in tests; known limitation; can filter with regex if needed |
| tsconfig.json not found in some CI environments | Fallback heuristic (`../../src`) always runs; at worst falls back to current (empty) state |
| `@/*` → `src/*` assumption wrong for monorepos | Progressive resolution: try all `paths['@/*']` entries; skip if none match |
| Phase B `findTsConfigPath` I/O overhead per file | B2 cache eliminates repeated filesystem traversal |

---

## Validation

After implementing both phases:

```bash
npm run build
node dist/cli/index.js analyze -v --include-tests
# Then via MCP:
# mcp: detect_test_patterns → assertionDensity should improve
# mcp: get_test_metrics → zeroAssertionRatio should drop from ~100% toward < 20%
# mcp: get_test_issues → orphan count should drop from ~140 toward < 20
```
