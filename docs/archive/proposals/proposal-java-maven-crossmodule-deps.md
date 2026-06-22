# Proposal: Java Maven Cross-Module Dependency Edges

**Status**: Draft
**Date**: 2026-03-13
**Author**: ArchGuard Team

---

## 1. Background

### Confirmed missing relations in Jlama

Jlama is a standard Maven multi-module project. Running ArchGuard's Java package diagram on the
Jlama repository produces only 3 relations:

| Observed relation | Source |
|---|---|
| `jlama-tests` → `jlama-core` | class-level import |
| `jlama-core` → `jlama-native` | class-level import |
| `jlama-native` → `jlama-core` | class-level import |

Three additional relations are **missing**:

| Missing relation | Confirmed in |
|---|---|
| `jlama-cli` → `jlama-core` | `jlama-cli/pom.xml` `<dependency>` block |
| `jlama-cli` → `jlama-net` | `jlama-cli/pom.xml` `<dependency>` block |
| `jlama-net` → `jlama-core` | `jlama-net/pom.xml` `<dependency>` block |

### Root cause: class-level import accumulation is unreliable for module-level graphs

The Java plugin's current approach to inter-package (inter-module) relations derives them
exclusively from class-level import statements collected during AST parsing. The
`ArchJsonMapper.mapRelations()` walks every class's fields, method parameters, and inheritance
declarations and emits `dependency` relations between entity IDs. The diagram renderer then
aggregates these entity-level edges into module-level arrows at render time.

This approach has a systematic blind spot for multi-module Maven projects:

1. **Entry-point modules have thin import surfaces.** A CLI module (e.g. `jlama-cli`) typically
   contains a handful of classes — often a single `Main.java` or `CliCommand.java`. If those
   classes use only a narrow slice of the target module's public API (for example, constructing
   one factory class and calling one method), the number of class-level import edges is very small.
   If `jlama-cli`'s classes happen to import only from `jlama-core` types that are also imported
   by `jlama-native`, the `jlama-cli → jlama-net` edge may be absent entirely from the class-level
   graph even though `pom.xml` declares it as a direct compile dependency.

2. **Maven `<scope>runtime</scope>` or `<scope>provided</scope>` dependencies** never appear as
   class-level imports at all because the dependent module's classes are loaded at runtime or
   provided by a container, not referenced at compile time.

3. **Maven BOM imports and parent POM inheritance** can introduce effective compile-scope
   dependencies that are not traceable to any single class-level import in the child module.

4. **Module-level package entities have no stable ID mapping to Maven module names.** The Java
   plugin's entity IDs follow the Java package namespace (e.g. `com.github.tjake.jlama.cli`),
   not the Maven artifactId (e.g. `jlama-cli`). When the diagram renderer groups entities into
   modules it uses the top-level path component of the entity ID (or a naming convention).
   Entities in `com.github.tjake.jlama.cli.Main` correctly roll up into the `jlama-cli` module,
   but only if at least one class-level relation connects those entities to entities in the target
   module. If no such class-level relation exists, the module-level arrow is simply absent.

The result is that the package diagram for large Maven multi-module projects is systematically
**under-connected**: real module-level dependencies that are declared in `pom.xml` are invisible
in the diagram.

### Why pom.xml is the authoritative source for module-level dependencies

`pom.xml` `<dependency>` blocks are the **canonical specification** of Maven module-level
dependencies. They are:

- Written explicitly by the developer as architecture decisions.
- Evaluated by Maven's dependency resolution engine — if a relation is absent from `pom.xml`, the
  module cannot compile against the target module.
- Present even when the dependent module's classes use only a thin import surface of the target.
- Present for `runtime`, `provided`, and `optional` scoped dependencies that never appear as
  class-level imports.

Parsing `pom.xml` to extract `<dependency>` blocks and resolving the `artifactId` to a known
module in the workspace is therefore the most reliable way to produce a complete and correct
inter-module dependency graph for Maven multi-module projects.

---

## 2. Available Data

### What the Java plugin already collects

The existing `DependencyExtractor` (`src/plugins/java/dependency-extractor.ts`) already parses
`pom.xml` files and returns a `Dependency[]` array. Each `Dependency` has:

```typescript
interface Dependency {
  name: string;       // artifactId — e.g. "jlama-core"
  version: string;    // e.g. "0.8.0"
  type: 'maven';
  scope: DependencyScope;  // 'runtime' | 'development' | 'optional'
  source: 'pom.xml';
  isDirect: boolean;
}
```

