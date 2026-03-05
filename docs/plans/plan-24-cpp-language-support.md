# Plan 24: C++ Language Support — Development Plan

> Source proposal: `docs/proposals/proposal-cpp-language-support.md`
> Branch: `feat/cpp`
> Status: Draft

---

## Overview

Three phases. Phase A is the largest and must land first. Phase B depends on Phase A's
`RawCppFile.includes[]` contract. Phase C is standalone-optional.

| Phase | Scope | New files | Modified files | Dependency |
|-------|-------|-----------|----------------|------------|
| Phase A | Core parsing + DiagramProcessor integration | 7 | 5 | None |
| Phase B | Namespace graph + extensions slot + rendering route | 2 | 3 | Phase A complete |
| Phase C | clangd LSP semantic enhancement | 2 | 4 | Phase A complete |

**Recommended landing order**: A → B → C. Each phase passes `npm test` independently.

---

## Pre-flight

```bash
npm test
# Expected: 1953 tests, 0 failures

npm run type-check
# Expected: 0 errors

grep -n "SupportedLanguage" src/types/index.ts
# Expected line 38: 'typescript' | 'go' | 'java' | 'python' | 'rust'

grep -n "DETECTION_RULES" src/core/plugin-registry.ts
# Expected: 8 rules, last entry is { file: 'setup.py', plugin: 'python' }

grep -n "language === 'go'" src/cli/processors/diagram-processor.ts
# Expected: line ~432, inside processSourceGroup()
```

---

## Phase A — Core Parsing + DiagramProcessor Integration

### Objectives

1. Define intermediate types in `src/plugins/cpp/types.ts`
2. Implement `TreeSitterBridge`, `ClassBuilder`, `HeaderMerger`, `ArchJsonMapper`, `DependencyExtractor`, `CppPlugin`
3. Extend `SupportedLanguage` and `PluginRegistry.DETECTION_RULES`
4. Wire `language === 'cpp'` into `DiagramProcessor.processSourceGroup()` and `generateOutput()`
5. Wire `normalizeToDiagrams()` in `analyze.ts` to produce a C++ diagram from `--lang cpp`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/plugins/cpp/types.ts` | Create | `RawCppFile`, `RawClass`, `MergedCppEntity`, `CppRawData` |
| `src/plugins/cpp/tree-sitter-bridge.ts` | Create | `TreeSitterBridge.parseCode()` — 6 node-type extractors |
| `src/plugins/cpp/builders/class-builder.ts` | Create | Member extraction from class/struct body nodes |
| `src/plugins/cpp/builders/header-merger.ts` | Create | `.h`/`.cpp` merge on `qualifiedName` key |
| `src/plugins/cpp/archjson-mapper.ts` | Create | `MergedCppEntity[]` → `Entity[]` + `Relation[]` |
| `src/plugins/cpp/dependency-extractor.ts` | Create | `IDependencyExtractor` stub for CMake/vcpkg |
| `src/plugins/cpp/index.ts` | Create | `CppPlugin implements ILanguagePlugin` |
| `src/types/index.ts` | Modify | `SupportedLanguage` += `'cpp'` |
| `src/core/interfaces/dependency.ts` | Modify | `DependencyType` += `'cmake'` |
| `src/core/plugin-registry.ts` | Modify | `DETECTION_RULES` += CMakeLists.txt / Makefile |
| `src/cli/commands/analyze.ts` | Modify | C++ path in `normalizeToDiagrams()` |
| `src/cli/processors/diagram-processor.ts` | Modify | `parseCppProject()` + branch in `processSourceGroup()` |

### Stage A-1 — Verify baseline

```bash
npm test
# Must show: 0 failures

# Confirm the two routing branch locations we will later modify:
grep -n "language === 'go'" src/cli/processors/diagram-processor.ts
# Expected: ~line 432 (processSourceGroup) AND ~line 686 (parseGoProject)

grep -n "goAtlas\|tsAnalysis" src/cli/processors/diagram-processor.ts
# Expected: ~line 754-756 (generateOutput switch)
```

### Stage A-2 — Intermediate types (`src/plugins/cpp/types.ts`)

```typescript
export interface RawField {
  name: string;
  fieldType: string;         // raw type string, e.g. "std::string", "int*"
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
}

