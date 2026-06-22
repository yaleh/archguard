# Plan 33: Go Import Dependency Edges

**Status**: Draft
**Date**: 2026-03-13
**Proposal**: `docs/proposals/proposal-go-import-dependency-edges.md`

---

## Overview

Wire the already-collected `GoRawPackage.imports` data into `mapRelations()` so that
same-module package imports produce `dependency` relations in ArchJSON. This converts
isolated-node Go package diagrams into diagrams with real architectural edges.

The change is a **data-wiring problem only** — no new parsing, no new types, no new
dependencies. The implementation is roughly 25 new lines in `archjson-mapper.ts` plus
one-line argument additions at three call sites in `index.ts`.

---

## Phase Dependencies

```
Phase 1 (Data Layer)
  └─► Phase 2 (Integration Wiring)
        └─► Phase 3 (Validation)
```

Each phase is independently testable. Phase 2 cannot start before Phase 1 is green.
Phase 3 is a manual self-validation step with no code changes.

---

## Phase 1 — Data Layer: Emit dependency edges in `mapRelations()`

**Goal**: Extend `ArchJsonMapper.mapRelations()` to accept `moduleName` and emit
`dependency` relations for same-module imports. All eleven test cases from the proposal
must pass. No changes to `index.ts` yet — the tests call the mapper directly.

**Files touched**:
- `tests/plugins/golang/archjson-mapper.test.ts` (Stage 1.1 — new test group)
- `src/plugins/golang/archjson-mapper.ts` (Stage 1.2 — implementation)

**Acceptance criteria**:
- All 11 new tests in the `mapRelations — dependency edges` group pass.
- All existing tests in `archjson-mapper.test.ts` continue to pass.
- `mapRelations([], [], '')` (old call signature with empty string) returns an empty
  array without throwing — backward compat for callers that have not yet been updated.
- `npm run type-check` passes with the new signature.

**Estimated code change**: ~60 lines new test code + ~25 lines implementation = ~85
lines total. Well within the 200-line-per-stage and 500-line-per-phase limits.

---

### Stage 1.1 — Write tests for dependency edge emission

**File**: `tests/plugins/golang/archjson-mapper.test.ts`
**Approach**: Add a new `describe` block after the existing three blocks. No production
code changes yet — all tests in this block will fail (red) until Stage 1.2.

New test group: `mapRelations — dependency edges`

Test cases (in order of ascending complexity):

| # | Name | Fixture | Expected |
|---|------|---------|----------|
| 1 | Basic same-module dependency | pkg A imports pkg B (same module) | 1 `dependency` relation: `source: 'internal/api'`, `target: 'internal/svc'` |
| 2 | Stdlib import excluded | pkg imports `"fmt"` only | 0 dependency relations |
| 3 | External module import excluded | pkg imports `"github.com/gin-gonic/gin"` | 0 dependency relations |
| 4 | Unknown moduleName (`"unknown"`) | moduleName = `"unknown"` | 0 dependency relations |
| 5 | Duplicate imports deduplicated | same import path twice in `imports[]` | exactly 1 relation |
| 6 | Self-import guard | source pkg imports itself | 0 dependency relations |
| 7 | Blank import (`_`) | alias = `"_"`, path resolves to known pkg | 1 `dependency` relation emitted |
| 8 | Both implementation and dependency | impl + import in same call | both relation types present, no collision |
| 9 | Three-package chain (A → B → C) | A imports B, B imports C | 2 `dependency` relations |
| 10 | No imports | pkg.imports = [] | 0 new relations |
| 11 | `parseFiles`-style absolute fullNames | fullNames are absolute paths | 0 dependency relations (lookup mismatch expected) |

Helper additions needed in the test file:

```typescript
/** Minimal GoImport fixture */
function makeImport(importPath: string, alias?: string): GoImport {
  return { path: importPath, alias };
}
```

(Import `GoImport` from `'../../../src/plugins/golang/types.js'`.)

Call convention for all new tests:

```typescript
mapper.mapRelations(packages, implementations, moduleName)
```

---

### Stage 1.2 — Implement dependency edges in `mapRelations()`

**File**: `src/plugins/golang/archjson-mapper.ts`

**Signature change**:

```typescript
// Before
mapRelations(packages: GoRawPackage[], implementations: InferredImplementation[]): Relation[]

// After
mapRelations(
  packages: GoRawPackage[],
  implementations: InferredImplementation[],
  moduleName = ''
): Relation[]
```

Using a default value of `''` means all existing callers that pass two arguments continue
to compile and run without change. An empty `moduleName` must be guarded against because
`importPath.startsWith('/')` is false for all valid Go import paths (they start with a
module domain or stdlib segment, never `/`), but more importantly an empty `moduleName`
means "no module context" and the loop should produce zero edges. Guard with
`if (moduleName)` before the prefix computation, or use
`moduleName && importPath.startsWith(moduleName + '/')` in the condition.

