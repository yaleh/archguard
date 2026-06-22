# Proposal: Merge GoPlugin into GoAtlasPlugin (Golang Plugin Consolidation)

**Status:** Draft
**Date:** 2026-03-11
**Scope:** `src/plugins/golang/`

---

## 1. Problem Statement

There are currently two public `ILanguagePlugin` implementations for Go:

| Class | File | Role |
|---|---|---|
| `GoPlugin` | `src/plugins/golang/index.ts` | Base parser — tree-sitter, interface matching, ArchJSON mapping |
| `GoAtlasPlugin` | `src/plugins/golang/atlas/index.ts` | Delegates to `GoPlugin` + adds Atlas layer generation |

`GoAtlasPlugin` wraps `GoPlugin` via composition (ADR-001 v1.2): it holds a `private goPlugin: GoPlugin` field (line 88 of `atlas/index.ts`) and delegates every `ILanguagePlugin` method to it (`initialize`, `canHandle`, `parseCode`, `parseFiles`, `dispose`). The `metadata.name` of both classes is `'golang'`; only `GoAtlasPlugin` is ever registered or constructed by external callers (see `arch-json-provider.ts` line 502–503).

This produces three concrete problems:

**A. Unnecessary indirection.** Every `ILanguagePlugin` call made on `GoAtlasPlugin` passes through a delegation wrapper before hitting the real implementation in `GoPlugin`. There is no polymorphic reason for `GoPlugin` to remain a separate public class — it is not registered, not instantiated by callers, and not tested in isolation for any behavior that `GoAtlasPlugin` itself does not own.

**B. Double-parse bug in `parseProject`.** In the Atlas path of `GoAtlasPlugin.parseProject` (lines 132–145 of `atlas/index.ts`), the code makes two independent parse passes over the Go source tree:

1. `this.goPlugin.parseProject(workspaceRoot, config)` — internally calls `goPlugin.parseToRawData()`, runs interface matching, and maps to ArchJSON.
2. `this.generateAtlas(...)` — internally calls `this.goPlugin.parseToRawData(rootPath, ...)` again with different options (body extraction, test exclusion).

Every `.go` file is read from disk and fed through the tree-sitter parser twice. For large projects this doubles I/O and CPU time.

**C. Accidental standard-mode surface.** The `atlasConfig.enabled === false` branch in `GoAtlasPlugin.parseProject` (line 127–129 of `atlas/index.ts`) exists solely because `GoPlugin.parseProject` exists as a separate callable entry point. The `--no-atlas` flag in `normalize-to-diagrams.ts` (lines 52–61) uses this path to produce a plain class diagram. This partial-mode behaviour is unnecessary complexity that we want to retire.

---

## 2. Goals

1. **Single `ILanguagePlugin` implementation for Go.** The merged class is named `GoPlugin` and lives at `src/plugins/golang/index.ts`. The separate `src/plugins/golang/atlas/index.ts` file is deleted or reduced to a re-export shim.
2. **Fix the double-parse bug.** `parseToRawData` is called exactly once per `parseProject` invocation. Its `GoRawData` result is used both to produce the base `ArchJSON` (entities + relations via `ArchJsonMapper`) and to drive Atlas layer generation (via `BehaviorAnalyzer`).
3. **Remove the `--no-atlas` / `atlasConfig.enabled === false` standard-mode fallback.** Go analysis is Atlas-only. The `--no-atlas` flag is removed from the CLI and from `normalize-to-diagrams.ts`.
4. **Preserve `metadata.name = 'golang'`** and `metadata.version` (bump to `'6.0.0'` to mark the breaking change). The `PluginRegistry` detection rule `{ file: 'go.mod', plugin: 'golang' }` (line 143 of `plugin-registry.ts`) continues to resolve to the merged plugin without modification.
5. **No behavioral change for Atlas output.** All four layers (`package`, `capability`, `goroutine`, `flow`), the `GoArchitectureAtlas` shape, and the `extensions.goAtlas` field on the returned `ArchJSON` remain identical.

---

## 3. Non-Goals

