# TypeScript Analysis Enhancement Proposals

> Status: Draft (rev 3)
> Branch: `feat/typescript`
> Scope: Four targeted improvements to the TypeScript analysis pipeline, grounded in
> ArchGuard's self-analysis run (`node dist/cli/index.js analyze -s ./src --output-dir .archguard`)

---

## Design Principle

ArchGuard provides **language-differentiated analysis**: each language plugin produces the
analysis most natural to that language's concepts and ecosystem. Go analysis surfaces
package dependency graphs, interface implementation topology, and goroutine concurrency
patterns because those are Go's architectural primitives. TypeScript analysis surfaces
module import graphs, class/interface hierarchies, and function composition because those
are TypeScript's. Neither is a subset of the other; both are first-class outputs of
`parseProject()` that require no special flags to activate.

The proposals below improve what TypeScript analysis already does — or should do — as a
matter of correctness and completeness. They are not optional extensions; they are fixes
and additions to standard TypeScript parsing.

---

## Evidence Base

Running ArchGuard against its own TypeScript source (`./src`, 222 classes) exposed four
concrete failure modes. These are the source of truth for every proposal below.

| Symptom | Observed value | Root cause |
|---------|---------------|------------|
| Completeness score on `all-classes`, `all-methods` | **0.0 / 100** | Cross-file type path info discarded at extraction time |
| "undefined entity" warnings | **45 warnings** across all diagrams | Same root cause |
| `overview/package` node count | **7 nodes** for 222-class project | No import-based module graph |
| `method/cli-module` missing function entities | `normalizeToDiagrams`, `filterDiagrams`, `createAnalyzeCommand` absent | Standalone exported functions not extracted |
| Total parse time for 9 diagrams | **623 s** | Overlapping source sets parsed independently |

Each proposal below targets exactly one failure mode.

---

## Prerequisite — Two Foundations That Must Be Addressed First

Before any of the four proposals can be implemented correctly, two structural issues in
the current codebase must be resolved. Every proposal depends on them.

### Prereq A: Entity ID Uniqueness

`ClassExtractor` currently assigns `id: name` (`class-extractor.ts:64`), using the bare
class name as the entity identifier. Two classes named `Config` in different modules
produce two entities with the same `id`. When `ParallelParser.mergeResults()` concatenates
per-file entity arrays, the second overwrites the first in downstream lookups.

**Fix**: Change entity ID to a file-scoped identifier:

```typescript
// class-extractor.ts — change:
id: name,
// to:
id: `${relativePath(sourceFile.getFilePath())}.${name}`,
```

Apply consistently across `ClassExtractor`, `InterfaceExtractor`, `EnumExtractor`, and
the proposed `FunctionExtractor`. The `relativePath` helper strips the project root to
produce stable, portable IDs (`src/cli/config-loader.ts.ConfigLoader`).

This is a **breaking change** to the ArchJSON schema for TypeScript output. Consumers
that hard-code entity IDs must be updated. The diagram renderer resolves entities by ID,
so its lookup tables must be rebuilt after this change.

### Prereq B: TypeScript Analysis Results in ArchJSON

The Go plugin attaches its analysis results to `ArchJSON.extensions.goAtlas`
(`extensions.ts`, ADR-002). TypeScript needs its own slot. The decision is:

**Add `tsAnalysis?: TsAnalysis` to `ArchJSONExtensions`** in `src/types/extensions.ts`:

```typescript
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;          // NEW — TypeScript standard analysis results
}

export interface TsAnalysis {
  version: string;                  // "1.0"
  moduleGraph?: TsModuleGraph;      // populated by Proposal 2
  // future: capabilityGraph, asyncTopology, requestFlow
}
```

This follows the same extension pattern as Go. The `TsAnalysis` extension is populated
during standard `parseProject()` — it is not gated behind any flag.

---

## Proposal 1 — Cross-File Type Reference Resolution

### Problem

The TypeScript extractor produces 45 "undefined entity" relation targets across a
222-class project, causing a **Completeness score of 0.0** on every multi-file diagram.

Representative warnings:
```
MermaidDiagramGenerator -> ArchJSON      (target: ArchJSON)
DiagramProcessor        -> DiagramConfig  (target: DiagramConfig)
ClassExtractor          -> Visibility     (target: Visibility)
```

All five frequently-warning targets are interfaces/type aliases declared in
`src/types/index.ts`. They appear as relation targets in files that import them.

### Root cause — the path is discarded at extraction time

This is a **parse-time problem, not an aggregation-time problem**. The information needed
to resolve cross-file references is already present: ts-morph emits fully-qualified type
strings for cross-file references:

