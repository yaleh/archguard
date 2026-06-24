---
id: TASK-11
title: >-
  Tree-sitter query externalization: QueryLoader + CaptureMapper + C++ reference
  implementation
status: 'Basic: Backlog'
assignee: []
created_date: '2026-06-23 06:28'
updated_date: '2026-06-23 06:31'
labels:
  - 'kind:basic'
dependencies: []
references:
  - docs/proposals/proposal-tree-sitter-query-externalization.md
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace imperative TypeScript tree-sitter node traversal with declarative .scm query files. Introduce QueryLoader and CaptureMapper base classes in src/plugins/shared/. C++ plugin is the Phase 1 reference implementation. Other languages (Python, Java, Go, Kotlin) deferred pending C++ validation.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Tree-sitter query externalization — QueryLoader + CaptureMapper + C++ reference implementation

## Background

ArchGuard's five tree-sitter bridges (`src/plugins/*/tree-sitter-bridge.ts`, ~2361 lines
combined) use imperative recursive node traversal to extract code entities. The knowledge
embedded in this traversal — which node types mean "class", "function", or "field" — is
language-specific data expressed as TypeScript control flow. This conflates two concerns:
what patterns to look for vs. how to walk the AST.

Tree-sitter ships a native query API (`language.query(sExpression)`) designed for
structured pattern matching. Its S-expression `.scm` format is readable, composable, and
ecosystem-standard. ArchGuard already uses tree-sitter for parsing but ignores its query
engine entirely — every plugin re-implements pattern matching by hand.

The result: adding a new language requires writing a correct recursive traversal class
(error-prone, invisible bugs), and changing an extraction pattern (e.g., adding C++20
`concept` declarations) requires modifying TypeScript control flow rather than updating a
query file. There is no shared infrastructure across the five bridges.

## Goals

1. Introduce `QueryLoader` in `src/plugins/shared/query-loader.ts` that reads `.scm` files
   from a `queries/` directory and compiles them once via `language.query()`.
2. Introduce `CaptureMapper<TRaw>` base class in `src/plugins/shared/capture-mapper.ts`
   that converts tree-sitter capture groups into language-specific raw types.
3. Define a standard query file layout: `src/plugins/<lang>/queries/<concern>.scm`
   (classes, functions, fields, enums, includes).
4. Refactor the C++ bridge (`src/plugins/cpp/tree-sitter-bridge.ts`, 338 lines) as the
   reference implementation — replacing imperative `visitForClasses` / `visitForFunctions`
   loops with query captures while preserving all existing test coverage.
5. Demonstrate that query-based extraction is within 2x of direct traversal speed for
   typical C++ files (benchmark must pass before other languages are migrated).

## Proposed Approach

**Phase A — Infrastructure**: Create `QueryLoader` (reads + compiles `.scm` files once in
`initialize()`) and `CaptureMapper<TRaw>` (abstract base with `runQuery()` that iterates
matches and delegates to `mapCapture()`). Both live in `src/plugins/shared/` alongside
the existing `mapper-utils.ts`.

**Phase B — C++ reference implementation**: Write five `.scm` query files under
`src/plugins/cpp/queries/` (classes, functions, fields, enums, includes). Create concrete
`CaptureMapper` subclasses (`CppClassMapper`, `CppFuncMapper`, etc.) that convert capture
groups to `RawClass`, `RawFunction`, etc. Refactor `TreeSitterBridge` to load queries in
the constructor and call `mapper.runQuery()` instead of recursive `visit*` methods.
Retain a small imperative supplement for `ERROR` node recursion (known tree-sitter-cpp
grammar limitation for `extern "C"` guards) — isolated and documented.

**Phase C — Performance benchmark**: Write a benchmark script comparing query-based vs.
direct traversal on a corpus of C++ files (e.g., llama.cpp headers). Gate migration of
other languages on ≤2x overhead.

## Trade-offs and Risks

**Not doing**: Migrating Python, Java, Go, or Kotlin bridges in this task. Those are
deferred until the C++ reference is validated and the performance benchmark passes.
Gopls integration in the Go bridge stays imperative permanently.

**Not doing**: Replacing the `ArchJsonMapper` layer. Entity/Relation mapping stays in
TypeScript; only AST extraction moves to `.scm` queries.

