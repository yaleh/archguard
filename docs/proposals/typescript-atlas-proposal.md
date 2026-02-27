# TypeScript Atlas Enhancement Proposals

> Status: Draft (rev 1)
> Branch: `feat/typescript`
> Scope: Four targeted improvements to the TypeScript analysis pipeline, grounded in
> ArchGuard's self-analysis run (`node dist/cli/index.js analyze -s ./src --output-dir .archguard`)

---

## Evidence Base

Running ArchGuard against its own TypeScript source (`./src`, 222 classes) exposed four
concrete failure modes. These are the source of truth for every proposal below.

| Symptom | Observed value | Root cause |
|---------|---------------|------------|
| Completeness score on `all-classes`, `all-methods` | **0.0 / 100** | Cross-file type references not resolved |
| "undefined entity" warnings | **45 warnings** across all diagrams | Same root cause |
| `overview/package` node count | **7 nodes** for 222-class project | No import-based module graph |
| `method/ai-module` entities | **0** despite real source files | Standalone functions not extracted |
| Total parse time for 9 diagrams | **623 s** | Per-diagram LLM call duplication |

Each proposal below targets exactly one failure mode.

---

## Proposal 1 — Cross-File Type Reference Resolution

### Problem

The TypeScript extractor records `composition` / `dependency` relations against type names
it encounters in field declarations and constructor parameters, but those names are only
resolved within the same file. When the target type is defined in another module — even a
sibling file — the relation's target is stored as a bare name (`ArchJSON`, `DiagramConfig`,
`DetailLevel`) with no corresponding entity in the output.

The result is systematic false-negatives in the relation graph and a **Completeness score
of 0.0** on every multi-file diagram. The 45 "undefined entity" warnings observed in the
self-analysis run are all instances of this problem.

Representative warnings from the run:

```
MermaidDiagramGenerator -> ArchJSON           (target: ArchJSON)
MermaidDiagramGenerator -> DetailLevel        (target: DetailLevel)
DiagramProcessor        -> DiagramConfig       (target: DiagramConfig)
ClassExtractor          -> Visibility          (target: Visibility)
ArchJSONAggregator      -> DetailLevel         (target: DetailLevel)
```

All five targets (`ArchJSON`, `DetailLevel`, `DiagramConfig`, `Visibility`) are **type
aliases or interfaces declared in `src/types/index.ts`** — they exist in the parsed
ArchJSON when `src/types` is analysed, but the relation extractor running on
`src/mermaid`, `src/parser`, and `src/cli` cannot see them.

### Root cause in code

`RelationExtractor` resolves field/parameter types against the entity list produced by
`ClassExtractor` and `InterfaceExtractor` from the **same file**. The downstream
`ArchJSONAggregator` merges entities from all files into one ArchJSON, but cross-file
references recorded by `RelationExtractor` before aggregation still carry bare names.

### What to add

#### A. Global symbol table in `ArchJSONAggregator`

After merging all per-file ArchJSONs, build a `symbolTable: Map<string, string>` that
maps each `entity.name` to its `entity.id`:

```typescript
// After mergeAll():
const symbolTable = new Map<string, string>();
for (const entity of merged.entities) {
  symbolTable.set(entity.name, entity.id);
  // Also register unqualified name for nested paths (e.g. "src/types/index.ts.ArchJSON" → "ArchJSON")
  const short = entity.name.split('.').pop();
  if (short && !symbolTable.has(short)) symbolTable.set(short, entity.id);
}
```

#### B. Post-aggregation relation repair pass

Walk every relation in the merged output. For relations whose `to` field does not match
any `entity.id`, attempt resolution via the symbol table:

```typescript
for (const rel of merged.relations) {
  if (!entityIds.has(rel.to)) {
    const resolved = symbolTable.get(rel.to);
    if (resolved) rel.to = resolved;
    // else: genuine external type (e.g. "string", "NodeJS.Timeout") → leave or drop
  }
}
```

#### C. Drop irreducible external references silently

After the repair pass, remove relations whose `to` still does not match any entity ID
**and** whose target matches a known-external pattern (primitive types, Node.js built-ins,
anonymous inline types starting with `{`). These produce only noise in the diagram.

```typescript
const EXTERNAL_PATTERNS = [
  /^(string|number|boolean|void|null|undefined|any|unknown|never)$/,
  /^(NodeJS\.|Buffer|Error|Promise|Map|Set|Array|Record)/,
  /^\{/,   // anonymous inline object type
  /^\d+$/, // numeric literal type
];
```

