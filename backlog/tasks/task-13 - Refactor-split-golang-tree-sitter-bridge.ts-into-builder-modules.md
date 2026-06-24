---
id: TASK-13
title: 'Refactor: split golang/tree-sitter-bridge.ts into builder modules'
status: 'Basic: Done'
assignee: []
created_date: '2026-06-23 06:29'
updated_date: '2026-06-23 08:44'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Go tree-sitter bridge decomposition — split src/plugins/golang/tree-sitter-bridge.ts (890 lines) into focused builder modules under src/plugins/golang/builders/: struct-builder.ts, interface-builder.ts, function-builder.ts, goroutine-builder.ts, and shared node-utils.ts. TreeSitterBridge becomes a facade. Mirrors C++ and Kotlin plugin pattern.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Refactor golang/tree-sitter-bridge.ts into builder modules

## Background

`src/plugins/golang/tree-sitter-bridge.ts` is 890 lines — the second-largest file in the
project. It handles four logically independent AST extraction categories (structs/type
aliases, interfaces, functions/methods, goroutine detection) plus shared node traversal
helpers, all in one monolith. A developer fixing a goroutine pattern must scroll past 500
unrelated lines of struct and interface extraction. The C++ plugin solved this exact problem
by delegating to focused builder modules (`src/plugins/cpp/builders/class-builder.ts`,
`src/plugins/cpp/builders/header-merger.ts`). The Kotlin plugin follows the same pattern
(`src/plugins/kotlin/builders/class-builder.ts`, `function-builder.ts`,
`import-resolver.ts`). The Go plugin is the only language plugin that has not yet adopted
this decomposition, making it the outlier in an otherwise consistent plugin codebase.

## Goals

1. `src/plugins/golang/builders/node-utils.ts` exists and exports shared tree-sitter node
   traversal helpers (text extraction, source-location mapping, visibility check).
2. `src/plugins/golang/builders/struct-builder.ts` exports `StructBuilder` with an
   `extract()` method covering all struct and type-alias extraction logic.
3. `src/plugins/golang/builders/interface-builder.ts` exports `InterfaceBuilder` with an
   `extract()` method covering all interface and gopls-enrichment logic.
4. `src/plugins/golang/builders/function-builder.ts` exports `FunctionBuilder` with an
   `extract()` method covering all top-level function, method, and parameter extraction.
5. `src/plugins/golang/builders/goroutine-builder.ts` exports `GoroutineBuilder` with an
   `extract()` method covering all goroutine spawn and channel-op detection.
6. `TreeSitterBridge` is reduced to a thin facade under 150 lines that constructs and
   delegates to the four builders; its public API and constructor signature are unchanged.
7. `src/plugins/golang/index.ts` and all atlas builders compile and run without any
   modification.
8. All existing tests pass (`npm test`) with zero regressions after the refactor.

## Proposed Approach

Extract methods from `TreeSitterBridge` into five new files under
`src/plugins/golang/builders/`. Each builder receives a `NodeUtils` instance at
construction time for access to shared helpers. `TreeSitterBridge` retains its public
`parseCode()` method and constructs the four builders in its constructor, delegating to
them. No changes to `index.ts`, `archjson-mapper.ts`, atlas builders, or any downstream
consumer. The extraction follows the groupings already documented in the reference proposal:

- `node-utils.ts` — `isExported`, `nodeToLocation`, text extraction, node traversal
- `struct-builder.ts` — `extractStruct` and all sub-helpers for fields/embedded types
- `interface-builder.ts` — `extractInterface`, `extractParametersFromElem`,
  `extractReturnTypesFromElem`, gopls enrichment
- `function-builder.ts` — `extractFunctions`, `extractFunctionsWithBodies`,
  `extractFunctionSignature`, `extractMethod`, `extractParameters`, `extractReturnTypes`,
  `shouldExtractBody`, `extractFunctionBody`
- `goroutine-builder.ts` — `extractGoSpawns`, `extractCallExprs`, `extractCallExpr`,
  `extractChannelOps`, `extractMakeChanVarName`

Package and import extraction (`extractPackageName`, `extractImports`) remain in
`TreeSitterBridge` as they are called at the file-root level, not inside builders.

## Trade-offs and Risks

**Not doing**: Changing the `TreeSitterBridge` public API, modifying `index.ts` or any
atlas builder, changing Go plugin output format, or merging `goroutine-builder.ts` with
the Atlas goroutine topology builder (deferred to a separate proposal).

**Risks**: (1) Import cycles if builders accidentally import from `index.ts` — mitigated
by keeping builders self-contained with only `node-utils.ts` and types as dependencies.
(2) Subtle behavioral regressions if method boundaries are drawn incorrectly — mitigated
by running the full test suite after each phase.

**Alternatives rejected**: Leave as-is (file grows with each Go feature); Visitor pattern
(heavier than needed; C++ builder pattern is already established).

---

# Plan: Refactor golang/tree-sitter-bridge.ts into builder modules

Proposal: docs/proposals/proposal-go-tree-sitter-decomposition.md

## Phase A: Extract node-utils.ts and StructBuilder

