## Context in the Proposal Series

This is the third of three proposals addressing ArchGuard's extensibility:

| Step | Proposal | Side | Claude Code impact |
|------|----------|------|--------------------|
| 1+2 | `proposal-open-entity-type-and-attribute-queries.md` | Consumer | `archguard_find_entity` gains type + attribute filtering |
| 3 | `proposal-tree-sitter-query-externalization.md` | Producer | Transparent — query files externalized to `.scm`; no interface change |
| **4** | **This document** | **Producer** | **Transparent — entity mapping becomes declarative; no change to query interface** |

This proposal is **producer-side infrastructure**. It makes the mapping from tree-sitter
captures to `Entity` / `Relation` records declarative (schema + rules YAML), removing
the last piece of language-specific TypeScript from a plugin's hot path. Claude Code's
query interface does not change — `archguard_find_entity` with `attrFilter` continues
to work exactly as specified in Step 1+2.

The correct evaluation question for this step is not "does Claude Code benefit?" but
"is the reduction in plugin authoring cost worth the `RuleEngine` complexity?" The
answer depends on how many domain-specific plugins (beyond the reference C kernel
plugin) are actually needed. Step 4 should be deferred until at least two real plugin
use cases exist that would benefit from declarative mapping.

Dependency: requires Step 3 (QueryLoader, CaptureMapper infrastructure).

## Problem Statement

After query externalization (see `proposal-tree-sitter-query-externalization.md`),
extraction patterns live in `.scm` files — but the **mapping contract** remains
implicit in TypeScript `CaptureMapper` subclasses. Adding `lock_domain` to a C kernel
analysis still requires:

1. Writing a `.scm` query (now possible without touching the bridge)
2. Writing a TypeScript `CaptureMapper` subclass that interprets the captures
3. Declaring the entity type in `PluginMetadata.customEntityTypes`

Step 2 is the remaining barrier to purely additive extension. The mapping from a capture
(`@lock.name`, `@lock.irq_safe`) to an `Entity` record is mechanical: bind capture
names to `Entity` fields, set `attributes`, choose a `type` string. This pattern repeats
identically across mappers; only the field bindings differ.

The goal of this proposal is to make step 2 declarative: a `schema.yml` + `rules.yml`
pair that describes entities and maps captures without TypeScript, interpreted at runtime
by a `RuleEngine`.

This is the furthest point on the declarative spectrum. It builds on the query
externalization infrastructure and is the foundation for `RuleBasedLanguagePlugin` — a
plugin that requires no TypeScript beyond its `.scm` + YAML files.

## Goals

- Define a `schema.yml` format that declares entity types, relation types, and custom
  attribute keys, with rendering hints for the Mermaid layer.
- Define a `rules.yml` format that binds named captures from `.scm` queries to
  `Entity` / `Relation` field values.
- Implement a `RuleEngine` TypeScript class that evaluates schema + rules against a
  capture set and produces `Entity[]` / `Relation[]` fragments.
- Implement a `RuleBasedLanguagePlugin` adapter that wraps a `(schema.yml, rules.yml,
  queries/*.scm)` triple as a fully functional `ILanguagePlugin`.
- Validate the approach by implementing one domain-specific plugin in pure YAML+SCM:
  the C kernel lock domain analyzer.

## Non-Goals

- Replacing the TypeScript-backed plugins for TypeScript, Go, Java, Python. These remain
  as imperative plugins; `RuleBasedLanguagePlugin` is an additive path, not a migration
  target.
- Full Turing-complete rule conditions. The rule language covers the 90% case (bind,
  conditional field, static fallback). Recursive graph analysis (e.g., propagating
  `execution_context` along call chains) stays in TypeScript post-processing.
- Online pack registry or community distribution. That is a separate proposal
  (`proposal-language-knowledge-registry.md`). This proposal only defines the schema and
  the runtime engine.

## Design

### 1. `schema.yml`

Declares what the plugin can produce. Consumed by `EntityTypeRegistry` and the Mermaid
renderer.

