# Plan 23: Rendering Performance Optimization — Development Plan

> Source proposal: `docs/proposals/proposal-rendering-performance-optimization.md`
> Branch: `feat/rendering-perf`
> Status: Draft

---

## Overview

Three delivery phases ordered by risk and independence:

| Phase | Layer | Primary concern | Dependency |
|-------|-------|-----------------|------------|
| Phase A | L1 — Eliminate double render + parallelise I/O | Internal refactor, no interface changes | None |
| Phase B | L4 — Sub-module ArchJSON derivation | Deferred-promise scheduling + cache reverse index | None (independent of A) |
| Phase C | L2+L3 — Worker Thread render pool + pipeline | Feasibility spike required first | A must land first |

**Recommended order**: A → B → C. Each phase passes `npm test` independently before the next begins.
Phase B may be developed in parallel with A on a separate branch.

---

## Pre-flight

```bash
# Confirm baseline
npm test
# Note current passing count (expected: 1942+)

# Re-establish wall-time baseline (run after confirming 5/5 diagrams succeed)
time node dist/cli/index.js analyze -s /home/yale/work/web-llm/src \
  --output-dir /home/yale/work/web-llm/.archguard -v
# Record: total wall time, per-diagram times from log output
```

---

## Phase A — Eliminate Double Render + Parallelise I/O (Layer 1)

### Objectives

1. Extract `convertSVGToPNG(svg, path)` in `renderer.ts` to separate conversion from re-render.
2. Refactor `renderAndSave()` to a two-stage `Promise.all` pipeline (one `mermaid.render()` call per diagram).
3. Update `renderPNG()` to delegate to `renderSVG()` + `convertSVGToPNG()` (preserve public signature).
4. Fix Sites B and C in `diagram-processor.ts` (`generateTsModuleGraphOutput`, `generateAtlasOutput`) which bypass `renderAndSave()` and contain their own double-render.

### Why Sites B and C are out of scope for `renderer.ts` alone

`generateTsModuleGraphOutput()` and `generateAtlasOutput()` both call:
```typescript
const svg = await mermaidRenderer.renderSVG(content);   // render #1
await fs.writeFile(paths.svg, svg, 'utf-8');
await mermaidRenderer.renderPNG(content, paths.png);    // render #2  ← bug
```
They never call `renderAndSave()`; refactoring only `renderAndSave()` leaves these sites unfixed.

### Files changed

| File | Change |
|------|--------|
| `src/mermaid/renderer.ts` | Add `convertSVGToPNG`; refactor `renderAndSave` and `renderPNG` |
| `src/cli/processors/diagram-processor.ts` | Fix Sites B and C |
| `tests/unit/mermaid/renderer.test.ts` | Add render-count spy tests |

---

### Stage A-1 — Verify baseline

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "pass|fail|Tests"
# Record exact test count
```

---

### Stage A-2 — Write failing tests (TDD red)

**Important Vitest constraints before writing tests:**

- `vi.mock()` is **hoisted to the module top** by Vitest's transform. It must be declared at file top level, never inside `describe`/`it` blocks.
- `vi` must be added to the existing import: `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';`
- The `renderPNG` single-call count test is **not valid for TDD red**: `renderPNG` currently calls `renderSVG` exactly once, so that assertion already passes today. It can only serve as a non-regression test after the refactor.

Add at the **top of `tests/unit/mermaid/renderer.test.ts`**, before the existing `describe` block:

```typescript
// Top-level mock — must be at file scope (Vitest hoists vi.mock)
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    flatten: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  })),
}));
```

Update the import line:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

Add a new `describe` block at the end of the file. The **only test that must fail before Stage A-3** is the `renderAndSave` call-count test (currently triggers 2 renders):

```typescript
describe('IsomorphicMermaidRenderer – render call count', () => {
  let renderSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // isomorphic-mermaid exports a process-level singleton; spying on its
    // render method intercepts the call in both the test and renderer.ts
    // because they share the same module instance.
    renderSpy = vi.spyOn(
      (await import('isomorphic-mermaid')).default,
      'render'
    ).mockResolvedValue({ svg: '<svg viewBox="0 0 100 100"/>' } as any);
  });

  afterEach(() => {
    renderSpy.mockRestore();
  });

  it('renderAndSave calls mermaid.render exactly once (not twice)', async () => {
    // Currently FAILS: renderAndSave calls renderSVG, then renderPNG which
    // calls renderSVG again → 2 mermaid.render() calls.
    const renderer = new IsomorphicMermaidRenderer();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renderer-spy-'));
    try {
      const paths = {
        mmd: path.join(tmpDir, 'out.mmd'),
        svg: path.join(tmpDir, 'out.svg'),
        png: path.join(tmpDir, 'out.png'),
      };
      await renderer.renderAndSave('flowchart LR\n  A --> B', paths);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.remove(tmpDir);
    }
  });

  it('renderPNG calls mermaid.render exactly once (non-regression)', async () => {
    // Currently PASSES — kept as a non-regression guard after refactor.
    // Do NOT use this test to drive TDD red/green; it is green from the start.
    const renderer = new IsomorphicMermaidRenderer();
    const tmpFile = path.join(os.tmpdir(), `renderer-spy-${Date.now()}.png`);
    try {
      await renderer.renderPNG('flowchart LR\n  A --> B', tmpFile);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.remove(tmpFile).catch(() => {});
    }
  });
});
```

> The `sharp` top-level mock applies to all tests in the file. Verify that the existing PNG tests still pass after adding the mock (they use the real `sharp` via integration; the mock may need to be scoped with `vi.unmock` in those existing `describe` blocks if conflicts arise).

Run — confirm only the `renderAndSave` call-count test fails:
```bash
npm test -- --testPathPattern=renderer.test
```

---

### Stage A-3 — Add `convertSVGToPNG` and refactor `renderer.ts`

**Step 1**: Extract `convertSVGToPNG` from the body of `renderPNG`. The method is placed immediately after `renderPNG`. It has no `try/catch` of its own — callers wrap it:

```typescript
/**
 * Convert an already-rendered SVG string to a PNG file.
 * Does NOT call renderSVG; the caller must supply the svg string.
 * Throws on failure; caller is responsible for error wrapping.
 */
async convertSVGToPNG(svg: string, outputPath: string): Promise<void> {
  const svgBuffer = Buffer.from(svg);

  await fs.ensureDir(path.dirname(outputPath));

  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  let density = 300;
  let resizeWidth: number | undefined;
  let resizeHeight: number | undefined;
  const maxPixels = 32767;

  if (viewBoxMatch) {
    const [, , vbWidth, vbHeight] = viewBoxMatch[1].split(/\s+/).map(Number);
    const svgWidth = vbWidth || 0;
    const svgHeight = vbHeight || 0;
    const estimatedWidth = svgWidth * (300 / 72);
    const estimatedHeight = svgHeight * (300 / 72);

    if (svgWidth > maxPixels || svgHeight > maxPixels) {
      const scale = Math.min(maxPixels / svgWidth, maxPixels / svgHeight);
      resizeWidth = Math.floor(svgWidth * scale);
      resizeHeight = Math.floor(svgHeight * scale);
      density = 72;
    } else if (estimatedWidth > maxPixels || estimatedHeight > maxPixels) {
      const maxDimension = Math.max(svgWidth, svgHeight);
      density = Math.floor(((maxPixels * 0.9) / maxDimension) * 72);
      density = Math.max(72, Math.min(300, density));
    }
  }

  let pipeline = sharp(svgBuffer, { density, limitInputPixels: false });
  const capWidth = resizeWidth ?? maxPixels;
  const capHeight = resizeHeight ?? maxPixels;
  pipeline = pipeline.resize(capWidth, capHeight, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (this.options.backgroundColor !== 'transparent') {
    pipeline.flatten({
      background: this.parseBackgroundColor(this.options.backgroundColor),
    });
  }

  await pipeline.png().toFile(outputPath);
}
```

**Step 2**: Replace `renderPNG` body to delegate:

```typescript
// Before:
async renderPNG(mermaidCode: string, outputPath: string): Promise<void> {
  try {
    const svg = await this.renderSVG(mermaidCode);  // ← also called from renderAndSave
    const svgBuffer = Buffer.from(svg);
    await fs.ensureDir(path.dirname(outputPath));
    // ... viewBox/DPI/sharp logic ...
    await pipeline.png().toFile(outputPath);
  } catch (error) {
    throw new Error(`Failed to render PNG to ${outputPath}: ...`);
  }
}

// After:
async renderPNG(mermaidCode: string, outputPath: string): Promise<void> {
  try {
    const svg = await this.renderSVG(mermaidCode);
    await this.convertSVGToPNG(svg, outputPath);
  } catch (error) {
    throw new Error(
      `Failed to render PNG to ${outputPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
```

**Step 3**: Replace `renderAndSave` with two-stage `Promise.all`:

```typescript
// Before:
async renderAndSave(mermaidCode: string, paths: MermaidOutputPaths): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(paths.mmd));
    await fs.ensureDir(path.dirname(paths.svg));
    await fs.ensureDir(path.dirname(paths.png));

    await fs.writeFile(paths.mmd, mermaidCode, 'utf-8');
    const svg = await this.renderSVG(mermaidCode);
    await fs.writeFile(paths.svg, svg, 'utf-8');
    await this.renderPNG(mermaidCode, paths.png);       // ← calls renderSVG again
  } catch (error) {
    throw new Error(`Failed to render and save: ...`);
  }
}

// After:
async renderAndSave(mermaidCode: string, paths: MermaidOutputPaths): Promise<void> {
  try {
    await Promise.all([
      fs.ensureDir(path.dirname(paths.mmd)),
      fs.ensureDir(path.dirname(paths.svg)),
      fs.ensureDir(path.dirname(paths.png)),
    ]);

    // Stage 1: write .mmd and render SVG concurrently (independent)
    const [svg] = await Promise.all([
      this.renderSVG(mermaidCode),              // single mermaid.render() call
      fs.writeFile(paths.mmd, mermaidCode, 'utf-8'),
    ]);

    // Stage 2: write .svg and convert to PNG concurrently
    // (convertSVGToPNG calls ensureDir internally but PNG dir is already ensured above)
    await Promise.all([
      fs.writeFile(paths.svg, svg, 'utf-8'),
      this.convertSVGToPNG(svg, paths.png),
    ]);
  } catch (error) {
    throw new Error(
      `Failed to render and save: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
```

---

### Stage A-4 — Fix Sites B and C in `diagram-processor.ts`

Both sites are fixed with the same pattern: parallelize `writeFile(.svg)` and `convertSVGToPNG` in `Promise.all`, matching the approach in `renderAndSave`.

**Site B** — `generateTsModuleGraphOutput()` (lines ~657–665):

```typescript
// Before:
const svg = await mermaidRenderer.renderSVG(mmdContent);
await fs.writeFile(paths.paths.svg, svg, 'utf-8');
try {
  await mermaidRenderer.renderPNG(mmdContent, paths.paths.png);  // ← re-renders
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`  TS module graph PNG skipped (${msg}) — MMD + SVG saved`);
}

// After:
const svg = await mermaidRenderer.renderSVG(mmdContent);
await Promise.all([
  fs.writeFile(paths.paths.svg, svg, 'utf-8'),
  mermaidRenderer.convertSVGToPNG(svg, paths.paths.png).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  TS module graph PNG skipped (${msg}) — MMD + SVG saved`);
  }),
]);
```

**Site C** — `generateAtlasOutput()`, inside the `for (const layer of availableLayers)` loop (lines ~598–608):

```typescript
// Before:
const svg = await mermaidRenderer.renderSVG(result.content);
await fs.writeFile(layerPaths.svg, svg, 'utf-8');
try {
  await mermaidRenderer.renderPNG(result.content, layerPaths.png);  // ← re-renders
  console.log(`  ✅ ${layer}: ${layerPaths.mmd}`);
} catch (err) { ... }

