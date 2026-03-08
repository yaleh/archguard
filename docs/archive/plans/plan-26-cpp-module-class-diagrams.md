# Plan 26: C++ Module-Level Class Diagrams — Development Plan

> Source proposal: `docs/proposals/proposal-cpp-module-class-diagrams.md`
> Branch: `feat/cpp`
> Status: Draft

---

## Overview

Three phases. All phases are in `feat/cpp`; each must pass `npm test` independently.

| Phase | Scope | New files | Modified files | Dependency |
|-------|-------|-----------|----------------|------------|
| Phase 1 | `CppProjectStructureDetector` (TDD) | 2 | 0 | None |
| Phase 2 | `diagram-processor.ts` dual fix + `analyze.ts` integration | 0 | 2 | Phase 1 API stable |
| Phase 3 | Build + validate against llama.cpp | 0 | 0 | Phase 2 complete |

**Recommended order**: 1 → 2 → 3. Phase 1 Stage 1-2 (`deriveSubModuleArchJSON` fix) may be developed in parallel with Phase 1 as it touches a different file.

---

## Pre-flight

```bash
npm test
# Expected: 2102 tests, 2 failed (pre-existing timing flakiness in full-workflow.test.ts only)

npm run type-check
# Expected: 0 errors

node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard
# Baseline: package(79e/38r) + class(5698e/1836r), exactly 2 diagrams generated

grep -n "language === 'cpp'" src/cli/processors/diagram-processor.ts
# Expected: ~line 447, inside processSourceGroup() — confirm routing location before modifying

grep -c "language === 'cpp'" src/cli/commands/analyze.ts
# Expected: 1 — the single C++ branch we will replace
```

---

## Phase 1 — `CppProjectStructureDetector` (TDD)

### Objectives

1. Implement `directoryHasCppFiles(dir)` — recursive, stops at first match
2. Implement `getCppTopLevelModules(sourceRoot)` — sorted, excludes build/vendor dirs
3. Implement `detectCppProjectStructure(sourceRoot, moduleName, options?)` — produces DiagramConfig[]

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/utils/cpp-project-structure-detector.ts` | Create | C++ directory structure detector |
| `tests/unit/cli/utils/cpp-project-structure-detector.test.ts` | Create | Unit tests (written first) |

---

### Stage 1-0 — Verify baseline

```bash
npm test
# 0 new failures
ls src/cli/utils/
# Confirm: project-structure-detector.ts exists (reference), cpp-project-structure-detector.ts does NOT yet exist
```

---

### Stage 1-1 — Write tests first

**`tests/unit/cli/utils/cpp-project-structure-detector.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  directoryHasCppFiles,
  getCppTopLevelModules,
  detectCppProjectStructure,
} from '@/cli/utils/cpp-project-structure-detector.js';

/** Build a temp dir tree. Returns the root path. */
async function makeTempTree(
  structure: Record<string, string | null>
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-cpp-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(root, rel);
    await fs.ensureDir(path.dirname(abs));
    if (content !== null) await fs.writeFile(abs, content ?? '');
  }
  return root;
}