```
import___home_yale_work_archguard_src_types_index___ArchJSON
import("../types/index.js").DiagramConfig
```

`RelationExtractor.extractTypeName()` (`relation-extractor.ts:186–215`) actively strips
this path information and returns only the bare class name:

```typescript
// relation-extractor.ts:200–207 — strips the path, returns bare name
if (typeText.startsWith('import___')) {
  const parts = typeText.split('___');
  const actualTypeName = parts[parts.length - 1];
  return actualTypeName;   // ← discards everything before the last '___'
}
```

The path is known at this point. Discarding it makes later resolution ambiguous.

### What to fix

#### A. Preserve file path in `extractTypeName()` return value

Change `extractTypeName()` to return a scoped identifier when the type is cross-file:

```typescript
// relation-extractor.ts — revised extractTypeName()
if (typeText.startsWith('import___')) {
  // parts: ['import', '<encoded_path>', '<ClassName>']
  const parts = typeText.split('___');
  const className = parts[parts.length - 1];
  const encodedPath = parts.slice(1, -1).join('___');
  const filePath = decodeImportPath(encodedPath);   // reverse the encoding
  const relPath = relativePath(filePath);            // e.g. "src/types/index.ts"
  return `${relPath}.${className}`;                  // "src/types/index.ts.ArchJSON"
}

if (typeText.startsWith('import(')) {
  const match = typeText.match(/^import\(['"]([^'"]+)['"]\)\.\s*([\w.]+)/);
  if (match) {
    const resolvedPath = resolveRelativePath(sourceFile, match[1]);
    return `${resolvedPath}.${match[2]}`;
  }
}
```

For unqualified local types (no `import` prefix), the existing behaviour is preserved —
the bare name is returned, and during post-merge resolution it is prefixed with the
current file's path.

#### B. Entity IDs must use the same scoped format (Prereq A)

After Prereq A is applied, `ClassExtractor` and friends produce IDs like
`src/types/index.ts.ArchJSON`. The scoped relation targets produced in step A will now
match these IDs directly at merge time — no separate repair pass is needed.

#### C. Post-merge cleanup of still-unresolved references

After `ParallelParser.mergeResults()` combines all per-file outputs, a single cleanup
pass removes relations whose `to` field still does not match any entity ID. These are
genuine external types (Node.js built-ins, third-party library types, primitive types):

```typescript
// parallel-parser.ts — add after mergeResults()
private filterExternalRelations(merged: ArchJSON): ArchJSON {
  const entityIds = new Set(merged.entities.map(e => e.id));
  const EXTERNAL = [
    /^(string|number|boolean|void|null|undefined|any|unknown|never)$/,
    /^(NodeJS\.|Buffer|Error|Promise|Map|Set|Array|Record)/,
    /^\{/,    // anonymous inline type
    /^\d+$/,  // numeric literal type
  ];
  merged.relations = merged.relations.filter(rel =>
    entityIds.has(rel.to) ||
    !EXTERNAL.some(p => p.test(rel.to))  // keep non-external unknowns for diagnostics
  );
  return merged;
}
```

The cleanup runs in `ParallelParser.mergeResults()` — the method that already
concatenates per-file ArchJSON results (`parallel-parser.ts:263`). This is the correct
location: all entities are known at this point, and the relation `to` values now carry
file path prefixes that can be matched against entity IDs unambiguously.

### Files changed

| File | Change |
|------|--------|
| `src/parser/relation-extractor.ts` | Preserve file path in `extractTypeName()` for `import___` and `import()` formats; add `decodeImportPath()` and `resolveRelativePath()` helpers |
| `src/parser/parallel-parser.ts` | Add `filterExternalRelations()` cleanup pass inside `mergeResults()` |
| `src/parser/class-extractor.ts` | Entity ID change (Prereq A) |
| `src/parser/interface-extractor.ts` | Entity ID change (Prereq A) |
| `src/parser/enum-extractor.ts` | Entity ID change (Prereq A) |
| `tests/unit/parser/relation-extractor.test.ts` | Tests for `import___` and `import()` scoped resolution |
| `tests/unit/parser/parallel-parser.test.ts` | Tests for external relation cleanup |

### Expected outcome

- Completeness score for `all-classes` rises from **0.0 to ≥ 80**
- "undefined entity" warnings drop to near 0 for internal types
- Scoped entity IDs eliminate cross-module name collision (Prereq A)

---

## Proposal 2 — Import-Based Module Dependency Graph

### Problem

