# Proposal: Fix JSONC Comment Stripping Regex Bug

**Status**: Proposed
**Priority**: CRITICAL
**Affected subsystem**: `src/utils/tsconfig-finder.ts`

---

## Problem Statement

`stripJsoncComments()` in `src/utils/tsconfig-finder.ts` uses a naive regex to strip block comments before `JSON.parse()`:

```typescript
text.replace(/\/\*[\s\S]*?\*\//g, '') // block comments
```

This regex has no awareness of whether a `/*` sequence appears inside a JSON string literal. In a typical ArchGuard `tsconfig.json`, the `paths` section looks like:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

The sequence `@/*` contains `/*`, which the regex treats as the start of a block comment. The next `*/` it finds is in `"src/*"` (specifically the `*/` in `src/*"`). The regex therefore matches and removes the string `@/*": ["src/*` — stripping the entire paths entry content.

After stripping, `JSON.parse()` receives malformed JSON or an empty paths object, so `loadPathAliases()` returns `undefined`, and `@/` imports are never resolved. This causes ~31 false-positive orphan detections in unit test coverage analysis.

### Why the existing comment works at all

The comment above the function says:

> Limitation: does not handle // or /* inside JSON string values, but tsconfig.json values never contain comment-like sequences in practice.

This assumption was false. The `@/*` path alias pattern — the most common use case in this very project — contains exactly that sequence.

---

## Root Cause

The regex `/\/\*[\s\S]*?\*\//g` (non-greedy block-comment strip) does not track whether the current character position is inside a JSON string. It will consume any `/*...*/` span regardless of context.

---

## Proposed Fix

### Option A — TypeScript Compiler API (recommended)

The `typescript` package is already a declared dependency. `ts.parseConfigFileTextToJson()` is a public API that parses JSONC natively (handles both `/* */` and `//` comments, trailing commas) and returns the parsed object directly.

```typescript
import ts from 'typescript';

function parseJsonc(filePath: string, content: string): unknown {
  const result = ts.parseConfigFileTextToJson(filePath, content);
  if (result.error) throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, '\n'));
  return result.config;
}
```

Pros:
- Handles all JSONC edge cases correctly (strings containing `/*`, `//`, etc.)
- Handles trailing commas
- Zero additional dependencies
- Already used elsewhere in the codebase via `ts-morph`

Cons:
- Binds the utility to the `typescript` package (already a dependency, not new)

### Option B — String-state-aware parser

Implement a character-by-character state machine that tracks whether the scanner is inside a string literal (including escape handling), and only strips comment sequences when not in a string.

```typescript
function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  const len = text.length;
  while (i < len) {
    if (text[i] === '"') {
      // Consume string literal verbatim
      result += text[i++];
      while (i < len) {
        const ch = text[i];
        result += ch;
        if (ch === '\\') { i += 2; continue; }  // skip escaped char
        if (ch === '"') { i++; break; }
        i++;
      }
    } else if (text[i] === '/' && text[i + 1] === '*') {
      // Block comment — skip until */
      i += 2;
      while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      // Line comment — skip to EOL
      i += 2;
      while (i < len && text[i] !== '\n') i++;
    } else {
      result += text[i++];
    }
  }
  return result;
}
```

Pros:
- No additional dependency at all (not even `typescript`)
- Self-contained, easy to unit test exhaustively

Cons:
- More code to maintain
- Must be tested against edge cases (escaped quotes in strings, nested-looking sequences)

### Recommendation

**Option A** is preferred. It eliminates the need to maintain a custom parser and uses a battle-tested API from a package already in the dependency tree. The single function call replaces both the `stripJsoncComments()` helper and the `JSON.parse()` call.

---

## Impact

Fixing this bug unblocks `loadPathAliases()` returning a valid `PathAliasConfig` for projects that use `@/*` or similar glob-style path aliases. This restores cross-file import resolution in `TypeScriptPlugin`, which in turn reduces the orphan rate in unit test coverage analysis from ~33% to the expected baseline.
