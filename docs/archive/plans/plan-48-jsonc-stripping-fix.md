# Plan 48: Fix JSONC Comment Stripping in tsconfig-finder

**Proposal**: `docs/proposals/proposal-jsonc-stripping-fix.md`
**Priority**: CRITICAL (causes 31 false-positive orphans in unit test coverage analysis)
**Estimated total changes**: ~20 lines source + ~40 lines test

---

## Overview

Replace the broken `stripJsoncComments()` regex with a string-state-aware parser (Option B from the proposal) inside `src/utils/tsconfig-finder.ts`. Option B is preferred over the TypeScript compiler API (Option A) because it keeps the utility dependency-free and is trivially testable in isolation — the `typescript` package import would also introduce a subtle ordering issue with `ts-morph`'s own `typescript` peer.

The fix corrects a bug where `@/*` in tsconfig `paths` keys is misinterpreted as a block-comment start, causing `loadPathAliases()` to silently return `undefined` for any project using `@/` aliases.

---

## Phase A — Replace `stripJsoncComments()` with a state-machine parser

**File**: `src/utils/tsconfig-finder.ts`
**Estimated lines**: ~30 source (replaces 3 lines)

### Stage A1 — Implement state-machine `stripJsoncComments()`

Replace the current two-regex implementation with a character-by-character scanner that tracks whether the position is inside a JSON string literal before treating `/*` or `//` as comment markers.

```typescript
/**
 * Strip JSONC-style comments from a string before JSON.parse().
 *
 * Uses a state-machine approach to avoid treating /* or // inside
 * JSON string literals as comment markers.
 *
 * Handles:
 *   - Block comments:  /* ... * /  (outside strings only)
 *   - Line comments:   // ...      (outside strings only)
 *   - Escaped quotes:  \"          (inside strings, does not end string)
 *   - Path alias values like "@/*" : ["src/*"]  (correctly preserved)
 */
function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  const len = text.length;
  while (i < len) {
    // String literal: consume verbatim, respecting backslash escapes
    if (text[i] === '"') {
      result += text[i++];
      while (i < len) {
        const ch = text[i];
        result += ch;
        if (ch === '\\') { i += 2; continue; } // skip escaped character
        if (ch === '"') { i++; break; }         // end of string
        i++;
      }
    // Block comment: skip until */
    } else if (text[i] === '/' && i + 1 < len && text[i + 1] === '*') {
      i += 2;
      while (i + 1 < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // consume closing */
    // Line comment: skip to end of line
    } else if (text[i] === '/' && i + 1 < len && text[i + 1] === '/') {
      i += 2;
      while (i < len && text[i] !== '\n') i++;
    } else {
      result += text[i++];
    }
  }
  return result;
}
```

Key invariants:
- Once inside a string (`"` encountered outside a comment), the scanner emits all characters verbatim until the closing unescaped `"`.
- `/*` is only treated as a comment start when `text[i] === '/'` is reached in the outer loop (i.e., outside a string).
- Escaped characters inside strings (`\"`, `\\`) are consumed two-at-a-time to prevent the second character from being misinterpreted as a string terminator.

### Stage A2 — Update the comment block above the function

Remove the `Limitation:` note (it is no longer applicable) and replace it with a description of the state-machine guarantees.

---

## Phase B — Tests

**File**: `tests/unit/utils/tsconfig-finder.test.ts` (existing file — add new describe block)
**Estimated lines**: ~40 test lines

### Test cases to add (describe block: `stripJsoncComments — string-literal safety`)

| # | Input | Expected output | Scenario |
|---|---|---|---|
| B1 | `{ "paths": { "@/*": ["src/*"] } }` | unchanged | `@/*` in key preserved |
| B2 | `{ "key": "val" /* comment */ }` | `{ "key": "val"  }` | block comment outside string stripped |
| B3 | `{ "key": "val" // comment\n}` | `{ "key": "val" \n}` | line comment outside string stripped |
| B4 | `{ "key": "val /* not a comment */" }` | unchanged | `/*` inside string value preserved |
| B5 | `{ "key": "val // not a comment" }` | unchanged | `//` inside string value preserved |
| B6 | `{ "key": "escaped \\" quote" }` | unchanged | escaped quote inside string does not terminate |
| B7 | Full tsconfig with `@/*` paths + `// baseUrl comment` | paths intact, comment stripped | integration of both comment types |

These tests should call `stripJsoncComments` by re-exporting it (add `export` keyword for test-only use), or by testing via `loadPathAliases()` with a temp file written to disk (preferred — tests the full public API path).

### Recommended approach: test via `loadPathAliases()` with `tmp` files

Write a tsconfig with `@/*` paths to a temp file using `fs.writeFileSync`, call `loadPathAliases(tmpPath)`, assert that the returned `paths` record contains `@/*`. This exercises the fix end-to-end without exposing internal implementation details.

---

## Phase C — Verification

After the fix, run the existing ArchGuard self-analysis:

```bash
npm run build
node dist/cli/index.js analyze -v
```

Confirm that the `.archguard/` output shows cross-file `@/` import edges in the package diagram (previously missing due to unresolved aliases). The orphan rate in unit test coverage analysis should drop from ~33% to near the baseline expected for TypeScript projects.

---

## Acceptance Criteria

1. `loadPathAliases()` returns a valid `PathAliasConfig` for a tsconfig containing `"@/*": ["src/*"]` paths.
2. `loadPathAliases()` still returns `undefined` for a tsconfig with no `baseUrl` or `paths`.
3. `loadPathAliases()` correctly parses a tsconfig that contains both `//` line comments and `/* */` block comments alongside `@/*` paths.
4. All 7 new test cases pass.
5. No regression in the existing `tsconfig-finder` tests.
6. Full test suite remains green (`npm test`).