export interface RawMethod {
  name: string;
  returnType: string;
  parameters: Array<{ name: string; type: string }>;
  visibility: 'public' | 'private' | 'protected';
  isVirtual: boolean;
  isStatic: boolean;
  isPure: boolean;           // = 0 pure virtual
  isConst: boolean;
  sourceFile: string;
  startLine: number;
}

export interface RawClass {
  name: string;
  qualifiedName: string;     // "ns::SubNs::ClassName" or "ClassName" (global)
  kind: 'class' | 'struct';
  bases: Array<{ name: string; access: 'public' | 'private' | 'protected' }>;
  fields: RawField[];
  methods: RawMethod[];
  templateParams?: string[]; // ["T", "U"] from template<typename T, typename U>
  sourceFile: string;
  startLine: number;
  endLine: number;
}

export interface RawEnum {
  name: string;
  qualifiedName: string;
  isScoped: boolean;         // enum class vs plain enum
  members: string[];
  sourceFile: string;
  startLine: number;
  endLine: number;
}

export interface RawFunction {
  name: string;
  qualifiedName: string;
  returnType: string;
  parameters: Array<{ name: string; type: string }>;
  isStatic: boolean;
  sourceFile: string;
  startLine: number;
  endLine: number;
}

export interface RawCppFile {
  filePath: string;
  namespace: string;         // outermost namespace ("" = global scope)
  classes: RawClass[];
  enums: RawEnum[];
  functions: RawFunction[];  // top-level / free functions only
  includes: string[];        // raw #include paths — feeds NamespaceGraphBuilder only
}

/** After HeaderMerger — one logical entity per .h/.cpp pair */
export interface MergedCppEntity extends RawClass {
  declarationFile: string;   // .h/.hpp (primary source location)
  implementationFile?: string;
}

export interface CppRawData {
  files: RawCppFile[];
  moduleRoot: string;
}
```

### Stage A-3 — Schema changes

**`src/types/index.ts` line 38**:

```typescript
// Before:
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust';
// After:
export type SupportedLanguage = 'typescript' | 'go' | 'java' | 'python' | 'rust' | 'cpp';
```

**`src/core/interfaces/dependency.ts` line 8**:

```typescript
// Before:
export type DependencyType = 'npm' | 'gomod' | 'pip' | 'maven' | 'cargo';
// After:
export type DependencyType = 'npm' | 'gomod' | 'pip' | 'maven' | 'cargo' | 'cmake';
```

**`src/core/plugin-registry.ts` `DETECTION_RULES` array (append after `setup.py`)**:

```typescript
{ file: 'CMakeLists.txt', plugin: 'cpp' },
{ file: 'Makefile',       plugin: 'cpp' },   // last — Makefile exists in many non-C++ projects
```

### Stage A-4 — `TreeSitterBridge` (`src/plugins/cpp/tree-sitter-bridge.ts`)

Add to `package.json` devDependencies (also `dependencies` — runtime need):

```json
"tree-sitter": "^0.21.0",
"tree-sitter-cpp": "^0.22.0"
```

Method name must be `parseCode` to match the pattern in Go/Java plugins:

```typescript
import Parser from 'tree-sitter';
import Cpp from 'tree-sitter-cpp';
import { ClassBuilder } from './builders/class-builder.js';
import type { RawCppFile, RawClass, RawEnum, RawFunction } from './types.js';

export class TreeSitterBridge {
  private parser: Parser;
  private classBuilder: ClassBuilder;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Cpp);
    this.classBuilder = new ClassBuilder();
  }

  parseCode(code: string, filePath: string): RawCppFile {
    const tree = this.parser.parse(code);
    const root = tree.rootNode;
    return {
      filePath,
      namespace:  this.extractTopLevelNamespace(root),
      classes:    this.extractClasses(root, filePath),
      enums:      this.extractEnums(root),
      functions:  this.extractTopLevelFunctions(root, filePath),
      includes:   this.extractIncludes(root),
    };
  }
}
```

**Tree-sitter node types** (`tree-sitter-cpp` grammar):

| Target | Node type | Notes |
|--------|-----------|-------|
| Class definition | `class_specifier` | name = `name` field child |
| Struct definition | `struct_specifier` | treated as kind: 'struct' |
| Inheritance | `base_class_clause` | children are `type_identifier` nodes |
| Function definition | `function_definition` | top-level only (not inside class body) |
| Namespace | `namespace_definition` | name = `name` field child |
| `#include` | `preproc_include` | path = first named child `.text` |
| Enum | `enum_specifier` | `enum class` detected via `scoped` field |
| Template | `template_declaration` | wraps a `class_specifier`; params from `type_parameter_declaration` children |

