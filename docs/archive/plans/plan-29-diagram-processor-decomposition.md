# Plan 29: DiagramProcessor Decomposition

**Source proposal**: `docs/proposals/proposal-diagram-processor-decomposition.md`
**Branch**: `feat/diagram-processor-decomposition`
**Status**: Draft

## Overview

| Item | Detail |
|------|--------|
| Target file | `src/cli/processors/diagram-processor.ts` (958 lines) |
| Problem | God Object: 4 parse paths, 3-layer cache, 4 output routes, lifecycle management all in one class |
| Goal | Extract `ArchJsonProvider` (ArchJSON acquisition) and `DiagramOutputRouter` (file output) |
| Post-refactor | `DiagramProcessor` ≤350 lines, `ArchJsonProvider` ~350 lines, `DiagramOutputRouter` ~230 lines |

## Pre-flight

```bash
npm test                  # verify baseline: all tests pass
npm run type-check        # verify no pre-existing type errors
```

---

## Step 1: Extract `ArchJsonProvider`

### Objectives

Move all ArchJSON acquisition logic (4 parse paths + 3-layer cache) into a dedicated class. `DiagramProcessor` delegates to `provider.get()` instead of running parse logic inline.

### Files Changed

| File | Change |
|------|--------|
| `src/cli/processors/arch-json-provider.ts` | **Create** — new class |
| `src/cli/processors/diagram-processor.ts` | Remove parse/cache logic; add `provider` field; update `processSourceGroup` |

### Implementation Notes

**New class skeleton** (`arch-json-provider.ts`):

```typescript
export interface ArchJsonGetOptions {
  /** true when any diagram in the current source group has level === 'package' */
  needsModuleGraph: boolean;
}

export class ArchJsonProvider {
  constructor(options: ArchJsonProviderOptions) {}
  // ArchJsonProviderOptions: { globalConfig, parseCache?, registry? }
  // fileDiscovery: instantiated internally as new FileDiscoveryService()
  // registry: needed for parseGoProject/parseCppProject/parseTsPlugin (plugin registry lookup)

  async get(
    diagram: DiagramConfig,
    opts: ArchJsonGetOptions,
  ): Promise<{ archJson: ArchJSON; kind: 'parsed' | 'derived' }> { ... }

  public cacheSize(): number { ... }

  private parseGoProject(diagram: DiagramConfig): Promise<ArchJSON> { ... }
  private parseCppProject(diagram: DiagramConfig): Promise<ArchJSON> { ... }
  private parseTsPlugin(diagram: DiagramConfig): Promise<ArchJSON> { ... }    // renamed from parseTsProject
  private parseWithParallelParser(diagram: DiagramConfig, files: string[]): Promise<ArchJSON> { ... }
  private findParentCoverage(sources: string[]): {
    deferred: Promise<ArchJSON> | null;
    normParentPath: string | null;
  } { ... }
  private cacheArchJson(sources: string[], archJson: ArchJSON): void { ... }
  private registerDeferred(sources: string[], p: Promise<ArchJSON>): Promise<ArchJSON> { ... }
}
```

**`get()` routing logic** (4 paths):

```
1. Go   (language === 'go')  → parseGoProject()
2. C++  (language === 'cpp') → parseCppProject() or derive from parent (findParentCoverage)
3. TS, TypeScriptPlugin path (path A):
     if (opts.needsModuleGraph AND (language === undefined OR language === 'typescript'))
       → parseTsPlugin()
4. TS general, ParallelParser path (path B, else):
     a. Check parent coverage via findParentCoverage()
     b. If parent found: await deferred, derive sub-module via deriveSubModuleArchJSON()
     c. If no parent: discover files, check disk cache, run parseWithParallelParser(), write disk cache
```

**Key invariants to preserve**:
- `needsModuleGraph` is computed by the caller (`processSourceGroup`) as `diagrams.some(d => d.level === 'package')`, NOT from `diagram` alone — the provider must not re-derive it
- **Language guard** (mirrors original line 560): inside `get()`, the TypeScript Plugin path (A) is only taken when `opts.needsModuleGraph === true` **AND** `(diagram.language === undefined || diagram.language === 'typescript')`. Java/Python diagrams with `level === 'package'` will have `needsModuleGraph=true` but must fall through to the ParallelParser path (B), not call `parseTsPlugin()`.
- `archJsonCache` (memory cache) stores only fresh-parsed results; derived results are never stored, making the unified memory cache check safe
- `parseWithParallelParser(diagram, files)` receives pre-discovered `files`; disk cache logic stays in `get()` not in this private method
- `files.length === 0` check moves to after parent coverage check (intentional semantic improvement: allows C++ sub-module derivation even when source files are empty in sub-path)
- `FileDiscoveryService` is instantiated inside `ArchJsonProvider`'s constructor (`new FileDiscoveryService()`), not injected via options

