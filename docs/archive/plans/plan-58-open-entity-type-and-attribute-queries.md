# Plan 58 — Open EntityType and Attribute Queries

## Overview

Implement the changes described in `docs/proposals/proposal-open-entity-type-and-attribute-queries.md`.

The plan widens `EntityType` from a closed union to `KnownEntityType | string`, adds an optional `Entity.attributes` field for domain metadata, introduces `EntityTypeRegistry` for plugin-declared custom types, extends `QueryEngine` with attribute-aware query methods, adds a `--attr` CLI flag to `query`, and makes the Mermaid renderer degrade gracefully for unknown entity types.

**Total estimated diff**: ~350 lines across 4 phases, each self-contained and testable.

---

## Phase 1 — Open EntityType and remove illegal casts

**Goal**: Replace the closed `EntityType` union with `KnownEntityType | string`. Remove the `as any` and `as string` workarounds in `archjson-aggregator.ts`, `grouper.ts`, and `cpp/archjson-mapper.ts`. No behaviour change; existing tests must remain green.

**Dependencies**: none (pure type-system refactor, safe to land first).

**Test files**:
- `tests/unit/types/entity-type.test.ts` (new)

### Stage 1.1 — Write tests first

File: `tests/unit/types/entity-type.test.ts`

Test cases:
1. `KnownEntityType` values include all seven original literals (`'class'`, `'interface'`, `'enum'`, `'struct'`, `'trait'`, `'abstract_class'`, `'function'`).
2. A custom string such as `'lock_domain'` is assignable to `EntityType` (compile-time assertion via `satisfies` or a typed variable assignment).
3. A `KnownEntityType` variable is assignable to `EntityType` (narrowing is preserved).
4. An `Entity` object with `type: 'lock_domain'` satisfies the `Entity` interface (runtime shape check).
5. After the type change, code that previously needed `as any` compiles cleanly — verified by asserting `'package'` is a valid `EntityType` string at runtime.

### Stage 1.2 — Implement

Files modified and change summary:

**`src/types/index.ts`** (~10 lines changed):
- Rename current `EntityType` to `KnownEntityType`.
- Add `export type EntityType = KnownEntityType | string;`.
- Keep `Entity.type: EntityType` unchanged.

**`src/parser/archjson-aggregator.ts`** (~2 lines changed):
- Line 92: remove `as any` from `type: 'package' as any` — the assignment is now valid because `'package'` satisfies `string` and therefore `EntityType`.

**`src/mermaid/grouper.ts`** (~2 lines changed):
- Line 126: remove `as string` from `(entity.type as string) === 'package'` — `entity.type` is already `string` after the widening.

**`src/plugins/cpp/archjson-mapper.ts`** (~1 line changed):
- Line 23: change `cls.kind as EntityType` to `cls.kind as KnownEntityType`. The values assigned here (`'class_specifier'`, `'struct_specifier'`, etc.) are tree-sitter node kinds that the mapper normalises; the cast keeps the same runtime behaviour but is now properly typed as a known-type coercion rather than an open-type one.

**`src/mermaid/generator.ts`** (~2 lines changed):
- Update the `entityTypeToClassDef` parameter type from `EntityType` to `string` (because `EntityType` is now `KnownEntityType | string`, which reduces to `string`; the parameter can accept any entity type).
- No logic change; the function body is unchanged in this phase.

### Stage 1.3 — Self-validation

```bash
npm test                               # all tests pass (target: 2787+)
npm run type-check                     # zero errors — this is the primary gate for Phase 1
npm run build

# Confirm the three casts are gone (must return no matches)
grep -rn "as any" src/parser/archjson-aggregator.ts
grep -rn "as string" src/mermaid/grouper.ts
grep -rn "cls.kind as EntityType" src/plugins/cpp/archjson-mapper.ts

node dist/cli/index.js analyze -v      # ArchGuard self-analysis completes without error
```

Expected: `type-check` passes with zero errors; the three `grep` commands return no output (casts removed); `analyze -v` produces `.archguard/` output identical to the pre-change run.

---

## Phase 2 — `Entity.attributes` field and `EntityTypeRegistry`

