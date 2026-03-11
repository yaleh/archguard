# Proposal: Java Multi-Module Test Discovery Fix

**Status**: Draft
**Date**: 2026-03-11
**Scope**: `src/analysis/test-analyzer.ts`, `src/cli/analyze/run-analysis.ts`, `tests/unit/analysis/test-analyzer.test.ts`, `tests/plugins/java/java-plugin.test.ts`

---

## Problem Statement

### Root Cause

When ArchGuard analyzes a Maven multi-module project (e.g. `jlama`), `detectJavaProjectStructure` in `src/cli/utils/java-project-structure-detector.ts` generates one `DiagramConfig` per sub-module:

```
jlama/overview/package    sources: [/jlama]
jlama/class/all-classes   sources: [/jlama]
jlama/class/jlama-core    sources: [/jlama/jlama-core]
jlama/class/jlama-net     sources: [/jlama/jlama-net]
jlama/class/jlama-tests   sources: [/jlama/jlama-tests]
```

Each sub-module diagram is processed independently by `ArchJsonProvider.parseGenericLanguageProject` (line 563–599 of `src/cli/processors/arch-json-provider.ts`). That method sets:

```typescript
const workspaceRoot = path.resolve(diagram.sources[0]);   // e.g. /jlama/jlama-tests
await plugin.initialize({ workspaceRoot });
return plugin.parseProject(workspaceRoot, { workspaceRoot, ... });
```

`JavaPlugin.parseProject` (line 110 of `src/plugins/java/index.ts`) copies this `workspaceRoot` directly onto the returned `ArchJSON`:

```typescript
return { ..., workspaceRoot };   // workspaceRoot === /jlama/jlama-tests
```

In `run-analysis.ts` (line 122), the test analyzer is called with:

```typescript
const analyzer = new TestAnalyzer();
const workspaceRoot = archJson.workspaceRoot ?? sessionRoot;
const testAnalysis = await analyzer.analyze(archJson, plugin, { workspaceRoot });
```

`getLastArchJson()` in `DiagramProcessor` returns the first ArchJSON parsed, unless a diagram with `queryRole === 'primary'` is encountered — in which case that primary diagram's ArchJSON replaces the stored value. For a multi-module Java project, the first ArchJSON belongs to whichever source group happens to resolve first. In practice, because the overview diagram (`sources: [/jlama]`) is listed first, its ArchJSON (with `workspaceRoot = /jlama`) is used. However, the per-module diagrams (`jlama-tests`, `jlama-net`, etc.) also each carry their own `workspaceRoot` pointing at their respective module directory.

Inside `TestAnalyzer.discoverTestFiles` (line 43–75 of `src/analysis/test-analyzer.ts`), neither the Go special case nor a `patternConfig.testFileGlobs` override applies for Java. Execution falls to `inferTestDirs` (line 77–90):

```typescript
private async inferTestDirs(workspaceRoot: string): Promise<string[]> {
  const candidates = ['tests', '__tests__', 'test', 'spec', 'src'];
  ...
  return results.length > 0 ? results : [workspaceRoot];
}
```

