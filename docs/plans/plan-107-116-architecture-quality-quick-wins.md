# Plan: Architecture Quality Quick Wins (Phases 107–116)

Proposal: [`proposal-architecture-quality-quick-wins.md`](../proposals/proposal-architecture-quality-quick-wins.md)

## Overview

Three targeted improvements derived from ArchGuard self-analysis (June 2026). Implemented in dependency order: P4 (experiments exclusion, zero risk) → P2 (QueryEngine SRP, additive extraction) → P1 (ArchJSON readonly + schema version, structural hardening).

Phase summary:

| Phase | Item | Description | LOC delta |
|-------|------|-------------|-----------|
| 107 | P4-A | Diagnose dangling-relation warnings (live run) | ~0 |
| 108 | P4-B | Structural fix: experiment-source relation filter in `typescript-parser.ts` | ~30 |
| 109 | P2-A | Extract `ExtensionAccessor` | ~80 |
| 110 | P2-B | Extract `EntityQueryService` | ~100 |
| 111 | P2-C | Wire coordinator + inject `ExtensionAccessor` into `ArchMetrics` | ~60 |
| 112 | P1-A | `readonly` on `ArchJSON` core fields | ~40 |
| 113 | P1-B | `readonly` on `Entity`, `Member`, `Relation`, `SourceLocation` | ~60 |
| 114 | P1-C | `ARCHJSON_SCHEMA_VERSION` constant + plugin construction sites | ~30 |
| 115 | P1-D | Extension accessor consolidation audit + fixes | ~50 |
| 116 | P1-E | Integration test: version assertion + readonly smoke | ~40 |

Total: ~490 LOC across 10 phases.

---

## Phase 107 — P4-A: Diagnose dangling-relation warnings

**Goal**: Identify whether the 17 dangling-relation warnings originate on the `source` side (experiment entity → src entity) or `target` side (src entity → experiment entity).

**Dependencies**: None.

### Stage 107-A — Belt-and-suspenders config update

Add `"experiments/**"` to `archguard.config.json` alongside the existing `"**/experiments/**"` to make the exclusion intent explicit and guard against future `FileDiscoveryService` refactors:

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

**LOC delta**: +1 line in `archguard.config.json`.

### Stage 107-B — Capture live warning text

Run `node dist/cli/index.js analyze -v` and record the exact entity IDs printed in the dangling-relation warning block from `validateGeneratorInput`. Confirm whether the missing side is `source` or `target`. Document the result as a comment in the follow-up Phase 108 PR.

**LOC delta**: 0 (diagnostic only).

### Acceptance criteria — Phase 107

- [ ] `experiments/**` is added to `archguard.config.json`.
- [ ] A live-run captures exact warning entity IDs and confirms source-vs-target direction.
- [ ] `npm test` passes (config change does not affect test suite).

---

## Phase 108 — P4-B: Structural fix — relation-extractor source filter

**Goal**: Eliminate the 17 dangling-relation warnings at the structural level, based on the Phase 107 diagnostic.

**Dependencies**: Phase 107 diagnostic result.

### Stage 108-A — Option A (source-side warnings, expected case)

The ts-morph `Project` loads experiment files transitively via path alias resolution even though the glob excludes them from `addSourceFilesAtPaths`. The `RelationExtractor` (`src/parser/relation-extractor.ts`) extracts relations from whatever `SourceFile` objects exist in the `Project`. The scoping and file-path mapping happens in `src/parser/typescript-parser.ts`, `parseProject()`, in the `resolvedRelations` map step (the loop at approximately line 216). That is the correct fix site — **not** `src/plugins/typescript/typescript-analyzer.ts` (which only builds the module graph) and not the `RelationExtractor` itself (which has no path context).

Fix: In `src/parser/typescript-parser.ts`, inside the per-`sourceFile` loop in `parseProject`, before pushing to `relations`, skip any relation whose `scopedSource` starts with `experiments/` or contains `/experiments/`. Since `scopedSource` is constructed as `${relPath}.${rel.source}` where `relPath` is the relative path of the file, the filter is deterministic:

```typescript
// After resolvedRelations is built, before pushing:
const resolvedRelations = fileRelations.map(...).filter((rel) => {
  // Skip relations whose source is scoped to an excluded experiment file
  if (rel.source.startsWith('experiments/') || rel.source.includes('/experiments/')) {
    return false;
  }
  return true;
});
```

If the diagnostic reveals that the fix point should be in `TypeScriptPlugin.parseProject` (in `src/plugins/typescript/index.ts`) rather than `TypeScriptParser.parseProject`, apply the equivalent filter in that layer instead — both receive the `excludePatterns` array via `config.excludePatterns`.

**LOC delta**: ~15 lines (guard + comment).

### Stage 108-B — Option B (target-side warnings, fallback)

If Phase 107 reveals the missing side is `target` (experiment symbols appearing as relation targets), the fix is to add `experiments/**` to `tsconfig.json`'s `exclude` array so ts-morph never loads those files via TypeChecker import resolution.

Only one of Option A or Option B is implemented; the other is left as a comment.

### Stage 108-C — Validation test

Add a unit test in `tests/unit/plugins/typescript/` that constructs a minimal TypeScript project with an `experiments/` file importing from a `src/` module, runs the plugin with `excludePatterns: ['**/experiments/**', 'experiments/**']`, and asserts that the resulting `ArchJSON.relations` contains no relation whose `source` or `target` encodes an `experiments/` path.

**LOC delta**: ~80 lines (test file).

### Acceptance criteria — Phase 108

- [ ] `node dist/cli/index.js analyze -v` produces zero dangling-relation warnings.
- [ ] Files under `experiments/` do not appear in `archJson.sourceFiles`.
- [ ] Unit test passes confirming no experiment-path relations are emitted.
- [ ] `npm test` passes.

---

## Phase 109 — P2-A: Extract `ExtensionAccessor`

**Goal**: Extract the four Atlas/test-analysis accessor methods from `QueryEngine` into a standalone `ExtensionAccessor` class that can be shared with `ArchMetrics` without circular dependency.

**Dependencies**: None (independent of P4).

### Stage 109-A — New file `src/core/query/extension-accessor.ts`

Create `ExtensionAccessor` class holding only `ArchJSON` as a dependency:

```typescript
// src/core/query/extension-accessor.ts
import type { ArchJSON } from '@/types/index.js';
import type { GoAtlasLayers } from '@/types/extensions/go-atlas.js';
import type { TestAnalysis } from '@/types/extensions/test-analysis.js';

export class ExtensionAccessor {
  constructor(private readonly archJson: ArchJSON) {}

  /** Return a single named Atlas layer, or undefined if not present. */
  getAtlasLayer<K extends keyof GoAtlasLayers>(layer: K): GoAtlasLayers[K] | undefined {
    return this.archJson.extensions?.goAtlas?.layers?.[layer];
  }

  /**
   * Return the full Atlas layers object — needed when iterating all layers
   * (e.g. Object.values(layers) for edge-count aggregation in ArchMetrics).
   */
  getAtlasLayers(): GoAtlasLayers | undefined {
    return this.archJson.extensions?.goAtlas?.layers;
  }

  hasAtlasExtension(): boolean {
    return !!this.archJson.extensions?.goAtlas;
  }

  getTestAnalysis(): TestAnalysis | undefined {
    return this.archJson.extensions?.testAnalysis;
  }

  hasTestAnalysis(): boolean {
    return this.archJson.extensions?.testAnalysis !== undefined;
  }
}
```

**LOC delta**: ~35 lines (new file).

### Stage 109-B — Unit tests for `ExtensionAccessor`

New test file `tests/unit/core/query/extension-accessor.test.ts`:
- `getAtlasLayer` returns correct layer when present / undefined when absent.
- `hasAtlasExtension` returns true/false correctly.
- `getTestAnalysis` returns extension when present / undefined when absent.
- `hasTestAnalysis` returns true/false correctly.

**LOC delta**: ~60 lines (test file).

### Stage 109-C — Delegate from `QueryEngine`

In `query-engine.ts`, add `private readonly extensionAccessor: ExtensionAccessor` field constructed in the constructor; replace the four method bodies with delegation calls:

