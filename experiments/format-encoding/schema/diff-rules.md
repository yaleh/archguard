# Diff Rules for Format-Encoding Roundtrip Gate

Version: 1.0  
Experiment: plan-73-81 (format-encoding)  
Section reference: proposal §2.1

These rules define the canonical comparison algorithm used in the roundtrip gate. A roundtrip is **equal** when all four rules pass simultaneously. Any deviation logs the rule number, the field path, and both values.

---

## Rule 1 — Entity Set Equality

Entities are compared as `Set<id>` (order-independent). Two entity sets are equal when:

1. The sets of entity IDs are identical (same members, same count).
2. For each matched entity pair, every field compares equal after type enum normalization: all `type` values are lowercased before comparison (`"Class"` → `"class"`, `"INTERFACE"` → `"interface"`).

### Positive example — reordered entities are equal

```json
// Original
{
  "entities": [
    { "id": "com.example.foo", "name": "Foo", "type": "class", "methods": [] },
    { "id": "com.example.bar", "name": "Bar", "type": "interface", "methods": [] }
  ]
}

// Roundtrip output (order reversed)
{
  "entities": [
    { "id": "com.example.bar", "name": "Bar", "type": "Interface", "methods": [] },
    { "id": "com.example.foo", "name": "Foo", "type": "Class",     "methods": [] }
  ]
}
```

Result: **EQUAL**. Both IDs present; after lowercasing `"Class"` → `"class"` and `"Interface"` → `"interface"`, all fields match.

### Negative example — missing entity is not equal

```json
// Original
{
  "entities": [
    { "id": "com.example.foo", "name": "Foo", "type": "class", "methods": [] },
    { "id": "com.example.bar", "name": "Bar", "type": "class", "methods": [] }
  ]
}

// Roundtrip output (Bar dropped)
{
  "entities": [
    { "id": "com.example.foo", "name": "Foo", "type": "class", "methods": [] }
  ]
}
```

Result: **NOT EQUAL**. Deviation log: `rule=1 path=entities missing_id="com.example.bar"`.

---

## Rule 2 — Relation Set Equality

Relations are compared as `Set<(from, to, type)>` triples (order-independent). Each triple is an atomic member of the set. Multiple relations that share the same `(from, to)` pair but differ in `type` are **distinct** members and must all be present.

### Positive example — reordered relations are equal

```json
// Original
{
  "relations": [
    { "from": "com.example.foo", "to": "com.example.bar", "type": "dependency" },
    { "from": "com.example.foo", "to": "com.example.baz", "type": "inheritance" }
  ]
}

// Roundtrip output (order reversed)
{
  "relations": [
    { "from": "com.example.foo", "to": "com.example.baz", "type": "inheritance" },
    { "from": "com.example.foo", "to": "com.example.bar", "type": "dependency" }
  ]
}
```

Result: **EQUAL**. Both triples present; order is irrelevant.

### Negative example — extra relation is not equal

```json
// Original
{
  "relations": [
    { "from": "com.example.foo", "to": "com.example.bar", "type": "dependency" }
  ]
}

// Roundtrip output (extra relation added)
{
  "relations": [
    { "from": "com.example.foo", "to": "com.example.bar", "type": "dependency" },
    { "from": "com.example.foo", "to": "com.example.bar", "type": "composition" }
  ]
}
```

Result: **NOT EQUAL**. Deviation log: `rule=2 path=relations extra_triple=(com.example.foo,com.example.bar,composition)`.

---

## Rule 3 — Nullable Field Handling

The following nullable equivalences are pre-registered. A field value on the left is treated as equal to the value on the right during comparison:

| Field         | Null equivalent |
|---------------|----------------|
| `params`      | `[]` (empty array) |
| `returnType`  | `"void"` |
| `sourceFile`  | `"unknown"` |
| `methods`     | `[]` (empty array) |

Any nullable field **not** in this list uses conservative equality: `null` vs absent (or any other value) is **NOT equal** and triggers a deviation log entry.

### Positive example — null params vs empty array are equal