For `workspaceRoot = /jlama/jlama-tests`, `inferTestDirs` finds `/jlama/jlama-tests/src` (Maven's `src/test/java` lives under `src`). The glob therefore visits only `/jlama/jlama-tests/**/*`. Test files that reside in sibling modules — for instance `/jlama/jlama-net/src/test/java/...` — are never discovered.

### Why Go Does Not Have This Bug

The Go special case in `discoverTestFiles` (line 49–51) bypasses `inferTestDirs` entirely:

```typescript
if (plugin.metadata.fileExtensions.includes('.go')) {
  return globby(`${workspaceRoot}/**/*_test.go`, { onlyFiles: true, absolute: true });
}
```

Go uses a full-depth workspace glob anchored at the project root. Because Go projects have a single `go.mod`-level workspace root (resolved by `planGoAnalysisScope` before parsing), `workspaceRoot` is always the project root, not a sub-package directory.

### Testing Gap

Every test in `tests/unit/analysis/test-analyzer.test.ts` mocks `discoverTestFiles` via `vi.spyOn(analyzer as any, 'discoverTestFiles').mockResolvedValue(...)`. As a result:

- `inferTestDirs` has zero real test coverage.
- The Java-specific discovery path has zero real test coverage.
- The bug could not have been caught by the existing unit test suite.

---

## Goals

1. Java multi-module test discovery must find test files across **all** sub-modules when `workspaceRoot` is the Maven project root (`/jlama`).
2. Java test discovery must still work correctly for single-module projects where `workspaceRoot` is the project root.
3. The fix must not invent new types, interfaces, or methods beyond what already exists in the codebase.
4. New tests must exercise the **real** `discoverTestFiles` with real filesystem paths (tmp dirs or fixture directories), not mocks of that method.
5. The fix must leave the Go, TypeScript, C++, and Python discovery paths unchanged.

---

## Non-Goals

- Fixing how `workspaceRoot` is propagated through `ArchJsonProvider` for Java (a separate and larger refactor).
- Adding test coverage for `TestCoverageMapper` or `TestIssueDetector` (out of scope for this bug).
- Changing `JavaPlugin.extractTestStructure` or `JavaPlugin.isTestFile` (both work correctly).
- Changing `java-project-structure-detector.ts` (fixing discovery in `TestAnalyzer` is sufficient and less invasive).
- Supporting Gradle multi-project builds (deferred; Maven is the validated case).

---

## Design

### Fix 1: Add a Java special case in `TestAnalyzer.discoverTestFiles`

**File**: `src/analysis/test-analyzer.ts`
**Method**: `discoverTestFiles` (line 43)

The fix mirrors the existing Go special case. Because Java test files follow Maven's `src/test/java/**/*.java` convention (or naming conventions enforced by `JavaPlugin.isTestFile`), we add a full-depth glob anchored at `workspaceRoot` and then filter using `plugin.isTestFile`.

Current code (lines 43–75):

```typescript
private async discoverTestFiles(
  workspaceRoot: string,
  plugin: ILanguagePlugin,
  patternConfig?: TestPatternConfig
): Promise<string[]> {
  // Go: scan entire workspace since _test.go files live beside source
  if (plugin.metadata.fileExtensions.includes('.go')) {
    return globby(`${workspaceRoot}/**/*_test.go`, { onlyFiles: true, absolute: true });
  }

  // Use testFileGlobs from patternConfig if provided
  if (patternConfig?.testFileGlobs && patternConfig.testFileGlobs.length > 0) {
    return globby(
      patternConfig.testFileGlobs.map((g) => `${workspaceRoot}/${g}`),
      { onlyFiles: true, absolute: true }
    );
  }

  // Default: walk candidate dirs and filter with plugin.isTestFile
  const candidateDirs = await this.inferTestDirs(workspaceRoot);
  ...
```

Insertion point — after the `patternConfig` block, before the existing `inferTestDirs` fallback:

```typescript
  // Use testFileGlobs from patternConfig if provided (overrides all language defaults)
  if (patternConfig?.testFileGlobs && patternConfig.testFileGlobs.length > 0) {
    return globby(
      patternConfig.testFileGlobs.map((g) => `${workspaceRoot}/${g}`),
      { onlyFiles: true, absolute: true }
    );
  }

  // Java: scan entire workspace so multi-module projects are covered.
  if (plugin.metadata.fileExtensions.includes('.java')) {
    const allJava = await globby(`${workspaceRoot}/**/*.java`, {
      onlyFiles: true,
      absolute: true,
      ignore: ['**/target/**', '**/build/**', '**/node_modules/**'],
    });
    if (plugin.isTestFile) {
      return allJava.filter((f) => plugin.isTestFile!(f, patternConfig));
    }
    return allJava;
  }

  // Default: walk candidate dirs and filter with plugin.isTestFile
  const candidateDirs = await this.inferTestDirs(workspaceRoot);
  ...
```

**Rationale for placement**: `patternConfig.testFileGlobs` is user-supplied and must take highest precedence for all languages including Java. The Java special case comes second. The `inferTestDirs` fallback remains for TypeScript, Python, C++, and any future language without a specific override.

**Note**: `JavaPlugin.isTestFile` currently ignores `patternConfig` (its signature takes only `filePath`). Passing `patternConfig` is harmless at runtime but has no effect on filtering.

**Rationale for `ignore: ['**/target/**', '**/build/**']`**: These are Maven/Gradle output directories. `JavaPlugin.parseProject` already excludes them (line 117). Omitting them here would cause compiled test `.class` files (if Java sources were generated in target) or other artifacts to appear in the glob results, increasing noise. Since `isTestFile` filters by naming convention, false positives from these directories are likely low, but the ignore list keeps the behavior consistent with `parseProject`.

### Fix 2: Ensure `workspaceRoot` passed to `TestAnalyzer.analyze` is the project root, not a sub-module root

**Fix 2 is DROPPED from this proposal.**

The condition `archWorkspaceRoot.startsWith(sessionRoot + path.sep)` is incorrect when the analyzed source is a subdirectory of CWD but not the project root. For example, if `sessionRoot` is `/home/user/archguard` and the user analyzes `-s /home/user/archguard/src`, the condition would incorrectly replace `archJson.workspaceRoot` (which points at the source tree) with the CWD, producing the wrong root.

**Why Fix 1 alone is sufficient**: `discoverTestFiles` (with the Java special case added by Fix 1) uses `workspaceRoot/**/*.java`, which covers the entire workspace tree regardless of whether `workspaceRoot` is a module root or the project root — as long as one of the module roots is passed, all Java files under it will be found.

**Remaining limitation**: If `workspaceRoot` is a single sub-module root (e.g. `jlama-tests`), sibling modules (e.g. `jlama-net`) will not be found. This is the documented behavior captured by the second test case in Fix 3.

**Architectural fix needed (tracked, not implemented here)**: The architectural fix needed is in `src/cli/analyze/run-analysis.ts` (lines 122–124), where `workspaceRoot` is resolved from `archJson.workspaceRoot`. The MCP tools (`src/cli/mcp/tools/test-analysis-tools.ts`) only read pre-computed results from disk — they do not call `TestAnalyzer.analyze` directly. Therefore the correct fix is in `run-analysis.ts`: pass the user-supplied `sessionRoot` as the `workspaceRoot` for Java projects, rather than `archJson.workspaceRoot` (which is a module-level path). This is deferred to a future fix as it requires understanding the full session root vs archJson.workspaceRoot contract.

### Fix 3: Add real-filesystem tests for `discoverTestFiles`

**File**: `tests/unit/analysis/test-analyzer.test.ts` — the new `describe` block is **appended to the existing file**, not placed in a new file. `makeArchJson` is already defined in that file.
**File**: `tests/plugins/java/java-plugin.test.ts` (integration-style test for Java discovery)

Add the following import to the existing imports section at the top of `tests/unit/analysis/test-analyzer.test.ts`:

```typescript
import { JavaPlugin } from '@/plugins/java/index.js';
```

The tests must exercise the **real** `discoverTestFiles` by creating an actual directory structure using `os.tmpdir()` and `fs.mkdtemp`, writing `.java` fixture files, and calling `analyzer.analyze(...)` without mocking `discoverTestFiles`. They must mock only `collectRawTestFiles` (to avoid requiring tree-sitter initialization) and verify that the discovered file list includes files from sibling sub-modules.

#### New test block appended to `tests/unit/analysis/test-analyzer.test.ts`

```typescript
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
// Note: import { JavaPlugin } from '@/plugins/java/index.js'; is added to the existing imports section above.

describe('TestAnalyzer.discoverTestFiles — Java multi-module (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'archguard-java-test-'));
    // Simulate a Maven multi-module project:
    //   <tmpDir>/
    //     jlama-core/src/main/java/com/github/tjake/jlama/Core.java
    //     jlama-net/src/test/java/com/github/tjake/jlama/RestServiceTest.java
    //     jlama-tests/src/test/java/com/github/tjake/jlama/IntegrationTest.java
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
    // Do NOT mock discoverTestFiles — this tests real filesystem traversal.
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    const archJson = makeArchJson();
    await analyzer.analyze(archJson, plugin, { workspaceRoot: tmpDir });

    // Inspect which files were discovered by spying on collectRawTestFiles args
    const collectCall = (analyzer as any).collectRawTestFiles as ReturnType<typeof vi.spyOn>;
    const discoveredPaths: string[] = collectCall.mock.calls[0][0];

    expect(discoveredPaths.some((p) => p.includes('RestServiceTest.java'))).toBe(true);
    expect(discoveredPaths.some((p) => p.includes('IntegrationTest.java'))).toBe(true);
    // Non-test source files must not be included
    expect(discoveredPaths.some((p) => p.includes('Core.java'))).toBe(false);
  });

  it('discovers only test files within the given sub-module when workspaceRoot is a single sub-module root', async () => {
    const { TestAnalyzer } = await import('@/analysis/test-analyzer.js');
    const plugin = new JavaPlugin();
    await plugin.initialize({ workspaceRoot: path.join(tmpDir, 'jlama-tests') });

    const analyzer = new TestAnalyzer();
    vi.spyOn(analyzer as any, 'collectRawTestFiles').mockResolvedValue([]);

    const archJson = makeArchJson();
    await analyzer.analyze(archJson, plugin, {
      workspaceRoot: path.join(tmpDir, 'jlama-tests'),
    });

    const collectCall = (analyzer as any).collectRawTestFiles as ReturnType<typeof vi.spyOn>;
    const discoveredPaths: string[] = collectCall.mock.calls[0][0];

    // Only jlama-tests files should be found when root is restricted
    expect(discoveredPaths.some((p) => p.includes('IntegrationTest.java'))).toBe(true);
    expect(discoveredPaths.some((p) => p.includes('RestServiceTest.java'))).toBe(false);
  });
});
```

The second test documents the expected (isolated) behavior when `workspaceRoot` is intentionally scoped to a single sub-module. It serves as a regression guard: if the Java glob is ever changed to be workspaceRoot-relative with a hard-coded `..` walk, this test will catch it.

**Note on spying technique**: Because `collectRawTestFiles` is `private`, the spy uses `(analyzer as any).collectRawTestFiles`. This is consistent with the existing pattern in `tests/unit/analysis/test-analyzer.test.ts` (line 76: `vi.spyOn(analyzer as any, 'discoverTestFiles')`).

---

## Alternatives Considered

### Alternative A: Pass `sessionRoot` as `workspaceRoot` unconditionally in `run-analysis.ts`

Replacing line 122 with `const workspaceRoot = sessionRoot;` would guarantee the project root is used for test discovery regardless of what `archJson.workspaceRoot` contains. This works for the multi-module case but breaks the intended behavior when ArchGuard is run against an external project from a different working directory (e.g. `node dist/cli/index.js analyze -s /other/project --include-tests`). In that scenario, `sessionRoot` is the CWD of ArchGuard (e.g. `/home/user/archguard`), while the project-under-analysis is at `/other/project`. Using `sessionRoot` would make test discovery look in the wrong directory entirely.

**Rejected**: Breaks external project analysis.

### Alternative B: Fix `detectJavaProjectStructure` to mark the overview diagram with `queryRole: 'primary'`

`DiagramConfig` does not currently have a `queryRole` field for Java — only the TypeScript path sets this. Adding `queryRole: 'primary'` to the overview diagram in `detectJavaProjectStructure` would ensure `getLastArchJson()` always returns the project-root ArchJSON, which carries `workspaceRoot = projectRoot`. This would make Fix 2 in the Design section above unnecessary.

However, this fix alone does not solve the discovery problem: even with a project-root `workspaceRoot`, the `inferTestDirs` fallback would still scope discovery to `workspaceRoot/src` (the root `src` directory, if present), missing sub-module test directories nested under `jlama-core/src/test/java` etc.

**Rejected as sole fix**: Insufficient on its own. Could be combined with Fix 1 as a defense-in-depth improvement, but is out of scope for this proposal.

### Alternative C: Extend `inferTestDirs` to also walk Maven sub-module `src/test/java` directories

`inferTestDirs` could be extended to check for `pom.xml` in `workspaceRoot` and, if found, enumerate sub-modules and add `<module>/src/test/java` to the candidate list. This would be more conservative than the full workspace glob in Fix 1 and might be faster for very large repositories.

**Rejected**: Requires parsing `pom.xml` inside `inferTestDirs`, which duplicates logic from `readMavenModules` in `java-project-structure-detector.ts`. The full-depth glob approach in Fix 1 is simpler, consistent with Go's approach, and `JavaPlugin.isTestFile` already provides the filter that prevents non-test files from being collected.

### Alternative D: Add a `testFileGlobs` default to `JavaPlugin` and use `patternConfig`

The Java plugin could expose a static `testFileGlobs` list (e.g. `['**/src/test/**/*.java', '**/*Test.java', '**/*Tests.java']`) and the `TestAnalyzer.discoverTestFiles` `patternConfig` block would pick it up automatically. However, `patternConfig` is user-supplied and optional — there is no mechanism to pass plugin-defined defaults through `patternConfig` without modifying the `TestAnalyzerOptions` or `ILanguagePlugin` interfaces. Introducing a `defaultPatternConfig?` property on `ILanguagePlugin` would be a larger interface change.

**Rejected**: Requires interface changes to `ILanguagePlugin` that go beyond the scope of this bug fix.

---

## Open Questions

1. **Performance on very large monorepos**: The full-depth `**/*.java` glob with `ignore: ['**/target/**', '**/build/**']` may be slow for repositories with hundreds of thousands of Java files. Should a depth limit (e.g. `globby` `deep` option) be applied? The Go glob has no depth limit and has not reported perf issues. Deferring unless a concrete benchmark shows a problem.

2. **Gradle multi-project support**: `java-project-structure-detector.ts` only reads Maven's `pom.xml` to enumerate sub-modules. For Gradle projects with `settings.gradle`, sub-modules are declared differently. Fix 1 (the full-depth glob) will work for Gradle multi-project builds too, since it does not depend on module enumeration. But the `ignore` list only excludes `build/` and `target/` — Gradle projects may also place test outputs in `out/` or `.gradle/`. This should be addressed in a follow-up.

3. **`workspaceRoot` in `TestFileInfo.id`**: `buildTestFileInfos` (line 112 of `test-analyzer.ts`) computes `TestFileInfo.id` as `path.relative(workspaceRoot, raw.filePath)`. When `workspaceRoot` is the project root (e.g. `/jlama`) and a test file is `/jlama/jlama-net/src/test/java/RestServiceTest.java`, the id becomes `jlama-net/src/test/java/RestServiceTest.java`. This is the desired behavior — IDs are project-relative. However, the `resolveImportedEntityIds` method (line 151) also uses `workspaceRoot` to relativize entity file paths. If `workspaceRoot` is a sub-module root, entity IDs may not match the test file paths and coverage linking will silently fail. The architectural fix noted in Fix 2 (passing `projectRoot` from the MCP tool argument) addresses this secondary issue.

4. **`_lastArchJson` and multi-diagram runs**: `DiagramProcessor.getLastArchJson()` stores the ArchJSON from whichever source group resolves first, unless a `queryRole === 'primary'` diagram is found. The Java detection path in `run-analysis.ts` depends on this being the overview ArchJSON (with project-root `workspaceRoot`). This is currently true because the overview diagram is always first in the slice returned by `detectJavaProjectStructure`, but it is fragile. A proper fix would be to store all ArchJSONs per language and let `run-analysis.ts` select the widest one (the one whose `workspaceRoot` is the common ancestor of all). This is out of scope here but should be tracked.
