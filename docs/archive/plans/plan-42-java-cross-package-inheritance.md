# Plan 42: Java Cross-Package Inheritance Resolution

**Proposal**: `docs/proposals/proposal-java-cross-package-inheritance.md`
**Priority**: HIGH (cross-package inheritance arrows entirely absent in Java class diagrams)
**Estimated total changes**: ~70 lines source + ~60 test lines across 3 files

---

## Overview

A post-processing reconciliation pass that corrects inheritance relation targets when the simple class name was resolved to the wrong package due to the same-package assumption in `resolveTypeId()`.

| # | Issue | Root cause | Priority |
|---|---|---|---|
| 1 | Cross-package inheritance targets wrong package | `resolveTypeId()` prepends `currentPackage` to unqualified names | HIGH |

---

## Phase A — Build Global Name Index and Reconcile Inheritance Targets

**Files**: `src/plugins/java/archjson-mapper.ts`, `src/plugins/java/index.ts`, `tests/unit/plugins/java/archjson-mapper.test.ts`
**Estimated lines**: ~70 source + ~60 test

### Stage A1 — Understand the current call flow

**File**: `src/plugins/java/archjson-mapper.ts`

The current `mapRelations()` (line 213) iterates over packages and calls `resolveTypeId(cls.superClass, cls.packageName)`. The `resolveTypeId()` at line 308 prepends `currentPackage` for any unqualified name (one that doesn't contain `.`).

**File**: `src/plugins/java/index.ts`

Lines 148–149, 209–210, and 265–266 all follow the pattern:

```typescript
const entities = this.mapper.mapEntities(packageList);
const relations = this.mapper.mapRelations(packageList);
```

Both calls are separate and `mapRelations()` has no access to the full entity list.

### Stage A2 — Add reconcileInheritanceTargets() public method

**File**: `src/plugins/java/archjson-mapper.ts`

Add a new public method to `ArchJsonMapper` (after the existing `mapRelations()` method):

```typescript
/**
 * Post-pass: correct inheritance/implementation relation targets that were resolved
 * to the wrong package (same-package assumption in resolveTypeId()).
 *
 * Algorithm:
 * 1. Build a Set of all known entity IDs for O(1) existence checks.
 * 2. Build a simple-name → first-qualified-ID index from the entity list.
 * 3. For each inheritance or implementation relation:
 *    a. If target is already a known entity ID, leave unchanged.
 *    b. Extract the simple name (last dot-segment) of the current target.
 *    c. Look it up in the global index.
 *    d. If found and different from current target, replace the target.
 *
 * Collision policy: when multiple entities share the same simple name,
 * the first entity in the entity list wins. Java's own compiler requires
 * an unambiguous import for same-name classes in different packages,
 * so this collision is extremely rare in well-formed code.
 *
 * @param entities - Full entity list from mapEntities() (all packages)
 * @param relations - Relations from mapRelations() (not mutated; returns new array)
 * @returns New Relation[] with corrected inheritance/implementation targets
 */
reconcileInheritanceTargets(entities: Entity[], relations: Relation[]): Relation[] {
  // 1. Set of all known entity IDs
  const entityIdSet = new Set<string>(entities.map((e) => e.id));

  // 2. simple name → first qualifying entity ID
  //    e.g. 'LlamaModel' → 'com.github.tjake.jlama.model.llama.LlamaModel'
  const simpleNameToId = new Map<string, string>();
  for (const entity of entities) {
    if (!simpleNameToId.has(entity.name)) {
      simpleNameToId.set(entity.name, entity.id);
    }
  }

  // 3. Reconcile
  return relations.map((rel) => {
    // Only fix inheritance and implementation relations
    if (rel.type !== 'inheritance' && rel.type !== 'implementation') {
      return rel;
    }

    // Target already correct — it exists in the entity set
    if (entityIdSet.has(rel.target)) {
      return rel;
    }

    // Extract the simple name from the wrong-package qualified name
    // e.g. 'com.example.gemma.LlamaModel' → 'LlamaModel'
    const simpleName = rel.target.includes('.')
      ? rel.target.split('.').pop()!
      : rel.target;

    const correctedId = simpleNameToId.get(simpleName);
    if (!correctedId || correctedId === rel.target) {
      return rel; // not in entity set (external type) or already correct
    }

    return {
      ...rel,
      id: `${rel.source}_${rel.type}_${correctedId}`,
      target: correctedId,
    };
  });
}
```

**Acceptance**: Given entities `[{ name: 'LlamaModel', id: 'com.example.llama.LlamaModel' }]` and a relation `{ type: 'inheritance', source: 'com.example.gemma.GemmaModel', target: 'com.example.gemma.LlamaModel' }`, the method returns a relation with `target: 'com.example.llama.LlamaModel'`.

### Stage A3 — Wire reconcileInheritanceTargets into the Java plugin pipeline

**File**: `src/plugins/java/index.ts`

There are three call sites at lines 148–149, 209–210, and 265–266. Each follows the same pattern. Wrap the relations call with the reconcile post-pass at each site:

```typescript
// BEFORE (all three sites):
const entities = this.mapper.mapEntities(packageList);
const relations = this.mapper.mapRelations(packageList);

// AFTER:
const entities = this.mapper.mapEntities(packageList);
const rawRelations = this.mapper.mapRelations(packageList);
const relations = this.mapper.reconcileInheritanceTargets(entities, rawRelations);
```

This is a non-invasive change: `reconcileInheritanceTargets()` returns a new array and does not mutate its inputs.

**Acceptance**: When parsing a Java project with cross-package inheritance (`GemmaModel extends LlamaModel` where `GemmaModel` is in `model.gemma` and `LlamaModel` is in `model.llama`), the resulting relation has `target: '...model.llama.LlamaModel'`.

### Stage A4 — Add unit tests for cross-package reconciliation

**File**: `tests/unit/plugins/java/archjson-mapper.test.ts`

Add test group: `describe('reconcileInheritanceTargets — cross-package inheritance')`:

```typescript
it('corrects inheritance target when parent is in a different package', () => {
  const entities: Entity[] = [
    { id: 'com.example.llama.LlamaModel', name: 'LlamaModel', type: 'class', visibility: 'public', members: [] },
    { id: 'com.example.gemma.GemmaModel', name: 'GemmaModel', type: 'class', visibility: 'public', members: [] },
  ];
  const relations: Relation[] = [{
    id: 'com.example.gemma.GemmaModel_inheritance_com.example.gemma.LlamaModel',
    type: 'inheritance',
    source: 'com.example.gemma.GemmaModel',
    target: 'com.example.gemma.LlamaModel', // wrong — gemma package has no LlamaModel
  }];

  const result = mapper.reconcileInheritanceTargets(entities, relations);

  expect(result[0].target).toBe('com.example.llama.LlamaModel');
  expect(result[0].source).toBe('com.example.gemma.GemmaModel');
});

it('leaves same-package inheritance unchanged when target is already correct', () => {
  const entities: Entity[] = [
    { id: 'com.example.pkg.Parent', name: 'Parent', type: 'class', visibility: 'public', members: [] },
    { id: 'com.example.pkg.Child', name: 'Child', type: 'class', visibility: 'public', members: [] },
  ];
  const relations: Relation[] = [{
    id: 'com.example.pkg.Child_inheritance_com.example.pkg.Parent',
    type: 'inheritance',
    source: 'com.example.pkg.Child',
    target: 'com.example.pkg.Parent', // correct — exists in entity set
  }];

  const result = mapper.reconcileInheritanceTargets(entities, relations);

  expect(result[0].target).toBe('com.example.pkg.Parent'); // unchanged
});

it('leaves external (JDK/library) inheritance targets unchanged', () => {
  const entities: Entity[] = [
    { id: 'com.example.MyList', name: 'MyList', type: 'class', visibility: 'public', members: [] },
  ];
  const relations: Relation[] = [{
    id: 'com.example.MyList_inheritance_com.example.AbstractList',
    type: 'inheritance',
    source: 'com.example.MyList',
    target: 'com.example.AbstractList', // not in entity set (external)
  }];

  const result = mapper.reconcileInheritanceTargets(entities, relations);

  expect(result[0].target).toBe('com.example.AbstractList'); // unchanged
});

it('does not alter dependency relations (only inheritance/implementation)', () => {
  const entities: Entity[] = [
    { id: 'com.example.b.Service', name: 'Service', type: 'class', visibility: 'public', members: [] },
  ];
  const relations: Relation[] = [{
    id: 'com.example.a.Client_dependency_com.example.a.Service',
    type: 'dependency',
    source: 'com.example.a.Client',
    target: 'com.example.a.Service', // wrong package, but it's a dependency — not fixed
  }];

  const result = mapper.reconcileInheritanceTargets(entities, relations);

  // dependency type is not touched by this method
  expect(result[0].target).toBe('com.example.a.Service');
});

it('reconciles implementation relations across packages', () => {
  const entities: Entity[] = [
    { id: 'com.example.api.Repository', name: 'Repository', type: 'interface', visibility: 'public', members: [] },
    { id: 'com.example.impl.UserService', name: 'UserService', type: 'class', visibility: 'public', members: [] },
  ];
  const relations: Relation[] = [{
    id: 'com.example.impl.UserService_implementation_com.example.impl.Repository',
    type: 'implementation',
    source: 'com.example.impl.UserService',
    target: 'com.example.impl.Repository', // wrong — should be api.Repository
  }];

  const result = mapper.reconcileInheritanceTargets(entities, relations);

  expect(result[0].target).toBe('com.example.api.Repository');
});
```

**Dependencies**: A2, A3

---

## Dependency Graph

```
A2 (add reconcileInheritanceTargets) → A3 (wire into plugin) → A4 (tests)
A4 depends on A2 (tests the method directly)
A3 depends on A2 (uses the method)
```

---

## Testing Strategy

- **TDD**: Write A4 tests before implementing A2. The method can be tested in isolation without wiring.
- **Unit-only**: No integration tests needed; the reconciliation is pure logic.
- **Existing test suite**: Must remain green (2787+ tests) after all phases.
- **Jlama validation**: Run `node dist/cli/index.js analyze -s /path/to/jlama/src --lang java` and verify that the class diagram shows inheritance arrows between model classes in different packages.

---

## Acceptance Criteria

| Stage | Criterion |
|---|---|
| A2 | `reconcileInheritanceTargets` returns corrected target for cross-package parent |
| A2 | Same-package parent (already in entity set) is left unchanged |
| A2 | External (JDK/library) parents not in entity set are left unchanged |
| A2 | Dependency relations are not modified |
| A3 | Three call sites in `index.ts` use reconciled relations |
| A3 | Jlama analysis shows `GemmaModel → LlamaModel` inheritance in class diagram |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Two user-defined classes with same simple name in different packages | First entity wins (documented limitation); Java compiler requires disambiguating import in real code, so this is rare |
| Performance: O(relations × 1) — just Map.get lookups | Map construction is O(entities); lookup is O(1); negligible for typical Java projects |
| Reconciliation incorrectly fixes an already-correct target | Guard: `if (entityIdSet.has(rel.target)) return rel` ensures already-correct targets are never modified |

---

## Validation

```bash
npm run build
node dist/cli/index.js analyze -s /path/to/jlama/src --lang java
# Check class/all-classes.mmd for inheritance arrows:
grep -c "-->|" .archguard/class/all-classes.mmd
# Verify GemmaModel → LlamaModel appears (not GemmaModel → wrongpackage.LlamaModel)
grep "LlamaModel" .archguard/class/all-classes.mmd
```
