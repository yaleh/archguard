# Proposal: Fix lastArchJson Nondeterminism for Test Analysis Scope

**Status**: Proposed
**Priority**: HIGH
**Affected subsystem**: `src/cli/processors/query-scope-collector.ts`, `src/cli/processors/diagram-processor.ts`

---

## Problem Statement

`DiagramProcessor.processAll()` processes source groups in parallel via `pMap`. After each group is parsed, `QueryScopeCollector.setLastArchJson()` is called to record which ArchJSON to use for test analysis. The current logic is:

```typescript
setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void {
  if (this._lastArchJson === null || groupHasPrimary) {
    this._lastArchJson = archJson;
  }
}
```

For a typical ArchGuard self-analysis run, diagrams include:
- `overview/package` (all source files, produces 447 entities)
- `class/all-classes` (all source files, same sources — may produce 447 entities)
- `method/analysis` (sub-directory, produces ~4 entities)
- `method/cli` (sub-directory, produces ~40 entities)
- etc.

Because `pMap` processes groups concurrently with no completion order guarantee, whichever group resolves first sets `_lastArchJson`. If `method/analysis` (4 entities) completes before `class/all-classes` (447 entities), the test analyzer receives only 4 entities. This makes `entityCoverageRatio` nearly 0% regardless of actual test coverage.

The `primary` role system partially addresses this: the package/class diagrams are tagged `queryRole: 'primary'`, so `groupHasPrimary = true` triggers an overwrite. However, if `method/analysis` (no primary role) completes AFTER `overview/package` has already set `_lastArchJson`, the overwrite guard (`groupHasPrimary === false` → skip) protects the correct value. The real failure mode is when `overview/package` has NOT yet completed when a non-primary method group sets the initial value — because the first-write condition `_lastArchJson === null` triggers.

In practice, any non-primary group that completes first sets `_lastArchJson` to a small sub-module ArchJSON. The subsequent primary group overwrites it, but if the primary group is slow (disk cache miss), there is a window where test analysis begins with the wrong scope.

---

## Proposed Solution

Strengthen `setLastArchJson()` to also compare entity counts: when overwriting with a primary group, always take it. When the first value is set (null → first), prefer high entity count. Add a third condition: even without primary role, overwrite if the incoming ArchJSON has significantly more entities than the stored one.

The fix should be in `QueryScopeCollector.setLastArchJson()`. Specifically:

```
if (_lastArchJson === null: always store
else if groupHasPrimary: always overwrite (primary wins)
else if incoming.entities.length > stored.entities.length: overwrite (richer wins)
else: no-op (existing behavior)
```

The "richer wins" condition ensures that even without explicit `queryRole = 'primary'`, the largest ArchJSON is selected — which is the correct scope for test analysis.

---

## Expected Impact

- `entityCoverageRatio` for TypeScript projects becomes deterministic regardless of parse completion order
- No behavioral change when all groups complete in the expected order (primary group first)
- Method-level sub-module ArchJSONs (4–40 entities) never overwrite the full-project ArchJSON (447 entities)

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| "Richer wins" selects wrong scope in multi-language projects | Language-specific projects have only one primary language group; the richer one is always correct |
| Entity count comparison adds overhead | O(1) comparison of `.length` fields; negligible |
| Behavior change breaks existing tests | Existing tests that assert on `getLastArchJson()` will need updating only if they relied on non-primary small groups winning |
