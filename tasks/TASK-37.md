---
id: TASK-37
title: Decouple language extractors from node-tree-sitter runtime types
status: done
labels:
  - architecture
  - parser
  - tree-sitter
parent: TASK-31
children: []
extra: {}
---
## Proposal

Five language plugins directly import `tree-sitter`, construct its parser, and
type their extractors with `Parser.SyntaxNode`. This prevents adding a WASM
runtime without duplicating or rewriting the language-specific AST traversal.

Introduce an internal minimal syntax-tree facade that covers only the APIs
ArchGuard uses. Move native parser construction and grammar loading behind a
backend, then inject a ready parser session into each language bridge. This task
must preserve current native behavior; it does not add fallback yet.

## Plan

1. Define `SyntaxNodeLike`, `SyntaxTreeLike`, `ParserSession`, runtime kind, and
   disposal contracts in a runtime-neutral module.
2. Implement a native backend that dynamically loads `tree-sitter` and the
   requested language grammar.
3. Refactor Go, Java, Python, C++, and Kotlin bridges/builders to use the facade
   instead of `Parser.SyntaxNode` or `any`.
4. Move parser creation into each plugin's existing async `initialize()`
   lifecycle and inject it into bridges/coordinators.
5. Ensure tree/parser lifetime and disposal are explicit and do not leak across
   failed plugin initialization.
6. Preserve current ArchJSON output with snapshot/fixture tests.

## Touches

- src/plugins/shared/**
- src/plugins/golang/tree-sitter-bridge.ts
- src/plugins/golang/go-parse-coordinator.ts
- src/plugins/golang/builders/**
- src/plugins/java/tree-sitter-bridge.ts
- src/plugins/java/index.ts
- src/plugins/python/tree-sitter-bridge.ts
- src/plugins/python/index.ts
- src/plugins/cpp/tree-sitter-bridge.ts
- src/plugins/cpp/index.ts
- src/plugins/cpp/builders/**
- src/plugins/kotlin/tree-sitter-bridge.ts
- src/plugins/kotlin/index.ts
- src/plugins/kotlin/builders/**
- tests/plugins/golang/**
- tests/plugins/java/**
- tests/plugins/python/**
- tests/plugins/cpp/**
- tests/unit/plugins/kotlin/**

## Acceptance Criteria

- [x] No language bridge or builder imports runtime values or types directly
      from `tree-sitter`.
- [x] The internal node facade includes only APIs used by ArchGuard.
- [x] All five plugins obtain parser sessions through dependency injection
      during `initialize()`.
- [x] Native parsing produces unchanged ArchJSON for the existing fixtures.
- [x] Parser/tree disposal behavior is tested.
- [x] Runtime initialization errors retain language and backend context.

## Definition of Done

- [x] Type-check, unit, integration, and existing native parser tests pass.
- [x] Refactor and parity evidence are committed.

## Coordination

TASK-38 builds the WASM backend on this facade. TASK-39 adds selection policy
after both backends exist.

## Evidence

Three commits on `milestones/archguard/TASK-37`:

1. `8602fa6` — syntax-tree facade (`SyntaxNodeLike`, `SyntaxTreeLike`,
   `ParserSession`), `ParserBackend` interface, `NativeParserBackend`
   implementation in `src/plugins/shared/`. Bridge refactoring started for all
   five languages. 13 test failures (Java/Python test injection incomplete).

2. `d8527e1` — Fixed Java and Python test injection; added `.gitignore` negation
   for `archguard-project-semantics.json` fixture. All 260 test files pass,
   4083 tests pass, 0 failures.

3. `ef2933d` — Fixed GoPlugin DI: `GoParseCoordinator` now accepts
   `ParserBackend` via constructor injection, `GoPlugin` passes it through
   `initialize()`. Added `dispose()` to `GoParseCoordinator` for parser session
   cleanup. Cleaned corrupted JSDoc in Kotlin `import-resolver.ts`. All 260
   test files pass, 4083 tests pass, 0 failures.

### Verification

- **Zero direct tree-sitter imports**: No bridge or builder in Go, Java, Python,
  C++, or Kotlin imports `tree-sitter` values or types directly. All use the
  `SyntaxNodeLike`/`ParserSession` facade.
- **DI during initialize()**: All five plugins accept `ParserBackend` in their
  constructor and create a `ParserSession` during `initialize()`.
- **Disposal**: All plugins dispose their parser session in `dispose()`.
- **ArchJSON parity**: All 4083 tests pass, including fixture-based integration
  tests for all five languages.
- **Type-check**: `npx tsc --noEmit` passes cleanly.