```typescript
import { ExtensionAccessor } from './extension-accessor.js';
// in constructor:
this.extensionAccessor = new ExtensionAccessor(options.archJson);
// method bodies:
getAtlasLayer<K extends keyof GoAtlasLayers>(layer: K) {
  return this.extensionAccessor.getAtlasLayer(layer);
}
// etc.
```

**LOC delta**: ~15 lines changed in `query-engine.ts`.

### Acceptance criteria — Phase 109

- [ ] `src/core/query/extension-accessor.ts` exists with 5 methods (`getAtlasLayer`, `getAtlasLayers`, `hasAtlasExtension`, `getTestAnalysis`, `hasTestAnalysis`).
- [ ] `QueryEngine` 4 extension accessor method bodies replaced with delegation calls (exact count verified in Phase 111).
- [ ] `ExtensionAccessor` unit tests pass (≥ 10 test cases, including `getAtlasLayers` returning the full layers object).
- [ ] `npm test` passes; no callers changed.

---

## Phase 110 — P2-B: Extract `EntityQueryService`

**Goal**: Extract the five entity-search methods from `QueryEngine` into `EntityQueryService`, reducing `QueryEngine`'s responsibility surface.

**Dependencies**: Phase 109 (`ExtensionAccessor` established the extraction pattern).

### Stage 110-A — New file `src/core/query/entity-query-service.ts`

```typescript
// src/core/query/entity-query-service.ts
import type { ArchJSON, Entity } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';

// QueryMethodOptions is NOT imported from query-engine.ts to avoid a circular dependency.
// EntityQueryService returns raw Entity[] only; QueryEngine wraps results with applyOutputOptions.

export class EntityQueryService {
  private readonly entityMap: Map<string, Entity>;

  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex
  ) {
    this.entityMap = new Map(archJson.entities.map((e) => [e.id, e]));
  }

  findEntity(name: string): Entity[] { ... }
  findByType(entityType: string): Entity[] { ... }
  findByAttr(key: string, value?: string | number | boolean): Entity[] { ... }
  findByTypeAndAttr(entityType: string, attrKey?: string, attrValue?: string | number | boolean): Entity[] { ... }
  getFileEntities(filePath: string): Entity[] { ... }
}
```

Note: `EntityQueryService` returns raw `Entity[]`; `QueryEngine` wraps the result with `applyOutputOptions`. This avoids passing `applyOutputOptions` into the service (which would create a reverse dependency).

**LOC delta**: ~80 lines (new file).

### Stage 110-B — Unit tests for `EntityQueryService`

New test file `tests/unit/core/query/entity-query-service.test.ts`:
- `findEntity` by exact name returns correct entities.
- `findByType` returns entities of matching type.
- `findByAttr` with key only (presence check) and key+value (equality check).
- `findByTypeAndAttr` combined filter.
- `getFileEntities` returns entities for given file path.
- Edge cases: empty index, unknown name, unknown type.

**LOC delta**: ~100 lines (test file).

### Stage 110-C — Delegate from `QueryEngine`

In `query-engine.ts`, replace the five method bodies with calls to `this.entityQueryService.*()` wrapped in `this.applyOutputOptions(...)`:

```typescript
private readonly entityQueryService: EntityQueryService;
// constructor: this.entityQueryService = new EntityQueryService(options.archJson, options.archIndex);

findEntity(name: string, options?: QueryMethodOptions) {
  return this.applyOutputOptions(this.entityQueryService.findEntity(name), options);
}
```

Remove the now-redundant `entityMap` field from `QueryEngine` (it lives in `EntityQueryService`).

**LOC delta**: ~30 lines changed in `query-engine.ts` (net reduction).

### Acceptance criteria — Phase 110

- [ ] `src/core/query/entity-query-service.ts` exists with 5 methods and does NOT import from `query-engine.ts` (no circular dependency).
- [ ] `QueryEngine.entityMap` private field removed (it lives in `EntityQueryService`).
- [ ] `EntityQueryService` unit tests pass (≥ 12 test cases).
- [ ] `npm test` passes; no callers changed.

---

## Phase 111 — P2-C: Wire coordinator and share `ExtensionAccessor` with `ArchMetrics`