// After:
const svg = await mermaidRenderer.renderSVG(result.content);
let pngFailed = false;
await Promise.all([
  fs.writeFile(layerPaths.svg, svg, 'utf-8'),
  mermaidRenderer.convertSVGToPNG(svg, layerPaths.png).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠️  ${layer} PNG skipped (${msg}) — MMD + SVG saved`);
    pngFailed = true;
  }),
]);
console.log(`  ✅ ${layer}: ${layerPaths.mmd}${pngFailed ? ' (no PNG)' : ''}`);
```

---

### Stage A-5 — Run tests (TDD green)

```bash
npm test -- --testPathPattern=renderer.test
# renderAndSave call-count test: now passes
# renderPNG non-regression test: still passes (was green before)
# All prior renderer tests: still pass

npm test
# Full suite must remain green (1942+ tests)
```

If existing PNG integration tests conflict with the top-level `sharp` mock, scope the mock with `vi.doMock` + `vi.importActual` in those specific `describe` blocks, or move the spy tests to a dedicated file.

---

### Stage A-6 — Integration validation

```bash
npm run build
time node dist/cli/index.js analyze -s /home/yale/work/web-llm/src \
  --output-dir /home/yale/work/web-llm/.archguard -v
# Record wall time and compare to pre-flight baseline
# Verify all 5 diagrams succeed: check .archguard/index.md
```

### Acceptance criteria — Phase A

- [ ] `convertSVGToPNG(svg, path)` exists as a public method on `IsomorphicMermaidRenderer`
- [ ] `renderAndSave()` calls `mermaid.render` (via `renderSVG`) exactly once — spy test confirms
- [ ] `renderPNG()` delegates to `renderSVG()` + `convertSVGToPNG()` (no duplicated viewBox/sharp logic)
- [ ] Site B (`generateTsModuleGraphOutput`) uses `convertSVGToPNG(svg, ...)` + `Promise.all`
- [ ] Site C (`generateAtlasOutput`) uses `convertSVGToPNG(svg, ...)` + `Promise.all`
- [ ] `npm test` full suite green, count does not decrease
- [ ] Integration: all 5 web-llm diagrams succeed; wall time recorded (used as Phase C comparison baseline)

---

## Phase B — Sub-module ArchJSON Derivation (Layer 4)

### Objectives

Eliminate redundant `ParallelParser` invocations for sub-module source groups whose files are fully covered by an already-parsed parent ArchJSON.

### Architecture constraint 1: cache reverse index required

`archJsonCache` is keyed by `hashSources()` (SHA-256 of sorted, normalised source paths). A parallel path-to-key index is needed for parent-path lookup:

```typescript
private archJsonPathIndex = new Map<string, string>(); // normalizedSourcePath → cacheKey
```

### Architecture constraint 2: concurrent scheduling — parent must complete before child lookup

`processAll()` dispatches all source groups concurrently via `pMap`. For web-llm:
- Group A (`src/`) → `parseTsProject` (~90s)
- Group B (`src/openai_api_protocols/`) → default path (~15s)
- Group C (`src/shared/`) → default path (~10s)

Groups B and C finish **before** Group A completes. `findParentArchJson()` at Group B/C entry will find an empty `archJsonPathIndex` and fall through to ParallelParser — the optimisation **does not fire**.

The fix requires Groups B/C to `await` Group A's result before checking for a parent. This is implemented with a deferred-promise map keyed by the source hash of the candidate parent:

```typescript
/** Shared across all concurrent processSourceGroup calls */
private archJsonDeferred = new Map<string, Promise<ArchJSON>>();
```

When Group A starts parsing, it registers a deferred promise. Groups B/C detect that Group A is a potential parent and `await` its deferred promise before proceeding.

### Files changed

| File | Change |
|------|--------|
| `src/cli/processors/diagram-processor.ts` | Add `archJsonPathIndex`, `archJsonDeferred`; add `cacheArchJson`, `registerDeferred`, `findParentArchJson`; update all cache write sites; update `processSourceGroup` |
| `tests/unit/cli/processors/diagram-processor.test.ts` | Add derivation and scheduling tests |

---

### Stage B-1 — Write failing tests (TDD red)

Add a new `describe` block in `tests/unit/cli/processors/diagram-processor.test.ts`:

```typescript
describe('Sub-module ArchJSON derivation', () => {
  it('deriveSubModuleArchJSON filters entities by filePath prefix', () => {
    const parent: ArchJSON = {
      version: '1.0', language: 'typescript', timestamp: '', sourceFiles: [],
      entities: [
        { id: 'e1', name: 'A', type: 'class', filePath: '/src/core/a.ts' },
        { id: 'e2', name: 'B', type: 'class', filePath: '/src/shared/b.ts' },
        { id: 'e3', name: 'C', type: 'class', filePath: '/src/core/c.ts' },
      ],
      relations: [
        { source: 'e1', target: 'e2', type: 'dependency' },
        { source: 'e1', target: 'e3', type: 'dependency' },
        { source: 'e2', target: 'e3', type: 'dependency' },
      ],
    };
    const result = deriveSubModuleArchJSON(parent, '/src/core');
    expect(result.entities.map(e => e.id)).toEqual(['e1', 'e3']);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({ source: 'e1', target: 'e3' });
  });

  it('deriveSubModuleArchJSON filters moduleGraph nodes and edges by path prefix', () => {
    const parent: ArchJSON = {
      version: '1.0', language: 'typescript', timestamp: '', sourceFiles: [],
      entities: [],
      relations: [],
      extensions: {
        tsAnalysis: {
          version: '1.0',
          moduleGraph: {
            nodes: [
              { id: 'src/core', name: 'core', type: 'internal', fileCount: 2, stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 } },
              { id: 'src/shared', name: 'shared', type: 'internal', fileCount: 1, stats: { classes: 0, interfaces: 0, functions: 1, enums: 0 } },
            ],
            edges: [{ from: 'src/core', to: 'src/shared', strength: 1, importedNames: [] }],
            cycles: [],
          },
        },
      },
    };
    const result = deriveSubModuleArchJSON(parent, '/src/core');
    const mg = result.extensions?.tsAnalysis?.moduleGraph;
    expect(mg?.nodes).toHaveLength(1);
    expect(mg?.nodes[0].id).toBe('src/core');
    expect(mg?.edges).toHaveLength(0); // edge to 'src/shared' dropped
  });

  it('deriveSubModuleArchJSON preserves non-tsAnalysis extension fields', () => {
    const parent: ArchJSON = {
      version: '1.0', language: 'typescript', timestamp: '', sourceFiles: [],
      entities: [],
      relations: [],
      extensions: {
        tsAnalysis: { version: '1.0', moduleGraph: { nodes: [], edges: [], cycles: [] } },
      },
    };
    const result = deriveSubModuleArchJSON(parent, '/src');
    expect(result.version).toBe('1.0');
    expect(result.extensions?.tsAnalysis).toBeDefined();
  });

  it('deriveSubModuleArchJSON returns empty entities/relations when no match', () => {
    const parent: ArchJSON = {
      version: '1.0', language: 'typescript', timestamp: '', sourceFiles: [],
      entities: [{ id: 'e1', name: 'A', type: 'class', filePath: '/src/core/a.ts' }],
      relations: [],
    };
    const result = deriveSubModuleArchJSON(parent, '/src/other');
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });
});
```

> The fourth test ("processSourceGroup uses derived ArchJSON...") is not included here as a TDD-red driver because it requires full `DiagramProcessor` instantiation with mocked parsing. Write it as an integration test under `tests/integration/` with appropriate skip guards; it should not be used to gate Phase B's red/green cycle.

Run — confirm tests fail (function `deriveSubModuleArchJSON` does not exist yet):
```bash
npm test -- --testPathPattern=diagram-processor.test
```

---

### Stage B-2 — Add fields, helpers, and `cacheArchJson`

In `src/cli/processors/diagram-processor.ts`:

**Step 1**: Add the two new fields alongside `archJsonCache`:

```typescript
private archJsonCache = new Map<string, ArchJSON>();

/** Reverse index: normalised source path → cache key, for parent-path lookup */
private archJsonPathIndex = new Map<string, string>();

/**
 * Deferred promises for in-progress parses.
 * Groups that detect a potential parent await this promise before checking the index,
 * ensuring the parent's archJsonPathIndex entry exists before the lookup runs.
 */
private archJsonDeferred = new Map<string, Promise<ArchJSON>>();
```

**Step 2**: Add `cacheArchJson` helper (atomic write to cache + index):

```typescript
private cacheArchJson(sources: string[], archJson: ArchJSON): void {
  const key = this.hashSources(sources);
  this.archJsonCache.set(key, archJson);
  for (const s of sources) {
    this.archJsonPathIndex.set(s.replace(/\\/g, '/'), key);
  }
}
```

**Step 3**: Add `registerDeferred` — registers a Promise for an in-progress parse and resolves it on completion:

```typescript
private registerDeferred(
  sources: string[],
  parsePromise: Promise<ArchJSON>
): Promise<ArchJSON> {
  const key = this.hashSources(sources);
  const withCaching = parsePromise.then((result) => {
    this.cacheArchJson(sources, result);
    this.archJsonDeferred.delete(key);
    return result;
  });
  this.archJsonDeferred.set(key, withCaching);
  return withCaching;
}
```

**Step 4**: Replace the 3 direct `archJsonCache.set()` calls with `registerDeferred` / `cacheArchJson`:

```typescript
// Go path (line ~237–238): wrap parseGoProject in registerDeferred
const rawArchJSON = await this.registerDeferred(
  firstDiagram.sources,
  this.parseGoProject(firstDiagram)
);

// TS path (line ~252–253): wrap parseTsProject in registerDeferred
const rawArchJSON = await this.registerDeferred(
  firstDiagram.sources,
  this.parseTsProject(firstDiagram)
);

// Default ParallelParser path (line ~287–290): use cacheArchJson after parsing
rawArchJSON = await parser.parseFiles(files);
this.cacheArchJson(diagrams[0].sources, rawArchJSON);
```

---

### Stage B-3 — Add `deriveSubModuleArchJSON` utility

Add as a module-level exported function (enables direct unit testing):

```typescript
/**
 * Derive a sub-module ArchJSON from a parent by filtering to entities
 * whose filePath starts with subPath. Only relations where both endpoints
 * are in the sub-module are retained.
 *
 * Also filters extensions.tsAnalysis.moduleGraph: nodes whose id starts
 * with the relative subPath prefix, edges where both endpoints are retained.
 */
export function deriveSubModuleArchJSON(parent: ArchJSON, subPath: string): ArchJSON {
  const normSub = subPath.replace(/\\/g, '/').replace(/\/$/, '');

  // Filter entities
  const entities = parent.entities.filter((e) => {
    const fp = e.filePath?.replace(/\\/g, '/') ?? '';
    return fp.startsWith(normSub + '/') || fp === normSub;
  });
  const ids = new Set(entities.map((e) => e.id));

  // Filter relations
  const relations = (parent.relations ?? []).filter(
    (r) => ids.has(r.source) && ids.has(r.target)
  );

  // Filter moduleGraph if present
  let extensions = parent.extensions;
  const mg = parent.extensions?.tsAnalysis?.moduleGraph;
  if (mg) {
    // TsModuleNode.id is a relative module path (e.g. "src/core");
    // derive the relative prefix from normSub by stripping any leading abs path segment.
    // Since moduleGraph node IDs are relative, convert normSub to a relative prefix.
    // Strategy: find the shortest suffix of normSub that matches a node ID prefix.
    const relPrefix = normSub.includes('/')
      ? normSub.split('/').slice(-2).join('/') // heuristic: last 2 segments
      : normSub;

    const filteredNodes = mg.nodes.filter(
      (n) => n.id === relPrefix || n.id.startsWith(relPrefix + '/')
    );
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = mg.edges.filter(
      (e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to)
    );
    const filteredCycles = mg.cycles.filter(
      (c) => c.modules.every((m) => filteredNodeIds.has(m))
    );
    extensions = {
      ...parent.extensions,
      tsAnalysis: {
        ...parent.extensions!.tsAnalysis!,
        moduleGraph: {
          nodes: filteredNodes,
          edges: filteredEdges,
          cycles: filteredCycles,
        },
      },
    };
  }

  return { ...parent, entities, relations, extensions };
}
```

> **Note on the `relPrefix` heuristic**: the mapping between absolute `subPath` (e.g. `/home/yale/work/web-llm/src/openai_api_protocols`) and module graph node IDs (e.g. `src/openai_api_protocols`) depends on the project. A more robust approach is to pass the `workspaceRoot` alongside `subPath` and strip it as a prefix. This can be a follow-up refinement; the two-segment heuristic works for the standard `src/*` layout.

---

### Stage B-4 — Add `findParentArchJson` and update `processSourceGroup`

**Step 1**: Add the lookup helper:

```typescript
/**
 * Check whether a pending or completed parent parse covers all given sources.
 * Returns { archJson, deferred } where deferred is non-null if the parent
 * is still in progress and the caller must await it before using archJson.
 */
private findParentCoverage(sources: string[]): {
  deferred: Promise<ArchJSON> | null;
  normParentPath: string | null;
} {
  const normSources = sources.map((s) => s.replace(/\\/g, '/'));

  // Check already-completed entries in the path index
  for (const [indexedPath] of this.archJsonPathIndex) {
    if (normSources.every((s) => s.startsWith(indexedPath + '/') || s === indexedPath)) {
      return { deferred: null, normParentPath: indexedPath };
    }
  }

  // Check in-progress deferred parses
  for (const [deferredKey, promise] of this.archJsonDeferred) {
    // Reconstruct the normalised source path from the cache key is not possible
    // directly; instead, store alongside the deferred a normalised path set.
    // Implementation: augment archJsonDeferred to Map<string, { promise, sources }>
    // (see Step 2 below for the updated field type).
    void deferredKey; void promise; // placeholder
  }

  return { deferred: null, normParentPath: null };
}
```

> Because the deferred map needs source paths for the parent-path check, change `archJsonDeferred` to store `{ promise, sources }`:

```typescript
private archJsonDeferred = new Map<
  string,
  { promise: Promise<ArchJSON>; sources: string[] }
>();
```

Update `registerDeferred` accordingly:

```typescript
private registerDeferred(
  sources: string[],
  parsePromise: Promise<ArchJSON>
): Promise<ArchJSON> {
  const key = this.hashSources(sources);
  const withCaching = parsePromise.then((result) => {
    this.cacheArchJson(sources, result);
    this.archJsonDeferred.delete(key);
    return result;
  });
  this.archJsonDeferred.set(key, { promise: withCaching, sources });
  return withCaching;
}
```

Update `findParentCoverage` to check in-progress deferred entries:

```typescript
private findParentCoverage(sources: string[]): {
  deferred: Promise<ArchJSON> | null;
  normParentPath: string | null;
} {
  const normSources = sources.map((s) => s.replace(/\\/g, '/'));

  // Completed entries
  for (const [indexedPath] of this.archJsonPathIndex) {
    if (normSources.every((s) => s.startsWith(indexedPath + '/') || s === indexedPath)) {
      return { deferred: null, normParentPath: indexedPath };
    }
  }

  // In-progress deferred entries
  for (const [, { promise, sources: parentSources }] of this.archJsonDeferred) {
    const normParentSources = parentSources.map((s) => s.replace(/\\/g, '/'));
    if (
      normParentSources.some((ps) =>
        normSources.every((s) => s.startsWith(ps + '/') || s === ps)
      )
    ) {
      const matchedParent = normParentSources.find((ps) =>
        normSources.every((s) => s.startsWith(ps + '/') || s === ps)
      )!;
      return { deferred: promise, normParentPath: matchedParent };
    }
  }

  return { deferred: null, normParentPath: null };
}
```

**Step 2**: Insert parent-path check into the **default ParallelParser path** in `processSourceGroup` (after the `files.length === 0` guard, before `archJsonCache.get`):

```typescript
// Before: (line ~274)
let rawArchJSON = this.archJsonCache.get(sourceKey);
if (!rawArchJSON) {
  // ... file discovery + ParallelParser ...
}

// After:
const { deferred, normParentPath } = this.findParentCoverage(diagrams[0].sources);

if (deferred) {
  // Parent is in progress; wait for it, then derive
  const parentArchJSON = await deferred;
  rawArchJSON = deriveSubModuleArchJSON(parentArchJSON, diagrams[0].sources[0]);
  if (process.env.ArchGuardDebug === 'true') {
    console.debug(`🔗 Awaited parent and derived sub-module ArchJSON for ${diagrams[0].sources.join(', ')} from ${normParentPath}`);
  }
} else if (normParentPath) {
  // Parent already complete; derive immediately
  const cacheKey = this.archJsonPathIndex.get(normParentPath)!;
  const parentArchJSON = this.archJsonCache.get(cacheKey)!;
  rawArchJSON = deriveSubModuleArchJSON(parentArchJSON, diagrams[0].sources[0]);
  if (process.env.ArchGuardDebug === 'true') {
    console.debug(`🔗 Derived sub-module ArchJSON for ${diagrams[0].sources.join(', ')} from ${normParentPath}`);
  }
} else {
  let rawArchJSON = this.archJsonCache.get(sourceKey);
  if (!rawArchJSON) {
    // ... existing ParallelParser invocation ...
    rawArchJSON = await parser.parseFiles(files);
    this.cacheArchJson(diagrams[0].sources, rawArchJSON);
  }
}
```

---

### Stage B-5 — Run tests (TDD green)

```bash
npm test -- --testPathPattern=diagram-processor.test
# Stage B-1 tests: now pass

npm test
# Full suite green
```

---

### Stage B-6 — Integration validation

```bash
npm run build
ArchGuardDebug=true node dist/cli/index.js analyze -s /home/yale/work/web-llm/src \
  --output-dir /home/yale/work/web-llm/.archguard -v 2>&1 | grep -E "Derived|Awaited|Cache"
# Expected:
#   🔗 Awaited parent and derived sub-module ArchJSON for .../openai_api_protocols from .../src
#   🔗 Awaited parent and derived sub-module ArchJSON for .../shared from .../src
# (Groups B and C no longer trigger ParallelParser)

# Verify entity counts match
cat /home/yale/work/web-llm/.archguard/index.md | grep -A2 "openai_api_protocols\|shared"
```

### Acceptance criteria — Phase B

- [ ] `archJsonPathIndex` populated at every cache write site
- [ ] `archJsonDeferred` stores `{ promise, sources }` and is populated at parse start, cleared on completion
- [ ] `findParentCoverage` returns deferred promise for in-progress parents (not just completed ones)
- [ ] Groups B and C `await` Group A's deferred before derivation — confirmed via `ArchGuardDebug=true` log showing "Awaited"
- [ ] `deriveSubModuleArchJSON` filters both `entities`/`relations` and `moduleGraph` nodes/edges/cycles
- [ ] Groups with no parent coverage still fall through to ParallelParser
- [ ] `npm test` full suite green, count does not decrease
- [ ] Integration: 5 diagrams succeed; `index.md` entity counts consistent with Phase A output

---

## Phase C — Worker Thread Render Pool + Pipeline (Layer 2 + 3)

> **Gate**: Phase A must be merged. Phase C must NOT begin without a passing feasibility spike (Stage C-0).

### Objectives

1. Verify `isomorphic-mermaid` can be independently instantiated inside Node.js Worker Threads.
2. If feasible: implement a fixed-size `MermaidRenderWorkerPool` enabling true parallel rendering.
3. Submit render jobs immediately after Mermaid code generation (pipeline overlap).

### Testing strategy for Worker Threads in Vitest

Vitest runs TypeScript directly via Vite; Worker Threads require a compiled `.js` file. Direct Worker-in-test is not feasible without a build step. The approach:

- **Unit tests** (`tests/unit/mermaid/render-worker-pool.test.ts`): mock the `Worker` constructor from `node:worker_threads`. Test pool lifecycle, job dispatch, error isolation, and `terminate()` behaviour without spawning real workers.
- **Integration test** (`tests/integration/mermaid/render-worker-pool.integration.test.ts`): runs after `npm run build`; spawns actual workers. Gated with a `skipIf(!existsSync('dist/mermaid/render-worker.js'))` guard.
- **Feasibility spike** (Stage C-0): a standalone script, not a vitest test.

### Files changed

| File | Change |
|------|--------|
| `src/mermaid/render-worker.ts` (new) | Worker thread entry point |
| `src/mermaid/render-worker-pool.ts` (new) | Pool types, pool management, job dispatch |
| `src/cli/processors/diagram-processor.ts` | Integrate pool into render call sites |
| `tests/unit/mermaid/render-worker-pool.test.ts` (new) | Pool unit tests (Worker mocked) |
| `tests/integration/mermaid/render-worker-pool.integration.test.ts` (new) | Real-worker integration tests |

---

### Stage C-0 — Feasibility spike (BLOCKING)

Before writing any production code, verify that `isomorphic-mermaid` can be independently instantiated inside a Worker Thread. JSDOM uses native addons; Node.js has constraints on sharing native addon state across Worker Threads.

```typescript
// scripts/spike-worker-mermaid.ts
import { Worker, isMainThread, workerData, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';

if (isMainThread) {
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { code: 'flowchart LR\n  A --> B' },
  });
  worker.on('message', (msg: { success: boolean; error?: string; svgLength?: number }) => {
    console.log(msg.success
      ? `✅ feasible — svg length: ${msg.svgLength}`
      : `❌ not feasible: ${msg.error}`
    );
    process.exit(msg.success ? 0 : 1);
  });
  worker.on('error', (e) => { console.error('Worker error:', e); process.exit(1); });
} else {
  try {
    const { default: mermaid } = await import('isomorphic-mermaid');
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
    const { svg } = await mermaid.render('spike-test', workerData.code as string);
    parentPort!.postMessage({ success: true, svgLength: svg.length });
  } catch (e) {
    parentPort!.postMessage({ success: false, error: String(e) });
  }
}
```

Build first, then run:
```bash
npm run build
node --experimental-vm-modules dist/scripts/spike-worker-mermaid.js
# Or with tsx (ESM mode, requires tsx ≥ 4):
# npx tsx --experimental-vm-modules scripts/spike-worker-mermaid.ts
```

**If spike fails**: Mark Phase C `Status: Blocked`. File a new proposal to investigate `child_process` + IPC or pre-forked renderer processes. Do not proceed.

**If spike succeeds**: proceed to Stage C-1.

---

### Stage C-1 — Design worker message protocol

Theme is fixed per-pool at construction time (passed via `workerData`), not per-job. This avoids re-initialising the mermaid singleton on every render, which is stateful and unsafe.

```typescript
// src/mermaid/render-worker-pool.ts

export interface WorkerInitData {
  theme: string;
  backgroundColor: string;
}

export interface RenderJob {
  jobId: string;
  mermaidCode: string;
}

export interface RenderResult {
  jobId: string;
  success: boolean;
  svg?: string;
  error?: string;
}
```

`RenderResult.svg` is the rendered SVG string; the main thread writes `.svg` and calls `convertSVGToPNG` itself (sharp runs in the libuv thread pool from the main thread, not inside the worker).

---

### Stage C-2 — Write failing tests (TDD red, Worker mocked)

```typescript
// tests/unit/mermaid/render-worker-pool.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock worker_threads at top level
vi.mock('worker_threads', () => {
  const EventEmitter = require('events');
  class MockWorker extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(undefined);
  }
  return { Worker: vi.fn(() => new MockWorker()) };
});

describe('MermaidRenderWorkerPool', () => {
  it('start() creates poolSize workers', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    const pool = new MermaidRenderWorkerPool(3, { theme: 'default', backgroundColor: 'white' });
    await pool.start();
    expect(Worker).toHaveBeenCalledTimes(3);
    await pool.terminate();
  });

  it('render() dispatches job to idle worker via postMessage', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();

    const renderPromise = pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });

    // Simulate worker response
    const workerInstance = (Worker as any).mock.results[0].value;
    const sentJob: RenderJob = workerInstance.postMessage.mock.calls[0][0];
    workerInstance.emit('message', { jobId: sentJob.jobId, success: true, svg: '<svg/>' });

    const result = await renderPromise;
    expect(result.success).toBe(true);
    expect(result.svg).toBe('<svg/>');
    await pool.terminate();
  });

  it('isolates errors: failed job does not terminate pool', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();

    const failPromise = pool.render({ mermaidCode: 'invalid' });
    const successPromise = pool.render({ mermaidCode: 'flowchart LR\n  A --> B' });

    const worker = (Worker as any).mock.results[0].value;
    const calls = worker.postMessage.mock.calls;

    // Respond to first job with failure
    worker.emit('message', { jobId: calls[0][0].jobId, success: false, error: 'parse error' });
    // Respond to second job with success (dispatched after worker becomes idle again)
    worker.emit('message', { jobId: calls[1][0].jobId, success: true, svg: '<svg/>' });

    const failResult = await failPromise;
    const successResult = await successPromise;
    expect(failResult.success).toBe(false);
    expect(successResult.success).toBe(true);
    await pool.terminate();
  });

  it('terminate() resolves all pending promises (queued and in-flight)', async () => {
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    const pool = new MermaidRenderWorkerPool(1, { theme: 'default', backgroundColor: 'white' });
    await pool.start();

    // Submit 2 jobs to a 1-worker pool: one in-flight, one queued
    const p1 = pool.render({ mermaidCode: 'A' });
    const p2 = pool.render({ mermaidCode: 'B' });

    await pool.terminate();

    // Both promises must settle (not hang)
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/terminated/i);
    expect(r2.success).toBe(false);
  });

  it('does not start workers when poolSize === 0', async () => {
    const { Worker } = await import('worker_threads');
    const { MermaidRenderWorkerPool } = await import('@/mermaid/render-worker-pool.js');
    (Worker as any).mockClear();
    const pool = new MermaidRenderWorkerPool(0, { theme: 'default', backgroundColor: 'white' });
    await pool.start();
    expect(Worker).not.toHaveBeenCalled();
    await pool.terminate();
  });
});
```

Run — confirm all tests fail:
```bash
npm test -- --testPathPattern=render-worker-pool.test
```

---

### Stage C-3 — Implement worker entry point

```typescript
// src/mermaid/render-worker.ts
import { workerData, parentPort } from 'worker_threads';
import mermaid from 'isomorphic-mermaid';
import type { WorkerInitData, RenderJob, RenderResult } from './render-worker-pool.js';

const initData = workerData as WorkerInitData;

// Each worker initialises its own mermaid instance once at startup.
// Theme is fixed for the pool lifetime; re-initialising per-job is unsafe (stateful singleton).
mermaid.initialize({
  startOnLoad: false,
  theme: initData.theme ?? 'default',
  securityLevel: 'loose',
});

parentPort!.on('message', async (job: RenderJob) => {
  try {
    const { svg } = await mermaid.render(job.jobId, job.mermaidCode);
    parentPort!.postMessage({ jobId: job.jobId, success: true, svg } satisfies RenderResult);
  } catch (e) {
    parentPort!.postMessage({
      jobId: job.jobId,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies RenderResult);
  }
});
```

**Build path**: `src/mermaid/render-worker.ts` compiles to `dist/mermaid/render-worker.js`. The pool references it via:
```typescript
const WORKER_FILE = fileURLToPath(new URL('./render-worker.js', import.meta.url));
```
This only works from the compiled `dist/` tree. In development (`tsx`), the integration test's skip guard prevents actual worker spawning.

---

### Stage C-4 — Implement `MermaidRenderWorkerPool`

Key correctness requirements for `terminate()`:
1. Terminate all worker processes (`Promise.all` — parallel, not serial).
2. Drain **both** `this.queue` (not yet dispatched) and `this.pending` (in-flight, dispatched but no response).
3. Do not double-resolve: a job's resolver is in `this.pending`; remove it from `this.pending` before resolving to prevent double-call if `onResult` fires concurrently.

```typescript
// src/mermaid/render-worker-pool.ts
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { WorkerInitData, RenderJob, RenderResult } from './render-worker-pool.js';

const WORKER_FILE = fileURLToPath(new URL('./render-worker.js', import.meta.url));

export class MermaidRenderWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ job: RenderJob }> = [];
  private pending = new Map<string, (r: RenderResult) => void>();

  constructor(
    private readonly poolSize: number,
    private readonly initData: WorkerInitData
  ) {}

  async start(): Promise<void> {
    for (let i = 0; i < this.poolSize; i++) {
      const w = new Worker(WORKER_FILE, { workerData: this.initData });
      w.on('message', (result: RenderResult) => this.onResult(w, result));
      w.on('error', (err) => {
        // Worker crashed; resolve any job pending on it with an error.
        // We can't identify which jobId was in-flight without tracking it per-worker.
        // Simple approach: log and let the pending promise time out or be cleaned up by terminate().
        console.error(`[render-worker] worker error: ${err.message}`);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  render(job: Omit<RenderJob, 'jobId'>): Promise<RenderResult> {
    const fullJob: RenderJob = { ...job, jobId: randomUUID() };
    return new Promise((resolve) => {
      this.pending.set(fullJob.jobId, resolve);
      this.dispatch(fullJob);
    });
  }

  private dispatch(job: RenderJob): void {
    const worker = this.idle.pop();
    if (worker) {
      worker.postMessage(job);
    } else {
      this.queue.push({ job });
    }
  }

  private onResult(worker: Worker, result: RenderResult): void {
    const resolve = this.pending.get(result.jobId);
    if (resolve) {
      this.pending.delete(result.jobId);   // remove before calling to prevent double-resolve
      resolve(result);
    }
    const next = this.queue.shift();
    if (next) {
      worker.postMessage(next.job);
    } else {
      this.idle.push(worker);
    }
  }

  async terminate(): Promise<void> {
    // 1. Terminate all workers in parallel
    await Promise.all(this.workers.map((w) => w.terminate()));

    // 2. Drain queued jobs (not yet dispatched)
    for (const { job } of this.queue) {
      const resolve = this.pending.get(job.jobId);
      if (resolve) {
        this.pending.delete(job.jobId);
        resolve({ jobId: job.jobId, success: false, error: 'Pool terminated' });
      }
    }
    this.queue = [];

    // 3. Drain in-flight jobs (dispatched but no response received — worker was terminated)
    for (const [jobId, resolve] of this.pending) {
      resolve({ jobId, success: false, error: 'Pool terminated' });
    }
    this.pending.clear();
  }
}
```

---

### Stage C-5 — Integrate pool into render call sites

In `diagram-processor.ts`, create pool at the start of `processAll()`, before `groupDiagramsBySource()`:

```typescript
// Determine pool size: only useful when ≥ 2 diagrams; cap at 4 to avoid
// excessive JSDOM memory (each worker holds its own JSDOM instance).
const diagramCount = this.diagrams.length;
const poolSize = diagramCount >= 2 ? Math.min(os.cpus().length, diagramCount, 4) : 0;

// Pool constructor accepts theme from globalConfig so all workers share one theme.
const poolTheme = typeof this.globalConfig.mermaid?.theme === 'string'
  ? this.globalConfig.mermaid.theme
  : (this.globalConfig.mermaid?.theme?.name ?? 'default');
const pool = poolSize > 0
  ? new MermaidRenderWorkerPool(poolSize, {
      theme: poolTheme,
      backgroundColor: this.globalConfig.mermaid?.transparentBackground ? 'transparent' : 'white',
    })
  : null;

if (pool) await pool.start();

try {
  const sourceGroups = this.groupDiagramsBySource();
  const groupResults = await pMap(/* ... existing ... */);
  // ...
} finally {
  await pool?.terminate();
}
```

Pass `pool` down to render call sites. Replace `renderSVG` + `convertSVGToPNG` pairs:

```typescript
// Without pool (poolSize === 0 or single diagram):
const svg = await mermaidRenderer.renderSVG(code);
await Promise.all([
  fs.writeFile(svgPath, svg, 'utf-8'),
  mermaidRenderer.convertSVGToPNG(svg, pngPath).catch(...),
]);

// With pool:
const result = await pool.render({ mermaidCode: code });
if (!result.success) throw new Error(`Worker render failed: ${result.error}`);
const svg = result.svg!;
await Promise.all([
  fs.writeFile(svgPath, svg, 'utf-8'),
  mermaidRenderer.convertSVGToPNG(svg, pngPath).catch(...),  // sharp on main thread
]);
```

---

### Stage C-6 — Layer 3 pipeline dispatch

With pool available, Mermaid code generation and render submission can overlap across diagrams within a group. Mermaid code generation (`generateOnly()`) is synchronous/fast CPU work on the main thread; submitting to the pool is non-blocking.

```typescript
// In processDiagramGroup(), instead of awaiting each diagram serially:

// Submit all code generation + pool render in parallel
const renderJobs = await Promise.all(diagrams.map(async (diagram) => {
  const code = await generateMermaidCode(diagram, archJson);  // fast, main thread
  return { diagram, code, resultPromise: pool!.render({ mermaidCode: code }) };
}));

// Await all render results
const results = await Promise.all(renderJobs.map(async ({ diagram, code, resultPromise }) => {
  const renderResult = await resultPromise;
  return finaliseDiagram(diagram, code, renderResult);
}));
```

---

### Stage C-7 — Run tests (TDD green)

```bash
npm test -- --testPathPattern=render-worker-pool.test
# All Stage C-2 unit tests: now pass

npm test
# Full suite green
```

---

### Stage C-8 — Integration validation

```bash
npm run build
# Run integration test (requires build)
npm run test:integration -- --testPathPattern=render-worker-pool.integration

# Full timing comparison
time node dist/cli/index.js analyze -s /home/yale/work/web-llm/src \
  --output-dir /home/yale/work/web-llm/.archguard -v
# Compare against Phase A wall-time baseline

# Verify output correctness
diff <(ls /home/yale/work/web-llm/.archguard/*.mmd | sort) \
     <(ls /ref-phase-a/*.mmd | sort)     # content diff against Phase A output
```

### Acceptance criteria — Phase C

- [ ] Feasibility spike passes (Stage C-0 is a hard gate)
- [ ] `WorkerInitData` carries `theme` and `backgroundColor`; workers initialise once at startup
- [ ] Pool creates `min(cpuCount, diagramCount, 4)` workers; 0 workers for single-diagram runs
- [ ] `terminate()` resolves all pending promises (queued + in-flight) exactly once without hanging
- [ ] Queued and in-flight jobs both receive `{ success: false, error: 'Pool terminated' }` on terminate
- [ ] Unit tests pass with mocked `Worker`; no real worker processes spawned in unit tests
- [ ] Integration test gated on `existsSync('dist/mermaid/render-worker.js')`
- [ ] Wall time for web-llm 5-diagram run measurably reduced versus Phase A baseline
- [ ] All output `.mmd` files byte-identical to Phase A output
- [ ] `npm test` full suite green

---

## Cross-Phase Validation

After all phases land:

```bash
npm run type-check
npm run lint
npm test
npm run build

# Self-analysis
rm -rf .archguard
node dist/cli/index.js analyze -v
# Confirm diagrams succeed, index.md generated

# Web-llm full timing comparison
time node dist/cli/index.js analyze -s /home/yale/work/web-llm/src \
  --output-dir /home/yale/work/web-llm/.archguard -v
# Record final wall time; update proposal Impact table
```

---

## Non-Goals (reminder)

- Caching full ArchJSON to disk (separate proposal)
- Eliminating ts-morph project initialisation cost (~90s); requires incremental compilation
- Removing `method/core` deduplication (needs user-facing design decision)
- Layer 2/3 if feasibility spike fails