The current `overview/package` diagram contains **7 nodes** for a 222-class, 9-module
project. These nodes are top-level directory names produced by `HeuristicGrouper`
(`src/mermaid/grouper.ts`), not by import analysis. The diagram shows no edge weights,
no cycle information, and no per-module statistics.

The 7 nodes tell an architect nothing about which modules depend on which, how tightly
coupled they are, or whether any cycles exist — exactly the questions a module-level view
is meant to answer.

### What to add

#### A. New type definitions in `src/types/extensions.ts` (Prereq B)

```typescript
// Added to TsAnalysis (see Prereq B):
export interface TsModuleGraph {
  nodes: TsModuleNode[];
  edges: TsModuleDependency[];
  cycles: TsModuleCycle[];
}

export interface TsModuleNode {
  id: string;       // project-root-relative directory, e.g. "src/cli"
  name: string;     // last path segment, e.g. "cli"
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
  from: string;           // module id
  to: string;             // module id
  strength: number;       // count of distinct import statements
  importedNames: string[];
}

export interface TsModuleCycle {
  modules: string[];      // ordered module ids forming the cycle
  severity: 'warning' | 'error';
}
```

#### B. New builder: `ModuleGraphBuilder`

```typescript
// src/plugins/typescript/builders/module-graph-builder.ts
export class ModuleGraphBuilder {
  build(projectRoot: string, sourceFiles: SourceFile[]): TsModuleGraph {
    // 1. Assign each file to a module (its containing directory, normalised
    //    to be project-root-relative)
    // 2. For each SourceFile.getImportDeclarations(), resolve the specifier
    //    to an absolute path; map to a module id
    // 3. Record (fromModule, toModule) edges; aggregate strength by pair
    // 4. DFS cycle detection (error if length ≥ 3, warning if length == 2)
    // 5. Classify external imports (node_modules, https:// URLs)
  }
}
```

Uses `SourceFile.getImportDeclarations()` from the ts-morph `Project` already
constructed during `TypeScriptPlugin.initialize()` — no second parse pass.

#### C. Orchestration layer: `TypeScriptAnalyzer`

The TypeScript plugin currently has no builder orchestration layer (unlike Go, which has
`BehaviorAnalyzer`). Add one:

```typescript
// src/plugins/typescript/typescript-analyzer.ts
export class TypeScriptAnalyzer {
  private moduleGraphBuilder = new ModuleGraphBuilder();

  async analyze(projectRoot: string, sourceFiles: SourceFile[]): Promise<TsAnalysis> {
    const moduleGraph = this.moduleGraphBuilder.build(projectRoot, sourceFiles);
    return { version: '1.0', moduleGraph };
  }
}
```

`TypeScriptPlugin.parseProject()` calls `TypeScriptAnalyzer.analyze()` and attaches the
result to `extensions`:

```typescript
// src/plugins/typescript/index.ts — inside parseProject()
const archJson = await this.parser.parseProject(workspaceRoot, pattern);
const sourceFiles = this.project.getSourceFiles();  // already parsed by initialize()
const tsAnalysis = await this.analyzer.analyze(workspaceRoot, sourceFiles);
return { ...archJson, extensions: { tsAnalysis } };
```

#### D. Rendering: new code path in the diagram generator

The diagram renderer must be extended to read `extensions.tsAnalysis.moduleGraph` when
the requested detail level is `package` and the language is `typescript`. This is a new
rendering branch, not a minor addition:

- A new `renderTsModuleGraph()` method in `src/mermaid/generator.ts` renders the graph
  as `flowchart LR` with edge line thickness proportional to `strength` (using Mermaid
  `linkStyle` — the same technique already used by `MermaidTemplates.renderPackageGraph()`
  for Go)
- When `extensions.tsAnalysis.moduleGraph` is absent or the language is not TypeScript,
  the existing `HeuristicGrouper`-based package view is used as fallback — no regression
  for other languages

### Files changed

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Add `TsAnalysis`, `TsModuleGraph`, `TsModuleNode`, `TsModuleDependency`, `TsModuleCycle`; add `tsAnalysis?` slot to `ArchJSONExtensions` (Prereq B) |
| `src/plugins/typescript/builders/module-graph-builder.ts` | New builder (new file) |
| `src/plugins/typescript/typescript-analyzer.ts` | New orchestration layer (new file) |
| `src/plugins/typescript/index.ts` | Instantiate `TypeScriptAnalyzer`; attach result to `extensions` in `parseProject()` |
| `src/mermaid/generator.ts` | Add `renderTsModuleGraph()` branch at `package` detail level |
| `tests/plugins/typescript/builders/module-graph-builder.test.ts` | Unit tests |
| `tests/plugins/typescript/typescript-analyzer.test.ts` | Integration test |