**Implementation sketch** (replaces the `// TODO` comment at line 163):

```typescript
// Build dependency edges from package imports
if (moduleName) {
  const prefix = moduleName + '/';
  const knownFullNames = new Set(packages.map((p) => p.fullName || p.name));

  for (const pkg of packages) {
    const source = pkg.fullName || pkg.name;
    for (const imp of pkg.imports) {
      if (!imp.path.startsWith(prefix)) continue;
      const target = imp.path.slice(prefix.length);
      if (target === source) continue;           // self-import guard
      if (!knownFullNames.has(target)) continue; // unknown package — skip
      this.pushUniqueRelation(
        relations,
        seen,
        this.createExplicitRelation('dependency', source, target, {
          inferenceSource: 'explicit',
        })
      );
    }
  }
}
```

All deduplication is handled by the existing `seen` Set (key =
`dependency:source:target`), satisfying test case 5 at zero extra cost.

**Verify after Stage 1.2**:

```bash
npm test -- tests/plugins/golang/archjson-mapper.test.ts
npm run type-check
```

All 11 new tests green. No regressions.

---

## Phase 2 — Integration Wiring: Pass `moduleName` through `index.ts` call sites

**Goal**: Wire `moduleName` into all three `mapRelations()` call sites in `index.ts` so
that `parseProject` (the production path) emits real dependency edges. Also add an
integration test that exercises `parseProject` end-to-end on a synthetic Go project
fixture and asserts that dependency relations appear in the ArchJSON output.

**Files touched**:
- `src/plugins/golang/index.ts` (Stage 2.1 — three one-line call site updates)
- `tests/plugins/golang/go-plugin-merge.test.ts` or a new fixture test (Stage 2.2)

**Acceptance criteria**:
- `parseToRawData` returns a `GoRawData` where `moduleName` matches the module declared
  in `go.mod`, confirming the data required by `mapRelations` is available at the call site.
- When `mapRelations` is called with `rawData.packages` and `rawData.moduleName` (mimicking
  what `parseProject` does after Stage 2.1), ≥1 `dependency` relation with the correct
  `source` and `target` `fullName` values is emitted for a two-package fixture where one
  package imports the other.
- `parseFiles` call site compiles with no type errors; no dependency relations are emitted
  (absolute-path fullNames never match stripped import paths — documented in proposal §3).
- `parseCode` call site compiles with no type errors; no dependency relations emitted.
- All existing `go-plugin-merge.test.ts` and `go-plugin.test.ts` tests still pass.

**Estimated code change**: ~3 lines in `index.ts` + ~60 lines in test file = ~63 lines
total.

---

### Stage 2.1 — Update `mapRelations` call sites in `index.ts`

**File**: `src/plugins/golang/index.ts`

Three call sites, each gaining one argument:

| Method | Line (approx) | Current call | Updated call |
|--------|---------------|--------------|--------------|
| `parseCode` | ~204 | `this.mapper.mapRelations([pkg], implementations)` | `this.mapper.mapRelations([pkg], implementations, this.cachedModuleName)` |
| `parseFiles` | ~273 | `this.mapper.mapRelations(packageList, implementations)` | `this.mapper.mapRelations(packageList, implementations, this.cachedModuleName)` |
| `parseProject` | ~345 | `this.mapper.mapRelations(rawData.packages, implementations)` | `this.mapper.mapRelations(rawData.packages, implementations, rawData.moduleName)` |

After editing:

```bash
npm run type-check
npm test -- tests/plugins/golang/
```

---

### Stage 2.2 — Integration test: `parseToRawData` + mapper pipeline emits dependency edges

**File**: `tests/plugins/golang/go-plugin-merge.test.ts` (add a new `describe` block) or
a new file `tests/plugins/golang/go-plugin-dependency-edges.test.ts`.

This stage tests the **wired pipeline** — `parseToRawData` followed by `mapRelations` —
not the mapper in isolation (which Stage 1.1 already covers exhaustively). The goal is to
confirm that `rawData.moduleName` flows correctly from `go.mod` parsing through to
`mapRelations`, and that the `ArchJSON.relations` array produced by `parseProject` (or
the equivalent `parseToRawData` + mapper pipeline) contains `dependency` entries.

Use the same mocking pattern as `go-plugin-merge.test.ts`: mock `glob` to return a fake
file list and mock `fs-extra.readFile` to return synthetic Go source content. Mock
`fs-extra.existsSync` to return `true` for the `go.mod` path so `readModuleName()` can
read the mocked module name.

**Fixture sketch** (mocked filesystem, no temp directories):

