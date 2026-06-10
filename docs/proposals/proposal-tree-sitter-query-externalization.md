## Context in the Proposal Series

This is the second of three proposals addressing ArchGuard's extensibility:

| Step | Proposal | Side | Claude Code impact |
|------|----------|------|--------------------|
| 1+2 | `proposal-open-entity-type-and-attribute-queries.md` | Consumer | `archguard_find_entity` gains type + attribute filtering |
| **3** | **This document** | **Producer** | **Transparent — lowers cost of adding new languages; no change to query interface** |
| 4 | `proposal-declarative-entity-schema.md` | Producer | Transparent — makes entity mapping declarative; no change to query interface |

This proposal is **producer-side infrastructure**. It makes it cheaper and safer to
implement language plugins by replacing imperative tree traversal with declarative
`.scm` query files. Claude Code's query interface (`archguard_find_entity`,
`archguard_summary`, etc.) does not change. The value is felt by plugin authors and
by the ArchGuard codebase itself, not by consumers.

Dependency: Step 1+2 can be implemented independently. This step depends on nothing
from Step 1+2; Step 4 depends on this step.

## Problem Statement

ArchGuard's five tree-sitter bridges (`src/plugins/*/tree-sitter-bridge.ts`, 2361 lines
combined) use **imperative node traversal** to extract entities:

```typescript
// src/plugins/cpp/tree-sitter-bridge.ts — typical pattern
private visitForClasses(node: Parser.SyntaxNode, ...): void {
  for (const child of node.namedChildren) {
    if (child.type === 'class_specifier') { ... }
    if (child.type === 'struct_specifier') { ... }
    if (child.type === 'namespace_definition') {
      this.visitForClasses(child.childForFieldName('body'), ...);
    }
  }
}
```

The knowledge embedded in this traversal — "a class is a `class_specifier` node",
"namespace bodies must be recursed into", "a field is a `field_declaration` inside a
`field_declaration_list`" — is language-specific data that happens to be written as
TypeScript control flow.

Tree-sitter ships a native query API (`language.query(sExpression)`) designed exactly
for this purpose. Its S-expression format (`.scm` files) is readable, composable, and
independent of any host language. ArchGuard uses `tree-sitter` the parser but ignores
`tree-sitter` the query engine — today every plugin re-implements pattern matching by
hand.

The consequences:

1. **New language cost is high.** Adding a language requires writing a bridge class with
   correct recursive traversal logic. Bugs in traversal (e.g., the `ERROR` node recursion
   fix in the C++ bridge) are invisible until a real project exposes them.

2. **Pattern changes require code changes.** Extracting a new node kind — e.g., C++
   `concept` declarations in C++20 — means touching `tree-sitter-bridge.ts`. There is no
   separation between "what to look for" and "how to look for it".

3. **No shared vocabulary.** Each bridge defines its own traversal logic independently.
   The Go bridge (884 lines) and Python bridge (518 lines) have no shared pattern
   infrastructure despite solving similar problems.

## Goals

- Introduce a `QueryLoader` class that reads `.scm` query files and compiles them once
  using tree-sitter's `language.query()` API.
- Refactor the C++ bridge as the reference implementation, replacing imperative traversal
  with query captures for class, function, field, enum, and include extraction.
- Define a standard query file layout under `src/plugins/<lang>/queries/` with named
  query files per concern.
- Provide a `CaptureMapper` base class that bridges from tree-sitter captures to the
  language-specific raw types (`RawCppFile`, `RawPythonFile`, etc.), keeping the mapper
  layer in TypeScript.
- After the C++ reference is validated, migrate the remaining bridges (Python → Java →
  Go) incrementally.

## Non-Goals

- Replacing the `ArchJsonMapper` layer. The mapping from raw types to `Entity` /
  `Relation` stays in TypeScript.
- Requiring `.scm` queries to express every pattern. Imperative fallback code remains for
  inherently sequential patterns (e.g., cross-file header merging in C++).
- Migrating Go's gopls integration. The `gopls` path in the Go bridge stays imperative;
  only the tree-sitter-backed traversal is migrated.
- Changing the `ILanguagePlugin` interface or `ArchJSON` schema.

## Design

### 1. Query file layout

Each language plugin gets a `queries/` directory alongside its bridge:

```
src/plugins/cpp/
├── queries/
│   ├── classes.scm        # class_specifier, struct_specifier, union
│   ├── functions.scm      # function_definition, constructor, destructor
│   ├── fields.scm         # field_declaration inside class bodies
│   ├── enums.scm          # enum_specifier
│   └── includes.scm       # preproc_include
├── tree-sitter-bridge.ts  # now thin: load queries, run them, map captures
└── ...

src/plugins/python/
├── queries/
│   ├── classes.scm        # class_definition
│   ├── functions.scm      # function_definition, decorated_definition
│   ├── imports.scm        # import_statement, import_from_statement
│   └── fields.scm         # assignment, annotated_assignment in class body
└── ...
```

Tree-sitter's native `.scm` format is used without modification. Example:

```scheme
; src/plugins/cpp/queries/classes.scm

; Basic class or struct
(class_specifier
  name: (type_identifier) @class.name
  body: (field_declaration_list) @class.body) @class

; Union as struct-like
(union_specifier
  name: (type_identifier) @class.name
  body: (field_declaration_list) @class.body) @class

; Anonymous struct (no name node)
(struct_specifier
  body: (field_declaration_list) @class.body) @class.anonymous
```

```scheme
; src/plugins/python/queries/classes.scm

(class_definition
  name: (identifier) @class.name
  superclasses: (argument_list)? @class.bases
  body: (block) @class.body) @class

; Decorated class (dataclass, ABC, etc.)
(decorated_definition
  (decorator) @class.decorator
  definition: (class_definition
    name: (identifier) @class.name
    body: (block) @class.body)) @class.decorated
```

### 2. `QueryLoader`

```typescript
// src/plugins/shared/query-loader.ts

import * as path from 'path';
import * as fs from 'fs';
import type Parser from 'tree-sitter';

export type QuerySet = Map<string, Parser.Query>;

export class QueryLoader {
  private language: Parser.Language;
  private queryDir: string;

  constructor(language: Parser.Language, queryDir: string) {
    this.language = language;
    this.queryDir = queryDir;
  }

  /** Load and compile all .scm files in queryDir. Key = filename without extension. */
  loadAll(): QuerySet {
    const queries = new Map<string, Parser.Query>();
    const files = fs.readdirSync(this.queryDir).filter((f) => f.endsWith('.scm'));
    for (const file of files) {
      const name = path.basename(file, '.scm');
      const src = fs.readFileSync(path.join(this.queryDir, file), 'utf8');
      queries.set(name, this.language.query(src));
    }
    return queries;
  }

  /** Load and compile a single named query file. */
  load(name: string): Parser.Query {
    const src = fs.readFileSync(path.join(this.queryDir, `${name}.scm`), 'utf8');
    return this.language.query(src);
  }
}
```

Queries are compiled once in `initialize()` and cached for the plugin's lifetime.

### 3. `CaptureMapper` base

```typescript
// src/plugins/shared/capture-mapper.ts

import type Parser from 'tree-sitter';

export interface CaptureGroup {
  /** All captures for one top-level match, keyed by capture name. */
  [captureName: string]: Parser.SyntaxNode | undefined;
}

export abstract class CaptureMapper<TRaw> {
  /** Convert one capture group from a query match into a raw entity. Returns null to skip. */
  abstract mapCapture(group: CaptureGroup, filePath: string): TRaw | null;

  /** Run a compiled query against a root node and collect raw entities. */
  runQuery(query: Parser.Query, root: Parser.SyntaxNode, filePath: string): TRaw[] {
    const results: TRaw[] = [];
    for (const match of query.matches(root)) {
      const group: CaptureGroup = {};
      for (const capture of match.captures) {
        group[capture.name] = capture.node;
      }
      const raw = this.mapCapture(group, filePath);
      if (raw !== null) results.push(raw);
    }
    return results;
  }
}
```

### 4. Refactored C++ bridge (reference implementation)

The bridge shrinks from 338 lines to approximately 120 lines:

```typescript
// src/plugins/cpp/tree-sitter-bridge.ts (after migration)

export class TreeSitterBridge {
  private parser: Parser;
  private queries: QuerySet;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Cpp);
    const loader = new QueryLoader(Cpp, new URL('./queries', import.meta.url).pathname);
    this.queries = loader.loadAll();
  }

  parseCode(code: string, filePath: string): RawCppFile {
    const root = this.parser.parse(code).rootNode;
    return {
      filePath,
      namespace: this.extractTopLevelNamespace(root),  // stays imperative (trivial)
      classes:   this.classMapper.runQuery(this.queries.get('classes')!, root, filePath),
      enums:     this.enumMapper.runQuery(this.queries.get('enums')!, root, filePath),
      functions: this.funcMapper.runQuery(this.queries.get('functions')!, root, filePath),
      includes:  this.includeMapper.runQuery(this.queries.get('includes')!, root, filePath),
    };
  }
}
```

