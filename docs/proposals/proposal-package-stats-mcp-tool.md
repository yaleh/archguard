# Package-Level Metrics: `archguard_summary` Extension + `archguard_get_package_stats` Tool

> Status: Draft (rev 2)
> Scope: Expose per-package file-count, entity-count, and approximate line-count metrics
>        through the MCP query layer, without parser changes or ArchJSON schema changes.
> Depends on: proposal-multi-paradigm-mcp-tools.md (merged; `QueryEngine.getAtlasLayer()` prerequisite)

---

## Problem Statement

ArchGuard MCP tools report architecture at the entity level (class, struct, interface) or
project level (total entityCount / relationCount), but provide no **package-level volume
metrics**. An LLM agent that wants to answer "which packages are the largest?" or "is the
entry-point layer too thick?" must call `archguard_get_file_entities` per file and aggregate
manually — a multi-round workflow with no guaranteed termination.

After analyzing a 12-package Go service, `archguard_summary` returns:

```json
{ "entityCount": 138, "relationCount": 44 }
```

There is no signal that `cmd/mcp-server` accounts for 4,485 source lines across 18 files —
65% of the total codebase — while most other packages are under 500 lines.

---

## What Exists in the Data Layer (Pre-Implementation Audit)

This proposal was written after a full audit of the existing data pipeline. The following
extension types are already computed during `parseProject()` and persisted in the query-layer
ArchJSON. They are immediately available to `QueryEngine` without parser changes.

### TypeScript: `extensions.tsAnalysis.moduleGraph` (TsModuleNode)

Built by `ModuleGraphBuilder.build()`, called from `TypeScriptPlugin.parseProject()` before
the ArchJSON is returned to the caller. **Present in every TypeScript query-scope ArchJSON.**

```typescript
// src/types/extensions.ts
interface TsModuleNode {
  id: string;       // Project-root-relative directory: e.g. "src/cli/query"
  name: string;     // Same as id
  type: 'internal' | 'external' | 'node_modules';
  fileCount: number;
  stats: { classes: number; interfaces: number; functions: number; enums: number };
}
```

**Module ID granularity**: `path.dirname(relativeFilePath)`. File
`src/cli/query/engine.ts` → module `src/cli/query`. This is determined by the actual
directory structure, **not** a configurable depth. The `depth` parameter proposed in rev 1
for OO languages does not apply to TypeScript.

### Go Atlas: `extensions.goAtlas.layers.package` (PackageNode)

```typescript
// src/types/extensions.ts
interface PackageNode {
  id: string;       // Full module path: "github.com/example/svc/internal/query"
  name: string;     // Short path: "internal/query"
  type: 'internal' | 'external' | 'vendor' | 'std' | 'cmd' | 'tests' | 'examples' | 'testutil';
  fileCount: number;
  stats?: { structs: number; interfaces: number; functions: number };
}
```

### Java / Python / C++: No package extension

These languages produce only class-level entities. Package-level structure must be derived
from `ArchIndex.fileToIds` by grouping file paths using a configurable directory depth.
A `depth` parameter is relevant **only for this fallback path**.

---

## Three-Path Implementation

`QueryEngine.getPackageStats()` selects a data path based on what is present in the ArchJSON:

```
┌──────────────────────────────────────────────────────────┐
│             getPackageStats()                            │
│                                                          │
│  has goAtlas extension?   → Go Atlas path                │
│  has tsAnalysis.moduleGraph? → TypeScript path           │
│  else                     → OO fallback path             │
│                             (Java / Python / C++)        │
└──────────────────────────────────────────────────────────┘
```

| | Go Atlas | TypeScript | Java / Python / C++ |
|---|---|---|---|
| fileCount | `PackageNode.fileCount` (exact) | `TsModuleNode.fileCount` (exact) | `fileToIds` count (exact) |
| entityCount | derived from `entities` by file | `TsModuleNode.stats` sum | `fileToIds` entity count |
| methodCount | derived from `entities` by file | derived from `entities` by module prefix | `entity.members` filter |
| fieldCount | derived from `entities` by file | derived from `entities` by module prefix | `entity.members` filter |
| loc | ❌ absent (no parser data) | ❌ absent (no parser data) | `max(endLine)` per file, summed |
| testFileCount | inferred from sibling test nodes | naming convention | naming convention |
| languageStats | `goStats` (structs/interfaces/fns) | `tsStats` (classes/interfaces/fns/enums) | absent |

