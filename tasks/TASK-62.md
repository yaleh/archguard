---
id: TASK-62
title: "TASK-62: Tree-sitter query externalization — QueryLoader + CaptureMapper + C++ reference implementation"
status: ready
labels:
  - analysis
  - typescript
  - tree-sitter
  - cpp
  - refactor
parent: null
children: []
extra:
  schema: v1
  source: quay-tasks/TASK-11
---
# TASK-62: Tree-sitter query externalization — QueryLoader + CaptureMapper + C++ reference implementation

## Proposal

> source: quay-tasks/TASK-11（2026-08-05 经 git 历史核实为「真新」后搬入 tasks/，编号从 TASK-62 起）

Replace imperative TypeScript tree-sitter node traversal with declarative `.scm` query files.
Introduce `QueryLoader` and `CaptureMapper` base classes in `src/plugins/shared/`. The C++ plugin
is the Phase 1 reference implementation; Python, Java, Go and Kotlin are deferred pending C++
validation.

**Background**: ArchGuard's five tree-sitter bridges (`src/plugins/*/tree-sitter-bridge.ts`, ~2361
lines combined) use imperative recursive node traversal to extract code entities. The knowledge
embedded in this traversal — which node types mean "class", "function", "field" — is language-
specific data expressed as TypeScript control flow, conflating "what patterns to look for" with
"how to walk the AST". Tree-sitter ships a native query API (`language.query(sExpression)`) with an
ecosystem-standard S-expression `.scm` format that ArchGuard currently ignores. Result: adding a
language requires writing a correct recursive traversal class, and changing an extraction pattern
requires editing TypeScript control flow instead of updating a query file.

**Goals**:
1. `QueryLoader` in `src/plugins/shared/query-loader.ts` reads `.scm` files from a `queries/`
   directory and compiles them once via `language.query()`.
2. `CaptureMapper<TRaw>` base class in `src/plugins/shared/capture-mapper.ts` converts tree-sitter
   capture groups into language-specific raw types.
3. Standard query file layout: `src/plugins/<lang>/queries/<concern>.scm`
   (classes, functions, fields, enums, includes).
4. Refactor the C++ bridge (`src/plugins/cpp/tree-sitter-bridge.ts`, 338 lines) as the reference
   implementation — replacing imperative `visitForClasses` / `visitForFunctions` loops with query
   captures while preserving all existing test coverage.
5. Demonstrate query-based extraction is within 2x of direct-traversal speed (benchmark gates
   migration of other languages).

**Not doing**: migrating Python/Java/Go/Kotlin bridges (deferred until the C++ reference validates
and the performance benchmark passes); Gopls integration in the Go bridge stays imperative
permanently; the `ArchJsonMapper` layer is unchanged (only AST extraction moves to `.scm`).

**Risks**: malformed `.scm` syntax is caught at startup (QueryLoader surfaces `ParseError` with file
path); `language.query()` / `query.matches()` are stable in tree-sitter ≥0.20 (already used); the
imperative `extractFromErrorNodes()` supplement is retained for the tree-sitter-cpp `extern "C"`
grammar limitation.

## Plan

### Phase A: QueryLoader + CaptureMapper infrastructure

Tests first, in `tests/unit/plugins/shared/query-loader.test.ts` and
`tests/unit/plugins/shared/capture-mapper.test.ts`:
- `QueryLoader.load(name)` reads+compiles a `.scm` file and returns a `Parser.Query`; `loadAll()`
  returns a Map keyed by filename-without-extension; bad `.scm` syntax throws `ParseError` with the
  file path; empty dir → empty Map; compiled queries are cached (load twice → same reference).
- `CaptureMapper.runQuery()` iterates all matches and calls `mapCapture()` per match, skips `null`
  returns, groups captures into a `CaptureGroup` keyed by capture name; a concrete subclass can
  extract node text.

Implementation: create `src/plugins/shared/query-loader.ts`, `src/plugins/shared/capture-mapper.ts`,
and export both from `src/plugins/shared/index.ts`.

DoD: `npm test -- --run tests/unit/plugins/shared/query-loader.test.ts`,
`npm test -- --run tests/unit/plugins/shared/capture-mapper.test.ts`, `npm run type-check`.

### Phase B: C++ reference implementation (.scm query files + refactored bridge)

Tests first, extending `tests/plugins/cpp/tree-sitter-bridge.test.ts` (all current imperative-bridge
cases must still pass): `class Foo {}` → `RawClass` "Foo"; `struct Bar { int x; }` → field `x`;
`enum class Status { A, B }` → `RawEnum` ["A","B"]; top-level `void doThing(int x)` → `RawFunction`;
`#include <vector>` → include entry; `extern "C" { ... }` (ERROR node) still extracts contained
functions. New query-path cases: constructor does not throw when `queries/` is present; namespace-
wrapped classes extract under the namespace; ERROR-node-wrapped functions still extract.

