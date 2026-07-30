---
id: TASK-37
title: Decouple language extractors from node-tree-sitter runtime types
status: ready
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

- [ ] No language bridge or builder imports runtime values or types directly
      from `tree-sitter`.
- [ ] The internal node facade includes only APIs used by ArchGuard.
- [ ] All five plugins obtain parser sessions through dependency injection
      during `initialize()`.
- [ ] Native parsing produces unchanged ArchJSON for the existing fixtures.
- [ ] Parser/tree disposal behavior is tested.
- [ ] Runtime initialization errors retain language and backend context.

## Definition of Done

- [ ] Type-check, unit, integration, and existing native parser tests pass.
- [ ] Refactor and parity evidence are committed.

## Coordination

TASK-38 builds the WASM backend on this facade. TASK-39 adds selection policy
after both backends exist.
