# Proposal: Fix Python Cross-Layer Arrows — Absolute Import Prefix Mismatch

**Status**: Proposed
**Priority**: HIGH
**Affected subsystem**: `src/plugins/python/import-extractor.ts`, `src/plugins/python/index.ts`

---

## Problem Statement

When ArchGuard analyzes a Python project like `lmdeploy`, cross-package import arrows are missing from the package diagram (0 arrows between top-level packages: `serve→pytorch`, `cli→serve`, etc.).

### Root Cause

The project root of lmdeploy is `/path/to/lmdeploy/lmdeploy` — a directory named `lmdeploy` inside a repo also named `lmdeploy`. When the user passes `--sources /path/to/lmdeploy/lmdeploy`, `workspaceRoot` is set to that path.

**Module ID generation** (`filePathToModuleId` in `index.ts`, `generateModuleId` in `archjson-mapper.ts`) derives IDs by computing `path.relative(workspaceRoot, filePath)` and converting slashes to dots. For a file at `workspaceRoot/pytorch/engine.py`, this yields:

```
pytorch.engine
```

**Import extraction** (`PythonImportExtractor.extract()` → `resolveModuleId()`) works from the raw import string stored by the tree-sitter bridge. Python code inside the project writes:

```python
from lmdeploy.pytorch.engine import X
```

So `imp.module` is `lmdeploy.pytorch.engine`. The `resolveModuleId()` method returns it as-is (absolute import). The `knownModuleIds` set contains `pytorch.engine` (no `lmdeploy.` prefix). The lookup `knownModuleIds.has('lmdeploy.pytorch.engine')` fails, and the relation is discarded.

The same mismatch affects `archjson-mapper.ts`'s `resolveAbsoluteImport()`: the progressive-strip fallback tries `lmdeploy.pytorch`, `lmdeploy` — neither of which is in the index. It never tries `pytorch.engine` or `pytorch`.

### Why this happens

Python packages often have the same name as their containing repository directory. When `--sources` points to the inner package directory (e.g., `repo/mypackage/`), relative file paths start directly with sub-package names (`pytorch/`, `serve/`), but absolute imports in the source include the top-level package name (`mypackage.pytorch.*`).

The discrepancy arises because:
- **Module IDs** are built from file paths relative to `workspaceRoot` → no top-level package name prefix
- **Import strings** are written by developers using the installed package name → include the top-level package name prefix

---

## Proposed Fix

### Detect the project root package name

The project root package name is the last component of `workspaceRoot` (i.e., `path.basename(workspaceRoot)`). For `--sources /path/to/lmdeploy/lmdeploy`, this gives `lmdeploy`.

### Strip the prefix before lookup (two-attempt resolution)

In `PythonImportExtractor.extract()` (and in `archjson-mapper.ts`'s `resolveAbsoluteImport()`), when a module ID is not found in `knownModuleIds`, try again after stripping a leading `<projectRootPackage>.` prefix:

```
lmdeploy.pytorch.engine
  → not in known → strip "lmdeploy." prefix
  → pytorch.engine
  → found in known → emit relation
```

The progressive-strip fallback in `resolveAbsoluteImport()` already tries shorter prefixes, but stops at `lmdeploy` (first component) which is still not in the index. The fix adds one more attempt: strip the first component entirely and retry the full progressive-strip loop on the remainder.

### Where to apply

1. **`PythonImportExtractor`**: Accept an optional `projectRootPackage: string | undefined` parameter in `extract()`. When set, after the first `knownModuleIds.has(targetModuleId)` check fails, attempt `knownModuleIds.has(targetModuleId.replace(/^<root>\./, ''))` (and the progressive fallback on the stripped path).

2. **`PythonPlugin.extractImportRelations()`**: Derive `projectRootPackage = workspaceRoot ? path.basename(workspaceRoot) : undefined` and pass it to `extractor.extract()`.

3. **`archjson-mapper.ts` `resolveAbsoluteImport()`**: Apply the same prefix-strip-and-retry logic, receiving `projectRootPackage` from `createImportDependency()`, which receives it from `mapModule()`, which receives it from `mapModules()`.

### Guard against false positives

Only strip the prefix when:
- `projectRootPackage` is non-empty and does not contain dots (it is a single identifier, not a dotted path)
- The import path starts exactly with `<projectRootPackage>.` (dot-terminated, not just a prefix of a longer name)
- The stripped remainder is non-empty

This prevents the fix from accidentally stripping legitimate package references in projects where the workspace root name is a common word (e.g., `lib`, `src`).

---

## Alternative Considered: Build knownModuleIds with prefix variants

Instead of stripping at lookup time, augment `knownModuleIds` with both `pytorch.engine` and `lmdeploy.pytorch.engine` for every known file. This is simpler but doubles the index size and can create false matches when a third-party package happens to share the project root package name.

The prefix-strip-at-lookup approach is preferred: it is applied only when the direct lookup fails, and is bounded by the specific `projectRootPackage` identifier.

---

## Impact

After the fix:
- lmdeploy: cross-layer arrows appear between `serve`, `pytorch`, `cli`, `turbomind` packages in the package diagram
- No change expected for projects where `workspaceRoot` basename does not match the package name used in imports (standard case — no stripping occurs because the first lookup succeeds)
- Self-analysis of ArchGuard unaffected (TypeScript project, Python plugin not involved)