**Moved from `diagram-processor.ts`**:
- `archJsonCache: Map<string, ArchJSON>` (line 438)
- `archJsonDeferred: Map<string, { promise: Promise<ArchJSON>; sources: string[] }>` (line 448) — note: NOT `Map<string, Promise<ArchJSON>>`; the value carries `sources` for parent-path lookup in `findParentCoverage()`
- `archJsonPathIndex: Map<string, string>` (line 441)
- `parseGoProject()`, `parseTsProject()` (rename to `parseTsPlugin`), `parseCppProject()` methods
- Inner helper `parseWithParallelParser()` (extract from `processSourceGroup` body)
- `findParentCoverage()`, `cacheArchJson()`, `registerDeferred()` helpers
- `ArchJsonDiskCache` instantiation (constructor, lines 257–259)
- Path A disk cache block (lines 562–590, inside the `needsModuleGraph` branch): file discovery + disk key + disk read + disk write-back after `parseTsPlugin`
- Path B disk cache block (lines 653–676, inside the ParallelParser else branch): disk key + disk read + disk write-back after `parseWithParallelParser`

**Re-export `deriveSubModuleArchJSON`**: move the function from `diagram-processor.ts` into `arch-json-provider.ts` (it is called by `get()` and belongs with the provider). Add a re-export in `diagram-processor.ts` so existing external callers' import paths are unaffected:

```typescript
// diagram-processor.ts (re-export only — function body moves to arch-json-provider.ts)
export { deriveSubModuleArchJSON } from './arch-json-provider.js';
```

**Do NOT** put the re-export in the other direction (`arch-json-provider.ts` importing from `diagram-processor.ts`): that would create a circular dependency since `diagram-processor.ts` imports `ArchJsonProvider`.

**Updated `processSourceGroup` in `DiagramProcessor`**:

```typescript
private async processSourceGroup(
  _sourceKey: string,  // no longer used internally; kept as call-site convention
  diagrams: DiagramConfig[],
  pool: MermaidRenderWorkerPool | null,
): Promise<DiagramResult[]> {
  // NOTE: the original code had a progress.start() call here (lines 491–494) that fires
  // BEFORE parsing starts, for single-diagram runs. That call is intentionally dropped:
  // processDiagramWithArchJSON already calls progress.start() (after parsing). Net effect:
  // for single-diagram runs, the progress indicator appears slightly later (post-parse).
  // Multi-diagram runs are unaffected (they use parallelProgress, not progress.start here).
  try {
    const needsModuleGraph = diagrams.some((d) => d.level === 'package');
    const firstDiagram = diagrams[0];
    const { archJson: rawArchJSON, kind } = await this.provider.get(firstDiagram, { needsModuleGraph });
    this.registerQueryScope(firstDiagram.sources, rawArchJSON, kind);
    return await pMap(
      diagrams,
      (diagram) => this.processDiagramWithArchJSON(diagram, rawArchJSON, pool),
      { concurrency: this.globalConfig.concurrency ?? os.cpus().length },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return diagrams.map((diagram) => ({ name: diagram.name, success: false, error: errorMessage }));
  }
}
```

### Verify

```bash
npm run type-check
npm test
# Spot-check: all existing processSourceGroup / parseTsPlugin / parseGoProject tests pass
```

---

## Step 2: Extract `DiagramOutputRouter`

### Objectives

Move all file-output generation methods (4 `generate*Output` methods) into a dedicated class. Eliminate 3× copy-pasted renderer-options construction via a shared `buildRendererOptions()` helper.

### Files Changed

| File | Change |
|------|--------|
| `src/cli/processors/diagram-output-router.ts` | **Create** — new class |
| `src/cli/processors/diagram-processor.ts` | Remove `generate*Output` methods; add `router` field; update `processDiagramWithArchJSON` |