Implementation: create five `.scm` files under `src/plugins/cpp/queries/` (classes, functions,
fields, enums, includes) and five concrete mappers under `src/plugins/cpp/mappers/`
(CppClassMapper, CppFuncMapper, CppFieldMapper, CppEnumMapper, CppIncludeMapper). Refactor
`src/plugins/cpp/tree-sitter-bridge.ts`: constructor loads queries via `QueryLoader`; `parseCode()`
calls `mapper.runQuery()`; retain `extractFromErrorNodes()` as a documented supplement; target
≤140 lines.

DoD: `npm test -- --run tests/plugins/cpp/tree-sitter-bridge.test.ts`,
`npm test -- --run tests/plugins/cpp/`, `npm run type-check`.

### Phase C: Performance benchmark

Tests first, in `tests/unit/plugins/cpp/bridge-benchmark.test.ts`: synthetic C++ fixture with 50
classes / 200 methods / 100 fields; assert query-based time ≤ 2x a direct-traversal baseline (or
≤500ms absolute, whichever is less strict); benchmark runs <5s total. Create
`tests/fixtures/cpp/benchmark-fixture.cpp`. No production code changes.

DoD: `npm test -- --run tests/unit/plugins/cpp/bridge-benchmark.test.ts`, `npm run type-check`.

## Touches

- src/plugins/shared/query-loader.ts (new)
- src/plugins/shared/capture-mapper.ts (new)
- src/plugins/shared/index.ts (new)
- src/plugins/cpp/queries/classes.scm (new)
- src/plugins/cpp/queries/functions.scm (new)
- src/plugins/cpp/queries/fields.scm (new)
- src/plugins/cpp/queries/enums.scm (new)
- src/plugins/cpp/queries/includes.scm (new)
- src/plugins/cpp/mappers/class-capture-mapper.ts (new)
- src/plugins/cpp/mappers/function-capture-mapper.ts (new)
- src/plugins/cpp/mappers/field-capture-mapper.ts (new)
- src/plugins/cpp/mappers/enum-capture-mapper.ts (new)
- src/plugins/cpp/mappers/include-capture-mapper.ts (new)
- src/plugins/cpp/tree-sitter-bridge.ts (refactor to query-based)
- tests/unit/plugins/shared/query-loader.test.ts (new)
- tests/unit/plugins/shared/capture-mapper.test.ts (new)
- tests/unit/plugins/cpp/bridge-benchmark.test.ts (new)
- tests/fixtures/cpp/benchmark-fixture.cpp (new)
- tests/plugins/cpp/tree-sitter-bridge.test.ts (extend)
- docs/proposals/proposal-tree-sitter-query-externalization.md (reference — exists)
- tasks/TASK-62.md

## Acceptance Criteria

- [ ] `QueryLoader` loads and compiles `.scm` query files once, throws `ParseError` on malformed syntax, and caches compiled queries
- [ ] `CaptureMapper<TRaw>` base class converts capture groups to raw types; `runQuery()` iterates matches, skips null mappings, groups captures
- [ ] C++ bridge is refactored to query-based extraction (five `.scm` files + five mappers) with all pre-existing C++ tests still green
- [ ] Performance benchmark proves query-based extraction ≤ 2x direct traversal on the 50-class fixture (or ≤500ms absolute)
- [ ] Other language bridges (Python/Java/Go/Kotlin) are NOT migrated; `ArchJsonMapper` unchanged; Go gopls stays imperative

## Contract

measure query-loader = `npm test -- --run tests/unit/plugins/shared/query-loader.test.ts` passed-count
measure capture-mapper = `npm test -- --run tests/unit/plugins/shared/capture-mapper.test.ts` passed-count
measure cpp-bridge = `npm test -- --run tests/plugins/cpp/` passed-count
measure cpp-benchmark = `npm test -- --run tests/unit/plugins/cpp/bridge-benchmark.test.ts` ratio, 2x-max
band all-green = `npm run type-check` exit-code-0, `npm run lint` exit-code-0
invariant 不迁移 Python/Java/Go/Kotlin 桥；不动 ArchJsonMapper；保留 extractFromErrorNodes() 补充
invoke `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json`
control 若 src/plugins/shared/query-loader.ts 已存在实现 ⇒ 判定「已覆盖」而非「真新」（本任务不得重复搬入）
resume 每完成一个 Phase 即跑该 Phase 的 DoD 命令落盘；被打断可从已通过的 Phase 续

## Dispatch review

reviewer: inner
at: 2026-08-05
changed: 由 quay-tasks/TASK-11 搬入 tasks/（TASK-62）时写就；Contract 每 measure 行自带命令；AC 阈值引用 measure 字段

## Definition of Done

- [ ] #1 npm test -- --run tests/unit/plugins/shared/query-loader.test.ts
- [ ] #2 npm test -- --run tests/unit/plugins/shared/capture-mapper.test.ts
- [ ] #3 npm test -- --run tests/plugins/cpp/tree-sitter-bridge.test.ts
- [ ] #4 npm test -- --run tests/plugins/cpp/
- [ ] #5 npm test -- --run tests/unit/plugins/cpp/bridge-benchmark.test.ts
- [ ] #6 npm test
- [ ] #7 npm run type-check
- [ ] #8 npm run lint