### Expected outcome

- `overview/package` grows from **7 nodes** to the actual module count (~10–15 for `src/`)
- Edges carry import strength; cycles rendered with distinct colour/styling
- Deterministic output from AST; no grouping heuristic involved

---

## Proposal 3 — Standalone Function Entity Extraction

### Problem

The `src/cli/` module contains three exported standalone functions that drive the entire
CLI:

```
src/cli/commands/analyze.ts  → normalizeToDiagrams(), filterDiagrams(), createAnalyzeCommand()
src/cli/commands/init.ts     → createInitCommand()
src/cli/commands/cache.ts    → createCacheCommand()
src/cli/index.ts             → createCLI()
```

None of these appear as entities in the analysis output. Any class that calls them
(e.g., `DiagramProcessor` calling `normalizeToDiagrams`) produces a `dependency` relation
to a non-existent target, contributing to the undefined-entity count. TypeScript projects
commonly expose significant behaviour through standalone functions; ArchGuard should
reflect this.

### Dependency on Prereq A

Function entities must use the same scoped ID format as class/interface entities (Prereq A).
This proposal must not be implemented before Prereq A lands, to avoid introducing a
second conflicting ID scheme.

### What to add

#### A. New `FunctionExtractor`

```typescript
// src/parser/function-extractor.ts
export class FunctionExtractor {
  extract(sourceFile: SourceFile, relativeFilePath: string): Entity[] {
    const entities: Entity[] = [];

    // 1. Named function declarations: export function foo(...)
    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;
      entities.push({
        id: `${relativeFilePath}.${fn.getName()}`,
        name: fn.getName()!,
        type: 'function',
        visibility: 'public',
        members: this.extractParams(fn),
      });
    }

    // 2. Arrow / function-expression const exports:
    //    export const foo = (...) => ...
    //    export const foo = function(...) { ... }
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          entities.push({
            id: `${relativeFilePath}.${decl.getName()}`,
            name: decl.getName(),
            type: 'function',
            visibility: 'public',
            members: this.extractParams(init),
          });
        }
      }
    }

    return entities;
  }
}
```

`type: 'function'` is already a valid `EntityType` value in `src/types/index.ts` — no
schema change needed.

#### B. Integrate into `TypeScriptParser.parseCode()`

Add `FunctionExtractor` to the existing extractor composition:

```typescript
// src/parser/typescript-parser.ts — inside parseCode()
const functionExtractor = new FunctionExtractor();
entities.push(...functionExtractor.extract(sourceFile, relativeFilePath));
```

#### C. Call-site detection — scope boundary

Detecting which functions *call* other functions requires walking statement bodies
(`CallExpression` nodes), matching callee names against the set of extracted function
entities, and then cross-referencing import declarations to determine the target module.
This is substantially more complex than the other relation extraction done today and
requires new AST infrastructure. **It is explicitly deferred to a follow-up proposal.**

This proposal extracts function *declarations* only — enough for function entities to
appear in diagrams and for existing class→function composition relations (recorded via
import-type analysis in Proposal 1) to resolve correctly.

### Files changed

| File | Change |
|------|--------|
| `src/parser/function-extractor.ts` | New extractor |
| `src/parser/typescript-parser.ts` | Add `FunctionExtractor` to `parseCode()` composition |
| `tests/unit/parser/function-extractor.test.ts` | Tests: named function, arrow const, unexported (excluded), overloads |

### Expected outcome

- Exported standalone functions appear as `function`-type entities in all diagrams
- Relations from class methods to these functions resolve correctly once Proposal 1 lands
- No ArchJSON schema changes

---

## Proposal 4 — Parse-Time Deduplication

### Problem

The self-analysis run took **623 seconds** for 9 diagrams. Every diagram triggers a
fully independent parse, even when source sets overlap:

```
overview/package      67.6 s  (./src — all 9 modules, 222 files)
class/all-classes     95.2 s  (./src — same 222 files)
method/all-methods   106.7 s  (./src — same 222 files)
method/cli-module     71.9 s  (./src/cli — subset of above)
method/mermaid-module 74.8 s  (./src/mermaid — subset of above)
...
```

The three full-`src` diagrams each parse all 222 files independently. The six
module-level diagrams re-parse files the full-`src` diagrams already processed.
Estimated redundant work: **~400 s out of 623 s**.

The existing `CacheManager` (`src/cli/cache-manager.ts`) caches the final ArchJSON
output keyed by source-set hash, which avoids repeated parses across separate `analyze`
invocations (cold → warm). It does **not** share parse results between diagrams within
a single `analyze` invocation. When 9 diagrams are generated in one run and the cache is
cold, every diagram starts from scratch.

