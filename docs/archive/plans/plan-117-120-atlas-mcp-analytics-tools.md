# Plan 117–120: Atlas MCP Package Analytics Tools

> Source proposal: `docs/proposals/proposal-atlas-json-mcp-analytics-tools.md` (rev 2)
> Branch: `feat/atlas-mcp-analytics`
> Phases: 117, 118, 119, 120

---

## Overview

Add three MCP tools that compute fan-in/fan-out metrics and detect God Packages directly
from the Go Atlas package graph embedded in `arch.json`. The tools expose data that is
currently invisible to LLM agents querying Go projects via MCP.

**New file**: `src/cli/mcp/tools/atlas-analytics-tools.ts`  
**Modified file**: `src/cli/mcp/mcp-server.ts` (registration only)

**Tools**:
1. `archguard_get_package_fanin` — packages ranked by incoming dependency count
2. `archguard_get_package_fanout` — packages ranked by outgoing dependency count
3. `archguard_detect_god_packages` — packages exceeding configurable smell thresholds

---

## Data Source & Access Pattern

Atlas data lives in `extensions.goAtlas.layers.package` inside the scope's `arch.json`.
MCP tools access it exclusively through the engine API (no direct file reads):

```typescript
const engine = await loadEngine(path.join(root, '.archguard'), scope);
if (!engine.hasAtlasExtension()) {
  return textResponse(
    'No Atlas data found. This tool requires a Go project analyzed with Atlas mode.\n' +
    `Run: archguard_analyze({ projectRoot: "${root}", lang: "go" })`
  );
}
const packageGraph = engine.getAtlasLayer('package'); // PackageGraph | undefined
```

`PackageNode` has no pre-computed `fanIn`/`fanOut` fields (only `CapabilityNode` does).
Fan-in/fan-out must be computed at query time from `PackageGraph.edges` (each edge has
`source` and `target` fields of type `string` — package IDs).

---

## Architecture Constraints

- Error responses use `textResponse(string)` — never `{ "error": "..." }` JSON
- `textResponse` is **not exported** from `mcp-server.ts` (it is a private module function).
  Each new tool file must define its own local helper:
  ```typescript
  function textResponse(text: string) {
    return { content: [{ type: 'text' as const, text }] };
  }
  ```
- All tool files import `resolveRoot` from `'../mcp-server.js'`
- All tool files import `loadEngine` from `'../../query/engine-loader.js'`
- Registration is in `createMcpServer()` in `mcp-server.ts` — no `tools/index.ts` exists
- Param schema: `projectRoot` and `scope` use the same patterns as existing tools
  (`scopeParam` in `mcp-server.ts` is also private; reproduce the `z.string().optional()` schema inline)
- Tests use `vi.mock('@/cli/query/engine-loader.js')` + `McpServer` spy pattern
  (see `tests/unit/cli/mcp/call-graph-tools.test.ts` for canonical pattern)

---

## Phase 117 — Fan-in/Fan-out computation utilities

**Goal**: Implement the shared fan-in/fan-out computation function and its unit tests.
This is the pure-logic foundation used by all three tools.

**Files**:
- `src/cli/mcp/tools/atlas-analytics-tools.ts` (new, computation only — no tool registration yet)
- `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` (new, TDD — tests written first)

**Dependencies**: none (standalone utility)

**Definition of Done**:
- `computePackageFanMetrics(packageGraph)` returns `{ fanIn: Map<string, number>, fanOut: Map<string, number> }`
- `enrichPackageNodes(nodes, fanIn, fanOut)` returns enriched node array (adds fanIn/fanOut numeric fields)
- Unit tests cover: empty graph, single node no edges, symmetric edges, isolated node (fan-in=0 fanOut=0)
- All new tests pass; existing suite unaffected

### Stage 117-A: Write failing tests for fan metric computation (~80 lines)

Write `tests/unit/cli/mcp/atlas-analytics-tools.test.ts`:

```
describe('computePackageFanMetrics', () => {
  it('returns empty maps for graph with no edges')
  it('counts incoming edges as fanIn per target node')
  it('counts outgoing edges as fanOut per source node')
  it('handles a node that is both source and target')
  it('ignores nodes that appear only in node list (no edges) → fanIn=0 fanOut=0')
})

describe('enrichPackageNodes', () => {
  it('enriches each node with fanIn and fanOut from maps')
  it('defaults to 0 for nodes not present in either map')
  it('preserves original node fields (id, name, type, fileCount, stats)')
})
```

Import only the types at this stage (functions do not exist yet → tests fail to compile).

### Stage 117-B: Implement computation utilities (~100 lines)

