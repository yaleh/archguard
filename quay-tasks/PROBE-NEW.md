---
id: PROBE-NEW
title: "deriveSubModuleArchJSON: moduleGraph filter uses wrong relPrefix
  heuristic, silently drops all nodes when workspaceRoot is provided"
status: done
labels: []
---

## Finding

In `src/cli/processors/arch-json-utils.ts`, the `deriveSubModuleArchJSON` function filters `moduleGraph` nodes using a broken heuristic (`parts.slice(-2).join('/')`) instead of the already-computed `relSub` variable. When `workspaceRoot` is provided, the entity-filtering section correctly computes `relSub = normSub.slice(normRoot.length + 1)` (e.g. `'core'` for subPath `/myproject/src/core`, workspaceRoot `/myproject/src`). But the `moduleGraph` section at lines 104–109 ignores `relSub` and instead takes the last two path segments of `normSub`, producing `'src/core'`. TypeScript module graph node IDs are project-root-relative directory paths (e.g. `'core'`, `'cli'`, `'shared'`), so the filter matches nothing and the derived ArchJSON silently returns an empty `moduleGraph` (zero nodes, zero edges, zero cycles) — discarding all module-level architecture data for every sub-module diagram when ArchGuard analyzes a TypeScript project.

## Evidence

**File:line**: `src/cli/processors/arch-json-utils.ts:104–109`

```typescript
// Lines 104-109 — the buggy heuristic
const parts = normSub.split('/').filter(Boolean);
const relPrefix =
  parts.length >= 2 ? parts.slice(-2).join('/') : (parts[parts.length - 1] ?? normSub);

const filteredNodes = mg.nodes.filter(
  (n) => n.id === relPrefix || n.id.startsWith(relPrefix + '/')
);
```

**How module IDs are generated** (`src/plugins/typescript/builders/module-graph-builder.ts:43-46`):
```typescript
const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
const moduleId = path.dirname(relPath).replace(/\\/g, '/');
// projectRoot = diagram.sources[0], e.g. '/myproject/src'
// file at /myproject/src/core/foo.ts → moduleId = 'core'
```

**Minimal reproduction (Node.js, no build required)**:
```js
// Simulate exact runtime values when processing a sub-module diagram
const normSub = '/myproject/src/core';    // subPath (diagram.sources[0])
const normRoot = '/myproject/src';         // workspaceRoot (normParentPath from call site)

// relSub is computed correctly for entity filtering (line 42) but NOT used below:
const relSub = normSub.startsWith(normRoot + '/') ? normSub.slice(normRoot.length + 1) : null;
console.log('relSub (correct):', relSub);   // 'core'

// But moduleGraph section uses this heuristic instead:
const parts = normSub.split('/').filter(Boolean);
const relPrefix = parts.length >= 2 ? parts.slice(-2).join('/') : parts[parts.length - 1];
console.log('relPrefix (wrong):', relPrefix);  // 'src/core'

// Module graph node IDs from ModuleGraphBuilder are: 'core', 'cli', 'shared'
// filteredNodes searches for id === 'src/core' or id.startsWith('src/core/')
// Result: filteredNodes = []  ← all nodes silently dropped
```

**Expected vs actual**:
- Expected: derived ArchJSON for `/myproject/src/core` contains module graph nodes matching `core` (the directory relative to `workspaceRoot`)
- Actual: derived ArchJSON has `moduleGraph: { nodes: [], edges: [], cycles: [] }` — the package-level diagram for every sub-module is empty

**Call sites that trigger the bug** (`arch-json-provider.ts` lines 209, 223): both pass `normParentPath` as `workspaceRoot`, which is exactly the parent source directory, making `relSub` available but unused by the moduleGraph branch.

**The existing test** (`tests/unit/cli/processors/diagram-processor.test.ts:177`) uses `subPath='/abs/path/src/core'` and node IDs `'src/core'`/`'src/shared'` — the last-two-segments heuristic happens to produce `'src/core'` which matches `'src/core'`, masking the bug. A realistic project (sources = `['/myproject/src']`) has node IDs `'core'`/`'shared'` with no `src/` prefix, which the heuristic misses.

## AC

- [ ] In `deriveSubModuleArchJSON`, when `relSub` is non-null (i.e. `workspaceRoot` is provided and `normSub` is inside `normRoot`), use `relSub` as the filter prefix for `moduleGraph` nodes instead of the `parts.slice(-2)` heuristic
- [ ] When `relSub` is `''` (sub-path equals the workspace root), all module graph nodes should be preserved (match everything)
- [ ] When `workspaceRoot` is not provided, the existing heuristic may be retained as a best-effort fallback for callers that do not supply it

## DoD

- All tests pass (`npm test`)
- The specific defect identified in Finding is resolved
- A regression test covers the fixed behavior: given `workspaceRoot='/myproject/src'`, `subPath='/myproject/src/core'`, and module graph nodes with IDs `['core','shared']`, the derived ArchJSON for `core` must contain exactly one node (`'core'`) and no nodes for `'shared'`
