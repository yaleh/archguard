# Plan 08: Fix TypeScript Plugin `exclude` Patterns Silently Dropped

**Proposal**: `docs/proposals/proposal-ts-plugin-exclude-fix.md`
**Status**: Ready for implementation
**Date**: 2026-03-11

---

## Overview

When ArchGuard self-analyzes, the `exclude` patterns defined in `archguard.config.json` are silently discarded during TypeScript parsing. Two independent code paths are affected: `TypeScriptPlugin.initTsProject` (which builds the ts-morph `Project` used by `parseProject`) never reads `ParseConfig.excludePatterns`, and `TypeScriptParser.parseProject`'s fallback branch has no parameter for caller-supplied exclusions at all. A third gap exists in `archguard.config.json` itself, which is missing entries for `experiments/`, `scripts/`, and `.archguard/`. This plan fixes all three root causes in one phase across three independent stages, then validates the combined result end-to-end.

---

## Phase 1: Three-Stage Fix

### Stage 1: Forward `excludePatterns` in `TypeScriptPlugin.initTsProject`

#### Objective

Make the private `initTsProject` helper accept and apply caller-supplied exclusion patterns so that `ParseConfig.excludePatterns` propagates all the way into the ts-morph `Project`.

#### Files to Change

- `src/plugins/typescript/index.ts`

#### Specific Code Changes

**Step 1.1** — `import path from 'path'` is already present at line 6. No import change needed.

**Step 1.2** — Change the signature of `initTsProject` at line 118 from:

```typescript
private initTsProject(workspaceRoot: string, pattern: string): Project
```

to:

```typescript
private initTsProject(workspaceRoot: string, pattern: string, excludePatterns?: string[]): Project
```

**Step 1.3** — Replace the `project.addSourceFilesAtPaths` call at lines 128–133 with:

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

**Step 1.4** — Update the call site at line 157 from:

```typescript
const tsProject = this.initTsProject(workspaceRoot, pattern);
```

to:

```typescript
const tsProject = this.initTsProject(workspaceRoot, pattern, config.excludePatterns);
```

`config` is the `ParseConfig` argument already in scope (line 141). `config.excludePatterns` is typed `string[]` per `src/core/interfaces/parser.ts` line 19.

#### TDD Approach

**Failing test first** — Add to `tests/plugins/typescript/index.test.ts`, inside the existing `describe('parseProject')` block (after line 289):

```typescript
it('should exclude files matching excludePatterns from the result', async () => {
  const srcDir = path.join(tempDir, 'src');
  const distDir = path.join(tempDir, 'dist');
  await fs.ensureDir(srcDir);
  await fs.ensureDir(distDir);
  await fs.writeFile(path.join(srcDir, 'main.ts'), 'export class Main {}');
  await fs.writeFile(path.join(distDir, 'app.ts'), 'export class AppCompiled {}');

  const config: ParseConfig = {
    workspaceRoot: tempDir,
    excludePatterns: ['**/dist/**'],
  };

  const result = await plugin.parseProject(tempDir, config);

  // Positive control: non-excluded source must still produce one entity
  const mainEntities = result.entities.filter((e) => e.name === 'Main');
  expect(mainEntities).toHaveLength(1);

  // Negative control: excluded dist/ file must produce no entities
  const distFiles = result.sourceFiles.filter((f) => f.includes('/dist/'));
  expect(distFiles).toHaveLength(0);
  const distEntities = result.entities.filter((e) => e.name === 'AppCompiled');
  expect(distEntities).toHaveLength(0);
});
```

> **Note on `app.js.ts`**: An earlier draft used `app.js.ts` as the dist filename. That double-extension is unusual and ts-morph's `**/*.ts` glob may not pick it up, causing the test to pass vacuously (no entity found regardless of whether exclusion works). Use plain `app.ts` to ensure ts-morph does scan the file without exclusion, making the test genuinely fail before the fix.

This test fails before Stage 1 because `initTsProject` ignores `excludePatterns` — `AppCompiled` appears in the result and `distFiles` is non-empty. It passes after Step 1.3–1.4.

The positive control assertion (`Main` entity present) additionally guards against regressions where the fix accidentally excludes too much or breaks scanning of the non-excluded source.

**Additionally**, the existing test at line 274 (`'should exclude test files by default'`) already exercises `excludePatterns: ['**/*.test.ts']` and serves as a regression guard. Confirm it still passes after the change (it will, because the negation glob formula for a pattern that does not start with `!` and is not absolute is `!${workspaceRoot}/${p}`, which is exactly what ts-morph expects).

> **Known duplication (W1)**: After this change, a caller that passes `**/*.test.ts` in `excludePatterns` will cause that pattern to appear twice in the array passed to `addSourceFilesAtPaths` — once from `builtinExcludes` and once from `callerExcludes`. This duplication is harmless; ts-morph deduplicates glob matches internally. It is noted here so that future readers do not mistake it for a bug.

#### Acceptance Criteria