- No new features are added.
- Atlas layer generation logic (`BehaviorAnalyzer`, `AtlasRenderer`, `FrameworkDetector`, `GoModResolver`) is not modified.
- The `IGoAtlas` interface signature is unchanged (though its export location moves; see §4.4).
- Test coverage targets are not changed; we migrate existing tests rather than writing new ones.
- `GoRawData`, `GoRawPackage`, and other types in `src/plugins/golang/types.ts` are not modified.

---

## 4. Design

### 4.1 Fields and Methods Moving from `GoPlugin` into the Merged Class

The merged `GoPlugin` will own directly what is currently split across two files:

**From `src/plugins/golang/index.ts` (currently `GoPlugin`) — moved verbatim:**

| Member | Type | Notes |
|---|---|---|
| `metadata` | `PluginMetadata` | `name: 'golang'`, `version` bumped to `'6.0.0'`, `displayName` updated to `'Go Architecture Atlas'` |
| `supportedLevels` | `readonly string[]` | Changed from `['package', 'class', 'method']` to `['package', 'capability', 'goroutine', 'flow']` (Atlas levels) |
| `dependencyExtractor` | `IDependencyExtractor` | Constructed directly: `new DependencyExtractor()` |
| `treeSitter` | `TreeSitterBridge` | Private field, moved in |
| `matcher` | `InterfaceMatcher` | Private field, moved in |
| `mapper` | `ArchJsonMapper` | Private field, moved in |
| `goplsClient` | `GoplsClient \| null` | Private field, moved in |
| `initialized` | `boolean` | Private field |
| `workspaceRoot` | `string` | Private field |
| `initialize(config)` | `async` | Moved in verbatim |
| `canHandle(targetPath)` | sync | Moved in verbatim |
| `parseCode(code, filePath)` | sync | Moved in verbatim |
| `parseFiles(filePaths)` | `async` | Moved in verbatim |
| `parseToRawData(workspaceRoot, config)` | `async` | Moved in verbatim — this is the single parse entry point |
| `readModuleName(workspaceRoot)` | `async private` | Moved in verbatim |
| `ensureInitialized()` | `private` | Moved in verbatim |
| `dispose()` | `async` | Merged with Atlas disposal (currently both just call `goplsClient.dispose()`) |

**From `src/plugins/golang/atlas/index.ts` (currently `GoAtlasPlugin`) — moved verbatim or adapted:**

| Member | Type | Notes |
|---|---|---|
| `behaviorAnalyzer` | `BehaviorAnalyzer` | Private field, kept |
| `atlasRenderer` | `AtlasRenderer` | Private field, kept |
| `goModResolver` | `GoModResolver` | Private field, kept |
| `generateAtlas(rootPath, options)` | `async` | Moved in, **adapted** (see §4.2) |
| `renderLayer(atlas, layer, format)` | `async` | Moved in verbatim |
| `parseProject(workspaceRoot, config)` | `async` | **Rewritten** (see §4.2) |
| `isTestPackage(fullName)` | module-level function | Moved into the file, can remain module-level or become a private static method |
| `inferBodyStrategy(layers, explicit)` | module-level function | Same treatment |

**Dropped:**
- The `private goPlugin: GoPlugin` composition field in `GoAtlasPlugin` — eliminated.
- The delegation wrappers in `GoAtlasPlugin`: `initialize → goPlugin.initialize`, `canHandle → goPlugin.canHandle`, `parseCode → goPlugin.parseCode`, `parseFiles → goPlugin.parseFiles`, `dispose → goPlugin.dispose`.
- The `atlasConfig.enabled === false` branch in `parseProject`.

### 4.2 How the Double-Parse is Fixed

The root cause is that `GoAtlasPlugin.parseProject` (current `atlas/index.ts` lines 122–151) calls `this.goPlugin.parseProject(...)` to get base ArchJSON and then calls `this.generateAtlas(...)` which internally calls `this.goPlugin.parseToRawData(...)` again.

After the merge, `parseProject` is rewritten to:

1. Call `parseToRawData` once, storing the result as `rawData: GoRawData`.
2. Optionally filter test packages from `rawData` (already done in `generateAtlas` at lines 177–183 of `atlas/index.ts`).
3. Build base ArchJSON from `rawData` inline, replicating the logic currently in `GoPlugin.parseProject` (lines 230–261 of `index.ts`): `matcher.matchWithGopls`, `mapper.mapEntities`, `mapper.mapRelations`, `mapper.mapMissingInterfaceEntities`.
4. Call `generateAtlas`, but pass `rawData` as a parameter instead of letting `generateAtlas` call `parseToRawData` again.

This requires a small signature change to `generateAtlas`:

**Before (current):**
```typescript
// atlas/index.ts line 155
async generateAtlas(rootPath: string, options: AtlasGenerationOptions = {}): Promise<GoArchitectureAtlas>
// Inside: calls this.goPlugin.parseToRawData(rootPath, {...})
```

**After (merged):**
```typescript
// Two overloads or an optional parameter:
async generateAtlas(rootPath: string, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas>
// Internal variant used by parseProject:
private async buildAtlasFromRawData(rootPath: string, rawData: GoRawData, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas>
```

The `IGoAtlas` interface's public `generateAtlas` signature is preserved unchanged. Internally, `generateAtlas` still calls `parseToRawData` when invoked directly (e.g. from tests or external code). `parseProject` calls the private `buildAtlasFromRawData` instead, skipping the second parse.

Concretely, the merged `parseProject` body becomes:

```typescript
async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
  const atlasConfig = config.languageSpecific?.['atlas'] as AtlasConfig | undefined;
  const layers = atlasConfig?.layers ?? ['package', 'capability', 'goroutine', 'flow'];
  const functionBodyStrategy = inferBodyStrategy(layers, atlasConfig?.functionBodyStrategy);
  const excludeTests = atlasConfig?.excludeTests ?? true;

  // Single parse pass
  const rawData = await this.parseToRawData(workspaceRoot, {
    workspaceRoot,
    includePatterns: config.includePatterns,
    excludePatterns: [
      ...(config.excludePatterns ?? []),
      ...(atlasConfig?.excludePatterns ?? []),
      '**/vendor/**',
      '**/testdata/**',
      ...(excludeTests ? ['**/*_test.go'] : []),
    ],
    extractBodies: functionBodyStrategy !== 'none',
    selectiveExtraction: functionBodyStrategy === 'selective',
  });

  // Filter test packages from rawData (same logic as current generateAtlas lines 177-183)
  const filteredRawData = excludeTests
    ? { ...rawData, packages: rawData.packages.filter(p => !isTestPackage(p.fullName)) }
    : rawData;

  // Build base ArchJSON from rawData (no second parse)
  const allStructs = filteredRawData.packages.flatMap(p =>
    p.structs.map(s => ({ ...s, packageName: p.fullName || p.name }))
  );
  const allInterfaces = filteredRawData.packages.flatMap(p =>
    p.interfaces.map(i => ({ ...i, packageName: p.fullName || p.name }))
  );
  const implementations = await this.matcher.matchWithGopls(allStructs, allInterfaces, this.goplsClient);
  const entities = this.mapper.mapEntities(filteredRawData.packages);
  const relations = this.mapper.mapRelations(filteredRawData.packages, implementations);
  const missingInterfaces = this.mapper.mapMissingInterfaceEntities(entities, relations, filteredRawData.packages);
  entities.push(...missingInterfaces);

  const baseArchJSON: ArchJSON = {
    version: '1.0',
    language: 'go',
    timestamp: new Date().toISOString(),
    sourceFiles: filteredRawData.packages.flatMap(p => p.sourceFiles),
    workspaceRoot,
    entities,
    relations,
  };

  // Build Atlas from already-parsed rawData (no second parse)
  const atlas = await this.buildAtlasFromRawData(workspaceRoot, filteredRawData, {
    functionBodyStrategy,
    includeTests: atlasConfig?.includeTests,
    excludeTests,
    includePatterns: config.includePatterns,
    excludePatterns: config.excludePatterns,
    protocols: atlasConfig?.protocols,
    customFrameworks: atlasConfig?.customFrameworks,
    entryPoints: atlasConfig?.entryPoints,
    followIndirectCalls: atlasConfig?.followIndirectCalls,
  });

  return { ...baseArchJSON, extensions: { goAtlas: atlas } };
}
```

