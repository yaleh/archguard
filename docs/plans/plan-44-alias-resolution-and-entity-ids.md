# Plan 44: Fix @/ Alias Resolution and Absolute Entity IDs

**Proposal**: `docs/proposals/proposal-alias-resolution-and-entity-ids.md`
**Priority**: CRITICAL (Bug 1 causes ~98% orphan rate for TypeScript projects; Bug 2 breaks method entity IDs)
**Estimated total changes**: ~30 lines source + ~60 test lines across 3 files

---

## Overview

Three targeted fixes across two source files:

| # | Issue | File | Priority |
|---|---|---|---|
| 1 | `JSON.parse()` fails on JSONC tsconfig.json | `src/utils/tsconfig-finder.ts` | CRITICAL |
| 2 | `parseWithParallelParser()` omits `workspaceRoot` | `src/cli/processors/arch-json-provider.ts` | HIGH |
| 3 | `@/` targets in package JSON relations unresolved | `src/cli/processors/arch-json-provider.ts` or generator | MEDIUM |

---

## Phase A — Fix JSONC Parsing in `loadPathAliases()`

**Files**: `src/utils/tsconfig-finder.ts`, `tests/unit/utils/tsconfig-finder.test.ts`
**Estimated lines**: ~10 source + ~30 test

### Stage A1 — Add `stripJsoncComments()` helper and apply to `loadPathAliases()`

**File**: `src/utils/tsconfig-finder.ts`

**Current code** (line 49):

```typescript
const raw = JSON.parse(fs.readFileSync(tsConfigFilePath, 'utf8')) as {
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
};
```

**Replacement** — add helper before `loadPathAliases`, then use it:

```typescript
/**
 * Strip JSONC-style comments from a string before JSON.parse().
 * Handles:
 * - Block comments: /* ... * /
 * - Line comments: // ... (to end of line)
 *
 * Limitation: does not handle // or /* inside JSON string values,
 * but tsconfig.json values never contain comment-like sequences in practice.
 */
function stripJsoncComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, '');       // line comments
}
```

Then inside `loadPathAliases()`:

```typescript
const content = fs.readFileSync(tsConfigFilePath, 'utf8');
const raw = JSON.parse(stripJsoncComments(content)) as {
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
};
```

**Acceptance**: `loadPathAliases()` returns a non-undefined `PathAliasConfig` when given a tsconfig.json with `//` comments and `/* */` block comments.

### Stage A2 — Add unit tests for JSONC stripping

**File**: `tests/unit/utils/tsconfig-finder.test.ts` (create if absent)

Test group: `describe('loadPathAliases — JSONC comment stripping')`:

```typescript
it('parses tsconfig.json with line comments', () => {
  // Write a temp file with comments
  const content = `{
    // This is a comment
    "compilerOptions": {
      "baseUrl": ".",
      // Another comment
      "paths": { "@/*": ["src/*"] }
    }
  }`;
  const tmpPath = path.join(os.tmpdir(), 'tsconfig-test.json');
  fs.writeFileSync(tmpPath, content, 'utf8');
  const result = loadPathAliases(tmpPath);
  expect(result).not.toBeUndefined();
  expect(result!.paths['@/*']).toEqual(['src/*']);
  fs.unlinkSync(tmpPath);
});

it('parses tsconfig.json with block comments', () => {
  const content = `{
    /* Block comment */
    "compilerOptions": {
      "baseUrl": ".",
      "paths": { /* inline block */ "@/*": ["src/*"] }
    }
  }`;
  const tmpPath = path.join(os.tmpdir(), 'tsconfig-block.json');
  fs.writeFileSync(tmpPath, content, 'utf8');
  const result = loadPathAliases(tmpPath);
  expect(result).not.toBeUndefined();
  expect(result!.paths['@/*']).toEqual(['src/*']);
  fs.unlinkSync(tmpPath);
});

it('returns undefined for a file with no compilerOptions paths or baseUrl', () => {
  const content = `{
    // Just extends
    "extends": "./tsconfig.base.json"
  }`;
  const tmpPath = path.join(os.tmpdir(), 'tsconfig-none.json');
  fs.writeFileSync(tmpPath, content, 'utf8');
  const result = loadPathAliases(tmpPath);
  expect(result).toBeUndefined();
  fs.unlinkSync(tmpPath);
});

it('still returns undefined for invalid JSON (even after comment stripping)', () => {
  const content = `{ "bad json": }`;
  const tmpPath = path.join(os.tmpdir(), 'tsconfig-bad.json');
  fs.writeFileSync(tmpPath, content, 'utf8');
  const result = loadPathAliases(tmpPath);
  expect(result).toBeUndefined();
  fs.unlinkSync(tmpPath);
});
```

