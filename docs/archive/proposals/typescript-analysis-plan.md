# TypeScript Analysis Enhancement — Development Plan

> Source proposal: `docs/proposals/typescript-atlas-proposal.md` (rev 3)
> Branch: `feat/typescript`
> Status: Draft (rev 2)
>
> Rev 2 changes: Corrected after strict architectural review against actual codebase.
> See `docs/proposals/typescript-analysis-plan-review.md` for the full review findings.

---

## Overview

Four proposals and two prerequisites are mapped to four delivery phases:

| Phase | Content | Nature | Rationale |
|-------|---------|--------|-----------|
| **Phase A** | Prereq A + Prereq B | Foundation | Entity ID uniqueness and extension slot; all downstream phases depend on these |
| **Phase B** | P1 (cross-file resolution) + P3 (function extraction) | Correctness | Both depend only on Phase A; developed in parallel streams within the phase |
| **Phase C** | P2 (module dependency graph) | New output | Depends on Phase B; first new analysis output type |
| **Phase D** | P4 (parse deduplication) | Performance | Depends on Phase B; independent of Phase C |

Phases C and D can be developed in parallel once Phase B is merged.

### Test baseline

**≥ 1308 tests passing** (7 pre-existing failures in
`tests/integration/mermaid/e2e.test.ts` are unrelated to this work).
All phases must maintain or increase this count.

### Code budget per stage

- Implementation: ≤ 200 lines changed per stage
- New tests: ≤ 200 lines per stage

---

## Phase A — Foundations (Prereq A + Prereq B)

### Objectives

- **Prereq A**: Change entity ID from bare `name` to file-scoped `"<relPath>.<Name>"` in
  all extractors. The relative path is computed in `TypeScriptParser` (which knows
  `rootDir`) and passed to each extractor's `extract()` call — extractors themselves
  receive no new fields.
- **Prereq B**: Add `tsAnalysis?: TsAnalysis` and supporting types to `extensions.ts`.

### Architectural context

`TypeScriptParser.parseProject(rootDir, pattern)` already has `rootDir`. It iterates
`fsProject.getSourceFiles()` and calls `this.classExtractor['extractClass'](classDecl, filePath)`
where `filePath = sourceFile.getFilePath()` is an **absolute** path (line 110).

Extractor APIs are `extract(code, filePath)` / `extractClass(decl, filePath)` etc.
The `filePath` parameter is used as-is in `id: name` today. The fix requires passing
`path.relative(rootDir, absoluteFilePath)` instead of the raw absolute path at every
extractor call site in `TypeScriptParser`.

`ParallelParser.parseFile(filePath)` creates `new TypeScriptParser()` (no args) and
calls `parser.parseCode(content, absoluteFilePath)`. For the `parseFiles()` path to
also produce scoped IDs, `ParallelParser` must know the workspace root so it can
relativize paths before calling `parseCode()`. Add `workspaceRoot?: string` to
`ParallelParserOptions`.

### Files changed

| File | Change |
|------|--------|
| `src/types/extensions.ts` | Add `TsAnalysis`, `TsModuleGraph`, `TsModuleNode`, `TsModuleDependency`, `TsModuleCycle`; add `tsAnalysis?` to `ArchJSONExtensions` |
| `src/parser/typescript-parser.ts` | Relativize `filePath` before every extractor call in both `parseCode()` and `parseProject()`; accept optional `workspaceRoot` in constructor |
| `src/parser/parallel-parser.ts` | Add `workspaceRoot?: string` to `ParallelParserOptions`; pass it to `new TypeScriptParser(workspaceRoot)` in `parseFile()` |
| `src/plugins/typescript/index.ts` | Pass `workspaceRoot` when constructing `ParallelParser` in `initialize()` (store from `parseProject()` args) |
| `tests/unit/parser/class-extractor.test.ts` | Tests for file-scoped entity IDs |
| `tests/unit/parser/interface-extractor.test.ts` | Tests for file-scoped entity IDs |
| `tests/unit/parser/typescript-parser.test.ts` | Tests for relative-path entity IDs from `parseCode()` with workspaceRoot |

### Stages

#### Stage A-0 — Prereq B: type definitions (no logic, type-check only)

Add TypeScript analysis extension types to `src/types/extensions.ts`:

```typescript
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;          // NEW
}

export interface TsAnalysis {
  version: string;                  // "1.0"
  moduleGraph?: TsModuleGraph;      // populated by P2 (Phase C)
}

export interface TsModuleGraph {
  nodes: TsModuleNode[];
  edges: TsModuleDependency[];
  cycles: TsModuleCycle[];
}

export interface TsModuleNode {
  id: string;           // project-root-relative directory, e.g. "src/cli"
  name: string;         // last path segment
  type: 'internal' | 'external' | 'node_modules';
  fileCount: number;
  stats: { classes: number; interfaces: number; functions: number; enums: number };
}

export interface TsModuleDependency {
  from: string;
  to: string;
  strength: number;       // count of distinct import statements
  importedNames: string[];
}

export interface TsModuleCycle {
  modules: string[];      // ordered module ids forming the cycle
  severity: 'warning' | 'error';
}
```