**Goal**: Add `Entity.attributes?: Record<string, string | number | boolean>` to the `Entity` interface. Create `src/core/entity-type-registry.ts` with `EntityTypeRegistry` and `globalEntityTypeRegistry`. Add `CustomEntityTypeDeclaration` and `customEntityTypes?` to `PluginMetadata`. Extend `QueryEngine` with `findByAttr()` and `findByTypeAndAttr()`.

**Dependencies**: Phase 1 must be complete (uses `KnownEntityType`).

**Test files**:
- `tests/unit/core/entity-type-registry.test.ts` (new)
- `tests/unit/cli/query/query-engine.test.ts` (extend existing)

### Stage 2.1 — Write tests first

**File: `tests/unit/core/entity-type-registry.test.ts`** (new, ~80 lines)

Test cases:
1. `register()` stores a `CustomEntityTypeDeclaration`; `get()` retrieves it by type string.
2. `get()` returns `undefined` for an unregistered type.
3. `listCustomTypes()` returns all registered type strings.
4. `listCustomTypes()` returns `[]` when nothing is registered.
5. `clear()` method removes all entries; subsequent `get()` returns `undefined`.
6. Registering the same type twice: second `register()` overwrites the first (`get()` returns the latest).
7. `globalEntityTypeRegistry` is a singleton: same reference from two imports.

**File: `tests/unit/cli/query/query-engine.test.ts`** (extend existing, ~40 new lines in new describe block `findByAttr / findByTypeAndAttr`)

Test cases for `findByAttr`:
8. Returns entities that have the given attribute key (presence check, `value` omitted).
9. Returns entities whose attribute key equals the given string value.
10. Returns entities whose attribute key equals the given boolean value.
11. Returns entities whose attribute key equals the given number value.
12. Returns `[]` when no entities have attributes.
13. Returns `[]` when entities have attributes but not the queried key.
14. Returns `[]` when the key matches but the value does not.

Test cases for `findByTypeAndAttr`:
15. With only `entityType` (no `attrKey`): equivalent to `findByType()`.
16. With `entityType` + `attrKey` presence check: returns subset of type-matched entities that have the attribute.
17. With `entityType` + `attrKey` + `attrValue`: narrows further to matching value.
18. Returns `[]` when no entity has both the right type and the right attribute.

### Stage 2.2 — Implement

**`src/types/index.ts`** (~3 lines added):
- Add `attributes?: Record<string, string | number | boolean>` to the `Entity` interface after the `implements?` field.

**`src/core/interfaces/language-plugin.ts`** (~14 lines added):
- Add `CustomEntityTypeDeclaration` interface before `PluginCapabilities`:
  ```typescript
  export interface CustomEntityTypeDeclaration {
    type: string;
    display: string;
    mermaidShape?: 'class' | 'component' | 'service' | 'default';
    attributes?: string[];
  }
  ```
- Add `customEntityTypes?: CustomEntityTypeDeclaration[]` to `PluginMetadata` after `capabilities`.

**`src/core/entity-type-registry.ts`** (new file, ~33 lines):
- `EntityTypeRegistry` class with `register()`, `get()`, `listCustomTypes()`, and `clear()` methods backed by a `Map<string, CustomEntityTypeDeclaration>`.
- `clear()` must be implemented here in Stage 2.2 (not deferred to Phase 4) because Stage 2.1 test case 5 already tests it.
- Export `globalEntityTypeRegistry = new EntityTypeRegistry()` module-level singleton.

**`src/cli/query/query-engine.ts`** (~25 lines added):
- Add `findByAttr(key: string, value?: string | number | boolean): Entity[]` method after `findByType()`.
- Add `findByTypeAndAttr(entityType: string, attrKey?: string, attrValue?: string | number | boolean): Entity[]` method after `findByAttr()`.
- No changes to existing methods.

### Stage 2.3 — Self-validation

```bash
npm test                               # all tests pass (target: 2787 + ~25 new)
npm run type-check
npm run build
node dist/cli/index.js analyze -v      # ArchGuard self-analysis unchanged
```

---

## Phase 3 — CLI `--attr` flag and routing