Create `src/cli/mcp/tools/atlas-analytics-tools.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';

export interface EnrichedPackageNode extends PackageNode {
  fanIn: number;
  fanOut: number;
}

export function computePackageFanMetrics(graph: PackageGraph): {
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
} { ... }

export function enrichPackageNodes(
  nodes: PackageNode[],
  fanIn: Map<string, number>,
  fanOut: Map<string, number>
): EnrichedPackageNode[] { ... }

// Stub: registerAtlasAnalyticsTools will be added in Phase 120
export function registerAtlasAnalyticsTools(_server: McpServer, _defaultRoot: string): void {}
```

All Stage 117-A tests must pass after this stage.

---

## Phase 118 — `archguard_get_package_fanin` and `archguard_get_package_fanout`

**Goal**: Implement both fan tools in the same file (they share the computation path).
Tests are written before the handler implementations.

**Files**:
- `src/cli/mcp/tools/atlas-analytics-tools.ts` (extend)
- `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` (extend)

**Dependencies**: Phase 117 (computation utilities must exist)

**Definition of Done**:
- `archguard_get_package_fanin` registered; returns packages sorted descending by fanIn
- `archguard_get_package_fanout` registered; returns packages sorted descending by fanOut
- Both tools include `fanIn` and `fanOut` in every result entry
- `limit` param (default 20) correctly slices results
- `minFanIn`/`minFanOut` filter applied before sort+slice
- No Atlas extension → `textResponse('No Atlas data found...')`
- Empty package graph → `textResponse('No package data found...')`
- All new tests pass; existing suite unaffected
- Coverage target: ≥80% of new handler code covered by unit tests

### Stage 118-A: Write failing tests for fanin tool (~100 lines)

Add to `tests/unit/cli/mcp/atlas-analytics-tools.test.ts`:

```
describe('archguard_get_package_fanin — tool schema', () => {
  it('registers archguard_get_package_fanin tool')
  it('registers archguard_get_package_fanout tool')
})

describe('archguard_get_package_fanin — handler', () => {
  it('returns No Atlas data message when hasAtlasExtension returns false')
  it('returns No package data message when packageGraph has no nodes')
  it('returns packages sorted descending by fanIn')
  it('applies minFanIn filter before sorting')
  it('limits results to requested limit (default 20)')
  it('response includes fanIn and fanOut fields in each entry')
  it('response includes id, name, type, fileCount in each entry')
  it('stats field included when node carries stats')
})

describe('archguard_get_package_fanout — handler', () => {
  it('returns packages sorted descending by fanOut')
  it('applies minFanOut filter before sorting')
  it('response includes both fanIn and fanOut for cross-reference')
})
```

Use the `collectTools` + `vi.mock` pattern from `call-graph-tools.test.ts`.
Build a `makeAtlasEngine()` factory that returns a `QueryEngine` with a minimal
`PackageGraph` (3 nodes, 4 edges to produce deterministic fan-in/fan-out counts).

### Stage 118-B: Implement fanin handler (~120 lines)

Add to `atlas-analytics-tools.ts`:

```typescript
import { z } from 'zod';
import path from 'path';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';

function textResponse(text: string) { ... }

// fanin handler: loadEngine → hasAtlasExtension check → getAtlasLayer('package')
// → computePackageFanMetrics → enrichPackageNodes → filter(minFanIn)
// → sort descending by fanIn → slice(limit) → textResponse(JSON)
```

### Stage 118-C: Implement fanout handler (~80 lines)

Add fanout handler (mirrors fanin with `fanOut` as sort key and `minFanOut` param).
Both handlers are registered inside `registerAtlasAnalyticsTools()`.
All Stage 118-A tests must pass after this stage.

---

## Phase 119 — `archguard_detect_god_packages`

**Goal**: Implement the God Package detector with configurable thresholds.
A package is flagged when it exceeds at least one threshold. Output includes which
thresholds triggered.

**Files**:
- `src/cli/mcp/tools/atlas-analytics-tools.ts` (extend)
- `tests/unit/cli/mcp/atlas-analytics-tools.test.ts` (extend)

**Dependencies**: Phase 118 (fan metric computation + enrichment must exist)

**Thresholds and defaults**:
| Param | Default | Condition |
|-------|---------|-----------|
| `minFanIn` | 5 | `node.fanIn >= minFanIn` |
| `minStructs` | 10 | `node.stats.structs >= minStructs` |
| `minFunctions` | 30 | `node.stats.functions >= minFunctions` |
| `minFiles` | 10 | `node.fileCount >= minFiles` |

