# Plan 07 — Go Plugin Merge

## Overview

This plan merges the two public `ILanguagePlugin` implementations for Go (`GoPlugin` in `src/plugins/golang/index.ts` and `GoAtlasPlugin` in `src/plugins/golang/atlas/index.ts`) into a single `GoPlugin` class. The merge eliminates a double-parse bug where every `.go` file is read and fed through tree-sitter twice per `parseProject` invocation (once via `goPlugin.parseProject` and once via `generateAtlas` → `goPlugin.parseToRawData`), removes the `atlasConfig.enabled === false` standard-mode fallback, and deletes the `--no-atlas` CLI flag. The `atlas/index.ts` file is reduced to a re-export shim so no cascading import changes are needed in callers or tests on the first pass.

---

## Phases

### Phase A — Merge GoPlugin internals into GoAtlasPlugin (rename to GoPlugin)

**Objective**: Replace the two-class composition with a single `GoPlugin` class in `src/plugins/golang/index.ts` that directly owns both the parser internals and the Atlas generation logic.

---

#### Stage A1 — Write failing tests for merged GoPlugin

Update `tests/plugins/golang/go-plugin.test.ts` to assert the post-merge metadata values. These assertions will fail immediately because the current `GoPlugin` still has the old metadata.

Specifically, add or update the following assertions in the `'should have correct metadata'` test (line 17–23 of the current file):

```typescript
// Change from:
expect(plugin.metadata.displayName).toBe('Go (Golang)');
// Change to:
expect(plugin.metadata.displayName).toBe('Go Architecture Atlas');
```

Also add an assertion for `supportedLevels` changing from `['package', 'class', 'method']` to `['package', 'capability', 'goroutine', 'flow']`:

```typescript
expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
```

And for `metadata.version` bumping from `'1.0.0'` to `'6.0.0'`:

```typescript
expect(plugin.metadata.version).toBe('6.0.0');
```

These tests will fail (still see `'Go (Golang)'`, `'1.0.0'`, `['package', 'class', 'method']`) until A2 is complete.

**Acceptance criteria**: `npm test -- tests/plugins/golang/go-plugin.test.ts` runs but the three new/changed assertions fail.

---

#### Stage A2 — Implement merged GoPlugin in `src/plugins/golang/index.ts`

Replace the current `GoPlugin` class body entirely with the merged implementation. The merged class:

- Implements both `ILanguagePlugin` and `IGoAtlas`
- Has `metadata.version = '6.0.0'`, `metadata.displayName = 'Go Architecture Atlas'`
- Has `supportedLevels = ['package', 'capability', 'goroutine', 'flow'] as const`

**New imports to add** (not present in the current `src/plugins/golang/index.ts`):

```typescript
import { BehaviorAnalyzer } from './atlas/behavior-analyzer.js';
import { AtlasRenderer } from './atlas/renderers/atlas-renderer.js';
import { GoModResolver } from './atlas/go-mod-resolver.js';
import { FrameworkDetector } from './atlas/framework-detector.js';
import type {
  GoArchitectureAtlas,
  AtlasConfig,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './atlas/types.js';
import { GO_ATLAS_EXTENSION_VERSION } from './atlas/types.js';
```

**New fields to add** (currently private to `GoAtlasPlugin`):

```typescript
private behaviorAnalyzer!: BehaviorAnalyzer;
private atlasRenderer!: AtlasRenderer;
private goModResolver!: GoModResolver;
```

These are initialised in `initialize()` (not the constructor) alongside `treeSitter`, `matcher`, `mapper`:

```typescript
this.goModResolver = new GoModResolver();
this.behaviorAnalyzer = new BehaviorAnalyzer(this.goModResolver);
this.atlasRenderer = new AtlasRenderer();
```

**`IGoAtlas` interface**: Move the `IGoAtlas` interface declaration from `atlas/index.ts` into `src/plugins/golang/index.ts` (it will be re-exported from the shim in A3):

```typescript
export interface IGoAtlas {
  generateAtlas(rootPath: string, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas>;
  renderLayer(atlas: GoArchitectureAtlas, layer: AtlasLayer, format: RenderFormat): Promise<RenderResult>;
}
```

