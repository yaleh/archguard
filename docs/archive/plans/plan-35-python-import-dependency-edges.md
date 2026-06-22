# Plan 35: Python Import Dependency Edges

**Status**: Draft
**Date**: 2026-03-13
**Proposal**: `docs/proposals/proposal-python-import-dependency-edges.md`

---

## Overview

Wire the already-collected `PythonRawModule.imports` data into `createImportDependency()`
so that intra-project imports produce `dependency` relations in ArchJSON. This converts
isolated-node Python package diagrams into diagrams with real architectural edges.

The change is a **data-wiring problem only** — no new parsing, no new raw types, no new
dependencies. All raw import data already exists in `PythonRawModule.imports` at the
time `mapModules()` is called. The implementation requires:

1. A one-pass pre-index of all known module IDs before the mapping loop.
2. Rewriting `createImportDependency()` to resolve raw import strings against that index.
3. Two private helpers: `resolveAbsoluteImport()` (with progressive-strip fallback) and
   `resolveRelativeImport()` (dot-count arithmetic on `path.dirname`).

Estimated change: ~65–90 new lines entirely within `src/plugins/python/archjson-mapper.ts`,
plus ~80–110 lines of new tests in the existing `archjson-mapper.test.ts`.

---

## Phase Dependencies

```
Phase 1 (Data Layer)
  └─► Phase 2 (Integration)
        └─► Phase 3 (Validation)
```

Each phase is independently testable. Phase 2 cannot start before Phase 1 is green.
Phase 3 is a manual smoke-test step with no code changes.

---

## Phase 1 — Data Layer: Rewrite `createImportDependency()` in `archjson-mapper.ts`

**Goal**: Build `modulePathIndex` in `mapModules()` and rewrite `createImportDependency()`
so that all 14 test cases from the proposal pass. No changes to `index.ts` yet — all
tests call the mapper directly.

**Files touched**:
- `tests/unit/plugins/python/archjson-mapper.test.ts` (Stage 1.1 — new test group)
- `src/plugins/python/archjson-mapper.ts` (Stage 1.2 — implementation)

**Acceptance criteria**:
- All 14 new tests in the `mapModules — dependency relations` group pass.
- All existing tests in `archjson-mapper.test.ts` continue to pass.
- `mapModules([], BASE_WS)` returns empty `relations` array without throwing.
- `mapModules([], undefined)` (no workspace root) returns empty `relations` without throwing.
- `npm run type-check` passes with no new errors.

**Estimated code change**: ~80–110 lines new test code + ~65–90 lines implementation =
~145–200 lines total. Within the 200-line-per-stage and 500-line-per-phase limits.

---

### Stage 1.1 — Write 14 failing tests for dependency relation emission

**File**: `tests/unit/plugins/python/archjson-mapper.test.ts`

**Approach**: Add a new `describe` block after the existing `P0.1` and `P0.3` blocks.
No production code changes yet — all 14 tests in this group will fail (red) until
Stage 1.2 is complete.

**Helper additions** at the top of the file (alongside existing `makeModule`):

```typescript
import type { PythonRawImport } from '@/plugins/python/types.js';

function makeImport(module: string, items?: Array<{ name: string }>): PythonRawImport {
  return { module, items };
}
```

**New test group**: `mapModules — dependency relations`

Test cases (in order of ascending complexity):