`npm run type-check` must pass before proceeding.

**Code budget**: ~45 lines added, zero removed.

#### Stage A-1 — Prereq A: failing tests for entity ID collision

Write tests that demonstrate the current incorrect behaviour.

In `class-extractor.test.ts`:
- Two calls with same class name `Config` but different `filePath` values
  (`src/cli/config.ts` and `src/parser/config.ts`) produce distinct IDs:
  `"src/cli/config.ts.Config"` vs `"src/parser/config.ts.Config"`.
- The `id` field starts with the file path prefix, not a bare name.

In `typescript-parser.test.ts`:
- `parseCode(code, '/project/src/cli/config.ts')` with `workspaceRoot = '/project'`
  produces entity with `id = "src/cli/config.ts.Config"` (not `"Config"`).
- `parseCode(code, '/project/src/cli/config.ts')` without `workspaceRoot` produces
  entity with `id` equal to the full absolute path + class name (acceptable fallback;
  stable and unique even if not portable).

Expected test count: 4–6. All must fail before the fix.

#### Stage A-2 — Prereq A: implement relative IDs in `TypeScriptParser`

Add optional `workspaceRoot` to `TypeScriptParser`:

```typescript
export class TypeScriptParser {
  constructor(private workspaceRoot?: string) {
    // ... existing constructor body unchanged
  }

  private toRelPath(absPath: string): string {
    if (this.workspaceRoot) {
      return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
    }
    return absPath;   // fallback: use absolute (still unique, not portable)
  }
}
```

In `parseCode(code, filePath)`, change every extractor call to pass
`this.toRelPath(filePath)`:

```typescript
// class-extractor call (line 53) — currently:
const entity = this.classExtractor['extractClass'](classDecl, filePath);
// change to:
const entity = this.classExtractor['extractClass'](classDecl, this.toRelPath(filePath));
```

Apply the same `this.toRelPath(filePath)` substitution for interface and enum extractor
calls in `parseCode()`. In `parseProject(rootDir)`, `rootDir` is already available —
set `this.workspaceRoot = rootDir` at the top of `parseProject()` (or prefer constructor
injection so `parseCode()` called from `ParallelParser` also benefits).

In `ParallelParser.parseFile()`:

```typescript
// Current (line 253):
const parser = new TypeScriptParser();
return parser.parseCode(content, filePath);

// Change to:
const parser = new TypeScriptParser(this.options.workspaceRoot);
return parser.parseCode(content, filePath);
```

And in `ParallelParserOptions`:

```typescript
export interface ParallelParserOptions {
  concurrency?: number;
  continueOnError?: boolean;
  workspaceRoot?: string;    // NEW — optional, non-breaking (defaults to undefined)
}
```

`TypeScriptPlugin.initialize()` must store `workspaceRoot` (captured from the first
`parseProject()` call or from plugin init config) and pass it to `ParallelParser`.

**Code budget**: `typescript-parser.ts` ~15 lines changed; `parallel-parser.ts` ~5 lines.

#### Stage A-3 — Full suite verification

```bash
npm run type-check
npm test -- --reporter=verbose
```

All Stage A-1 tests must now pass. Fix any existing tests that hard-coded bare-name
entity IDs in their assertions (update to scoped format). Total count must not decrease.

**Breaking change note**: ArchJSON entity IDs for TypeScript output change format.
The diagram renderer's entity lookups must be verified — search for `entity.id` and
`entity.name` comparisons in `src/mermaid/` and `src/cli/processors/`. The
`HeuristicGrouper` groups by inferred module path, not by ID, so it is unaffected.

### Acceptance criteria

- [ ] `npm run type-check` passes after Stage A-0.
- [ ] All entity ID collision tests pass (Stages A-1/A-2).
- [ ] Entity IDs in `ClassExtractor`, `InterfaceExtractor`, `EnumExtractor` output are
  `"<relPath>.<Name>"` format when `workspaceRoot` is provided.
- [ ] No changes to `relation-extractor.ts` or `mermaid/` in this phase.
- [ ] No existing tests regress.

---

## Phase B — Correctness Fixes (P1: Cross-File Resolution + P3: Function Extraction)

### Objectives

- **P1**: Resolve cross-file entity references after `parseProject()` — using ts-morph's
  import declaration API to build a per-file disambiguation map, then a post-merge repair
  pass in `TypeScriptParser.parseProject()`. Completeness score rises from 0.0 to ≥ 80.
- **P3**: Add `FunctionExtractor` for exported standalone functions; integrate into
  `TypeScriptParser.parseCode()`.

P1 and P3 touch different files; develop in parallel.

### Architectural clarification — two distinct code paths

There are two ways ArchGuard parses TypeScript:

| Path | Entry point | ts-morph Project | TypeChecker? | Cross-file resolution? |
|------|-------------|-----------------|--------------|------------------------|
| A | `TypeScriptParser.parseProject()` | Filesystem Project (one shared) | **Yes** | Yes — `import___` strings, import declarations |
| B | `ParallelParser.parseFiles()` → `parseCode()` per file | In-memory Project per file | **No** | No — bare names only |

