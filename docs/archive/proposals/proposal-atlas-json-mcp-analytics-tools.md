# Atlas JSON: MCP Package Analytics Tools

> Status: Draft (rev 2)
> Scope: New MCP tools exposing package-level architectural smell detection from Atlas data
> Branch: `feat/atlas-mcp-analytics` (future)

---

## Background

The existing MCP tools (`archguard_get_dependencies`, `archguard_summary`, etc.) operate on
the entity-relation layer of ArchJSON. For Go projects in Atlas mode, the meaningful
architectural data — package dependency graph, fan-in/fan-out, goroutine topology — lives
in `extensions.goAtlas.layers.*`, not in the entity-relation layer.

As a result, running structural analytics on a Go project via MCP currently yields either
empty results or misleading counts. An LLM agent analyzing `meta-cc` via MCP gets:
- `archguard_summary.relationCount = 7` (only gopls interface impls, not the 63 package edges)
- `archguard_get_dependencies("internal/query") = []` (entity IDs, not package paths)
- No way to ask "which package has the highest fan-in?" or "are there God Packages?"

This proposal adds three new MCP tools that compute fan-in/fan-out metrics directly from
the Atlas package layer and expose actionable metrics without requiring LLM computation.

---

## Goals

- `archguard_get_package_fanin`: return packages sorted by fan-in (most depended-upon first)
- `archguard_get_package_fanout`: return packages sorted by fan-out (most dependencies first)
- `archguard_detect_god_packages`: flag packages exceeding configurable thresholds for
  struct count, function count, file count, or fan-in — the structural signals of a God Package
- All tools access the Atlas data already embedded in the scope's `arch.json` via the
  existing `QueryEngine.getAtlasLayer('package')` API; no separate file I/O needed
- All tools return clean JSON suitable for direct LLM consumption

---

## Non-Goals

- LLM-based analysis or natural language summaries (ArchGuard is a mechanical tool)
- God Object detection at the struct level (covered by Capability layer `:::hotspot` markers)
- Change risk scoring (depends on git history; tracked separately in
  `proposal-git-history-analysis-layer.md`)
- Visualization output (the MCP tools return structured data, not Mermaid)

---

## Design

### 1. Data source

The Atlas data is embedded in the scope's `arch.json` under `extensions.goAtlas` — it is
**not** a separate file read by MCP tools. The `loadEngine()` call in `engine-loader.ts`
reads `<archDir>/query/<scopeKey>/arch.json`, which already includes the full Atlas
extension. `QueryEngine.getAtlasLayer('package')` returns the `PackageGraph` directly.

> Note: A separate `<name>-atlas.json` file is written alongside the Mermaid diagrams
> (e.g. `.archguard/overview/package-atlas.json`) for human inspection, but MCP tools
> must use the engine API to avoid duplicate read paths and stale-data risks.

**Data access pattern** (matches all existing Atlas MCP tool code in `mcp-server.ts`):
```typescript
const engine = await loadEngine(path.join(root, '.archguard'), scope);
if (!engine.hasAtlasExtension()) {
  return textResponse('No Atlas data found...');
}
const packageGraph = engine.getAtlasLayer('package'); // PackageGraph | undefined
```

### 2. Fan-in / fan-out computation

`PackageNode` (in `src/types/extensions/go-atlas.ts`) carries `fileCount` and optional
`stats?: PackageStats` (structs, interfaces, functions). It does **not** carry pre-computed
`fanIn` or `fanOut` fields — those fields only exist on `CapabilityNode`.

> **Architecture note**: `fanIn`/`fanOut` on `CapabilityNode` are computed by
> `CapabilityGraphBuilder` at parse time. The equivalent computation for `PackageNode`
> must be done at query time by the new tools, from `PackageGraph.edges`.

The implementation must build fan-in/fan-out at query time:
```typescript
const fanIn = new Map<string, number>();  // packageId → count of incoming edges
const fanOut = new Map<string, number>(); // packageId → count of outgoing edges
for (const edge of packageGraph.edges) {
  fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
}
```

`PackageDependency` uses `source`/`target` field names (confirmed in current type definition;
A1 fix has already been applied to the type).

### 3. `archguard_get_package_fanin`

**Input params**: `projectRoot?: string`, `scope?: string`, `limit?: number` (default 20),
`minFanIn?: number` (default 0)

**Algorithm**:
1. Load engine, assert `hasAtlasExtension()`
2. Get `packageGraph = engine.getAtlasLayer('package')`
3. Compute `fanIn` and `fanOut` maps from `packageGraph.edges` (see §2)
4. Enrich with node metadata (name, type, fileCount, stats) from `packageGraph.nodes`
5. Filter by `minFanIn`, sort descending by fan-in, slice to `limit`
6. Return sorted array

**Example response**:
```json
{
  "packages": [
    {
      "id": "github.com/org/app/internal/types",
      "name": "internal/types",
      "type": "internal",
      "fanIn": 12,
      "fanOut": 0,
      "fileCount": 4,
      "stats": { "structs": 16, "interfaces": 3, "functions": 2 }
    },
    {
      "id": "github.com/org/app/internal/mcp/executor",
      "name": "internal/mcp/executor",
      "type": "internal",
      "fanIn": 11,
      "fanOut": 11,
      "fileCount": 7,
      "stats": { "structs": 2, "interfaces": 0, "functions": 24 }
    }
  ]
}
```

