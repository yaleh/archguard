# Plan 36: Java Maven Cross-Module Dependency Edges

**Status**: Draft
**Date**: 2026-03-13
**Proposal**: `docs/proposals/proposal-java-maven-crossmodule-deps.md`

---

## Overview

Parse per-sub-module `pom.xml` files in Maven multi-module Java projects to emit cross-module
`dependency` relations in ArchJSON. This fixes the confirmed Jlama gap where three module-level
relations (`jlama-cli → jlama-core`, `jlama-cli → jlama-net`, `jlama-net → jlama-core`) were
absent from the package diagram despite being explicitly declared in `pom.xml`.

The change is **additive only** — new relations are merged into the existing `relations` array
alongside the existing class-level relations. No entity IDs, renderers, or diagram structures
are changed.

Estimated total: ~305 lines across 4 files. Within the 200-line-per-stage and 500-line-per-phase
limits.

---

## Phase Dependencies

```
Phase 1 (MavenCrossModuleParser — data layer)
  └─► Phase 2 (Wire into JavaPlugin.parseProject())
        └─► Phase 3 (Validation)
```

Each phase is independently testable. Phase 2 cannot start before Phase 1 is green.

---

## Phase 1 — MavenCrossModuleParser: data layer

**Goal**: Implement `MavenCrossModuleParser` with full unit test coverage. The class can be
exercised in isolation without running the full Java plugin pipeline. Phase 2 wires it in.

**Files touched**:
- `tests/unit/plugins/java/maven-crossmodule-parser.test.ts` (Stage 1.1 — failing tests first)
- `src/plugins/java/maven-crossmodule-parser.ts` (Stage 1.2 — implementation)

**Acceptance criteria**:
- All 7 unit tests from Stage 1.1 pass.
- `npm run type-check` passes with no new errors.
- `MavenCrossModuleParser` has zero side-effects outside its methods (no global state).

**Estimated code**: ~120 lines test + ~100 lines implementation = ~220 lines. Within limits.

---

### Stage 1.1 — Write 7 failing tests for `MavenCrossModuleParser`

**File**: `tests/unit/plugins/java/maven-crossmodule-parser.test.ts`

**New file**. Import `MavenCrossModuleParser` (which does not exist yet — all tests fail red
until Stage 1.2 is complete).

The parser's public API:

```typescript
interface ModuleDependency {
  from: string;  // sub-module directory name (or artifactId)
  to: string;    // sub-module directory name (or artifactId)
}

class MavenCrossModuleParser {
  // Parse all sub-module pom.xml files one level deep under workspaceRoot.
  // Returns resolved intra-workspace cross-module dependencies.
  async parse(workspaceRoot: string): Promise<ModuleDependency[]>;
}
```

The `parse()` method is async (reads files from disk). In tests, use a temp-dir fixture or
mock `fs-extra`.

**Test cases**:

| # | Name | Fixture | Expected outcome |
|---|------|---------|-----------------|
| 1 | Single sub-module, one dependency | `cli/pom.xml` declares dep on `core`; `core/pom.xml` exists; `core` is a known sub-module | Returns `[{ from: 'cli', to: 'core' }]` |
| 2 | Multiple dependencies | `cli/pom.xml` declares deps on `core` and `net`; all three sub-modules exist | Returns `[{ from: 'cli', to: 'core' }, { from: 'cli', to: 'net' }]` |
| 3 | Test-scope dependency excluded | `cli/pom.xml` declares `net` with `<scope>test</scope>` | Returns `[]` (test scope skipped) |
| 4 | Runtime-scope dependency included | `cli/pom.xml` declares `core` with `<scope>runtime</scope>` | Returns `[{ from: 'cli', to: 'core' }]` |
| 5 | External dependency excluded | `cli/pom.xml` declares `jackson-databind` (not a known sub-module) | Returns `[]` |
| 6 | Multiple sub-modules, all pairs | `cli→core`, `cli→net`, `net→core` across three pom.xml files | Returns all three `ModuleDependency` records, no duplicates |
| 7 | `<dependencyManagement>` section not treated as direct dep | Root pom has `<dependencyManagement>` listing `core`; no sub-module pom with direct dep | Returns `[]` |

