# Proposal: Java Cross-Package Inheritance Resolution

**Status**: Draft
**Date**: 2026-03-13
**Author**: ArchGuard Team

---

## 1. Background

### Current state

The Java plugin's ArchJSON mapper resolves parent class names by assuming they live in the same package as the child class. When `GemmaModel extends LlamaModel` and the two classes reside in different packages (`gemma` vs `llama`), the mapper produces a relation target of `com.github.tjake.jlama.model.gemma.LlamaModel` instead of the correct `com.github.tjake.jlama.model.llama.LlamaModel`. The entire model family hierarchy in projects like Jlama is invisible in diagrams because all inheritance arrows point to non-existent entities.

### Root cause

`src/plugins/java/archjson-mapper.ts`, `resolveTypeId()` (lines 308–319):

```typescript
private resolveTypeId(typeName: string, currentPackage: string): string {
  // If already fully qualified (contains dot), use as-is
  if (typeName.includes('.')) {
    return typeName;
  }

  // Otherwise, assume it's in the same package
  if (currentPackage) {
    return `${currentPackage}.${typeName}`;
  }

  return typeName;
}
```

When a Java source file contains `extends LlamaModel` but does not spell out the fully-qualified name (Java resolves this through `import` statements at compile time), the tree-sitter parser captures only the simple name `LlamaModel`. The mapper then prepends `currentPackage` (the child class's package, e.g., `com.github.tjake.jlama.model.gemma`), producing a wrong qualified name.

The mapper has no knowledge of the full entity set when `resolveTypeId()` is called — it processes one package at a time in `mapRelations()`.

### Impact

- Cross-package inheritance relations produce dangling targets: `...gemma.LlamaModel` instead of `...llama.LlamaModel`.
- Mermaid class diagrams show zero inheritance arrows for cross-package hierarchies.
- The `isUserDefinedType()` filter passes correctly (the type is user-defined), but the resolved ID is wrong.
- In Jlama: the entire model family (`GemmaModel`, `MistralModel`, `Phi2Model` all extending `AbstractModel` variants in different packages) is invisible in diagrams.

---

## 2. Proposed Solution

### Approach

A two-pass strategy:

1. **First pass** (existing): `mapEntities()` builds the complete entity list across all packages — the entity IDs use `createEntityId(packageName, className)` which produces `com.github.tjake.jlama.model.llama.LlamaModel`.

2. **Second pass** (new): after `mapEntities()`, build a `Map<simpleName, qualifiedId>` index across all entities. Then for each inheritance relation in `mapRelations()`, when `resolveTypeId()` produces a candidate ID that is not in the entity set, look up the simple name in the global index and substitute the correct qualified ID.

This is a **post-processing reconciliation** step on the final relation array. It does not require restructuring the existing per-package processing loop.

### Key changes

| File | Change |
|---|---|
| `src/plugins/java/archjson-mapper.ts` | New public `reconcileInheritanceTargets(entities, relations)` post-pass method |
| `src/plugins/java/index.ts` (or wherever mappers are orchestrated) | Call `reconcileInheritanceTargets` after `mapEntities()` + `mapRelations()` |
| `tests/unit/plugins/java/archjson-mapper.test.ts` | Tests for cross-package inheritance resolution |

---

## 3. Acceptance Criteria

1. `GemmaModel extends LlamaModel` (different packages) produces a relation target of `com.github.tjake.jlama.model.llama.LlamaModel`, not `...gemma.LlamaModel`.
2. Same-package inheritance (e.g., `FooBar extends Foo` where both are in `com.example`) is unchanged.
3. Already-fully-qualified parent names (containing `.`) are passed through unchanged.
4. Simple names that match multiple entities in different packages: the first entity found wins (documented limitation).
5. No regression in existing Java relation tests.

---

## 4. Out of Scope

- Resolving import statements from the Java source text to disambiguate same-name classes in different packages. This would require storing parsed `import` declarations in `JavaRawClass`, which is a tree-sitter-bridge change beyond this plan's scope.
- Fixing `interface extends` cross-package resolution (addressed by the same reconciliation pass as a bonus).
- Python, Go, C++, TypeScript cross-package resolution (different ID formats).