```typescript
describe('GoPlugin - dependency edges via parseToRawData pipeline', () => {
  it('mapRelations receives moduleName from parseToRawData and emits dependency relations', async () => {
    const { glob } = await import('glob');
    const fs = await import('fs-extra');

    const apiFile = `${WS}/internal/api/handler.go`;
    const svcFile = `${WS}/internal/svc/service.go`;
    const goModPath = `${WS}/go.mod`;

    vi.mocked(glob).mockResolvedValue([apiFile, svcFile] as any);
    vi.mocked(fs.default.existsSync).mockImplementation((p) => p === goModPath);
    vi.mocked(fs.default.readFile).mockImplementation(async (p) => {
      if (p === goModPath) return 'module github.com/org/app\n\ngo 1.21\n';
      if (p === apiFile)
        return `package api\nimport "github.com/org/app/internal/svc"\n`;
      return `package svc\n`;
    });

    const rawData = await plugin.parseToRawData(WS, { workspaceRoot: WS });

    // rawData.moduleName must be populated from go.mod
    expect(rawData.moduleName).toBe('github.com/org/app');

    // Wire up the same way parseProject does (after Stage 2.1)
    const mapper = new ArchJsonMapper();
    const relations = mapper.mapRelations(rawData.packages, [], rawData.moduleName);

    const depRel = relations.find((r) => r.type === 'dependency');
    expect(depRel).toBeDefined();
    expect(depRel!.source).toBe('internal/api');
    expect(depRel!.target).toBe('internal/svc');
  });
});
```

This confirms that `rawData.moduleName` is populated before the mapper is called, which
is the integration contract that Stage 2.1 depends on.

**Verify after Stage 2.2**:

```bash
npm test -- tests/plugins/golang/
```

All tests green, including the new integration test.

---

## Phase 3 — Validation: Self-validate on a real Go project

**Goal**: Confirm that the feature works end-to-end on a real multi-package Go project
and that no regressions have been introduced in the full test suite.

**No code changes in this phase.** All steps are manual shell commands.

**Acceptance criteria**:
- Full test suite passes: `npm test` shows 0 failures.
- `node dist/cli/index.js analyze -s <go-project-root> --lang go -f json` produces
  ArchJSON with `relations` entries where `type === "dependency"` and `source`/`target`
  match known package `fullName` values.
- Package diagram (Mermaid) for the same project shows edges between package nodes
  (not disconnected islands).

---

### Stage 3.1 — Full test suite green

```bash
npm test
npm run type-check
npm run lint
```

Expected: same pass count as before ± the new tests added in Phases 1–2. Zero failures.

---

### Stage 3.2 — Smoke test on meta-cc or a small Go project

```bash
npm run build
# Substitute a real Go project path below
node dist/cli/index.js analyze -s /path/to/go-project --lang go -f json \
  | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
      const deps = d.relations.filter(r => r.type === 'dependency');
      console.log('dependency relations:', deps.length);
      deps.slice(0,5).forEach(r => console.log(' ', r.source, '->', r.target));
    "
```

Expected output: `dependency relations: N` where N > 0 for any non-trivial Go project.

---

### Stage 3.3 — Package diagram shows edges

```bash
node dist/cli/index.js analyze -s /path/to/go-project --lang go --diagrams package
# Open .archguard/overview/package.md or .archguard/overview/package.svg
```

Verify visually that the flowchart diagram contains `-->` arrows between package nodes.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `moduleName` default `''` causes accidental matches | Low | Medium | Guard with `if (moduleName)` before the loop |
| Duplicate imports in `GoRawPackage.imports` inflate relation count | Low | Low | Existing `seen` Set deduplicates automatically |
| `parseFiles` silently emits zero edges (correct) causes confusion | Low | Low | Document in code comment at call site |
| ID namespace inconsistency (`fullName` vs `entity ID`) breaks downstream consumers | Medium | Medium | No change needed in renderers (already handle `dependency`); note in commit message for MCP tool authors |
| Test fixture uses wrong `GoImport` shape | Low | Low | Import `GoImport` type from `types.ts` in test; TypeScript will catch shape mismatches |

---

## Summary

| Phase | Stages | Key files | ~Lines changed | Independently testable |
|-------|--------|-----------|---------------|------------------------|
| 1 — Data Layer | 1.1 (tests), 1.2 (impl) | `archjson-mapper.ts`, `archjson-mapper.test.ts` | ~85 | Yes — mapper is pure |
| 2 — Integration Wiring | 2.1 (call sites), 2.2 (integration test) | `index.ts`, `go-plugin-merge.test.ts` | ~63 | Yes — mapper already correct |
| 3 — Validation | 3.1 (suite), 3.2 (smoke), 3.3 (diagram) | None (build + manual) | 0 | N/A — validation only |
| **Total** | 5 stages | 4 files | **~148** | — |
