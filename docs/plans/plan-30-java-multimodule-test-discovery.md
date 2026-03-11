# Plan 30: Java Multi-Module Test Discovery Fix

**Status**: Ready
**Date**: 2026-03-11
**Proposal**: `docs/proposals/proposal-java-multimodule-test-discovery.md`

---

## Overview

`TestAnalyzer.discoverTestFiles` falls through to `inferTestDirs` for Java projects because neither the Go special case nor a user-supplied `patternConfig.testFileGlobs` matches. `inferTestDirs` resolves candidate directories (`tests`, `test`, `src`, etc.) relative to `workspaceRoot`, which for a Maven multi-module build is frequently a single sub-module directory (e.g. `/jlama/jlama-tests`). Sibling sub-modules such as `/jlama/jlama-net/src/test/java` are therefore never visited and their test files are never discovered.

The fix mirrors the existing Go special case: add a Java-specific branch that performs a full-depth `**/*.java` glob anchored at `workspaceRoot` and filters results through `JavaPlugin.isTestFile`. The fix is a single insertion in `src/analysis/test-analyzer.ts`. No new interfaces, types, or public APIs are introduced. New real-filesystem tests are added to the existing test file to provide regression coverage for the previously untested `discoverTestFiles` Java path.

---

## Phase 1: Add failing tests for Java multi-module discovery (TDD red)

### Stage 1.1: Test for real `discoverTestFiles` with multi-module Maven layout

**File**: `tests/unit/analysis/test-analyzer.test.ts`

**Objective**: Write a test that creates a real temporary filesystem with two Maven sub-modules each containing `src/test/java/*.java` test files, calls `TestAnalyzer.analyze` with a real `JavaPlugin` (not a mock), and asserts that test files from both modules are present in the paths passed to `collectRawTestFiles`. The test must NOT mock `discoverTestFiles` itself — only `collectRawTestFiles` is mocked to prevent tree-sitter initialization.

**What to add**:

1. Add `import { JavaPlugin } from '@/plugins/java/index.js';` to the imports section at the top of the file (line 4, after the existing imports).

2. Add `import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';` and `import os from 'os';` to the imports (these are Node built-ins; check whether `path` is already imported — it is not in the current file, so add `import path from 'path';` as well).

3. Append a new `describe` block at the end of the file:

```typescript
describe('TestAnalyzer.discoverTestFiles — Java multi-module (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'archguard-java-test-'));
    // Multi-module Maven layout:
    //   <tmpDir>/jlama-core/src/main/java/.../Core.java        ← source, not a test
    //   <tmpDir>/jlama-net/src/test/java/.../RestServiceTest.java
    //   <tmpDir>/jlama-tests/src/test/java/.../IntegrationTest.java
    await mkdir(path.join(tmpDir, 'jlama-core/src/main/java/com/github/tjake/jlama'), { recursive: true });
    await mkdir(path.join(tmpDir, 'jlama-net/src/test/java/com/github/tjake/jlama'), { recursive: true });
    await mkdir(path.join(tmpDir, 'jlama-tests/src/test/java/com/github/tjake/jlama'), { recursive: true });

    await writeFile(
      path.join(tmpDir, 'jlama-core/src/main/java/com/github/tjake/jlama/Core.java'),
      'package com.github.tjake.jlama;\npublic class Core {}'
    );
    await writeFile(
      path.join(tmpDir, 'jlama-net/src/test/java/com/github/tjake/jlama/RestServiceTest.java'),
      'import org.junit.Test;\npublic class RestServiceTest { @Test public void testGet() {} }'
    );
    await writeFile(
      path.join(tmpDir, 'jlama-tests/src/test/java/com/github/tjake/jlama/IntegrationTest.java'),
      'import org.junit.Test;\npublic class IntegrationTest { @Test public void testFlow() {} }'
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('discovers test files in all sub-modules when workspaceRoot is the project root', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const plugin = new JavaPlugin();
    await plugin.initialize({ workspaceRoot: tmpDir });

    const analyzer = new TestAnalyzer();
    // collectRawTestFiles is mocked so tree-sitter is never invoked
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot: tmpDir });

    const collectCall = (analyzer as any).collectRawTestFiles as ReturnType<typeof vi.spyOn>;
    const discoveredPaths: string[] = collectCall.mock.calls[0][0];

    expect(discoveredPaths.some((p) => p.includes('RestServiceTest.java'))).toBe(true);
    expect(discoveredPaths.some((p) => p.includes('IntegrationTest.java'))).toBe(true);
    // Non-test sources must be excluded
    expect(discoveredPaths.some((p) => p.includes('Core.java'))).toBe(false);
  });
```