**Definition of Done**:
- Only packages matching at least one threshold appear in `godPackages`
- `reasons` array lists all triggered thresholds with format `"minStructs: 32 ≥ 10"`
- Packages with no `stats` field: struct/function thresholds are not triggered (undefined is not ≥ threshold)
- Empty result (`godPackages: []`) still returns valid JSON, not an error message
- All new tests pass; existing suite unaffected
- Coverage target: ≥80% of new handler code covered by unit tests

### Stage 119-A: Write failing tests for god package detection (~100 lines)

Add to `tests/unit/cli/mcp/atlas-analytics-tools.test.ts`:

```
describe('archguard_detect_god_packages — tool schema', () => {
  it('registers archguard_detect_god_packages tool')
})

describe('archguard_detect_god_packages — handler', () => {
  it('returns No Atlas data message when hasAtlasExtension returns false')
  it('returns No package data message when packageGraph has no nodes')
  it('returns godPackages: [] when no packages exceed any threshold')
  it('flags package exceeding minFanIn threshold')
  it('flags package exceeding minStructs threshold')
  it('flags package exceeding minFunctions threshold')
  it('flags package exceeding minFiles threshold')
  it('flags package with multiple threshold violations; reasons lists all')
  it('does not flag package with stats=undefined for struct/function thresholds')
  it('applies custom threshold overrides from params')
  it('response includes fanIn, fanOut, fileCount, stats in each god package entry')
})
```

### Stage 119-B: Implement god package handler (~120 lines)

Add to `atlas-analytics-tools.ts`:

```typescript
// godPackages handler:
// 1. loadEngine → hasAtlasExtension → getAtlasLayer('package')
// 2. computePackageFanMetrics → enrichPackageNodes
// 3. For each enriched node, collect triggered reasons
// 4. Filter nodes where reasons.length > 0
// 5. Return { godPackages: [...] }
```

All Stage 119-A tests must pass after this stage.

---

## Phase 120 — Registration + integration validation

**Goal**: Wire `registerAtlasAnalyticsTools()` into `createMcpServer()` and validate
end-to-end against a real meta-cc Atlas JSON artifact.

**Files**:
- `src/cli/mcp/mcp-server.ts` (add one import + one call)
- `tests/unit/cli/mcp/mcp-server.test.ts` (extend: verify the three tools are registered)
- `tests/integration/cli/mcp/atlas-analytics-tools.integration.test.ts` (new, gated)

**Dependencies**: Phases 117–119 (all three tools implemented)

**Definition of Done**:
- `createMcpServer()` registers all three new tools without breaking existing 10+ tools
- `mcp-server.test.ts` confirms tool names present in the registered tool list
- Integration test (gated on `.archguard/` existing) runs `archguard_get_package_fanin`
  against meta-cc and asserts:
  - at least one result with `fanIn > 0`
  - result is sorted descending by fanIn
  - `fanOut` field is present in each result
- Integration test runs `archguard_detect_god_packages` and asserts:
  - result has `godPackages` key
  - any flagged packages have non-empty `reasons` array
- All tests pass (`npm test`); `npm run type-check` clean

### Stage 120-A: Write registration tests (~50 lines)

Add to `tests/unit/cli/mcp/mcp-server.test.ts`:

```
describe('createMcpServer — atlas analytics tool registration', () => {
  it('registers archguard_get_package_fanin')
  it('registers archguard_get_package_fanout')
  it('registers archguard_detect_god_packages')
})
```

Use the existing `collectRegisteredTools` helper or spy on `server.tool` with
`createMcpServer()` to enumerate all registered tool names.

### Stage 120-B: Wire registration (~20 lines in mcp-server.ts)

In `src/cli/mcp/mcp-server.ts`, add:

```typescript
import { registerAtlasAnalyticsTools } from './tools/atlas-analytics-tools.js';
```

In `createMcpServer()`:
```typescript
registerAtlasAnalyticsTools(server, defaultRoot);
```

Place after the `registerCallGraphTools(...)` call. No other changes to `mcp-server.ts`.

### Stage 120-C: Integration test (gated) (~80 lines)

Create `tests/integration/cli-mcp/atlas-analytics-tools.integration.test.ts`:

> Note: The correct directory is `tests/integration/cli-mcp/` (not `cli/mcp/`) — this matches
> the existing `cross-project-query.test.ts` and `default-language-scopes.test.ts` location.