describe('directoryHasCppFiles', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-')); });
  afterEach(async () => { await fs.remove(tmpDir); });

  it('returns true when directory contains a .cpp file', async () => {
    await fs.writeFile(path.join(tmpDir, 'main.cpp'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(true);
  });

  it('returns true when directory contains a .h file', async () => {
    await fs.writeFile(path.join(tmpDir, 'foo.h'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(true);
  });

  it('returns true when cpp file is in a subdirectory (recursive)', async () => {
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'foo.cpp'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(true);
  });

  it('returns false when directory contains only .md files', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '');
    expect(await directoryHasCppFiles(tmpDir)).toBe(false);
  });

  it('returns false for an empty directory', async () => {
    expect(await directoryHasCppFiles(tmpDir)).toBe(false);
  });

  it('returns false for a non-existent path', async () => {
    expect(await directoryHasCppFiles(path.join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('getCppTopLevelModules', () => {
  let root: string;
  afterEach(async () => { await fs.remove(root); });

  it('returns sorted list of dirs that contain C++ files', async () => {
    root = await makeTempTree({
      'src/engine.cpp': '',
      'tests/test.cpp': '',
      'docs/README.md': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src', 'tests']);
  });

  it('skips build/ directory', async () => {
    root = await makeTempTree({ 'build/output.cpp': '', 'src/main.cpp': '' });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips vendor/ directory', async () => {
    root = await makeTempTree({ 'vendor/lib.cpp': '', 'src/main.cpp': '' });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips cmake-build-release/ (prefix match, not exact)', async () => {
    root = await makeTempTree({
      'cmake-build-release/foo.cpp': '',
      'cmake-build-relwithdebinfo/bar.cpp': '',
      'src/main.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('skips hidden directories (starting with dot)', async () => {
    root = await makeTempTree({ '.cache/foo.cpp': '', 'src/main.cpp': '' });
    expect(await getCppTopLevelModules(root)).toEqual(['src']);
  });

  it('returns [] when no dirs with cpp files exist', async () => {
    root = await makeTempTree({ 'docs/README.md': '' });
    expect(await getCppTopLevelModules(root)).toEqual([]);
  });

  it('returns sorted alphabetically', async () => {
    root = await makeTempTree({
      'zzz/a.cpp': '', 'aaa/b.cpp': '', 'mmm/c.cpp': '',
    });
    expect(await getCppTopLevelModules(root)).toEqual(['aaa', 'mmm', 'zzz']);
  });
});

describe('detectCppProjectStructure', () => {
  let root: string;
  afterEach(async () => { await fs.remove(root); });

  it('returns [package, class] when no subdirs with cpp files', async () => {
    root = await makeTempTree({ 'main.cpp': '' });
    const result = await detectCppProjectStructure(root, 'myproject');
    expect(result).toHaveLength(2);
    expect(result[0].level).toBe('package');
    expect(result[1].level).toBe('class');
    expect(result.every(d => d.language === 'cpp')).toBe(true);
  });

  it('returns package + class + N class/<dir> for N subdirs', async () => {
    root = await makeTempTree({
      'engine/renderer.cpp': '',
      'common/utils.cpp': '',
    });
    const result = await detectCppProjectStructure(root, 'game');
    expect(result).toHaveLength(4); // package + class + class/common + class/engine
    expect(result[0]).toMatchObject({ name: 'game/package', level: 'package', language: 'cpp' });
    expect(result[1]).toMatchObject({ name: 'game/class',   level: 'class',   language: 'cpp' });
    expect(result[2]).toMatchObject({ name: 'game/class/common', sources: [path.join(root, 'common')], level: 'class', language: 'cpp' });
    expect(result[3]).toMatchObject({ name: 'game/class/engine', sources: [path.join(root, 'engine')], level: 'class', language: 'cpp' });
  });

  it('root (package + class) diagrams use sourceRoot as sources[0]', async () => {
    root = await makeTempTree({ 'src/main.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj');
    expect(result[0].sources[0]).toBe(root);
    expect(result[1].sources[0]).toBe(root);
  });

  it('all DiagramConfigs carry language: cpp', async () => {
    root = await makeTempTree({ 'src/a.cpp': '', 'lib/b.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj');
    expect(result.every(d => d.language === 'cpp')).toBe(true);
  });

  it('passes format option through to all DiagramConfigs', async () => {
    root = await makeTempTree({ 'src/a.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj', { format: 'json' });
    expect(result.every(d => d.format === 'json')).toBe(true);
  });

  it('passes exclude option through to all DiagramConfigs', async () => {
    root = await makeTempTree({ 'src/a.cpp': '' });
    const result = await detectCppProjectStructure(root, 'proj', { exclude: ['**/test*'] });
    expect(result.every(d => d.exclude?.includes('**/test*'))).toBe(true);
  });

  it('skips subdir with only non-cpp files from per-module list', async () => {
    root = await makeTempTree({
      'src/main.cpp': '',
      'docs/README.md': '',
    });
    const result = await detectCppProjectStructure(root, 'proj');
    const names = result.map(d => d.name);
    expect(names).not.toContain('proj/class/docs');
    expect(names).toContain('proj/class/src');
  });
});
```

Run to confirm all tests fail (red):

```bash
npx vitest run tests/unit/cli/utils/cpp-project-structure-detector.test.ts
# Expected: all tests fail (module not found)
```

---

### Stage 1-2 — Implement `cpp-project-structure-detector.ts`

**`src/cli/utils/cpp-project-structure-detector.ts`**

```typescript
import fs from 'fs-extra';
import path from 'path';
import type { DiagramConfig } from '../../types/config.js';

export const CPP_EXTENSIONS = ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h', '.h++'];

const CPP_EXCLUDED_DIRS = new Set([
  'build', '.cmake',
  'vendor', 'third_party', 'thirdparty', 'external',
  'node_modules', '.git', 'dist',
  '.cache', '.tmp', 'tmp',
  'docs', 'doc', 'media', 'licenses',
  'scripts', 'ci',
]);

function isExcluded(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (name.startsWith('cmake-build-')) return true;
  return CPP_EXCLUDED_DIRS.has(name);
}

export async function directoryHasCppFiles(dir: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && CPP_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      return true;
    }
    if (entry.isDirectory() && !isExcluded(entry.name)) {
      if (await directoryHasCppFiles(path.join(dir, entry.name))) return true;
    }
  }
  return false;
}

export async function getCppTopLevelModules(sourceRoot: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const modules: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isExcluded(entry.name)) continue;
    if (await directoryHasCppFiles(path.join(sourceRoot, entry.name))) {
      modules.push(entry.name);
    }
  }
  return modules.sort();
}

export async function detectCppProjectStructure(
  sourceRoot: string,
  moduleName: string,
  options?: { format?: string; exclude?: string[] },
): Promise<DiagramConfig[]> {
  const common: Partial<DiagramConfig> = {
    language: 'cpp',
    ...(options?.format  !== undefined && { format:  options.format  as DiagramConfig['format'] }),
    ...(options?.exclude !== undefined && { exclude: options.exclude }),
  };

  const root: DiagramConfig[] = [
    { ...common, name: `${moduleName}/package`, sources: [sourceRoot], level: 'package' },
    { ...common, name: `${moduleName}/class`,   sources: [sourceRoot], level: 'class'   },
  ];

  const modules = await getCppTopLevelModules(sourceRoot);

  const perModule: DiagramConfig[] = modules.map((mod) => ({
    ...common,
    name: `${moduleName}/class/${mod}`,
    sources: [path.join(sourceRoot, mod)],
    level: 'class',
  }));

  return [...root, ...perModule];
}
```

Run tests to confirm green:

```bash
npx vitest run tests/unit/cli/utils/cpp-project-structure-detector.test.ts
# Expected: all tests pass

npm run type-check
# Expected: 0 errors
```

---

## Phase 2 — `diagram-processor.ts` Dual Fix + `analyze.ts` Integration

### Objectives

1. **(2-A)** Fix `deriveSubModuleArchJSON` to use `sourceLocation.file` as final path fallback for C++ entities
2. **(2-B)** Fix `processSourceGroup` C++ branch to check `findParentCoverage` before parsing — enables "parse once, derive N" pattern
3. **(2-C)** Replace hardcoded 2-diagram C++ block in `analyze.ts` with `detectCppProjectStructure` call

**Prerequisite**: Phase 1 API (`detectCppProjectStructure` signature) must be stable before 2-C.

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/cli/processors/diagram-processor.ts` | Modify | Fix 2-A: `deriveSubModuleArchJSON`; Fix 2-B: C++ branch in `processSourceGroup` |
| `src/cli/commands/analyze.ts` | Modify | Fix 2-C: call `detectCppProjectStructure` |
| `tests/unit/cli/processors/diagram-processor.test.ts` | Modify | Tests for 2-A and 2-B |

---

### Stage 2-0 — Confirm baseline

```bash
npm test
# 0 new failures since Phase 1

# Locate the exact lines we will touch:
grep -n "sourceLocation\|filePath\|fp = " src/cli/processors/diagram-processor.ts | head -20
# Confirm the 3-line entity filter block inside deriveSubModuleArchJSON (~lines 120-125)

grep -n "language === 'cpp'" src/cli/processors/diagram-processor.ts
# Confirm: 1 match, inside processSourceGroup — this block will be expanded
```

---

### Stage 2-1 — Write tests first (2-A: `deriveSubModuleArchJSON`)

Extend `tests/unit/cli/processors/diagram-processor.test.ts`, finding the existing `describe('deriveSubModuleArchJSON')` block and appending:

```typescript
it('filters C++ entities by sourceLocation.file (absolute path)', () => {
  const parent: ArchJSON = {
    version: '1.0', language: 'cpp', timestamp: '',
    sourceFiles: [],
    entities: [
      {
        id: 'ggml.ggml_tensor', name: 'ggml_tensor', type: 'struct',
        visibility: 'public', members: [],
        sourceLocation: { file: '/proj/ggml/ggml.h', startLine: 1, endLine: 10 },
      },
      {
        id: 'src.llama_model', name: 'llama_model', type: 'class',
        visibility: 'public', members: [],
        sourceLocation: { file: '/proj/src/llama.cpp', startLine: 1, endLine: 50 },
      },
    ],
    relations: [],
  };
  const derived = deriveSubModuleArchJSON(parent, '/proj/ggml');
  expect(derived.entities).toHaveLength(1);
  expect(derived.entities[0].name).toBe('ggml_tensor');
});

it('does not filter TypeScript entities when sourceLocation.file is absent on the path', () => {
  // Ensures the new fallback is truly last-resort and doesn't break TS entity extraction
  const parent: ArchJSON = {
    version: '1.0', language: 'typescript', timestamp: '',
    sourceFiles: [],
    entities: [
      {
        id: 'cli/commands.AnalyzeCommand', name: 'AnalyzeCommand', type: 'class',
        visibility: 'public', members: [],
        // filePath is carried as a non-schema field by TypeScript parser
        sourceLocation: { file: 'cli/commands/analyze.ts', startLine: 1, endLine: 100 },
      } as any,
    ],
    relations: [],
  };
  // TypeScript entity has no filePath field but has the id-based prefix 'cli/commands'
  // The existing id-extraction path must still handle it; sourceLocation.file fallback should not interfere
  const derived = deriveSubModuleArchJSON(parent, '/abs/src/cli', '/abs/src');
  expect(derived.entities).toHaveLength(1);
});

it('excludes C++ entity whose sourceLocation.file is in a sibling directory', () => {
  const parent: ArchJSON = {
    version: '1.0', language: 'cpp', timestamp: '',
    sourceFiles: [],
    entities: [
      {
        id: 'src.Foo', name: 'Foo', type: 'class',
        visibility: 'public', members: [],
        sourceLocation: { file: '/proj/src/foo.h', startLine: 1, endLine: 5 },
      },
    ],
    relations: [],
  };
  const derived = deriveSubModuleArchJSON(parent, '/proj/ggml');
  expect(derived.entities).toHaveLength(0);
});
```

Run to confirm red:

```bash
npx vitest run tests/unit/cli/processors/diagram-processor.test.ts \
  --reporter=verbose 2>&1 | grep -A2 "sourceLocation.file"
# Expected: tests fail (sourceLocation.file fallback not yet implemented)
```

---

### Stage 2-2 — Implement fix 2-A in `deriveSubModuleArchJSON`

Locate the entity filter block inside `deriveSubModuleArchJSON` (`src/cli/processors/diagram-processor.ts`):

```typescript
// EXISTING (do not remove):
let fp = ((e as unknown as { filePath?: string }).filePath ?? '').replace(/\\/g, '/');
if (!fp && e.name && e.id.endsWith('.' + e.name)) {
  fp = e.id.slice(0, e.id.length - e.name.length - 1).replace(/\\/g, '/');
}
```

Append **immediately after** the two existing `if (!fp ...)` lines, before the path-match logic:

```typescript
// ADD: last-resort fallback for C++ entities (sourceLocation.file is absolute)
if (!fp && e.sourceLocation?.file) {
  fp = e.sourceLocation.file.replace(/\\/g, '/');
}
```

Run to confirm green:

```bash
npx vitest run tests/unit/cli/processors/diagram-processor.test.ts
# All deriveSubModuleArchJSON tests must pass including the three new ones

npm run type-check
# 0 errors
```

---

### Stage 2-3 — Write tests first (2-B: `processSourceGroup` C++ parent-cache)

Append to `tests/unit/cli/processors/diagram-processor.test.ts` in a new `describe` block:

```typescript
describe('processSourceGroup C++ parent-cache derivation', () => {
  it('parseCppProject is called once for root group, not for per-module groups', async () => {
    // This is an integration-level assertion.
    // Use vi.spyOn on DiagramProcessor's parseCppProject method (accessed via (proc as any))
    // Setup: two source groups —
    //   group A: sources=['/proj']         language='cpp' level='class' (root)
    //   group B: sources=['/proj/engine']  language='cpp' level='class' (per-module)
    // Assert: after processAll(), parseCppProject was called exactly once
    //         and the engine group's entities are a subset of the root group's entities
    //
    // Implementation note: mock CppPlugin.parseProject to return a fixture ArchJSON
    // containing entities from both /proj/engine and /proj/src paths.
  });
});
```

> **Note**: This test requires a mock setup. Write it as a documented integration test;
> the exact implementation depends on how `DiagramProcessor` exposes `parseCppProject`.
> A spy on `(processor as any).parseCppProject` with a mock that returns a fixed ArchJSON
> is the recommended approach.

---

### Stage 2-4 — Implement fix 2-B in `processSourceGroup`

Locate the C++ routing branch in `src/cli/processors/diagram-processor.ts` (currently ~lines 447-458):

```typescript
// BEFORE:
if (firstDiagram.language === 'cpp') {
  const rawArchJSON = await this.registerDeferred(
    firstDiagram.sources,
    this.parseCppProject(firstDiagram)
  );
  const results = await pMap(
    diagrams,
    async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
    { concurrency: this.globalConfig.concurrency || os.cpus().length }
  );
  return results;
}
```

Replace with:

```typescript
// AFTER: check parent-cache first (symmetric with TypeScript fallback path)
if (firstDiagram.language === 'cpp') {
  const { deferred, normParentPath } = this.findParentCoverage(firstDiagram.sources);

  let rawArchJSON: ArchJSON;
  if (deferred) {
    // Root parse in-progress: await it, then derive the sub-module view
    const parentArchJSON = await deferred;
    rawArchJSON = deriveSubModuleArchJSON(
      parentArchJSON,
      firstDiagram.sources[0],
      normParentPath ?? undefined,
    );
  } else if (normParentPath) {
    // Root parse already complete: derive from cache immediately
    const parentCacheKey = this.archJsonPathIndex.get(normParentPath)!;
    const parentArchJSON = this.archJsonCache.get(parentCacheKey)!;
    rawArchJSON = deriveSubModuleArchJSON(
      parentArchJSON,
      firstDiagram.sources[0],
      normParentPath,
    );
  } else {
    // No parent found: this IS the root parse — parse in full and register deferred
    rawArchJSON = await this.registerDeferred(
      firstDiagram.sources,
      this.parseCppProject(firstDiagram),
    );
  }

  const results = await pMap(
    diagrams,
    async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
    { concurrency: this.globalConfig.concurrency || os.cpus().length }
  );
  return results;
}
```

Run tests:

```bash
npx vitest run tests/unit/cli/processors/diagram-processor.test.ts
# All tests pass

npm run type-check
# 0 errors
```

---

### Stage 2-5 — Integrate into `analyze.ts` (fix 2-C)

Add the import at the top of `src/cli/commands/analyze.ts` alongside the existing detector import:

```typescript
import { detectCppProjectStructure } from '../utils/cpp-project-structure-detector.js';
```

Locate and replace the C++ block in `normalizeToDiagrams()`:

```typescript
// BEFORE:
if (language === 'cpp') {
  const sourcePath = path.resolve(cliOptions.sources[0]);
  const moduleName = path.basename(sourcePath);
  const diagrams: DiagramConfig[] = [
    { name: `${moduleName}/package`, sources: cliOptions.sources, level: 'package',
      format: cliOptions.format, exclude: cliOptions.exclude, language },
    { name: `${moduleName}/class`,   sources: cliOptions.sources, level: 'class',
      format: cliOptions.format, exclude: cliOptions.exclude, language },
  ];
  return filterByLevels(diagrams, cliOptions.diagrams);
}

// AFTER:
if (language === 'cpp') {
  const sourcePath = path.resolve(cliOptions.sources[0]);
  // NOTE: only sources[0] is used; multiple --sources paths are not supported for C++
  const moduleName = path.basename(sourcePath);
  const diagrams = await detectCppProjectStructure(sourcePath, moduleName, {
    format: cliOptions.format,
    exclude: cliOptions.exclude,
  });
  return filterByLevels(diagrams, cliOptions.diagrams);
}
```

Run full test suite:

```bash
npm test
# Expected: 2102+ tests, 0 new failures
npm run type-check
# 0 errors
```

---

## Phase 3 — Build + Validate

### Stage 3-1 — Build

```bash
npm run build
# Expected: 0 errors, dist/ updated
```

### Stage 3-2 — Validate: full analysis

```bash
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard

# Expected output (≥8 lines):
# ✅ Analysis complete!
# 📊 Successful diagrams:
#   - llama.cpp/package      Entities: 79,   Relations: 38
#   - llama.cpp/class        Entities: 5698, Relations: 1836
#   - llama.cpp/class/common ...
#   - llama.cpp/class/examples ...
#   - llama.cpp/class/ggml  (⚠ warning about 3267 entities expected in stderr)
#   - llama.cpp/class/src    Entities: ~763
#   - llama.cpp/class/tests  Entities: ~476
#   - llama.cpp/class/tools  Entities: ~482
```

### Stage 3-3 — Validate: parse-count assertion

```bash
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard 2>&1 | grep -c "Parsing C++"

# Expected: 1
# Confirms parseCppProject is called once (root parse), not per sub-module group.
# Requires a single progress log line from parseCppProject — add one if absent.
```

### Stage 3-4 — Validate: `--diagrams` filter

```bash
# class filter: returns class + class/* but not package
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard --diagrams class 2>&1 | grep "  - llama.cpp/"
# Expected: all class/* lines present, NO package line

# package filter: returns only package
node dist/cli/index.js analyze -s /home/yale/work/llama.cpp --lang cpp \
  --output-dir /home/yale/work/llama.cpp/.archguard --diagrams package 2>&1 | grep "  - llama.cpp/"
# Expected: exactly 1 line: llama.cpp/package
```

### Stage 3-5 — Validate: sub-module content

```bash
# class/src must contain llama_model, llama_context
grep -c "llama_model\|llama_context" /home/yale/work/llama.cpp/.archguard/llama.cpp/class/src.mmd
# Expected: ≥ 2

# class/ggml must contain ggml_tensor
grep -c "ggml_tensor" /home/yale/work/llama.cpp/.archguard/llama.cpp/class/ggml.mmd
# Expected: ≥ 1

# No cross-module edges in class/src (all relation endpoints are in src entities)
node -e "
const data = JSON.parse(require('fs').readFileSync(
  '/home/yale/work/llama.cpp/.archguard/llama.cpp/class/src.json', 'utf8'));
const ids = new Set(data.entities.map(e => e.id));
const cross = data.relations.filter(r => !ids.has(r.source) || !ids.has(r.target));
console.log('Cross-module relations:', cross.length);
"
# Expected: Cross-module relations: 0
```

### Stage 3-6 — Validate: HeuristicGrouper namespace grouping

```bash
# Inspect namespace blocks in class/ggml.mmd for file-name-as-namespace bug
grep "namespace " /home/yale/work/llama.cpp/.archguard/llama.cpp/class/ggml.mmd | head -20
# If any namespace label contains a file extension (e.g. "Ggml-cpu.cpp Layer"),
# record as a known issue in HeuristicGrouper — out of scope for this Plan, file separately.
```

### Stage 3-7 — Validate: TypeScript self-analysis unchanged

```bash
node dist/cli/index.js analyze -v
# Expected: same output as pre-flight baseline (no regression)

npm test
# Final gate: 2102+ tests, 0 new failures
```

---

## Acceptance Criteria

| Check | How to verify | Expected |
|-------|--------------|---------|
| Diagram count | Count lines with `  - llama.cpp/` in full-run output | ≥ 8 |
| Root parse count | grep "Parsing C++" in output | exactly 1 |
| `class/src` content | grep llama_model in src.mmd | ≥ 1 match |
| `class/ggml` warning | stderr contains "3267 entities" | present |
| `--diagrams class` | output excludes package, includes class/* | ✓ |
| `--diagrams package` | output has exactly 1 diagram | ✓ |
| Cross-module relations | node -e script on class/src.json | 0 |
| HeuristicGrouper | no file-extension namespace labels in ggml.mmd | record if present |
| TypeScript regression | `node dist/cli/index.js analyze -v` | unchanged |
| Test suite | `npm test` | 0 new failures |