**Dependencies**: A1

---

## Phase B — Fix Missing `workspaceRoot` in `parseWithParallelParser()`

**Files**: `src/cli/processors/arch-json-provider.ts`, `tests/unit/cli/processors/arch-json-provider.test.ts`
**Estimated lines**: ~5 source + ~20 test

### Stage B1 — Pass `workspaceRoot` to ParallelParser constructor

**File**: `src/cli/processors/arch-json-provider.ts`, `parseWithParallelParser()` (lines 606–616)

**Current code**:

```typescript
private async parseWithParallelParser(
  _diagram: DiagramConfig,
  files: string[]
): Promise<ArchJSON> {
  const parser = new ParallelParser({
    concurrency: this.globalConfig.concurrency,
    continueOnError: true,
    parseCache: this.parseCache,
  });
  return parser.parseFiles(files);
}
```

**Replacement** — remove the leading `_` from `_diagram` parameter (it is now used) and add `workspaceRoot`:

```typescript
private async parseWithParallelParser(
  diagram: DiagramConfig,
  files: string[]
): Promise<ArchJSON> {
  const workspaceRoot = path.resolve(diagram.sources[0]);
  const parser = new ParallelParser({
    concurrency: this.globalConfig.concurrency,
    continueOnError: true,
    parseCache: this.parseCache,
    workspaceRoot,
  });
  return parser.parseFiles(files);
}
```

**Acceptance**: Entity IDs in the returned ArchJSON are relative paths (e.g., `cli/commands/analyze.ts.AnalyzeCommand`) not absolute paths (e.g., `/home/user/.../src/cli/commands/analyze.ts.AnalyzeCommand`).

### Stage B2 — Unit test for workspaceRoot propagation

**File**: `tests/unit/cli/processors/arch-json-provider.test.ts`

Add test group: `describe('parseWithParallelParser — workspaceRoot propagation')`:

```typescript
it('constructs ParallelParser with workspaceRoot derived from diagram.sources[0]', async () => {
  const capturedOptions: ParallelParserOptions[] = [];
  vi.spyOn(ParallelParserModule, 'ParallelParser').mockImplementation((opts) => {
    capturedOptions.push(opts);
    return {
      parseFiles: vi.fn().mockResolvedValue({ entities: [], relations: [], version: '1.0', language: 'typescript', extensions: {} }),
    } as unknown as ParallelParser;
  });

  const provider = new ArchJsonProvider({ globalConfig: { concurrency: 1 } });
  // Trigger parseWithParallelParser via get() with empty source group
  const diagram: DiagramConfig = {
    name: 'test',
    sources: ['/abs/path/to/src'],
    level: 'class',
  };
  await provider.get(diagram, { needsModuleGraph: false });

  expect(capturedOptions[0].workspaceRoot).toBe('/abs/path/to/src');
});
```

**Dependencies**: B1

---

## Phase C — Resolve `@/` Targets in Package Diagram Relations

**Files**: `src/cli/processors/arch-json-provider.ts` (or `src/mermaid/generator.ts`), tests
**Estimated lines**: ~15 source + ~20 test

### Stage C1 — Add alias-to-package resolver in `deriveSubModuleArchJSON` or generator

The canonical location for this fix is `deriveSubModuleArchJSON()` when it injects `tsAnalysis.moduleGraph` edges into relations. The moduleGraph edges have `from`/`to` values that are module-relative paths like `@/parser`.

**File**: `src/cli/processors/arch-json-provider.ts`, inside `deriveSubModuleArchJSON()` after the `mg` block (around line 175).

When filtering edges and re-emitting them as relations, strip the `@/` prefix and take the first path component to resolve to the package entity ID:

```typescript
/**
 * Resolve a moduleGraph node ID to a package entity ID.
 * '@/parser/foo' → 'parser'
 * 'src/parser' → 'parser'
 * 'parser' → 'parser'
 */
function resolveModuleNodeToPackageId(nodeId: string): string {
  // Strip @/ prefix
  const stripped = nodeId.startsWith('@/') ? nodeId.slice(2) : nodeId;
  // Strip leading 'src/'
  const noSrc = stripped.startsWith('src/') ? stripped.slice(4) : stripped;
  // First path component is the package name
  return noSrc.split('/')[0];
}
```

When emitting moduleGraph edges as relations, apply `resolveModuleNodeToPackageId()` to both `from` and `to` before constructing the relation object.

**Acceptance**: A moduleGraph edge with `from: '@/parser'` and `to: '@/mermaid'` produces a package-level relation with `source: 'parser'` and `target: 'mermaid'`.

### Stage C2 — Unit tests for alias resolver

**File**: `tests/unit/cli/processors/arch-json-provider.test.ts` or dedicated test file

Test group: `describe('resolveModuleNodeToPackageId')`:

```typescript
it('strips @/ prefix and returns first component', () => {
  expect(resolveModuleNodeToPackageId('@/parser')).toBe('parser');
  expect(resolveModuleNodeToPackageId('@/cli/commands')).toBe('cli');
  expect(resolveModuleNodeToPackageId('@/mermaid/generator')).toBe('mermaid');
});

it('strips src/ prefix', () => {
  expect(resolveModuleNodeToPackageId('src/parser')).toBe('parser');
});

it('passes through bare package names unchanged', () => {
  expect(resolveModuleNodeToPackageId('parser')).toBe('parser');
});
```

**Dependencies**: C1

---

## Dependency Graph

```
Phase A (JSONC stripping) — independent
Phase B (workspaceRoot) — independent
Phase C (@/ resolver) — logically after A (alias resolution context) but can be done independently
A2 depends on A1
B2 depends on B1
C2 depends on C1
```

All three phases are mutually independent and can be implemented in any order.

---

## Testing Strategy

- **TDD**: Write failing tests (A2, B2, C2) first. Implement fixes. Verify tests pass.
- **No integration tests needed**: All fixes are pure logic changes testable with unit mocks or temp files.
- **Existing test suite**: Must remain green (2787+ tests) after all phases complete.
- **Self-validation**: After building, run `node dist/cli/index.js analyze -v --include-tests` on ArchGuard itself and verify that:
  - `detect_test_patterns` → `zeroAssertionRatio` drops from ~100% toward < 20%
  - `get_test_issues` → orphan count drops from ~140 toward < 20
  - Class diagram entities have relative IDs (no absolute path prefix)

---

## Acceptance Criteria

| Phase | Criterion |
|---|---|
| A | `loadPathAliases('/path/to/tsconfig.json')` returns non-null when file contains `//` comments |
| A | `loadPathAliases()` correctly extracts `paths` and `baseUrl` from commented tsconfig.json |
| A | `loadPathAliases()` still returns `undefined` on invalid JSON |
| B | `ParallelParser` constructed with `workspaceRoot = path.resolve(diagram.sources[0])` |
| B | Entity IDs in parsed ArchJSON are relative paths, not absolute |
| C | `@/parser` resolves to `parser` as a package entity ID |
| C | Package relations from moduleGraph edges use resolved IDs |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Comment regex strips `//` inside a JSON string | Documented limitation; tsconfig values never contain `//` |
| `workspaceRoot` wrong for diagrams with multiple sources | Use `sources[0]` — consistent with all other parse paths |
| Phase C introduces false package relations | Only applies when `@/` prefix present; strip is deterministic |
| Phase B changes entity ID format breaks existing data | Only affects fresh parses; disk-cached ArchJSON re-parsed on next run |

---

## Validation

After implementing all phases:

```bash
npm run build
node dist/cli/index.js analyze -v --include-tests
# Expected:
# - Fewer orphan test files reported
# - entityCoverageRatio > 50% (vs current ~2%)
# - Class diagrams include arrows between packages
# - Method entities have relative IDs (no /home/... prefix)
```