**How the fixture works**: `os.tmpdir()` + `mkdtemp` produces an isolated directory under the OS temp location. `mkdir({ recursive: true })` creates the full Maven directory tree. `writeFile` plants minimal valid `.java` content. `afterEach` cleans up with `rm({ recursive: true, force: true })`.

**Why this test fails before the fix**: Before Stage 2.1, `discoverTestFiles` falls to `inferTestDirs`. `inferTestDirs` looks for top-level `tests`, `__tests__`, `test`, `spec`, `src` directories relative to `tmpDir`. None of `jlama-core`, `jlama-net`, or `jlama-tests` match those names, so `inferTestDirs` returns `[tmpDir]`. The subsequent `globby(${tmpDir}/**/*)` will enumerate all files, but `plugin.isTestFile` will still correctly identify `RestServiceTest.java` and `IntegrationTest.java`. Wait — actually the fallback `globby(${candidateDir}/**/*`)` with `plugin.isTestFile` filtering would find all `.java` files under `tmpDir/**`, so the test might not fail if `inferTestDirs` falls back to returning `[tmpDir]` itself.

**Revised failure analysis**: `inferTestDirs` returns `[tmpDir]` as the fallback (line 89: `return results.length > 0 ? results : [workspaceRoot]`). The glob `${tmpDir}/**/*` then visits all nested files. `plugin.isTestFile` correctly filters to `RestServiceTest.java` and `IntegrationTest.java`. In this artificial temp layout, the test might actually pass even before the fix, because there are no `src`, `test` etc. top-level directories to confuse `inferTestDirs`.

**Realistic failure scenario**: The test should be designed to reflect the actual production failure case. The real Maven project has a top-level `src` or other candidate directory at the workspace root level that causes `inferTestDirs` to return a scoped directory — not the `[workspaceRoot]` fallback. In the `jlama` project, `/jlama` contains no top-level `src/` (sub-modules do), so `inferTestDirs` returns `[/jlama]`. But if `workspaceRoot` were `/jlama/jlama-tests` (a sub-module root), `inferTestDirs` finds `/jlama/jlama-tests/src` and returns that. The glob then only visits `/jlama/jlama-tests/src/**/*`, missing `/jlama/jlama-net/src/test/java`.

**Revised fixture design for guaranteed pre-fix failure**: Add a top-level `src` directory to `jlama-net` so that when `workspaceRoot = path.join(tmpDir, 'jlama-net')`, `inferTestDirs` returns `jlama-net/src` and the glob misses `jlama-tests`. This is captured by Stage 1.2. For Stage 1.1, add a `src` dir at the project root level so `inferTestDirs` does not fall back to `tmpDir`:

```typescript
// In beforeEach, also create a root-level src directory so inferTestDirs
// returns tmpDir/src instead of the fallback [tmpDir]:
await mkdir(path.join(tmpDir, 'src'), { recursive: true });
```

With a `src/` directory at `tmpDir`, `inferTestDirs` returns `[tmpDir/src]`. The glob `${tmpDir}/src/**/*` finds nothing (no `.java` files are placed under `tmpDir/src/`). Both `RestServiceTest.java` and `IntegrationTest.java` are in sub-module directories and are therefore not discovered. The test **fails** as required.

**Final fixture for Stage 1.1**:

> **IMPORTANT**: Use this plan's `beforeEach` fixture below, NOT the proposal's — the proposal's version omits the root-level `src/` creation, which means `inferTestDirs` falls back to `[tmpDir]` and the test passes even before the fix, giving a false green.

```typescript
beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'archguard-java-test-'));
  // Create a root-level 'src/' to force inferTestDirs to scope to it (triggering the bug)
  await mkdir(path.join(tmpDir, 'src'), { recursive: true });
  await mkdir(path.join(tmpDir, 'jlama-core/src/main/java/com/github/tjake/jlama'), { recursive: true });
  await mkdir(path.join(tmpDir, 'jlama-net/src/test/java/com/github/tjake/jlama'), { recursive: true });
  await mkdir(path.join(tmpDir, 'jlama-tests/src/test/java/com/github/tjake/jlama'), { recursive: true });

  await writeFile(
    path.join(tmpDir, 'jlama-core/src/main/java/com/github/tjake/jlama/Core.java'),
    'package com.github.tjake.jlama;\npublic class Core {}'
  );
  await writeFile(
    path.join(tmpDir, 'jlama-net/src/test/java/com/github/tjake/jlama/RestServiceTest.java'),
    'import org.junit.Test;\npublic class RestServiceTest { @Test public void testGet() {} }'
  );
  await writeFile(
    path.join(tmpDir, 'jlama-tests/src/test/java/com/github/tjake/jlama/IntegrationTest.java'),
    'import org.junit.Test;\npublic class IntegrationTest { @Test public void testFlow() {} }'
  );
});
```

**Acceptance criteria**:
- The new test `'discovers test files in all sub-modules when workspaceRoot is the project root'` fails (assertion `discoveredPaths.some(p => p.includes('RestServiceTest.java'))` returns false before the fix).
- No existing tests are broken by the new imports or describe block.

**Dependencies**: None (this is the first stage).

---

### Stage 1.2: Test for single sub-module scoping (regression guard)

**File**: `tests/unit/analysis/test-analyzer.test.ts` (same describe block as Stage 1.1)

**Objective**: Add a second test case within the same describe block that verifies when `workspaceRoot` is intentionally pointed at a single sub-module (`jlama-tests`), only that sub-module's test files are discovered. This is not a failing test — it serves as a regression guard against any future over-reach in the Java glob.

**What to add** (within the same `describe` block as Stage 1.1):

```typescript
  it('discovers only test files within the given sub-module when workspaceRoot is a single sub-module root', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const plugin = new JavaPlugin();
    const subRoot = path.join(tmpDir, 'jlama-tests');
    await plugin.initialize({ workspaceRoot: subRoot });

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    await analyzer.analyze(makeArchJson(), plugin, { workspaceRoot: subRoot });

    const collectCall = (analyzer as any).collectRawTestFiles as ReturnType<typeof vi.spyOn>;
    const discoveredPaths: string[] = collectCall.mock.calls[0][0];

    expect(discoveredPaths.some((p) => p.includes('IntegrationTest.java'))).toBe(true);
    expect(discoveredPaths.some((p) => p.includes('RestServiceTest.java'))).toBe(false);
  });
