# Proposal: GoPlugin God Object 拆分

## Background

`GoPlugin` in `src/plugins/golang/index.ts` is 596 lines long and has 17 unique import-module dependencies (19 `import` keyword lines, counting two modules that require two separate import statements each). It directly instantiates and coordinates five distinct services: `TreeSitterBridge` (AST parsing), `InterfaceMatcher` + `GoplsClient` (type-level interface resolution via gopls language server), `ArchJsonMapper` (entity/relation mapping), `GoAtlasCoordinator` (four-layer Atlas generation), and `GoTestAnalyzer` (test structure extraction). These are five separate responsibility domains packed into one class.

The consequence is that a change to any one concern — e.g. adding a new Atlas layer, fixing gopls initialization order, or changing Go module name resolution — requires reading and modifying this 596-line monolith, and risks unintended side-effects on the other four concerns. Test isolation is also difficult: unit tests that only need to verify ArchJSON mapping must construct a fully initialized `GoPlugin` instance (including tree-sitter WASM loading and gopls optional startup), inflating test setup complexity and test fragility. The class also violates the Single Responsibility Principle: `readModuleName()` and `ensureInitialized()` are internal lifecycle helpers that do not belong alongside public ILanguagePlugin surface.

This refactor extracts the five responsibility domains into dedicated, independently testable units while keeping the `ILanguagePlugin` + `IGoAtlas` public interface contracts intact.

## Goals

1. `GoPlugin`'s direct import count reduced to ≤12, verifiable by: `grep -c "^import" src/plugins/golang/index.ts`
2. A new `GoParseCoordinator` (or equivalent) class owns file-globbing, package merging, orphaned-method re-attachment, and gopls initialization; its line count is ≤200, verifiable by: `wc -l src/plugins/golang/go-parse-coordinator.ts`
3. `readModuleName` extracted into a standalone `GoModReader` utility; verifiable by: `grep -rn "readModuleName\|GoModReader" src/plugins/golang/`
4. All existing tests continue to pass without modification: `npm test -- --reporter=verbose 2>&1 | tail -5`
5. `GoPlugin.parseProject` delegates rawData building to `GoParseCoordinator` and Atlas building to `GoAtlasCoordinator` with no inline file I/O in `parseProject` or `parseToRawData`; verifiable by: `! grep -qn "fs\.readFile\|glob(" src/plugins/golang/index.ts` (exits 0 when no matches; note: `fs.existsSync` in `canHandle` is intentionally retained as it is part of the public `ILanguagePlugin` surface)

## Proposed Approach

Extract two new collaborator classes and one utility function from `GoPlugin` to cover the five responsibility domains (two of the five — `GoAtlasCoordinator` and `GoTestAnalyzer` — already exist as separate classes and are retained as-is):

**GoParseCoordinator** — owns the file-discovery loop (glob), per-file parse delegation to `TreeSitterBridge`, package merging by `fullName`, orphaned-method re-attachment, and `readModuleName`. `GoPlugin.parseToRawData` and `parseFiles` become thin delegates.

**GoplsInterfaceResolver** — wraps `GoplsClient` initialization and the conditional `matchWithGopls` / `matchImplicitImplementations` fallback. `GoPlugin` and `GoParseCoordinator` call this through a single `resolve(structs, interfaces): Promise<Implementation[]>` method, eliminating the inline gopls-null-guard branches scattered across `parseCode`, `parseFiles`, and `parseProject`.

**GoModReader** — a single exported function `readModuleName(workspaceRoot): Promise<string>`, extracted from the private `readModuleName` method. Both `GoPlugin.initialize` and `GoParseCoordinator` share this utility without duplication.

`GoAtlasCoordinator` and `GoTestAnalyzer` already exist as separate classes and are not moved; `GoPlugin` continues to hold them as coordinator references.

`GoPlugin` itself becomes a thin facade: it implements `ILanguagePlugin` + `IGoAtlas` by delegating to four collaborators — `GoParseCoordinator`, `GoplsInterfaceResolver`, `GoAtlasCoordinator`, and `GoTestAnalyzer` (`GoModReader` is a shared utility function, not a held reference) — with its own body containing only `initialize`, `dispose`, `canHandle`, `isTestFile`, `extractTestStructure`, and lightweight delegation methods.

The `ILanguagePlugin` interface, all CLI flags (`--atlas`, `--atlas-layers`, etc.), and the MCP tool surface remain unchanged.

## Trade-offs and Risks

**Not doing**: We are not changing the `GoAtlasCoordinator` internals, not splitting `ArchJsonMapper`, and not altering the `IGoAtlas` interface. These are out of scope to keep the diff focused and reviewable.

**Not doing**: We are not introducing dependency injection containers or interface abstractions for the new internal collaborators. The goal is structural decomposition, not framework introduction.

**Risk — initialization ordering**: `GoPlugin.initialize` currently reads `go.mod` once and shares the result with `GoTestAnalyzer`. After extraction, `GoModReader` must be called before `GoTestAnalyzer` is constructed; the new `GoParseCoordinator.initialize` sequence must preserve this ordering.

**Risk — `parseToRawData` public API**: This method is part of the public API used by tests. Its signature (`workspaceRoot, config`) must not change; the extraction must keep it as a forwarding method on `GoPlugin`.

**Alternative considered**: Merging all concerns into a single `GoLanguageService` with sub-modules via namespaced classes. Rejected because it preserves the same coupling problem under a different name.