| # | Name | Fixture | Expected outcome |
|---|------|---------|-----------------|
| 1 | Basic absolute import | Two modules; `engine.py` imports `lmdeploy.models.base` | 1 `dependency` relation: `source: 'lmdeploy.engine'`, `target: 'lmdeploy.models.base'` |
| 2 | Relative import `.utils` | `lmdeploy/models/base.py` has import `.utils`; `lmdeploy/models/utils.py` exists | Resolves to `lmdeploy.models.utils`; 1 dependency relation |
| 3 | Relative import `..common` | `lmdeploy/models/base.py` has import `..common`; `lmdeploy/common.py` exists | Resolves to `lmdeploy.common`; 1 dependency relation |
| 4 | Stdlib import excluded | Module with `import os` only | 0 dependency relations |
| 5 | Third-party import excluded | Module with `from torch import Tensor` | 0 dependency relations |
| 6 | Import of `__init__.py` package | Module imports `lmdeploy.models`; `lmdeploy/models/__init__.py` exists (ID: `lmdeploy.models`) | Resolves to `lmdeploy.models`; 1 dependency relation |
| 7 | Self-import guard | Module whose `generateModuleId` equals its own import target | 0 dependency relations |
| 8 | Duplicate import deduplicated | Same import path appears twice in `module.imports` | Exactly 1 relation emitted (not 2) |
| 9 | Three-module chain A → B → C | A imports B, B imports C; all three modules in fixture | 2 `dependency` relations, both correct |
| 10 | No imports | Module with `imports: []` | 0 new relations |
| 11 | No `workspaceRoot` | Relative import `.utils` without workspace context | Relative import silently skipped; 0 dependency relations |
| 12 | Bare relative import `.` | `imp.module = "."` (from `from . import X`); `__init__.py` for the package exists | Resolves to the package `__init__.py` module ID; 1 dependency relation |
| 13 | Both inheritance and dependency | Module whose class extends `Base` AND imports another known module | Both `inheritance` and `dependency` relations in output; no collision |
| 14 | Aliased import `import X as Y` | `imp.module = "lmdeploy.models.base as base"` (bridge verbatim) | ` as base` suffix stripped; resolves to `lmdeploy.models.base`; 1 dependency relation |

**Representative test skeletons** (illustrating call pattern; exact assertions match table above):

```typescript
describe('mapModules — dependency relations', () => {
  const WS = '/project';

  // Test 1 — Basic absolute import
  it('emits dependency relation for absolute import of a known module', () => {
    const modelsBase = makeModule({
      name: 'base',
      filePath: `${WS}/lmdeploy/models/base.py`,
      imports: [],
    });
    const engine = makeModule({
      name: 'engine',
      filePath: `${WS}/lmdeploy/engine.py`,
      imports: [makeImport('lmdeploy.models.base')],
    });

    const result = new ArchJsonMapper().mapModules([modelsBase, engine], WS);
    const deps = result.relations.filter((r) => r.type === 'dependency');

    expect(deps).toHaveLength(1);
    expect(deps[0].source).toBe('lmdeploy.engine');
    expect(deps[0].target).toBe('lmdeploy.models.base');
  });

  // Test 14 — Aliased import
  it('strips " as alias" suffix from imp.module before resolution', () => {
    const base = makeModule({
      name: 'base',
      filePath: `${WS}/lmdeploy/models/base.py`,
      imports: [],
    });
    const consumer = makeModule({
      name: 'consumer',
      filePath: `${WS}/lmdeploy/consumer.py`,
      imports: [makeImport('lmdeploy.models.base as base')],
    });

    const result = new ArchJsonMapper().mapModules([base, consumer], WS);
    const deps = result.relations.filter((r) => r.type === 'dependency');

    expect(deps).toHaveLength(1);
    expect(deps[0].target).toBe('lmdeploy.models.base');
  });
});
```

---

### Stage 1.2 — Implement dependency edges in `archjson-mapper.ts`

**File**: `src/plugins/python/archjson-mapper.ts`

**Summary of changes**:

1. **`mapModules()`**: Build `modulePathIndex: Map<string, string>` before the per-module
   loop. Pass it to `mapModule()` (or thread it directly to `createImportDependency()`).

2. **`createImportDependency()`**: Replace the current stub (which emits `imp.module` raw
   as the target) with resolution logic using the index. Return `null` when no match.

3. **`resolveAbsoluteImport(rawModule, modulePathIndex)`** (private): Strip ` as \w+$`
   alias suffix → look up full path → if not found, progressively strip last component
   and retry (handles `from lmdeploy.models import MyClass` where `MyClass` lives in
   `__init__.py`). Return the matched module ID or `null`.

4. **`resolveRelativeImport(rawModule, sourceFilePath, workspaceRoot, modulePathIndex)`**
   (private): Count leading dots → compute base directory → append suffix → derive dotted
   path → look up in index. Return matched module ID or `null` when `workspaceRoot` is
   absent.

**Implementation sketch for `mapModules()`**:

```typescript
mapModules(modules: PythonRawModule[], workspaceRoot?: string): ArchJSON {
  const entities: Entity[] = [];
  const relations: Relation[] = [];

  // PRE-PASS: build index of all known module IDs
  const modulePathIndex = new Map<string, string>();
  for (const m of modules) {
    const modId = this.generateModuleId(m.name, m.filePath, workspaceRoot);
    modulePathIndex.set(modId, modId);
  }

  for (const module of modules) {
    const moduleResult = this.mapModule(module, workspaceRoot, modulePathIndex);
    entities.push(...moduleResult.entities);
    relations.push(...moduleResult.relations);
  }
  // ... rest unchanged
}
```

**Implementation sketch for `createImportDependency()`**:

```typescript
private createImportDependency(
  imp: PythonRawImport,
  filePath: string,
  moduleName: string,
  workspaceRoot: string | undefined,
  modulePathIndex: Map<string, string>
): Relation | null {
  // 1. Strip " as <alias>" suffix (bridge limitation §6.6)
  const rawModule = imp.module.replace(/ as \w+$/, '');

  // 2. Resolve to a known module ID
  let targetId: string | null;
  if (rawModule.startsWith('.')) {
    targetId = this.resolveRelativeImport(rawModule, filePath, workspaceRoot, modulePathIndex);
  } else {
    targetId = this.resolveAbsoluteImport(rawModule, modulePathIndex);
  }
  if (!targetId) return null;

  // 3. Source module ID
  const sourceId = this.generateModuleId(moduleName, filePath, workspaceRoot);

  // 4. Self-import guard
  if (sourceId === targetId) return null;

  return this.createExplicitRelation('dependency', sourceId, targetId, {
    confidence: 1.0,
    inferenceSource: 'explicit',
  });
}
```

**Implementation sketch for `resolveAbsoluteImport()`**:

```typescript
private resolveAbsoluteImport(
  dottedPath: string,
  modulePathIndex: Map<string, string>
): string | null {
  // Exact match first
  if (modulePathIndex.has(dottedPath)) return dottedPath;
  // Progressive-strip fallback: "lmdeploy.models.MyClass" → "lmdeploy.models" → ...
  const parts = dottedPath.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('.');
    if (modulePathIndex.has(candidate)) return candidate;
  }
  return null;
}
```

**Implementation sketch for `resolveRelativeImport()`**:

```typescript
private resolveRelativeImport(
  rawModule: string,       // e.g. ".", ".utils", "..common.helper"
  sourceFilePath: string,
  workspaceRoot: string | undefined,
  modulePathIndex: Map<string, string>
): string | null {
  if (!workspaceRoot) return null;

  // Count leading dots
  const dots = rawModule.match(/^\.+/)?.[0] ?? '.';
  const dotCount = dots.length;
  const suffix = rawModule.slice(dotCount); // "" for ".", "utils" for ".utils"

  // Start at sourceFile's directory, move up (dotCount - 1) levels
  let baseDir = path.dirname(sourceFilePath);
  for (let i = 1; i < dotCount; i++) {
    baseDir = path.dirname(baseDir);
  }

  // Append suffix as path segments
  const resolvedDir = suffix ? path.join(baseDir, ...suffix.split('.')) : baseDir;

  // Two candidates: the dir itself (package __init__) or a .py file inside
  const relDir = path.relative(workspaceRoot, resolvedDir).replace(/\\/g, '/');
  const dottedDir = relDir.replace(/\//g, '.');
  if (modulePathIndex.has(dottedDir)) return dottedDir;

  // Also try as a .py module (relDir + last suffix component)
  return null;
}
```

**Deduplication**: `mapModule()` will accumulate dependency relations for a single
source module. Add a `Set<string>` keyed on `dependency:source:target` inside
`mapModule()` (or inside `mapModules()`) to deduplicate before pushing into `relations`.

**Verify after Stage 1.2**:

```bash
npm test -- tests/unit/plugins/python/archjson-mapper.test.ts
npm run type-check
```

All 14 new tests green. No regressions in the existing `P0.1` and `P0.3` groups.

---

## Phase 2 — Integration: Verify end-to-end with a realistic Python project structure

**Goal**: Confirm that `mapModules()` (called by the full plugin pipeline) emits correct
`dependency` relations when given a multi-package Python fixture that exercises all four
import forms: absolute, relative `.`, relative `..`, and aliased. Also confirms that
`__init__.py` package IDs, stdlib filtering, and third-party filtering hold end-to-end.

