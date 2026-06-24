# Proposal: Architecture Quality Improvements (Phases 101–106)

## Background

ArchGuard self-analysis (June 2026) revealed 6 actionable issues via MCP query tools:

- **P0 Bug**: `--output-scope method --query-format edge-list` crashes at runtime — `findEntity()` returns `EdgeListOutput` but call sites cast it to `Entity[]` unconditionally.
- **P1 God file**: `generator.ts` (963 lines) contained ~10 private methods duplicated verbatim from `generator-formatting.ts`, which already exported all of them.
- **P2 High out-degree**: `GoPlugin` in `src/plugins/golang/index.ts` (764 lines, out-degree 29) concentrated atlas coordination and test analysis alongside core parsing.
- **P3 Layer violation**: CLI processors directly imported from `@/parser` and `@/mermaid` rather than through `src/core/interfaces/`.
- **P4 Mixed responsibilities**: `arch-json-provider.ts` (667 lines) mixed type declarations, utility functions, and the main class.
- **P5 Documentation gap**: No note about MCP reconnect requirement after `npm run build`.

## Goals

1. Fix the P0 crash so edge-list queries work with all output scopes.
2. Remove duplicate code from `generator.ts` to use the canonical `generator-formatting.ts` utilities.
3. Reduce `GoPlugin` out-degree by extracting `GoAtlasCoordinator` and `GoTestAnalyzer`.
4. Add facade interfaces in `src/core/interfaces/` to formalise CLI–Parser and CLI–Mermaid contracts.
5. Split `arch-json-provider.ts` into focused files with backward-compatible re-exports.
6. Document the MCP reconnect step in `CLAUDE.md` and update `architecture.md` to reflect new modules.

## Solution Design

### P0 — `toDisplayEntities()` helper

Add a `toDisplayEntities(raw)` function in `query.ts` that checks `Array.isArray(raw)` before casting, and unwraps `EdgeListOutput.entities` when needed. Replace all 6 cast sites with this function.

### P1 — Remove duplicate private methods from `generator.ts`

`generator-formatting.ts` (197 lines) already exports `escapeId`, `normalizeEntityName`, `sanitizeType`, `shouldIncludeMember`, `getVisibilitySymbol`, `generateMemberLine`, `generateRelationLine`, `isNoisyTarget`, `generateClassDefinition`. Import these (with `_` aliases) and delete the 10 duplicate private methods. Expected reduction: 963 → ~640 lines.

### P2 — Extract `GoAtlasCoordinator` and `GoTestAnalyzer`

- `go-atlas-coordinator.ts`: owns `buildAtlasFromRawData()` + `renderLayer()`, self-constructs `BehaviorAnalyzer` / `AtlasRenderer` / `GoModResolver`.
- `go-test-analyzer.ts`: owns `isTestFile()` + `extractTestStructure()`, receives `cachedModuleName` in constructor.
- `GoPlugin.initialize()` creates both coordinators; delegation replaces the ~150 lines of atlas + test logic. Out-degree: 29 → 18.

### P3 — Facade interfaces

Add `IParserFacade` (`parseFiles(filePaths): Promise<ArchJSON>`) and `IRendererFacade` (`generateOnly(...)`) in `src/core/interfaces/`. `ParallelParser` and `MermaidDiagramGenerator` declare conformance. Re-export from `src/core/interfaces/index.ts`.

### P4 — Split `arch-json-provider.ts`

- `arch-json-provider-types.ts`: `ArchJsonProviderOptions`, `ArchJsonGetOptions`
- `arch-json-utils.ts`: `hashSources()`, `deriveSubModuleArchJSON()`
- `arch-json-provider.ts`: retains `ArchJsonProvider` class + re-exports types and utilities for backward compat.

### P5 — Documentation

Add step 7 to the Development Workflow in `CLAUDE.md`. Update `docs/dev-guide/architecture.md` to document `GoAtlasCoordinator`, `GoTestAnalyzer`, and `generator-formatting.ts` delegation.

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| Facade types only (chosen) | Minimal churn, no DI framework needed | Layer coupling still exists at injection sites |
| Full DI container | Complete decoupling | Major rewrite, test disruption |
| Leave generator.ts as-is | Zero risk | Code duplication, maintenance debt |

## Risks

- Spy paths in Atlas tests break when `goModResolver` moves inside `atlasCoordinator` — fix: update `(plugin as any).atlasCoordinator.goModResolver`.
- `generator.ts` call sites must map `this.method()` → imported module-level calls before deleting the private methods.