The `buildAtlasFromRawData` private method contains the module resolution, framework detection, and four-layer `Promise.all` currently at lines 185–248 of `atlas/index.ts`, accepting `rawData` directly rather than calling `parseToRawData`.

### 4.3 File Structure Before and After

**Before:**
```
src/plugins/golang/
  index.ts                     ← GoPlugin (public class, ~400 lines)
  archjson-mapper.ts
  dependency-extractor.ts
  gopls-client.ts
  interface-matcher.ts
  source-scope.ts
  tree-sitter-bridge.ts
  types.ts
  atlas/
    index.ts                   ← GoAtlasPlugin (public class, ~264 lines)
    atlas-renderer.ts          (unchanged)
    behavior-analyzer.ts       (unchanged)
    flow-graph-builder.ts      (unchanged)
    framework-detector.ts      (unchanged)
    go-mod-resolver.ts         (unchanged)
    goroutine-topology-builder.ts (unchanged)
    capability-graph-builder.ts (unchanged)
    package-graph-builder.ts   (unchanged)
    renderers/                 (unchanged)
    types.ts                   (unchanged)
```

**After:**
```
src/plugins/golang/
  index.ts                     ← GoPlugin (merged class, ~500 lines)
  archjson-mapper.ts           (unchanged)
  dependency-extractor.ts      (unchanged)
  gopls-client.ts              (unchanged)
  interface-matcher.ts         (unchanged)
  source-scope.ts              (unchanged)
  tree-sitter-bridge.ts        (unchanged)
  types.ts                     (unchanged)
  atlas/
    index.ts                   ← DELETED or reduced to:
                                  export { GoPlugin as GoAtlasPlugin } from '../index.js';
                                  export type { IGoAtlas } from '../index.js';
    (all other atlas/ files unchanged)
```

The `atlas/index.ts` re-export shim is recommended over deletion because `go-atlas-plugin.test.ts` imports from `@/plugins/golang/atlas/index.js` and `arch-json-provider.ts` (line 502) imports `GoAtlasPlugin` from that path. The shim avoids cascading import changes across tests and callers on the first pass; those imports can be updated in a follow-up cleanup.

### 4.4 New Class Signature

The merged file must add the following imports that currently live only in `atlas/index.ts` and are not present in `src/plugins/golang/index.ts`:

- `BehaviorAnalyzer` from `./atlas/behavior-analyzer.js`
- `AtlasRenderer` from `./atlas/renderers/atlas-renderer.js`
- `GoModResolver` from `./atlas/go-mod-resolver.js`
- `FrameworkDetector` from `./atlas/framework-detector.js` — used inline as `new FrameworkDetector().detect(...)` inside `buildAtlasFromRawData`; it does **not** need to be a class field, only an import
- `IGoAtlas`, `AtlasConfig`, `AtlasGenerationOptions`, `AtlasLayer`, `RenderFormat`, `RenderResult`, `GoArchitectureAtlas`, `GO_ATLAS_EXTENSION_VERSION` from `./atlas/types.js`