**Goal**: Add `attr?: string[]` to `QueryOptions`, add `--attr <keyOrPair...>` option to `createQueryCommand()`, update `validateQueryOptions()` so `--attr` is a modifier (not a primary option), and update `queryHandler()` to route through `findByAttr()` / `findByTypeAndAttr()` as appropriate.

**Dependencies**: Phase 2 must be complete (`findByAttr`, `findByTypeAndAttr` exist on `QueryEngine`).

**Test files**:
- `tests/unit/cli/commands/query-attr.test.ts` (new)

### Stage 3.1 — Write tests first

File: `tests/unit/cli/commands/query-attr.test.ts` (new, ~120 lines)

Test cases for `parseAttrOption` (pure helper extracted from handler):
1. `'irq_safe=true'` → `{ key: 'irq_safe', value: true }` (boolean coercion).
2. `'irq_safe=false'` → `{ key: 'irq_safe', value: false }`.
3. `'priority=3'` → `{ key: 'priority', value: 3 }` (numeric coercion).
4. `'label=my-service'` → `{ key: 'label', value: 'my-service' }` (string passthrough).
5. `'execution_context'` (no `=`) → `{ key: 'execution_context', value: undefined }` (presence check).
6. `'key=val=extra'` → `{ key: 'key', value: 'val=extra' }` (only first `=` is the separator).

Test cases for `validateQueryOptions` (via unit test of the **exported** function — Stage 3.2 must export it from `query.ts`):
7. `--attr` alone (no primary option) throws with a message containing `'primary query option'`.
8. `--type lock_domain --attr irq_safe` is valid (no throw).
9. `--type lock_domain --attr irq_safe=true` is valid.
10. `--type lock_domain --attr irq_safe --attr priority=3` (multiple attrs) is valid.
11. Two primary options still throws even when `--attr` is also present.

Test cases for `queryHandler` routing (mocked `QueryEngine`):
12. `--type lock_domain` (no `--attr`) calls `findByType('lock_domain')`, not `findByTypeAndAttr`.
13. `--type lock_domain --attr irq_safe=true` calls `findByTypeAndAttr('lock_domain', 'irq_safe', true)`.
14. `--attr execution_context` (standalone) calls `findByAttr('execution_context', undefined)`.
15. `--attr priority=3` (standalone numeric) calls `findByAttr('priority', 3)`.
16. Multiple `--attr` flags: AND semantics — result is the sequential intersection: start from `findByTypeAndAttr(type, firstAttrKey, firstAttrValue)`, then for each additional attr reduce via `.filter()` using `findByAttr`-equivalent logic on the already-filtered set. (This must be implemented in Stage 3.2 because this test case covers it.)

### Stage 3.2 — Implement

**`src/cli/commands/query.ts`** (~50 lines changed/added):

- Add `attr?: string[]` to `QueryOptions` interface.
- In `createQueryCommand()`, add:
  ```typescript
  .option('--attr <keyOrPair...>', 'Filter by attribute key or key=value pair (repeatable, AND-composed)')
  ```
- Extract `parseAttrOption(raw: string): { key: string; value: string | number | boolean | undefined }` as a module-level pure function (exported for testing).
- In `validateQueryOptions()`: `opts.attr` must NOT be added to `primaryOptions`. Instead, add a guard after the primary-count check:
  ```typescript
  if (opts.attr?.length && primaryOptions.length === 0) {
    throw new Error('--attr requires a primary query option (e.g. --type). To filter by attribute alone, use --type with a custom type name.');
  }
  ```
- In `queryHandler()`:
  - Replace the `else if (opts.type)` branch with `else if (opts.type || opts.attr?.length)`.
  - Parse the first `--attr` value (AND loop for multiple attrs deferred to future; comment explains).
  - Parse **all** `opts.attr` entries (not just the first) using `parseAttrOption`.
  - Seed the result set: if `opts.type` is set, start with `findByTypeAndAttr(opts.type, firstAttrKey, firstAttrValue)`; else start with `findByAttr(firstAttrKey, firstAttrValue)`.
  - For each remaining attr (index ≥ 1), reduce the result set by filtering entities where `e.attributes?.[key] === value` (or `key in e.attributes` for presence checks). This implements AND semantics consistently with test case 16.
  - Use helper `buildAttrQueryLabel(type, key, value): string` for the text-format title.