**P1 applies only to Path A** (`parseProject()`). This is the path used by
`TypeScriptPlugin.parseProject()` when a single diagram covers many files. Path B is
used by `TypeScriptPlugin.parseFiles()` for the CLI's `--sources` multi-file mode.
P1 does not — and cannot — fix Path B without a larger architectural change (out of scope).

### Files changed

| File | Change |
|------|--------|
| `src/parser/typescript-parser.ts` | Add `resolveRelationTargets()` post-processing in `parseProject()`; add `filterExternalRelations()` |
| `src/parser/function-extractor.ts` | **New file** |
| `src/parser/typescript-parser.ts` | Add `FunctionExtractor` to `parseCode()` composition |
| `tests/unit/parser/typescript-parser.test.ts` | Tests for cross-file relation resolution |
| `tests/unit/parser/function-extractor.test.ts` | **New file** |

### Sub-stream P1 — Cross-File Type Reference Resolution

#### Why not decode `import___` strings

The `import___` prefix format encodes the absolute file path by replacing `/` with `_`.
This encoding is **lossy**: both `/` and `.` in filenames (e.g. `index.ts` →
`index_ts`) collapse to `_`, making the path unrecoverable. Attempting to reverse the
encoding would require heuristics with false positives.

The correct approach uses ts-morph's import resolution API, which is available in Path A
(`parseProject()`) because the filesystem Project has a TypeChecker. No string decoding
is needed.

#### Stage B-P1-1 — Failing tests for cross-file resolution