**Risk — query compilation errors**: Malformed `.scm` syntax is caught at startup (not
at file-parse time). `QueryLoader` surfaces these as `ParseError` with file path.

**Risk — tree-sitter API surface**: `language.query()` and `query.matches()` are stable
APIs in tree-sitter ≥0.20, which ArchGuard already uses. No dependency version changes
required.

**Risk — performance regression**: Query engine overhead vs. hand-written traversal is
unknown. Phase C benchmark gates rollout to other languages. C++ plugin alone has
comprehensive existing tests that will catch correctness regressions immediately.

---

# Plan: Tree-sitter query externalization — QueryLoader + CaptureMapper + C++ reference implementation

Proposal: docs/proposals/proposal-tree-sitter-query-externalization.md

## Phase A: QueryLoader + CaptureMapper infrastructure

### Tests (write first)

File: `tests/unit/plugins/shared/query-loader.test.ts`

Test cases:
- `QueryLoader.load(name)` reads a `.scm` file from queryDir, compiles it, and returns a `Parser.Query` object
- `QueryLoader.loadAll()` returns a Map keyed by filename-without-extension for all `.scm` files in queryDir
- `QueryLoader.load(name)` throws `ParseError` with the file path when the `.scm` content is syntactically invalid
- `QueryLoader.loadAll()` returns an empty Map when the directory contains no `.scm` files
- `QueryLoader` caches compiled queries (calling `load(name)` twice returns same reference)

File: `tests/unit/plugins/shared/capture-mapper.test.ts`

Test cases:
- `CaptureMapper.runQuery()` iterates all matches from a compiled query and calls `mapCapture()` for each
- `CaptureMapper.runQuery()` skips matches where `mapCapture()` returns `null`
- `CaptureMapper.runQuery()` groups all captures for one match into a `CaptureGroup` keyed by capture name
- A concrete `CaptureMapper` subclass can extract node text from the group in `mapCapture()`

### Implementation

- Create `src/plugins/shared/query-loader.ts` — `QueryLoader` class with `load(name)` and `loadAll()` methods; throws `ParseError` on bad `.scm` syntax
- Create `src/plugins/shared/capture-mapper.ts` — abstract `CaptureMapper<TRaw>` with abstract `mapCapture(group, filePath)` and concrete `runQuery(query, root, filePath)` method
- Export both from `src/plugins/shared/index.ts` (create if it does not exist)

### DoD
- [ ] `npm test -- --run tests/unit/plugins/shared/query-loader.test.ts`
- [ ] `npm test -- --run tests/unit/plugins/shared/capture-mapper.test.ts`
- [ ] `npm run type-check`

## Phase B: C++ reference implementation (.scm query files + refactored bridge)

### Tests (write first)

File: `tests/plugins/cpp/tree-sitter-bridge.test.ts` (extend existing)

Test cases (all currently exercised via the imperative bridge; must still pass after refactor):
- Parsing a C++ file with `class Foo { ... }` yields a `RawClass` with name `"Foo"` and correct members
- Parsing a `struct Bar { int x; }` yields a `RawClass` with field `x`
- Parsing a `enum class Status { A, B }` yields a `RawEnum` with values `["A", "B"]`
- Parsing a top-level `void doThing(int x)` yields a `RawFunction`
- Parsing `#include <vector>` yields an include entry
- Files with `extern "C" { ... }` (ERROR node in tree-sitter-cpp) still extract contained functions

New test cases for query-based path:
- `TreeSitterBridge` constructor does not throw when `queries/` directory is present
- Parsing a file containing `namespace ns { class A {}; }` extracts `A` under namespace `ns`
- Parsing a file with an `ERROR` node that wraps a function definition still extracts the function (imperative supplement test)

### Implementation