> Note: `validateQueryOptions` must be exported from `query.ts` so it can be unit-tested directly (test cases 7-11 in Stage 3.1 depend on this).

### Stage 3.3 — MCP parity (ADR-007)

ADR-007 requires every CLI capability to have a corresponding MCP entry point. Attribute
filtering is primarily useful to Claude Code, so MCP parity is not optional.

**File: `tests/unit/cli/mcp/mcp-server-find-entity.test.ts`** (new, ~50 lines) — write
tests first:

1. `archguard_find_entity({ name: 'Foo' })` still calls `findEntity('Foo')` (existing path unchanged).
2. `archguard_find_entity({ entityType: 'lock_domain' })` calls `findByType('lock_domain')` (no attr).
3. `archguard_find_entity({ entityType: 'lock_domain', attrFilter: { irq_safe: true } })` calls `findByTypeAndAttr('lock_domain', 'irq_safe', true)`.
4. `archguard_find_entity({ attrFilter: { execution_context: 'irq' } })` (no entityType) calls `findByAttr('execution_context', 'irq')`.
5. `attrFilter` with two keys applies AND: result is intersection of both attr filters.
6. Empty `attrFilter: {}` with `entityType` set behaves as plain `findByType`.
7. Neither `name` nor `entityType` nor `attrFilter` provided → tool returns error response (no crash).

Then implement in **`src/cli/mcp/mcp-server.ts`** (~30 lines changed):

- Update `archguard_find_entity` input schema (`inputSchema.properties`) to add:
  ```
  entityType: { type: 'string', description: 'Filter by entity type (e.g. lock_domain)' }
  attrFilter:  { type: 'object', description: 'Attribute key-value pairs (AND-composed)' }
  ```
- Make `name` optional in the schema (add it to `required: []` or remove from `required`).
- Update the handler to:
  1. If `name` is provided → `engine.findEntity(name)` (existing, unchanged).
  2. Else if `entityType` or `attrFilter` → route through `findByTypeAndAttr` / `findByAttr`
     with AND reduction for multiple `attrFilter` entries (same logic as Stage 3.2 CLI handler).
  3. Else → return empty result with a descriptive message.
- Update tool description string to document the three calling modes.

### Stage 3.4 — Self-validation

```bash
npm test                               # all tests pass (target: 2787 + ~95 new across Phase 3)
npm run type-check
npm run build

# Self-analysis
node dist/cli/index.js analyze -v

# Spot-check query with --type (existing behaviour unchanged)
node dist/cli/index.js query --type class --format json | head -5

# Verify --attr validation error
node dist/cli/index.js query --attr some_key 2>&1 | grep -i "primary"
```

Expected: `--attr` alone prints the validation error message; `--type class` still works; MCP tool tests pass.

---

## Phase 4 — Mermaid renderer fallback + `EntityTypeRegistry` integration

**Goal**: Update `entityTypeToClassDef` in `generator.ts` to accept `EntityTypeRegistry` and fall back to `'classNode'` for unknown types. Guard the `classDef` emission loops so only known or registry-registered styles are emitted. Wire `globalEntityTypeRegistry` into `ValidatedMermaidGenerator`. Add `customEntityTypes` registration after each `plugin.initialize()` call in `src/cli/processors/arch-json-provider.ts` (6 sites) and `src/cli/analyze/run-analysis.ts` (2 sites) to populate the registry before any diagram generation begins.

**Dependencies**: Phases 1 and 2 must be complete. Phase 1 provides `KnownEntityType` (needed so `entityTypeToClassDef` can distinguish known types from custom ones). Phase 2 provides `EntityTypeRegistry`, `CustomEntityTypeDeclaration`, and `globalEntityTypeRegistry`.

**Test files**:
- `tests/unit/mermaid/generator-unknown-type.test.ts` (new)
- `tests/unit/core/entity-type-registry.test.ts` (extend: add Mermaid shape mapping tests)

