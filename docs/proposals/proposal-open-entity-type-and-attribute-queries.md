## Context in the Proposal Series

This is the first of three proposals addressing ArchGuard's extensibility:

| Step | Proposal | Side | Claude Code impact |
|------|----------|------|--------------------|
| **1+2** | **This document** | **Consumer** | **Claude Code can now query custom entity types and domain attributes via `archguard_find_entity`** |
| 3 | `proposal-tree-sitter-query-externalization.md` | Producer | Transparent — lowers cost of adding new languages; no change to query interface |
| 4 | `proposal-declarative-entity-schema.md` | Producer | Transparent — makes entity mapping declarative; no change to query interface |

The ordering is intentional: **extend the consumer interface first, then lower the
producer cost**. Steps 3 and 4 make it cheaper to emit custom entity types and
attributes; Step 1+2 makes those types and attributes queryable. Delivering Step 1+2
first means Claude Code gets the query capability regardless of whether Steps 3 and 4
are ever implemented — plugins can emit `Entity.attributes` in TypeScript today.

## Problem Statement

`EntityType` in `src/types/index.ts:99` is a closed union:

```typescript
export type EntityType =
  | 'class' | 'interface' | 'enum' | 'struct'
  | 'trait' | 'abstract_class' | 'function';
```

Adding a domain-specific concept — `lock_domain` for Linux kernel analysis,
`entry_point` for embedded firmware, `goroutine_pool` for Go services — requires
modifying this type definition, updating the Mermaid renderer, and shipping a new
ArchGuard release. There is no extension point; every new concept is a hard fork of
the core type system.

The situation is already leaking: `src/parser/archjson-aggregator.ts:92` currently
emits entities with `type: 'package' as any` because `'package'` is not in
`EntityType`, and `src/mermaid/grouper.ts:125-126` works around this with an explicit
`(entity.type as string) === 'package'` cast. These are symptoms of the closed-union
problem that this proposal addresses.

The `archguard query --type <entityType>` command exists and works for the seven known
types. `findByType()` already accepts `string` (not `EntityType`) at runtime, so
`--type lock_domain` would return results if a plugin emitted such entities — but two
gaps remain:

1. The `Entity` interface has no field for domain-specific metadata, so there is
   nothing to query beyond type name.