```typescript
// Skip when meta-cc .archguard/query directory is absent.
// `skipIfNoArchDir` does not exist in skip-helper.ts; use fs.existsSync directly.

import fs from 'fs-extra';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const META_CC_ROOT = '/home/yale/work/meta-cc';
const META_CC_ARCH_DIR = path.join(META_CC_ROOT, '.archguard', 'query');
const hasAtlasData = fs.existsSync(META_CC_ARCH_DIR);

describe.skipIf(!hasAtlasData)('Atlas analytics tools — integration against meta-cc', () => {
  let client: Client;

  beforeAll(async () => {
    const server = createMcpServer(META_CC_ROOT);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  it('archguard_get_package_fanin returns sorted results with fanIn > 0')
  it('archguard_get_package_fanout returns sorted results with fanOut > 0')
  it('archguard_detect_god_packages returns godPackages array')
});
```

---

## Phase/Stage Dependency Graph

```
Phase 117
  Stage 117-A (write tests)
    └── Stage 117-B (implement utilities)

Phase 118 [requires 117]
  Stage 118-A (write tests)
    └── Stage 118-B (implement fanin)
      └── Stage 118-C (implement fanout)

Phase 119 [requires 118]
  Stage 119-A (write tests)
    └── Stage 119-B (implement god packages)

Phase 120 [requires 119]
  Stage 120-A (write registration tests)
    └── Stage 120-B (wire registration)
      └── Stage 120-C (integration test)
```

---

## TDD Strategy

Every phase follows Red → Green → Refactor:
1. Write failing tests (Stage *-A) that import the not-yet-implemented code
2. Implement just enough code to make those tests pass (Stage *-B/C)
3. Refactor for clarity without breaking tests

Test isolation: all unit tests mock `loadEngine` via `vi.mock('@/cli/query/engine-loader.js')`
and build minimal `QueryEngine` instances using `buildArchIndex` + real `ArchJSON` fixtures
with `extensions.goAtlas` populated. No filesystem access in unit tests.

Coverage target: ≥80% line coverage for `src/cli/mcp/tools/atlas-analytics-tools.ts`

---

## Code Size Estimates

| Phase | Stage | New lines | Cumulative (all) | Phase prod+test total |
|-------|-------|-----------|------------------|-----------------------|
| 117 | 117-A (tests) | ~80 | 80 | — |
| 117 | 117-B (utils) | ~100 | 180 | **~180** |
| 118 | 118-A (tests) | ~100 | 280 | — |
| 118 | 118-B (fanin) | ~120 | 400 | — |
| 118 | 118-C (fanout) | ~80 | 480 | **~300** |
| 119 | 119-A (tests) | ~100 | 580 | — |
| 119 | 119-B (god pkgs) | ~120 | 700 | **~220** |
| 120 | 120-A (tests) | ~50 | 750 | — |
| 120 | 120-B (register) | ~20 | 770 | — |
| 120 | 120-C (integration) | ~80 | 850 | **~150** |

> "Phase prod+test total" = all new lines in that phase. All phases are well within the ≤500
> per-phase limit. No individual stage exceeds the ≤200 production-code limit.

Per-phase production code only (excluding tests):
- Phase 117: ~100 lines (fits ≤200 stage limit, ≤500 phase limit)
- Phase 118: ~200 lines (fits ≤500 phase limit)
- Phase 119: ~120 lines (fits ≤500 phase limit)
- Phase 120: ~20 lines mcp-server.ts change (fits ≤200 stage limit)

---

## Acceptance Criteria (per Phase)

### Phase 117
- [ ] `computePackageFanMetrics` correctly counts fanIn/fanOut from edge list
- [ ] `enrichPackageNodes` returns array preserving all original fields plus fanIn/fanOut
- [ ] All 8 unit tests in Stage 117-A pass

### Phase 118
- [ ] `archguard_get_package_fanin` registered and returns sorted-by-fanIn results
- [ ] `archguard_get_package_fanout` registered and returns sorted-by-fanOut results
- [ ] `limit` and `minFanIn`/`minFanOut` params work correctly
- [ ] No Atlas data → `textResponse` error (not JSON error object)
- [ ] All ~11 unit tests in Stage 118-A pass

### Phase 119
- [ ] `archguard_detect_god_packages` registered with all 4 threshold params
- [ ] No Atlas extension → `textResponse` error (not JSON error object)
- [ ] Empty package graph → `textResponse('No package data found...')`
- [ ] Only packages exceeding at least one threshold appear in output
- [ ] `reasons` lists all triggered thresholds with value and threshold in message
- [ ] `stats=undefined` nodes skip struct/function threshold checks
- [ ] All ~11 unit tests in Stage 119-A pass

### Phase 120
- [ ] `createMcpServer()` registers 3 new tools without breaking existing tools
- [ ] `npm test` passes (all existing + new tests green)
- [ ] `npm run type-check` clean
- [ ] Integration test (when atlas data present) confirms live data conforms to schema