However, `extractDependencies(workspaceRoot)` is called with only the **root** `pom.xml` path.
For a Maven multi-module project, each sub-module has its own `pom.xml`. The root-level
`extractDependencies` call will only see the root pom's `<dependencies>` (if any) or the
`<dependencyManagement>` BOM section, not the sub-module dependencies.

### What already exists for module-to-package mapping

`ArchJsonMapper.mapEntities()` assigns each entity an ID of the form
`<java.package.name>.<ClassName>`. When ArchGuard renders the package diagram, it uses the
top-level directory structure (derived from source paths, e.g. `jlama-cli/src/main/java/...`) to
group entities by Maven module name.

The `parseProject()` method in `index.ts` has access to `workspaceRoot` and the list of all
parsed `.java` files. From each file path it is trivial to infer the Maven sub-module name: the
first path component relative to `workspaceRoot` (e.g. `jlama-cli` from
`/project/jlama-cli/src/main/java/...`).

### What needs to be built

A `MavenCrossModuleParser` that:

1. Glob-discovers all `pom.xml` files in the workspace (sub-module poms, not just root).
2. For each sub-module pom, parses the `<dependency>` blocks and extracts `groupId` +
   `artifactId` pairs.
3. Resolves each `artifactId` to a known Maven sub-module name by matching against the set of
   sub-module directory names discovered in the workspace.
4. Returns a list of `ModuleDependency` records: `{ from: 'jlama-cli', to: 'jlama-core' }`.

The resolved `ModuleDependency` records are then converted to ArchJSON `Relation` objects with
a synthetic source entity ID (one representative entity from the `from` module) and target entity
ID (one representative entity from the `to` module). Or, preferably, with package-level pseudo
entity IDs that the diagram renderer can resolve to module arrows directly.

---

## 3. Solution Options

### Option A: Parse pom.xml per sub-module, resolve artifactId to module name (recommended)

**Mechanism**:

1. After `parseProject()` finishes parsing `.java` files, scan for all `pom.xml` files one level
   deep under `workspaceRoot` (i.e. `<workspaceRoot>/*/pom.xml`).
2. For each sub-module pom, extract `<artifactId>` of the pom itself (the sub-module's own
   artifact name) and all `<dependency>` blocks.
3. Build a registry: `moduleArtifactId → sub-module directory name` (e.g.
   `"jlama-core" → "jlama-core"`; typically they match).
4. For each sub-module pom, for each `<dependency>` whose `<artifactId>` is in the registry, emit
   a `Relation { type: 'dependency', source: <from-module-pkg-id>, target: <to-module-pkg-id> }`.
