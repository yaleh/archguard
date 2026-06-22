# Proposal: Python Dataclass Field Extraction

**Status**: Draft
**Date**: 2026-03-13
**Author**: ArchGuard Team

---

## 1. Background

### Current state

Python class entities produced by ArchGuard have 0 field members for dataclass-heavy projects. Annotated assignments (`field: Type = default`, the `AnnAssign` pattern) inside class bodies are not extracted as field-type members. In lmdeploy, key domain objects like `GenerationConfig` (29 fields), `PytorchEngineConfig` (44 fields), and `TurbomindEngineConfig` (38 fields) appear as empty boxes in class diagrams.

### Root cause

`src/plugins/python/tree-sitter-bridge.ts`, `extractClass()` (lines 102–175):

The class body processing loop at line 129 only handles:

```typescript
for (const child of body.namedChildren) {
  if (child.type === 'function_definition') {
    // extracts methods
  } else if (child.type === 'decorated_definition') {
    // extracts decorated methods/properties
  }
  // annotated_assignment, expression_statement, assignment → IGNORED
}
```

Python dataclass fields use the `annotated_assignment` node type in tree-sitter:

```python
@dataclass
class GenerationConfig:
    max_new_tokens: int = 512           # annotated_assignment
    temperature: float = 0.8            # annotated_assignment
    top_p: Optional[float] = None       # annotated_assignment
    stop_words: List[str] = field(default_factory=list)
```

Tree-sitter's `annotated_assignment` node has three named fields:
- `left` — the identifier (`max_new_tokens`)
- `type` — the type annotation (`int`, `Optional[float]`, etc.)
- `right` — the default value expression (optional)

None of these are currently extracted into `classAttributes` or `methods`.

Additionally, `PythonRawClass.classAttributes` is populated as an empty array (`classAttributes: []`) in `extractClass()` (line 168). The `ArchJsonMapper.mapClass()` in `archjson-mapper.ts` (lines 153–156) loops over `cls.properties` but there is no code in `mapClass()` that maps `classAttributes` to `Member` objects.

### Impact

- Dataclass-heavy Python projects show all classes as empty boxes in Mermaid class diagrams.
- lmdeploy: `GenerationConfig` box is empty despite having 29 fields — makes the diagram useless for understanding the configuration API.
- The `PythonRawClass.classAttributes` field exists in the type definition (`types.ts` lines 83, 68–72) but is never populated and never mapped to `Entity.members`.
- Field count in ArchJSON metrics is 0 for all Python dataclasses.

---

## 2. Proposed Solution

### Approach

Two coordinated changes:

1. **tree-sitter-bridge.ts `extractClass()`**: Add handling for `annotated_assignment` nodes in the class body loop. Extract `left` (field name), `type` (annotation text), and optionally `right` (default value text) from each such node. Populate `classAttributes` on the returned `PythonRawClass`.

2. **archjson-mapper.ts `mapClass()`**: Add a loop over `cls.classAttributes` that maps each attribute to a `Member` with `type: 'field'`, `fieldType` set to the annotation string, and appropriate visibility (private if name starts with `_`).

Also handle `expression_statement` nodes that wrap assignments without annotation (e.g., `x = 5` at class level) — these are lower priority but should be handled for completeness.

### Key changes

| File | Change |
|---|---|
| `src/plugins/python/tree-sitter-bridge.ts` | Add `annotated_assignment` extraction in `extractClass()` class body loop |
| `src/plugins/python/archjson-mapper.ts` | Add `classAttributes` → `Member[]` mapping in `mapClass()` |
| `tests/unit/plugins/python/python-plugin.test.ts` | Tests for dataclass field extraction |
| `tests/unit/plugins/python/archjson-mapper.test.ts` | Tests for classAttributes → Member mapping |

---

## 3. Acceptance Criteria

1. A Python class with `field: int = 0` produces a `Member` with `type: 'field'`, `name: 'field'`, `fieldType: 'int'`.
2. A class with `value: Optional[float] = None` produces a `Member` with `fieldType: 'Optional[float]'`.
3. A class with `_private: str = ''` produces a `Member` with `visibility: 'private'`.
4. `GenerationConfig` with 10 annotated fields produces an entity with 10 field members (plus any methods).
5. Classes with no annotated assignments (method-only classes) are unaffected (0 field members).
6. The `@dataclass` decorator is not required — any class-level annotated assignment is extracted.

---

## 4. Out of Scope

- Extracting class-level `assignment` nodes without type annotation (e.g., `x = 5`). These carry no type information and add noise to diagrams.
- Resolving type annotation strings to entity IDs for relations (e.g., creating a `dependency` relation from `field: MyClass`). This is a follow-on feature.
- `__init__` parameter-as-field inference (used in some non-dataclass patterns). Out of scope.