```yaml
# src/plugins/c-kernel/schema.yml
version: "1.0"
language: c_kernel
display: "Linux Kernel C"

entity_types:
  - type: c_function
    display: "C Function"
    mermaid_shape: class        # render as class box

  - type: lock_domain
    display: "Lock Domain"
    mermaid_shape: component    # render as component box
    attributes:
      - name: lock_type
        values: [spinlock_irqsave, spinlock, mutex, atomic]
      - name: irq_safe
        type: boolean

  - type: entry_point
    display: "Kernel Entry"
    mermaid_shape: service
    attributes:
      - name: entry_type
        values: [syscall, kthread, interrupt, workqueue]

relation_types:
  - type: calls_via_ptr
    display: "Vtable Call"
    mermaid_style: dashed

  - type: acquires_lock
    display: "Lock Acquire"
    mermaid_style: solid

  - type: guarded_by
    display: "Protected By"
    mermaid_style: dotted
```

`mermaid_shape` values map to existing ArchGuard rendering categories. Unknown values
fall back to `class`. The `attributes` stanza matches
`CustomEntityTypeDeclaration.attributes` from the open entity type proposal.

### 2. `rules.yml`

Binds query captures to entity/relation fields. References query names defined in
`queries/*.scm`.

```yaml
# src/plugins/c-kernel/rules.yml
version: "1.0"

entity_rules:
  - query: functions              # name of .scm file (without extension)
    capture: function             # top-level capture that anchors the match
    emit:
      type: c_function
      name: "@function.name"      # bind @function.name capture to Entity.name
      visibility:
        if:
          capture: function.static   # present when 'static' keyword matched
          present: true
        then: private
        else: public

  - query: lock_macros
    capture: lock                 # anchored to DEFINE_SPINLOCK / DEFINE_MUTEX match
    emit:
      type: lock_domain
      name: "@lock.name"
      attributes:
        lock_type:
          if:
            capture: lock.irq_variant
            present: true
          then: spinlock_irqsave
          else: spinlock
        irq_safe:
          if:
            capture: lock.irq_variant
            present: true
          then: true
          else: false

  - query: entry_macros
    capture: entry
    emit:
      type: entry_point
      name: "@entry.fn"
      attributes:
        entry_type: kthread       # static string — always 'kthread' for this query

relation_rules:
  - query: lock_macros
    capture: lock
    emit:
      type: guarded_by
      source: "@lock.guarded_symbol"
      target: "@lock.name"
```

**Binding syntax**:
- `"@capture.name"` — bind the text content of a named capture node.
- `"static string"` — literal value, not a capture.
- `if/then/else` — conditional based on capture presence or capture text value.

The rule language is intentionally minimal. Complex conditions that cannot be expressed
with `if/present` or `if/text` require a TypeScript `CaptureMapper` subclass — the
imperative path remains available.

### 3. `RuleEngine`

