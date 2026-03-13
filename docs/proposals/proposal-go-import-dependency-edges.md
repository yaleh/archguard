# Proposal: Emit Inter-Package Dependency Edges for Go

**Status**: Draft
**Date**: 2026-03-13
**Author**: ArchGuard Team

---

## 1. Background

### Current state

The Go language plugin (`src/plugins/golang/`) produces ArchJSON with entities (structs and interfaces)
and a single relation type: `implementation` (struct → interface, inferred via gopls or name-based
matching). A confirmed stub in the mapper makes the gap explicit:

```typescript
// src/plugins/golang/archjson-mapper.ts:163
// TODO: Add dependency relations from imports
```

As a result, Go package diagrams rendered from ArchJSON contain isolated nodes with no edges. The
diagrams are structurally correct but semantically empty — every package appears as a disconnected
island.

### Data already available in memory

The raw data structures prove the necessary information is already collected during parsing:

- `GoImport` (`src/plugins/golang/types.ts:140-145`): holds `path: string` (the full import path
  string, e.g. `github.com/org/app/internal/service`), `alias?: string`, and
  `type?: 'std' | 'internal' | 'external' | 'vendor'` (the classification field is defined in
  `types.ts` with the comment "Filled by GoModResolver" — it is not populated by the tree-sitter
  bridge, which leaves it `undefined`).
- `GoRawPackage.imports: GoImport[]` (`types.ts:158`): every package carries its accumulated
  imports, merged across all `.go` files in the same directory by `parseToRawData()` in `index.ts`.
- `GoRawPackage.fullName: string` (`types.ts:156`): the module-relative path used as the package
  identity key (e.g. `internal/service`). This is also what `ArchJsonMapper.mapEntities()` uses as
  `pkgId` when constructing entity IDs.
- `GoRawData.moduleName: string` (`types.ts:172`): the module root prefix from `go.mod` (e.g.
  `github.com/org/app`), already read by `parseToRawData()` via `readModuleName()`.

The tree-sitter bridge (`extractImports`, lines 489-516) already parses every `import_declaration`
node and populates `GoImport.path` and `GoImport.alias`. The `type` classification field is never
written by the bridge — imports arrive with `type: undefined`.

### Why this matters

Without inter-package edges:
- Package diagrams are disconnected and provide no architectural insight.
- The Go Atlas package layer (`behavior-analyzer.ts buildPackageGraph`) builds its own separate
  dependency model internally and never feeds back into ArchJSON relations.
- Tools consuming ArchJSON (MCP query tools, cycle detection, entity coverage) have zero dependency
  graph data for Go projects.

---

## 2. Goal

After this change, `mapRelations()` in `ArchJsonMapper` will emit `dependency` relations between
packages when one package's import list contains another package from the same module. Concretely:

- For each `GoRawPackage` P with `fullName` F, for each `GoImport` I in `P.imports`:
  - If `I.path` starts with `moduleName + '/'`, strip the prefix to obtain the target `fullName` T.
  - If T matches the `fullName` of another `GoRawPackage` in the same workspace, emit:
    ```
    Relation { id: "F_dependency_T", type: 'dependency', source: F, target: T,
               inferenceSource: 'explicit' }
    ```
- Stdlib imports, external module imports, and vendor paths are silently skipped.
- Self-import edges (source === target) are guarded against.
- Duplicate edges (same source/target, same type) are deduplicated via the existing `seen` set.

The source and target of dependency relations are package `fullName` values (e.g. `internal/api`),
not entity IDs (e.g. `internal/api.MyStruct`). This means dependency relations live in a different
ID namespace from `implementation` relations within the same `relations` array. See Section 7 for
the implications.

---

## 3. Solution Design

### Option A: Resolve import paths to package fullNames inside `mapRelations()` (recommended)