### Files changed

| File | Change |
|------|--------|
| `src/parser/archjson-aggregator.ts` | Add `buildSymbolTable()` + `repairRelations()` post-merge |
| `src/parser/relation-extractor.ts` | Store import alias map alongside relations for repair pass |
| `tests/unit/parser/archjson-aggregator.test.ts` | New tests: cross-file relation repair, external type filtering |

### Expected outcome

- Completeness score for `all-classes` rises from **0.0 to ≥ 80** (based on the 45
  undefined-entity count vs 318 total relations — removing 45 false warnings closes the
  gap)
- "undefined entity" warning count drops to near 0 for internal types; only genuine
  external dependencies remain
- No changes to ArchJSON schema; backward-compatible

---

## Proposal 2 — Import-Based Module Dependency Graph

### Problem

The current `overview/package` diagram contains **7 nodes** for a 222-class, 9-module
project. These nodes are top-level directory names produced by LLM-based grouping, not
by import analysis. The diagram shows no edge weights, no cycle information, and no
per-module statistics.

In the self-analysis run, the 7 nodes are: `cli`, `parser`, `mermaid`, `ai`, `types`,
`utils`, `plugins`. The diagram gives no information about which modules import which,
how tightly coupled they are, or whether any cycles exist — exactly the questions an
architect needs to answer.

Compare with Go Atlas Layer 1 (`PackageGraph`), which for a similar-sized project
produces: per-package node with type classification (internal/external/std), import-count
edge strength, and explicit cycle detection.

### What to add

Add a **module dependency graph** as the TypeScript equivalent of Go's `PackageGraph`.
"Module" is defined as a source directory (or tsconfig path alias). The graph is built
from `import` statement analysis, not LLM inference.

#### A. New type definitions (add to `src/types/extensions.ts`, following ADR-002)

```typescript
export interface TsAtlasExtension {
  version: string;           // "1.0"
  layers: TsAtlasLayers;
  metadata: TsAtlasMetadata;
}

export interface TsAtlasLayers {
  module?: TsModuleGraph;    // Layer 1: import-based module dependency
  // Future layers added here
}

export interface TsModuleGraph {
  nodes: TsModuleNode[];
  edges: TsModuleDependency[];
  cycles: TsModuleCycle[];
}

export interface TsModuleNode {
  id: string;           // directory path relative to project root, e.g. "src/cli"
  name: string;         // last path segment, e.g. "cli"
  type: 'internal' | 'external' | 'node_modules';
  fileCount: number;
  stats: {
    classes: number;
    interfaces: number;
    functions: number;
    enums: number;
  };
}

export interface TsModuleDependency {
  from: string;         // module id
  to: string;           // module id
  strength: number;     // count of import statements
  importedNames: string[];  // exported names imported (for diagnostics)
}

export interface TsModuleCycle {
  modules: string[];    // ordered list of module ids forming the cycle
  severity: 'warning' | 'error';
}
```

#### B. New builder: `ModuleGraphBuilder`

```typescript
// src/plugins/typescript/atlas/builders/module-graph-builder.ts
export class ModuleGraphBuilder {
  build(projectRoot: string, sourceFiles: SourceFile[]): TsModuleGraph {
    // 1. Assign each file to a module (directory-based or tsconfig-paths)
    // 2. For each import statement, record from-module → to-module edge
    // 3. Aggregate edge strength by (from, to) pair
    // 4. Run DFS cycle detection
    // 5. Classify modules: internal (under projectRoot), node_modules, external URL
  }
}
```

The builder uses ts-morph `SourceFile.getImportDeclarations()` — no new parsing required.
Module ID is the resolved file path's directory, normalised to be project-root-relative.

#### C. CLI integration

When `--lang typescript` is used (atlas mode), the `overview/package` diagram is replaced
by the import-based module graph. A `--no-atlas` flag disables this and restores the
current LLM-grouped package view (same opt-out pattern as `--lang go --no-atlas`).

### Files changed

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Add `TsAtlasExtension`, `TsAtlasLayers`, `TsModuleGraph` and supporting types |
| `src/plugins/typescript/atlas/builders/module-graph-builder.ts` | New builder |
| `src/plugins/typescript/atlas/index.ts` | New `TypeScriptAtlasPlugin` wrapper |
| `src/plugins/typescript/atlas/renderers/mermaid-templates.ts` | Render `TsModuleGraph` as `flowchart LR` with edge thickness proportional to strength |
| `src/cli/commands/analyze.ts` | Auto-enable atlas for `--lang typescript`; add `--no-atlas` opt-out |
| `tests/plugins/typescript/atlas/module-graph-builder.test.ts` | Unit tests |