- Create `src/plugins/cpp/queries/classes.scm` — captures `class_specifier`, `struct_specifier`, `union_specifier` with `@class`, `@class.name`, `@class.body`
- Create `src/plugins/cpp/queries/functions.scm` — captures `function_definition` and `declaration` (constructor/destructor) with `@func`, `@func.name`, `@func.params`
- Create `src/plugins/cpp/queries/fields.scm` — captures `field_declaration` inside `field_declaration_list` with `@field`, `@field.type`, `@field.name`
- Create `src/plugins/cpp/queries/enums.scm` — captures `enum_specifier` with `@enum`, `@enum.name`, `@enum.body`
- Create `src/plugins/cpp/queries/includes.scm` — captures `preproc_include` with `@include`, `@include.path`
- Create `src/plugins/cpp/mappers/class-capture-mapper.ts` — `CppClassMapper extends CaptureMapper<RawClass>`
- Create `src/plugins/cpp/mappers/function-capture-mapper.ts` — `CppFuncMapper extends CaptureMapper<RawFunction>`
- Create `src/plugins/cpp/mappers/field-capture-mapper.ts` — `CppFieldMapper extends CaptureMapper<RawField>`
- Create `src/plugins/cpp/mappers/enum-capture-mapper.ts` — `CppEnumMapper extends CaptureMapper<RawEnum>`
- Create `src/plugins/cpp/mappers/include-capture-mapper.ts` — `CppIncludeMapper extends CaptureMapper<RawInclude>`
- Refactor `src/plugins/cpp/tree-sitter-bridge.ts`: constructor loads queries via `QueryLoader`; `parseCode()` calls `mapper.runQuery()`; retain `extractFromErrorNodes()` as documented supplement; target ≤140 lines

### DoD
- [ ] `npm test -- --run tests/plugins/cpp/tree-sitter-bridge.test.ts`
- [ ] `npm test -- --run tests/plugins/cpp/`
- [ ] `npm run type-check`

## Phase C: Performance benchmark

### Tests (write first)

File: `tests/unit/plugins/cpp/bridge-benchmark.test.ts`

Test cases:
- Benchmark fixture: parse a synthetic C++ file with 50 classes, 200 methods, 100 fields
- Query-based extraction wall-clock time is recorded (use `performance.now()`)
- Assert: query-based time ≤ 2× a direct-traversal baseline (or ≤ 500ms absolute for the 50-class fixture, whichever is less strict)
- Benchmark runs in under 5 seconds total (vitest timeout guard)

### Implementation

- Create `tests/fixtures/cpp/benchmark-fixture.cpp` — synthetic file with 50 classes and representative field/method counts
- Create `tests/unit/plugins/cpp/bridge-benchmark.test.ts` — runs query-based path, asserts ≤2× ratio; logs result for CI visibility
- No production code changes in this phase

### DoD
- [ ] `npm test -- --run tests/unit/plugins/cpp/bridge-benchmark.test.ts`
- [ ] `npm run type-check`

## Constraints

- Other language bridges (Python, Java, Go, Kotlin) are deferred until Phase C benchmark passes
- Gopls integration in the Go bridge stays imperative permanently (out of scope)
- `ArchJsonMapper` layer is not changed; only AST extraction moves to query-based approach
- The imperative `extractFromErrorNodes()` supplement in the C++ bridge must be retained and documented
- Query files use standard tree-sitter S-expression syntax; no custom extensions
- `QueryLoader` must throw `ParseError` (not a raw Error) on bad `.scm` syntax, consistent with `src/cli/errors.ts`

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Proposal self-reviewed and approved. All 5 criteria pass. Proceeding to TDD plan draft.

Plan review iteration 1: APPROVED
premise-ledger:
[E] goal coverage: 5 goals mapped to Phase A (Goals 1-2), Phase B (Goals 3-4), Phase C (Goal 5)
[E] TDD structure: every Phase has Tests before Implementation, first DoD item uses testCmd
[E] acceptance gate: first item is npm test (testAll)
[E] DoD executability: all items are shell commands, no natural-language items
[C] file paths exist: tests/plugins/cpp/tree-sitter-bridge.test.ts, tests/unit/plugins/shared/ confirmed via Bash search
[C] src/plugins/shared/ exists: confirmed via ls
[H] benchmark 2x threshold adequacy: based on general knowledge of tree-sitter query overhead
GCL-self-report: E=4 C=2 H=1
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/plugins/shared/query-loader.test.ts
- [ ] #2 npm test -- --run tests/unit/plugins/shared/capture-mapper.test.ts
- [ ] #3 npm test -- --run tests/plugins/cpp/tree-sitter-bridge.test.ts
- [ ] #4 npm test -- --run tests/plugins/cpp/
- [ ] #5 npm test -- --run tests/unit/plugins/cpp/bridge-benchmark.test.ts
- [ ] #6 npm test
- [ ] #7 npm run type-check
- [ ] #8 npm run lint
<!-- DOD:END -->
