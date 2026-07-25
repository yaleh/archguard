---
id: PROBE-ROOT-MOD-STATS
title: ModuleGraphBuilder silently underreports entity stats for root-level
  TypeScript files
status: done
labels:
  - bug
  - typescript-plugin
  - module-graph
---

## Finding

`src/plugins/typescript/builders/module-graph-builder.ts`, `build()`, lines 160–163.

When a TypeScript source file lives directly in the project root (its
relative path from `projectRoot` has no directory component, e.g. `index.ts`),
the module node for that file is stored in `fileToModule` under the key `''`
(empty string) — correctly normalised from `'.'` at line 46:

```typescript
fileToModule.set(absPath, moduleId === '.' ? '' : moduleId);
```

However, the entity-stats counting loop at lines 158–170 computes `entityDir`
for each entity via:

```typescript
const entityDir = path
  .dirname(entity.id.split('.').slice(0, -1).join('.'))
  .replace(/\\/g, '/');
const stats = entityStatsMap.get(entityDir);
```

For a root-level entity whose `id` is `'index.ts.MyClass'`:
1. `split('.')` → `['index', 'ts', 'MyClass']`
2. `slice(0, -1).join('.')` → `'index.ts'`
3. `path.dirname('index.ts')` → `'.'`  ← **not `''`**

`entityStatsMap` is keyed by the module IDs from `internalModuleIds`, which
contains `''` (empty string), not `'.'`. So `entityStatsMap.get('.')` returns
`undefined`, the increment is silently skipped, and the `TsModuleNode` for the
root module always shows `{ classes: 0, interfaces: 0, functions: 0, enums: 0 }`
even when root-level classes/interfaces/functions are present.

The resulting package diagram (`overview/package`) renders the root module node
with incorrect zero-entity stats, making its visual weight misleading relative
to subdirectory modules.

## Evidence

**File**: `src/plugins/typescript/builders/module-graph-builder.ts`

Lines 44–46 (fileToModule normalisation — correct):
```typescript
const moduleId = path.dirname(relPath).replace(/\\/g, '/');
// Normalize root-level files: '.' → ''
fileToModule.set(absPath, moduleId === '.' ? '' : moduleId);
```

Lines 158–169 (entity-stats loop — missing normalisation):
```typescript
for (const entity of entities) {
  // entity.id format: "src/cli/index.ts.MyClass"
  const entityDir = path
    .dirname(entity.id.split('.').slice(0, -1).join('.'))
    .replace(/\\/g, '/');   // returns '.' for root-level files, NOT ''
  const stats = entityStatsMap.get(entityDir);  // undefined when entityDir === '.'
  if (stats) {              // false → stats never incremented
    if (entity.type === 'class') stats.classes++;
    ...
  }
}
```

**Reproduction** (add to tests/unit/plugins/typescript/builders/module-graph-builder.test.ts):
```typescript
it('counts entities from root-level files in root module stats', () => {
  const projectRoot = '/root';
  const sf = makeSourceFile('/root/index.ts');
  const entities = [
    { id: 'index.ts.RootClass', name: 'RootClass', type: 'class', members: [] }
  ];
  const builder = new ModuleGraphBuilder();
  const graph = builder.build(projectRoot, [sf], entities as any);

  const rootNode = graph.nodes.find(n => n.id === '');
  expect(rootNode?.stats.classes).toBe(1); // FAILS: actual is 0
});
```

**One-line fix** at line 162:
```typescript
const rawDir = path.dirname(entity.id.split('.').slice(0, -1).join('.')).replace(/\\/g, '/');
const entityDir = rawDir === '.' ? '' : rawDir;  // mirror the '.' → '' normalisation at line 46
```

**Why tests miss this**: `tests/plugins/typescript/builders/module-graph-builder.test.ts`
line 255 ("assigns root-level files to root module id") checks only `fileCount`,
not `stats`. The unit tests in `tests/unit/plugins/typescript/builders/module-graph-builder.test.ts`
pass `[]` as the entities argument, so the stats loop is never exercised.

## AC

- [ ] `entityDir` is normalised from `'.'` to `''` after `path.dirname(...)` in the
      entity-stats counting loop (line 160–162 of `module-graph-builder.ts`),
      mirroring the existing normalisation in `fileToModule` at line 46.
- [ ] A new unit test asserts that a root-level entity (class in `index.ts`) contributes
      `classes: 1` to the root module node's `stats` field.

## DoD

- All tests pass (`npm test`)
- The defect is resolved
- A regression test covers the fixed behavior