```json
// Original entity method
{ "name": "doWork", "params": null, "returnType": null }

// Roundtrip output
{ "name": "doWork", "params": [],   "returnType": "void" }
```

Result: **EQUAL**. `null` params maps to `[]`; `null` returnType maps to `"void"` — both covered by pre-registered equivalences.

### Negative example — null on unregistered field is not equal

```json
// Original entity
{ "id": "com.example.foo", "name": "Foo", "type": "class", "description": null }

// Roundtrip output (field absent entirely)
{ "id": "com.example.foo", "name": "Foo", "type": "class" }
```

Result: **NOT EQUAL**. `description` is not in the pre-registered equivalence list; `null` vs absent is a divergence. Deviation log: `rule=3 path=entities["com.example.foo"].description original=null roundtrip=undefined`.

---

## Rule 4 — ID Alias Normalization

Both the renderer and the parser must produce entity IDs using the same normalization function:

```
id = fullyQualifiedName.toLowerCase().trim()
```

All ID comparisons in Rules 1 and 2 apply this normalization to both sides before matching.

### Positive example — mixed-case IDs are equal after normalization

```json
// Original (renderer emitted mixed-case)
{ "id": "com.example.MyClass", "name": "MyClass", "type": "class" }

// Roundtrip output (parser lowercased)
{ "id": "com.example.myclass", "name": "MyClass", "type": "class" }
```

Normalized original: `"com.example.myclass"`  
Normalized roundtrip: `"com.example.myclass"`

Result: **EQUAL**.

### Negative example — wrong normalization function causes divergence

```json
// Original (renderer used camelCase stripping instead of toLowerCase)
{ "id": "comexamplemyclass", "name": "MyClass", "type": "class" }

// Roundtrip output (parser used toLowerCase correctly)
{ "id": "com.example.myclass", "name": "MyClass", "type": "class" }
```

Normalized original (wrong fn): `"comexamplemyclass"`  
Normalized roundtrip (correct fn): `"com.example.myclass"`

Result: **NOT EQUAL**. Deviation log: `rule=4 path=entities id_mismatch original_normalized="comexamplemyclass" roundtrip_normalized="com.example.myclass"`.

---

## TypeScript Pseudocode — Full Diff Algorithm

