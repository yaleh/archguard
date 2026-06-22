# Proposal: Architecture Quality Quick Wins

## Background

ArchGuard self-analysis (June 2026) surfaced three actionable improvements across different time horizons. Two are structural concerns discovered via MCP query tools; one is a configuration hygiene issue discovered during manual analysis.

The three issues are prioritised by impact and implementation cost:

- **P4 — Configuration hygiene (10 min)**: The `experiments/` directory contains standalone TypeScript experiment scripts that import types from `src/` via path aliases and reference external globals (`RuntimeError`, etc.) that have no entity IDs in the parsed ArchJSON, producing ~17 dangling-relation warnings per run in `generator-validation.ts`. The `**/experiments/**` glob is already in `archguard.config.json`'s `exclude` array and the micromatch engine correctly matches it against `experiments/granularity/lib/llm-client.ts` (depth-1 files included — `**` matches zero path components). However, the TypeScript Plugin path (Path A in `ArchJsonProvider`) uses ts-morph's `addSourceFilesAtPaths`, which resolves path aliases (`@/types/*`, `@/parser/*`) and transitively loads any `.ts` file reachable via import resolution — including experiment files that import from `src/` even if the experiment files themselves are excluded from the glob. The relation extractor then emits relations pointing to the experiment file's own symbols, which are absent from the entity set. The config-level glob excludes the *file* from being parsed, but not the *symbols* imported from `src/` that appear as relation targets inside the experiment file.

- **P2 — QueryEngine SRP violation (~1 day)**: `src/core/query/query-engine.ts` originally held all query, metrics, and coverage logic. Phase 96 extracted `ArchMetrics` into `src/core/query/arch-metrics.ts`, but `QueryEngine` itself still acts as a transparent facade over `ArchMetrics` for six pure pass-through methods, while simultaneously handling entity traversal, BFS, output formatting, Atlas accessors, test-analysis accessors, and caller graph traversal. The class declares 26 named members (including constructor and one private method) across 492 lines — well above the single-responsibility threshold.

- **P1 — ArchJSON mutability and wide fan-in (~2 days)**: The `ArchJSON` interface defined in `src/types/index.ts` has 46 direct importer files across the codebase (confirmed via grep). All fields are mutable (`string`, `Entity[]`, `Relation[]`, etc.) — no `readonly` modifiers are applied. The `extensions?: ArchJSONExtensions` container introduced by ADR-002 (`src/types/extensions/index.ts`) is the correct isolation mechanism for plugin-specific data, but the four current extension namespaces (`goAtlas`, `projectSemantics`, `tsAnalysis`, `testAnalysis`) are accessed inconsistently — some callers reach directly into `archJson.extensions?.goAtlas?.layers`, bypassing the accessor layer in `QueryEngine`.

## Goals

1. Eliminate dangling-relation warnings from experiment scripts during ArchGuard self-analysis without breaking experiment workflows.
2. Reduce `QueryEngine` responsibility surface so each logical concern (graph traversal, metrics delegation, output formatting, extension access) lives in a named unit.
3. Add `readonly` modifiers to `ArchJSON` core fields and enforce that plugin code accesses extension data through typed accessors, reducing the blast radius of future schema changes.
4. Introduce a schema version constant on `ArchJSON` that can be checked at runtime during migration.

## Solution Design

### P4 — Eliminate dangling-relation warnings from experiment imports

**Root cause (verified)**: The glob-exclusion approach (`**/experiments/**`) works correctly at the file-discovery level — micromatch confirms the pattern matches `experiments/granularity/lib/llm-client.ts` (depth ≥ 1) and depth-0 entries like `experiments/foo.ts` are never reachable because `FileDiscoveryService` always expands `experiments/**` from an absolute resolved path that already filters them. The actual mechanism producing the 17 warnings is distinct:

1. The TypeScript Plugin (Path A in `src/cli/processors/arch-json-provider.ts`) calls `TypeScriptPlugin.initTsProject`, which invokes `project.addSourceFilesAtPaths([workspaceRoot + '/**/*.{ts,tsx}', ...excludePatterns])`.
2. ts-morph's `addSourceFilesAtPaths` applies the glob excluding `experiments/` files, so experiment source files are not parsed.
3. However, any `src/` file that is parsed may contain an import resolved via ts-morph's TypeChecker to an experiment file if a path alias (e.g. `@/utils/*`) resolves to a file inside `experiments/` (unlikely) — **or** more commonly: the experiment files themselves import `from '@/types/index.js'`, causing the TypeChecker to register those imports. The `RelationExtractor` then records edges from the experiment entity (which was not excluded from the TypeChecker's resolved universe) to `src/` entities, but the *source* of those relations (the experiment entity) is absent from `archJson.entities`. This produces `source: <experiment-entity-id>` warnings in `validateGeneratorInput`.