**Goal**: Inject `ExtensionAccessor` into `ArchMetrics` so it can read extension data without going directly to `archJson.extensions?.goAtlas`. Fix the 5 direct-access sites in `arch-metrics.ts`.

**Dependencies**: Phase 109 (`ExtensionAccessor` exists), Phase 110 (`EntityQueryService` extracted).

### Stage 111-A — Update `ArchMetrics` constructor

Change `ArchMetrics` constructor to accept an optional `ExtensionAccessor`:

```typescript
constructor(
  private readonly archJson: ArchJSON,
  private readonly index: ArchIndex,
  private readonly extensionAccessor?: ExtensionAccessor
) { ... }
```

Replace all 5 extension-access sites in `arch-metrics.ts`:
- Lines 81 + 86 + 149: `this.archJson.extensions?.goAtlas?.layers?.package` (and `.layers` object) → `this.extensionAccessor?.getAtlasLayer('package')` (and `this.extensionAccessor?.hasAtlasExtension()` for the boolean guard on line 86).
- Lines 378 + 434: `this.archJson.extensions?.testAnalysis` → `this.extensionAccessor?.getTestAnalysis()`.

Note: line 81 accesses `extensions?.goAtlas?.layers` as an object to call `Object.values()` on — `ExtensionAccessor` will need an additional `getAtlasLayers()` method (returning `GoAtlasLayers | undefined`) to cover this use case, or the line can be left as a direct access with a comment that it cannot be routed through the single-key `getAtlasLayer` method.

**LOC delta**: ~20 lines changed in `arch-metrics.ts`.

### Stage 111-B — Pass `ExtensionAccessor` from `QueryEngine`

In `QueryEngine` constructor, pass the already-constructed `this.extensionAccessor` to `ArchMetrics`:

```typescript
this.metrics = new ArchMetrics(options.archJson, options.archIndex, this.extensionAccessor);
```

**LOC delta**: ~5 lines changed in `query-engine.ts`.

### Stage 111-C — Verify `QueryEngine` member count

Count named members in `QueryEngine` after all P2 phases. Starting count: 32 (5 private fields + constructor + 26 methods including `findCallers` added in Phase 89 and private `bfs`). After extraction of 4 atlas/test accessors (→ `ExtensionAccessor`) + 5 entity-search methods (→ `EntityQueryService`): 3 new service fields replace 5 old fields → net −2 fields; 9 methods removed → net −9 methods. Expected post-extraction count: 32 − 9 = 23 (target ≤ 23). Document the final count in a comment at the top of `query-engine.ts`.

**LOC delta**: ~5 lines (comment).

### Stage 111-D — Regression tests

Ensure that `getSummary()` on a Go Atlas scope still returns correct `capabilities.packageGraph: true`. Add a targeted test in `tests/unit/core/query/query-engine.test.ts` that constructs a `QueryEngine` with a mock `goAtlas` extension and asserts the accessor path works end-to-end.

**LOC delta**: ~40 lines (new tests).

### Acceptance criteria — Phase 111

- [ ] `arch-metrics.ts` has zero direct `archJson.extensions?.goAtlas` accesses.
- [ ] `QueryEngine` named member count ≤ 23.
- [ ] `ExtensionAccessor` is constructed once in `QueryEngine` and shared with `ArchMetrics`.
- [ ] `ExtensionAccessor` covers both `goAtlas` (including a `getAtlasLayers()` method for `Object.values()` use at arch-metrics.ts:81) and `testAnalysis` accessor families.
- [ ] No circular dependency: `ExtensionAccessor` → `ArchJSON` only; `ArchMetrics` → `ExtensionAccessor` (no cycle).
- [ ] `npm test` passes.

---

## Phase 112 — P1-A: `readonly` on `ArchJSON` core fields

**Goal**: Mark stable structural fields of `ArchJSON` as `readonly` to surface accidental mutation at compile time.

**Dependencies**: None (independent of P2).

### Stage 112-A — Modify `src/types/index.ts`