### Stage 4.1 — Write tests first

**File: `tests/unit/mermaid/generator-unknown-type.test.ts`** (new, ~80 lines)

Test cases for the updated `entityTypeToClassDef` function (tested via module import or white-box via the generator's output):
1. `entityTypeToClassDef('class', emptyRegistry)` → `'classNode'`.
2. `entityTypeToClassDef('interface', emptyRegistry)` → `'interface'`.
3. `entityTypeToClassDef('enum', emptyRegistry)` → `'enum'`.
4. `entityTypeToClassDef('struct', emptyRegistry)` → `'struct'`.
5. `entityTypeToClassDef('abstract_class', emptyRegistry)` → `'abstract_class'`.
6. `entityTypeToClassDef('function', emptyRegistry)` → `'function'`.
7. `entityTypeToClassDef('lock_domain', emptyRegistry)` → `'classNode'` (unknown → plain box fallback).
8. `entityTypeToClassDef('entry_point', emptyRegistry)` → `'classNode'` (unknown → plain box fallback).
9. Registry has `{ type: 'lock_domain', mermaidShape: 'component' }` → maps to `'interface'` classDef key.
10. Registry has `{ type: 'lock_domain', mermaidShape: 'default' }` → falls back to `'classNode'`.
11. Registry has `{ type: 'lock_domain', mermaidShape: undefined }` → falls back to `'classNode'`.

Test cases for classDef emission (via full diagram generation with a synthetic ArchJSON containing a custom type):
12. Diagram containing only known-type entities includes all seven `classDef` lines.
13. Diagram containing an entity with `type: 'lock_domain'` (unregistered): generated Mermaid string does NOT contain `classDef lock_domain`; the entity still receives `:::classNode`.
14. Diagram containing an entity with `type: 'lock_domain'` where the registry has `mermaidShape: 'component'`: entity receives `:::interface`; no `classDef lock_domain` line.
15. Mermaid output for cases 13 and 14 passes `ValidatedMermaidGenerator`'s structural validator (no unknown classDef reference).

**Extend `tests/unit/core/entity-type-registry.test.ts`** (~10 additional lines):
16. `globalEntityTypeRegistry.clear()` can be called in `afterEach` without side effects on other test files (registry starts empty in isolation).

### Stage 4.2 — Implement

**`src/mermaid/generator.ts`** (~25 lines changed):

- Update `entityTypeToClassDef` signature:
  ```typescript
  function entityTypeToClassDef(type: string, registry: EntityTypeRegistry): string {
    if (type === 'class') return 'classNode';
    if (type in ENTITY_CLASSDEF_STYLES) return type;
    const custom = registry.get(type);
    if (custom?.mermaidShape && custom.mermaidShape !== 'default') {
      return custom.mermaidShape === 'component' ? 'interface' : 'classNode';
    }
    return 'classNode'; // unknown type: plain box, never throws
  }
  ```
- Add import of `globalEntityTypeRegistry` from `'@/core/entity-type-registry.js'`.
- In `ValidatedMermaidGenerator` constructor (or class body), capture `registry = globalEntityTypeRegistry` as a private field.
- At the three `entityTypeToClassDef(entity.type)` call sites (lines 370, 441, 929), pass `this.registry` as the second argument.
- In the three `classDef` emission loops (lines 290, 383, 890): no change needed — `ENTITY_CLASSDEF_STYLES` already only contains known styles; the updated function maps unknown types to existing known keys, so no undeclared `classDef` names are ever emitted.

**`src/cli/processors/arch-json-provider.ts`** (~10 lines added, 6 call sites):
- `src/core/plugin-registry.ts` does **not** call `initialize()` — the actual call sites are in `src/cli/processors/arch-json-provider.ts` (lines 506, 531, 556, 576, 592, 608) and `src/cli/analyze/run-analysis.ts` (lines 51, 56). After each `await plugin.initialize(...)` call, add:
  ```typescript
  if (plugin.metadata.customEntityTypes) {
    for (const decl of plugin.metadata.customEntityTypes) {
      globalEntityTypeRegistry.register(decl);
    }
  }
  ```
- The wiring must be added at **all** `initialize()` call sites in `arch-json-provider.ts` and `run-analysis.ts` to avoid any code path that parses before the registry is populated.

### Stage 4.3 — Self-validation

```bash
npm test                               # all tests pass (target: 2787 + ~70 new across all phases)
npm run type-check
npm run lint
npm run build

# Full self-analysis with verbose output — confirms no Mermaid parse errors
node dist/cli/index.js analyze -v

# Verify diagrams contain valid classDef blocks (spot-check)
grep -r "classDef" .archguard/ | head -5
```

Expected: no `classDef` lines reference undeclared style names; `analyze -v` completes successfully; all test counts increase by the expected amounts.

---

## Dependency Graph

```
Phase 1 (type widening + cast removal)
    └── Phase 2 (Entity.attributes + Registry + QueryEngine methods)
            └── Phase 3 (CLI --attr flag)
            └── Phase 4 (Mermaid fallback + registry wiring)
                    (Phase 3 and 4 are independent of each other; both depend on Phase 2)
```

Phases 3 and 4 can be developed in parallel once Phase 2 is complete.

---

## File Change Summary

| File | Phase | Type | Estimated lines |
|------|-------|------|-----------------|
| `src/types/index.ts` | 1, 2 | modify | ~13 |
| `src/parser/archjson-aggregator.ts` | 1 | modify | ~2 |
| `src/mermaid/grouper.ts` | 1 | modify | ~2 |
| `src/plugins/cpp/archjson-mapper.ts` | 1 | modify | ~1 |
| `src/mermaid/generator.ts` | 1, 4 | modify | ~27 |
| `src/core/interfaces/language-plugin.ts` | 2 | modify | ~14 |
| `src/core/entity-type-registry.ts` | 2 | new | ~33 |
| `src/cli/query/query-engine.ts` | 2 | modify | ~25 |
| `src/cli/commands/query.ts` | 3 | modify | ~50 |
| `src/cli/mcp/mcp-server.ts` | 3 | modify | ~30 |
| `src/cli/processors/arch-json-provider.ts` | 4 | modify | ~8 |
| `src/cli/analyze/run-analysis.ts` | 4 | modify | ~4 |
| **Tests** | | | |
| `tests/unit/types/entity-type.test.ts` | 1 | new | ~40 |
| `tests/unit/core/entity-type-registry.test.ts` | 2, 4 | new | ~90 |
| `tests/unit/cli/query/query-engine.test.ts` | 2 | extend | ~40 |
| `tests/unit/cli/commands/query-attr.test.ts` | 3 | new | ~120 |
| `tests/unit/cli/mcp/mcp-server-find-entity.test.ts` | 3 | new | ~50 |
| `tests/unit/mermaid/generator-unknown-type.test.ts` | 4 | new | ~80 |

**Total production code delta**: ~209 lines.
**Total test code delta**: ~420 lines.
**Grand total**: ~629 lines (well within 4 × 500 budget; each phase ≤ 200 production lines and ≤ 300 test lines).

---

## Known Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `switch (entity.type)` statements may have relied on exhaustiveness checking from the closed union | Pre-audit complete: only `switch` statements over `.type` in `src/` are on `relation.type` (generator.ts:581, generator-formatting.ts:152) and a tree-sitter node type (kotlin/builders/function-builder.ts:276) — none switch on `entity.type`. Risk is low; no default branches required. |
| `findByType('abstract_class')` special-case in `query-engine.ts:200-203` | No change to `findByType()` preserves this branch; covered by existing tests |
| `globalEntityTypeRegistry` singleton state bleeds between tests | `clear()` method implemented in Phase 2 Stage 2.2 (not deferred); all new test files call it in `afterEach` |
| Plugin registry wiring order: registry must be populated before any diagram generation | Wiring is in plugin `initialize()` path, which runs before parsing; verified by Phase 4 self-validation |
| Multiple `--attr` AND semantics: filter loop may return 0 entities unexpectedly | Documented as AND; no UX surprise for the primary single-attr case; multi-attr returns empty silently (consistent with `--type` behaviour) |
