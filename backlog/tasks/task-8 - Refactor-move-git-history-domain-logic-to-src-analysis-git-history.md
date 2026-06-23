---
id: TASK-8
title: 'Refactor: move git-history domain logic to src/analysis/git-history/'
status: 'Basic: Done'
assignee: []
created_date: '2026-06-23 06:28'
updated_date: '2026-06-23 07:01'
labels:
  - 'kind:basic'
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move history-aggregator.ts, history-query.ts, git-log-reader.ts from src/cli/git-history/ to src/analysis/git-history/; keep src/cli/git-history/ as I/O boundary with re-export shims. Mirrors the QueryEngine precedent.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Proposal: Refactor: move git-history domain logic to src/analysis/git-history/

## Background

`src/cli/git-history/` currently holds 1165 lines across five files, but only two of them (`history-loader.ts`, `history-writer.ts`) perform I/O. The other three — `history-aggregator.ts`, `history-query.ts`, and `git-log-reader.ts` — are pure domain algorithms: commit parsing, metric aggregation, and in-memory graph queries. These have no dependency on CLI flags, spinner state, or output formatting.

Placing domain logic under `src/cli/` misleads developers: `HistoryQuery` is structurally identical to `QueryEngine` in `src/core/query/`, yet a developer exploring the query layer will not find it there. It also couples unit tests to the `@/cli/` path alias even though the functions have no CLI behavior.

`QueryEngine` had the same problem before a previous refactor moved it from `src/cli/query/` to `src/core/query/`. This proposal applies the same correction to the git-history domain layer, making the package layout consistent.

## Goals

1. The three domain files (`history-aggregator.ts`, `history-query.ts`, `git-log-reader.ts`) exist under `src/analysis/git-history/` and are importable via `@/analysis/git-history/`.
2. `src/cli/git-history/` retains only `history-loader.ts` and `history-writer.ts` plus thin re-export shims for the three moved files; all existing callers continue to compile and pass tests without changes to their import statements.
3. A barrel `src/analysis/git-history/index.ts` re-exports all public symbols, and `npm test` passes with zero regressions after the move.

## Proposed Approach

Three files move from `src/cli/git-history/` to `src/analysis/git-history/`:

| From | To |
|---|---|
| `src/cli/git-history/history-aggregator.ts` | `src/analysis/git-history/history-aggregator.ts` |
| `src/cli/git-history/history-query.ts` | `src/analysis/git-history/history-query.ts` |
| `src/cli/git-history/git-log-reader.ts` | `src/analysis/git-history/git-log-reader.ts` |

A barrel `src/analysis/git-history/index.ts` is added to re-export all public symbols from the three files. The three original locations become re-export shims forwarding to `@/analysis/git-history/`. Internal cross-file imports within the moved files are updated to use relative paths within `src/analysis/git-history/`. Existing domain tests move to `tests/unit/analysis/git-history/`; I/O tests stay in `tests/unit/cli/git-history/`.

## Trade-offs and Risks

**Not doing**: Changing any function or class signatures; altering the on-disk artifact format; merging `HistoryQuery` into `QueryEngine`; modifying MCP tools (they continue to work through shims).

**Risk — git-log-reader.ts subprocess concern**: `readGitLog` spawns a child process, but `parseGitLogOutput` and `getGitRoot` are pure. Moving the whole file is acceptable as a first step; a future split is out of scope.

**Risk — shim completeness**: Missed exports cause TypeScript errors, caught immediately by `npm run type-check` and the test suite.

---

# Plan: Refactor: move git-history domain logic to src/analysis/git-history/

Proposal: docs/proposals/proposal-git-history-analysis-layer.md

## Phase A: Create src/analysis/git-history/ and move domain files with shims

### Tests (write first)

Create `tests/unit/analysis/git-history/history-aggregator.test.ts` — copy of existing `tests/unit/cli/git-history/history-aggregator.test.ts` with imports changed to `@/analysis/git-history/history-aggregator.js`. This file must fail before the move (module not found).

Create `tests/unit/analysis/git-history/history-query.test.ts` — copy of existing `tests/unit/cli/git-history/history-query.test.ts` with imports changed to `@/analysis/git-history/history-query.js` and `@/analysis/git-history/git-log-reader.js`. This file must fail before the move.