Qualified method definitions (`Foo::doWork`) are `function_definition` nodes whose
declarator contains a `qualified_identifier`. These become **orphaned methods** attached
during `HeaderMerger.merge()` — same pattern as Go's `orphanedMethods`.

### Stage A-5 — `ClassBuilder` (`src/plugins/cpp/builders/class-builder.ts`)

Extracts `fields[]` and `methods[]` from a class/struct body node:

```typescript
export class ClassBuilder {
  extractMembers(
    bodyNode: Parser.SyntaxNode,
    sourceFile: string
  ): { fields: RawField[]; methods: RawMethod[] }

  private currentVisibility(node: Parser.SyntaxNode): 'public' | 'private' | 'protected'
  // Tracks access_specifier nodes ('public:', 'private:', 'protected:') as cursor moves
  // Default: 'private' for class, 'public' for struct
}
```

### Stage A-6 — `HeaderMerger` (`src/plugins/cpp/builders/header-merger.ts`)

Merge key is `qualifiedName` (includes namespace prefix), ensuring `ns1::Foo ≠ ns2::Foo`.
Orphaned qualified methods (`Foo::doWork` from `.cpp`) are re-attached to the matching
header entity by `qualifiedName` of the receiver — identical to Go's orphaned method logic.

```typescript
export class HeaderMerger {
  merge(files: RawCppFile[]): MergedCppEntity[]

  private mergeKey(cls: RawClass): string { return cls.qualifiedName || cls.name; }
  private isHeader(fp: string): boolean {
    return ['.h', '.hpp', '.hxx', '.h++'].includes(path.extname(fp).toLowerCase());
  }
}
```

Merge rules:
- Declaration wins for `bases[]`, `fields[]`, `sourceLocation`
- Method list is union deduplicated by `name + parameters.length`
- Impl-only classes (no header pair) are included as-is with `declarationFile = sourceFile`

### Stage A-7 — `ArchJsonMapper` (`src/plugins/cpp/archjson-mapper.ts`)

Use the shared utilities from `src/plugins/shared/mapper-utils.ts`:

```typescript
import { generateEntityId, createRelation } from '@/plugins/shared/mapper-utils.js';
```

**Entity ID format** — use `generateEntityId(namespace, qualifiedName)`, consistent with
Go plugin's `generateEntityId(packageName, struct.name)` pattern:

```typescript
// e.g. generateEntityId('engine', 'engine::Renderer') → 'engine.engine::Renderer'
// For global-scope entity: generateEntityId('', 'Foo') → '.Foo'
// Prefer directory-based namespace when qualifiedName has no '::':
const ns = entity.qualifiedName.includes('::')
  ? entity.qualifiedName.split('::')[0]
  : path.relative(workspaceRoot, path.dirname(entity.declarationFile));
const id = generateEntityId(ns, entity.qualifiedName);
```

**Relation creation** — use `createRelation(type, source, target)` which sets
`id = source_type_target`:

```typescript
// inheritance
createRelation('inheritance', entityId, resolvedBaseId)
// composition (member field whose type resolves to a known entity)
createRelation('composition', entityId, fieldTypeEntityId)
```

Unresolved base names (type not in `allEntities`) → **skip the relation** (no dangling target).
Set `inferenceSource: 'explicit'` for inheritance, `'inferred'` for field-type composition.

### Stage A-8 — `DependencyExtractor` (`src/plugins/cpp/dependency-extractor.ts`)

Minimal stub that compiles and satisfies the interface:

```typescript
import type { IDependencyExtractor, Dependency } from '@/core/interfaces/dependency.js';

export class DependencyExtractor implements IDependencyExtractor {
  async extractDependencies(workspaceRoot: string): Promise<Dependency[]> {
    // Stub: attempt to parse find_package() from CMakeLists.txt
    // Return [] on any error (no throws)
    return [];
  }
}
```

`type` field uses `'cmake'` (added to `DependencyType` in Stage A-3).

### Stage A-9 — `CppPlugin` (`src/plugins/cpp/index.ts`)

Critical fields that must match interface and existing plugin conventions exactly:

```typescript
import { generateEntityId } from '@/plugins/shared/mapper-utils.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import { DependencyExtractor } from './dependency-extractor.js';

export class CppPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'cpp',                    // must match DETECTION_RULES plugin string
    version: '1.0.0',
    displayName: 'C++',
    fileExtensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hxx', '.h++'],
    // '.h' intentionally excluded — ambiguous with C projects
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,   // .h/.cpp merge requires full-project context
      dependencyExtraction: true,
      typeInference: false,        // Tree-sitter is syntax-level only
    },
  };

  readonly supportedLevels = ['package', 'class', 'method'] as const;

  // Getter pattern matching JavaPlugin (src/plugins/java/index.ts:56-59)
  // Interface defines dependencyExtractor as optional (readonly dependencyExtractor?)
  private depExtractor!: DependencyExtractor;
  get dependencyExtractor(): IDependencyExtractor | undefined {
    return this.depExtractor;
  }

  // null (not undefined/optional) — matches GoPlugin convention (golang/index.ts:59)
  private clangdClient: ClangdClient | null = null;
  private treeSitter!: TreeSitterBridge;
  private merger!: HeaderMerger;
  private mapper!: ArchJsonMapper;
  private initialized = false;
  private workspaceRoot = '';
}
```

`initialize()`:
- Instantiates `TreeSitterBridge`, `HeaderMerger`, `ArchJsonMapper`, `DependencyExtractor`
- Try/catch `new ClangdClient()` → on failure `clangdClient = null` + `console.warn`
- Sets `initialized = true`

`parseToRawData(workspaceRoot, config)`:
- `glob('**/*.{cpp,cc,cxx,c++,hpp,hxx,h++,h}', { cwd: workspaceRoot, ignore: [...] })`
- Read + `treeSitter.parseCode()` per file
- Returns `CppRawData`

`parseProject(workspaceRoot, config)`:
- Calls `parseToRawData()` → `merger.merge()` → `mapper.mapEntities()` + `mapper.mapRelations()`
- Returns `ArchJSON` with `language: 'cpp'` (no `extensions` yet — Phase B)

`parseCode(code, filePath)`:
- Single file via `treeSitter.parseCode()` → `mapper` directly (skip merger)

`dispose()`:
- `clangdClient?.dispose()` in try/catch, then set `null`

### Stage A-10 — Wire `analyze.ts` (`src/cli/commands/analyze.ts`)

In `normalizeToDiagrams()`, add a C++ branch after the Go-without-atlas block (line ~82):

```typescript
// C++ project: single diagram per source, language = 'cpp'
if (language === 'cpp') {
  const diagram: DiagramConfig = {
    name: 'architecture',
    sources: cliOptions.sources,
    level: 'class',
    format: cliOptions.format,
    exclude: cliOptions.exclude,
    language: 'cpp',
    languageSpecific: {
      cpp: {
        clangd: { enabled: false },  // Phase C will set from cliOptions.cppLsp
      },
    },
  };
  return filterByLevels([diagram], cliOptions.diagrams);
}
```

### Stage A-11 — Wire `DiagramProcessor` (`src/cli/processors/diagram-processor.ts`)

This is the **most critical integration step**. There is no central plugin registry startup;
built-in plugins are lazily instantiated inside `DiagramProcessor` private methods.
The pattern established by `parseGoProject()` (line 686) must be replicated exactly.

**Step 1**: Add `parseCppProject()` method (after `parseTsProject()`, ~line 727):

```typescript
private async parseCppProject(diagram: DiagramConfig): Promise<ArchJSON> {
  const workspaceRoot = path.resolve(diagram.sources[0]);
  const registryPlugin = this.registry?.getByName('cpp');
  const plugin = registryPlugin ?? await (async () => {
    const { CppPlugin } = await import('@/plugins/cpp/index.js');
    return new CppPlugin();
  })();

  await plugin.initialize({ workspaceRoot });
  return plugin.parseProject(workspaceRoot, {
    workspaceRoot,
    excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
    languageSpecific: diagram.languageSpecific,
  });
}
```

**Step 2**: Add routing branch in `processSourceGroup()` (after the Go branch, ~line 444):

```typescript
// Route C++ diagrams through CppPlugin
if (firstDiagram.language === 'cpp') {
  const rawArchJSON = await this.registerDeferred(
    firstDiagram.sources,
    this.parseCppProject(firstDiagram)
  );
  const results = await pMap(
    diagrams,
    async (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
    { concurrency: this.globalConfig.concurrency || os.cpus().length }
  );
  return results;
}
```

