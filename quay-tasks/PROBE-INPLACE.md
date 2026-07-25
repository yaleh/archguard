---
id: PROBE-INPLACE
title: getCompositeKey mutates caller's files array via Array.sort()
status: done
labels: []
---

## Finding

`CacheManager.getCompositeKey` in `src/cli/cache/cache-manager.ts:235` calls
`files.sort()` directly on the parameter, which mutates the caller's array in
place. Any caller that passes a file list and then relies on the original
ordering after `getCompositeKey` returns will silently observe a reordered
array.

The method's stated contract is "generate a deterministic cache key independent
of file-list order." Achieving order-independence requires sorting, but the
correct implementation is `[...files].sort()` (sort a copy) — not `files.sort()`
(sort in place).

File: `src/cli/cache/cache-manager.ts`, line 235:

```typescript
getCompositeKey(files: string[], configBlob: string): string {
  const combined = files.sort().join('|') + '|' + configBlob;  // ← mutates caller's array
  return createHash('sha256').update(combined).digest('hex').slice(0, 16);
}
```

The mutation is invisible in the current test suite because all test call-sites
pass array literals (`['a.ts', 'b.ts']`), and the order-insensitivity test
passes two separate literal arrays rather than the same reference:

```typescript
// tests/unit/cli/cache-manager-composite.test.ts:67-70
it('is order-insensitive for file list', () => {
  const key1 = cache.getCompositeKey(['a.ts', 'b.ts'], 'config');
  const key2 = cache.getCompositeKey(['b.ts', 'a.ts'], 'config');
  expect(key1).toBe(key2);
});
```

No test passes the same array reference twice or checks the array's order
after the call, so the mutation goes undetected.

## Evidence

**File:line**: `src/cli/cache/cache-manager.ts:235`

**Minimal reproduction** (Node/Vitest):

```typescript
import { CacheManager } from '@/cli/cache/cache-manager.js';
const cache = new CacheManager('/tmp/test');
const files = ['z.ts', 'a.ts', 'm.ts'];
cache.getCompositeKey(files, 'blob');
// files is now ['a.ts', 'm.ts', 'z.ts'] — original order destroyed
console.log(files); // ['a.ts', 'm.ts', 'z.ts']  ← unexpected mutation
```

A realistic scenario: the intended production caller collects test file paths
in discovery order (e.g. from `fs.readdir`) and later logs them in the
discovery order for diagnostics. After `getCompositeKey`, the order is
permanently altered, leading to misleading log output or incorrect index-
sensitive post-processing.

**Fix**: Replace `files.sort()` with `[...files].sort()` on line 235.

## AC

- [ ] `getCompositeKey` does not mutate the input `files` array
- [ ] A regression test asserts the caller's array order is unchanged after the call

## DoD

- All tests pass (`npm test`)
- The defect is resolved
- A regression test covers the fixed behavior