Create `tests/unit/analysis/git-history/git-log-reader.test.ts` — new test file importing from `@/analysis/git-history/git-log-reader.js`, testing `parseGitLogOutput` and `getGitRoot` with synthetic input. Must fail before the move.

### Implementation

1. Create directory `src/analysis/git-history/`.
2. Move `src/cli/git-history/git-log-reader.ts` → `src/analysis/git-history/git-log-reader.ts` (no internal import changes needed).
3. Move `src/cli/git-history/history-aggregator.ts` → `src/analysis/git-history/history-aggregator.ts`; relative import `from './git-log-reader.js'` stays valid (co-located).
4. Move `src/cli/git-history/history-query.ts` → `src/analysis/git-history/history-query.ts`; update relative import `from './history-loader.js'` → `from '@/cli/git-history/history-loader.js'`.
5. Create barrel `src/analysis/git-history/index.ts` re-exporting all public symbols from the three moved files.
6. Create re-export shim `src/cli/git-history/git-log-reader.ts` forwarding all exports to `@/analysis/git-history/git-log-reader.js`.
7. Create re-export shim `src/cli/git-history/history-aggregator.ts` forwarding all exports to `@/analysis/git-history/history-aggregator.js`.
8. Create re-export shim `src/cli/git-history/history-query.ts` forwarding all exports to `@/analysis/git-history/history-query.js`.

### DoD
- [ ] `npm test -- --run tests/unit/analysis/git-history/`
- [ ] `npm test -- --run tests/unit/cli/git-history/`
- [ ] `npm run type-check`

## Phase B: Migrate existing cli/git-history domain test files to new location

### Tests (write first)

Verify `tests/unit/cli/git-history/history-aggregator.test.ts` continues to pass via the shim (imports from `@/cli/git-history/` — must stay green without changes to the source file).

Verify `tests/unit/cli/git-history/history-query.test.ts` continues to pass via the shim (same reasoning).

### Implementation

1. Delete `tests/unit/cli/git-history/history-aggregator.test.ts` (replaced by canonical copy in `tests/unit/analysis/git-history/`).
2. Delete `tests/unit/cli/git-history/history-query.test.ts` (replaced by canonical copy in `tests/unit/analysis/git-history/`).
3. `tests/unit/cli/git-history/history-loader.test.ts` and `tests/unit/cli/git-history/history-writer.test.ts` stay in place — they test I/O boundary files that remain in `src/cli/git-history/`.

### DoD
- [ ] `npm test -- --run tests/unit/analysis/git-history/`
- [ ] `npm test -- --run tests/unit/cli/git-history/`
- [ ] `! grep -rq "from '@/cli/git-history/history-aggregator" tests/unit/analysis/`
- [ ] `! grep -rq "from '@/cli/git-history/history-query" tests/unit/analysis/`

## Constraints

- No function or class signatures change in any moved file.
- The on-disk artifact format in `.archguard/query/git-history/` is not touched.
- All MCP tools that call git-history query functions must continue to work without changes (shims cover them).
- `history-loader.ts` and `history-writer.ts` remain in `src/cli/git-history/` unchanged.

## Acceptance Gate
- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `ls src/analysis/git-history/history-aggregator.ts src/analysis/git-history/history-query.ts src/analysis/git-history/git-log-reader.ts src/analysis/git-history/index.ts`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
claimed: 2026-06-23T06:39:32Z

Completed: 2026-06-23T07:01:57Z
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npm test -- --run tests/unit/analysis/git-history/
- [ ] #2 npm test -- --run tests/unit/cli/git-history/
- [ ] #3 npm run type-check
- [ ] #4 ! grep -rq "from '@/cli/git-history/history-aggregator" tests/unit/analysis/
- [ ] #5 ! grep -rq "from '@/cli/git-history/history-query" tests/unit/analysis/
- [ ] #6 npm test
- [ ] #7 ls src/analysis/git-history/history-aggregator.ts src/analysis/git-history/history-query.ts src/analysis/git-history/git-log-reader.ts src/analysis/git-history/index.ts
<!-- DOD:END -->