The imperative `visitForClasses` / `visitForFunctions` recursive loops are replaced by
query matches. The `CaptureMapper` subclasses (`CppClassMapper`, `CppFuncMapper`, etc.)
hold the interpretation logic — converting capture nodes to `RawClass`, `RawFunction`,
etc.

### 5. Validation and fallback

Before each query is compiled, `QueryLoader` verifies the `.scm` syntax by catching
`language.query()` exceptions and surfacing them as `ParseError` with the file path.
This gives immediate feedback when a query file has a syntax error.

For edge cases that cannot be expressed in S-expressions (e.g., C++'s `ERROR` node
recursion for `extern "C"` guards), the bridge retains a small imperative supplement:

```typescript
private extractFromErrorNodes(root: Parser.SyntaxNode, ...): RawClass[] {
  // kept verbatim from the current bridge — documents the known limitation
}
```

This supplement is explicitly isolated and documented, making it visible that it
compensates for a tree-sitter grammar limitation.

## Migration Order

| Phase | Bridge | Rationale |
|-------|--------|-----------|
| 1 | C++ (`cpp/tree-sitter-bridge.ts`, 338 lines) | Smallest bridge; already has `RawCppFile` intermediate type; validates the pattern |
| 2 | Python (`python/tree-sitter-bridge.ts`, 518 lines) | No gopls complexity; good coverage of decorator patterns |
| 3 | Java (`java/tree-sitter-bridge.ts`, 485 lines) | Moderate complexity; tests the annotation extraction case |
| 4 | Go (`golang/tree-sitter-bridge.ts`, 884 lines) | Largest; gopls path stays imperative; only the tree-sitter path migrates |
| 5 | Kotlin (`kotlin/tree-sitter-bridge.ts`, 136 lines) | Smallest; easy win after the pattern is established |

Each phase is independently deployable and tested. The `QueryLoader` and `CaptureMapper`
infrastructure is built in Phase 1 and reused in all subsequent phases.

## Affected Files

| File | Change |
|------|--------|
| `src/plugins/shared/query-loader.ts` | New: `QueryLoader` class |
| `src/plugins/shared/capture-mapper.ts` | New: `CaptureMapper<TRaw>` base class |
| `src/plugins/cpp/queries/*.scm` | New: 5 query files |
| `src/plugins/cpp/tree-sitter-bridge.ts` | Refactor: traversal → query-based |
| `src/plugins/python/queries/*.scm` | New (Phase 2) |
| `src/plugins/python/tree-sitter-bridge.ts` | Refactor (Phase 2) |
| `src/plugins/java/queries/*.scm` | New (Phase 3) |
| `src/plugins/java/tree-sitter-bridge.ts` | Refactor (Phase 3) |
| `src/plugins/golang/queries/*.scm` | New (Phase 4, tree-sitter path only) |
| `src/plugins/golang/tree-sitter-bridge.ts` | Partial refactor (Phase 4) |
| `src/plugins/kotlin/queries/*.scm` | New (Phase 5) |
| `src/plugins/kotlin/tree-sitter-bridge.ts` | Refactor (Phase 5) |

## Alternatives

- **Keep imperative traversal, extract query strings as TypeScript constants**: Rejected.
  `.scm` files are the tree-sitter ecosystem's native format; they can be linted and
  shared with tools outside ArchGuard. String constants in TypeScript do not compose.
- **Use tree-sitter's `pattern` method instead of `query`**: `pattern` is a lower-level
  API with less capture support. `query` is the recommended path for structured extraction.

## Open Questions

1. **Performance**: Does `language.query(sExpression).matches(root)` have higher overhead
   than hand-written traversal for large files? Benchmark needed for the C++ reference
   implementation before committing to Phase 2+.
2. **Macro supplement scope**: Should the `ERROR` node fallback for C++ be documented as
   a permanent supplement or removed once tree-sitter-cpp improves `extern "C"` support?
3. **Query file discovery**: Should `QueryLoader.loadAll()` discover files dynamically
   (filesystem read) or require an explicit manifest? Dynamic discovery is simpler but
   order-dependent if query files reference each other's captures.