Apply `readonly` to the six stable fields:

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
  extensions?: ArchJSONExtensions;    // intentionally mutable: plugins attach lazily
  metrics?: ArchJSONMetrics;          // intentionally mutable: computed post-parse
  metricVector?: import('./metric-vector.js').MetricVector;  // intentionally mutable
}
```

**LOC delta**: ~10 lines changed in `src/types/index.ts`.

### Stage 112-B — Fix construction-site TypeScript errors

Run `npm run type-check` to discover all sites where `archJson.entities`, `.relations`, or `.sourceFiles` are assigned or mutated directly. Expected: zero plugin sites (confirmed by proposal grep). The likely sites are:
- `src/parser/archjson-aggregator.ts` — assembles the final object using spread; should be unaffected.
- Test fixtures that use `archJson.entities.push(...)` — replace with `[...archJson.entities, newEntity]` spread or typed factory.

Fix all type errors until `npm run type-check` reports zero errors.

**LOC delta**: ~20-40 lines changed across test fixtures and `archjson-aggregator.ts` (estimated).

### Acceptance criteria — Phase 112

- [ ] `ArchJSON.entities`, `.relations`, `.sourceFiles` typed as `readonly`.
- [ ] `npm run type-check` passes with zero errors.
- [ ] `npm test` passes.
- [ ] No production plugin file uses `.push()` on any `readonly` `ArchJSON` field.

---

## Phase 113 — P1-B: `readonly` on leaf interfaces

**Goal**: Apply `readonly` to primitive fields on `Entity`, `Member`, `Relation`, and `SourceLocation` for defence-in-depth.

**Dependencies**: Phase 112 (`ArchJSON` readonly already compiled clean — reduces noise in the error scan).

### Stage 113-A — `Entity` interface

Mark `id`, `name`, `type`, `visibility` as `readonly`:

```typescript
export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly visibility: Visibility;
  members: Member[];          // intentionally mutable (plugin augmentation)
  sourceLocation: SourceLocation;
  // ... optional fields unchanged
}
```

### Stage 113-B — `Member` interface

Mark `name`, `type`, `visibility` as `readonly`.

### Stage 113-C — `Relation` interface

Mark `id`, `type`, `source`, `target` as `readonly`.

### Stage 113-D — `SourceLocation` interface

Mark all three fields (`file`, `startLine`, `endLine`) as `readonly`.

### Stage 113-E — Fix downstream type errors

Run `npm run type-check`. Fix any test/plugin site that mutates these fields directly. Expected: zero sites in production code (plugins build objects from scratch); likely only test fixtures.

**LOC delta**: ~60 lines total (interface changes + any test fixture fixes).

### Acceptance criteria — Phase 113

- [ ] `Entity.id`, `.name`, `.type`, `.visibility` typed as `readonly`.
- [ ] `Relation.id`, `.type`, `.source`, `.target` typed as `readonly`.
- [ ] `SourceLocation.file`, `.startLine`, `.endLine` typed as `readonly`.
- [ ] `npm run type-check` passes with zero errors.
- [ ] `npm test` passes.

---

## Phase 114 — P1-C: `ARCHJSON_SCHEMA_VERSION` constant + plugin construction sites

**Goal**: Add a typed schema version constant and update all plugin construction sites to use it, replacing the bare `'1.0'` string literal.

**Dependencies**: Phases 112–113 (type check clean — avoids conflating errors).

### Stage 114-A — Export constant from `src/types/index.ts`

Add immediately after the `ArchJSON` interface:

```typescript
/** Current ArchJSON schema version. Increment minor on non-breaking field additions. */
export const ARCHJSON_SCHEMA_VERSION = '1.1' as const;
```

**LOC delta**: ~4 lines.

### Stage 114-B — Update ArchJSON construction sites (plugin mappers and aggregators only)

Find all `version: '1.0'` literal version strings in plugin mappers, aggregators, and parsers that construct `ArchJSON` objects. **Do not target plugin metadata versions** (`version: '1.0.0'` in `PluginMetadata` objects — those are plugin API versions, not schema versions):

```bash
grep -rn "version: '1\.0'" src/
```

This grep is scoped to ArchJSON schema version strings (e.g. `typescript-parser.ts` lines 104 + 239, `parallel-parser.ts` lines 307 + 346, `golang/index.ts` lines 200 + 276 + 351, `cpp/index.ts` lines 150 + 178, `kotlin/archjson-mapper.ts` line 206, `java/index.ts` lines 190 + 215 + 226 + 272, `python/index.ts` line 136). Do **not** replace `version: '1.0.0'` in `metadata()` / `PluginMetadata` returns.

Replace each `version: '1.0'` ArchJSON construction site with `version: ARCHJSON_SCHEMA_VERSION` (import from `@/types/index.js`).

**LOC delta**: ~20 lines across plugin and parser files.

### Stage 114-C — Update `MEMORY.md` test suite count note

After running `npm test`, update the test count line in `MEMORY.md`.

**LOC delta**: 1 line.

### Acceptance criteria — Phase 114

- [ ] `ARCHJSON_SCHEMA_VERSION` exported from `src/types/index.ts`.
- [ ] Zero bare `'1.0'` ArchJSON schema version literals remain in `src/` (plugin metadata `'1.0.0'` strings are exempt; verified by `grep -rn "version: '1\.0'" src/`).
- [ ] `npm run type-check` passes.
- [ ] `npm test` passes.

---

## Phase 115 — P1-D: Extension accessor consolidation audit

**Goal**: Audit all `src/cli/` and `src/plugins/` call sites that access `archJson.extensions?.goAtlas` or `archJson.extensions?.testAnalysis` directly and replace with `engine.getAtlasLayer()` / `engine.getTestAnalysis()` where safe.

**Dependencies**: Phase 111 (`ExtensionAccessor` shared and injection working).

### Stage 115-A — Audit direct extension access

```bash
grep -rn "extensions?\.goAtlas\|extensions?\.testAnalysis" src/
```

Expected locations (verified by grep at review time):
- `src/core/query/arch-metrics.ts` — 5 sites, already migrated to `ExtensionAccessor` in Phase 111.
- `src/core/query/query-engine.ts` — `getSummary()` line 183: `this.archJson.extensions?.goAtlas?.layers?.package`; migrate to `this.extensionAccessor.hasAtlasExtension()` or `!!this.extensionAccessor.getAtlasLayer('package')`.
- `src/cli/processors/diagram-output-router.ts` lines 93 + 264 — routing logic with only `archJSON: ArchJSON` in scope, no `QueryEngine`. Use `new ExtensionAccessor(archJSON)` or a module-level helper.
- `src/cli/processors/diagram-pipeline-runner.ts` lines 141 + 209 — same: only `ArchJSON` available; use `new ExtensionAccessor(...)`.
- `src/cli/query/query-artifacts.ts` line 75 — `buildManifestEntry` receives `ArchJSON` only; use `new ExtensionAccessor(archJson).hasAtlasExtension()`.
- `src/parser/metrics-calculator.ts` line 14 + `src/analysis/metric-vector-builder.ts` line 23 — utility functions; use `new ExtensionAccessor(archJSON)`.

For each site, determine:
1. Does the call site have access to a `QueryEngine` instance? → Replace with `engine.getAtlasLayer()` / `engine.hasAtlasExtension()`.
2. Does the call site only have `ArchJSON`? → Replace with `new ExtensionAccessor(archJson).hasAtlasExtension()` (one-liner, no need to store the accessor).

**Scope constraint**: The P1-D goal is zero direct `archJson.extensions?.goAtlas` accesses remaining **inside `src/core/query/`** (excluding `extension-accessor.ts`). Sites in `src/cli/`, `src/parser/`, and `src/analysis/` that only have bare `ArchJSON` are acceptable to migrate to `new ExtensionAccessor(archJson)` inline, but are NOT required to route through `QueryEngine`. The acceptance criterion "zero direct accesses outside `ExtensionAccessor`" applies to the core query layer only.

### Stage 115-B — Apply replacements

Apply the minimum set of replacements that eliminates direct `archJson.extensions?.goAtlas` access in `src/core/query/` (except `extension-accessor.ts`). For `src/cli/` sites, use inline `new ExtensionAccessor(archJson)` where it reduces duplication. Leave `archJson.extensions` mutable (it is intentionally mutable per proposal).

**LOC delta**: ~30 lines changed across `src/cli/` and `src/core/query/`.

### Stage 115-C — Regression test

Confirm that `archguard_get_atlas_layer` MCP tool still returns correct data on a Go Atlas scope (run against a Go project or mock ArchJSON).

### Acceptance criteria — Phase 115

- [ ] Zero `archJson.extensions?.goAtlas` direct accesses inside `src/core/query/` outside of `extension-accessor.ts`.
- [ ] `src/cli/` sites that have a `QueryEngine` instance use `engine.getAtlasLayer()` / `engine.hasAtlasExtension()`.
- [ ] `src/cli/` sites without a `QueryEngine` (routing, manifest, metric-vector) use `new ExtensionAccessor(archJson)` inline.
- [ ] `npm test` passes.

---

## Phase 116 — P1-E: Integration test — schema version + readonly smoke

**Goal**: Add at least one integration test asserting that the generated `ArchJSON` carries the correct schema version and that key fields are structurally correct.

**Dependencies**: Phases 112–115 (readonly migration complete, schema version constant set).

### Stage 116-A — Integration test

Add to `tests/integration/` (gated with the standard skip-helper when build is unavailable):

```typescript
it('archJson.version equals ARCHJSON_SCHEMA_VERSION', async () => {
  // Parse a small fixture directory
  const archJson = await plugin.parseProject(fixtureDir, config);
  expect(archJson.version).toBe(ARCHJSON_SCHEMA_VERSION);
  // Verify runtime shape (readonly is a compile-time constraint; smoke-check values)
  expect(Array.isArray(archJson.entities)).toBe(true);
  expect(Array.isArray(archJson.relations)).toBe(true);
  expect(Array.isArray(archJson.sourceFiles)).toBe(true);
});
```

**LOC delta**: ~40 lines (new test file or added to existing integration test file).

### Stage 116-B — Self-analysis smoke run

Run `node dist/cli/index.js analyze -v` after building and confirm:
- Zero dangling-relation warnings.
- ArchJSON `version` field in the output JSON reads `"1.1"`.
- `QueryEngine` member count comment in `query-engine.ts` matches reality.

**LOC delta**: 0 (validation only).

### Acceptance criteria — Phase 116

- [ ] Integration test asserting `archJson.version === ARCHJSON_SCHEMA_VERSION` passes.
- [ ] `node dist/cli/index.js analyze -v` produces zero dangling-relation warnings.
- [ ] `npm test` passes (current baseline: 2787+ tests).
- [ ] `npm run type-check` passes with zero errors.

---

## Execution Order

```
107 (P4 diagnostic)   → independent, run first
108 (P4 structural)   → after 107 (depends on diagnostic result)