```typescript
// src/plugins/golang/index.ts

export class GoPlugin implements ILanguagePlugin, IGoAtlas {
  readonly metadata: PluginMetadata = {
    name: 'golang',
    version: '6.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  readonly supportedLevels = ['package', 'capability', 'goroutine', 'flow'] as const;
  readonly dependencyExtractor: IDependencyExtractor;

  // Core (previously GoPlugin private fields)
  private treeSitter!: TreeSitterBridge;
  private matcher!: InterfaceMatcher;
  private mapper!: ArchJsonMapper;
  private goplsClient: GoplsClient | null = null;
  private initialized = false;
  private workspaceRoot = '';

  // Atlas (previously GoAtlasPlugin private fields)
  private behaviorAnalyzer!: BehaviorAnalyzer;
  private atlasRenderer!: AtlasRenderer;
  private goModResolver!: GoModResolver;

  constructor() {
    this.dependencyExtractor = new DependencyExtractor();
  }

  // ILanguagePlugin methods
  async initialize(config: PluginInitConfig): Promise<void> { ... }
  canHandle(targetPath: string): boolean { ... }
  parseCode(code: string, filePath?: string): ArchJSON { ... }
  async parseFiles(filePaths: string[]): Promise<ArchJSON> { ... }
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> { ... } // rewritten
  async dispose(): Promise<void> { ... }

  // IGoAtlas methods
  async generateAtlas(rootPath: string, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas> { ... }
  async renderLayer(atlas: GoArchitectureAtlas, layer: AtlasLayer, format: RenderFormat): Promise<RenderResult> { ... }

  // Public helper (intentionally NOT private — called directly by go-plugin-merge.test.ts and formerly by GoAtlasPlugin)
  async parseToRawData(workspaceRoot: string, config: ParseConfig & TreeSitterParseOptions): Promise<GoRawData> { ... }

  // Private helpers (previously in GoPlugin)
  private async readModuleName(workspaceRoot: string): Promise<string> { ... }
  private ensureInitialized(): void { ... }

  // Private helpers (previously module-level in atlas/index.ts)
  private async buildAtlasFromRawData(rootPath: string, rawData: GoRawData, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas> { ... }
}
```

Note: `parseToRawData` should remain public (not private) because `go-plugin-merge.test.ts` calls it directly on line 117 and line 169 and line 274.

### 4.5 What Happens to the `IGoAtlas` Interface

`IGoAtlas` is currently declared in `src/plugins/golang/atlas/index.ts` (lines 49–56):

```typescript
export interface IGoAtlas {
  generateAtlas(rootPath: string, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas>;
  renderLayer(atlas: GoArchitectureAtlas, layer: AtlasLayer, format: RenderFormat): Promise<RenderResult>;
}
```

After the merge it should be moved to `src/plugins/golang/index.ts` (alongside the merged `GoPlugin`). The `atlas/index.ts` shim re-exports it:

```typescript
// src/plugins/golang/atlas/index.ts (shim)
export { GoPlugin as GoAtlasPlugin } from '../index.js';
export type { IGoAtlas } from '../index.js';
```

No consumers of `IGoAtlas` need to change their import paths if the shim is used.

### 4.6 Removal of `--no-atlas` Flag

Five locations need updating:

1. **`src/cli/commands/analyze.ts` line 127**: Remove `.option('--no-atlas', 'Disable Go Architecture Atlas mode (opt-out for --lang go)')`. Keep the `--atlas` flag and the Atlas-specific options (`--atlas-layers`, `--atlas-strategy`, etc.) unchanged.

2. **`src/cli/analyze/normalize-to-diagrams.ts` line 28**: Remove the `cliOptions.atlas ? 'go' : undefined` ternary used to infer language from the `--atlas` flag. After the merge, language is always inferred from `--lang go`; the atlas flag no longer gates a separate mode.

3. **`src/cli/analyze/normalize-to-diagrams.ts` line 29**: Remove or simplify the `atlasEnabled` condition (`cliOptions.atlas !== false`). After the merge, whenever `language === 'go'` the Atlas diagram is always produced; `atlasEnabled` can simply be `language === 'go'`.

4. **`src/cli/analyze/normalize-to-diagrams.ts` lines 52–62**: Remove the entire `if (language === 'go' && cliOptions.atlas === false)` branch that produced a plain class-level diagram. After the merge, `--lang go` always produces an Atlas diagram.

5. **`src/cli/analyze/normalize-to-diagrams.ts` lines 104–124**: In the `if (cliOptions.lang === 'go' || ...)` block, remove the `enabled: cliOptions.atlas !== false` field (line 115) from the `atlas` config object. After the merge, `enabled` is not used; Go analysis is always Atlas-mode.