**Module-level helpers**: Move the two module-level functions from `atlas/index.ts` into `src/plugins/golang/index.ts` (they can remain module-level):

- `isTestPackage(fullName: string): boolean` (lines 30–35 of current `atlas/index.ts`)
- `inferBodyStrategy(layers, explicit?)` (lines 37–44 of current `atlas/index.ts`)

**Rewritten `parseProject`**: The core change. The method no longer calls `this.goPlugin.parseProject(...)` and then `this.generateAtlas(...)` independently. Instead:

1. Reads `atlasConfig` from `config.languageSpecific?.['atlas']`.
2. Calls `parseToRawData` exactly once, passing combined exclude patterns (config + atlas + vendor + testdata + optionally `**/*_test.go`).
3. Optionally filters test packages from `rawData`.
4. Builds base `ArchJSON` from `rawData` inline (the logic currently in `GoPlugin.parseProject` lines 229–261 of `index.ts`): `matcher.matchWithGopls`, `mapper.mapEntities`, `mapper.mapRelations`, `mapper.mapMissingInterfaceEntities`.
5. Calls the new private `buildAtlasFromRawData` instead of `generateAtlas`, passing the already-parsed `rawData`.
6. Returns `{ ...baseArchJSON, extensions: { goAtlas: atlas } }`.

The `atlasConfig.enabled === false` branch is NOT present in the merged `parseProject`. The standard-mode fallback is removed entirely.

**New private method `buildAtlasFromRawData`**: Contains the module resolution, framework detection, and `Promise.all` over the four layer builders — the logic currently at lines 184–248 of `atlas/index.ts`, but receiving `rawData` directly instead of calling `this.goPlugin.parseToRawData(...)` again:

```typescript
private async buildAtlasFromRawData(
  rootPath: string,
  rawData: GoRawData,
  options?: AtlasGenerationOptions
): Promise<GoArchitectureAtlas>
```

**`generateAtlas` stays public**: The existing public `generateAtlas` method (used directly by `go-atlas-plugin.test.ts` line 79 and external callers) is moved verbatim from `atlas/index.ts`. It still calls `parseToRawData` internally (for when it is invoked standalone, not from `parseProject`). Internally it delegates to `buildAtlasFromRawData` after parsing:

```typescript
async generateAtlas(rootPath: string, options: AtlasGenerationOptions = {}): Promise<GoArchitectureAtlas> {
  // ... build excludePatterns, call parseToRawData, filter test packages ...
  return this.buildAtlasFromRawData(rootPath, rawData, options);
}
```

**`renderLayer`**: Moved verbatim from `atlas/index.ts` (line 252–258), now calls `this.atlasRenderer.render(atlas, layer, format)`.

**`dispose`**: The current `GoPlugin.dispose` disposes `goplsClient`. The current `GoAtlasPlugin.dispose` calls `this.goPlugin.dispose()`. The merged `dispose` disposes `goplsClient` directly (same logic, no delegation needed).

**`parseToRawData` stays public**: The current `GoPlugin.parseToRawData` (public, lines 122–220) is moved verbatim. It remains public because `go-plugin-merge.test.ts` calls it directly (lines 117, 169, 274 of that test file). The comment "Exposed for GoAtlasPlugin composition (ADR-001 v1.2)" should be updated to "Public API — called by tests and external tooling".

**Acceptance criteria**: `npm test -- tests/plugins/golang/go-plugin.test.ts` passes (including the three updated assertions added in A1).

---

#### Stage A3 — Create `src/plugins/golang/atlas/index.ts` re-export shim

Replace the entire content of `src/plugins/golang/atlas/index.ts` with:

```typescript
// Re-export shim — GoAtlasPlugin is now an alias for the merged GoPlugin.
// This file exists so that existing imports of GoAtlasPlugin continue to work
// without cascading changes across callers and test files.
export { GoPlugin as GoAtlasPlugin } from '../index.js';
export type { IGoAtlas } from '../index.js';
```