Write tests in `typescript-parser.test.ts` exercising `parseProject()` with two in-memory
source files (use a temp directory or ts-morph's `addSourceFilesFromArray` alternative).

Scenarios:

- File A (`src/types/index.ts`) exports `interface ArchJSON {}`.
- File B (`src/mermaid/generator.ts`) imports `ArchJSON` from `../types/index.ts` and
  references it in a class member.
- After `parseProject()`, the relation from `GeneratorClass` to `ArchJSON` has
  `target = "src/types/index.ts.ArchJSON"` (scoped), not `"ArchJSON"` (bare).
- A relation whose target is `"string"` is absent from the output (filtered).
- A relation whose target is `"NodeJS.ProcessEnv"` is absent.
- A relation to an unknown non-primitive remains (kept for diagnostics).

Expected test count: 5–7. All must fail before the fix.

#### Stage B-P1-2 — Implement `resolveRelationTargets()` in `parseProject()`

After collecting all entities and relations from all source files, add a post-processing
step in `TypeScriptParser.parseProject()`.

**Step 1**: Build a name-to-scopedId disambiguation map using import declarations.

For each source file in the filesystem Project:

```typescript
// For each source file that contributed relations:
const importedNameToScopedId = new Map<string, string>();
for (const importDecl of sourceFile.getImportDeclarations()) {
  const importedFile = importDecl.getModuleSpecifierSourceFile();
  if (!importedFile) continue;   // external / unresolved
  const relPath = this.toRelPath(importedFile.getFilePath());
  for (const named of importDecl.getNamedImports()) {
    importedNameToScopedId.set(named.getName(), `${relPath}.${named.getName()}`);
  }
}
```

This map resolves bare names to scoped IDs using the import graph that ts-morph has
already resolved — no string decoding required.

**Step 2**: Apply the map to relations.

Build a global `entityIds: Set<string>` from all scoped entity IDs produced after
Prereq A. For each relation:
- If `rel.to` (bare name) exists in `importedNameToScopedId` for the source file →
  replace with the scoped ID.
- If `rel.to` already matches an entity ID (scoped, from a same-file reference) → keep.
- Else → mark as unresolved.

This step is performed **per source file** while iterating, before the merge, so the
per-file import map is available.

**Step 3**: After merging all files, call `filterExternalRelations()`:

```typescript
private filterExternalRelations(merged: ArchJSON): ArchJSON {
  const entityIds = new Set(merged.entities.map(e => e.id));
  const EXTERNAL = [
    /^(string|number|boolean|void|null|undefined|any|unknown|never)$/,
    /^(NodeJS\.|Buffer|Error|Promise|Map|Set|Array|Record)/,
    /^\{/,
    /^\d+$/,
  ];
  merged.relations = merged.relations.filter(rel =>
    entityIds.has(rel.to) ||
    !EXTERNAL.some(p => p.test(rel.to))
  );
  return merged;
}
```

Call `filterExternalRelations()` at the end of `parseProject()` before returning.

**Code budget**: `resolveRelationTargets()` ~40 lines; `filterExternalRelations()` ~15 lines.

---

### Sub-stream P3 — Standalone Function Entity Extraction

#### Stage B-P3-1 — Failing tests for `FunctionExtractor`

Write tests in `tests/unit/parser/function-extractor.test.ts`:

- `export function foo(a: string): void {}` → entity with `id: "src/cli/foo.ts.foo"`,
  `name: "foo"`, `type: "function"`, `visibility: "public"`.
- `export const bar = (x: number) => x * 2` → one `function` entity.
- `export const baz = function(y: string) {}` → one `function` entity.
- Unexported `function internal() {}` → **no** entity.
- Unexported `const hidden = () => {}` → **no** entity.
- Mixed file: only exported functions appear.
- Function with parameters: `members` array has correct entries.

Expected test count: 7–9. All must fail before implementation.

#### Stage B-P3-2 — Implement `FunctionExtractor`

Create `src/parser/function-extractor.ts`:

```typescript
import { Node, type SourceFile } from 'ts-morph';
import type { Entity } from '@/types/index.js';

export class FunctionExtractor {
  extract(sourceFile: SourceFile, relativeFilePath: string): Entity[] {
    const entities: Entity[] = [];

    // Named exported function declarations
    for (const fn of sourceFile.getFunctions()) {
      if (!fn.isExported()) continue;
      const name = fn.getName();
      if (!name) continue;
      entities.push({
        id: `${relativeFilePath}.${name}`,
        name,
        type: 'function',
        visibility: 'public',
        members: fn.getParameters().map(p => ({
          name: p.getName(),
          type: p.getType().getText(),
          visibility: 'public',
        })),
        sourceLocation: {
          file: relativeFilePath,
          startLine: fn.getStartLineNumber(),
          endLine: fn.getEndLineNumber(),
        },
      });
    }

    // Arrow / function-expression const exports
    for (const stmt of sourceFile.getVariableStatements()) {
      if (!stmt.isExported()) continue;
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          const name = decl.getName();
          entities.push({
            id: `${relativeFilePath}.${name}`,
            name,
            type: 'function',
            visibility: 'public',
            members: init.getParameters().map(p => ({
              name: p.getName(),
              type: p.getType().getText(),
              visibility: 'public',
            })),
            sourceLocation: {
              file: relativeFilePath,
              startLine: decl.getStartLineNumber(),
              endLine: decl.getEndLineNumber(),
            },
          });
        }
      }
    }

    return entities;
  }
}
```

**Note**: `type: 'function'` is already a valid `EntityType` in `src/types/index.ts` —
no schema change needed. Verify `Member` shape matches the existing type (check
`src/types/index.ts` `Member` interface before writing tests).

**Code budget**: ~55 lines.

#### Stage B-P3-3 — Integrate into `TypeScriptParser.parseCode()`

`FunctionExtractor` requires a `SourceFile` (ts-morph) and the relative file path.
In `parseCode()`, the in-memory `sourceFile` is already constructed. Add after enum
extraction:

```typescript
// typescript-parser.ts — inside parseCode()
const functionExtractor = new FunctionExtractor();
entities.push(...functionExtractor.extract(sourceFile, this.toRelPath(filePath)));
```

Also integrate into the `parseProject()` loop (same pattern):

```typescript
// Inside the fsProject.getSourceFiles() loop:
entities.push(...functionExtractor.extract(sourceFile, this.toRelPath(filePath)));
```

---

#### Stage B-final — Combined verification

```bash
npm run build
npm run type-check
npm test -- --reporter=verbose
node dist/cli/index.js analyze -s ./src --output-dir .archguard -v
```

Inspect `all-classes` completeness score (target: ≥ 80). Verify `normalizeToDiagrams`,
`filterDiagrams`, `createAnalyzeCommand` appear as entities in `method/cli-module`.
Undefined entity count for internal types should be near zero.

### Acceptance criteria

- [ ] All cross-file resolution tests pass (B-P1).
- [ ] All `FunctionExtractor` tests pass (B-P3).
- [ ] Completeness score on `all-classes` rises from 0.0 to ≥ 80.
- [ ] Standalone CLI functions appear as entities in `method/cli-module` diagram.
- [ ] P1 fix is scoped to `parseProject()` only — no changes to `ParallelParser` or
  in-memory path; this is documented clearly in code comments.
- [ ] `npm run type-check` passes with zero errors.
- [ ] No previously passing tests regress.

---

## Phase C — Import-Based Module Dependency Graph (P2)

### Objectives

- Build a `TsModuleGraph` using ts-morph's import declaration API (no second parse).
- Orchestrate through a new `TypeScriptAnalyzer` layer.
- Attach result to `extensions.tsAnalysis.moduleGraph` in `TypeScriptPlugin.parseProject()`.
- Route rendering in `DiagramProcessor.generateOutput()` (parallel to Go Atlas routing);
  implement `renderTsModuleGraph()` in a new dedicated renderer file.

### Architectural decision — how `TypeScriptAnalyzer` gets `SourceFile[]`

`TypeScriptPlugin` has no `this.project` (ts-morph `Project`) field today. The filesystem
Project is created inside `TypeScriptParser.parseProject()` and not exposed externally.
`ModuleGraphBuilder` needs ts-morph `SourceFile[]` to access import declarations.

**Chosen approach**: `TypeScriptPlugin` creates and owns a ts-morph `Project` in a new
`initTsProject(workspaceRoot, pattern)` helper, called from `parseProject()`. The same
Project instance is passed to both `TypeScriptParser` (replacing the internal one) and
`TypeScriptAnalyzer`. This avoids a duplicate parse pass.

This requires `TypeScriptParser.parseProject()` to accept an optional external `Project`:

```typescript
// typescript-parser.ts
parseProject(rootDir: string, pattern: string, project?: Project): ArchJSON {
  const fsProject = project ?? new Project({ ... });
  if (!project) {
    fsProject.addSourceFilesAtPaths([...]);
  }
  // ... rest unchanged
}
```

And in `TypeScriptPlugin.parseProject()`:

```typescript
async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
  const pattern = config.filePattern ?? '**/*.ts';
  const tsProject = this.initTsProject(workspaceRoot, pattern);   // new
  const archJson = this.parser.parseProject(workspaceRoot, pattern, tsProject);
  const tsAnalysis = await this.analyzer.analyze(workspaceRoot, tsProject.getSourceFiles());
  return { ...archJson, extensions: { ...archJson.extensions, tsAnalysis } };
}
```

### Files changed

| File | Change |
|------|--------|
| `src/parser/typescript-parser.ts` | Accept optional external `Project` in `parseProject()` |
| `src/plugins/typescript/builders/module-graph-builder.ts` | **New file** |
| `src/plugins/typescript/typescript-analyzer.ts` | **New file** |
| `src/plugins/typescript/index.ts` | Add `initTsProject()`; instantiate `TypeScriptAnalyzer`; attach `extensions.tsAnalysis` |
| `src/cli/processors/diagram-processor.ts` | Add TypeScript module graph routing branch in `generateOutput()` |
| `src/mermaid/ts-module-graph-renderer.ts` | **New file** — `renderTsModuleGraph()` |
| `tests/plugins/typescript/builders/module-graph-builder.test.ts` | **New file** |
| `tests/plugins/typescript/typescript-analyzer.test.ts` | **New file** |

### Stages

#### Stage C-1 — `ModuleGraphBuilder` (tests first)

Tests use ts-morph `Project` with in-memory source files (`project.createSourceFile()`).

Scenarios:

- Two in-memory files: `src/cli/index.ts` imports from `src/parser/index.ts` →
  two module nodes, one edge with `strength: 1`.
- Two files in `src/cli/` both importing from `src/types/` → single edge with
  `strength: 2`, `importedNames` lists all distinct names.
- Import from `node_modules` (`import path from 'path'`) → external module node with
  `type: 'node_modules'`; edge recorded; external node not expanded.
- Cycle: `src/a/` imports `src/b/` and `src/b/` imports `src/a/` → one entry in
  `cycles`, `severity: 'warning'` (2-module cycle).
- `stats.classes` on a module node equals the count of class entities in that module
  (use the entity list to determine membership via path prefix, after Prereq A IDs).
- No imports → nodes only, empty `edges` and `cycles`.

Expected test count: 8–12. All must fail before implementation.

**Implementation** of `ModuleGraphBuilder`:

```typescript
// src/plugins/typescript/builders/module-graph-builder.ts
import { type SourceFile } from 'ts-morph';
import type { TsModuleGraph, TsModuleNode, TsModuleDependency, TsModuleCycle } from '@/types/extensions.js';
import type { Entity } from '@/types/index.js';
import path from 'node:path';

export class ModuleGraphBuilder {
  build(projectRoot: string, sourceFiles: SourceFile[], entities: Entity[]): TsModuleGraph {
    // 1. Assign each file to its module directory (project-root-relative)
    // 2. Iterate getImportDeclarations() per file; resolve with getModuleSpecifierSourceFile()
    // 3. Aggregate (from, to) edges; track importedNames; accumulate strength
    // 4. DFS cycle detection across module graph
    // 5. Build node stats from entities whose id prefix matches the module path
  }
}
```

`getModuleSpecifierSourceFile()` returns `undefined` for node_modules — classify those
as `type: 'node_modules'`.

**Code budget**: ~120 lines.

#### Stage C-2 — `TypeScriptAnalyzer` orchestration layer

```typescript
// src/plugins/typescript/typescript-analyzer.ts
import { type SourceFile } from 'ts-morph';
import type { TsAnalysis } from '@/types/extensions.js';
import type { Entity } from '@/types/index.js';
import { ModuleGraphBuilder } from './builders/module-graph-builder.js';

export class TypeScriptAnalyzer {
  private moduleGraphBuilder = new ModuleGraphBuilder();

  async analyze(projectRoot: string, sourceFiles: SourceFile[], entities: Entity[]): Promise<TsAnalysis> {
    const moduleGraph = this.moduleGraphBuilder.build(projectRoot, sourceFiles, entities);
    return { version: '1.0', moduleGraph };
  }
}
```

Write one integration test: two in-memory source files with an import relationship →
`analyze()` returns `TsAnalysis` with a non-empty `moduleGraph`.

**Code budget**: ~25 lines.

#### Stage C-3 — Plugin integration

Add to `TypeScriptPlugin`:

```typescript
// src/plugins/typescript/index.ts

private analyzer = new TypeScriptAnalyzer();
private tsProject: Project | null = null;

private initTsProject(workspaceRoot: string, pattern: string): Project {
  const project = new Project({ compilerOptions: { target: 99 } });
  project.addSourceFilesAtPaths([
    `${workspaceRoot}/${pattern}`,
    `!${workspaceRoot}/**/*.test.ts`,
    `!${workspaceRoot}/**/*.spec.ts`,
    `!${workspaceRoot}/**/node_modules/**`,
  ]);
  return project;
}

async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
  this.ensureInitialized();
  const pattern = config.filePattern ?? '**/*.ts';
  const tsProject = this.initTsProject(workspaceRoot, pattern);
  const archJson = this.parser.parseProject(workspaceRoot, pattern, tsProject);
  const tsAnalysis = await this.analyzer.analyze(workspaceRoot, tsProject.getSourceFiles(), archJson.entities);
  return { ...archJson, extensions: { ...archJson.extensions, tsAnalysis } };
}
```

Verify `--format json` output includes `extensions.tsAnalysis.moduleGraph`.

**Code budget**: ~30 lines changed in `index.ts`; ~8 lines changed in `typescript-parser.ts`.

#### Stage C-4 — Renderer: new routing in `DiagramProcessor` + dedicated renderer

**Where the branch must go**: `DiagramProcessor.generateOutput()` (line 548+) currently
has one routing branch: `if (archJSON.extensions?.goAtlas)`. Add a parallel branch for
TypeScript module graph **before** the default Mermaid path:

```typescript
// src/cli/processors/diagram-processor.ts — inside generateOutput()
case 'mermaid':
  if (archJSON.extensions?.goAtlas) {
    await this.generateAtlasOutput(archJSON, paths, diagram);
  } else if (level === 'package' && archJSON.extensions?.tsAnalysis?.moduleGraph) {
    // NEW: TypeScript module dependency graph
    await this.generateTsModuleGraphOutput(archJSON, paths, diagram);
  } else {
    const mermaidGenerator = new MermaidDiagramGenerator(this.globalConfig);
    await mermaidGenerator.generateAndRender(archJson, ...);
  }
  break;