**Investigation required before fix**: Capture the exact warning text from a live run to confirm whether the missing side is `source` (experiment → src) or `target` (src → experiment). This determines whether the fix is on the relation-extractor side (skip relations whose source file matches an exclude pattern) or on the glob side.

**Proposed fix (pending live-run confirmation)**:

Option A (if source-side warnings): In `src/parser/typescript-parser.ts`, in the `parseProject` method's `resolvedRelations` map step (the loop over `fsProject.getSourceFiles()`), after building each relation's `scopedSource` ID, check whether the source file path matches any exclude pattern and skip the relation. The `RelationExtractor` itself (`src/parser/relation-extractor.ts`) operates on `SourceFile` objects and has no exclude-pattern awareness — the filter belongs in `parseProject` which holds both the file path and the exclude pattern list. The TypeScript plugin (`src/plugins/typescript/index.ts`) passes `config.excludePatterns` to `initTsProject` and thereby to `parseProject`, so the exclude list is available at the injection site.

Option B (if target-side warnings, i.e. experiments import `src/` symbols that become dangling targets): The experiments are not parsed, so this scenario implies ts-morph is somehow including them via transitively resolved imports. In that case, the fix is to add `"experiments/**"` as a `tsconfig.json` `exclude` entry rather than an ArchGuard config entry, so ts-morph never loads those files at all.

**Interim workaround (safe, zero-risk)**: Add `"experiments/**"` to `archguard.config.json` as a belt-and-suspenders pattern alongside `**/experiments/**`. While the glob is already functionally correct, the redundant pattern makes the intent explicit and guards against future refactors of `FileDiscoveryService` that might change glob anchoring:

```json
{
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/__tests__/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/experiments/**",
    "experiments/**",
    "**/scripts/**",
    "**/.archguard/**"
  ]
}
```

The real fix is structural (Option A or B above). The config change alone will NOT eliminate warnings that originate from TypeChecker-resolved imports rather than direct file inclusion.

### P2 — QueryEngine responsibility decomposition

**Current state**: `src/core/query/query-engine.ts` (492 lines, 32 named members: 5 private fields + constructor + 26 public/private methods) contains:

| Concern | Methods |
|---|---|
| Entity search | `findEntity`, `findByType`, `findByAttr`, `findByTypeAndAttr`, `getFileEntities` |
| Graph traversal | `getDependencies`, `getDependents`, `findImplementers`, `findSubclasses`, `findCallers`, private `bfs` |
| Output formatting | `applyOutputOptions`, `toSummary` |
| Caller graph traversal | `findCallers`, private `bfs` |
| Metrics delegation | `findHighCoupling`, `findOrphans`, `findInCycles`, `getCycles`, `getSummary`, `getPackageStats`, `getPackageCoverage`, `getEntityCoverage` |
| Extension accessors | `getAtlasLayer`, `hasAtlasExtension`, `getTestAnalysis`, `hasTestAnalysis` |
| Scope access | `getScopeEntry` |

Six of the metrics-delegation methods (`findHighCoupling`, `findOrphans`, `findInCycles`, `getPackageCoverage`, `getEntityCoverage`, `getPackageStats`) are pure pass-through wrappers over `ArchMetrics`. `getCycles` reads from `this.index` directly. `getSummary` adds `language`, `kind`, and `capabilities` to the `ArchMetrics.getSummary()` result — it has non-trivial coordination logic and should remain on `QueryEngine`. `findCallers` was added in Phase 89 (call-graph extraction) and drives BFS over call edges; it also remains on `QueryEngine`.

**Proposed decomposition**: Extract two narrow interfaces without breaking existing callers.

**Step A — `ExtensionAccessor` mixin**

Extract the four Atlas/test-analysis accessor methods (`getAtlasLayer`, `hasAtlasExtension`, `getTestAnalysis`, `hasTestAnalysis`) into a thin `ExtensionAccessor` class in `src/core/query/extension-accessor.ts`. `QueryEngine` embeds an instance and delegates to it; callers that currently call `engine.getAtlasLayer()` continue to work without change.

```
src/core/query/
  extension-accessor.ts     ← new: GoAtlas + TestAnalysis read accessors
  query-engine.ts           ← delegates to ExtensionAccessor; metrics delegation unchanged
  arch-metrics.ts           ← unchanged (already extracted in Phase 96)
```

**Step B — `EntityQueryService` extraction**

Extract the five entity-search methods (`findEntity`, `findByType`, `findByAttr`, `findByTypeAndAttr`, `getFileEntities`) into `src/core/query/entity-query-service.ts`. `QueryEngine` becomes a coordinator that holds an `EntityQueryService` and delegates the search calls. The public API of `QueryEngine` remains identical — no callers change.