### Why methodCount IS available for Go and TypeScript

The class-level ArchJSON (what the query layer persists) contains `Entity[]` records for
Go structs/interfaces and TypeScript classes/interfaces, each with `members[]`. The extension
data (`PackageNode`, `TsModuleNode`) does not carry member counts, but `ArchIndex.fileToIds`
maps files to entity IDs, and the entity map carries full member data. Computing methodCount
from entities costs O(entities) per call — acceptable for a read-only query tool.

---

## Design Decisions

### Decision 1: Extension-first, derivation-fallback

For Go and TypeScript, authoritative package metadata already exists in extensions; using
it avoids re-computing what the parser already computed. Derivation from `fileToIds` is
reserved for languages where no extension exists.

### Decision 2: `depth` parameter is OO-fallback-only

For Go, packages are defined by the module system. For TypeScript, module IDs are the
actual file-system directory paths (computed by `ModuleGraphBuilder`). Neither benefits from
a configurable depth. The `depth` parameter (default: 2) applies only to Java, Python, and
C++, where there is no pre-computed package boundary. The API exposes `depth` for all
callers but documents it as a no-op for Go and TypeScript.

### Decision 3: `loc` is absent for extension-based paths, approximate for OO fallback

Extension nodes (`PackageNode`, `TsModuleNode`) do not carry line counts. Adding line counts
to these would require parser changes (out of scope). For OO fallback languages, `loc` is
approximated as `sum(max(entity.endLine) per file)`. The field is absent (not `null` or `0`)
when not available, preventing misleading comparisons.

### Decision 4: `locApproximate` is a path-level constant, not a per-entry flag

All OO fallback entries carry `locApproximate: true`; all extension-path entries carry no
`loc`. Emitting `locApproximate` on every entry is redundant. Instead, the response includes
a top-level `meta` object:

```json
{
  "meta": { "locBasis": "maxEndLine", "locAvailable": true  },  // OO fallback
  "packages": [...]
}
```
```json
{
  "meta": { "locBasis": null, "locAvailable": false },          // Go / TypeScript
  "packages": [...]
}
```

`archguard_summary`'s compact `topPackages` field does not include `meta`; it uses the
absence of `loc` as its own signal.

### Decision 5: Test file detection

| Language | Method | Confidence |
|---|---|---|
| Go | `PackageNode.type === 'tests'` identifies the companion test package node (not per-file) | Structural |
| TypeScript | Naming convention: `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `*.spec.tsx` | Heuristic |
| Java | Naming convention: path contains `/test/` or filename matches `*Test.java`, `Test*.java` | Heuristic |
| Python | Naming convention: `test_*.py`, `*_test.py` | Heuristic |
| C++ | Naming convention: `*.test.cpp`, `*.spec.cpp`, path contains `/test/` | Heuristic |

For Go, `testFileCount` on a source node is not directly available (test files live in a
companion test package node, not in the source `PackageNode`). The field is omitted for Go
rather than returning `0` (which would imply zero test files).

### Decision 6: `getSummary()` adds `topPackages` (compact, top 10)

The common motivating query ("show me the largest packages") should not require an extra
round-trip. `getSummary()` includes `topPackages: PackageStatEntry[]` — the top 10 by
`fileCount` (extension paths) or `loc` (OO fallback), descending.

**Performance**: `getPackageStats()` iterates entities once (O(n)) to build the member count
index. For a typical project (< 5,000 entities) this is < 5 ms. Accepted.

### Decision 7: Tool count and token budget

Adding `archguard_get_package_stats` brings the total to **11 tools**. Estimated token cost
for the new tool: ~280–360 tokens. Total budget remains well under 25,000 tokens (~6×
headroom). Remaining available slots: ~4.

---

## Proposed Changes

### Change 1 — Types: `PackageStatEntry` and `PackageStatMeta`

Defined in `src/cli/query/query-engine.ts` (query-layer types, not ArchJSON schema types).

```typescript
export interface PackageStatEntry {
  /** Package name. Go: short path ("internal/query"). TypeScript: module dir ("src/cli/query").
   *  Java/Python/C++: directory prefix at configured depth ("com/example/service"). */
  package: string;

  /** Number of source files in this package. Exact for all paths. */
  fileCount: number;

