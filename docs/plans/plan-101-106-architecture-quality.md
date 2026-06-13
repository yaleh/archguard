# Plan: Architecture Quality Improvements (Phases 101–106)

Proposal: [`proposal-architecture-quality-101-106.md`](../proposals/proposal-architecture-quality-101-106.md)

## Phase 101 — P0 Bug: edge-list crash in query command ✅

**File**: `src/cli/commands/query.ts`

**Root cause**: `findEntity()` returns `EdgeListOutput` when `--query-format edge-list`, but all 6 call sites cast the result to `Entity[]` unconditionally, crashing on `.map` / `formatEntityList`.

**Stage 101-A** — Add `toDisplayEntities()` helper and replace 6 cast sites.

**Stage 101-B** — Add 3 unit tests in `tests/unit/cli/commands/query.test.ts`.

**Acceptance**: `npm test` passes; `--output-scope method --query-format edge-list` does not crash.

---

## Phase 102 — P4: Split `arch-json-provider.ts` ✅

**File**: `src/cli/processors/arch-json-provider.ts` (was 667 lines)

**Stage 102-A** — New `arch-json-provider-types.ts`: `ArchJsonProviderOptions`, `ArchJsonGetOptions`.

**Stage 102-B** — New `arch-json-utils.ts`: `hashSources()`, `deriveSubModuleArchJSON()`.

**Stage 102-C** — `arch-json-provider.ts` retains `ArchJsonProvider` class and re-exports types/utils for backward compat.

**Acceptance**: `npm test` passes; main file < 520 lines.

---

## Phase 103 — P3: Facade interfaces for CLI–Parser and CLI–Mermaid ✅

**Files**: `src/core/interfaces/parser-facade.ts`, `renderer-facade.ts`, `index.ts`

**Stage 103-A** — `IParserFacade`: `parseFiles(filePaths: string[]): Promise<ArchJSON>`.

**Stage 103-B** — `IRendererFacade`: `generateOnly(archJson, outputOptions, level, diagramConfig?): Promise<RenderJob[]>`.

**Stage 103-C** — `ParallelParser` and `MermaidDiagramGenerator` declare `implements` conformance.

**Acceptance**: `npm run type-check` passes; interfaces visible in `src/core/interfaces/index.ts`.

---

## Phase 104 — P1: Remove duplicate methods from `generator.ts` ✅

**File**: `src/mermaid/generator.ts` (was 963 lines)

**Root cause**: ~10 private methods in `ValidatedMermaidGenerator` were verbatim duplicates of exports in `generator-formatting.ts`.

**Stage 104-A** — Add imports from `generator-formatting.ts` with aliased names (`_sanitizeType`, `_generateMemberLine`, etc.).

**Stage 104-B** — Update all call sites from `this.method(...)` to imported functions.

**Stage 104-C** — Delete the 10 private duplicate method bodies.

**Acceptance**: `npm test` passes; `generator.ts` reduced from 963 → ~645 lines.

---

## Phase 105 — P2: GoPlugin decouple ✅

**File**: `src/plugins/golang/index.ts` (was 764 lines, out-degree 29)

**Stage 105-A** — New `go-atlas-coordinator.ts`: `GoAtlasCoordinator` with `buildAtlasFromRawData()` + `renderLayer()`. Self-constructs `BehaviorAnalyzer`, `AtlasRenderer`, `GoModResolver`.

**Stage 105-B** — New `go-test-analyzer.ts`: `GoTestAnalyzer` with `isTestFile()` + `extractTestStructure()`.

**Stage 105-C** — `GoPlugin.initialize()` creates both coordinators; delegation replaces ~150 lines of atlas + test logic. Update Atlas test spy paths to `(plugin as any).atlasCoordinator.goModResolver`.

**Acceptance**: `npm test` passes; `index.ts` out-degree ≤ 18; `GoAtlasCoordinator` and `GoTestAnalyzer` files < 120 lines each.

---

## Phase 106 — P5: Documentation ✅

**Files**: `CLAUDE.md`, `docs/dev-guide/architecture.md`

**Stage 106-A** — Add step 7 to Development Workflow in `CLAUDE.md`: MCP reconnect note after rebuild.

**Stage 106-B** — Update `docs/dev-guide/architecture.md` §2.6 to document `GoAtlasCoordinator`, `GoTestAnalyzer`, and `generator-formatting.ts` delegation.

**Acceptance**: Files updated; no test impact.

---

## Execution Order

```
101 (bug)  → independent
102 (split) → independent
103 (interfaces) → after 102 preferred
104 (generator) → independent
105 (goplugin) → independent
106 (docs) → after 104 and 105
```

## Global Acceptance

```bash
npm run build       # 0 errors
npm test            # 3737+ tests pass
npm run type-check  # 0 errors
node dist/cli/index.js query --entity QueryEngine --output-scope method --query-format edge-list
```
