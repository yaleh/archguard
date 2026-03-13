# Plan 49: Fix Python Cross-Layer Arrows — Absolute Import Prefix Mismatch

**Proposal**: `docs/proposals/proposal-python-absolute-import-prefix.md`
**Priority**: HIGH (0 cross-layer arrows in lmdeploy package diagram)
**Estimated total changes**: ~40 lines source + ~60 lines test

---

## Overview

When `--sources` points to the inner package directory of a Python project (e.g., `repo/lmdeploy/`), module IDs are derived from paths relative to that directory (e.g., `pytorch.engine`), but Python source files import using the full package name (e.g., `from lmdeploy.pytorch.engine import X`). The `PythonImportExtractor` and `archjson-mapper`'s `resolveAbsoluteImport()` discard these imports because they fail the `knownModuleIds.has()` lookup.

The fix adds a single "prefix strip and retry" step: detect the project root package name from `path.basename(workspaceRoot)` and, when a direct lookup fails, try again after stripping the `<rootPackage>.` prefix from the import path.

---

## Phase A — `PythonImportExtractor`

**File**: `src/plugins/python/import-extractor.ts`
**Estimated lines**: ~15 source

### Stage A1 — Add `projectRootPackage` parameter

Add an optional fourth parameter to `extract()`:

```typescript
extract(
  imports: PythonRawImport[],
  currentModuleId: string,
  knownModuleIds: Set<string>,
  projectRootPackage?: string   // e.g. "lmdeploy" from path.basename(workspaceRoot)
): ImportRelation[]
```

### Stage A2 — Add `resolveWithPrefixStrip()` helper

```typescript
/**
 * Try to resolve a module ID against knownModuleIds.
 * If the direct lookup fails and projectRootPackage is set,
 * strip the leading "<rootPackage>." prefix and retry.
 * Returns the resolved ID (possibly prefix-stripped), or null.
 */
private resolveWithPrefixStrip(
  targetModuleId: string,
  knownModuleIds: Set<string>,
  projectRootPackage: string | undefined
): string | null {
  if (knownModuleIds.has(targetModuleId)) return targetModuleId;
  if (!projectRootPackage || projectRootPackage.includes('.')) return null;
  const prefix = projectRootPackage + '.';
  if (!targetModuleId.startsWith(prefix)) return null;
  const stripped = targetModuleId.slice(prefix.length);
  if (!stripped) return null;
  if (knownModuleIds.has(stripped)) return stripped;
  // Progressive-strip fallback on the stripped path
  const parts = stripped.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('.');
    if (knownModuleIds.has(candidate)) return candidate;
  }
  return null;
}
```

### Stage A3 — Use helper in `extract()`

Replace the existing `if (!knownModuleIds.has(targetModuleId)) continue;` guard with:

```typescript
const resolvedId = this.resolveWithPrefixStrip(targetModuleId, knownModuleIds, projectRootPackage);
if (!resolvedId) continue;
// Use resolvedId instead of targetModuleId for the relation
result.push({ sourceModuleId: currentModuleId, targetModuleId: resolvedId });
```

Also update `seen.has()` / `seen.add()` to use `resolvedId` to maintain correct deduplication.

---

## Phase B — `PythonPlugin.extractImportRelations()`

**File**: `src/plugins/python/index.ts`
**Estimated lines**: ~5 source

### Stage B1 — Derive `projectRootPackage`

In `extractImportRelations()`, derive the project root package name before calling `extractor.extract()`:

```typescript
import path from 'path';

// Derive project root package name: last component of workspaceRoot
// e.g. /home/user/lmdeploy/lmdeploy → "lmdeploy"
const projectRootPackage = workspaceRoot ? path.basename(workspaceRoot) : undefined;
```

### Stage B2 — Pass to `extractor.extract()`

```typescript
const relations = extractor.extract(mod.imports, currentModuleId, knownModuleIds, projectRootPackage);
```

---

## Phase C — `archjson-mapper.ts` `resolveAbsoluteImport()`

**File**: `src/plugins/python/archjson-mapper.ts`
**Estimated lines**: ~20 source

The `archjson-mapper` has its own import resolution path used when `mapModules()` is called (distinct from `PythonImportExtractor`). The same fix must be applied there to keep both paths consistent.

### Stage C1 — Add `projectRootPackage` to `mapModules()` and propagate

`mapModules(modules, workspaceRoot, importRelations)` derives `projectRootPackage` from `workspaceRoot`:

```typescript
const projectRootPackage = workspaceRoot ? path.basename(workspaceRoot) : undefined;
```

Pass it through:
- `mapModule(module, workspaceRoot, modulePathIndex, seenDeps, projectRootPackage)`
- `createImportDependency(imp, filePath, moduleName, workspaceRoot, modulePathIndex, projectRootPackage)`
- `resolveAbsoluteImport(rawModule, modulePathIndex, projectRootPackage)`

### Stage C2 — Update `resolveAbsoluteImport()` signature and logic

```typescript
private resolveAbsoluteImport(
  dottedPath: string,
  modulePathIndex: Map<string, string>,
  projectRootPackage?: string
): string | null {
  // Direct lookup
  if (modulePathIndex.has(dottedPath)) return dottedPath;

  // Progressive strip (existing logic)
  const parts = dottedPath.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('.');
    if (modulePathIndex.has(candidate)) return candidate;
  }

  // NEW: Strip project root package prefix and retry
  if (projectRootPackage && !projectRootPackage.includes('.')) {
    const prefix = projectRootPackage + '.';
    if (dottedPath.startsWith(prefix)) {
      const stripped = dottedPath.slice(prefix.length);
      if (stripped) {
        if (modulePathIndex.has(stripped)) return stripped;
        const strippedParts = stripped.split('.');
        for (let i = strippedParts.length - 1; i > 0; i--) {
          const candidate = strippedParts.slice(0, i).join('.');
          if (modulePathIndex.has(candidate)) return candidate;
        }
      }
    }
  }

  return null;
}
```

---

## Phase D — Tests

**Files**:
- `tests/unit/plugins/python/import-extractor.test.ts` (existing — add new describe block)
- `tests/unit/plugins/python/archjson-mapper.test.ts` (existing — add new describe block)

**Estimated lines**: ~60 test lines

### Import extractor test cases (describe: `projectRootPackage prefix stripping`)

| # | Import module | knownModuleIds | projectRootPackage | Expected resolved target | Scenario |
|---|---|---|---|---|---|
| D1 | `lmdeploy.pytorch.engine` | `{'pytorch.engine'}` | `lmdeploy` | `pytorch.engine` | exact match after strip |
| D2 | `lmdeploy.pytorch.engine` | `{'pytorch'}` | `lmdeploy` | `pytorch` | progressive strip after prefix strip |
| D3 | `lmdeploy.pytorch.engine` | `{'pytorch.engine'}` | `other` | _(discarded)_ | wrong root package, no strip |
| D4 | `lmdeploy.pytorch.engine` | `{'lmdeploy.pytorch.engine'}` | `lmdeploy` | `lmdeploy.pytorch.engine` | direct match wins, no strip needed |
| D5 | `os.path` | `{'path'}` | `os` | _(discarded)_ | guard: single-component root packages like `os` could cause false positives — add test to confirm `os` is NOT stripped when `projectRootPackage='os'` is a stdlib name. The fix is safe here because `path` by itself is unlikely to be in `knownModuleIds` for a real project, but the test documents the behaviour. |
| D6 | `.utils` (relative) | `{'pytorch.utils'}` | `lmdeploy` | _(not affected — relative imports bypass prefix strip)_ | relative import unchanged |

### Mapper test cases (describe: `resolveAbsoluteImport with projectRootPackage`)

| # | Input | knownIds | projectRootPackage | Expected |
|---|---|---|---|---|
| D7 | `lmdeploy.serve.async_engine` | `{'serve.async_engine'}` | `lmdeploy` | `serve.async_engine` |
| D8 | `lmdeploy.serve.async_engine` | `{'serve'}` | `lmdeploy` | `serve` |
| D9 | `lmdeploy.serve.async_engine` | `{}` | `lmdeploy` | `null` |
| D10 | `lmdeploy.pytorch` | `{'pytorch'}` | `lmdeploy` | `pytorch` |

---

## Acceptance Criteria

1. For a synthetic project with `workspaceRoot=/tmp/lmdeploy` and files `pytorch/engine.py`, `serve/router.py` — an import `from lmdeploy.pytorch.engine import X` in `serve/router.py` produces a `dependency` relation `serve.router → pytorch.engine`.
2. For projects where the workspace root basename does not prefix any import, no extra relations are generated (guard test D3).
3. All Phase D tests pass.
4. Full test suite remains green (`npm test`).
5. lmdeploy self-analysis: package diagram shows cross-layer arrows between `serve`, `pytorch`, `cli`, `turbomind`.