```typescript
// Types mirror ArchJSON structure (simplified for diff purposes)
interface Entity {
  id: string;
  name: string;
  type: string;
  methods?: Method[] | null;
  [field: string]: unknown;
}

interface Method {
  name: string;
  params?: Param[] | null;
  returnType?: string | null;
  sourceFile?: string | null;
}

interface Param {
  name: string;
  type: string;
}

interface Relation {
  from: string;
  to: string;
  type: string;
}

interface ArchJSON {
  entities: Entity[];
  relations: Relation[];
}

interface DeviationEntry {
  rule: 1 | 2 | 3 | 4;
  path: string;
  original: unknown;
  roundtrip: unknown;
}

// Pre-registered nullable equivalences (Rule 3)
const NULLABLE_EQUIVALENCES: Record<string, unknown> = {
  params:     [],
  returnType: 'void',
  sourceFile: 'unknown',
  methods:    [],
};

// Rule 4 — ID normalization
function normalizeId(id: string): string {
  return id.toLowerCase().trim();
}

// Rule 3 — resolve a nullable value to its canonical form
function resolveNullable(field: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    if (field in NULLABLE_EQUIVALENCES) {
      return NULLABLE_EQUIVALENCES[field];
    }
    // Conservative: keep null/undefined as-is so comparison fails
    return value;
  }
  return value;
}

// Deep equality for primitive-or-array values after nullable resolution
function fieldsEqual(field: string, a: unknown, b: unknown): boolean {
  const ra = resolveNullable(field, a);
  const rb = resolveNullable(field, b);
  // Arrays: compare as sorted JSON for simplicity (params order is significant within a method)
  return JSON.stringify(ra) === JSON.stringify(rb);
}

// Rule 1 + Rule 3 + Rule 4 — compare entity sets
function diffEntities(
  original: Entity[],
  roundtrip: Entity[],
  deviations: DeviationEntry[],
): void {
  const origMap = new Map(original.map(e => [normalizeId(e.id), e]));
  const rtMap   = new Map(roundtrip.map(e => [normalizeId(e.id), e]));

  // Missing in roundtrip
  for (const [nid, orig] of origMap) {
    if (!rtMap.has(nid)) {
      deviations.push({ rule: 1, path: `entities`, original: orig.id, roundtrip: undefined });
    }
  }

  // Extra in roundtrip
  for (const [nid, rt] of rtMap) {
    if (!origMap.has(nid)) {
      deviations.push({ rule: 1, path: `entities`, original: undefined, roundtrip: rt.id });
    }
  }

  // Field-by-field comparison for matched pairs
  for (const [nid, orig] of origMap) {
    const rt = rtMap.get(nid);
    if (!rt) continue;

    // Rule 1: type enum normalization
    if ((orig.type ?? '').toLowerCase() !== (rt.type ?? '').toLowerCase()) {
      deviations.push({
        rule: 1,
        path: `entities["${nid}"].type`,
        original: orig.type,
        roundtrip: rt.type,
      });
    }

    // Rule 3: nullable fields on entity
    for (const field of ['methods'] as const) {
      if (!fieldsEqual(field, orig[field], rt[field])) {
        deviations.push({
          rule: 3,
          path: `entities["${nid}"].${field}`,
          original: orig[field],
          roundtrip: rt[field],
        });
      }
    }

    // Rule 3: nullable fields on each method
    const origMethods: Method[] = (resolveNullable('methods', orig.methods) as Method[]) ?? [];
    const rtMethods:   Method[] = (resolveNullable('methods', rt.methods)   as Method[]) ?? [];
    for (const om of origMethods) {
      const rm = rtMethods.find(m => m.name === om.name);
      if (!rm) {
        deviations.push({ rule: 1, path: `entities["${nid}"].methods`, original: om.name, roundtrip: undefined });
        continue;
      }
      for (const field of ['params', 'returnType', 'sourceFile'] as const) {
        if (!fieldsEqual(field, om[field], rm[field])) {
          deviations.push({
            rule: 3,
            path: `entities["${nid}"].methods["${om.name}"].${field}`,
            original: om[field],
            roundtrip: rm[field],
          });
        }
      }
    }
  }
}

// Rule 2 + Rule 4 — compare relation sets
function diffRelations(
  original: Relation[],
  roundtrip: Relation[],
  deviations: DeviationEntry[],
): void {
  function tripleKey(r: Relation): string {
    return `${normalizeId(r.from)}||${normalizeId(r.to)}||${r.type.toLowerCase().trim()}`;
  }

  const origSet = new Set(original.map(tripleKey));
  const rtSet   = new Set(roundtrip.map(tripleKey));

  for (const key of origSet) {
    if (!rtSet.has(key)) {
      deviations.push({ rule: 2, path: 'relations', original: key, roundtrip: undefined });
    }
  }

  for (const key of rtSet) {
    if (!origSet.has(key)) {
      deviations.push({ rule: 2, path: 'relations', original: undefined, roundtrip: key });
    }
  }
}

// Top-level diff entry point
export function diffArchJSON(
  original: ArchJSON,
  roundtrip: ArchJSON,
): { equal: boolean; deviations: DeviationEntry[] } {
  const deviations: DeviationEntry[] = [];

  diffEntities(original.entities,   roundtrip.entities,   deviations);
  diffRelations(original.relations, roundtrip.relations,  deviations);

  return { equal: deviations.length === 0, deviations };
}
```

---

## Summary Table

| Rule | Scope | Key invariant |
|------|-------|--------------|
| 1 | Entity set | Order-independent; type enum lowercased |
| 2 | Relation set | Triple `(from,to,type)` membership; order-independent |
| 3 | Nullable fields | Pre-registered equivalences only; unlisted nulls are not equal |
| 4 | ID normalization | `fullyQualifiedName.toLowerCase().trim()` applied before every comparison |