6. **`src/types/config.ts`** (wherever `CLIOptions.atlas` is typed): Remove the `atlas?: boolean` field or change its meaning to only express "user requested atlas" (no longer supports `false` as opt-out).

### 4.7 CLI Flag for `--no-atlas` Deprecation

Rather than a hard error, a deprecation warning should be emitted if `--no-atlas` is passed:

```
Warning: --no-atlas is deprecated and has no effect. Go analysis always uses Atlas mode.
```

This is preferable to a hard failure in case users have existing scripts. The flag can still be accepted by commander but ignored.

---

## 5. Test Migration Strategy

### 5.1 `tests/plugins/golang/go-plugin.test.ts` — Requires one metadata assertion update

All tests in `go-plugin.test.ts` import from `'../../../src/plugins/golang/index.js'` and exercise `GoPlugin` directly. After the merge, `GoPlugin` at that path is the merged class, so:

- Tests for `metadata.name`, `metadata.displayName`, `fileExtensions`, `capabilities` will need their assertions updated to match the merged metadata (e.g. `displayName` changes from `'Go (Golang)'` to `'Go Architecture Atlas'`).
- Tests for `parseCode`, `canHandle`, `dependencyExtractor`, `initialization`, `dispose` remain valid without modification.
- The error message string `'GoPlugin not initialized'` (tested on line 187 and 206 of `go-plugin.test.ts`) remains unchanged because `ensureInitialized()` is moved verbatim.

Specifically, line 19 of `go-plugin.test.ts` must be updated:

```typescript
// Before
expect(plugin.metadata.displayName).toBe('Go (Golang)');

// After
expect(plugin.metadata.displayName).toBe('Go Architecture Atlas');
```

### 5.2 `tests/plugins/golang/go-plugin-merge.test.ts` — Stays as-is

All tests in `go-plugin-merge.test.ts` import `GoPlugin` from `'../../../src/plugins/golang/index.js'` and call `parseToRawData` on it. Since `parseToRawData` remains public on the merged class, these tests require no changes at all.

The internal spy `vi.spyOn(bridge, 'parseCode')` (line 53) accesses `(plugin as any).treeSitter`. After the merge, `treeSitter` is still a private field named `treeSitter` on the merged `GoPlugin`, so this spy continues to work.

### 5.3 `tests/plugins/golang/atlas/go-atlas-plugin.test.ts` — Requires updates

The Atlas plugin tests import from `'@/plugins/golang/atlas/index.js'` and use `GoAtlasPlugin`. After adding the re-export shim, the import still resolves. The key spy targets need updating:

**`canHandle` spy (line 53–58):**
```typescript
// Before
const goPlugin = (plugin as any).goPlugin;
const spy = vi.spyOn(goPlugin, 'canHandle').mockReturnValue(true);
expect(spy).toHaveBeenCalledWith('/some/file.go');

// After (spy directly on the merged plugin)
const spy = vi.spyOn(plugin, 'canHandle').mockReturnValue(true);
const result = plugin.canHandle('/some/file.go');
expect(result).toBe(true);
// or remove the delegation test entirely (canHandle is now a direct method)
```

**`initialize` spy (lines 68, 114, 153):**
```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);

// After
vi.spyOn(plugin, 'initialize').mockResolvedValue(undefined);
// Or: mock the filesystem dependencies instead of the method itself
```

**`parseProject` spy (lines 117, 135, 155):**
```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'parseProject').mockResolvedValue(minimalArchJSON);

// After: this spy is no longer meaningful since parseProject is not delegated
// Remove the spy; instead mock parseToRawData on the plugin directly
```

**`parseToRawData` spy (lines 72, 118, 156, 181):**
```typescript
// Before
vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(minimalRawData);

// After
vi.spyOn(plugin as any, 'parseToRawData').mockResolvedValue(minimalRawData);
// parseToRawData is still on the merged plugin (public), so the cast is optional
```

**`goModResolver` spy (lines 75, 119, 157):**
```typescript
// Before
vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);

// After: unchanged — goModResolver is still a private field named goModResolver
vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
```