```
src/core/query/
  entity-query-service.ts   ← new: entity search (5 methods)
  query-engine.ts           ← coordinator: graph traversal + delegation + output formatting
```

After Steps A + B, `QueryEngine` named member count drops from 32 to ≤ 23 (5 fields replaced with 3 service references + constructor + remaining methods after extracting 9 methods).

**Step C — optional, deferred**: If a future self-analysis shows `arch-metrics.ts` itself is approaching the threshold (currently 562 lines, 9 methods), split `PackageStats` path logic (`getPackageStats`, `getKotlinPackageStats`) into `src/core/query/package-stats.ts`.

No public API changes. The `QueryEngine` class signature and all `engine.*` call sites in `src/cli/mcp/tools/` and `src/cli/query/` remain unchanged.

### P1 — ArchJSON immutability and schema version

**Problem**: Any field in `ArchJSON` (`src/types/index.ts`, lines 69–94) can be mutated post-construction. With 46 importer files, an accidental write to `archJson.entities` (e.g. `archJson.entities.push(...)` in a plugin mapper) silently corrupts query results. The `version` field is typed as `string`, with no validation that its value matches the schema the consumer expects.

**Proposed changes**:

**Step A — `readonly` core fields**

Mark the stable structural fields of `ArchJSON` as `readonly`:

```typescript
export interface ArchJSON {
  readonly version: string;
  readonly language: SupportedLanguage;
  readonly timestamp: string;
  readonly sourceFiles: readonly string[];
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  modules?: readonly Module[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly workspaceRoot?: string;
  extensions?: ArchJSONExtensions;   // mutable: plugins may attach lazily
  metrics?: ArchJSONMetrics;         // mutable: computed post-parse
  metricVector?: import('./metric-vector.js').MetricVector;  // mutable
}
```

Leaf interfaces (`Entity`, `Member`, `Relation`, `SourceLocation`) should receive `readonly` on their primitive fields in the same pass.

**Construction-site audit (confirmed via grep)**: No production code calls `.push()` directly on `ArchJSON.entities`, `.relations`, or `.sourceFiles`. The two `push` calls in `src/plugins/golang/index.ts` (lines 243, 460) operate on `existing.sourceFiles` where `existing` is a raw intermediate `GoPkg` accumulator, not an `ArchJSON` object. Plugin mappers build arrays with `[...spread]` or array literals before assigning to the final `ArchJSON`. The `readonly` migration therefore has zero construction-site breakage risk in `src/plugins/`. The migration effort is limited to `src/parser/archjson-aggregator.ts` and any test fixtures that construct `ArchJSON` objects directly with field assignments.

**Step B — Schema version constant**

Add a module-level constant in `src/types/index.ts`:

```typescript
export const ARCHJSON_SCHEMA_VERSION = '1.1' as const;
```

Plugins that construct an `ArchJSON` object set `version: ARCHJSON_SCHEMA_VERSION`. Consumers that need migration guards check `archJson.version` against this constant. This is additive — no existing code breaks.

**Step C — Extension accessor consolidation**

`QueryEngine` already exposes typed accessors (`getAtlasLayer`, `getTestAnalysis`). Audit all callers in `src/cli/` and `src/plugins/` that access `archJson.extensions?.goAtlas` or `archJson.extensions?.testAnalysis` directly, and replace with `engine.getAtlasLayer()` / `engine.getTestAnalysis()`. This reduces the number of sites that hold a reference to the raw extensions bag.

**Circularity constraint**: Direct extension-access sites inside the query layer itself:
- `src/core/query/arch-metrics.ts` — 5 occurrences: 3 `goAtlas` accesses (lines 81, 86, 149) + 2 `testAnalysis` accesses (lines 378, 434)
- `src/core/query/query-engine.ts` — `this.archJson.extensions?.goAtlas?.layers?.package` in `getSummary` (line 183)

These MUST NOT be routed through `engine.getAtlasLayer()` because `ArchMetrics` is constructed by `QueryEngine` — a circular dependency would result. The correct migration for these sites is to route through `ExtensionAccessor` (Step A of P2), not through the public `engine` API. The `ExtensionAccessor` can be shared (injected into both `QueryEngine` and `ArchMetrics`) without circularity since it holds only `ArchJSON` as a dependency.

## Trade-off Analysis