109 (P2-A ExtensionAccessor) → independent (can run in parallel with P4)
110 (P2-B EntityQueryService) → after 109 (pattern established)
111 (P2-C wire + inject)      → after 109 + 110

112 (P1-A ArchJSON readonly)  → independent (can run in parallel with P2)
113 (P1-B leaf readonly)      → after 112 (type-check baseline clean)
114 (P1-C schema version)     → after 112 + 113
115 (P1-D accessor audit)     → after 111 + 112 (ExtensionAccessor ready)
116 (P1-E integration test)   → after 114 + 115 (all changes in)
```

Parallel execution paths:
- Track A: 107 → 108
- Track B: 109 → 110 → 111
- Track C: 112 → 113 → 114
- Track B+C merge: 115 → 116

---

## Global Acceptance

```bash
npm run build              # 0 errors
npm run type-check         # 0 errors
npm test                   # all tests pass
node dist/cli/index.js analyze -v  # zero dangling-relation warnings
```

Post-completion state:
- `src/core/query/` contains: `query-engine.ts`, `arch-metrics.ts`, `extension-accessor.ts`, `entity-query-service.ts`, `arch-index.ts`, `arch-index-builder.ts`, `edge-list-serializer.ts`, `output-scope-filter.ts`, `index.ts`.
- `QueryEngine` named member count ≤ 23 (down from 32).
- `ArchJSON` core fields all carry `readonly`.
- `ARCHJSON_SCHEMA_VERSION = '1.1'` exported from `src/types/index.ts`.
- Zero direct `archJson.extensions?.goAtlas` accesses outside `ExtensionAccessor`.
