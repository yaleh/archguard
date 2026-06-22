# Plan 46: Fix lastArchJson Nondeterminism

**Proposal**: `docs/proposals/proposal-deterministic-query-scope.md`
**Priority**: HIGH (test analysis scope receives wrong ArchJSON when small diagram completes first)
**Estimated total changes**: ~10 lines source + ~30 test lines across 2 files

---

## Overview

Single targeted fix to `src/cli/processors/query-scope-collector.ts` that makes `_lastArchJson` selection deterministic regardless of `pMap` completion order:

| # | Issue | Root cause | Priority |
|---|---|---|---|
| 1 | Non-primary small group sets `_lastArchJson` before primary large group | First-write wins on null check; primary overwrite only fires after null is cleared | HIGH |

---

## Phase A — Strengthen `setLastArchJson()` with Entity Count Comparison

**Files**: `src/cli/processors/query-scope-collector.ts`, `tests/unit/cli/processors/query-scope-collector.test.ts`
**Estimated lines**: ~10 source + ~30 test

### Stage A1 — Add "richer wins" fallback to `setLastArchJson()`

**File**: `src/cli/processors/query-scope-collector.ts`, `setLastArchJson()` method (lines 63–67)

**Current code**:

```typescript
setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void {
  if (this._lastArchJson === null || groupHasPrimary) {
    this._lastArchJson = archJson;
  }
}
```

**Replacement**:

```typescript
/**
 * Update the stored "last ArchJSON" with primary-role and richness semantics.
 *
 * Resolution order (highest priority first):
 * 1. If no value is stored yet: always store.
 * 2. If groupHasPrimary === true: always overwrite (explicit primary wins).
 * 3. If incoming has more entities than stored: overwrite (richer wins).
 *    This ensures pMap completion-order nondeterminism does not cause a
 *    small sub-module ArchJSON (e.g. 4 entities from method/analysis) to
 *    permanently block the larger full-project ArchJSON (e.g. 447 entities).
 * 4. Otherwise: no-op.
 */
setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void {
  if (this._lastArchJson === null) {
    this._lastArchJson = archJson;
  } else if (groupHasPrimary) {
    this._lastArchJson = archJson;
  } else if ((archJson.entities?.length ?? 0) > (this._lastArchJson.entities?.length ?? 0)) {
    this._lastArchJson = archJson;
  }
  // Otherwise: no-op — stored value is richer or equal
}
```

**Acceptance**:
- When called with a null initial state: stores any ArchJSON.
- When `groupHasPrimary = true`: always overwrites, even if incoming is smaller.
- When `groupHasPrimary = false` and incoming has more entities: overwrites.
- When `groupHasPrimary = false` and stored has more entities: no-op.

### Stage A2 — Unit tests for `setLastArchJson()` resolution semantics

**File**: `tests/unit/cli/processors/query-scope-collector.test.ts` (create or extend)

Test group: `describe('setLastArchJson — resolution semantics')`:

```typescript
import { QueryScopeCollector } from '@/cli/processors/query-scope-collector.js';
import type { ArchJSON } from '@/types/index.js';

function makeArchJson(entityCount: number, language = 'typescript'): ArchJSON {
  return {
    version: '1.0',
    language,
    entities: Array.from({ length: entityCount }, (_, i) => ({
      id: `entity-${i}`,
      name: `Entity${i}`,
      type: 'class' as const,
      visibility: 'public' as const,
      members: [],
      sourceLocation: { file: `file${i}.ts`, startLine: 1, endLine: 10 },
    })),
    relations: [],
    extensions: {},
  };
}

describe('setLastArchJson — resolution semantics', () => {
  let collector: QueryScopeCollector;

  beforeEach(() => {
    collector = new QueryScopeCollector();
  });

  it('stores first ArchJSON when null (regardless of entity count)', () => {
    const small = makeArchJson(4);
    collector.setLastArchJson(small, false);
    expect(collector.getLastArchJson()).toBe(small);
  });

  it('does NOT overwrite when incoming is smaller and groupHasPrimary=false', () => {
    const large = makeArchJson(447);
    const small = makeArchJson(4);
    collector.setLastArchJson(large, false);
    collector.setLastArchJson(small, false);
    expect(collector.getLastArchJson()).toBe(large);
  });

  it('overwrites when incoming is larger and groupHasPrimary=false (richer wins)', () => {
    const small = makeArchJson(4);
    const large = makeArchJson(447);
    collector.setLastArchJson(small, false);
    collector.setLastArchJson(large, false);
    expect(collector.getLastArchJson()).toBe(large);
  });

  it('overwrites when groupHasPrimary=true even if incoming is smaller', () => {
    const large = makeArchJson(447);
    const small = makeArchJson(4);
    collector.setLastArchJson(large, false);
    collector.setLastArchJson(small, true);
    expect(collector.getLastArchJson()).toBe(small);
  });

  it('primary overwrite then non-primary smaller does not overwrite', () => {
    const tiny = makeArchJson(4);
    const primary = makeArchJson(100);
    const nonPrimarySmall = makeArchJson(10);
    collector.setLastArchJson(tiny, false);
    collector.setLastArchJson(primary, true);
    collector.setLastArchJson(nonPrimarySmall, false);
    expect(collector.getLastArchJson()).toBe(primary);
  });

  it('primary overwrite then non-primary larger DOES overwrite (richer wins over primary)', () => {
    const primary = makeArchJson(50);
    const large = makeArchJson(500);
    collector.setLastArchJson(makeArchJson(4), false);
    collector.setLastArchJson(primary, true);
    collector.setLastArchJson(large, false);
    expect(collector.getLastArchJson()).toBe(large);
  });

  it('handles ArchJSON with undefined entities without throwing', () => {
    const noEntities = { ...makeArchJson(0), entities: undefined as any };
    collector.setLastArchJson(noEntities, false);
    expect(collector.getLastArchJson()).toBe(noEntities);
    const withEntities = makeArchJson(100);
    collector.setLastArchJson(withEntities, false);
    expect(collector.getLastArchJson()).toBe(withEntities);
  });
});
```

**Dependencies**: A1

---

## Dependency Graph

```
A2 depends on A1
Both stages are independent of all other plans in this iteration
```

---

## Testing Strategy

- **TDD**: Write A2 tests first (all will fail with current implementation). Implement A1. Run tests.
- **No integration tests needed**: `QueryScopeCollector` is a pure data structure with no I/O.
- **Existing test suite**: Must remain green (2787+ tests) after all stages complete.
- **Self-validation**: After building, run `node dist/cli/index.js analyze -v --include-tests` multiple times and verify that `getLastArchJson().entities.length` is stable across runs (should always be the full-project count, not a sub-module count).

---

## Acceptance Criteria

| Stage | Criterion |
|---|---|
| A1 | `setLastArchJson(small, false)` → `setLastArchJson(large, false)` → `getLastArchJson()` returns `large` |
| A1 | `setLastArchJson(large, false)` → `setLastArchJson(small, false)` → `getLastArchJson()` returns `large` |
| A1 | `setLastArchJson(any, true)` always overwrites the stored value |
| A1 | `undefined` entities array handled without `TypeError` |
| A2 | 7 unit tests all pass |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| "Richer wins" selects a secondary-language ArchJSON over primary-language | Primary group always calls `setLastArchJson` with `groupHasPrimary=true`, so primary wins regardless of entity count when it completes |
| Entity count comparison is wrong metric (e.g., Go projects emit few entities but are primary) | Primary role always wins — entity count only used as tiebreaker between non-primary groups |
| Tests relying on first-write-wins semantics break | Grep test suite for `setLastArchJson`; only `query-scope-collector.test.ts` tests this directly |

---

## Validation

After implementing:

```bash
npm run build
# Run analyze multiple times and compare entity counts in query scope
for i in 1 2 3; do
  node dist/cli/index.js analyze -v --include-tests 2>&1 | grep "entity"
done
# Entity count should be consistent across runs (~447 for ArchGuard itself)
```