| Item | Benefit | Cost / Risk |
|---|---|---|
| P4 config fix (belt-and-suspenders) | Makes exclude intent explicit; guards against future FileDiscoveryService refactors | One config line; zero risk |
| P4 structural fix (Option A or B) | Eliminates the actual 17 warnings by blocking TypeChecker from loading experiment symbols | Option A: 10–20 lines in `src/parser/typescript-parser.ts` (`parseProject` loop); Option B: tsconfig change (risk: excludes may affect IDE tooling) |
| P2 extraction | Lowers cognitive load on `QueryEngine`; each extracted unit is independently testable | `ExtensionAccessor` injection ordering; re-export from `query-engine.ts` to preserve callers |
| P1 `readonly` | Prevents accidental mutation; surfaces bugs at compile time | No plugin push-sites to migrate (confirmed); only `archjson-aggregator.ts` and test fixtures need attention |
| P1 schema version | Enables migration guards and version-tagged output | Pure addition; no risk |
| P1 accessor consolidation | Single extension-read path; eases future schema changes | Must avoid routing `ArchMetrics` through `engine.getAtlasLayer()` (circular); use `ExtensionAccessor` directly |

## Risks

- **P2 extraction breakage**: If any external tool (e.g., a custom MCP client) calls `engine.findHighCoupling()` via a private import of `ArchMetrics` directly, extraction could hide the method. Mitigation: all public delegation methods stay on `QueryEngine`; only internals move.
- **P2 `ExtensionAccessor` injection**: Injecting `ExtensionAccessor` into both `QueryEngine` and `ArchMetrics` creates a shared dependency. If `ExtensionAccessor` is constructed once and passed to `ArchMetrics` via its constructor, the `QueryEngine` must create it before `ArchMetrics`. This ordering is straightforward but must be maintained if the constructor signatures change. `ArchMetrics` currently accesses both `goAtlas` (3 sites) and `testAnalysis` (2 sites) — `ExtensionAccessor` must expose both accessor families.
- **P1-D partial migration**: Several `archJson.extensions?.goAtlas` accesses in `src/cli/processors/` (`diagram-output-router.ts`, `diagram-pipeline-runner.ts`) and `src/cli/query/query-artifacts.ts` operate on `ArchJSON` objects that are not yet loaded into a `QueryEngine` (they appear in routing and manifest-building steps). These sites cannot be migrated to `engine.get*()` — they must use `new ExtensionAccessor(archJson)` directly or be exempted from the consolidation scope. The P1-D acceptance criterion must reflect this: the goal is zero direct accesses in `src/core/query/` (except `ExtensionAccessor`) rather than zero direct accesses codebase-wide.
- **P1 `readonly` propagation**: Plugin construction sites are safe — no plugin code uses `.push()` on `ArchJSON.entities` or `.relations` directly (confirmed by grep). The `run-analysis.ts` test-analysis attachment (`archJson.extensions.testAnalysis = testAnalysis`) will require a type cast or a mutable interface alias. This is the highest-friction site: the `extensions` field is intentionally left mutable in the proposal, so this particular assignment is already permitted.
- **P4 warning root cause**: Adding `experiments/**` to the config excludes experiment files from file discovery but does NOT prevent ts-morph from loading them via TypeChecker import resolution. If the warnings originate from TypeChecker-resolved imports rather than directly parsed files, the config change is insufficient. A live-run diagnostic (capturing the exact `source`/`target` entity IDs in the warnings) must precede the fix choice between Option A (relation-extractor filter) and Option B (tsconfig exclude).

## Acceptance Criteria

### P4
- [ ] Diagnostic step: Run `node dist/cli/index.js analyze -v` and capture the exact entity IDs in the dangling-relation warnings to determine whether the missing side is `source` or `target`.
- [ ] Root-cause fix (Option A or B) is implemented based on the diagnostic result.
- [ ] `node dist/cli/index.js analyze -v` produces zero dangling-relation warnings after the fix.
- [ ] Files under `experiments/` do not appear in the `sourceFiles` array of the generated ArchJSON.
- [ ] `experiments/**` is added to `archguard.config.json` as a belt-and-suspenders pattern regardless of which structural fix is chosen.

### P2
- [ ] `src/core/query/entity-query-service.ts` and `src/core/query/extension-accessor.ts` exist and contain the extracted methods.
- [ ] `QueryEngine` named member count drops from 32 to ≤ 23 (after extracting 9 methods into two service classes).
- [ ] `ExtensionAccessor` covers both `goAtlas` and `testAnalysis` accessors and is shared between `QueryEngine` and `ArchMetrics` without circular dependency.
- [ ] All existing tests pass (`npm test`); no new test failures introduced.
- [ ] No changes required in `src/cli/mcp/tools/` or `src/cli/query/`.

### P1
- [ ] `ArchJSON.entities`, `ArchJSON.relations`, `ArchJSON.sourceFiles` are typed as `readonly`.
- [ ] `ARCHJSON_SCHEMA_VERSION` constant is exported from `src/types/index.ts`.
- [ ] `npm run type-check` passes with zero errors after the readonly migration.
- [ ] No plugin file uses `.push()` on `ArchJSON.entities` or `.relations` after the migration.
- [ ] At least one integration test asserts that `archJson.version === ARCHJSON_SCHEMA_VERSION`.