```

**Do NOT modify `ValidatedMermaidGenerator` in `generator.ts`** for this routing —
it is an inner code-generation layer, not a routing layer. Routing belongs in
`diagram-processor.ts` (same pattern as Go Atlas).

Implement `generateTsModuleGraphOutput()` in `DiagramProcessor` (similar to
`generateAtlasOutput()`). The actual Mermaid code generation lives in a new dedicated
file `src/mermaid/ts-module-graph-renderer.ts`:

```typescript
// src/mermaid/ts-module-graph-renderer.ts
export function renderTsModuleGraph(graph: TsModuleGraph): string {
  // flowchart LR
  // One node per internal TsModuleNode
  // Edges with linkStyle stroke-width proportional to strength (3-tier: thin/medium/thick)
  // Cycle edges with distinct color
}
```

Write tests for `renderTsModuleGraph()` with a manually constructed `TsModuleGraph`
fixture — no dependency on the builder:

- Two nodes, one edge with `strength: 1` → standard thin arrow
- Edge with `strength: 10` → thick arrow
- Cycle edge → distinct color marker present in output
- External node_modules node → visually distinct (dashed border)

Expected test count: 5–8.

**Code budget**: `ts-module-graph-renderer.ts` ~70 lines; `diagram-processor.ts` ~25 lines added.

#### Stage C-final — Self-analysis smoke test

```bash
npm run build
node dist/cli/index.js analyze -s ./src -l package -n overview --output-dir .archguard -v
```

`overview/package` must contain more than 7 nodes. Edges must be present.

### Acceptance criteria

- [ ] All `ModuleGraphBuilder` tests pass.
- [ ] `TypeScriptAnalyzer` integration test passes.
- [ ] `--format json` output includes `extensions.tsAnalysis.moduleGraph`.
- [ ] `overview/package` grows from 7 nodes to ≥ 10.
- [ ] Routing in `diagram-processor.ts` — not in `generator.ts` or `diagram-generator.ts`.
- [ ] Go, Java, Python diagrams unaffected (existing Mermaid path unchanged).
- [ ] `npm run type-check` passes.
- [ ] No previously passing tests regress.

---

## Phase D — Parse-Time Deduplication (P4)

### Performance root cause

`ParallelParser.parseFile()` creates `new TypeScriptParser()` per file (line 253).
`TypeScriptParser`'s constructor creates **4 separate in-memory ts-morph `Project`
instances** (one per extractor: ClassExtractor, InterfaceExtractor, EnumExtractor,
RelationExtractor). For 222 files: **222 × 5 ts-morph Projects instantiated per
`parseFiles()` call**. This is the dominant cost.

`DiagramProcessor.processAll()` already groups diagrams by source-set hash
(`processSourceGroup()`) and shares one `parseFiles()` call per unique source set
within a single `analyze` invocation. Diagrams with **identical** source sets are not
re-parsed. However, diagrams with **overlapping but non-identical** source sets (e.g.
`./src` vs `./src/cli`) each trigger independent `parseFiles()` calls that re-parse
shared files.

`ParseCache` (P4) eliminates redundant per-file `TypeScriptParser` instantiation for
files that appear in multiple overlapping source sets. It also benefits cold-start runs
where the same file appears in multiple source groups.

Note: `DiagramProcessor.processAll()` has no `process(diagram, options)` API. `ParseCache`
must be injected via `DiagramProcessorOptions` (the constructor), not via a per-call argument.

### Files changed

| File | Change |
|------|--------|
| `src/parser/parse-cache.ts` | **New file** — `ParseCache` |
| `src/parser/parallel-parser.ts` | Add `parseCache?: ParseCache` to `ParallelParserOptions`; use in `parseFile()` |
| `src/cli/processors/diagram-processor.ts` | Add `parseCache?: ParseCache` to `DiagramProcessorOptions`; pass to `ParallelParser` options |
| `src/cli/commands/analyze.ts` | Create one `ParseCache` per `analyze` invocation; pass via `DiagramProcessorOptions` |
| `tests/unit/parser/parse-cache.test.ts` | **New file** |

### Stages

#### Stage D-1 — `ParseCache` (tests first)

Write tests in `tests/unit/parser/parse-cache.test.ts`:

- Cache miss: first call invokes `parseFn`, returns result.
- Cache hit: second call with same `(filePath, content)` returns cached result without
  calling `parseFn`.
- Key includes both `filePath` and `content`: same content + different path → miss.
- Key includes both: same path + different content → miss.
- Empty content string works correctly.
- Multiple independent entries coexist.
- `size` getter reflects cache entry count.

Expected test count: 7. All must fail before implementation.

**Implementation**:

```typescript
// src/parser/parse-cache.ts
import crypto from 'node:crypto';
import type { ArchJSON } from '@/types/index.js';