  /** Number of test files. Absent for Go (test packages are separate nodes, not per-file).
   *  For TypeScript/Java/Python/C++: detected via language-specific naming conventions. */
  testFileCount?: number;

  /** Total entities (class/struct/interface/enum) defined in this package. */
  entityCount: number;

  /** Total method + constructor count across all entities. Computed from entity members. */
  methodCount: number;

  /** Total property + field count across all entities. Computed from entity members. */
  fieldCount: number;

  /** Approximate line count. Absent for Go and TypeScript (not in extension data).
   *  OO fallback: sum of max(entity.sourceLocation.endLine) per file.
   *  NOT equivalent to physical line count (wc -l) or ncloc (SonarQube).
   *  Underestimates files with top-of-file preamble or trailing content after last entity.
   *  Files with zero entities contribute 0. Treat as a relative size signal, not exact LOC.
   *  meta.locBasis = 'maxEndLine' signals this approximation to callers. */
  loc?: number;

  /** Language-specific structural stats from the extension node (if available). */
  languageStats?: {
    /** Go: struct count. TypeScript: class count. */
    structs?: number;
    /** Go/TypeScript: interface count. */
    interfaces?: number;
    /** Go/TypeScript: function count. TypeScript only: top-level functions. */
    functions?: number;
    /** TypeScript only: enum count. */
    enums?: number;
    /** TypeScript only: class count (alias for structs in TS context). */
    classes?: number;
  };
}

export interface PackageStatMeta {
  /** Data path used: 'go-atlas' | 'ts-module-graph' | 'oo-derived' */
  dataPath: 'go-atlas' | 'ts-module-graph' | 'oo-derived';
  /** Whether loc is available in the returned entries. */
  locAvailable: boolean;
  /** When locAvailable is true: how loc was computed.
   *  'maxEndLine': sum of max(entity.sourceLocation.endLine) per file.
   *  Underestimates files whose last statement is followed by blank lines or comments.
   *  Files with zero entities contribute 0 to loc. */
  locBasis?: 'maxEndLine';
}

export interface PackageStatsResult {
  meta: PackageStatMeta;
  packages: PackageStatEntry[];
}
```

---

### Change 2 — `QueryEngine.getPackageStats()`

```typescript
/**
 * Compute per-package volume metrics.
 *
 * @param depth  Directory depth for OO-fallback package prefix extraction
 *               (Java/Python/C++ only; ignored for Go Atlas and TypeScript).
 *               Default: 2. Range: [1, 5].
 * @param topN   Return only the top N entries (sorted by loc or fileCount DESC).
 *               Default: all packages.
 */