```

**Why this test passes both before and after the fix**:
- Before the fix: `inferTestDirs` finds `jlama-tests/src` and globs within it; `IntegrationTest.java` is found. `RestServiceTest.java` is a sibling and is not in scope. Passes.
- After the fix: the Java glob anchors at `subRoot` (`jlama-tests/`). Only `IntegrationTest.java` is within `jlama-tests/**/*.java`. Passes.

**Acceptance criteria**:
- Test passes before the fix (confirms correct scoping is preserved).
- Test continues to pass after the fix (confirms the fix does not over-reach into sibling directories).

**Note on shared `beforeEach`**: This test's `beforeEach` also creates the root-level `src/` fixture. The `workspaceRoot` passed is `path.join(tmpDir, 'module-a')` — wait, in this plan's fixture it is `path.join(tmpDir, 'jlama-tests')`, which has its own `src/test/java/` subtree. So `inferTestDirs` finds `jlama-tests/src/` and scopes correctly to that module — which is the desired behavior. The root-level `src/` directory at `tmpDir` is not relevant here because `workspaceRoot` is `jlama-tests`, not `tmpDir`.

**Dependencies**: Stage 1.1 (same describe block, same `beforeEach`/`afterEach` setup).

---

## Phase 2: Implement Fix 1 — Java special case in `discoverTestFiles`

### Stage 2.1: Add Java glob branch in `test-analyzer.ts`

**File**: `src/analysis/test-analyzer.ts`

**Objective**: Insert a Java-specific full-depth glob branch after the `patternConfig.testFileGlobs` check (line 59, the closing brace of that block) and before the `// Default: walk candidate dirs` comment (line 61). This mirrors the existing Go branch.