### Implementation Notes

**New class skeleton** (`diagram-output-router.ts`):

```typescript
export type OutputPaths = {
  paths: {
    json: string;
    mmd: string;
    png: string;
    svg: string;
  };
};

export class DiagramOutputRouter {
  constructor(
    private readonly globalConfig: GlobalConfig,
    private readonly progress: ProgressReporter,  // needed for MermaidDiagramGenerator(globalConfig, progress)
  ) {}
  // IsomorphicMermaidRenderer is instantiated per-call via buildRendererOptions()
  // MermaidDiagramGenerator is instantiated per-call: new MermaidDiagramGenerator(globalConfig, progress)

  async route(
    archJSON: ArchJSON,
    pathsResult: OutputPaths,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null,
  ): Promise<void> { ... }

  private buildRendererOptions(): Record<string, unknown> { ... }
}
```

**`route()` dispatch logic**:

```
format = diagram.format ?? globalConfig.format
level  = diagram.level   // used in mermaid routing below

// Step 1: format branch
if format === 'json':
  fs.writeJson(paths.paths.json, archJSON)
  return

// Step 2: mermaid routing — based on ArchJSON extensions and archJSON.language, NOT diagram.language
// (mirrors exact if/else chain in current generateOutput(), lines 921–943)
if archJSON.extensions?.goAtlas:
  → generateAtlasOutput(archJSON, paths, diagram, pool)
else if level === 'package' AND archJSON.extensions?.tsAnalysis?.moduleGraph:
  → generateTsModuleGraphOutput(archJSON, paths, diagram, pool)
else if level === 'package' AND archJSON.language === 'cpp':
  → generateCppPackageOutput(archJSON, paths, pool)
else:
  → generateDefaultOutput(archJSON, paths, level, diagram, pool)
     // renamed from generateOutput() to avoid confusion with the public entry point
```

**`buildRendererOptions()` helper**: consolidates the renderer-options object currently duplicated in `generateAtlasOutput`, `generateTsModuleGraphOutput`, and `generateCppPackageOutput`. Theme must be wrapped as `{ name: string }` when it is a string — `IsomorphicMermaidRenderer` does not accept a bare string:

```typescript
private buildRendererOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (this.globalConfig.mermaid?.theme) {
    options.theme =
      typeof this.globalConfig.mermaid.theme === 'string'
        ? { name: this.globalConfig.mermaid.theme }  // wrap: renderer expects object
        : this.globalConfig.mermaid.theme;
  }
  if (this.globalConfig.mermaid?.transparentBackground) {
    options.backgroundColor = 'transparent';
  }
  return options;
}
```

**Moved from `diagram-processor.ts`**:
- `generateAtlasOutput()`, `generateTsModuleGraphOutput()`, `generateCppPackageOutput()` — moved as-is
- `generateOutput()` — moved and **renamed** to `generateDefaultOutput()` to avoid confusion with the public `route()` entry point (both previously had the name `generateOutput` at different call levels)
- The `buildRendererOptions()` equivalent (inline → extracted helper; see corrected implementation above)

**ArchJSON extensions preservation check**: `generateAtlasOutput` and `generateCppPackageOutput` rely on `ArchJSON.extensions` fields (Atlas layers, C++ metadata). Confirm that `ArchJSONAggregator` (called inside generate methods) copies these fields through. If not, add explicit field forwarding before closing Step 2.

**Updated `processDiagramWithArchJSON` in `DiagramProcessor`**:

```typescript
private async processDiagramWithArchJSON(
  diagram: DiagramConfig,
  rawArchJSON: ArchJSON,
  pool: MermaidRenderWorkerPool | null,
): Promise<DiagramResult> {
  // ... existing aggregation, metrics, path computation ...
  await this.router.route(aggregatedArchJSON, { paths }, diagram, pool);
  return { name: diagram.name, success: true, stats, paths };
}
```

`processDiagramWithArchJSON` stays in `DiagramProcessor`: it owns ArchJSON aggregation, stats/metrics calculation, `DiagramResult` construction, and progress reporting — responsibilities that belong with the coordinator, not the router.

### Verify

```bash
npm run type-check
npm test
# Spot-check: generateDefaultOutput / generateAtlasOutput / generateTsModuleGraphOutput tests pass
# Manual smoke test:
npm run build
node dist/cli/index.js analyze -v                          # TypeScript (package+class+method)
node dist/cli/index.js analyze --diagrams package          # package only
node dist/cli/index.js analyze -s /path/to/go/project --lang go  # Atlas
```