This branch must appear **before** the TypeScript needsModuleGraph branch (~line 448),
otherwise C++ diagrams fall through to the TypeScript path and get misrouted.

### Stage A-12 — Tests

Install tree-sitter bindings before running tests:
```bash
npm install
npm run build   # ensure dist/ exists for dynamic import in DiagramProcessor
```

**`tests/plugins/cpp/tree-sitter-bridge.test.ts`**:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterBridge } from '@/plugins/cpp/tree-sitter-bridge.js';

describe('TreeSitterBridge', () => {
  let bridge: TreeSitterBridge;
  beforeEach(() => { bridge = new TreeSitterBridge(); });

  describe('parseCode — class extraction', () => {
    it('extracts a simple class', () => { ... });
    it('sets kind: class for class keyword', () => { ... });
    it('sets kind: struct for struct keyword (default public)', () => { ... });
    it('extracts single inheritance base', () => { ... });
    it('extracts multiple inheritance bases', () => { ... });
    it('sets templateParams for template class', () => { ... });
    it('appends <T> to template class name', () => { ... });
  });

  describe('parseCode — namespace', () => {
    it('sets namespace from enclosing namespace_definition', () => { ... });
    it('qualifiedName = namespace::ClassName', () => { ... });
    it('global-scope class has empty namespace', () => { ... });
  });

  describe('parseCode — includes', () => {
    it('collects #include "foo.h" into includes[]', () => { ... });
    it('collects #include <vector> into includes[]', () => { ... });
    it('does NOT produce any Relation', () => { ... });
  });
});
```

**`tests/plugins/cpp/header-merger.test.ts`**:

```typescript
describe('HeaderMerger', () => {
  it('merges .hpp declaration with .cpp implementation');
  it('declarationFile = header path');
  it('method list is union, deduped by name+param count');
  it('ns1::Foo and ns2::Foo are NOT merged (different qualifiedName)');
  it('impl-only class (no header) included as-is');
  it('orphaned qualified method Foo::doWork re-attached to Foo');
});
```

**`tests/plugins/cpp/archjson-mapper.test.ts`**:

```typescript
describe('ArchJsonMapper', () => {
  it('uses generateEntityId(ns, qualifiedName) for entity id');
  it('uses createRelation() — relation id is source_type_target');
  it('inheritance from base_class_clause → type: inheritance, inferenceSource: explicit');
  it('unresolved base name → relation omitted');
  it('field type matching known entity → type: composition, inferenceSource: inferred');
  it('struct kind → entity type: struct');
});
```

**`tests/plugins/cpp/cpp-plugin.test.ts`** (integration, temp dir fixtures):

```typescript
describe('CppPlugin', () => {
  it('canHandle .cpp file → true');
  it('canHandle .hpp file → true');
  it('canHandle .h file alone → false (no build marker)');
  it('canHandle directory with CMakeLists.txt → true');
  it('canHandle directory with Makefile → true');
  it('clangd unavailable → initialize() does not throw');
  it('parseProject → language: cpp');
  it('parseCode parses single file without HeaderMerger');
});
```

Full suite gate before Phase A merge:

```bash
npm test
# All prior tests + new C++ tests must pass, 0 failures
npm run type-check
npm run build
node dist/cli/index.js analyze -v   # TypeScript self-analysis unchanged
```

---

## Phase B — Namespace Package Graph

### Objectives

1. Add `CppAnalysis` / `CppNamespaceGraph` types to `src/types/extensions.ts`
2. Implement `NamespaceGraphBuilder`
3. Attach `extensions.cppAnalysis` in `CppPlugin.parseProject()`
4. Add C++ package-level rendering route in `DiagramProcessor.generateOutput()`

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/plugins/cpp/builders/namespace-graph-builder.ts` | Create | `NamespaceGraphBuilder.build()` |
| `src/types/extensions.ts` | Modify | `CPP_ANALYSIS_VERSION` + C++ graph types + `ArchJSONExtensions.cppAnalysis` |
| `src/types/index.ts` | Modify | Export `CppAnalysis` and related types |
| `src/plugins/cpp/index.ts` | Modify | `parseProject()` attaches `extensions.cppAnalysis` |
| `src/cli/processors/diagram-processor.ts` | Modify | `generateOutput()` C++ package routing |