getPackageStats(depth: number = 2, topN?: number): PackageStatsResult
```

#### Path A — Go Atlas

```typescript
const pg = this.getAtlasLayer('package');
if (pg) {
  const sourceNodes = pg.nodes.filter(
    n => n.type === 'internal' || n.type === 'cmd'
  );

  const packages: PackageStatEntry[] = sourceNodes.map(node => {
    // fileToIds contains Go struct/interface entities with workspace-relative file paths.
    // aggregateEntityMetrics matches files by prefix (e.g. "internal/query/engine.go"
    // starts with "internal/query/") to sum method and field counts.
    const { methodCount, fieldCount, entityCount } = this.aggregateEntityMetrics(node.name);

    return {
      package:   node.name,
      fileCount: node.fileCount,
      // testFileCount omitted: test files live in a companion 'tests' node, not per-file here
      entityCount,
      methodCount,
      fieldCount,
      languageStats: node.stats ? {
        structs:    node.stats.structs,
        interfaces: node.stats.interfaces,
        functions:  node.stats.functions,
      } : undefined,
    };
  });

  const sorted = packages.sort((a, b) => b.fileCount - a.fileCount);
  return {
    meta: { dataPath: 'go-atlas', locAvailable: false },
    packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
  };
}
```

#### Path B — TypeScript (`tsAnalysis.moduleGraph`)

`TsModuleNode.fileCount` is exact (counts every source file including test files), but
`ArchIndex.fileToIds` only contains files that have at least one entity. Test files
with no exported classes would be invisible to `fileToIds`, causing `testFileCount` to
undercount. We must use `this.archJson.sourceFiles` — which lists all parsed files — as
the enumeration source for file grouping and test detection.

`sourceFiles` may contain absolute paths on some platforms. Normalize using `workspaceRoot`
before computing module IDs, mirroring the same normalization in `arch-index-builder.ts`.

```typescript
const mg = this.archJson.extensions?.tsAnalysis?.moduleGraph;
if (mg) {
  const testPattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
  const ws = this.archJson.workspaceRoot;

  // Build module→files map from sourceFiles (includes test files with no entities)
  const moduleFiles = new Map<string, string[]>();
  for (let file of this.archJson.sourceFiles) {
    if (ws && path.isAbsolute(file)) file = path.relative(ws, file);
    const moduleId = file.includes('/')
      ? file.substring(0, file.lastIndexOf('/'))
      : '';
    moduleFiles.set(moduleId, [...(moduleFiles.get(moduleId) ?? []), file]);
  }

  const packages: PackageStatEntry[] = mg.nodes
    .filter(n => n.type === 'internal')
    .map(node => {
      const files = moduleFiles.get(node.id) ?? [];
      const testFileCount = files.filter(f => testPattern.test(f)).length;
      const { methodCount, fieldCount } = this.aggregateEntityMetrics(node.id);

      return {
        package:      node.name,
        fileCount:    node.fileCount,
        testFileCount,
        entityCount:  node.stats.classes + node.stats.interfaces + node.stats.enums,
        methodCount,
        fieldCount,
        languageStats: {
          classes:    node.stats.classes,
          interfaces: node.stats.interfaces,
          functions:  node.stats.functions,
          enums:      node.stats.enums,
        },
      };
    });

  const sorted = packages.sort((a, b) => b.fileCount - a.fileCount);
  return {
    meta: { dataPath: 'ts-module-graph', locAvailable: false },
    packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
  };
}
```

#### Path C — OO Fallback (Java / Python / C++)

```typescript
const resolvedDepth = Math.max(1, Math.min(5, depth));
const testPattern = this.buildTestPattern();

// Group files into packages by directory prefix
const packageFiles = new Map<string, string[]>();
for (const file of Object.keys(this.index.fileToIds)) {
  const parts = file.split('/');
  const pkg = parts.length <= resolvedDepth
    ? (parts.slice(0, -1).join('/') || '.')
    : parts.slice(0, resolvedDepth).join('/');
  packageFiles.set(pkg, [...(packageFiles.get(pkg) ?? []), file]);
}

const packages: PackageStatEntry[] = [];
for (const [pkg, files] of packageFiles) {
  let entityCount = 0, methodCount = 0, fieldCount = 0, loc = 0;
  let testFileCount = 0;

  for (const file of files) {
    const ids = this.index.fileToIds[file] ?? [];
    let maxLine = 0;

    for (const id of ids) {
      const entity = this.entityMap.get(id);
      if (!entity) continue;
      entityCount++;
      const members = entity.members ?? [];
      methodCount += members.filter(m => m.type === 'method' || m.type === 'constructor').length;
      fieldCount  += members.filter(m => m.type === 'property' || m.type === 'field').length;
      maxLine = Math.max(maxLine, entity.sourceLocation.endLine);
    }

    loc += maxLine;
    if (testPattern.test(file)) testFileCount++;
  }

  packages.push({ package: pkg, fileCount: files.length, testFileCount, entityCount, methodCount, fieldCount, loc });
}

const sorted = packages.sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0));
return {
  meta: { dataPath: 'oo-derived', locAvailable: true, locBasis: 'maxEndLine' },
  packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
};
```

#### Required imports in `query-engine.ts`

`TsModuleGraph` and `TsModuleNode` are **not** re-exported from `src/types/index.ts`.
They must be imported directly from the extensions module:

```typescript
import path from 'path';
import type { GoAtlasLayers, TsModuleGraph } from '@/types/extensions.js';
```

`path` is needed for `path.isAbsolute` / `path.relative` in the TypeScript sourceFiles
normalization. `TsModuleGraph` is needed only for the type guard; the actual value comes
from `this.archJson.extensions?.tsAnalysis?.moduleGraph`.

---

#### Private helpers

```typescript
/**
 * Aggregate entity metrics for all entities whose source file path is within the
 * given package directory. Matches files equal to the prefix OR starting with
 * prefix + '/' to prevent "internal/query_test" from matching "internal/query".
 */