### Tests (write first)

File: `tests/plugins/golang/builders/struct-builder.test.ts`

Test cases to add (must fail before implementation):
- `StructBuilder.extract() returns empty array for empty source`
- `StructBuilder.extract() extracts a simple struct with exported fields`
- `StructBuilder.extract() extracts exported and unexported fields`
- `StructBuilder.extract() assigns correct package name to structs`
- `StructBuilder.extract() handles struct with embedded types`

File: `tests/plugins/golang/builders/node-utils.test.ts`

Test cases to add:
- `NodeUtils.isExported() returns true for upper-case identifiers`
- `NodeUtils.isExported() returns false for lower-case identifiers`
- `NodeUtils.nodeToLocation() returns correct line/column from SyntaxNode`

### Implementation

Files to create:
- `src/plugins/golang/builders/node-utils.ts`
  - Export `NodeUtils` class
  - Move `isExported(name: string): boolean` from `TreeSitterBridge`
  - Move `nodeToLocation(node, filePath): GoSourceLocation` from `TreeSitterBridge`
  - Export shared text-extraction helpers used by multiple builders
- `src/plugins/golang/builders/struct-builder.ts`
  - Export `StructBuilder` class receiving `NodeUtils` in constructor
  - Move `extractStruct(...)` and all private sub-helpers for fields/embedded types
  - Public `extract(filePath: string, rootNode: SyntaxNode, code: string): GoStruct[]`

Files to modify:
- `src/plugins/golang/tree-sitter-bridge.ts`
  - Import `NodeUtils` and `StructBuilder`
  - Construct `NodeUtils` and `StructBuilder` in constructor
  - Replace inline struct extraction with `this.structBuilder.extract(...)`
  - Remove extracted private methods (keep stubs only if needed to avoid compile errors)

### DoD
- [ ] `npm test -- --run tests/plugins/golang/builders/struct-builder.test.ts`
- [ ] `npm test -- --run tests/plugins/golang/builders/node-utils.test.ts`
- [ ] `npm test -- --run tests/plugins/golang/`
- [ ] `! grep -q "private extractStruct" src/plugins/golang/tree-sitter-bridge.ts`

---

## Phase B: Extract InterfaceBuilder and FunctionBuilder

### Tests (write first)

File: `tests/plugins/golang/builders/interface-builder.test.ts`

Test cases to add (must fail before implementation):
- `InterfaceBuilder.extract() returns empty array for empty source`
- `InterfaceBuilder.extract() extracts a simple Go interface`
- `InterfaceBuilder.extract() extracts method signatures from interface`
- `InterfaceBuilder.extract() extracts parameter and return types`

File: `tests/plugins/golang/builders/function-builder.test.ts`

Test cases to add:
- `FunctionBuilder.extract() returns empty array for empty source`
- `FunctionBuilder.extract() extracts top-level functions`
- `FunctionBuilder.extract() extracts methods with receiver`
- `FunctionBuilder.extract() extracts function parameters`
- `FunctionBuilder.extractWithBodies() respects shouldExtractBody for HTTP handler params`

### Implementation

Files to create:
- `src/plugins/golang/builders/interface-builder.ts`
  - Export `InterfaceBuilder` class receiving `NodeUtils` in constructor
  - Move `extractInterface(...)`, `extractParametersFromElem(...)`,
    `extractReturnTypesFromElem(...)` from `TreeSitterBridge`
  - Public `extract(filePath, rootNode, code): GoInterface[]`
- `src/plugins/golang/builders/function-builder.ts`
  - Export `FunctionBuilder` class receiving `NodeUtils` in constructor
  - Move `extractFunctions(...)`, `extractFunctionsWithBodies(...)`,
    `extractFunctionSignature(...)`, `extractMethod(...)`, `extractParameters(...)`,
    `extractReturnTypes(...)`, `shouldExtractBody(...)`, `extractFunctionBody(...)`
  - Public `extract(filePath, rootNode, code, options): { functions: GoFunction[], orphanedMethods: GoMethod[] }`

Files to modify:
- `src/plugins/golang/tree-sitter-bridge.ts`
  - Import and construct `InterfaceBuilder` and `FunctionBuilder`
  - Replace inline interface/function extraction with builder delegates
  - Remove extracted private methods

### DoD
- [ ] `npm test -- --run tests/plugins/golang/builders/interface-builder.test.ts`
- [ ] `npm test -- --run tests/plugins/golang/builders/function-builder.test.ts`
- [ ] `npm test -- --run tests/plugins/golang/`
- [ ] `! grep -q "private extractInterface" src/plugins/golang/tree-sitter-bridge.ts`
- [ ] `! grep -q "private extractFunctions" src/plugins/golang/tree-sitter-bridge.ts`

---

## Phase C: Extract GoroutineBuilder and finalise TreeSitterBridge facade

### Tests (write first)

File: `tests/plugins/golang/builders/goroutine-builder.test.ts`

