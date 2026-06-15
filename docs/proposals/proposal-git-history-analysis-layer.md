## Problem Statement

`src/cli/git-history/` contains 1165 lines of code across five files. Only two of those files (`history-loader.ts`, `history-writer.ts`) perform I/O: loading pre-computed artifacts from `.archguard/` and writing them back. The remaining three files contain pure domain algorithms with no filesystem or process dependencies:

| File | Lines | Content |
|---|---|---|
| `history-aggregator.ts` | 489 | `aggregateFileMetrics`, `aggregatePackageMetrics`, `buildCochangeIndex`, `computeRiskFactors`, `extractPackagePath` |
| `history-query.ts` | 316 | `HistoryQuery` class — in-memory graph queries over aggregated commit data |
| `git-log-reader.ts` | 240 | `parseGitLogOutput`, `readGitLog`, git subprocess wrappers |

The `HistoryQuery` class is structurally identical to `QueryEngine` in `src/core/query/`: it wraps an in-memory data structure and exposes typed query methods. `history-aggregator.ts` functions are pure transformations over `CommitRecord[]` arrays. Neither has any dependency on CLI flags, spinner state, or output formatting.

Placing domain algorithms in `src/cli/` produces two concrete problems:

1. **Discoverability**: `archguard_find_entity` and `archguard_get_dependencies` live in `src/core/query/`. A developer looking for query logic starts there — and misses `HistoryQuery`, which answers "which entities changed together and how often?"
2. **Testability**: Unit tests for `history-aggregator.ts` functions require importing from `@/cli/git-history/`, coupling them to the CLI package alias even though the functions have no CLI behavior.

This is the same problem that `QueryEngine` had before Plan 58's follow-up refactor moved it from `src/cli/query/` to `src/core/query/`.

---

## Goals

- Move the three domain-logic files (`history-aggregator.ts`, `history-query.ts`, `git-log-reader.ts`) to `src/analysis/git-history/`.
- Keep `src/cli/git-history/` as a thin I/O layer: only `history-loader.ts` and `history-writer.ts` remain there, with re-export shims for any types that callers import.
- Preserve all existing import sites without touching them.

## Non-Goals

- Changing any function or class signatures.
- Changing the on-disk artifact format in `.archguard/query/git-history/`.
- Modifying MCP tools that call git-history query functions (they should continue to work through the shims).
- Merging `HistoryQuery` into `QueryEngine` (a potential future step, out of scope here).

---

## Design

### File moves

| From | To |
|---|---|
| `src/cli/git-history/history-aggregator.ts` | `src/analysis/git-history/history-aggregator.ts` |
| `src/cli/git-history/history-query.ts` | `src/analysis/git-history/history-query.ts` |
| `src/cli/git-history/git-log-reader.ts` | `src/analysis/git-history/git-log-reader.ts` |

Add a barrel: `src/analysis/git-history/index.ts` re-exporting all public symbols.

### Re-export shims

Replace the original three files in `src/cli/git-history/` with shims following the same pattern as `src/cli/query/query-engine.ts`:

```typescript
// src/cli/git-history/history-aggregator.ts
export {
  aggregateFileMetrics,
  aggregatePackageMetrics,
  buildCochangeIndex,
  computeRiskFactors,
  extractPackagePath,
} from '@/analysis/git-history/history-aggregator.js';
export type { FileMetrics, PackageMetrics, CochangeIndex } from '@/analysis/git-history/history-aggregator.js';
```

```typescript
// src/cli/git-history/history-query.ts
export { HistoryQuery } from '@/analysis/git-history/history-query.js';
export type { HistoryQueryOptions } from '@/analysis/git-history/history-query.js';
```

```typescript
// src/cli/git-history/git-log-reader.ts
export {
  parseGitLogOutput,
  readGitLog,
  getHeadRef,
  getCurrentBranch,
  isGitRepo,
  getGitRoot,
} from '@/analysis/git-history/git-log-reader.js';
export type { CommitRecord, ReadGitLogOptions } from '@/analysis/git-history/git-log-reader.js';
```

`history-loader.ts` and `history-writer.ts` stay in `src/cli/git-history/` unchanged — they are the genuine I/O boundary.

### Internal import updates

The moved files import each other (e.g. `history-query.ts` imports from `history-aggregator.ts`). Update those cross-file imports to use the new `@/analysis/git-history/` paths. No external callers need to change because the shims cover them.

### Test file paths

Existing unit tests under `tests/unit/cli/git-history/` should move to `tests/unit/analysis/git-history/` to reflect the new canonical location. The shim files in `src/cli/git-history/` need no tests of their own (same reasoning as the `QueryEngine` shim).

---

## Execution steps (TDD order)

1. Write failing tests at `tests/unit/analysis/git-history/history-aggregator.test.ts` that import from `@/analysis/git-history/history-aggregator.js` — fails until move is done.
2. Move `history-aggregator.ts` and add the shim in `src/cli/git-history/`.
3. Confirm both the new tests and the existing `tests/unit/cli/git-history/` tests pass.
4. Repeat for `history-query.ts` and `git-log-reader.ts`.
5. Add barrel `src/analysis/git-history/index.ts`.
6. Run full test suite to confirm zero regressions.

---

## Alternatives

- **Leave files in place**: Rejected. The asymmetry between `QueryEngine` in `src/core/` and `HistoryQuery` in `src/cli/` creates a misleading picture for any developer reading the package structure.
- **Move all five files to `src/analysis/`**: Rejected. `history-loader.ts` and `history-writer.ts` depend on `fs-extra` and `.archguard/` path conventions that belong at the CLI layer. Mixing I/O with the domain layer is what we are trying to undo.
- **Merge `HistoryQuery` into `QueryEngine`**: Out of scope. `HistoryQuery` operates on a different data model (`CommitRecord[]` vs `ArchJSON`) and has a different query surface. Merging would require schema work that is not justified by this refactor.

---

## Open Questions

- Whether `src/analysis/git-history/` should grow a dedicated `index.ts` that selectively exposes the public API, or whether individual file re-exports are sufficient for the initial move.
- Whether `git-log-reader.ts` (which spawns a subprocess) genuinely belongs in `src/analysis/` or whether it should stay in `src/cli/` as an I/O concern. The functions `parseGitLogOutput` and `getGitRoot` are pure; `readGitLog` is not. A future split could separate the pure parser from the subprocess wrapper.
