---
id: PROBE-NEW2
title: "ArchJSONAggregator: package-level relation IDs are not unique when
  multiple relation types exist between the same package pair"
status: done
labels: []
---

## Finding

`ArchJSONAggregator.analyzePackageDependencies` (src/parser/archjson-aggregator.ts:307–315) uses a deduplication key that includes `relation.type` but generates a relation `id` that does NOT include the type.

Result: when two entities in packages A and B have both a `dependency` and an `inheritance` relation, the aggregated package-level ArchJSON contains two distinct `Relation` objects — each with different `type` fields — but **both share the same `id`** value of `pkg-A-B`.

The duplicated IDs are persisted to `.archguard/*.json` on disk, reported in `DiagramResult`, and passed into `buildArchIndex` (via `DiagramPipelineRunner.run`). The structural validator (`validator-structural.ts`) also surfaces relation IDs in error objects, making debugging harder when two issues share the same relation ID.

### Affected code

`src/parser/archjson-aggregator.ts` lines 307–315:

```typescript
// dedup key includes type  ← correct
const key = `${sourcePackage}:${targetPackage}:${relation.type}`;

if (!packageRelationsMap.has(key)) {
  packageRelationsMap.set(key, {
    id: `pkg-${sourcePackage}-${targetPackage}`,  // ← BUG: type missing from id
    type: relation.type,
    source: sourcePackage,
    target: targetPackage,
  });
}
```

## Evidence

Inline reproduction (no build required):

```bash
node -e "
const entities = [
  { id: 'FooImpl', sourceLocation: { file: 'src/cli/foo.ts', startLine:1, endLine:1 }, name:'FooImpl', type:'class', visibility:'public', members:[] },
  { id: 'BarBase', sourceLocation: { file: 'src/parser/bar.ts', startLine:1, endLine:1 }, name:'BarBase', type:'class', visibility:'public', members:[] },
];
const relations = [
  { id: 'FooImpl_dependency_BarBase', type: 'dependency', source: 'FooImpl', target: 'BarBase' },
  { id: 'FooImpl_inheritance_BarBase', type: 'inheritance', source: 'FooImpl', target: 'BarBase' },
];
const entityToPackage = new Map([['FooImpl','cli'],['BarBase','parser']]);
const map = new Map();
for (const r of relations) {
  const sp = entityToPackage.get(r.source);
  const tp = entityToPackage.get(r.target);
  const key = \`\${sp}:\${tp}:\${r.type}\`;
  if (!map.has(key)) map.set(key, { id: \`pkg-\${sp}-\${tp}\`, type: r.type, source: sp, target: tp });
}
const result = Array.from(map.values());
console.log('IDs:', result.map(r=>r.id));
console.log('Unique?', new Set(result.map(r=>r.id)).size === result.length);
"
```

Output:
```
IDs: [ 'pkg-cli-parser', 'pkg-cli-parser' ]
Unique? false
```

File: `src/parser/archjson-aggregator.ts`, line 311  
Fix is one character: change

```typescript
id: `pkg-${sourcePackage}-${targetPackage}`,
```
to
```typescript
id: `pkg-${sourcePackage}-${targetPackage}-${relation.type}`,
```

Existing tests at `tests/unit/parser/archjson-aggregator.test.ts` (lines 837–875) only test deduplication of same-type cross-package relations, so no test currently covers the multi-type case.

## AC

- [ ] `id: \`pkg-${sourcePackage}-${targetPackage}-${relation.type}\`` — type suffix added to ensure ID uniqueness per (source, target, type) triple
- [ ] New regression test: two relations of different types between the same package pair must produce two entries with distinct IDs

## DoD

- All tests pass (`npm test`)
- The specific defect is resolved
- A regression test covers the fixed behavior