### 4. `archguard_get_package_fanout`

Identical to `archguard_get_package_fanin` except:
- Input: `minFanOut?: number` (default 0) instead of `minFanIn`
- Sorted descending by fan-out
- Both `fanIn` and `fanOut` are still included in output for cross-reference

### 5. `archguard_detect_god_packages`

**Input params**:
- `projectRoot?: string`
- `scope?: string`
- `minFanIn?: number` (default 5)
- `minStructs?: number` (default 10)
- `minFunctions?: number` (default 30)
- `minFiles?: number` (default 10)

**Algorithm**: compute fan-in/fan-out from edges (same as §2); flag any package matching
at least one threshold; include which thresholds triggered.

**Example response**:
```json
{
  "godPackages": [
    {
      "id": "github.com/org/app/internal/query",
      "name": "internal/query",
      "type": "internal",
      "reasons": ["minStructs: 32 ≥ 10", "minFunctions: 74 ≥ 30", "minFiles: 19 ≥ 10"],
      "fanIn": 6,
      "fanOut": 7,
      "fileCount": 19,
      "stats": { "structs": 32, "interfaces": 5, "functions": 74 }
    },
    {
      "id": "github.com/org/app/internal/mcp/executor",
      "name": "internal/mcp/executor",
      "type": "internal",
      "reasons": ["minFanIn: 11 ≥ 5"],
      "fanIn": 11,
      "fanOut": 11,
      "fileCount": 7,
      "stats": { "structs": 2, "interfaces": 0, "functions": 24 }
    }
  ]
}
```

### 6. Error response

When Atlas data is not available (non-Go project or `--no-atlas` flag), return the same
error format already used by `archguard_get_atlas_layer`:

```typescript
return textResponse(
  'No Atlas data found. This tool requires a Go project analyzed with Atlas mode.\n' +
  `Run: archguard_analyze({ projectRoot: "${root}", lang: "go" })`
);
```

Do **not** return `{ "error": "..." }` JSON — all existing MCP tools return plain-text
error messages via `textResponse()`.

### 7. Implementation location

New file: `src/cli/mcp/tools/atlas-analytics-tools.ts`

Export a single registration function:
```typescript
export function registerAtlasAnalyticsTools(server: McpServer, defaultRoot: string): void { ... }
```

Register in: **`src/cli/mcp/mcp-server.ts`** — call `registerAtlasAnalyticsTools(server, defaultRoot)`
inside `createMcpServer()`, alongside the existing `registerCallGraphTools(...)` call.

> **Correction from rev 1**: There is no `src/cli/mcp/tools/index.ts`. Registration is
> done by calling the `register*()` function directly inside `createMcpServer()` in
> `mcp-server.ts`. All existing tool modules (test-analysis-tools, call-graph-tools, etc.)
> follow this same pattern.

---

## Architecture issues found during review

| # | Severity | Finding |
|---|----------|---------|
| A1 | Fixed | `PackageDependency` uses `source`/`target` (not `from`/`to`). Already correct in type. |
| A2 | **Critical** | Atlas data is in `arch.json` under `extensions.goAtlas`, not a separate `output/<name>-atlas.json`. Use `engine.getAtlasLayer()`, not a direct file read. |
| A3 | **Critical** | `PackageNode` has no `fanIn`/`fanOut` fields. Only `CapabilityNode` does. Must compute at query time from edge traversal. |
| A4 | **Critical** | `src/cli/mcp/tools/index.ts` does not exist. Registration target is `mcp-server.ts`. |
| A5 | Minor | Error responses must use `textResponse(string)`, not `{ "error": "..." }` JSON, to be consistent with all other MCP tools. |
| A6 | Minor | `GoAtlasExtension.version` comment says `"1.0"` but `GO_ATLAS_EXTENSION_VERSION = '2.0'`. Irrelevant to this proposal but worth noting. |
| A7 | **Critical** | `textResponse()` in `mcp-server.ts` is a private module function — not exported. Each tool file must define its own local copy. `scopeParam` is also private; reproduce `z.string().optional()` inline in the new file. |
| A8 | Minor | `skipIfNoArchDir` does not exist in `tests/integration/skip-helper.ts`. Integration tests must gate on `fs.existsSync` directly and use `describe.skipIf`. Test location is `tests/integration/cli-mcp/` (not `cli/mcp/`). |

---

## Plan

| Phase | Work | Files |
|---|---|---|
| 1 | Fan-in/fan-out computation utilities + unit tests | `src/cli/mcp/tools/atlas-analytics-tools.ts`, tests |
| 2 | `archguard_get_package_fanin` + `archguard_get_package_fanout` tool handlers | same |
| 3 | `archguard_detect_god_packages` with configurable thresholds | same |
| 4 | Registration in `mcp-server.ts` + integration test against meta-cc Atlas JSON | `src/cli/mcp/mcp-server.ts` |