2. There is no way to filter by entity attributes (e.g., "irq-safe=true", "instability
   > 0.8"). The only predicates available are structural (type, coupling, orphan, cycle).

Plugins also have no mechanism to advertise which custom entity types they emit, so
consumers — Claude Code, downstream tools — cannot discover what types are queryable.

## Goals

- Open `EntityType` to `KnownEntityType | string` so plugins can emit arbitrary entity
  types without changing core types. Eliminate the `as any` and `as string` casts
  that currently work around the closed union.
- Add `Entity.attributes?: Record<string, string | number | boolean>` as a first-class
  optional field for language- or domain-specific metadata.
- Let plugins declare the custom entity types and attribute keys they produce in
  `PluginMetadata`.
- Extend `archguard query` with `--attr <key>=<value>` and `--attr <key>` (presence
  check) so Claude Code and humans can ask attribute-level questions.
- Ensure the Mermaid renderer degrades gracefully when it encounters an unknown entity
  type instead of emitting an unregistered classDef style.

## Non-Goals

- A full expression query language (SQL-like predicates with `AND/OR/NOT`). Attribute
  filtering is additive to the existing structural flags, not a replacement.
- Changing the ArchJSON schema version or breaking existing serialized `.json` files.
- Any changes to the tree-sitter layer or how entities are extracted.
- Making `'package'` a first-class `KnownEntityType` — it is a diagram-level concept,
  not a source-entity concept. The aggregator's synthetic package entities are an
  internal detail; they should stay `as any` or be typed via a separate internal
  interface, not promoted into the public `KnownEntityType` union.
- A full expression query language (SQL-like predicates with `AND/OR/NOT` across
  multiple attribute conditions). Composing `--type` + one or more `--attr` flags
  covers the primary use cases without a parser.

## Design

### 1. Open `EntityType`

```typescript
// src/types/index.ts
export type KnownEntityType =
  | 'class' | 'interface' | 'enum' | 'struct'
  | 'trait' | 'abstract_class' | 'function';

export type EntityType = KnownEntityType | string;
```

`Entity.type` remains typed as `EntityType`. All existing code that reads `entity.type`
continues to work. Code that **emits** or **compares against** known entity types should
import and use `KnownEntityType` constants where exhaustive coverage matters (e.g., the
Mermaid renderer's classDef lookup).

**Impact on existing casts**: The `as any` in `archjson-aggregator.ts:92` and the
`as string` in `grouper.ts:126` can both be removed once `EntityType` becomes
`KnownEntityType | string`, because `'package'` is already a valid `string`.

**Impact on plugin `archjson-mapper.ts` files**: `cpp/archjson-mapper.ts:23` uses
`cls.kind as EntityType` to cast tree-sitter node kinds (e.g. `'struct_specifier'`,
`'class_specifier'`) into `EntityType`. After this change, that cast becomes
`cls.kind as KnownEntityType` where the value is one of the seven known strings, or
simply `cls.kind` when custom kinds are intended.

### 2. `Entity.attributes` field

```typescript
// src/types/index.ts — Entity interface
export interface Entity {
  // ... existing fields ...
  attributes?: Record<string, string | number | boolean>;
}
```

Plugins set this field when they have domain-specific metadata to attach. Examples:

```typescript
// Linux kernel C plugin (hypothetical)
entity.attributes = {
  execution_context: 'irq',    // string
  irq_safe: true,              // boolean
  lock_type: 'spinlock_irq',   // string
};

// Go Atlas (existing)
// Currently stored in ArchJSONExtensions.goAtlas — should remain there;
// attributes is for per-entity data, not layer-level graph data.
```

The `attributes` field is JSON-serializable and round-trips through ArchJSON without
any change to the schema version. Consumers that do not understand a key ignore it.

**`EntitySummary` impact**: `query-engine.ts` exports `EntitySummary` (used by
`toSummary()` and by the `--format text` output path). Attributes are not included in
`EntitySummary` by default because they are unbounded and would bloat text output.
They appear in full `Entity` objects returned via `--verbose`. If attribute-aware
summarisation is needed later, it can be added as a separate field to `EntitySummary`.

### 3. Plugin metadata declaration

```typescript
// src/core/interfaces/language-plugin.ts

export interface CustomEntityTypeDeclaration {
  type: string;                // e.g., 'lock_domain'
  display: string;             // Human-readable label
  mermaidShape?: 'class' | 'component' | 'service' | 'default';
  attributes?: string[];       // Known attribute keys this type may carry
}

export interface PluginMetadata {
  // ... existing fields ...
  customEntityTypes?: CustomEntityTypeDeclaration[];
}
```

At startup the CLI reads `plugin.metadata.customEntityTypes` and registers them in a
new `EntityTypeRegistry` (a lightweight in-memory map, see §6). The registry is used by:

- The Mermaid renderer to look up `mermaidShape` for unknown types.
- The `--type` validator to list queryable types in `--help` output.

**Existing plugins** (typescript, go, java, python, cpp, kotlin) do not emit custom
types; they leave `customEntityTypes` undefined. No changes are required to any
existing plugin's `metadata` object.

### 4. `QueryEngine` attribute query

```typescript
// src/cli/query/query-engine.ts

/** Find entities that have a given attribute key/value pair. */
findByAttr(key: string, value?: string | number | boolean): Entity[] {
  return this.archJson.entities.filter((e) => {
    if (!e.attributes) return false;
    if (value === undefined) return key in e.attributes;
    return e.attributes[key] === value;
  });
}

/** Combined filter: type AND optional attribute predicate. */
findByTypeAndAttr(
  entityType: string,
  attrKey?: string,
  attrValue?: string | number | boolean
): Entity[] {
  return this.findByType(entityType).filter((e) => {
    if (!attrKey) return true;
    if (!e.attributes) return false;
    if (attrValue === undefined) return attrKey in e.attributes;
    return e.attributes[attrKey] === attrValue;
  });
}
```

**`findByType()` already accepts `string`** — the existing signature is
`findByType(entityType: string): Entity[]` — so no signature change is needed there.
The type-widening in §1 removes the conceptual mismatch but requires no method edit.

**Multiple `--attr` flags** compose as AND (see Open Questions §1).

### 5. CLI flags

Two new options added to `src/cli/commands/query.ts`:

```
--attr <key>=<value>   Filter entities by attribute key-value pair
--attr <key>           Filter entities where attribute key is present (any value)
```

These compose with `--type`. The `QueryOptions` interface gains:

```typescript
interface QueryOptions {
  // ... existing fields ...
  attr?: string[];  // commander collects multiple --attr flags into an array
}
```

In `createQueryCommand()`:
```typescript
.option('--attr <keyOrPair...>', 'Filter by attribute key or key=value')
```

In `validateQueryOptions()`, `opts.attr` must **not** be added to `primaryOptions`
because `--attr` is a modifier/filter, not a primary query mode. It composes with
`--type` (and potentially other primary options). Passing `--attr` alone without a
primary query option should be an error with a helpful message.

Usage examples:

```bash
# All lock_domain entities (custom type)
archguard query --type lock_domain

# lock_domain entities that are irq-safe
archguard query --type lock_domain --attr irq_safe=true

# Any entity with execution_context attribute
archguard query --attr execution_context

# Custom type + attribute + JSON output for Claude Code
archguard query --type entry_point --attr entry_type=kthread --format json
```

The `--attr` flag parsing: split on first `=`; if no `=`, treat as presence check;
coerce `true`/`false` strings to boolean, numeric strings to number.

In the `queryHandler`, the `--type` branch calls `findByTypeAndAttr` when `--attr` is
present; a standalone `--attr` (no `--type`) calls `findByAttr`. The existing
`else if (opts.type)` block becomes:

```typescript
} else if (opts.type || opts.attr?.length) {
  // resolve attr key/value from opts.attr[0] (first --attr for now; AND logic TBD)
  const entities = opts.type
    ? engine.findByTypeAndAttr(opts.type, attrKey, attrValue)
    : engine.findByAttr(attrKey, attrValue);
  result = projectEntitiesForOutput(engine, entities, opts.verbose);
  if (!isJson) formatEntityList(entities, buildAttrQueryLabel(opts.type, attrKey, attrValue));
}
```

### 6. `EntityTypeRegistry` (new file)

```typescript
// src/core/entity-type-registry.ts

import type { CustomEntityTypeDeclaration } from './interfaces/language-plugin.js';

export class EntityTypeRegistry {
  private readonly entries = new Map<string, CustomEntityTypeDeclaration>();

  register(decl: CustomEntityTypeDeclaration): void {
    this.entries.set(decl.type, decl);
  }

  get(type: string): CustomEntityTypeDeclaration | undefined {
    return this.entries.get(type);
  }

  listCustomTypes(): string[] {
    return Array.from(this.entries.keys());
  }
}

export const globalEntityTypeRegistry = new EntityTypeRegistry();
```

The registry is populated once during plugin initialisation (before any analysis or
query), then read-only during the rest of the run. It is a module-level singleton
rather than a constructor argument, which avoids threading it through every call site.
Callers that need it import `globalEntityTypeRegistry` directly.

### 7. Mermaid renderer fallback

In `src/mermaid/generator.ts`, the current design uses:

```typescript
const ENTITY_CLASSDEF_STYLES: Record<string, string> = {
  classNode: '...', interface: '...', enum: '...', struct: '...', ...
};

function entityTypeToClassDef(type: EntityType): string {
  return type === 'class' ? 'classNode' : type;
}
```

This is called at three sites (lines 370, 441, 929) and the `classDef` declarations
are emitted by iterating `ENTITY_CLASSDEF_STYLES` entries (lines 290, 383, 890).

The problem: if `type` is an unknown custom value (e.g. `'lock_domain'`), calling
`entityTypeToClassDef('lock_domain')` returns `'lock_domain'`, a `classDef` style
`lock_domain` is **never declared**, and Mermaid's parser will reject the diagram.

The fix has two parts:

**Part A — guard the classDef emission**: only emit `class Foo:::styleName` if
`styleName` is in the known set or registered in `EntityTypeRegistry`.

**Part B — unknown type fallback**: if an entity's type is not in the known set and
not in the registry, assign it the `classNode` style (plain box) so the diagram
renders without error.

```typescript
// Updated entityTypeToClassDef
function entityTypeToClassDef(
  type: string,
  registry: EntityTypeRegistry
): string {
  if (type === 'class') return 'classNode';
  if (type in ENTITY_CLASSDEF_STYLES) return type;
  const custom = registry.get(type);
  if (custom?.mermaidShape && custom.mermaidShape !== 'default') {
    // Map plugin-declared shape to a known classDef key
    return custom.mermaidShape === 'component' ? 'interface' : 'classNode';
  }
  return 'classNode';  // fallback: plain box, never throws
}
```

`ValidatedMermaidGenerator` receives the `globalEntityTypeRegistry` at construction
time (or imports it directly), giving it access without changing the public API of
`generate()`.

### 8. MCP tool extension (`archguard_find_entity`)

ADR-007 requires CLI/MCP interface parity: every new query capability added to the
CLI must have a corresponding MCP entry point calling the same `QueryEngine` method.
Attribute filtering is primarily useful to Claude Code — the AI agent asking "find all
`lock_domain` entities where `irq_safe=true`" — so MCP parity is not optional here.

**Current state**: `archguard_find_entity` in `src/cli/mcp/mcp-server.ts:161` accepts
only a `name` parameter (exact-match entity lookup). It has no `entityType` or
attribute filter.

**Change**: extend the tool's input schema with two optional parameters:

```typescript
// New input schema for archguard_find_entity
{
  name?: string,          // existing: exact name match (now optional)
  entityType?: string,    // new: filter by entity type (e.g. 'lock_domain')
  attrFilter?: Record<string, string | number | boolean>  // new: attribute key-value filter (AND-composed)
}
```

Routing logic in the tool handler:

```typescript
// src/cli/mcp/mcp-server.ts — archguard_find_entity handler
if (name) {
  // existing path: exact name lookup, unchanged
  return engine.findEntity(name);
} else if (entityType || attrFilter) {
  // new path: type + attribute filter
  const attrEntries = attrFilter ? Object.entries(attrFilter) : [];
  const [firstKey, firstVal] = attrEntries[0] ?? [undefined, undefined];
  let results = entityType
    ? engine.findByTypeAndAttr(entityType, firstKey, firstVal)
    : engine.findByAttr(firstKey!, firstVal);
  for (const [k, v] of attrEntries.slice(1)) {
    results = results.filter((e) => e.attributes?.[k] === v);
  }
  return results;
}
```

The handler calls `findByTypeAndAttr()` / `findByAttr()` — the same `QueryEngine`
methods as the CLI `--attr` path. No duplicate logic.

**Tool description update**: change from `"Find entity by exact name"` to
`"Find entities by name, type, or attribute filter. Provide 'name' for exact match,
'entityType' to filter by type, or 'attrFilter' to filter by attribute key-value pairs.
Multiple attrFilter entries are AND-composed."`.

This is the canonical path for Claude Code to query custom entity types and their
domain attributes without needing to read the entire ArchJSON dump.

## Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Introduce `KnownEntityType`; redefine `EntityType = KnownEntityType \| string`; add `attributes?` to `Entity` |
| `src/core/interfaces/language-plugin.ts` | Add `CustomEntityTypeDeclaration` interface; add `customEntityTypes?` to `PluginMetadata` |
| `src/core/entity-type-registry.ts` | **New file**: `EntityTypeRegistry` class + `globalEntityTypeRegistry` singleton |
| `src/cli/query/query-engine.ts` | Add `findByAttr()` and `findByTypeAndAttr()`; no change to existing `findByType()` signature |
| `src/cli/commands/query.ts` | Add `attr?: string[]` to `QueryOptions`; add `--attr` flag; update `queryHandler` and `validateQueryOptions` |
| `src/mermaid/generator.ts` | Update `entityTypeToClassDef` to accept `string` + registry; guard classDef emission for unknown types |
| `src/cli/processors/arch-json-provider.ts` | Wire `customEntityTypes` registration after each `plugin.initialize()` call (6 sites) |
| `src/cli/analyze/run-analysis.ts` | Wire `customEntityTypes` registration after each `plugin.initialize()` call (2 sites) |
| `src/parser/archjson-aggregator.ts` | Remove `as any` from `type: 'package' as any` — no longer needed once `EntityType` is open |
| `src/mermaid/grouper.ts` | Remove `as string` cast in `(entity.type as string) === 'package'` |
| `src/plugins/cpp/archjson-mapper.ts` | Change `cls.kind as EntityType` to `cls.kind as KnownEntityType` (or remove cast if emitting custom kinds intentionally) |
| `src/cli/mcp/mcp-server.ts` | Extend `archguard_find_entity` input schema with `entityType?` and `attrFilter?`; update handler to route through `findByTypeAndAttr()` / `findByAttr()` |

**Not affected** (no changes required):
- `src/plugins/typescript/`, `src/plugins/golang/`, `src/plugins/java/`, `src/plugins/python/`, `src/plugins/kotlin/` — their `metadata` objects need no `customEntityTypes` field; existing type assignments (`'class'`, `'struct'`, etc.) remain valid.
- `src/analysis/test-coverage-renderer.ts` — already uses a narrow check (`entity.type === 'class' || entity.type === 'interface'`); this continues to work.
- `src/mermaid/validator-structural.ts` — reads `entity.type` as a string passthrough; no change.
- `src/cli/query/arch-index.ts`, `query-manifest.ts` — no `EntityType` references.

## Alternatives

- **Keep `EntityType` closed, use `Entity.metadata` (opaque JSON)**: Rejected. An opaque
  bag is not queryable. The `attributes` field with a typed key-value contract is
  queryable and discoverable.
- **Full expression language (`--filter "type=lock_domain AND irq_safe=true"`)**: Deferred
  to a later proposal. Composing `--type` + `--attr` covers the primary use cases without
  a parser.
- **Make `'package'` a `KnownEntityType`**: Rejected. `'package'` is a synthetic
  diagram-level entity created by the aggregator, not a source-code entity type. Adding
  it to `KnownEntityType` would pollute the public type contract and require updating
  all plugin classDef style registrations. The aggregator's internal use of
  `'package'` is better typed via a narrower internal interface.

## Open Questions

1. **Multiple `--attr` flags**: should they be AND-composed or OR-composed?
   Recommendation: AND, consistent with how `--type` + `--attr` compose. The
   implementation uses an array (`string[]`) so this decision can be changed without
   interface breakage.
2. **`EntitySummary` and attributes**: should `toSummary()` expose a truncated view
   of `attributes` (e.g., top-3 keys), or only expose them via `--verbose`? Current
   recommendation: `--verbose` only, to avoid coupling `EntitySummary` to an
   unbounded map.
3. **`CustomEntityTypeDeclaration.mermaidShape`**: the current shape options
   (`'class'`, `'component'`, `'service'`, `'default'`) map to existing classDef
   styles rather than raw Mermaid shape strings. Should this be a raw Mermaid node
   shape string instead (e.g. `'([text])'`, `'{{text}}'`)? A raw string gives more
   power but requires the caller to know Mermaid internals.
4. **Registry lifetime and test isolation**: the `globalEntityTypeRegistry` singleton
   must be clearable between tests. Add a `clear()` method and call it in test
   `afterEach` hooks.

## Known Risks

- **TypeScript narrowing**: widening `EntityType` to `string` removes exhaustiveness
  checking from any `switch (entity.type)` that previously relied on the closed union.
  Audit all switch statements over `entity.type` before merging; replace them with
  explicit `KnownEntityType` guards or add a `default` case that does not throw.
  Pre-audit finding: the only `switch` statements over `.type` in `src/` are in
  `src/mermaid/generator.ts:581` and `src/mermaid/generator-formatting.ts:152` — both
  switch on `relation.type` (not `entity.type`) and are unaffected by this change.
  `src/plugins/kotlin/builders/function-builder.ts:276` switches on a tree-sitter node
  type (also unaffected). No `switch` on `entity.type` exists currently; risk is low.
- **`findByType('abstract_class')` special case**: `query-engine.ts:200-201` has a
  special branch that matches both `type === 'abstract_class'` and
  `isAbstract && type === 'class'`. This logic is preserved by the proposal; no
  change to `findByType()` means no regression here.
- **Test suite**: `tests/unit/cli/query/query-engine.test.ts` has existing `findByType`
  tests (lines 399+). New tests for `findByAttr` and `findByTypeAndAttr` must be added
  in the same file. Tests for the registry must live in a new
  `tests/unit/core/entity-type-registry.test.ts`.