### Stage B-1 — Verify Phase A baseline

```bash
npm test
# 0 failures
```

### Stage B-2 — Extension types (`src/types/extensions.ts`)

Append after the `TsModuleCycle` block:

```typescript
// ========== C++ Analysis Extension ==========

export const CPP_ANALYSIS_VERSION = '1.0';

export interface CppAnalysis {
  version: string;              // CPP_ANALYSIS_VERSION
  namespaceGraph?: CppNamespaceGraph;
  buildSystem?: 'cmake' | 'makefile' | 'bazel' | 'unknown';
  clangdEnabled: boolean;
}

export interface CppNamespaceGraph {
  nodes: CppNamespaceNode[];
  edges: CppNamespaceDependency[];
  cycles: CppNamespaceCycle[];
}

export interface CppNamespaceNode {
  id: string;       // project-root-relative, e.g. "engine/render"
  name: string;     // last segment, e.g. "render"
  fileCount: number;
  stats: { classes: number; structs: number; functions: number; enums: number };
}

export interface CppNamespaceDependency {
  from: string;     // namespace id
  to: string;       // namespace id
  strength: number; // #include edge count between the two namespaces
}

export interface CppNamespaceCycle {
  namespaces: string[];
  severity: 'warning' | 'error';
}
```

Add `cppAnalysis?` slot to `ArchJSONExtensions`:

```typescript
export interface ArchJSONExtensions {
  goAtlas?: GoAtlasExtension;
  tsAnalysis?: TsAnalysis;
  cppAnalysis?: CppAnalysis;   // NEW
}
```

**`src/types/index.ts`** — export alongside other extension types (follow the TS block pattern):

```typescript
export type {
  CppAnalysis,
  CppNamespaceGraph,
  CppNamespaceNode,
  CppNamespaceDependency,
  CppNamespaceCycle,
} from './extensions.js';
export { CPP_ANALYSIS_VERSION } from './extensions.js';
```

### Stage B-3 — `NamespaceGraphBuilder`

```typescript
// src/plugins/cpp/builders/namespace-graph-builder.ts
export class NamespaceGraphBuilder {
  build(
    files: RawCppFile[],
    entities: MergedCppEntity[],
    workspaceRoot: string
  ): CppNamespaceGraph {
    // 1. For each entity, compute namespaceId:
    //    - qualifiedName contains '::' → first segment
    //    - else → path.relative(workspaceRoot, path.dirname(entity.declarationFile))
    // 2. Build namespaceId → node stats
    // 3. For each RawCppFile, resolve each include[] path:
    //    - try path.resolve(path.dirname(file.filePath), include) → find owner namespace
    //    - accumulate CppNamespaceDependency strength
    // 4. DFS cycle detection: 2-node cycle → warning, 3+ → error
    return { nodes, edges, cycles };
  }
}
```

### Stage B-4 — Wire into `CppPlugin.parseProject()`

```typescript
// After mapper.mapRelations(), before return:
const namespaceGraph = this.namespaceGraphBuilder.build(
  rawData.files, mergedEntities, workspaceRoot
);
const buildSystem = await this.detectBuildSystem(workspaceRoot);

return {
  version: '1.0',
  language: 'cpp',
  timestamp: new Date().toISOString(),
  sourceFiles: rawData.files.map(f => f.filePath),
  entities,
  relations,
  extensions: {
    cppAnalysis: {
      version: CPP_ANALYSIS_VERSION,
      namespaceGraph,
      buildSystem,
      clangdEnabled: this.clangdClient !== null,
    },
  },
};
```

Add `namespaceGraphBuilder` instance field, initialised in `initialize()`.

### Stage B-5 — `generateOutput()` C++ routing

In `src/cli/processors/diagram-processor.ts`, in the `generateOutput()` switch block,
locate the existing routing (lines ~754-758):

```typescript
if (archJSON.extensions?.goAtlas) {
  await this.generateAtlasOutput(...);
} else if (level === 'package' && archJSON.extensions?.tsAnalysis?.moduleGraph) {
  await this.generateTsModuleGraphOutput(...);
} else {
  // standard classDiagram
}
```

Add a C++ branch **between the tsAnalysis check and the else**:

```typescript
} else if (level === 'package' && archJSON.extensions?.cppAnalysis?.namespaceGraph) {
  await this.generateCppNamespaceGraphOutput(archJSON, paths, diagram, pool);
} else {
```

Add the private method `generateCppNamespaceGraphOutput()` modelled on
`generateTsModuleGraphOutput()`. It calls a new `renderCppNamespaceGraph(graph)` function
that produces:

```
%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%
flowchart LR
  ns_engine["engine\n(12 classes)"]:::internal
  ns_render["render\n(8 classes)"]:::internal
  ns_engine --> |"4 includes"| ns_render

  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329
```

Node IDs: sanitise `::` → `__`, `/` → `_` for Mermaid compatibility.
Edge labels: `|"N includes"|` when `strength > 1`; no label when `strength === 1`.

### Stage B-6 — Tests

**`tests/plugins/cpp/namespace-graph-builder.test.ts`**:

```typescript
describe('NamespaceGraphBuilder', () => {
  it('entity with ns::Foo → node id "ns"');
  it('entity without namespace → node id from directory path');
  it('#include "render/camera.hpp" from engine/ → edge engine → render');
  it('2-node mutual include → cycle severity: warning');
  it('3-node cycle → cycle severity: error');
  it('no includes → empty edges[]');
});
```

Full suite gate:

```bash
npm test
npm run type-check
npm run build
node dist/cli/index.js analyze -s /path/to/cmake-project --lang cpp -f json
# Inspect output: extensions.cppAnalysis.namespaceGraph should be populated
node dist/cli/index.js analyze -s /path/to/cmake-project --lang cpp
# Inspect .archguard/: package-level .mmd file should appear
```

---

## Phase C — clangd Semantic Enhancement (optional)

### Objectives

1. Add `inferenceSource: 'clangd'` to the `Relation` union type
2. Implement `ClangdClient` (mirrors `GoplsClient` structure)
3. Wire clangd into `CppPlugin`
4. Add `--cpp-lsp` / `--cpp-compile-db` CLI flags end-to-end

### Files changed

| File | Type | Description |
|------|------|-------------|
| `src/plugins/cpp/clangd-client.ts` | Create | `ClangdClient` — LSP process management |
| `src/plugins/cpp/index.ts` | Modify | `parseProject()` clangd path |
| `src/types/index.ts` | Modify | `Relation.inferenceSource` += `'clangd'` |
| `src/types/config.ts` | Modify | `CLIOptions` += `cppLsp?` / `cppCompileDb?` |
| `src/cli/commands/analyze.ts` | Modify | `.option()` + `normalizeToDiagrams()` cpp branch |

### Stage C-1 — `inferenceSource` schema change

**`src/types/index.ts` line 178**:

```typescript
// Before:
inferenceSource?: 'explicit' | 'inferred' | 'gopls';
// After:
inferenceSource?: 'explicit' | 'inferred' | 'gopls' | 'clangd';
```

```bash
grep -rn "inferenceSource" tests/
# Confirm no existing test uses string equality against the full union
npm run type-check
```

### Stage C-2 — `CLIOptions` + CLI flags

**`src/types/config.ts`** — append after the Atlas block (~line 557):

```typescript
// ========== C++ clangd Enhancement ==========
cppLsp?: boolean;
cppCompileDb?: string;
```

**`src/cli/commands/analyze.ts` — `createAnalyzeCommand()`** — append after `--atlas-protocols` option (~line 227):

```typescript
// ========== C++ clangd Enhancement ==========
.option('--cpp-lsp', 'Enable clangd semantic analysis for C++ (default: false)')
.option('--cpp-compile-db <path>', 'Directory containing compile_commands.json')
```

**`normalizeToDiagrams()`** — update the C++ branch added in Stage A-10 to wire the flags:

```typescript
if (language === 'cpp') {
  const diagram: DiagramConfig = {
    name: 'architecture',
    sources: cliOptions.sources,
    level: 'class',
    format: cliOptions.format,
    exclude: cliOptions.exclude,
    language: 'cpp',
    languageSpecific: {
      cpp: {
        clangd: {
          enabled: cliOptions.cppLsp ?? false,
          compileDb: cliOptions.cppCompileDb,
        },
      },
    },
  };
  return filterByLevels([diagram], cliOptions.diagrams);
}
```

### Stage C-3 — `ClangdClient` (`src/plugins/cpp/clangd-client.ts`)