**Files touched**:
- `tests/unit/plugins/python/archjson-mapper.test.ts` (Stage 2.1 — one integration
  `describe` block with a cross-package fixture)

**Acceptance criteria**:
- The cross-package fixture emits the exact set of dependency relations listed in Stage 2.1.
- No spurious relations for `os`, `typing`, `torch`, or other non-project imports.
- All existing tests still pass.

**Estimated code change**: ~60 lines new test code. Well within the 500-line-per-phase limit.

---

### Stage 2.1 — Integration test: cross-package import fixture

**File**: `tests/unit/plugins/python/archjson-mapper.test.ts`

Add a new `describe` block after the `mapModules — dependency relations` group from
Stage 1.1.

**Fixture layout** (mocked, no disk I/O):

```
/project/
  lmdeploy/
    __init__.py          → module ID: lmdeploy
    engine.py            → imports: lmdeploy.models.base (absolute),
                                    .utils (relative same-dir),
                                    lmdeploy.common (absolute, cross-pkg)
    utils.py             → no imports
    common.py            → no imports
    models/
      __init__.py        → module ID: lmdeploy.models
      base.py            → imports: lmdeploy.models (the __init__), torch (third-party)
```

The fixture produces 6 `PythonRawModule` entries. All filePaths are absolute, all
pointing into `/project`. `workspaceRoot = '/project'`.

Note: `..common` from `lmdeploy/engine.py` is intentionally avoided here because `..`
from `lmdeploy/engine.py` resolves to `/project`, putting `common` outside the module
index. The relative `..` case is fully covered by Phase 1 test case 3 (`lmdeploy/models/base.py`
with import `..common` → `lmdeploy.common`). The integration fixture uses a direct
absolute `lmdeploy.common` import to keep the fixture self-consistent.

Expected dependency relations (no stdlib/third-party, no self-imports):

| source | target |
|--------|--------|
| `lmdeploy.engine` | `lmdeploy.models.base` |
| `lmdeploy.engine` | `lmdeploy.utils` |
| `lmdeploy.engine` | `lmdeploy.common` |
| `lmdeploy.models.base` | `lmdeploy.models` |

Expected: exactly 4 dependency relations. `torch` import produces no relation.

**Test skeleton**:

```typescript
describe('mapModules — cross-package integration fixture', () => {
  const WS = '/project';

  it('emits correct dependency relations for a realistic multi-package fixture', () => {
    const modules: PythonRawModule[] = [
      makeModule({ name: '__init__', filePath: `${WS}/lmdeploy/__init__.py`, imports: [] }),
      makeModule({
        name: 'engine',
        filePath: `${WS}/lmdeploy/engine.py`,
        imports: [
          makeImport('lmdeploy.models.base'),  // absolute cross-package
          makeImport('.utils'),                 // relative same-dir
          makeImport('lmdeploy.common'),        // absolute cross-package (sibling module)
        ],
      }),
      makeModule({ name: 'utils',  filePath: `${WS}/lmdeploy/utils.py`,  imports: [] }),
      makeModule({ name: 'common', filePath: `${WS}/lmdeploy/common.py`, imports: [] }),
      makeModule({ name: '__init__', filePath: `${WS}/lmdeploy/models/__init__.py`, imports: [] }),
      makeModule({
        name: 'base',
        filePath: `${WS}/lmdeploy/models/base.py`,
        imports: [
          makeImport('lmdeploy.models'),  // resolves to lmdeploy.models (__init__)
          makeImport('torch'),            // third-party — excluded
        ],
      }),
    ];

    const result = new ArchJsonMapper().mapModules(modules, WS);
    const deps = result.relations.filter((r) => r.type === 'dependency');

    // Exact set of expected edges (order-independent)
    const edges = deps.map((r) => `${r.source} -> ${r.target}`).sort();
    expect(edges).toContain('lmdeploy.engine -> lmdeploy.models.base');
    expect(edges).toContain('lmdeploy.engine -> lmdeploy.utils');
    expect(edges).toContain('lmdeploy.engine -> lmdeploy.common');
    expect(edges).toContain('lmdeploy.models.base -> lmdeploy.models');
    expect(deps).toHaveLength(4);

    // No third-party or self edges
    expect(deps.find((r) => r.target === 'torch')).toBeUndefined();
  });
});
```

