# Proposal: Spike — Cross-File Relation Resolution

**Status**: Proposed (Research Spike)
**Priority**: MEDIUM
**Affected subsystem**: `src/parser/parallel-parser.ts`, `src/parser/typescript-parser.ts`

---

## Problem Statement

`ParallelParser` processes each TypeScript file in isolation, without access to TypeScript's `TypeChecker`. As a result, relation targets extracted from class bodies are bare simple names (e.g., `ILanguagePlugin`, `ErrorHandler`) rather than qualified entity IDs (e.g., `core/interfaces/plugin.ts.ILanguagePlugin`).

When the `MermaidGenerator` renders class diagrams, it filters relations where neither the source nor target is in `knownEntityIds`. Since ~97% of relation targets are bare names that do not appear in the entity ID set (which uses fully-qualified relative path IDs), nearly all class diagram relations are dropped. The result is class diagrams with entities but no arrows.

### Why `TypeChecker` is not used

`TypeScriptPlugin` (Path A, for package diagrams) uses `ts-morph` with `TypeChecker` and correctly resolves cross-file types. However, `ParallelParser` (Path B, for class/method diagrams) was designed for speed and parallelism — it skips `ts-morph` project setup and processes files as isolated ASTs. Introducing `TypeChecker` would require a full `ts-morph Project.addSourceFilesAtPaths()` call, which is slow (1–3 minutes for large projects) and defeats the purpose of parallel parsing.

---

## Research Question

Can a post-processing "global name→ID resolution" step resolve most cross-file relation targets without ambiguity, using only the entity list produced by `parseFiles()`?

The hypothesis is: for a given project, most simple class names are unique across the entire codebase (e.g., there is only one `ErrorHandler`, only one `ILanguagePlugin`). If so, a `Map<simpleName, qualifiedId[]>` can resolve bare names to qualified IDs with low ambiguity.

---

## Proposed Spike Implementation

After `parseFiles()` aggregates all entities into an `ArchJSON`, build a resolution map:

```typescript
const nameToIds = new Map<string, string[]>();
for (const entity of archJson.entities) {
  const existing = nameToIds.get(entity.name) ?? [];
  existing.push(entity.id);
  nameToIds.set(entity.name, existing);
}
```

Then, for each relation with an unresolved target (i.e., `knownEntityIds.has(relation.target)` is false):

1. Look up `nameToIds.get(relation.target)`
2. If exactly 1 match: replace `relation.target` with the qualified ID
3. If 0 matches: leave as-is (unresolvable — different package, external dependency)
4. If 2+ matches: apply heuristic — pick the ID whose package prefix most closely matches the source entity's package prefix (longest common prefix wins)

The spike should be implemented as a standalone function `resolveRelationTargets(archJson: ArchJSON): ArchJSON` that can be toggled on/off via a flag.

---

## Success Criteria

| Metric | Target |
|---|---|
| Unambiguous resolutions (1 match) | > 80% of currently-unresolved targets |
| Ambiguous cases (2+ matches) | < 5% of targets |
| False positive rate (wrong ID assigned) | < 2% of resolved targets |
| Performance overhead | < 50ms for projects with < 2000 entities |

---

## Expected Impact

If successful, class diagrams for ArchGuard itself should show > 80% of class-level relations instead of ~3%.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Common names (e.g., `Config`, `Options`) are ambiguous | Heuristic: longest common prefix; fallback to leave unresolved |
| External type names collide with internal ones | External types have 0 matches in nameToIds → unresolvable → safe |
| Resolution order matters (parallel parse doesn't guarantee stable order) | nameToIds built after all entities collected; deterministic |
| Resolving wrong target produces false arrows in diagrams | Track resolution confidence; only apply when confidence = 1 (unique match) |

---

## Scope Exclusions

This spike does not propose:
- Full `TypeChecker` integration (too slow)
- Changing the ArchJSON data format
- Modifying `TypeScriptPlugin` (Path A already resolves correctly)

The spike result will determine whether a full Plan is warranted.