**Test skeleton** (illustrating approach):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { MavenCrossModuleParser } from '@/plugins/java/maven-crossmodule-parser.js';

describe('MavenCrossModuleParser', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-maven-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writePom(subDir: string, content: string): Promise<void> {
    const dir = path.join(tmpDir, subDir);
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'pom.xml'), content, 'utf-8');
  }

  it('returns one dependency when cli pom declares core as dependency', async () => {
    await writePom('core', `<project><artifactId>core</artifactId></project>`);
    await writePom('cli', `
      <project>
        <artifactId>cli</artifactId>
        <dependencies>
          <dependency>
            <groupId>com.example</groupId>
            <artifactId>core</artifactId>
            <version>1.0</version>
          </dependency>
        </dependencies>
      </project>
    `);
    const parser = new MavenCrossModuleParser();
    const result = await parser.parse(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: 'cli', to: 'core' });
  });

  // ... (remaining 6 tests follow the same pattern)
});
```

**Verify after Stage 1.1**:

```bash
npm test -- tests/unit/plugins/java/maven-crossmodule-parser.test.ts
# Expected: 7 failures (red — implementation does not exist yet)
```

---

### Stage 1.2 — Implement `MavenCrossModuleParser`

**File**: `src/plugins/java/maven-crossmodule-parser.ts`

**New file**. Implementation summary:

1. `parse(workspaceRoot)`:
   - Glob `*/pom.xml` under `workspaceRoot` (one level deep).
   - For each found pom.xml, extract the sub-module directory name (the `*` component).
   - Build `knownModules: Set<string>` from all discovered sub-module directory names.
   - For each sub-module pom, call `parsePomDependencies(pomPath)` to get the list of
     `<artifactId>` + `<scope>` pairs declared under `<dependencies>` (not
     `<dependencyManagement>`).
   - Filter to artifactIds that are in `knownModules` and not test-scoped.
   - Emit `ModuleDependency { from: subModuleDir, to: artifactId }`.
   - Deduplicate with a `Set<string>` keyed on `from:to`.
   - Return the resolved list.

2. `parsePomDependencies(pomPath)`: reads the pom.xml and uses regex to extract `<dependency>`
   blocks. For each block, extracts `<artifactId>` and optional `<scope>`. Returns
   `Array<{ artifactId: string; scope: string }>`.

**Key implementation constraints**:
- Use `fs-extra` for file I/O (consistent with rest of plugin).
- Regex for `<dependency>` block: `/<dependency>([\s\S]*?)<\/dependency>/g` then extract
  `<artifactId>(.*?)<\/artifactId>` and `<scope>(.*?)<\/scope>` from the matched block.
- Must **not** match `<dependency>` blocks that are nested inside `<dependencyManagement>` —
  strip the `<dependencyManagement>...</dependencyManagement>` section before applying the
  dependency regex. Simple approach: remove the `<dependencyManagement>` block from the string
  before pattern matching.
- Scope filter: skip if `scope` is `test`. Include all other scopes (compile, runtime, provided,
  system, no-scope defaults to compile).

**Implementation sketch**:

```typescript
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

export interface ModuleDependency {
  from: string;
  to: string;
}