---

## Step 3: Cleanup and Tests

### Objectives

Remove any leftover dead code from `DiagramProcessor`. Add focused unit tests for the two new classes.

### Files Changed

| File | Change |
|------|--------|
| `src/cli/processors/diagram-processor.ts` | Remove empty/unused fields; verify ≤350 lines |
| `tests/unit/cli/processors/arch-json-provider.test.ts` | **Create** |
| `tests/unit/cli/processors/diagram-output-router.test.ts` | **Create** |

### Implementation Notes

**Dead code to remove from `DiagramProcessor`**:
- Any leftover private fields moved to provider/router (`archJsonCache`, `archJsonPathIndex`, `archJsonDeferred`, `diskCache`)
- Unused imports

**`arch-json-provider.test.ts` coverage targets**:
- `get()` routes to correct parse path for each language
- Memory cache hit returns cached value on second call
- `findParentCoverage()` returns parent when sub-path matches
- Path B only: `files.length === 0` with no parent coverage throws (not path A — path A uses TypeScript Plugin, no file discovery)
- Path A disk cache hit: `parseTsPlugin` not called; `cacheSize()` does NOT increment (path A intentionally skips `cacheArchJson`, mirroring original line 582)
- Path B disk cache hit: `parseWithParallelParser` not called; `cacheSize()` increments (path B calls `cacheArchJson` after disk read)
- `needsModuleGraph: false` takes ParallelParser path (not TypeScriptPlugin)
- `needsModuleGraph: true` + `language === 'typescript'` takes TypeScriptPlugin path (path A)
- `needsModuleGraph: true` + `language === 'java'` takes ParallelParser path, NOT TypeScriptPlugin (language guard: path A requires `language === 'typescript' || language === undefined`)

**`diagram-output-router.test.ts` coverage targets**:
- `route()` dispatches to correct generate method per language/level
- `buildRendererOptions()` returns correct theme/background from globalConfig
- Atlas: `generateAtlasOutput` invoked when `archJSON.extensions.goAtlas` is present (regardless of `diagram.language`)
- TS module graph: `generateTsModuleGraphOutput` invoked when `archJSON.extensions.tsAnalysis.moduleGraph` present AND `level === 'package'`
- C++ package: `generateCppPackageOutput` invoked when `archJSON.language === 'cpp'` AND `level === 'package'` (note: `archJSON.language`, not `diagram.language`)
- Default: `generateDefaultOutput` invoked for all other combinations
- JSON format: file written, no mermaid renderer called

### Verify

```bash
npm test
npm run type-check
npm run lint

# Final size check:
wc -l src/cli/processors/diagram-processor.ts     # expect ≤350
wc -l src/cli/processors/arch-json-provider.ts    # expect ~350
wc -l src/cli/processors/diagram-output-router.ts # expect ~230

# Final integration:
npm run build
node dist/cli/index.js analyze -v
```

---

## Acceptance Criteria

- [ ] `DiagramProcessor` ≤350 lines
- [ ] `ArchJsonProvider` created; all 4 parse paths present; 3-layer cache intact; language guard preserved (`parseTsPlugin` only called when `needsModuleGraph && (language === 'typescript' || language === undefined)`)
- [ ] `DiagramOutputRouter` created; `generateAtlasOutput`, `generateTsModuleGraphOutput`, `generateCppPackageOutput`, `generateDefaultOutput` present; `buildRendererOptions()` extracted with correct theme wrapping (`string → { name }`)
- [ ] `route()` handles `format === 'json'` before entering mermaid dispatch; mermaid routing uses `archJSON.extensions` / `archJSON.language`, not `diagram.language`
- [ ] `deriveSubModuleArchJSON` remains accessible to existing callers (re-exported or unchanged location)
- [ ] `processDiagramWithArchJSON` stays in `DiagramProcessor`
- [ ] External interface unchanged: `processor.processAll()` and `processor.getQuerySourceGroups()` signatures identical
- [ ] `npm test` passes (all 2165+ tests)
- [ ] `npm run type-check` clean
- [ ] Self-validate: `node dist/cli/index.js analyze -v` produces same diagrams as before