export class ParseCache {
  private cache = new Map<string, ArchJSON>();

  getOrParse(
    filePath: string,
    content: string,
    parse: () => ArchJSON
  ): ArchJSON {
    const key = crypto.createHash('sha256')
      .update(filePath).update('\0').update(content)
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const result = parse();
    this.cache.set(key, result);
    return result;
  }

  get size(): number { return this.cache.size; }
  clear(): void { this.cache.clear(); }
}
```

The per-file result type is `ArchJSON` — confirmed: `ParallelParser.parseFile()` returns
`Promise<ArchJSON>` (the full structure per file, before merging).

**Code budget**: ~30 lines.

#### Stage D-2 — Integrate cache into `ParallelParser`

Extend `ParallelParserOptions`:

```typescript
export interface ParallelParserOptions {
  concurrency?: number;
  continueOnError?: boolean;
  workspaceRoot?: string;     // added in Phase A
  parseCache?: ParseCache;    // NEW — optional, non-breaking
}
```

In `parseFile()`:

```typescript
// parallel-parser.ts — current line 253 area:
const parser = new TypeScriptParser(this.options.workspaceRoot);
return parser.parseCode(content, filePath);

// Change to:
if (this.options.parseCache) {
  return this.options.parseCache.getOrParse(filePath, content, () => {
    const parser = new TypeScriptParser(this.options.workspaceRoot);
    return parser.parseCode(content, filePath);
  });
}
const parser = new TypeScriptParser(this.options.workspaceRoot);
return parser.parseCode(content, filePath);
```

**Code budget**: ~10 lines.

#### Stage D-3 — Thread `ParseCache` through `DiagramProcessorOptions`

In `DiagramProcessorOptions`:

```typescript
// diagram-processor.ts — extend existing options interface
export interface DiagramProcessorOptions {
  diagrams: DiagramConfig[];
  globalConfig: GlobalConfig;
  progress: ProgressReporter;
  parseCache?: ParseCache;    // NEW — optional
}
```

`DiagramProcessor` stores `this.parseCache = options.parseCache` and passes it to
`ParallelParser` options in `processSourceGroup()`.

In `src/cli/commands/analyze.ts`, inside `analyzeCommandHandler()` before constructing
`DiagramProcessor`:

```typescript
import { ParseCache } from '@/parser/parse-cache.js';

