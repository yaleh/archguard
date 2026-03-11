# Proposal: Fix TypeScript Plugin `exclude` Patterns Silently Dropped

**Slug**: `ts-plugin-exclude-fix`
**Status**: Draft
**Date**: 2026-03-11

---

## Problem Statement

When ArchGuard self-analyzes (i.e., `node dist/cli/index.js analyze -v` with no `-s` flag), the `exclude` patterns from `archguard.config.json` are silently discarded during TypeScript parsing. The result is that `dist/`, `experiments/`, `tests/`, and `scripts/` directories are all included in the parsed source set, inflating entity counts and polluting architectural diagrams with generated or non-production code.

### Root Cause 1 — `TypeScriptPlugin.initTsProject` ignores `ParseConfig.excludePatterns`

**File**: `src/plugins/typescript/index.ts`, lines 118–135

`initTsProject(workspaceRoot: string, pattern: string): Project` constructs the ts-morph `Project` and calls `project.addSourceFilesAtPaths(...)` with a hardcoded negation list:

```
`!${workspaceRoot}/**/*.test.ts`
`!${workspaceRoot}/**/*.spec.ts`
`!${workspaceRoot}/**/node_modules/**`
```

The caller at line 157, `this.initTsProject(workspaceRoot, pattern)`, is invoked from `parseProject(workspaceRoot: string, config: ParseConfig)` (line 141). `config.excludePatterns` — which was set by `ArchJsonProvider.parseTsPlugin()` at line 559 as `diagram.exclude ?? this.globalConfig.exclude ?? []` — is never read inside `initTsProject`. Patterns like `**/dist/**` and `**/experiments/**` that the caller supplies through `ParseConfig` are never added as negation entries to the ts-morph project.

### Root Cause 2 — `TypeScriptParser.parseProject` fallback also hardcodes exclusions

**File**: `src/parser/typescript-parser.ts`, lines 147–152

The fallback branch (executed when `externalProject` is `undefined`) hardcodes the same three negation patterns:

```
`!${rootDir}/**/*.test.ts`
`!${rootDir}/**/*.spec.ts`
`!${rootDir}/**/node_modules/**`
```

`TypeScriptParser.parseProject(rootDir: string, pattern: string, externalProject?: Project)` has no parameter for caller-supplied exclude patterns at all. When `TypeScriptPlugin.parseProject` constructs an `externalProject` via `initTsProject` and passes it in (line 160), the fallback branch is bypassed — but the exclusion problem already exists at the source in Root Cause 1. If the fallback branch is ever taken (e.g., in direct callers of `TypeScriptParser` that do not go through `TypeScriptPlugin`), the same silent drop occurs.

### Root Cause 3 — `archguard.config.json` missing high-impact patterns

**File**: `archguard.config.json`

The config file currently excludes only `**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**`, `**/dist/**`, `**/node_modules/**`. It is missing:

- `**/experiments/**` — a top-level directory containing PoC code and sub-repos with their own `node_modules`
- `**/tests/**` — project-level test directory (non-`__tests__` layout)
- `**/scripts/**` — build/utility scripts not part of the architectural subject
- `**/.archguard/**` — output directory written by previous analysis runs (contains generated TS files that would be re-parsed on the next run)

Even after fixing Root Causes 1 and 2, this third gap means the self-analysis still scans four large directories that should never appear in architecture diagrams.

---

## Goals

1. `TypeScriptPlugin.initTsProject` must forward `ParseConfig.excludePatterns` as negation globs to `project.addSourceFilesAtPaths`.
2. `TypeScriptParser.parseProject` fallback branch must accept and apply caller-supplied exclude patterns.
3. `archguard.config.json` must include patterns for `experiments/`, `tests/`, `scripts/`, and `.archguard/`.
4. No behavioral change for callers that pass an empty `excludePatterns` array (the hardcoded defaults must still be applied on top of any caller-supplied list, not replaced by it).

---

## Non-Goals

- Changing how `ParallelParser` (Path B in `ArchJsonProvider`) handles exclusions — it correctly receives a pre-filtered file list from `FileDiscoveryService` and is not affected.
- Modifying the Go, Java, Python, or C++ plugin exclusion paths — all four already forward `excludePatterns` correctly (visible at lines 510–514, 534, 579, 593–596 in `arch-json-provider.ts`).
- Altering `FileDiscoveryService` or the disk-cache key computation logic.
- Changing the `ParseConfig` interface — `excludePatterns: string[]` already exists at `src/core/interfaces/parser.ts` line 19.

---

## Design

### Change 1: Forward `excludePatterns` in `TypeScriptPlugin.initTsProject`

**File**: `src/plugins/typescript/index.ts`

Change the signature of the private helper from:

```typescript
private initTsProject(workspaceRoot: string, pattern: string): Project
```

to:

```typescript
private initTsProject(workspaceRoot: string, pattern: string, excludePatterns?: string[]): Project
```

Inside the method body, replace the hardcoded `addSourceFilesAtPaths` call (lines 128–133) with one that merges the caller-supplied patterns into the negation list. The built-in defaults (`*.test.ts`, `*.spec.ts`, `node_modules`) must always be present regardless of what the caller supplies:

```typescript
const builtinExcludes = [
  `!${workspaceRoot}/**/*.test.ts`,
  `!${workspaceRoot}/**/*.spec.ts`,
  `!${workspaceRoot}/**/node_modules/**`,
];
const callerExcludes = (excludePatterns ?? []).map((p) =>
  p.startsWith('!') || path.isAbsolute(p) ? p : `!${workspaceRoot}/${p}`
);
project.addSourceFilesAtPaths([
  `${workspaceRoot}/${pattern}`,
  ...builtinExcludes,
  ...callerExcludes,
]);
```

Update the call site at line 157 in `parseProject` from:

```typescript
const tsProject = this.initTsProject(workspaceRoot, pattern);
```

to:

```typescript
const tsProject = this.initTsProject(workspaceRoot, pattern, config.excludePatterns);
```

`config` is the `ParseConfig` argument already in scope at line 141. `config.excludePatterns` is typed as `string[]` per `src/core/interfaces/parser.ts` line 19.

### Change 2: Accept `excludePatterns` in `TypeScriptParser.parseProject` fallback branch

**File**: `src/parser/typescript-parser.ts`

Change the signature of `parseProject` from:

```typescript
parseProject(rootDir: string, pattern: string = '**/*.ts', externalProject?: Project): ArchJSON
```

to:

```typescript
parseProject(
  rootDir: string,
  pattern: string = '**/*.ts',
  externalProject?: Project,
  excludePatterns?: string[]
): ArchJSON
```

In the `else` branch (lines 134–152), replace the hardcoded `addSourceFilesAtPaths` call with the same merge logic described in Change 1, substituting `rootDir` for `workspaceRoot`.

No existing call site passes a fourth argument, so this is fully backwards-compatible.

### Change 3: Extend `archguard.config.json`

**File**: `archguard.config.json`

Add the four missing exclusion patterns to the `exclude` array:

```json
{
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/__tests__/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/experiments/**",
    "**/scripts/**",
    "**/.archguard/**"
  ],
  "verbose": true
}
```

> **Note**: `**/tests/**` has been intentionally omitted. Because `TypeScriptPlugin.initTsProject` sets `workspaceRoot = path.resolve('./src')`, ts-morph only scans files under `src/`. The `tests/` directory is a sibling of `src/` at the repo root — it is outside the workspace root and is never scanned, so adding `**/tests/**` to the exclusion list has no effect. The patterns above (`**/experiments/**`, `**/scripts/**`, `**/.archguard/**`) are similarly only useful when `workspaceRoot` covers the repo root rather than just `src/`. For this project's self-analysis they function as a safety net against any future change to the workspace root.

These patterns will propagate to `TypeScriptPlugin.initTsProject` via the call chain:

```
analyze.ts
  → ArchJsonProvider.get()               (arch-json-provider.ts:240)
  → ArchJsonProvider.parseTsPlugin()     (arch-json-provider.ts:557–560)
  → TypeScriptPlugin.parseProject()      (typescript/index.ts:141)
  → TypeScriptPlugin.initTsProject()     [after Change 1]
```

The `exclude` field from `archguard.config.json` is loaded into `GlobalConfig.exclude: string[]` (defined at `src/types/config-global.ts` line 9) and is already being passed to `parseTsPlugin` at `arch-json-provider.ts` line 559:

```typescript
return plugin.parseProject(workspaceRoot, {
  workspaceRoot,
  excludePatterns: diagram.exclude ?? this.globalConfig.exclude ?? [],
});
```

No changes are needed in `arch-json-provider.ts`.

---

## Alternatives Considered

### Alternative A: Fix only `archguard.config.json`, not the plugin code

Adding the missing patterns to config would address the self-analysis symptom, but the underlying code bug remains. Any caller that passes custom `excludePatterns` to `TypeScriptPlugin.parseProject` — including third-party integrators and future CLI flags — would still have their patterns silently discarded. Rejected because it only treats the symptom.

### Alternative B: Move all exclusion logic to `FileDiscoveryService` and pass a pre-filtered file list to `TypeScriptPlugin`

`FileDiscoveryService` already does correct exclusion for ParallelParser (Path B). Adapting the TypeScript plugin to accept a pre-filtered file list (`string[]`) instead of a workspace root + pattern pair would unify the exclusion path. However, `TypeScriptPlugin.initTsProject` uses `project.addSourceFilesAtPaths` with a glob because ts-morph needs to build its internal `Program` for TypeChecker to function — feeding individual file paths to `addSourceFileAtPath` one by one works but loses the lazy-loading optimisation ts-morph provides through glob matching. Rejected for now as a larger refactor; could be revisited if ts-morph performance becomes a concern.

### Alternative C: Honour `tsconfig.json` `exclude` field from the nearest tsconfig

`findTsConfigPath` (used at `typescript/index.ts:123`) already loads tsconfig. Extending `loadPathAliases` to also extract `exclude` from tsconfig and inject it would catch tsconfig-defined exclusions automatically. However, ArchGuard projects may not have an `exclude` section in their tsconfig (ArchGuard's own tsconfig does not), and this would not help config-file-driven exclusions at all. Rejected as a complementary concern that can be addressed separately.

### Technical Debt: `TypeScriptParser.parseProject` bespoke signature

`TypeScriptParser.parseProject` uses a bespoke positional-argument signature (`rootDir, pattern, externalProject?, excludePatterns?`) while the rest of the plugin system uses the `ParseConfig` interface. Change 2 works around this by appending a new positional `excludePatterns?` parameter rather than introducing a `ParseConfig` argument, preserving backwards compatibility with all existing call sites.

This positional style is a technical debt item. A future refactor should align `TypeScriptParser.parseProject` with `ParseConfig` (similar to how `TypeScriptPlugin.parseProject` already accepts it) so that all callers pass a single config object rather than a growing list of positional parameters.

---

## Open Questions

1. **Glob anchoring**: The negation patterns built in Change 1 use `!${workspaceRoot}/${p}` (no stripping). A caller-supplied pattern like `**/dist/**` becomes `!/abs/path/**/dist/**`, which correctly matches `dist/` at any depth under `workspaceRoot`. A pattern without a leading `**/` (e.g., `dist/**`) becomes `!/abs/path/dist/**`, which anchors to the root — also correct and intentional. Patterns that already start with `!` are passed through unchanged. Absolute paths without `!` are handled by the `path.isAbsolute(p)` guard — they are passed through as-is rather than prepended with `workspaceRoot`. Callers should not pass relative paths without a `**/` prefix. The glob-building helper should be unit-tested with all three variants.

2. **`experiments/` sub-repos**: The `experiments/` directory contains subdirectories with their own `node_modules`. Adding `**/experiments/**` to config excludes the whole tree at the glob level. Verify that ts-morph does not attempt to open symlinked paths under `experiments/` after the glob is applied.

3. **`TypeScriptAnalyzer.analyze` receives filtered source files**: After Change 1, `tsProject.getSourceFiles()` at `typescript/index.ts:165` will return the filtered set. `TypeScriptAnalyzer.analyze` at line 164 processes that set; confirm there are no assumptions about `dist/` or `experiments/` entities being present in the module graph.

4. **Test coverage**: Unit tests for `TypeScriptPlugin.parseProject` should assert that patterns in `config.excludePatterns` are honoured (entities from excluded paths must not appear in the returned `ArchJSON`). Existing tests in `tests/unit/plugins/` do not currently cover this path.

   **Affected test files**:
   - `tests/unit/parser/typescript-parser.test.ts` — calls `TypeScriptParser.parseProject` directly and will be affected by Change 2 (the new optional `excludePatterns` parameter). Ensure existing call sites compile and continue to pass after the signature change.
   - `tests/plugins/typescript/index.test.ts` — tests exclusion via `config.excludePatterns: ['**/*.test.ts']`. After Fix 1 is applied the generated negation glob will be `!${workspaceRoot}/**/*.test.ts` (correct form, no stripping). This test must continue to pass and serves as the primary regression guard for the glob-conversion logic.