Structure mirrors `src/plugins/golang/gopls-client.ts`:
- Same `ChildProcess | null` field, JSON-RPC `Content-Length` framing, pending request
  `Map<id, { resolve, reject, timer: NodeJS.Timeout }>` pattern, `messageBuffer` string
- Same `isInitialized(): boolean` method
- Same try/catch on `sendRequest` with request timeout

New C++-specific methods:

```typescript
async initialize(workspaceRoot: string, compileDbPath?: string): Promise<void>
// spawn: 'clangd', args: compileDbPath ? ['--compile-commands-dir=' + compileDbPath] : []

async getVirtualOverrides(
  uri: string, line: number, character: number
): Promise<Array<{ uri: string; line: number; character: number }>>
// textDocument/implementation

async dispose(): Promise<void>

static async isAvailable(): Promise<boolean>
// try { execFileSync('clangd', ['--version']); return true } catch { return false }
```

### Stage C-4 — Wire into `CppPlugin`

**`initialize()`** — read from `config` (note: `PluginInitConfig` has no `languageSpecific`;
clangd activation is determined inside `parseProject` from `ParseConfig.languageSpecific`):

```typescript
// In initialize(), always attempt ClangdClient construction:
try {
  this.clangdClient = new ClangdClient();
} catch {
  console.warn('[CppPlugin] clangd client construction failed');
  this.clangdClient = null;
}
```

**`parseProject()`** — read clangd config from `config.languageSpecific`:

```typescript
const cppConfig = config.languageSpecific?.cpp as
  { clangd?: { enabled?: boolean; compileDb?: string } } | undefined;
const clangdEnabled = cppConfig?.clangd?.enabled === true;

if (clangdEnabled && this.clangdClient && !this.clangdClient.isInitialized()) {
  const available = await ClangdClient.isAvailable();
  if (available) {
    try {
      await this.clangdClient.initialize(workspaceRoot, cppConfig?.clangd?.compileDb);
    } catch {
      console.warn('[CppPlugin] clangd initialization failed, falling back');
      this.clangdClient = null;
    }
  } else {
    console.warn('[CppPlugin] --cpp-lsp requested but clangd not found in PATH');
    this.clangdClient = null;
  }
}
```

After `mapRelations()`, if clangd is active, call `resolveVirtualOverrides()` which emits
`implementation` relations with `inferenceSource: 'clangd'`.

### Stage C-5 — Tests

**`tests/plugins/cpp/clangd-client.test.ts`** (unit — mock spawned process):

```typescript
describe('ClangdClient', () => {
  it('isAvailable() returns false when clangd not in PATH');
  it('sends Content-Length framing correctly');
  it('pending request times out and rejects');
  it('dispose() kills process and clears pending requests');
});
```

**`tests/plugins/cpp/cpp-plugin.test.ts`** — add:

```typescript
it('--cpp-lsp=false → clangdClient.isInitialized() stays false after parseProject');
it('clangd not in PATH with --cpp-lsp → warns, does not throw, relations unchanged');
it('clangd relations have inferenceSource: clangd');
```

Full suite gate:

```bash
npm test
npm run type-check
npm run build
# With clangd installed:
node dist/cli/index.js analyze -s /path/to/cpp --lang cpp --cpp-lsp -f json
# Verify: some relations show inferenceSource: 'clangd'
```

---

## Acceptance Criteria (All Phases)

| Check | Command | Expected |
|-------|---------|---------|
| No regressions | `npm test` | All prior 1953 tests + new C++ tests pass |
| Type safety | `npm run type-check` | 0 errors |
| Build | `npm run build` | 0 errors |
| Self-analysis | `node dist/cli/index.js analyze -v` | TypeScript output unchanged |
| Auto-detection | `node dist/cli/index.js analyze -s <cmake-dir>` | Picks `cpp` via CMakeLists.txt |
| JSON output | `node dist/cli/index.js analyze -s <cpp-dir> --lang cpp -f json` | `language: "cpp"` in output |
| Diagram output | `node dist/cli/index.js analyze -s <cpp-dir> --lang cpp` | `.archguard/*.mmd` created |
| Package graph (B) | `analyze -s <cpp-dir> --lang cpp --diagrams package` | namespace flowchart in `.archguard/` |
| clangd (C) | `analyze -s <cpp-dir> --lang cpp --cpp-lsp -f json` | `implementation` relations with `inferenceSource: clangd` |