export class MavenCrossModuleParser {
  async parse(workspaceRoot: string): Promise<ModuleDependency[]> {
    const pomPaths = await glob('*/pom.xml', { cwd: workspaceRoot, absolute: true });

    // Build registry of known sub-module names
    const knownModules = new Set(pomPaths.map((p) =>
      path.relative(workspaceRoot, path.dirname(p))
    ));

    const results: ModuleDependency[] = [];
    const seen = new Set<string>();

    for (const pomPath of pomPaths) {
      const fromModule = path.relative(workspaceRoot, path.dirname(pomPath));
      const deps = await this.parsePomDependencies(pomPath);

      for (const dep of deps) {
        if (dep.scope === 'test') continue;
        if (!knownModules.has(dep.artifactId)) continue;
        if (dep.artifactId === fromModule) continue; // self-dep guard
        const key = `${fromModule}:${dep.artifactId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ from: fromModule, to: dep.artifactId });
      }
    }

    return results;
  }

  private async parsePomDependencies(
    pomPath: string
  ): Promise<Array<{ artifactId: string; scope: string }>> {
    try {
      let content = await fs.readFile(pomPath, 'utf-8');
      // Remove <dependencyManagement> sections to avoid false positives
      content = content.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '');

      const results: Array<{ artifactId: string; scope: string }> = [];
      const depBlockRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
      let match: RegExpExecArray | null;

      while ((match = depBlockRegex.exec(content)) !== null) {
        const block = match[1];
        const artifactMatch = /<artifactId>(.*?)<\/artifactId>/.exec(block);
        if (!artifactMatch) continue;
        const scopeMatch = /<scope>(.*?)<\/scope>/.exec(block);
        results.push({
          artifactId: artifactMatch[1].trim(),
          scope: scopeMatch ? scopeMatch[1].trim() : 'compile',
        });
      }

      return results;
    } catch {
      return [];
    }
  }
}
```

**Verify after Stage 1.2**:

```bash
npm test -- tests/unit/plugins/java/maven-crossmodule-parser.test.ts
npm run type-check
```

All 7 tests green. No regressions elsewhere.

---

## Phase 2 — Wire into `JavaPlugin.parseProject()`

**Goal**: Call `MavenCrossModuleParser.parse()` from `parseProject()` and merge the resulting
`ModuleDependency` records into the `relations` array as ArchJSON `Relation` objects.

**Files touched**:
- `tests/unit/plugins/java/java-plugin.test.ts` (Stage 2.1 — new test group)
- `src/plugins/java/index.ts` (Stage 2.2 — wiring)

**Acceptance criteria**:
- New test group in Stage 2.1 passes (all existing tests still pass).
- `parseProject()` for a single-module project (no sub-module poms) behaves identically to
  before (zero new cross-module relations; no errors).
- `parseProject()` for a multi-module fixture returns the expected cross-module `dependency`
  relations in addition to the class-level ones.
- `npm run type-check` passes.

**Estimated code**: ~60 lines test + ~25 lines implementation = ~85 lines. Within limits.

---

### Stage 2.1 — Add `parseProject cross-module relations` test group

**File**: `tests/unit/plugins/java/java-plugin.test.ts`

Add a new `describe` block after the existing Java plugin tests. The fixture uses a temp
directory with minimal `.java` files and `pom.xml` content.

**Fixture**: Two-module Jlama-like layout:

```
<tmpDir>/
  jlama-core/
    pom.xml                  (artifactId: jlama-core, no <dependencies>)
    src/main/java/
      com/example/core/
        CoreService.java     (package com.example.core; public class CoreService {})
  jlama-cli/
    pom.xml                  (artifactId: jlama-cli, depends on jlama-core)
    src/main/java/
      com/example/cli/
        Main.java            (package com.example.cli; public class Main {})
```

**Expected**: `parseProject()` returns ArchJSON with a `dependency` relation where
`source` resolves to `jlama-cli`'s package namespace and `target` resolves to `jlama-core`'s
package namespace.

**Test skeleton**:

```typescript
describe('parseProject — cross-module pom.xml relations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-java-pm-'));
  });
  afterEach(async () => { await fs.remove(tmpDir); });

  it('emits dependency relation from pom.xml cross-module dep', async () => {
    // Write jlama-core
    const coreDir = path.join(tmpDir, 'jlama-core');
    await fs.ensureDir(path.join(coreDir, 'src/main/java/com/example/core'));
    await fs.writeFile(
      path.join(coreDir, 'pom.xml'),
      '<project><artifactId>jlama-core</artifactId></project>'
    );
    await fs.writeFile(
      path.join(coreDir, 'src/main/java/com/example/core/CoreService.java'),
      'package com.example.core; public class CoreService {}'
    );

    // Write jlama-cli with dep on jlama-core
    const cliDir = path.join(tmpDir, 'jlama-cli');
    await fs.ensureDir(path.join(cliDir, 'src/main/java/com/example/cli'));
    await fs.writeFile(
      path.join(cliDir, 'pom.xml'),
      `<project><artifactId>jlama-cli</artifactId>
       <dependencies>
         <dependency>
           <groupId>com.example</groupId>
           <artifactId>jlama-core</artifactId>
         </dependency>
       </dependencies>
      </project>`
    );
    await fs.writeFile(
      path.join(cliDir, 'src/main/java/com/example/cli/Main.java'),
      'package com.example.cli; public class Main {}'
    );

    const plugin = new JavaPlugin();
    await plugin.initialize({});
    const result = await plugin.parseProject(tmpDir, { excludePatterns: [] });

    const crossModuleDeps = result.relations.filter(
      (r) => r.type === 'dependency' && r.source.includes('cli') && r.target.includes('core')
    );
    expect(crossModuleDeps.length).toBeGreaterThanOrEqual(1);
  });
});
```

**Verify after Stage 2.1**:

```bash
npm test -- tests/unit/plugins/java/java-plugin.test.ts
# Expected: new test fails (implementation not wired yet)
```

---

### Stage 2.2 — Wire `MavenCrossModuleParser` into `parseProject()`

**File**: `src/plugins/java/index.ts`

**Changes**:

1. Import `MavenCrossModuleParser` and `ModuleDependency`.
2. After the `.java` file parsing loop (before `return`), call
   `new MavenCrossModuleParser().parse(workspaceRoot)`.
3. Build a `moduleToPackagePrefix` map: for each sub-module name found by the parser, scan
   `entities` for any entity whose `sourceLocation.file` path contains `/<moduleName>/`, and
   take the `packageName` (top-level Java package) of the first matching entity as the
   representative package prefix.
4. For each `ModuleDependency { from, to }`, look up the package prefixes and emit a
   `Relation { type: 'dependency', source: fromPkgPrefix, target: toPkgPrefix }` if both
   prefixes are found. Deduplicate with the existing `seen` set pattern.
5. Merge the cross-module relations into the `relations` array.

**Implementation sketch for the wiring block** (inside `parseProject()` after `const relations = ...`):

```typescript
// Add Maven cross-module dependency relations
try {
  const crossModuleDeps = await new MavenCrossModuleParser().parse(workspaceRoot);
  if (crossModuleDeps.length > 0) {
    // Build sub-module → representative Java package prefix map
    const modulePackageMap = new Map<string, string>();
    for (const entity of entities) {
      if (!entity.sourceLocation?.file) continue;
      const relFile = path.relative(workspaceRoot, entity.sourceLocation.file);
      const moduleName = relFile.split('/')[0];
      if (!modulePackageMap.has(moduleName) && entity.id.includes('.')) {
        // Use the top-level package as the prefix (everything up to the last dot)
        const pkgPrefix = entity.id.split('.').slice(0, -1).join('.');
        modulePackageMap.set(moduleName, pkgPrefix);
      }
    }

    const crossSeen = new Set<string>();
    for (const dep of crossModuleDeps) {
      const srcPkg = modulePackageMap.get(dep.from);
      const tgtPkg = modulePackageMap.get(dep.to);
      if (!srcPkg || !tgtPkg) continue;
      const key = `dependency:${srcPkg}:${tgtPkg}`;
      if (crossSeen.has(key)) continue;
      crossSeen.add(key);
      relations.push({
        id: key,
        type: 'dependency',
        source: srcPkg,
        target: tgtPkg,
        inferenceSource: 'explicit',
      });
    }
  }
} catch (error) {
  console.warn('Failed to parse Maven cross-module dependencies:', error);
}
```

**Verify after Stage 2.2**:

```bash
npm test -- tests/unit/plugins/java/java-plugin.test.ts
npm test -- tests/unit/plugins/java/maven-crossmodule-parser.test.ts
npm run type-check
```

All tests green. No regressions in existing Java plugin tests.

---

## Phase 3 — Validation

**Goal**: Full test suite remains green; manual smoke test on Jlama confirms the three missing
relations now appear in the package diagram. No code changes in this phase.

**Acceptance criteria**:
- `npm test` shows 0 failures.
- Running ArchGuard on the Jlama project produces ArchJSON with `dependency` relations for all
  three previously-missing module pairs.
- Package diagram (Mermaid flowchart) shows `jlama-cli --> jlama-core`,
  `jlama-cli --> jlama-net`, and `jlama-net --> jlama-core` arrows.
- Previously present relations (`jlama-tests → jlama-core`, `jlama-core → jlama-native`,
  `jlama-native → jlama-core`) are still present.

---

### Stage 3.1 — Full test suite green

```bash
npm test
npm run type-check
npm run lint
```

Expected: same pass count as before + the new tests added in Phases 1–2. Zero failures.

---

### Stage 3.2 — Smoke test on Jlama

```bash
npm run build
node dist/cli/index.js analyze -s /path/to/jlama --lang java -f json \
  | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
      const deps = d.relations.filter(r => r.type === 'dependency');
      console.log('total dependency relations:', deps.length);
      deps.forEach(r => console.log(' ', r.source, '->', r.target));
    "
```

Expected output includes:
```
<jlama-cli pkg> -> <jlama-core pkg>
<jlama-cli pkg> -> <jlama-net pkg>
<jlama-net pkg> -> <jlama-core pkg>
```

Previously present class-level relations also appear.

---

### Stage 3.3 — Package diagram shows all six arrows

```bash
node dist/cli/index.js analyze -s /path/to/jlama --lang java --diagrams package
# Open .archguard/overview/package.md
```

Verify that the Mermaid flowchart diagram contains all six expected `-->` arrows (3 pre-existing
class-level + 3 new pom.xml-derived).

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Module dir name differs from artifactId | Low | Medium | Parse `<artifactId>` from each sub-module's own pom.xml; build artifact→dir map for resolution |
| `modulePackageMap` empty for a module (no entities parsed from it) | Low | Low | Cross-module relation silently skipped; no crash; warn in verbose mode |
| Regex mis-matches `<dependency>` inside XML comments | Very Low | Low | Strip XML comments before parsing (add `content.replace(/<!--[\s\S]*?-->/g, '')`) |
| `<dependencyManagement>` regex removal misses edge cases | Low | Low | Test case 7 in Stage 1.1 specifically covers this; caught early |
| Gradle-only sub-modules (no pom.xml) | Low | None | Glob only finds `*/pom.xml`; Gradle modules silently skipped |
| `parseProject` throws if `MavenCrossModuleParser.parse()` throws | Very Low | Low | Wrap in `try/catch` with `console.warn` (see Stage 2.2 sketch); never propagates |
| entity `id` format differs from assumed `pkg.ClassName` | Low | Medium | Use `entity.sourceLocation.file` path prefix as fallback if entity ID doesn't contain `.` |

---

## Summary

| Phase | Stages | Key files | ~Lines changed | Independently testable |
|-------|--------|-----------|----------------|------------------------|
| 1 — Parser | 1.1 (tests), 1.2 (impl) | `maven-crossmodule-parser.ts`, `maven-crossmodule-parser.test.ts` | ~220 | Yes — pure class |
| 2 — Wiring | 2.1 (tests), 2.2 (impl) | `java-plugin.test.ts`, `index.ts` | ~85 | Yes — full plugin |
| 3 — Validation | 3.1 (suite), 3.2 (smoke), 3.3 (diagram) | None (build + manual) | 0 | N/A — validation only |
| **Total** | 5 stages | 4 files | **~305** | — |