**`metadata.version` assertion:**
```typescript
// Before (go-atlas-plugin.test.ts, wherever metadata.version is asserted)
expect(plugin.metadata.version).toBe('5.0.0');

// After (merged class bumps version)
expect(plugin.metadata.version).toBe('6.0.0');
```

The test `'atlas enabled=false → standard mode'` (lines 133–145) must be **deleted** since the `atlasConfig.enabled === false` path is removed.

The test `'no atlas config → atlas mode by default'` (lines 122–131) is renamed to `'parseProject always produces extensions.goAtlas'` with the same assertion body.

### 5.4 No New Tests Required

The merge does not add any new behavior. Test coverage for the double-parse fix can be validated by:
- Adding a spy on `parseToRawData` inside the `parseProject` test and asserting it is called exactly once.
- This can be added as a new assertion inside the existing `'no atlas config → atlas mode by default'` test.

---

## 6. Alternatives Considered

### 6.1 Keep GoPlugin as an Internal Class (Not Public)

Instead of deleting `src/plugins/golang/index.ts`, change `GoPlugin` to an internal class (not exported) and move it into `atlas/index.ts` as a private helper class. This preserves the two-file structure but eliminates the public API surface.

**Rejected:** This is essentially the same refactor with a different file layout. Moving private code between files is churn without benefit. The cleaner outcome is a single file.

### 6.2 Keep Both Classes, Fix Only the Double-Parse Bug

Patch `GoAtlasPlugin.parseProject` to call `parseToRawData` once, derive base ArchJSON from the result, and skip the `goPlugin.parseProject` call. Keep `GoPlugin` as a public class.

**Rejected:** This fixes the performance bug but leaves the architectural indirection intact. The two-class structure would remain permanently unexplained to future maintainers.

### 6.3 Rename GoAtlasPlugin Without Touching GoPlugin

Move all `GoPlugin` internals into `GoAtlasPlugin` and rename the result. Delete `src/plugins/golang/index.ts`.

**Rejected:** Callers, tests, and the plugin description text already use the name `GoPlugin`. Keeping the merged class at `src/plugins/golang/index.ts` as `GoPlugin` is the least-churn outcome.

### 6.4 Extract a Shared `GoParserCore` Class

Create a third class — `GoParserCore` — that holds `treeSitter`, `matcher`, `mapper`, and `goplsClient`. Both `GoPlugin` and `GoAtlasPlugin` embed it.

**Rejected:** This addresses only code organisation, not the double-parse or class-count problems. It adds a third class when the goal is to have one.

---

## 7. Open Questions

1. **`parseToRawData` visibility after merge.** Currently declared `public` in `GoPlugin` with the comment "Exposed for GoAtlasPlugin composition (ADR-001 v1.2)". After the merge, the composition reason is gone. Should it be downgraded to `private` or remain `public` (useful for `go-plugin-merge.test.ts` and potentially external tooling)? Recommendation: keep `public` since the test file calls it directly and its semantics are stable.

2. **`supportedLevels` on the merged class.** `GoPlugin` currently declares `['package', 'class', 'method']` while `GoAtlasPlugin` declares `['package', 'capability', 'goroutine', 'flow']`. The merged class should use the Atlas levels. Any downstream code that reads `supportedLevels` to decide diagram level names (e.g. `filterByLevels` in `normalize-to-diagrams.ts` line 173) should be verified to still work correctly with the new level names.

3. **Deprecation window for `--no-atlas`.** A warning-only approach is recommended (§4.6), but if there is no known external user base relying on the flag, a hard removal in the same PR is also acceptable.

4. **`arch-json-provider.ts` import path (line 502).** After the merge, `GoAtlasPlugin` exported from the shim at `atlas/index.ts` is just `GoPlugin` by another name. The `parseGoProject` method in `arch-json-provider.ts` could be simplified to import `GoPlugin` from `'@/plugins/golang/index.js'` directly. This is a follow-up cleanup item, not a blocker.