**Mechanism**: `mapRelations()` already receives the full `GoRawPackage[]` list. Build a lookup set
of all known `fullName` values. For each package, iterate its `imports`, strip `moduleName + '/'`
from matching import paths, and check whether the resulting path is in the lookup set. Emit a
`dependency` relation if so. `moduleName` is passed in as a new parameter.

**What changes**:
- `ArchJsonMapper.mapRelations(packages, implementations)` gains a third parameter: `moduleName: string`.
- A lookup `Set<string>` of all package fullNames is built at the top of the method.
- The import-resolution loop runs after the existing implementation loop.
- The only meaningful call site is `parseProject` in `index.ts`, which passes `rawData.moduleName`.
  `parseCode` and `parseFiles` are also call sites but emit no useful dependency edges (see
  [Call site scope](#call-site-scope) below).

**Pros**:
- Zero new parsing passes. All data is already in memory — `GoRawPackage.imports` is populated
  before `mapRelations()` is ever called.
- Change is fully contained within `archjson-mapper.ts` and the call sites in `index.ts`.
- `moduleName` is already available in `parseProject` as `rawData.moduleName`. `parseCode` and
  `parseFiles` can supply `this.cachedModuleName` (already cached in `initialize()`).
- No new fields on `GoRawPackage` or `GoRawData` are required.
- Relation deduplication reuses the existing `seen` Set pattern already in the method.
- Filter logic (stdlib, external, vendor) is a simple prefix/inclusion check; no regex needed.

**Cons**:
- `mapRelations()` signature changes (breaking for any callers that construct the mapper directly,
  though none exist outside `index.ts` and tests).
- Does not populate `GoImport.type`; that classification remains `undefined`. This is acceptable
  for now because the filter logic only needs `moduleName` for correctness, not the `type` field.
- Cannot emit relations for packages that import each other only via interfaces (those are
  already covered by implementation relations). Overlap is harmless due to deduplication.

#### Call site scope

`index.ts` has three `mapRelations` call sites:

| Call site | `moduleName` source | `fullName` values | Dependency edges? |
|-----------|---------------------|-------------------|-------------------|
| `parseProject` | `rawData.moduleName` | Module-relative (e.g. `internal/svc`) | **Yes** — primary use case |
| `parseFiles` | `this.cachedModuleName` | **Absolute filesystem paths** (set as `path.dirname(file)`) | **No** — fullNames never match stripped import paths; all relations silently dropped by lookup |
| `parseCode` | `this.cachedModuleName` | `''` (empty string, set by tree-sitter bridge; caller fills it) | **No** — single-file API, no package graph |

**`parseFiles` does not produce usable dependency edges** because `pkg.fullName` is set to
`path.dirname(file)` (an absolute path such as `/home/user/project/internal/svc`) rather than the
module-relative form (`internal/svc`). The import resolution strips `moduleName + '/'` from the
import path to get `internal/svc`, but the lookup set contains absolute paths. No match is
possible. This is acceptable — `parseFiles` is a low-level API used without go.mod context;
the production path is always `parseProject`.

**`parseCode` does not produce dependency edges** because it is a single-file snippet API with no
package graph. `pkg.fullName` starts as `''`. No module-relative lookup makes sense.

In practice, the implementation should still pass `moduleName` at all three call sites for
consistency (using `this.cachedModuleName` for `parseFiles` and `parseCode`). The lookup-set
mismatch means `parseFiles` produces zero dependency relations silently, which is correct behavior.

---

### Option B: Use gopls workspace symbols to resolve imports

**Mechanism**: The gopls client (`src/plugins/golang/gopls-client.ts`) already supports LSP
workspace queries for interface implementation. gopls could also be queried for `textDocument/definition`
or `workspace/symbol` to resolve each import path to a concrete package directory, enabling
cross-module resolution.

**Pros**:
- Would handle aliased imports (e.g. `import foo "github.com/org/app/internal/foo"`) without
  string manipulation.
- Could in principle resolve `replace` directives in `go.mod`.

**Cons**:
- gopls is already optional and may not be available (`this.goplsClient = null` fallback path in
  `index.ts:397-401`). Dependency edges would silently disappear when gopls is absent.
- LSP queries for every import in every package would add significant latency — potentially hundreds
  of LSP round-trips for large projects.
- Adds async complexity to what is currently a synchronous `mapRelations()` call.
- Provides no benefit over Option A for the common case: resolving same-module imports is purely
  string arithmetic when `moduleName` is known.
- External module imports cannot be resolved to ArchGuard entities regardless, so LSP resolution
  buys nothing there.

**Verdict**: Over-engineered for this use case. gopls should remain scoped to interface matching.

---

### Option C: Re-parse source files for import statements inside `mapRelations()`

**Mechanism**: Instead of using the already-accumulated `GoRawPackage.imports`, re-read each
source file and extract import paths with a regex or secondary tree-sitter parse inside the mapper.

**Pros**:
- Mapper stays self-contained without requiring `moduleName` as a parameter.

**Cons**:
- Re-parsing is strictly worse than Option A: the data is already in memory in `GoRawPackage.imports`.
- Introduces filesystem I/O (or a second tree-sitter parse) in a code path that is currently pure
  computation.
- `mapRelations()` would need to become `async`, which breaks the current call chain.
- The mapper (`archjson-mapper.ts`) would need to import `fs-extra`, violating its current
  design as a pure data-transformation class.
- Any error in re-reading a file would silently drop edges or propagate exceptions.

**Verdict**: Rejected. Strictly dominated by Option A on every axis.

---

## 4. Recommended Approach

**Option A** is the correct implementation.

The key insight is that this is not a data-collection problem — it is a data-wiring problem. The
import paths are already in `GoRawPackage.imports`. The module name is already in `GoRawData.moduleName`.
The package identity keys are already in `GoRawPackage.fullName`. The only missing piece is a loop
in `mapRelations()` that connects them.

The implementation is ~20 lines of new logic inside the existing method, plus one-line argument
additions at the call sites. Only `parseProject` produces real dependency edges; `parseFiles` and
`parseCode` are passed `this.cachedModuleName` but their fullName formats prevent any matches.

---

## 5. Scope

| File | Change | Estimated lines |
|------|--------|-----------------|
| `src/plugins/golang/archjson-mapper.ts` | Add `moduleName: string` param to `mapRelations()`; build lookup set; add import-resolution loop | +25 lines |
| `src/plugins/golang/index.ts` | Pass `moduleName` at three call sites: `parseCode` (`this.cachedModuleName`), `parseFiles` (`this.cachedModuleName`), `parseProject` (`rawData.moduleName`) | +3 lines (one per call site) |
| `tests/plugins/golang/archjson-mapper.test.ts` | New test group for dependency relations | +40–60 lines |

No changes are required to:
- `src/plugins/golang/types.ts` (GoRawPackage.imports already present)
- `src/plugins/golang/tree-sitter-bridge.ts` (imports already extracted)
- `src/types/index.ts` (RelationType already includes `'dependency'`)
- Any diagram renderers (they already handle `dependency` relation type)

---

## 6. Tradeoff Analysis

| Dimension | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Correctness | High — all same-module imports resolved | Medium — gopls may be absent | Low — duplicates parse work |
| Complexity | Low — string arithmetic | High — async LSP round-trips | Medium — filesystem I/O in mapper |
| Performance | Zero overhead — data already in memory | High latency — many LSP calls | I/O overhead per source file |
| Reliability | High — no external process dependency | Fragile — gopls optional | Fragile — file re-read errors |
| Maintainability | High — isolated change, no new deps | Low — gopls coupling | Low — breaks mapper abstraction |

**Correctness caveat**: Option A only emits relations between packages in the same module. Imports
from external modules (e.g. `github.com/gin-gonic/gin`) are not represented as ArchJSON entities
and therefore cannot have relations. This is the correct behavior — cross-module relations are a
separate concern handled by `DependencyExtractor` (go.mod parsing).

---

## 7. Risk Assessment

### ID namespace inconsistency

`implementation` relations use entity IDs of the form `pkgFullName.TypeName` (e.g.
`internal/api.Handler`). The new `dependency` relations use raw package `fullName` values (e.g.
`internal/api`). Both coexist in `ArchJSON.relations[]`.

Downstream consumers that traverse the graph must be aware that not all relation `source`/`target`
values are entity IDs. The existing diagram renderers (which treat `dependency` relations as
package-level edges) already handle this correctly. MCP query tools and cycle-detection algorithms
that assume all relation endpoints are entity IDs should be reviewed before consuming Go dependency
edges.

The `Relation.id` field generated by `createRelation()` will be `"F_dependency_T"` where `F` and
`T` are `fullName` values (e.g. `"internal/api_dependency_internal/svc"`). The `/` in fullNames is
valid in the string but visually distinct from entity IDs like `"internal/api.Handler_..._..._"`.

### Edge cases and mitigations

**Stdlib imports** (e.g. `fmt`, `net/http`, `encoding/json`):
These have no dot in the first path segment and never start with `moduleName + '/'`. The prefix
check naturally excludes them. No special handling needed.

**External module imports** (e.g. `github.com/stretchr/testify`):
These start with a different module path and fail the `moduleName + '/'` prefix check. Excluded
automatically.

**`vendor/` directory imports**:
`parseToRawData` already excludes `**/vendor/**` from the file glob (`index.ts:311-322`). Vendor
packages do not appear in `rawData.packages`, so even if an import path resolves to a vendor
package fullName, the lookup set check will not find a match and no relation is emitted.

**`internal/` packages**:
Go enforces `internal/` access at the module boundary, but ArchGuard analyzes only one module at a
time. Same-module `internal/` imports are valid and should produce edges. The prefix check handles
these identically to non-internal packages — no special case needed.

**Aliased imports** (e.g. `import mypkg "github.com/org/app/internal/mypkg"`):
The alias field is irrelevant for dependency resolution. `GoImport.path` always holds the full
import path string (not the alias). The resolution uses only `GoImport.path`.

**Blank imports** (e.g. `import _ "github.com/org/app/internal/init"`):
The alias field will be `"_"`. The path still resolves normally. Whether to emit a dependency edge
for side-effect-only imports is a matter of taste; emitting the edge is the conservative and
correct choice — the package is still depended upon.

**`go.mod` not found / `moduleName` = `"unknown"`**:
`readModuleName()` returns `"unknown"` on failure. No import path will start with `"unknown/"`, so
the prefix check produces zero matches. The feature degrades gracefully to no dependency edges,
which is the current behavior.

**Duplicate relations**:
A package may import another package in multiple files. After merging by `fullName` in `parseToRawData`,
`GoRawPackage.imports` accumulates all imports across files, potentially duplicating the same import
path. The existing `seen` Set in `mapRelations()` deduplicates by `type:source:target` key, so
duplicates are naturally handled without any extra logic.

**Self-imports**:
A package cannot import itself in valid Go. However, a defensive `source !== target` guard should
be included.

**Circular imports**:
Go forbids import cycles at compile time, so this cannot occur in any project that compiles.
ArchGuard does not need to guard against it; the deduplication set handles it anyway.

**Test-only imports (when `excludeTests` is false)**:
When `parseProject` is called with `atlasConfig.excludeTests = false`, test files (`_test.go`)
are included in `rawData.packages`. Test files importing internal helper packages (e.g.
`internal/testutil`) will produce dependency edges to those packages. This is correct — the
dependency is real. It may inflate the package graph with test infrastructure nodes, but that is
a documentation choice, not a bug.

---

## 8. Test Strategy

### Unit tests (`tests/plugins/golang/archjson-mapper.test.ts`)

New test group: `mapRelations — dependency edges`:

1. **Basic same-module dependency**: Two packages, one imports the other. Verify one `dependency`
   relation is emitted with correct `source` and `target` (both are `fullName` values).

2. **Stdlib import excluded**: Package with `import "fmt"` only. Verify zero dependency relations.

3. **External module import excluded**: Package importing `github.com/gin-gonic/gin`. Verify no
   relation to an unknown package.

4. **Unknown module name (`"unknown"`)**: `moduleName` is `"unknown"`. Verify zero relations.

5. **Duplicate imports deduplicated**: Same import path appears twice in `GoRawPackage.imports`
   (merged from two files). Verify exactly one relation, not two.

6. **Self-import guard**: Defensive test — source package importing itself. Verify zero relations.

7. **Blank import (`_`)**: Alias is `"_"`. Verify a dependency edge is still emitted.

8. **Both implementation and dependency in same call**: Packages with both an interface
   implementation and an import relation. Verify both appear in the result without collision.

9. **Three-package chain** (A → B → C): Verify two `dependency` relations, both correct.

10. **No imports**: Package with empty `imports` array. Verify zero new relations.

11. **`parseFiles`-style absolute fullNames**: Supply `GoRawPackage` entries whose `fullName`
    values are absolute paths (mimicking the `parseFiles` call site). Verify zero dependency
    relations are emitted even when import paths are from the same module. This confirms that
    the no-match behavior is expected and not a regression.

### Integration validation

Two levels of integration coverage are required:

**Automated** (Plan Stage 2.2 — `tests/plugins/golang/`): A mocked-filesystem test in
`go-plugin-merge.test.ts` (or a sibling file) calls `parseToRawData` on a two-package synthetic
fixture, then passes `rawData.packages` and `rawData.moduleName` to `mapRelations` — the same
pipeline as `parseProject`. This confirms the wiring from `go.mod` → `rawData.moduleName` →
`mapRelations` produces `dependency` relations without requiring a real Go project on disk.

**Manual smoke test** (Plan Stage 3.2): Run `node dist/cli/index.js analyze -s <go-project-root>
--lang go -f json` on a real multi-package Go project and verify the output `relations` array
contains entries with `type: "dependency"` whose `source`/`target` values match known package
`fullName` values. The package diagram (Stage 3.3) must show `-->` arrows between nodes.

All existing `go-plugin-merge.test.ts` and `go-plugin.test.ts` tests must remain green after the
change — the new relations are strictly additive.

---

## Appendix: Data flow summary

```
TreeSitterBridge.extractImports()
  → GoImport { path: "github.com/org/app/internal/svc", alias: undefined, type: undefined }
  → stored in GoRawPackage.imports[]
  → accumulated across files by parseToRawData() merge loop

parseToRawData() returns GoRawData { packages, moduleRoot, moduleName: "github.com/org/app" }

mapRelations(packages, implementations, moduleName)         ← NEW: moduleName param
  → build knownFullNames = Set of all pkg.fullName          ← e.g. {"internal/api", "internal/svc"}
  → for each pkg (fullName = "internal/api"):
      for each import (path = "github.com/org/app/internal/svc"):
        strip "github.com/org/app/" → "internal/svc"
        "internal/svc" in knownFullNames → YES
        emit Relation { id: "internal/api_dependency_internal/svc",
                        type: "dependency", source: "internal/api", target: "internal/svc",
                        inferenceSource: "explicit" }
```

**Note**: In `parseFiles` mode, `pkg.fullName` is set to `path.dirname(file)` (absolute path),
so `knownFullNames` contains absolute paths like `/home/user/project/internal/svc`. The stripped
import path `"internal/svc"` never matches an absolute path, resulting in zero dependency edges.
This is expected. The canonical production path for dependency edges is `parseProject`.