const parseCache = new ParseCache();
const processor = new DiagramProcessor({
  diagrams,
  globalConfig,
  progress,
  parseCache,        // NEW
});
await processor.processAll();
```

**Code budget**: ~15 lines across both files.

#### Stage D-final — Performance smoke test

```bash
npm run build
time node dist/cli/index.js analyze -v   # uses archguard.config.json
```

Target: parse time reduction ≥ 2× vs Phase B baseline for multi-diagram configs with
overlapping source sets. If the config generates only one diagram, create a test config
with 3 diagrams pointing to overlapping subsets of `./src`.

Verify output correctness:

```bash
node dist/cli/index.js analyze -f json --no-cache -o /tmp/arch-fresh.json
node dist/cli/index.js analyze -f json -o /tmp/arch-cached.json
diff /tmp/arch-fresh.json /tmp/arch-cached.json
```

Diff must be empty (excluding timestamp fields).

### Acceptance criteria

- [ ] All `ParseCache` unit tests pass.
- [ ] `DiagramProcessorOptions.parseCache` accepted without TypeScript errors.
- [ ] `ParseCache.size > 0` after a multi-diagram run with overlapping source sets.
- [ ] ArchJSON output identical between cached and uncached runs.
- [ ] Parse time drops ≥ 2× for overlapping multi-diagram config.
- [ ] `CacheManager` (disk cache) unaffected — no changes to its interface.
- [ ] No previously passing tests regress.

---

## Cross-Phase Constraints

### ADR-002 backwards compatibility

All `extensions.ts` changes are new optional fields. No field removed or renamed.
JSON consumers reading payloads without `tsAnalysis` receive `undefined` and must treat
it as absent analysis.

### `parseProject()` vs `parseFiles()` scope

P1 (cross-file resolution) applies only to `TypeScriptParser.parseProject()` (Path A).
The in-memory per-file path (`ParallelParser.parseFiles()` → Path B) does not gain
cross-file resolution in this plan. This is a known limitation, documented in code
comments at the entry points of both paths.

### Renderer routing

All new rendering branches are added in `DiagramProcessor.generateOutput()`, following
the same gate pattern as Go Atlas (`if extensions?.goAtlas`). Neither `generator.ts`
(ValidatedMermaidGenerator) nor `diagram-generator.ts` (MermaidDiagramGenerator) is
the routing layer — they are invoked only after routing has decided.

### Running the full suite

```bash
npm test
```

Expected: ≥ 1308 passing at every phase boundary.

---

## Dependency Graph

```
Phase A  (no deps — must land first)
    A-0  (Prereq B: extension types — type-check only)
    A-1  (Prereq A: failing tests)
    A-2  (Prereq A: workspaceRoot in TypeScriptParser + ParallelParser)
    A-3  (full suite verification)
    └── unblocks Phase B and Phase C

