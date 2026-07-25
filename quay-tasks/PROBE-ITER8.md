---
id: PROBE-ITER8
title: generateClassDiagrams split path emits cross-group relations with
  undeclared ghost target nodes
status: done
labels: []
---

## Finding

`src/mermaid/generator.ts` — `ValidatedMermaidGenerator.generateClassDiagrams()`

When the diagram is split by package group (triggered when `totalNodes > maxNodesPerDiagram && visibleGroups.length > 1`), each sub-diagram's relation filter uses:

```ts
const targetKnown =
  knownEntityIds.has(relation.target) || knownEntityNames.has(relation.target);
const targetOk = targetKnown || sourceViaPrefix || !isNoisyTarget(relation.target);
if (sourceInGroup && targetOk) {
  // emit relation
}
```

`knownEntityIds` / `knownEntityNames` are built from **all** visible entities across all groups, not just the current group. This means a relation from group A's entity to group B's entity passes `targetOk = true` and is emitted into group A's sub-diagram — but group B's entity is **never declared** in group A's namespace block. Mermaid renders the undeclared target as an unstyled ghost node floating outside any namespace, losing all `classDef` styling and namespace membership.

## Evidence

Reproducible with the compiled CLI (after `npm run build`):

```js
// node repro — run from /home/yale/work/archguard
const { ValidatedMermaidGenerator } = require('./dist/mermaid/generator.js');

const entityA = { id: 'pkgA.EntityA', name: 'EntityA', type: 'class', visibility: 'public', members: [],
  sourceLocation: { file: 'pkgA/EntityA.ts', startLine: 1, endLine: 10 } };
const entityB = { id: 'pkgB.EntityB', name: 'EntityB', type: 'class', visibility: 'public', members: [],
  sourceLocation: { file: 'pkgB/EntityB.ts', startLine: 1, endLine: 10 } };
const entityC = { id: 'pkgB.EntityC', name: 'EntityC', type: 'class', visibility: 'public', members: [],
  sourceLocation: { file: 'pkgB/EntityC.ts', startLine: 1, endLine: 10 } };

const archJson = {
  version: '1.1', language: 'typescript', timestamp: new Date().toISOString(),
  sourceFiles: [], entities: [entityA, entityB, entityC],
  relations: [{ id: 'rel1', source: entityA.id, target: entityB.id, type: 'dependency' }]
};
const grouping = { packages: [
  { name: 'pkgA', entities: [entityA.id], reasoning: '' },
  { name: 'pkgB', entities: [entityB.id, entityC.id], reasoning: '' },
]};
const gen = new ValidatedMermaidGenerator(archJson, { level: 'class', grouping });
const result = gen.generateClassDiagrams(1); // 3 > 1 → split
const diagA = result.find(r => r.name === 'pkgA');
console.log(diagA.content);
```

**Actual output for pkgA diagram:**
```
classDiagram
  ...styles...
  namespace pkgA {
    class EntityA {
    }
  }
  EntityA --> EntityB        ← EntityB is NOT defined anywhere in this diagram

  %% Node type annotations
  class EntityA:::classNode
  ← EntityB has no :::classNode annotation here
```

`EntityB` appears as an undeclared ghost node in group A's diagram. The `:::classNode` style annotation is also missing for it, so Mermaid renders it as a plain unstyled box.

**Source location:** `src/mermaid/generator.ts` lines 603–618 (the relation-emission loop inside `generateClassDiagrams`).

The existing "no ghost nodes" test at `tests/unit/mermaid/generator.test.ts:1727` does not catch this because in that test both the source and target entities (`entityA` and `entityB`) are placed in the **same** group (`mod`), so no cross-group dangling reference occurs.

## AC

- [ ] In `generateClassDiagrams`, cross-group relations (source in current group, target in a different group) are either (a) suppressed entirely from sub-diagrams, or (b) the target entity is declared as a ghost stub with proper styling inside the current sub-diagram so Mermaid renders it consistently.
- [ ] A regression test verifies that when a relation's target belongs to a different group, the target node is not left undeclared (ghost) in the source group's sub-diagram.

## DoD

- All tests pass (`npm test`)
- The defect is resolved
- A regression test covers the fixed behavior