Test cases to add (must fail before implementation):
- `GoroutineBuilder.extract() returns empty array when no goroutines`
- `GoroutineBuilder.extract() detects go statement spawn`
- `GoroutineBuilder.extract() extracts channel make() variable name from short_var_declaration`
- `GoroutineBuilder.extract() extracts channel make() variable name from assignment_statement`
- `GoroutineBuilder.extract() extracts correct variable in multi-assign short_var_declaration`
- `GoroutineBuilder.extract() returns empty string when make(chan) is not assigned to a variable`
- `GoroutineBuilder.extract() extracts call expression arguments (string literal)`
- `GoroutineBuilder.extract() extracts call expression with METHOD prefix`

### Implementation

Files to create:
- `src/plugins/golang/builders/goroutine-builder.ts`
  - Export `GoroutineBuilder` class receiving `NodeUtils` in constructor
  - Move `extractGoSpawns(...)`, `extractCallExprs(...)`, `extractCallExpr(...)`,
    `extractChannelOps(...)`, `extractMakeChanVarName(...)` from `TreeSitterBridge`
  - Public `extract(filePath, rootNode, code): GoGoroutineInfo`

Files to modify:
- `src/plugins/golang/tree-sitter-bridge.ts`
  - Import and construct `GoroutineBuilder`
  - Replace inline goroutine extraction with `this.goroutineBuilder.extract(...)`
  - Remove all extracted private methods
  - Result: facade with `parseCode()` public method, constructor wiring four builders
  - Final line count must be ≤ 150 lines

### DoD
- [ ] `npm test -- --run tests/plugins/golang/builders/goroutine-builder.test.ts`
- [ ] `npm test -- --run tests/plugins/golang/`
- [ ] `! grep -q "private extractGoSpawns" src/plugins/golang/tree-sitter-bridge.ts`
- [ ] `! grep -q "private extractChannelOps" src/plugins/golang/tree-sitter-bridge.ts`
- [ ] `npm run build`

---

## Constraints

- `src/plugins/golang/index.ts` must not be modified
- `src/plugins/golang/atlas/` files must not be modified
- `TreeSitterBridge` public API (`parseCode` signature, return type) must be unchanged
- No import cycles: builders import only from `./node-utils.js` and `../types.js`
- Each builder file must be importable in isolation (no side-effects at module level)
- `tree-sitter-bridge.ts` must be ≤ 150 lines after Phase C completes

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal approved. Starting plan draft.

Plan review iteration 1: APPROVED
premise-ledger:
[E] goal coverage: 8 goals mapped to Phase A (Goals 1,2), Phase B (Goals 3,4), Phase C (Goals 5,6), Constraints (Goal 7), Acceptance Gate (Goal 8)
[E] TDD structure: all 3 phases have ### Tests before ### Implementation
[E] TDD order: first DoD item in each phase uses npm test -- --run
[E] acceptance gate: first item is npm test (testAll)
[C] file paths exist: tree-sitter-bridge.ts confirmed 890 lines; tests/plugins/golang/ confirmed to exist via bash search
[E] DoD executability: all items are shell commands
[E] absence checks: ! grep -q pattern used throughout
[H] DoD sufficiency baseline: judgment that per-builder + golang/ directory + full suite is adequate coverage
GCL-self-report: E=6 C=1 H=1

claimed: 2026-06-23T08:23:37Z

## Execution Summary

Refactored `src/plugins/golang/tree-sitter-bridge.ts` (890 lines) into 5 focused builder modules under `src/plugins/golang/builders/`:

- **node-utils.ts** — `NodeUtils` class with static helpers: `isExported()`, `nodeText()`, `nodeToLocation()`
- **struct-builder.ts** — `StructBuilder` class: extracts structs from `type_declaration` AST nodes; delegates interface extraction to InterfaceBuilder in the same AST walk
- **interface-builder.ts** — `InterfaceBuilder` class: extracts interfaces, handles `method_elem` (methods) and `type_elem` (embedded interfaces) per current tree-sitter-go grammar
- **function-builder.ts** — `FunctionBuilder` class: extracts standalone functions and struct methods with optional body extraction and selective extraction logic
- **goroutine-builder.ts** — `GoroutineBuilder` class: extracts goroutine spawns, channel ops (send/receive/make), and call expressions from function bodies

`tree-sitter-bridge.ts` reduced from 890 to 120 lines (thin facade).

`TreeSitterParseOptions` moved from `tree-sitter-bridge.ts` to `types.ts` (re-exported for backward compatibility).

**Test results**: 29 new tests (TDD: written before implementation), all 486 golang tests pass, full suite 3903 tests pass, type-check clean, build succeeds.

Completed: 2026-06-23T08:44:26Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/plugins/golang/builders/struct-builder.test.ts
- [ ] #2 npm test -- --run tests/plugins/golang/builders/node-utils.test.ts
- [ ] #3 npm test -- --run tests/plugins/golang/builders/interface-builder.test.ts
- [ ] #4 npm test -- --run tests/plugins/golang/builders/function-builder.test.ts
- [ ] #5 npm test -- --run tests/plugins/golang/builders/goroutine-builder.test.ts
- [ ] #6 npm test -- --run tests/plugins/golang/
- [ ] #7 npm test
- [ ] #8 npm run type-check
<!-- DOD:END -->