### What to add

#### A. Per-file parse cache in `ParallelParser`

Add a session-level `ParseCache` that stores per-file ArchJSON fragments keyed by
`sha256(absoluteFilePath + fileContent)`:

```typescript
// src/parser/parse-cache.ts
export class ParseCache {
  private cache = new Map<string, FileArchJSON>();

  getOrParse(
    filePath: string,
    content: string,
    parse: () => FileArchJSON
  ): FileArchJSON {
    const key = sha256(filePath + content);
    if (this.cache.has(key)) return this.cache.get(key)!;
    const result = parse();
    this.cache.set(key, result);
    return result;
  }
}
```

`ParseCache` is an in-memory, session-scoped store. It is distinct from `CacheManager`
(disk-based, diagram-scoped) and the two coexist.

#### B. `ParallelParser` accepts an optional cache

`ParallelParser.parseFiles()` currently creates a fresh `TypeScriptParser` and parses
each file without any caching (`parallel-parser.ts:253`). Extend `ParallelParserOptions`
to accept an optional cache, and use it per file:

```typescript
export interface ParallelParserOptions {
  concurrency?: number;
  continueOnError?: boolean;
  parseCache?: ParseCache;    // NEW — shared across diagrams
}
```

This is a **non-breaking** interface addition (optional field). Files not in the cache
are parsed normally; the result is stored for subsequent diagrams.

#### C. Single `ParseCache` instance per `analyze` invocation

`createAnalyzeCommand()` in `src/cli/commands/analyze.ts` orchestrates all diagram jobs.
Create one `ParseCache` there and thread it through `DiagramProcessor` into
`ParallelParser`:

```typescript
// analyze.ts — inside the action handler
const parseCache = new ParseCache();
for (const diagram of diagrams) {
  await processor.process(diagram, { parseCache });
}
```

`DiagramProcessor` passes `parseCache` into `ParallelParser` options. This requires
adding `parseCache` to `DiagramProcessor`'s process options — a localized change that
does not affect the public CLI interface.

#### D. Grouping result deduplication

`HeuristicGrouper.group()` is a pure, fast function (no I/O). Its output is deterministic
given the same entity set. When two diagrams share identical entity sets, the grouping
computation is duplicated but is cheap (milliseconds). **No caching is needed here.**

### Files changed

| File | Change |
|------|--------|
| `src/parser/parse-cache.ts` | New session-level per-file cache |
| `src/parser/parallel-parser.ts` | Add optional `parseCache` to `ParallelParserOptions`; use it in `parseFiles()` |
| `src/cli/commands/analyze.ts` | Create one `ParseCache` per `analyze` invocation; pass through `DiagramProcessor` |
| `src/cli/diagram-processor.ts` | Accept and forward `parseCache` to `ParallelParser` |
| `tests/unit/parser/parse-cache.test.ts` | Unit tests: cache hit/miss, key collision, empty input |

### Expected outcome

- Parse time for the 9-diagram config estimated to drop from **623 s to ~150–200 s** (3–4×)
- No change to ArchJSON output; cache is transparent to all downstream code
- `CacheManager` (disk cache) continues to work independently

---

## Dependency Map and Delivery Phases

```
Prereq A (entity ID uniqueness)   ──┬──► P1 (cross-file resolution)
                                    └──► P3 (function extraction)

Prereq B (TsAnalysis in ArchJSON) ──────► P2 (module graph)

P1 (cross-file resolution)        ──────► P4 (parse dedup — cache correct output)
P3 (function extraction)          ──────► P4 (parse dedup — cache correct output)
```

| Phase | Content | Rationale |
|-------|---------|-----------|
| **Phase A** | Prereq A + Prereq B | Foundation: ID uniqueness and extension slot; all other phases depend on these |
| **Phase B** | P1 + P3 | Correctness fixes to the parser; both depend only on Phase A; can be developed in parallel |
| **Phase C** | P2 | First new analysis output; depends on P1 for stable entity IDs and correct relations |
| **Phase D** | P4 | Performance; safe only after Phase B stabilises parse output |

---

## Out of Scope

The following are deferred until the foundation established by Phases A–C is stable:

- **Function call-site detection** (P3-C): Walking `CallExpression` bodies to produce
  function→function dependency edges; requires new AST infrastructure
- **Async/Promise topology**: TypeScript's concurrency equivalent; requires function body
  traversal
- **Request flow graph**: Decorator-based HTTP entry point detection (NestJS, Express)
- **TypeScript Language Service integration**: More precise cross-file resolution than the
  `import___` path approach; higher complexity, deferred