private aggregateEntityMetrics(
  packagePrefix: string
): { entityCount: number; methodCount: number; fieldCount: number } {
  let entityCount = 0, methodCount = 0, fieldCount = 0;
  const sep = packagePrefix.endsWith('/') ? packagePrefix : packagePrefix + '/';
  for (const [file, ids] of Object.entries(this.index.fileToIds)) {
    if (file !== packagePrefix && !file.startsWith(sep)) continue;
    for (const id of ids) {
      const entity = this.entityMap.get(id);
      if (!entity) continue;
      entityCount++;
      const members = entity.members ?? [];
      methodCount += members.filter(m => m.type === 'method' || m.type === 'constructor').length;
      fieldCount  += members.filter(m => m.type === 'property' || m.type === 'field').length;
    }
  }
  return { entityCount, methodCount, fieldCount };
}

private buildTestPattern(): RegExp {
  switch (this.archJson.language) {
    case 'typescript': return /\.(test|spec)\.(ts|tsx|js|jsx)$/;
    case 'java':       return /\/test\/|Test\.java$|Tests\.java$|^Test[A-Z]/;
    case 'python':     return /(^|[\\/])test_[^\\/]+\.py$|_test\.py$/;
    case 'cpp':        return /\.(test|spec)\.(cpp|cc|cxx)$|([\\/]|^)test[_\-]/i;
    default:           return /\.(test|spec)\./;
  }
}
```

---

### Change 3 — `getSummary()` extension: `topPackages`

Add `topPackages: PackageStatEntry[]` to the return type (not `PackageStatsResult`; `meta`
is omitted from the compact summary view to keep the response lean).

```typescript
getSummary() {
  // ... existing computation unchanged ...
  const statsResult = this.getPackageStats(2, 10);
  const topPackages = statsResult.packages; // already top 10, sorted

  return {
    entityCount,
    relationCount,
    language,
    kind,
    topDependedOn,
    topDependedOnNote,
    capabilities,
    topPackages,  // compact: no meta, no loc when absent, max 10 entries
  };
}
```

---

### Change 4 — New MCP tool: `archguard_get_package_stats`

**Description** (one sentence): "Get per-package volume metrics (file count, entity count,
approximate line count) sorted and filtered by threshold."

**Schema**:

```typescript
{
  projectRoot: projectRootParam,
  scope:       scopeParam,
  depth: z.coerce.number().min(1).max(5).default(2)
          .describe(
            'Directory depth for package grouping. Applies to Java, Python, and C++ only; ' +
            'ignored for Go (module-defined packages) and TypeScript (directory-based modules).'
          ),
  sortBy: z.enum(['loc', 'fileCount', 'entityCount', 'methodCount'])
           .default('loc')
           .describe('Primary sort key, descending. Falls back to fileCount when loc is unavailable.'),
  minFileCount: z.coerce.number().optional()
                 .describe('Exclude packages with fewer than this many files.'),
  minLoc: z.coerce.number().optional()
           .describe('Exclude packages with loc below this threshold. Has no effect on Go or TypeScript.'),
  topN: z.coerce.number().min(1).max(200).optional()
         .describe('Limit output to the top N packages after sorting and filtering.'),
}
```

**Handler** (in `registerTools()`, `src/cli/mcp/mcp-server.ts`):

```typescript
async ({ projectRoot, scope, depth, sortBy, minFileCount, minLoc, topN }) => {
  const root = resolveRoot(projectRoot, defaultRoot);
  return withEngineErrorContext(root, async () => {
    const engine = await loadEngine(path.join(root, '.archguard'), scope);
    const result = engine.getPackageStats(depth);

    let packages = result.packages;

    if (minFileCount !== undefined) {
      packages = packages.filter(p => p.fileCount >= minFileCount);
    }
    if (minLoc !== undefined && result.meta.locAvailable) {
      packages = packages.filter(p => (p.loc ?? 0) >= minLoc);
    }

    // Re-sort by requested key (getPackageStats returns loc/fileCount default)
    packages = packages.sort((a, b) => {
      const key = (p: PackageStatEntry) =>
        sortBy === 'fileCount'   ? p.fileCount
        : sortBy === 'entityCount' ? p.entityCount
        : sortBy === 'methodCount' ? p.methodCount
        : (p.loc ?? p.fileCount); // loc, with fileCount fallback for extension paths
      return key(b) - key(a);
    });

    if (topN !== undefined) packages = packages.slice(0, topN);
    if (packages.length === 0) return textResponse('No package statistics available for this scope.');

    return textResponse(JSON.stringify({ meta: result.meta, packages }, null, 2));
  });
}
```

---

## Example Outputs

### Go Atlas project (top 5 by fileCount)

```json
{
  "meta": { "dataPath": "go-atlas", "locAvailable": false },
  "packages": [
    { "package": "internal/query",    "fileCount": 21, "entityCount": 38, "methodCount": 94, "fieldCount": 52, "languageStats": { "structs": 8, "interfaces": 5, "functions": 25 } },
    { "package": "cmd/mcp-server",    "fileCount": 18, "entityCount": 43, "methodCount": 72, "fieldCount": 38, "languageStats": { "structs": 12, "interfaces": 3, "functions": 28 } },
    { "package": "internal/analyzer", "fileCount": 10, "entityCount": 22, "methodCount": 41, "fieldCount": 19, "languageStats": { "structs": 6, "interfaces": 2, "functions": 14 } },
    { "package": "internal/filter",   "fileCount":  5, "entityCount": 12, "methodCount": 18, "fieldCount":  8, "languageStats": { "structs": 4, "interfaces": 1, "functions":  7 } },
    { "package": "internal/parser",   "fileCount":  4, "entityCount":  9, "methodCount": 15, "fieldCount":  6, "languageStats": { "structs": 3, "interfaces": 2, "functions":  4 } }
  ]
}
```

### TypeScript project (self-analysis, top 5 by fileCount)

```json
{
  "meta": { "dataPath": "ts-module-graph", "locAvailable": false },
  "packages": [
    { "package": "src/plugins/golang/atlas", "fileCount": 12, "testFileCount": 0, "entityCount": 18, "methodCount": 64, "fieldCount": 29, "languageStats": { "classes": 8, "interfaces": 7, "functions": 3, "enums": 0 } },
    { "package": "src/cli/processors",       "fileCount":  8, "testFileCount": 0, "entityCount": 11, "methodCount": 42, "fieldCount": 18, "languageStats": { "classes": 5, "interfaces": 4, "functions": 2, "enums": 0 } },
    { "package": "src/cli/query",            "fileCount":  6, "testFileCount": 0, "entityCount":  9, "methodCount": 38, "fieldCount": 14, "languageStats": { "classes": 4, "interfaces": 3, "functions": 2, "enums": 0 } },
    { "package": "src/plugins/typescript",   "fileCount":  5, "testFileCount": 0, "entityCount":  7, "methodCount": 21, "fieldCount": 12, "languageStats": { "classes": 4, "interfaces": 2, "functions": 1, "enums": 0 } },
    { "package": "src/mermaid",              "fileCount":  4, "testFileCount": 0, "entityCount":  6, "methodCount": 19, "fieldCount":  9, "languageStats": { "classes": 4, "interfaces": 2, "functions": 0, "enums": 0 } }
  ]
}
```

### Java project (OO fallback, depth=2, top 5 by loc)

```json
{
  "meta": { "dataPath": "oo-derived", "locAvailable": true, "locBasis": "maxEndLine" },
  "packages": [
    { "package": "com/example", "fileCount": 14, "testFileCount": 6, "entityCount": 31, "methodCount": 187, "fieldCount": 94, "loc": 4120 },
    { "package": "com/service", "fileCount":  8, "testFileCount": 3, "entityCount": 19, "methodCount": 112, "fieldCount": 58, "loc": 2380 },
    { "package": "com/model",   "fileCount":  6, "testFileCount": 2, "entityCount": 12, "methodCount":  38, "fieldCount": 71, "loc":  890 },
    { "package": "com/util",    "fileCount":  4, "testFileCount": 1, "entityCount":  8, "methodCount":  24, "fieldCount": 11, "loc":  560 },
    { "package": "com/config",  "fileCount":  2, "testFileCount": 0, "entityCount":  4, "methodCount":  12, "fieldCount": 22, "loc":  310 }
  ]
}
```

---

## Limitations and Known Gaps

| Limitation | Affected paths | Impact | Workaround / Deferral |
|---|---|---|---|
| `loc` not available for Go or TypeScript | go-atlas, ts-module-graph | Cannot rank by lines | Rank by `fileCount` or `methodCount`; parser change deferred |
| TypeScript `testFileCount` uses naming heuristic on `sourceFiles` | ts-module-graph | May miss test files with non-standard names | Acceptable for v1; parser tagging deferred |
| Go testFileCount omitted (test = companion node) | go-atlas | No per-package test file count | Use Atlas package node `type='tests'` via `archguard_get_atlas_layer` |
| OO: `fileCount` and `testFileCount` only count files with at least one entity | oo-derived | Constants-only or type-alias-only files missed | Rare in practice; consistent with each other so not misleading |
| OO: `loc` underestimates files whose last entity is followed by blank lines/comments | oo-derived | ~5–15% undercount typical | Documented via `meta.locBasis`; exact count requires parser change |
| `aggregateEntityMetrics` is O(fileToIds) per package (Go/TS paths) | go-atlas, ts-module-graph | ~5ms for < 5k entities | Acceptable; cache if profiling shows otherwise |
| OO `depth` heuristic may mis-group monorepo sub-projects | oo-derived | Wrong package boundaries | Expose `depth` param; users tune (Java typically needs `depth=3`) |
| `sourceFiles` may use absolute paths if `workspaceRoot` is unset | ts-module-graph | Module ID computation yields absolute paths, no match in `moduleFiles` | Normalize with `path.relative(workspaceRoot, file)` when absolute; log warning if `workspaceRoot` missing |

---

## Files Changed

| File | Change |
|---|---|
| `src/cli/query/query-engine.ts` | Export `PackageStatEntry`, `PackageStatMeta`, `PackageStatsResult`; add `getPackageStats()`, `aggregateEntityMetrics()`, `buildTestPattern()`; extend `getSummary()` return type with `topPackages` |
| `src/cli/mcp/mcp-server.ts` | Register `archguard_get_package_stats` in `registerTools()`; update tool count comment |
| `tests/unit/cli/query/query-engine.test.ts` | Tests for all three paths (Go/TS/OO); `getSummary().topPackages`; `depth` parameter; `topN` slicing; `minFileCount` filter |
| `tests/unit/cli/mcp/mcp-server.test.ts` | Tests for `archguard_get_package_stats`: sortBy/minLoc/topN/minFileCount; meta.dataPath per language; empty-result message |

---

## Tool Budget

| # | Tool | Paradigm |
|---|---|---|
| 1 | `archguard_analyze` | All |
| 2 | `archguard_summary` | All |
| 3 | `archguard_find_entity` | All |
| 4 | `archguard_get_dependencies` | OO |
| 5 | `archguard_get_dependents` | OO |
| 6 | `archguard_find_implementers` | OO + Go (limited) |
| 7 | `archguard_find_subclasses` | OO only |
| 8 | `archguard_get_file_entities` | All |
| 9 | `archguard_detect_cycles` | OO |
| 10 | `archguard_get_atlas_layer` | Go only |
| **11** | **`archguard_get_package_stats`** | **All** |

Estimated token cost for new tool schema: ~300–380 tokens.
Total tool budget: ~2,600–3,800 tokens. Headroom to 25,000-token threshold: ~6.5×.
Remaining available tool slots: **~4**.

---

## Acceptance Criteria

1. `archguard_summary` response includes `topPackages` (max 10, sorted by `loc` DESC for OO
   or `fileCount` DESC for Go/TypeScript).
2. `archguard_get_package_stats` on a **Go Atlas** project returns entries with `fileCount`,
   `methodCount`, `languageStats.{structs,interfaces,functions}`, no `loc` field,
   and `meta.dataPath === "go-atlas"`.
3. `archguard_get_package_stats` on a **TypeScript** project returns entries with `fileCount`,
   `testFileCount`, `languageStats.{classes,interfaces,functions,enums}`, no `loc` field,
   and `meta.dataPath === "ts-module-graph"`.
4. `archguard_get_package_stats` on a **Java** project returns entries with `loc`, `testFileCount`,
   and `meta.dataPath === "oo-derived"`.
5. `sortBy: "fileCount"` with `topN: 3` returns exactly 3 entries sorted by `fileCount` DESC.
6. `minLoc: 1000` on a Go project is silently ignored (no effect; not an error).
7. `minLoc: 1000` on a Java project excludes packages with `loc < 1000`.
8. `archguard_get_package_stats` on a project with no entities returns
   `"No package statistics available for this scope."`.
9. All existing tests pass without modification.
10. `npm run type-check` passes.