Phase B  (blocked by Phase A)
    ├── B-P1  (cross-file resolution in parseProject() only)
    │     B-P1-1  (failing tests — resolveRelationTargets)
    │     B-P1-2  (implementation using import declaration API)
    └── B-P3  (function extraction)           ← parallel with B-P1
          B-P3-1  (failing tests)
          B-P3-2  (FunctionExtractor)
          B-P3-3  (integrate into parseCode + parseProject loops)
    └── unblocks Phase C and Phase D

Phase C  (blocked by Phase B)
    C-1  (ModuleGraphBuilder — tests first)
    C-2  (TypeScriptAnalyzer)
    C-3  (TypeScriptPlugin integration + TypeScriptParser.parseProject() externalized Project)
    C-4  (DiagramProcessor routing + ts-module-graph-renderer.ts)

Phase D  (blocked by Phase B; independent of Phase C)
    D-1  (ParseCache — tests first)
    D-2  (ParallelParser cache integration)
    D-3  (DiagramProcessorOptions + analyze.ts)

Phase C and Phase D are independent — develop in parallel after Phase B.
```

---

## File Change Summary

| File | Phase A | Phase B (P1) | Phase B (P3) | Phase C | Phase D |
|------|---------|--------------|--------------|---------|---------|
| `src/types/extensions.ts` | A-0 | — | — | — | — |
| `src/parser/typescript-parser.ts` | A-2 | B-P1-2 | B-P3-3 | C-3 | — |
| `src/parser/parallel-parser.ts` | A-2 | — | — | — | D-2 |
| `src/parser/function-extractor.ts` | — | — | B-P3-2 (new) | — | — |
| `src/parser/parse-cache.ts` | — | — | — | — | D-1 (new) |
| `src/plugins/typescript/index.ts` | A-2 (workspaceRoot) | — | — | C-3 | — |
| `src/plugins/typescript/builders/module-graph-builder.ts` | — | — | — | C-1 (new) | — |
| `src/plugins/typescript/typescript-analyzer.ts` | — | — | — | C-2 (new) | — |
| `src/mermaid/ts-module-graph-renderer.ts` | — | — | — | C-4 (new) | — |
| `src/cli/processors/diagram-processor.ts` | — | — | — | C-4 | D-3 |
| `src/cli/commands/analyze.ts` | — | — | — | — | D-3 |
| `tests/unit/parser/class-extractor.test.ts` | A-1 | — | — | — | — |
| `tests/unit/parser/interface-extractor.test.ts` | A-1 | — | — | — | — |
| `tests/unit/parser/typescript-parser.test.ts` | A-1/A-2 | B-P1-1 | B-P3-3 | — | — |
| `tests/unit/parser/function-extractor.test.ts` | — | — | B-P3-1 (new) | — | — |
| `tests/unit/parser/parse-cache.test.ts` | — | — | — | — | D-1 (new) |
| `tests/plugins/typescript/builders/module-graph-builder.test.ts` | — | — | — | C-1 (new) | — |
| `tests/plugins/typescript/typescript-analyzer.test.ts` | — | — | — | C-2 (new) | — |