**Exact insertion point**: Between line 59 (end of `patternConfig.testFileGlobs` block) and line 61 (`// Default: walk candidate dirs`).

**Current code at lines 53–62**:

```typescript
    // Use testFileGlobs from patternConfig if provided
    if (patternConfig?.testFileGlobs && patternConfig.testFileGlobs.length > 0) {
      return globby(
        patternConfig.testFileGlobs.map((g) => `${workspaceRoot}/${g}`),
        { onlyFiles: true, absolute: true }
      );
    }

    // Default: walk candidate dirs and filter with plugin.isTestFile
    const candidateDirs = await this.inferTestDirs(workspaceRoot);
```

**Code to insert** (after the closing `}` of the `patternConfig` block, before the `// Default:` comment):

```typescript
    // Java: scan entire workspace tree to handle Maven multi-module projects.
    // Mirrors the Go special case. Uses plugin.isTestFile to filter non-test sources.
    if (plugin.metadata.fileExtensions.includes('.java')) {
      const allJavaFiles = await globby(`${workspaceRoot}/**/*.java`, {
        onlyFiles: true,
        absolute: true,
        ignore: ['**/target/**', '**/build/**', '**/node_modules/**'],
      });
      if (plugin.isTestFile) {
        return allJavaFiles.filter((f) => plugin.isTestFile!(f, patternConfig));
      }
      return allJavaFiles;
    }

```

**Why `patternConfig.testFileGlobs` comes first**: It is a user-supplied override that must take highest precedence for all languages. Java's special case comes second, so user config can override it for Java projects with non-standard layouts.

**Why `ignore: ['**/target/**', '**/build/**', '**/node_modules/**']`**: Consistent with `JavaPlugin.parseProject` (line 118). Prevents compiled `.java` sources generated under `target/` from polluting results. The `isTestFile` filter would also reject most such files, but the ignore list keeps the glob cheap and the behavior consistent.

**Note on `isTestFile` signature**: `JavaPlugin.isTestFile` is declared as `isTestFile(filePath: string): boolean` (line 240 of `src/plugins/java/index.ts`). The `ILanguagePlugin` interface declares `isTestFile?(filePath: string, patternConfig?: TestPatternConfig): boolean`. The call `plugin.isTestFile!(f, patternConfig)` passes `patternConfig` as the second argument. Java's implementation ignores it (the parameter is not declared), which is harmless — JavaScript silently ignores extra arguments.

**Acceptance criteria**:
- Stage 1.1 test now passes (both `RestServiceTest.java` and `IntegrationTest.java` are in `discoveredPaths`; `Core.java` is not).
- Stage 1.2 test continues to pass.
- All pre-existing tests in `tests/unit/analysis/test-analyzer.test.ts` continue to pass (they mock `discoverTestFiles` and are unaffected).
- All other test files continue to pass.

**Dependencies**: Stage 1.1 must be written first (TDD: write failing test before implementing the fix).

---

## Phase 3: Run full test suite and validate

### Stage 3.1: Run `npm test`

**Command**: `npm test`

**What to verify**:
- All tests pass, including the two new tests added in Phase 1.
- Total count is at or above the pre-change baseline (2645 tests passing before this plan).
- Zero failures and zero unexpected skips.

**Acceptance criteria**: Exit code 0, 0 failing tests.

**Dependencies**: Stage 2.1 must be complete.

---

### Stage 3.2: Build

**Command**: `npm run build`

**What to verify**:
- No TypeScript compilation errors.
- `tsc-alias` resolves path aliases correctly (no `@/analysis` resolution errors).
- `dist/` contains the updated `analysis/test-analyzer.js`.

**Acceptance criteria**: Exit code 0, no TypeScript errors.

**Dependencies**: Stage 3.1 (confirms tests pass before committing the build).

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `tests/unit/analysis/test-analyzer.test.ts` | Add imports (`JavaPlugin`, `mkdtemp`, `mkdir`, `writeFile`, `rm`, `os`, `path`) + new `describe` block with 2 tests |
| `src/analysis/test-analyzer.ts` | Insert Java glob branch (~10 lines) between lines 59 and 61 |

No new files are created. No interfaces, types, or public APIs are added or changed.