This means:
- `import { GoAtlasPlugin } from '@/plugins/golang/atlas/index.js'` continues to resolve.
- `import type { IGoAtlas } from '@/plugins/golang/atlas/index.js'` continues to resolve.
- The old `GoAtlasPlugin` class body (imports, delegation wrappers, `goPlugin` field, `IGoAtlas` declaration) is deleted.

**Acceptance criteria**: `npm run type-check` passes. No TypeScript errors about missing exports.

---

#### Stage A4 — Update `tests/plugins/golang/atlas/go-atlas-plugin.test.ts`

This test file must be updated because several spies target `(plugin as any).goPlugin.*` which no longer exists after the merge.

**Update 1 — `canHandle` delegation test (lines 52–61)**:

```typescript
// Before
describe('canHandle', () => {
  it('delegates canHandle to goPlugin', async () => {
    const goPlugin = (plugin as any).goPlugin;
    const spy = vi.spyOn(goPlugin, 'canHandle').mockReturnValue(true);
    const result = plugin.canHandle('/some/file.go');
    expect(spy).toHaveBeenCalledWith('/some/file.go');
    expect(result).toBe(true);
  });
});

// After — spy directly on the merged plugin; no delegation to test
describe('canHandle', () => {
  it('handles .go files directly', () => {
    expect(plugin.canHandle('/some/file.go')).toBe(true);
    expect(plugin.canHandle('/some/file.ts')).toBe(false);
  });
});
```

**Update 2 — `initialize` spy targets (lines 68, 114, 153)**:

```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);

// After — mock directly on plugin; initialize on the merged class touches filesystem
vi.spyOn(plugin, 'initialize').mockResolvedValue(undefined);
await plugin.initialize({ workspaceRoot: '/test' });
```

However, since `initialize` is a real method on the merged plugin, the cleaner approach for `generateAtlas` and `parseProject` test suites is: instead of mocking `initialize`, call the real `initialize` but mock `treeSitter` and `goplsClient` after initialization. The simplest approach matching the existing test structure is to mock `plugin.initialize` itself.

**Update 3 — `parseProject` spy on `goPlugin.parseProject` (lines 117, 135, 155)**:

These spies mock `(plugin as any).goPlugin.parseProject` to avoid parsing and return a canned `minimalArchJSON`. After the merge, `parseProject` is no longer delegated, so mocking it on `goPlugin` is meaningless.

The correct replacement is to mock `parseToRawData` on the merged plugin directly (already done by the `parseToRawData` spy in the same `beforeEach`). Remove the `goPlugin.parseProject` spy lines entirely from the two `beforeEach` blocks in the `'parseProject default atlas mode'` and `'parseProject atlas mode'` describe blocks (lines 117 and 155).

The `atlas enabled=false → standard mode` test (lines 133–145) must be **deleted entirely**. The `atlasConfig.enabled === false` branch no longer exists.

**Update 4 — `parseToRawData` spy targets (lines 72, 118, 156, 181)**:

```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(minimalRawData);

// After — parseToRawData is now directly on the merged plugin (public method)
vi.spyOn(plugin, 'parseToRawData').mockResolvedValue(minimalRawData);
```

**Update 5 — `goModResolver` spy (lines 75, 119, 157)**:

```typescript
// Unchanged — goModResolver is still a private field named goModResolver on the merged class
vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
```

**Update 6 — `metadata.version` assertion (line 47)**:

```typescript
// Before
it('metadata.version is "5.0.0"', () => {
  expect(plugin.metadata.version).toBe('5.0.0');
});

// After
it('metadata.version is "6.0.0"', () => {
  expect(plugin.metadata.version).toBe('6.0.0');
});
```

**Update 7 — `parseProject` test title rename**:

Rename `'no atlas config → atlas mode by default (result has extensions.goAtlas)'` to `'parseProject always produces extensions.goAtlas'`. The assertion body remains identical.

Add a spy assertion inside this test to confirm `parseToRawData` is called exactly once per `parseProject` invocation:

```typescript
it('parseProject always produces extensions.goAtlas', async () => {
  const parseToRawDataSpy = vi.spyOn(plugin, 'parseToRawData').mockResolvedValue(minimalRawData);

  const result = await plugin.parseProject('/test', { workspaceRoot: '/test' });

  expect(parseToRawDataSpy).toHaveBeenCalledTimes(1); // double-parse fix
  const extensions = (result as any).extensions;
  expect(extensions).toBeDefined();
  expect(extensions.goAtlas).toBeDefined();
});
```

**Acceptance criteria**: `npm test -- tests/plugins/golang/atlas/go-atlas-plugin.test.ts` passes.

**Dependencies**: A1 before A2, A2 before A3, A4 depends on A3 (the shim must exist before A4's import can resolve). A3 and A4 are therefore sequential, not parallel.

---

#### Stage A5 — Update `tests/plugins/golang/atlas/excludeTests.test.ts`

This test file also has `(plugin as any).goPlugin.*` spies that break after the merge. Every spy in this file targets the old composition field that will no longer exist.

**Three spy targets to update**:

**`initialize` spy** (line 123):
```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);

// After — initialize lives directly on the merged plugin
vi.spyOn(plugin, 'initialize').mockResolvedValue(undefined);
```

**`parseToRawData` spies** (lines 133, 145, 156, 168, 179, 191, 207, 219, 230, 241, 252, 279, 295, 312 — all occurrences matching the pattern `(plugin as any).goPlugin, 'parseToRawData'`):
```typescript
// Before (all occurrences)
vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(rawData...);

// After — parseToRawData is public on the merged plugin
vi.spyOn(plugin, 'parseToRawData').mockResolvedValue(rawData...);
```

**`parseProject` spy** in the `'AtlasConfig.excludeTests wired via parseProject'` `beforeEach` (line 274):
```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'parseProject').mockResolvedValue(minimalArchJSON);

// After — this spy is no longer needed; delete this line.
// The 'AtlasConfig.excludeTests wired via parseProject' tests call plugin.parseProject()
// directly and spy on plugin.parseToRawData directly (updated above).
// The beforeEach mock of goPlugin.parseProject was preventing the merged parseProject
// from reaching the atlas generation path; removing it lets the real parseProject run
// while still short-circuiting filesystem access via the parseToRawData mock.
```

Note: The `enabled: true` in `atlas: { enabled: true, excludeTests: true }` and `atlas: { enabled: true, excludeTests: false }` (lines 285, 302) can be left in place for this stage — the field becomes a no-op after the merge but causes no harm. Removing it is covered by Fix W3 (Stage B, `types.ts`).

**Acceptance criteria**: `npm test -- tests/plugins/golang/atlas/excludeTests.test.ts` passes.

---

#### Stage A6 — Update `tests/unit/plugins/supported-levels.test.ts`

**File**: `/home/yale/work/archguard/tests/unit/plugins/supported-levels.test.ts`

This file currently tests `GoPlugin` and `GoAtlasPlugin` as two distinct plugins with different `supportedLevels`. After the merge, `GoAtlasPlugin` is a re-export alias for the same class, so the two tests become redundant, and the `GoPlugin` assertion must change.

**Change 1** — Update `GoPlugin.supportedLevels` assertion (line 19–21):
```typescript
// Before
it('GoPlugin has supportedLevels ["package", "class", "method"]', () => {
  const plugin = new GoPlugin();
  expect(plugin.supportedLevels).toEqual(['package', 'class', 'method']);
});

// After
it('GoPlugin has supportedLevels ["package", "capability", "goroutine", "flow"]', () => {
  const plugin = new GoPlugin();
  expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
});
```

**Change 2** — The `GoAtlasPlugin` test (lines 23–26) now asserts the same class via a shim. Update its description to reflect this, and confirm it still passes (no assertion body change needed since both now resolve to the same class):
```typescript
// Before
it('GoAtlasPlugin has supportedLevels ["package", "capability", "goroutine", "flow"]', () => {
  const plugin = new GoAtlasPlugin();
  expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
});

// After — make clear this is now a shim alias; assertion body unchanged
it('GoAtlasPlugin (shim alias for GoPlugin) has supportedLevels ["package", "capability", "goroutine", "flow"]', () => {
  const plugin = new GoAtlasPlugin();
  expect(plugin.supportedLevels).toEqual(['package', 'capability', 'goroutine', 'flow']);
});
```

**Change 3** — The `'supportedLevels is a readonly array on each plugin'` test (lines 38–51) instantiates both `new GoPlugin()` and `new GoAtlasPlugin()` in the same array. After the merge both resolve to the same class; the test still passes, but a comment should be added noting that the two entries exercise the same implementation via different import paths:
```typescript
// Before (line 39–45)
const plugins = [
  new TypeScriptPlugin(),
  new GoPlugin(),
  new GoAtlasPlugin(),
  new JavaPlugin(),
  new PythonPlugin(),
];

// After — add clarifying comment
const plugins = [
  new TypeScriptPlugin(),
  new GoPlugin(),           // merged class
  new GoAtlasPlugin(),      // re-export shim → same class as GoPlugin
  new JavaPlugin(),
  new PythonPlugin(),
];
```

**Acceptance criteria**: `npm test -- tests/unit/plugins/supported-levels.test.ts` passes with 0 failures.

---

### Phase B — Remove `--no-atlas` flag and standard-mode fallback

**Objective**: Delete the `--no-atlas` flag from the CLI, remove the `atlasConfig.enabled === false` code path from `normalize-to-diagrams.ts`, and clean up the `atlas?` / `noAtlas?` fields from the `CLIOptions` type.

---

#### Stage B1 — Remove from `src/cli/analyze/normalize-to-diagrams.ts`

Five locations to change in this file:

**Line 28** — Remove the `cliOptions.atlas ? 'go' : undefined` ternary. After the merge, the `--atlas` flag alone no longer gates Go mode; language is always inferred from `--lang go`. The `language` variable should be:

```typescript
// Before (line 28)
const language = cliOptions.lang ?? (cliOptions.atlas ? 'go' : undefined);

// After
const language = cliOptions.lang;
```

**Line 29** — Simplify `atlasEnabled`. After the merge, whenever `language === 'go'` the Atlas diagram is always produced:

```typescript
// Before (line 29)
const atlasEnabled = language === 'go' && cliOptions.atlas !== false;

// After
const atlasEnabled = language === 'go';
```

**Lines 52–62** — Delete the entire `if (language === 'go' && cliOptions.atlas === false)` branch that produced a plain `class`-level diagram. This block no longer has any path to reach it:

```typescript
// Delete entirely:
if (language === 'go' && cliOptions.atlas === false) {
  const diagram: DiagramConfig = {
    name: 'architecture',
    sources: cliOptions.sources,
    level: 'class',
    format: cliOptions.format,
    exclude: cliOptions.exclude,
    language,
  };
  return [diagram];
}
```

**Lines 104–124** (the `if (cliOptions.lang === 'go' || ...)` block):

- Line 104: Simplify the condition. The `cliOptions.lang === undefined && cliOptions.atlas` part can be removed since `--atlas` alone no longer implies `--lang go`. Change to:

  ```typescript
  // Before (line 104)
  if (cliOptions.lang === 'go' || (cliOptions.lang === undefined && cliOptions.atlas)) {

  // After
  if (cliOptions.lang === 'go') {
  ```

- Line 115: Remove `enabled: cliOptions.atlas !== false` from the atlas config object. After the merge, `enabled` has no effect; the field can be omitted or set to `true` unconditionally. Simplest change: delete that line.

  ```typescript
  // Before (line 115):
  atlas: {
    enabled: cliOptions.atlas !== false,
    functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
    ...
  }

  // After:
  atlas: {
    functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
    ...
  }
  ```

**Line 41** — Remove `enabled: true` from the `atlasEnabled` branch's `languageSpecific.atlas` object (the branch at lines 31–49 that currently starts `if (atlasEnabled) { ... }`). After the merge the `enabled` field is unnecessary in both atlas config blocks. The current code at line 41 is:

  ```typescript
  // Before (line 41, inside the atlasEnabled branch):
  atlas: {
    enabled: true,
    functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
    ...
  }

  // After:
  atlas: {
    functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
    ...
  }
  ```

  This location was previously undocumented in this plan. Both `enabled: true` (line 41) and `enabled: cliOptions.atlas !== false` (line 115) are in the same file and should be removed together.

**Acceptance criteria**: `npm run type-check` passes. No TypeScript errors about `atlas` / `noAtlas` on `CLIOptions`.

---

#### Stage B2 — Remove from `src/cli/commands/analyze.ts` and `src/types/config-cli.ts`

**`src/cli/commands/analyze.ts` line 127**: Remove the `.option('--no-atlas', ...)` line:

```typescript
// Delete this line:
.option('--no-atlas', 'Disable Go Architecture Atlas mode (opt-out for --lang go)')
```

The `--atlas-layers`, `--atlas-strategy`, `--atlas-no-tests`, `--atlas-include-tests`, and `--atlas-protocols` options are kept — they configure Atlas generation and remain meaningful. See the decision on `--atlas` itself below.

**`src/types/config-cli.ts`**: Remove the `atlas?: boolean` and `noAtlas?: boolean` fields from `CLIOptions`:

```typescript
// Before (lines 20–21):
atlas?: boolean;
noAtlas?: boolean;

// After: both lines deleted
```

Note: `atlasLayers`, `atlasStrategy`, `atlasNoTests`, `atlasIncludeTests`, `atlasProtocols` remain in `CLIOptions` — they configure the Atlas generation itself and are still used.

**Decision on `--atlas` flag** (line 126 of `analyze.ts`): The `--atlas` flag itself (`.option('--atlas', 'Enable Go Architecture Atlas mode (default when --lang go)')`) should be **removed** alongside `--no-atlas`. After the merge, Atlas mode is always active for `--lang go`; the flag has no function. Removing it avoids user confusion ("if it's always on, why is there an enable flag?"). The `--atlas-layers`, `--atlas-strategy`, `--atlas-no-tests`, `--atlas-include-tests`, and `--atlas-protocols` options are kept — they fine-tune Atlas generation, not whether it runs. The `CLIOptions.atlas?: boolean` removal in `config-cli.ts` (above) eliminates the TypeScript field; removing the Commander `.option('--atlas', ...)` line eliminates the CLI surface.

**`src/plugins/golang/atlas/types.ts`** — Deprecate the `enabled` field from `AtlasConfig`. The `enabled: boolean` field (currently required, line 119) should be changed to `enabled?: boolean` and marked deprecated:

```typescript
// Before (line 118–119 of types.ts):
export interface AtlasConfig {
  enabled: boolean;

// After:
export interface AtlasConfig {
  /** @deprecated Atlas mode is always active for language 'go'. This field is ignored. */
  enabled?: boolean;
```

Making it optional (`enabled?: boolean`) avoids breaking callers that still pass `enabled: true` (like `excludeTests.test.ts` lines 285, 302 which can be cleaned up in a later pass). It is fully removed once all call sites are updated.

**Acceptance criteria**: `npm run type-check` passes, `npm run lint` passes.

**Dependencies**: A2 must be complete before B1 and B2 (so the merged plugin exists). B1 and B2 can be done in parallel with each other.

---

### Phase C — Validation

#### Stage C1 — Verify `arch-json-provider.ts` Go path and its test

**File**: `src/cli/processors/arch-json-provider.ts` lines 499–515 (`parseGoProject` private method).

The method performs a dynamic import:
```typescript
const { GoAtlasPlugin } = await import('@/plugins/golang/atlas/index.js');
return new GoAtlasPlugin();
```

After the shim is in place (A3), this import resolves to `GoPlugin` re-exported as `GoAtlasPlugin`. The runtime behavior is correct and requires no code change to `arch-json-provider.ts` itself — the shim handles it transparently.

**`tests/unit/cli/processors/arch-json-provider.test.ts`** — The Go routing test (lines 114–136) mocks `@/plugins/golang/atlas/index.js` directly:
```typescript
vi.doMock('@/plugins/golang/atlas/index.js', () => ({
  GoAtlasPlugin: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    parseProject: mockParseProject,
  })),
}));
```

This mock works correctly through the shim: it replaces the entire module at the path `@/plugins/golang/atlas/index.js`, so it intercepts both the pre-merge `GoAtlasPlugin` class and the post-merge re-export. No change is needed to this test.

**Action**: Verify by running `npm test -- tests/unit/cli/processors/arch-json-provider.test.ts` after A3 is complete. If all tests pass, no edits are required. If the dynamic import fails to resolve through the shim in the test environment (e.g. because `vi.doMock` does not follow re-exports), change the mock target from `@/plugins/golang/atlas/index.js` to `@/plugins/golang/index.js` and update the import key from `GoAtlasPlugin` to `GoPlugin`.

---

#### Stage C2 — Full test suite

Run `npm test`. All tests must pass. The target is 2165+ passing tests with 0 failures.

Pay special attention to:
- `tests/plugins/golang/go-plugin.test.ts` — should pass with updated metadata assertions
- `tests/plugins/golang/go-plugin-merge.test.ts` — should pass unchanged (no modifications needed)
- `tests/plugins/golang/atlas/go-atlas-plugin.test.ts` — should pass with updated spies
- `tests/plugins/golang/atlas/excludeTests.test.ts` — should pass with updated spies (A5)
- `tests/unit/plugins/supported-levels.test.ts` — should pass with updated GoPlugin assertion (A6)
- `tests/unit/cli/processors/arch-json-provider.test.ts` — should pass unchanged or with mock target update (C1)
- `tests/cross-language.test.ts` — should pass unchanged (uses `GoPlugin` directly from `@/plugins/golang/index.js`, no `GoAtlasPlugin` reference)

#### Stage C3 — Build and self-validate

```bash
npm run build
node dist/cli/index.js analyze -v
```

Verify the Go plugin path is still reachable and no import errors occur in the built output.

#### Stage C4 — Verify no stale imports

Search for any remaining imports of the old `GoPlugin` as a standalone `ILanguagePlugin` implementor that should now import the merged class:

```bash
grep -r "GoPlugin" src/ --include="*.ts"
```

The only occurrences should be:
- `src/plugins/golang/index.ts` — the merged class definition and `IGoAtlas` interface
- `src/plugins/golang/atlas/index.ts` — the re-export shim (`export { GoPlugin as GoAtlasPlugin }`)
- Any provider/registry file that still imports `GoAtlasPlugin` from the shim path (acceptable — shim handles this)

Search for the old `enabled: false` pattern to confirm removal:

```bash
grep -r "atlas.*enabled.*false\|enabled.*false.*atlas" src/ --include="*.ts"
```

Should return zero results.

**Dependencies**: A2, A3, A4, A5, A6, B1, B2 must all be complete before running C.

---

## File Change Summary

| File | Change type | What changes |
|---|---|---|
| `src/plugins/golang/index.ts` | Rewrite | Old `GoPlugin` class replaced with merged class implementing `ILanguagePlugin` + `IGoAtlas`; new imports for Atlas dependencies; `IGoAtlas` interface moved here; `isTestPackage` and `inferBodyStrategy` helpers added; `parseProject` rewritten to single parse pass; `buildAtlasFromRawData` private method added; `generateAtlas` and `renderLayer` moved in from `atlas/index.ts`; `initialize` gains `goModResolver`/`behaviorAnalyzer`/`atlasRenderer` construction; metadata version `'6.0.0'`, displayName `'Go Architecture Atlas'`, supportedLevels `['package', 'capability', 'goroutine', 'flow']` |
| `src/plugins/golang/atlas/index.ts` | Rewrite (shim) | All current content deleted; replaced with two re-export lines: `export { GoPlugin as GoAtlasPlugin }` and `export type { IGoAtlas }` from `'../index.js'` |
| `src/types/config-cli.ts` | Edit | Remove `atlas?: boolean` and `noAtlas?: boolean` fields from `CLIOptions` |
| `src/cli/commands/analyze.ts` | Edit | Remove `.option('--no-atlas', ...)` line (line 127); remove `.option('--atlas', ...)` line (line 126) |
| `src/cli/analyze/normalize-to-diagrams.ts` | Edit | Line 28: remove `atlas ?` ternary; line 29: simplify `atlasEnabled`; line 41: remove `enabled: true`; lines 52–62: delete `atlas === false` branch; line 104: simplify `if` condition; line 115: remove `enabled: cliOptions.atlas !== false` |
| `src/plugins/golang/atlas/types.ts` | Edit | `AtlasConfig.enabled` changed from `enabled: boolean` to `/** @deprecated */ enabled?: boolean` |
| `tests/plugins/golang/go-plugin.test.ts` | Edit | Update `displayName` assertion (`'Go (Golang)'` → `'Go Architecture Atlas'`); add `supportedLevels` and `version` assertions |
| `tests/plugins/golang/atlas/go-atlas-plugin.test.ts` | Edit | Update all `(plugin as any).goPlugin.*` spies to target merged plugin directly; remove `atlas enabled=false` test; update `metadata.version` assertion to `'6.0.0'`; add `parseToRawData` call-count assertion; rename test title |
| `tests/plugins/golang/atlas/excludeTests.test.ts` | Edit | Update `(plugin as any).goPlugin.initialize` → `plugin.initialize`; all `(plugin as any).goPlugin.parseToRawData` → `plugin.parseToRawData`; remove `(plugin as any).goPlugin.parseProject` mock from beforeEach |
| `tests/unit/plugins/supported-levels.test.ts` | Edit | `GoPlugin.supportedLevels` assertion: `['package', 'class', 'method']` → `['package', 'capability', 'goroutine', 'flow']`; update `GoAtlasPlugin` test description to note it is now a shim alias; add comment in readonly-array test noting both entries exercise the same class |
| `tests/plugins/golang/go-plugin-merge.test.ts` | No change | All spies already target `plugin` or `(plugin as any).treeSitter`; `parseToRawData` is still public on the merged class |
| `tests/unit/cli/processors/arch-json-provider.test.ts` | Verify only (likely no change) | Dynamic import mock targets `@/plugins/golang/atlas/index.js` which still works through the shim; change mock target if shim resolution fails in test environment |
| `tests/cross-language.test.ts` | No change | Uses `GoPlugin` from `@/plugins/golang/index.js` directly; no `GoAtlasPlugin` reference; no assertions on `supportedLevels` |

All other files in `src/plugins/golang/atlas/` (`behavior-analyzer.ts`, `atlas-renderer.ts`, `framework-detector.ts`, `go-mod-resolver.ts`, builders, renderers) are unchanged.

---

## Acceptance Criteria (overall)

- `GoAtlasPlugin` no longer exists as a standalone class with its own `ILanguagePlugin` implementation; it is an alias for `GoPlugin` exported from the re-export shim
- The `private goPlugin: GoPlugin` composition field in `GoAtlasPlugin` is gone
- Single merged `GoPlugin` class in `src/plugins/golang/index.ts` implements both `ILanguagePlugin` and `IGoAtlas`
- `metadata.version` is `'6.0.0'`, `metadata.displayName` is `'Go Architecture Atlas'`, `supportedLevels` is `['package', 'capability', 'goroutine', 'flow']`
- `--no-atlas` and `--atlas` flags are removed from `analyze.ts` and `CLIOptions`
- `atlasConfig.enabled === false` branch is gone from `normalize-to-diagrams.ts`
- Both `enabled: true` (line 41) and `enabled: cliOptions.atlas !== false` (line 115) are removed from `normalize-to-diagrams.ts`
- `atlas?: boolean` and `noAtlas?: boolean` are removed from `CLIOptions` in `config-cli.ts`
- `AtlasConfig.enabled` is deprecated (`enabled?: boolean`) in `src/plugins/golang/atlas/types.ts`
- Double-parse eliminated: `parseToRawData` is called exactly once per `parseProject` invocation (verified by spy assertion in `go-atlas-plugin.test.ts`)
- The `PluginRegistry` detection rule `{ file: 'go.mod', plugin: 'golang' }` in `src/core/plugin-registry.ts` continues to work without modification
- `npm test` passes with 2165+ tests, 0 failures
- `npm run build` succeeds
- `npm run type-check` passes
- `npm run lint` passes