- `npm test -- tests/plugins/typescript/index.test.ts` passes (all existing tests + the new one).
- The new test's `distFiles` assertion confirms zero files under `dist/` in `result.sourceFiles`.
- Existing `'should exclude test files by default'` test continues to pass unchanged.

---

### Stage 2: Accept `excludePatterns` in `TypeScriptParser.parseProject` Fallback Branch

#### Objective

Add an `excludePatterns?` parameter to `TypeScriptParser.parseProject` and apply it in the `else` branch so that direct callers of `TypeScriptParser` (not going through `TypeScriptPlugin`) also respect caller-supplied exclusions.

#### Files to Change

- `src/parser/typescript-parser.ts`

#### Specific Code Changes

**Step 2.1** — Change the signature of `parseProject` at line 124 from:

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

**Step 2.2** — In the `else` branch, replace the hardcoded `addSourceFilesAtPaths` call at lines 147–152 with the same merge logic, substituting `rootDir` for `workspaceRoot`:

```typescript
const builtinExcludes = [
  `!${rootDir}/**/*.test.ts`,
  `!${rootDir}/**/*.spec.ts`,
  `!${rootDir}/**/node_modules/**`,
];
const callerExcludes = (excludePatterns ?? []).map((p) =>
  p.startsWith('!') || path.isAbsolute(p) ? p : `!${rootDir}/${p}`
);
fsProject.addSourceFilesAtPaths([
  `${rootDir}/${pattern}`,
  ...builtinExcludes,
  ...callerExcludes,
]);
```

No existing call site passes a fourth argument, so this is fully backwards-compatible with zero change to callers.

#### TDD Approach

**Failing test first** — Add a new `describe` block to `tests/unit/parser/typescript-parser.test.ts` (after the last existing `describe` block):

```typescript
describe('TypeScriptParser - parseProject excludePatterns', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'archguard-parser-test-'));
    mkdirSync(path.join(tempDir, 'src'));
    mkdirSync(path.join(tempDir, 'generated'));
    writeFileSync(path.join(tempDir, 'src', 'service.ts'), 'export class Service {}');
    writeFileSync(path.join(tempDir, 'generated', 'gen.ts'), 'export class Generated {}');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should exclude files matching caller-supplied patterns in the fallback branch', () => {
    const parser = new TypeScriptParser(tempDir);
    // Pass undefined for externalProject to force the else-branch
    const result = parser.parseProject(tempDir, '**/*.ts', undefined, ['**/generated/**']);

    const generatedFiles = result.sourceFiles.filter((f) => f.includes('/generated/'));
    expect(generatedFiles).toHaveLength(0);
    const generatedEntities = result.entities.filter((e) => e.name === 'Generated');
    expect(generatedEntities).toHaveLength(0);
    // src/service.ts must still be present
    const serviceEntities = result.entities.filter((e) => e.name === 'Service');
    expect(serviceEntities).toHaveLength(1);
  });

  it('should still exclude test files by default even with no excludePatterns', () => {
    writeFileSync(path.join(tempDir, 'src', 'service.test.ts'), 'describe("x", () => {})');
    const parser = new TypeScriptParser(tempDir);
    const result = parser.parseProject(tempDir, '**/*.ts', undefined, []);

    const testFiles = result.sourceFiles.filter((f) => f.endsWith('.test.ts'));
    expect(testFiles).toHaveLength(0);
  });
});
```

These tests fail before Step 2.2 because the hardcoded `addSourceFilesAtPaths` in the `else` branch ignores the new parameter. They pass after the fix.

#### Acceptance Criteria

- `npm test -- tests/unit/parser/typescript-parser.test.ts` passes (all existing tests + the two new ones).
- Passing `undefined` for `externalProject` explicitly forces the `else` branch; the `Generated` entity must not appear in results.
- Passing `[]` for `excludePatterns` produces identical behavior to the pre-fix baseline (builtin defaults still applied).

---

### Stage 3: Extend `archguard.config.json`

#### Objective

Add the four patterns missing from the self-analysis exclusion list so that `experiments/`, `scripts/`, and `.archguard/` directories are excluded when ArchGuard analyzes itself.

#### Files to Change

- `archguard.config.json`

#### Specific Code Changes

Replace the `exclude` array at lines 2–8 with:

```json
"exclude": [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/__tests__/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/experiments/**",
  "**/scripts/**",
  "**/.archguard/**"
]
```

No code changes. The new patterns propagate to `TypeScriptPlugin.initTsProject` via the existing call chain:

```
analyze.ts
  → ArchJsonProvider.get()               (arch-json-provider.ts, Path A branch ~line 309)
  → this.parseTsPlugin(diagram)          (arch-json-provider.ts:333, inside registerDeferred)
  → TypeScriptPlugin.parseProject()      (typescript/index.ts:141)
  → TypeScriptPlugin.initTsProject()     [after Stage 1]
```

> **W4 note**: The `parseTsPlugin` private method is defined at `arch-json-provider.ts:546`. It is *invoked* at line 333 inside the `get()` method's Path A branch (TypeScript Plugin path). An earlier draft incorrectly cited lines 557–560 as the invocation site; the correct invocation line is **333**.

`parseTsPlugin` already passes `diagram.exclude ?? this.globalConfig.exclude ?? []` (or equivalent) as `excludePatterns` when calling `TypeScriptPlugin.parseProject()`. No changes are needed in `arch-json-provider.ts`.

#### TDD Approach

No unit test for a JSON config change. Validation is done manually and via the end-to-end self-analysis run in the Validation stage below.

> **S4 — Why `**/tests/**` is omitted**: The `workspaceRoot` for self-analysis resolves to `./src` (ArchGuard's own source directory). The `tests/` directory is a sibling of `src/` at the repo root, so ts-morph never scans it in the default case — adding `**/tests/**` to this config would have no effect. Including it could also confuse users who invoke `node dist/cli/index.js analyze -s .` (repo root), where ts-morph *would* scan `tests/` and the pattern would then silently start excluding those files. The correct fix in that scenario is to pass a narrower `-s ./src`, not to expand the exclusion list.

Before Stage 3, running `node dist/cli/index.js analyze -v` includes entities from `experiments/` in the package diagram. After Stage 3 (with Stage 1 also applied), the same command must show no `experiments` package node.

#### Acceptance Criteria

- `archguard.config.json` contains all eight patterns (five existing + three new).
- `node dist/cli/index.js analyze -v` produces no package or entity entries from `experiments/`, `scripts/`, or `.archguard/` directories.

---

### Validation Stage

#### Objective

Confirm that all three stages together produce a clean self-analysis with correct entity counts and no pollution from generated or auxiliary directories.

#### Steps

1. Run the full test suite and confirm no regressions:
   ```bash
   npm test
   ```
   Expected: all tests pass (2165+ passing, 0 failing).

2. Type-check the changed files:
   ```bash
   npm run type-check
   ```
   Expected: no type errors. The new optional parameter `excludePatterns?: string[]` on both `initTsProject` and `TypeScriptParser.parseProject` is backwards-compatible.

3. Build the project:
   ```bash
   npm run build
   ```

4. Run self-analysis and inspect output:
   ```bash
   node dist/cli/index.js analyze -v
   ```
   Expected:
   - Verbose output shows no files from `dist/`, `experiments/`, `scripts/`, or `.archguard/` directories.
   - Package diagram contains only production source packages (e.g., `cli`, `parser`, `plugins`, `types`, `utils`, etc.).
   - Entity count is significantly lower than before the fix (pre-fix: inflated by dist/ and experiments/ classes; post-fix: only `src/` entities).

#### Acceptance Criteria

- `npm test` exits 0.
- `npm run type-check` exits 0.
- `npm run build` exits 0.
- `node dist/cli/index.js analyze -v` produces package diagrams free of `dist`, `experiments`, `scripts`, and `.archguard` nodes.

---

## Implementation Order

Stages 1 and 2 are fully independent and can be implemented in parallel. Stage 3 is also independent at the code level but is most meaningfully tested after Stage 1 is merged (since Stage 1 is what makes the config patterns take effect). Recommended order:

1. Stage 2 first (pure backend fix, lowest risk, no test fixture infrastructure needed beyond `mkdtempSync`).
2. Stage 1 next (adds a parameter to the private helper and its single call site).
3. Stage 3 last (config-only, validate with self-analysis after Stages 1 and 2 are merged).
4. Validation stage after all three are merged.

> **W5 — Parallel implementer alignment**: Stages 1 and 2 share identical `builtinExcludes + callerExcludes` merge logic (the only difference is the variable name: `workspaceRoot` in Stage 1, `rootDir` in Stage 2). If two developers implement these stages in parallel, they must agree on the exact formula *before* starting — specifically the `p.startsWith('!') || path.isAbsolute(p) ? p : \`!\${root}/${p}\`` guard. The second implementer should copy the formula verbatim from Stage 1 (or from the draft above) to prevent a divergence that would later cause inconsistent exclusion behaviour across the two code paths.

---

## Risk and Rollback

- **Risk**: A caller-supplied pattern such as `**/dist/**` becomes `!/abs/path/**/dist/**` after the formula is applied. This double-star anchoring is intentional and matches at any depth under `workspaceRoot`. Verify with the unit test in Stage 2 that `callerExcludes` are applied correctly before merging.
- **No behavioral change for empty `excludePatterns`**: When `config.excludePatterns` is `[]` or `undefined`, `callerExcludes` is `[]` and `addSourceFilesAtPaths` receives only the three hardcoded builtin exclusions — identical to the pre-fix behavior.
- **Rollback**: Revert `src/plugins/typescript/index.ts` and `src/parser/typescript-parser.ts` to their pre-change signatures. The `archguard.config.json` change is harmless on its own (extra exclusion patterns that were already ignored by the bug).
