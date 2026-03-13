# Proposal: Fix @/ Alias Resolution and Absolute Entity IDs

**Status**: Proposed
**Priority**: CRITICAL
**Affected subsystems**: `src/utils/tsconfig-finder.ts`, `src/cli/processors/arch-json-provider.ts`

---

## Problem Statement

Three related bugs cause incorrect or missing entity resolution when ArchGuard analyzes TypeScript projects:

### Bug 1 — JSONC parse failure in `loadPathAliases()`

`src/utils/tsconfig-finder.ts:49` calls `JSON.parse(fs.readFileSync(tsConfigFilePath, 'utf8'))` directly on `tsconfig.json`. TypeScript's own spec allows comments (`// ...` and `/* ... */`) and trailing commas in `tsconfig.json` (JSONC format). Every real-world `tsconfig.json` contains comments.

`JSON.parse` throws on comments. The `catch {}` block silently returns `undefined`, so `loadPathAliases()` always returns `undefined` in practice. This means `@/` alias imports are never resolved in `extractTestStructure()`, producing near-100% orphan rate for TypeScript projects.

### Bug 2 — Missing `workspaceRoot` in `parseWithParallelParser()`

`src/cli/processors/arch-json-provider.ts:610` constructs `ParallelParser` without `workspaceRoot`:

```typescript
const parser = new ParallelParser({
  concurrency: this.globalConfig.concurrency,
  continueOnError: true,
  parseCache: this.parseCache,
  // workspaceRoot NOT passed
});
```

`ParallelParser` passes `workspaceRoot` to `TypeScriptParser` (line 273), which uses it to relativize entity file paths. Without it, `method/*` diagram entities get absolute file paths in their IDs (e.g., `/home/user/work/myapp/src/core/parser.ts.Parser`) instead of relative IDs (e.g., `core/parser.ts.Parser`). This breaks cross-diagram entity linking.

### Bug 3 — @/ targets in package JSON output are unresolved

When `tsAnalysis.moduleGraph` edges are injected into JSON-format relations, the edge `from`/`to` values are module paths like `@/parser`. These appear verbatim in package-diagram relations as unresolved strings, not as entity IDs (which are short package names like `parser`). The package diagram filter then rejects them as unknown sources.

---

## Proposed Solution

### Fix 1: Strip comments before JSON.parse (JSONC support)

Replace the direct `JSON.parse()` call in `loadPathAliases()` with a pre-processing step that strips line and block comments from the raw JSONC text before parsing.

A simple two-regex approach is sufficient:
1. Strip block comments: `content.replace(/\/\*[\s\S]*?\*\//g, '')`
2. Strip line comments: `content.replace(/\/\/[^\n]*/g, '')`

This covers all common tsconfig.json patterns. Known limitation: `//` inside a JSON string value would be incorrectly stripped, but tsconfig.json values do not contain comment-like sequences in practice.

### Fix 2: Pass `workspaceRoot` to ParallelParser

`parseWithParallelParser()` receives a `DiagramConfig` (`_diagram`) parameter — the underscore prefix indicates it was left unused. The fix is to derive `workspaceRoot` from `diagram.sources[0]` (same pattern used in `parseTsPlugin()` and `parseCppProject()`) and pass it to `ParallelParser`.

### Fix 3: Resolve @/ targets in moduleGraph edge injection

After edges from `tsAnalysis.moduleGraph` are added to the relations array (in diagram processing), a post-processing step maps `@/foo` → `foo` using the known alias convention. Since `@/*` maps to `src/*` and entity IDs at package level are the top-level directory name (e.g., `parser`, `cli`, `mermaid`), the mapping is: strip `@/`, take the first path component.

---

## Expected Impact

- `loadPathAliases()` correctly parses any real-world `tsconfig.json` including those with comments and trailing commas
- `entityCoverageRatio` for TypeScript projects (ArchGuard itself) should improve from ~2% toward > 60%
- `method/*` entity IDs become relative, enabling cross-diagram linking
- Package diagram relations include module graph edges correctly

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Comment regex strips `//` inside a JSON string | Rare in tsconfig values; known limitation documented in code |
| `workspaceRoot` derivation wrong for multi-source diagrams | Use `diagram.sources[0]` (consistent with other parse paths) |
| Fix 3 maps valid package names incorrectly | Only applies to `@/`-prefixed targets; non-alias targets are unaffected |