**Verify after Stage 2.1**:

```bash
npm test -- tests/unit/plugins/python/archjson-mapper.test.ts
npm run type-check
```

All tests green, including the integration fixture. No regressions anywhere in the
Python test files.

---

## Phase 3 — Validation: Manual smoke test on lmdeploy

**Goal**: Confirm that the feature works end-to-end on a real Python project (lmdeploy)
and that the full test suite remains green. No code changes in this phase.

**Acceptance criteria**:
- Full test suite: `npm test` shows 0 failures.
- `node dist/cli/index.js analyze -s <lmdeploy-root> --lang python -f json` produces
  ArchJSON with `relations` entries where `type === "dependency"` and `source`/`target`
  match known module IDs (e.g. `lmdeploy.engine.async_llm_engine` →
  `lmdeploy.models.base_model`).
- The count of `dependency` relations is in the range 200–400 (per proposal estimate).
- Package diagram (Mermaid) for lmdeploy shows `-->` arrows between package nodes.
- Existing `inheritance` relation count is unchanged from before this change.

---

### Stage 3.1 — Full test suite green

```bash
npm test
npm run type-check
npm run lint
```

Expected: same pass count as before + the new tests added in Phases 1–2. Zero failures.

---

### Stage 3.2 — Smoke test on lmdeploy

```bash
npm run build
node dist/cli/index.js analyze -s /path/to/lmdeploy --lang python -f json \
  | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
      const deps = d.relations.filter(r => r.type === 'dependency');
      const inh  = d.relations.filter(r => r.type === 'inheritance');
      console.log('dependency relations:', deps.length);
      console.log('inheritance relations:', inh.length);
      deps.slice(0, 5).forEach(r => console.log(' ', r.source, '->', r.target));
    "
```

Expected: `dependency relations: N` where 200 ≤ N ≤ 400. `inheritance` count unchanged.

---

### Stage 3.3 — Package diagram shows edges

```bash
node dist/cli/index.js analyze -s /path/to/lmdeploy --lang python --diagrams package
# Open .archguard/overview/package.md or the rendered SVG
```

Verify visually that the flowchart diagram contains `-->` arrows between package nodes
(not a set of disconnected islands as before this change).

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `workspaceRoot` undefined causes `path.relative` panic | Low | High | Guard `resolveRelativeImport` and `generateModuleId` with `if (!workspaceRoot) return null` |
| Progressive-strip fallback produces false matches (e.g. `lmdeploy` matches short stdlib name) | Very Low | Low | Only matches keys in the project module index; stdlib not indexed |
| Aliased multi-name `import A, B as x` edge-case (bridge only captures first name) | Low | Low | Pre-existing bridge limitation documented in proposal §6.7; out of scope |
| Deduplication Set not threaded through all call paths | Low | Medium | Add `seen` Set in `mapModules()` spanning all modules; thread or accumulate post-loop |
| `..` from a top-level module walks above `workspaceRoot` | Low | Low | `path.relative` will return `../something`; dotted path starts with `..`; index lookup fails; relation silently skipped |
| Inheritance relations accidentally changed | Very Low | Medium | `createInheritanceRelation` is unaffected; unit tests for P0.1 guard against regression |
| Star imports (`from module import *`) treated incorrectly | Very Low | Low | Module path is the relation target, not the imported names; star imports resolve identically to named imports — no special handling needed (proposal §6.4) |
| `TYPE_CHECKING` block imports captured unexpectedly | Very Low | None | Bridge only processes top-level module children; `if TYPE_CHECKING:` block imports are never captured — no action needed (proposal §6.5) |

---

## Summary

| Phase | Stages | Key files | ~Lines changed | Independently testable |
|-------|--------|-----------|----------------|------------------------|
| 1 — Data Layer | 1.1 (tests), 1.2 (impl) | `archjson-mapper.ts`, `archjson-mapper.test.ts` | ~145–200 | Yes — mapper is pure |
| 2 — Integration | 2.1 (cross-pkg fixture) | `archjson-mapper.test.ts` | ~60 | Yes — mapper already correct |
| 3 — Validation | 3.1 (suite), 3.2 (smoke), 3.3 (diagram) | None (build + manual) | 0 | N/A — validation only |
| **Total** | 4 stages | 2 files | **~205–260** | — |