```typescript
// src/plugins/shared/rule-engine.ts

export interface EntityRule {
  query: string;           // .scm file name
  capture: string;         // anchor capture name
  emit: EntityEmitSpec;
}

export interface RelationRule {
  query: string;
  capture: string;
  emit: RelationEmitSpec;
}

export class RuleEngine {
  constructor(
    private schema: Schema,
    private rules: Rules,
    private queries: QuerySet        // compiled by QueryLoader
  ) {}

  extractEntities(root: Parser.SyntaxNode, filePath: string): Entity[] {
    const results: Entity[] = [];
    for (const rule of this.rules.entityRules) {
      const query = this.queries.get(rule.query);
      if (!query) continue;
      for (const match of query.matches(root)) {
        const group = captureGroup(match);
        const anchor = group[rule.capture];
        if (!anchor) continue;
        const entity = this.evalEntitySpec(rule.emit, group, filePath, anchor);
        if (entity) results.push(entity);
      }
    }
    return results;
  }

  extractRelations(root: Parser.SyntaxNode, allEntities: Entity[]): Relation[] {
    // similar loop over rules.relationRules
  }

  private evalEntitySpec(
    spec: EntityEmitSpec,
    group: CaptureGroup,
    filePath: string,
    anchor: Parser.SyntaxNode
  ): Entity | null {
    const name = this.resolveBinding(spec.name, group);
    if (!name) return null;
    const type = spec.type;                          // always a literal in entity rules
    const visibility = this.resolveConditional(spec.visibility, group) ?? 'public';
    const attributes: Record<string, unknown> = {};
    for (const [key, binding] of Object.entries(spec.attributes ?? {})) {
      attributes[key] = this.resolveConditional(binding, group);
    }
    return {
      id: generateEntityId(packageFromFile(filePath), name),
      name,
      type,
      visibility: visibility as Visibility,
      members: [],
      sourceLocation: nodeToSourceLocation(anchor, filePath),
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    };
  }

  private resolveBinding(binding: string, group: CaptureGroup): string | undefined {
    if (binding.startsWith('@')) {
      return group[binding.slice(1)]?.text;
    }
    return binding;  // literal
  }

  private resolveConditional(
    spec: string | ConditionalSpec | undefined,
    group: CaptureGroup
  ): string | boolean | number | undefined {
    if (spec === undefined) return undefined;
    if (typeof spec === 'string') return this.resolveBinding(spec, group);
    const condNode = group[spec.if.capture];
    const condMet = spec.if.present
      ? condNode !== undefined
      : condNode?.text === spec.if.text;
    return condMet ? spec.then : spec.else;
  }
}
```

`RuleEngine` is stateless per file. It holds the compiled queries and schema; the
`extractEntities` / `extractRelations` methods are called once per file.

### 4. `RuleBasedLanguagePlugin`

```typescript
// src/plugins/shared/rule-based-plugin.ts

export class RuleBasedLanguagePlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata;
  readonly supportedLevels: readonly string[] = ['package', 'class'];

  private parser: Parser;
  private engine: RuleEngine;
  private pluginDir: string;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
    const schema = loadYaml<Schema>(path.join(pluginDir, 'schema.yml'));
    const rules  = loadYaml<Rules>(path.join(pluginDir, 'rules.yml'));
    const grammar = require(schema.grammar);        // tree-sitter grammar npm package
    this.parser = new Parser();
    this.parser.setLanguage(grammar);
    const loader = new QueryLoader(grammar, path.join(pluginDir, 'queries'));
    const queries = loader.loadAll();
    this.engine = new RuleEngine(schema, rules, queries);
    this.metadata = buildMetadata(schema);
  }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    const files = await glob(config.filePattern ?? '**/*.c', { cwd: workspaceRoot });
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    for (const file of files) {
      const code = await fs.readFile(path.join(workspaceRoot, file), 'utf8');
      const root = this.parser.parse(code).rootNode;
      entities.push(...this.engine.extractEntities(root, file));
    }
    relations.push(...this.engine.extractRelations(null, entities));
    return buildArchJson(this.metadata.language, workspaceRoot, entities, relations);
  }
}
```

The plugin is loaded by `PluginRegistry` when a `pluginDir` is configured:

```json
// archguard.config.json
{
  "plugins": [
    { "path": "./analysis-plugins/c-kernel" }
  ]
}
```

`PluginRegistry` checks for `schema.yml`; if present, instantiates
`RuleBasedLanguagePlugin`. If not, falls back to the existing imperative plugin lookup.

### 5. Reference implementation: C kernel lock domains

To validate the approach, implement a complete `c-kernel` rule-based plugin that
identifies:

- `c_function` entities from `function_definition` nodes
- `lock_domain` entities from `DEFINE_SPINLOCK` / `DEFINE_MUTEX` macro calls
- `entry_point` entities from `module_init` / `kthread_run` calls
- `guarded_by` relations linking function bodies to the locks they acquire

The plugin lives in `src/plugins/c-kernel/` with no TypeScript beyond the standard
grammar import. All extraction is expressed in `queries/*.scm` + `rules.yml`.

**Macro handling**: Since `DEFINE_SPINLOCK(lock_name)` appears as a `call_expression`
in the tree-sitter AST (with `lock_name` as an identifier argument), the `.scm` query:

```scheme
; src/plugins/c-kernel/queries/lock_macros.scm
(call_expression
  function: (identifier) @macro
    (#match? @macro "^DEFINE_(SPINLOCK|MUTEX|RWLOCK)$")
  arguments: (argument_list
    (identifier) @lock.name)) @lock

; IRQ-safe variant
(call_expression
  function: (identifier) @macro
    (#match? @macro "^DEFINE_SPINLOCK_IRQ")
  arguments: (argument_list
    (identifier) @lock.name)) @lock
(identifier) @lock.irq_variant
```

The `#match?` predicate is a tree-sitter built-in; it filters captures by regex.
This covers the common case without a preprocessor. Multi-line macros and conditional
compilation remain a known limitation, documented in `schema.yml` under `known_limits`.

## Affected Files

| File | Change |
|------|--------|
| `src/plugins/shared/rule-engine.ts` | New: `RuleEngine` class |
| `src/plugins/shared/rule-based-plugin.ts` | New: `RuleBasedLanguagePlugin` adapter |
| `src/plugins/shared/schema-loader.ts` | New: YAML parser + schema validation (Zod) |
| `src/core/plugin-registry.ts` | Add `RuleBasedLanguagePlugin` instantiation path |
| `src/types/config.ts` | Add `plugins?: PluginEntry[]` to `GlobalConfig` |
| `src/plugins/c-kernel/` | New: reference plugin directory |
| `src/plugins/c-kernel/schema.yml` | New |
| `src/plugins/c-kernel/rules.yml` | New |
| `src/plugins/c-kernel/queries/*.scm` | New |

Depends on: `proposal-tree-sitter-query-externalization.md` (QueryLoader,
CaptureMapper) and `proposal-open-entity-type-and-attribute-queries.md` (open
EntityType, Entity.attributes).

## Evolution Path

```
Phase 1 — RuleEngine + schema/rules parser
  Implement RuleEngine, SchemaLoader, schema/rules Zod validators
  No plugin yet — just the infrastructure with unit tests

Phase 2 — RuleBasedLanguagePlugin adapter
  Wire RuleEngine into ILanguagePlugin
  Add PluginRegistry path for rule-based plugins
  Integration test: load a minimal plugin from a temp directory

Phase 3 — Reference plugin: c-kernel lock domains
  Implement src/plugins/c-kernel/
  Validate against a real kernel subsystem (e.g., drivers/net/ethernet/intel/e1000/)
  Document known limits (macro coverage, conditional compilation)

Phase 4 — Expressive ceiling documentation
  Define a formal criterion: when does a language require an imperative plugin?
  (Recommendation: when extraction requires cross-file symbol resolution or
  type inference — i.e., when tree-sitter alone cannot produce the needed signal)
```

## Alternatives

- **YAML rules but no `RuleEngine` — generate TypeScript instead**: Rejected. Code
  generation produces a build step and a new kind of artifact to debug.
- **Use a general-purpose rule language (Datalog, Rego)**: Overkill for structural
  extraction. The binding + conditional model covers 90% of cases with far less
  infrastructure.
- **Embed the rule interpreter in `.scm` files using tree-sitter predicates**: Tree-sitter
  predicates are limited (text match, regex) and cannot emit structured entities.
  `rules.yml` is the right level for the emit contract.

## Open Questions

1. **YAML schema validation**: Should `schema.yml` / `rules.yml` be validated with Zod
   at startup (fail-fast) or lazily (skip invalid rules with a warning)? Fail-fast is
   recommended; schema errors should surface immediately.
2. **Capture name conventions**: Should capture names be `@class.name`, `@class.body`
   (dotted) or `@class_name`, `@class_body` (underscore)? Tree-sitter query syntax allows
   both; pick one and enforce it via a linter.
3. **Relation extraction timing**: `extractRelations` needs all entities to resolve
   source/target IDs. Should it receive the full `Entity[]` from the current file, or
   the cross-file entity index? Cross-file is more powerful but breaks single-file
   independence.
4. **Grammar versioning**: `RuleBasedLanguagePlugin` loads a grammar npm package.
   How should grammar version mismatches between `schema.yml` declaration and installed
   package be surfaced?
