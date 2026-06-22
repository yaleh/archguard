# Proposal: Fix Python Package Diagram Zero-Arrow Issue

**Status**: Proposed
**Priority**: HIGH
**Affected subsystem**: `src/parser/archjson-aggregator.ts`

---

## Problem Statement

Python package diagrams consistently show 0 arrows (inter-package relations) even when the Python plugin correctly emits module-level relations.

### Root Cause

`ArchJSONAggregator.analyzePackageDependencies()` maps class-level relations to package-level relations using an `entityToPackage` map keyed by entity ID. For Python, entity IDs are class-level dotted names like `pytorch.engine.Engine`. The `entityToPackage` map is populated by iterating over entities and extracting their package from `entity.sourceLocation.file`.

However, Python relations have module-level IDs as their `source` field. For example, a relation emitted by the Python plugin has:

```json
{ "source": "pytorch.engine", "target": "pytorch.optimizer", "type": "dependency" }
```

Here `pytorch.engine` is the module (file) identifier, not a class identifier. The `entityToPackage.get("pytorch.engine")` call returns `undefined` because `entityToPackage` is keyed by class IDs like `pytorch.engine.Engine`.

Since `sourcePackage === undefined`, the relation is silently skipped. All Python relations are dropped, producing 0 package arrows.

---

## Proposed Solution

Build a secondary `moduleToPackage: Map<string, string>` lookup after the primary `entityToPackage` map is populated. For each entity ID, strip the last dotted component to get its containing module path, then map that module path to the same package name.

Example:
- Entity `pytorch.engine.Engine` has package `pytorch`
- Module prefix `pytorch.engine` → maps to `pytorch`

When `entityToPackage.get(relation.source)` returns `undefined`, fall back to `moduleToPackage.get(relation.source)`. If still undefined, progressively strip the last component and retry (handles cases where the relation source is shorter than any entity's module path).

This approach is additive: the existing entity-level lookup remains unchanged. Only the fallback path is new.

---

## Expected Impact

- Python package diagrams for lmdeploy, PyTorch, and similar projects will show inter-package dependency arrows
- No impact on TypeScript, Go, Java, or C++ package diagrams (entity IDs in those languages are class-level and already resolve correctly)

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Module prefix collision (two packages share a module prefix) | Progressive stripping stops at first match; first match wins |
| Performance impact of building moduleToPackage | O(entities × depth); depth ≤ 6 for Python; negligible |
| False positive relations added | Only affects unresolved sources; existing resolved sources are unchanged |