5. Package-level pseudo entity IDs are derived from the sub-module's root Java package
   (discoverable from the entities already parsed from that sub-module's source files).

**Pros**:
- Directly reads the authoritative source of Maven module-level dependencies.
- Catches all compile-scope, runtime-scope, optional, and provided-scope dependencies.
- Works even when a module's import surface is thin (e.g. CLI entry points).
- No changes to tree-sitter parsing or AST extraction.
- Simple regex-based XML parsing (consistent with existing `DependencyExtractor` approach).
- Self-contained change: a new `MavenCrossModuleParser` class (~100 lines) plus wiring into
  `parseProject()` (~20 lines) and tests (~120 lines).

**Cons**:
- Only resolves intra-workspace dependencies (artifactIds that match a known sub-module). External
  Maven Central dependencies are silently skipped (which is correct and desired for a module
  diagram).
- Does not handle deeply nested multi-module layouts (modules more than one level deep). Solvable
  with a recursive glob but out of scope for this plan.
- BOM-only dependencies (`<scope>import</scope>`) are skipped (correct — they don't represent
  compile-time couplings).

**Verdict**: Recommended. Directly addresses the root cause with minimal scope.

---

### Option B: Accumulate class-level import evidence across all module pairs

**Mechanism**: After building the entity graph, post-process all `dependency` relations and
aggregate them to the module level using the source-file-to-module mapping. If any entity in
module A depends on any entity in module B, emit a module-level `A → B` relation.

**Pros**:
- No new file parsing.
- Works for any build system (Maven, Gradle, Bazel, etc.).

**Cons**:
- Fundamentally cannot recover relations for modules that have zero cross-module class-level
  imports (the exact failure mode that caused the Jlama gap).
- `jlama-cli → jlama-net` is missing because `jlama-cli`'s classes do not directly import
  any `jlama-net` classes in the parsed files. Accumulation of existing edges cannot create
  an edge that does not exist in the class graph.
- Does not address runtime/provided/optional scoped dependencies.

**Verdict**: Rejected. Does not fix the confirmed missing relations.

---

### Option C: Hybrid — pom.xml parsing + class-level accumulation, union of both

**Mechanism**: Emit module-level relations from both sources (Option A + Option B) and take
the union. The union strictly dominates either source individually.

**Pros**:
- Maximum completeness: catches pom.xml-declared edges (Option A) and also surfacess indirect
  structural coupling that is in the class graph but absent from pom.xml (rare but possible if
  pom.xml is misconfigured).
- Class-level accumulation already happens as a side-effect of the existing `mapRelations()`;
  the Option A additions are purely additive.

**Cons**:
- Slightly more complex deduplication logic (both sources may emit the same module pair).
- Marginal benefit beyond Option A for well-maintained pom.xml files.
- pom.xml declarations are the intentional architecture; adding class-level noise muddies the
  signal without clear value.

**Verdict**: Not recommended as primary approach. Option A (pom.xml-first) with existing
class-level relations kept as-is (no removal) effectively produces the same union without
additional complexity.

---

## 4. Recommended Solution

**Option A** — parse per-sub-module `pom.xml` files and resolve `artifactId` to known workspace
modules.

The insight is that the missing relations (`jlama-cli → jlama-core`, `jlama-cli → jlama-net`,
`jlama-net → jlama-core`) are all **explicitly declared** in `pom.xml` files that already exist
on disk. ArchGuard simply never reads them.

The existing `DependencyExtractor` already parses pom.xml at the root level for external
dependencies (Maven Central). The change required is:

1. Extend the scan to each sub-module `pom.xml` (not just the root).
2. Filter the parsed `<dependency>` items to those whose `artifactId` matches a known sub-module
   in the workspace.
3. Convert matching dependencies to ArchJSON `Relation` objects with `type: 'dependency'`.

The new `MavenCrossModuleParser` class sits alongside `DependencyExtractor` in
`src/plugins/java/`. It is invoked from `parseProject()` after the `.java` file parsing loop
and its output is merged into the `relations` array before returning `ArchJSON`.

---

## 5. Resolution Strategy: artifactId to Package Entity ID

Maven `artifactId` values (e.g. `jlama-core`) are not Java package names. The Java entity IDs in
ArchJSON are dotted package paths (e.g. `com.github.tjake.jlama.core.FloatType`). To emit a
`Relation` from `jlama-cli` to `jlama-core`, both endpoints need to be expressed as entity or
package IDs that the diagram renderer can use.

**Strategy**: Use the sub-module's root Java package as the representative package ID.

For each sub-module directory (e.g. `jlama-core`), the already-parsed `entities` list contains
entities with source locations under `jlama-core/src/...`. From those source paths, extract the
sub-module name (first path component relative to `workspaceRoot`). Build a map:

```
sub-module directory name → Set<entity.id> for all entities in that sub-module
```

When emitting a cross-module relation from module `A` to module `B`:
- `source`: the Java package ID of the `A` module. Derive from the common package prefix of all
  entities in `A`, or use a synthetic ID `module:<artifactId>`.
- `target`: the Java package ID of the `B` module. Same derivation.

The diagram renderer groups entities by their source-file module prefix when building the
package flowchart. If it encounters a `dependency` relation whose `source` or `target` does not
match any individual entity but does match a module group prefix, it will render the arrow at
the module level. **No renderer changes are needed** if the relation source/target IDs use
the same prefix that the grouper uses for module identification.

The safest approach: use the most common top-level package segment of each sub-module's entities
as the relation endpoint. For `jlama-core` entities with IDs like
`com.github.tjake.jlama.core.*`, the prefix is `com.github.tjake.jlama.core`. This matches the
group key the renderer already uses.

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sub-module `artifactId` differs from directory name | Low | Medium | Parse `<artifactId>` from the sub-module's own pom.xml rather than using directory name; build both artifact→dir and dir→artifact maps |
| Multiple levels of sub-modules (nested multi-module) | Medium | Low | Initial implementation handles one level deep (`*/pom.xml`); recursive glob added only if needed |
| `<scope>test</scope>` dependencies produce noise | Low | Low | Filter out test-scope dependencies; they represent test infrastructure coupling, not production module coupling |
| `<dependencyManagement>` entries without `<version>` emit incomplete records | Medium | Low | `<dependencyManagement>` entries are not direct dependencies; skip them (only process top-level `<dependencies>` in the module's own pom, not the root BOM) |
| Optional dependencies (`<optional>true</optional>`) | Low | None | Include them (they are real dependencies even if optional); mark `optional: true` in the Relation metadata if needed |
| Gradle-only projects | Medium | None | This change is Maven-only; Gradle support is a separate future effort |
| Deduplication with existing class-level relations | Low | None | Both class-level and pom.xml-level relations use `type: 'dependency'`; the seen-set dedup in `mapRelations()` prevents duplicates |
| Regex XML parsing misses `<dependency>` blocks with unusual whitespace | Low | Low | Use the same regex approach as `DependencyExtractor`; handle multi-line blocks with `gs` flag |

---

## 7. Scope

| File | Change | Estimated lines |
|------|--------|-----------------|
| `src/plugins/java/maven-crossmodule-parser.ts` | New file: `MavenCrossModuleParser` class — glob sub-module poms, parse `<dependency>` blocks, resolve artifactId to module, emit `ModuleDependency[]` | ~100 lines |
| `src/plugins/java/index.ts` | `parseProject()`: after `.java` parsing loop, call `MavenCrossModuleParser`, build module→entity-prefix map, merge cross-module relations into `relations` array | ~25 lines |
| `tests/unit/plugins/java/maven-crossmodule-parser.test.ts` | New file: unit tests for `MavenCrossModuleParser` (parse, resolve, filter scope, dedup) | ~120 lines |
| `tests/unit/plugins/java/java-plugin.test.ts` | New test group: `parseProject cross-module relations` using an in-memory fixture | ~60 lines |

No changes required to:
- `src/plugins/java/archjson-mapper.ts` — entity and class-level relation mapping unchanged
- `src/plugins/java/types.ts` — no new raw types needed
- `src/plugins/java/dependency-extractor.ts` — external dependency extraction unchanged
- `src/types/index.ts` — `RelationType` already includes `'dependency'`
- Any diagram renderer — they already handle `dependency` relation type at package level

---

## 8. Test Strategy

### Unit tests for `MavenCrossModuleParser`

1. **Parse single sub-module pom with one dependency**: verify returns `[{ from: 'jlama-cli', to: 'jlama-core' }]`.
2. **Parse pom with multiple dependencies**: verify all intra-workspace deps returned, external deps (non-matching artifactId) excluded.
3. **Scope filtering**: `<scope>test</scope>` dependency excluded; `<scope>runtime</scope>` included; `<scope>provided</scope>` included; no `<scope>` tag defaults to included.
4. **artifactId not in workspace**: dependency on `jackson-databind` (external) produces no output.
5. **Multiple sub-modules**: three sub-module poms with overlapping dependencies; verify all resolved pairs returned; no duplicates.
6. **Missing pom.xml**: sub-module directory without pom.xml skipped gracefully.
7. **`<dependencyManagement>` section**: entries under `<dependencyManagement>` not emitted as cross-module relations.

### Integration tests for `JavaPlugin.parseProject()`

8. **Full pipeline**: in-memory fixture with two sub-modules (pom.xml content as strings, `.java` file content as strings); verify `ArchJSON.relations` contains the expected cross-module `dependency` entries in addition to the class-level ones.
9. **Jlama-like fixture**: three modules (`cli`, `net`, `core`); `cli/pom.xml` declares deps on `core` and `net`; `net/pom.xml` declares dep on `core`; verify all three relations present.

---

## Appendix: Jlama pom.xml evidence

`jlama-cli/pom.xml` (excerpt):
```xml
<dependency>
  <groupId>com.github.tjake</groupId>
  <artifactId>jlama-core</artifactId>
</dependency>
<dependency>
  <groupId>com.github.tjake</groupId>
  <artifactId>jlama-net</artifactId>
</dependency>
```

`jlama-net/pom.xml` (excerpt):
```xml
<dependency>
  <groupId>com.github.tjake</groupId>
  <artifactId>jlama-core</artifactId>
</dependency>
```

These three declarations are the source of truth for the three missing relations. The
`MavenCrossModuleParser` reads them directly and converts them to ArchJSON `Relation` objects,
bypassing the class-level import approximation entirely.