### Expected outcome

- `overview/package` grows from **7 nodes** to the actual count of source directories
  (currently ~10–15 for `src/`)
- Edges carry import counts (strength); cycles shown with distinct styling
- Parse time for the package diagram drops because no LLM call is needed

---

## Proposal 3 — Standalone Function Entity Extraction

### Problem

The `method/ai-module` diagram produced **0 entities** and **0 relations** despite
`src/ai/` containing real source files with exported functions and classes.

Investigation: `src/ai/` exports functions and arrow-function constants as its primary
surface — e.g., `export function groupWithLLM(...)`, `export const createPrompt = ...`.
The current extractors (`ClassExtractor`, `InterfaceExtractor`, `EnumExtractor`) only
handle `class`, `interface`, and `enum` declarations. Standalone function exports are
completely invisible to the analysis pipeline.

This is the direct cause of the `ai-module` zero-entity result and contributes to the
missing relations in all-module diagrams (any caller of these functions produces a
`dependency` relation to an entity that doesn't exist).

### What to add

#### A. New `FunctionExtractor`

```typescript
// src/parser/function-extractor.ts
export class FunctionExtractor {
  extract(sourceFile: SourceFile): Entity[] {
    const entities: Entity[] = [];

    // 1. Function declarations: export function foo(...)
    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;
      entities.push(this.toEntity(fn));
    }

    // 2. Arrow function / function expression const exports:
    //    export const foo = (...) => ...
    //    export const foo = function(...) { ... }
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      if (!varDecl.isExported()) continue;
      const init = varDecl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        entities.push(this.toEntityFromVar(varDecl, init));
      }
    }

    return entities;
  }
}
```

Entity format follows existing convention:

```typescript
{
  id: `${filePath}.${fnName}`,
  name: fnName,
  type: 'function',
  visibility: 'public',
  members: [
    // parameters as member entries (type='parameter'), return type as metadata
  ],
}
```

#### B. Integrate into `TypeScriptParser`

Add `FunctionExtractor` to the existing extractor composition in
`TypeScriptParser.parseSourceFile()`:

```typescript
const functionExtractor = new FunctionExtractor();
entities.push(...functionExtractor.extract(sourceFile));
```

#### C. `RelationExtractor` — call-site detection

Extend `RelationExtractor` to detect function calls in method bodies that reference
other extracted functions (both class methods calling standalone functions and standalone
functions calling each other):

```typescript
// Detect: import { groupWithLLM } from '../ai/llm-grouper.js'
// Used in: DiagramProcessor.process() → groupWithLLM(...)
// → Relation { from: 'DiagramProcessor', to: 'groupWithLLM', type: 'dependency' }
```

### Files changed

| File | Change |
|------|--------|
| `src/parser/function-extractor.ts` | New extractor |
| `src/parser/typescript-parser.ts` | Add `FunctionExtractor` to parser composition |
| `src/parser/relation-extractor.ts` | Add call-site detection for function entities |
| `tests/unit/parser/function-extractor.test.ts` | Unit tests covering declaration forms |

### Expected outcome

- `method/ai-module` rises from **0 entities to ≥ 5** (LLMGrouper functions, ClaudeCodeAdapter)
- Relations from class methods to standalone functions become visible
- No ArchJSON schema changes; `type: 'function'` is already a valid entity type

---

## Proposal 4 — Parse-Time Deduplication and Incremental Reuse

### Problem

The self-analysis run took **623 seconds** for 9 diagrams. Every diagram that covers
overlapping source directories (e.g., `all-methods` and `method/cli-module` both include
`src/cli`) triggers a fully independent parse — including LLM grouping calls — for the
same source files.

Concrete duplication from the run (parse times):

```
overview/package    67.6 s   (./src — all 9 modules)
class/all-classes   95.2 s   (./src — all 9 modules)
method/all-methods  106.7 s  (./src — all 9 modules)
method/cli-module   71.9 s   (./src/cli)
method/mermaid-module 74.8 s (./src/mermaid)
method/parser-module  74.2 s (./src/parser)
method/ai-module    6.98 s   (./src/ai)
method/types-module 68.8 s   (./src/types)
method/utils-module 57.1 s   (./src/utils)
```

`overview/package`, `all-classes`, and `all-methods` all parse the same 222 files three
times. The six module-level diagrams together re-parse the same files the wide-scope
diagrams already parsed. Total redundant work: approximately **400 s out of 623 s**.

The existing `CacheManager` caches the final ArchJSON output per source-set hash, but
does **not** cache at the parsing unit level. When the LLM grouping call fails or the
cache is cold, every diagram starts from scratch.

### What to add

#### A. Parse-result cache keyed by (file path, content hash)

Add a `ParseCache` layer below `TypeScriptParser` that stores the per-file ArchJSON
fragment (entities + relations extracted from a single `.ts` file) keyed by
`sha256(filePath + fileContent)`.

On a cache hit, the extractor skips ts-morph AST construction entirely and returns the
cached fragment.

```typescript
// src/parser/parse-cache.ts
export class ParseCache {
  async getOrParse(
    filePath: string,
    content: string,
    parse: () => Promise<FileArchJSON>
  ): Promise<FileArchJSON> {
    const key = sha256(filePath + content);
    const cached = await this.store.get(key);
    if (cached) return cached;
    const result = await parse();
    await this.store.set(key, result);
    return result;
  }
}
```

#### B. Shared parse session across diagrams in one `analyze` run

When `analyze` processes multiple diagrams in one invocation, pass a single `ParseCache`
instance to all `TypeScriptParser` / `ParallelParser` calls. Files that appear in
multiple diagrams (e.g., `src/cli/index.ts` appears in both `all-classes` and
`method/cli-module`) are parsed once and the result reused.

This is a session-level cache (lives in memory for the duration of the `analyze` command)
distinct from the existing disk-level `CacheManager` (which caches diagram-level output).

#### C. LLM grouping deduplication

When two diagrams share the same source set, the LLM grouping call is also duplicated.
Pass the grouping result from the first diagram to subsequent diagrams with the same
source scope. The grouping key is the sorted list of entity IDs — if identical, reuse.

### Files changed

| File | Change |
|------|--------|
| `src/parser/parse-cache.ts` | New session-level file-fragment cache |
| `src/parser/parallel-parser.ts` | Accept optional `ParseCache`; use it per file |
| `src/cli/commands/analyze.ts` | Create one `ParseCache` per `analyze` invocation; thread it into all diagram jobs |
| `src/mermaid/mermaid-diagram-generator.ts` | Accept and thread grouping cache |
| `tests/unit/parser/parse-cache.test.ts` | Unit tests |

### Expected outcome

- Second and subsequent diagrams that overlap the first parse in near-zero time
- Total parse time for the current 9-diagram config estimated to drop from **623 s to
  ~150–200 s** (3–4× speedup) because the three full-`src` diagrams share one parse pass
  and the six module diagrams reuse file fragments already cached
- No change to output quality; cache is transparent to downstream code

---

## Dependency Map and Recommended Order

```
Proposal 1 (cross-file resolution)   ──────────────────►  can ship alone; fixes Completeness
Proposal 3 (function extraction)     ──────────────────►  can ship alone; fixes ai-module
Proposal 2 (module graph)            depends on P1 entity set being stable
Proposal 4 (parse deduplication)     depends on P1+P3 (so the shared parse is correct)
```

| Phase | Proposals | Why together |
|-------|-----------|--------------|
| **Phase A** | P1 + P3 | Both are pure parser changes; no new Atlas infrastructure; fix existing breakage |
| **Phase B** | P2 | First new Atlas layer; introduces `TsAtlasExtension` in `extensions.ts`; needs correct entity set from Phase A |
| **Phase C** | P4 | Performance optimisation; safest after Phase A stabilises the parse output |

Phases A and B can be developed in parallel by different agents; Phase C should wait for
Phase A to land to avoid caching an incorrect intermediate state.

---

## Out of Scope

The following improvements are intentional **non-goals** for this proposal:

- Async topology (Layer 3 equivalent) — requires function body traversal; deferred to a
  follow-up proposal after Phase A+B establish the TypeScript Atlas infrastructure
- Request flow graph (Layer 4 equivalent) — decorator-based entry point detection;
  deferred for same reason
- Decorator/DI graph — NestJS/Angular specific; lower priority for a general-purpose tool
- gopls-equivalent semantic analysis — TypeScript's Language Service could provide
  go-to-definition for cross-file resolution, but Proposal 1's symbol-table repair is
  simpler and covers the observed failure cases without a language server dependency
