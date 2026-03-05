# Go Atlas Quality Improvements Implementation Plan

**Plan ID**: 17
**Based on**: [Proposal 17 - Go Atlas Quality Improvements v1.1](../proposals/17-go-atlas-quality-improvements.md)
**Created**: 2026-02-25
**Status**: Ready for Implementation
**Priority**: High
**Branch**: `feat/go` (continue on existing branch)

**Prerequisites**:
- Plan 16 (Go Architecture Atlas) fully implemented ✅
- `feat/go` branch: 5 commits ahead of master, 1331 tests passing

---

## 1. Overview

### 1.1 Objective

Improve the output quality of the four-layer Go Architecture Atlas diagrams based on real-world analysis of the `codex-swarm` project. The improvements address three root causes:

- **Root Cause A** (filters): Test code pollutes all four layers, inflating node count and causing PNG pixel overflow
- **Root Cause B** (representation): Wrong diagram types and unreadable node IDs
- **Root Cause C** (extraction): Missing data connections in the analysis pipeline

### 1.2 Scope and Non-scope

**In scope**:
- `--atlas-no-tests` exclude filter (CLI + config)
- Flow layer: replace `sequenceDiagram` with `flowchart LR` + service subgraphs
- Flow layer: fix struct method handler resolution (P1, more fundamental than cross-package)
- Goroutine: fix node name extraction (correct ID format parsing)
- Package: edge deduplication via `strength` accumulation
- Capability: wire `InterfaceMatcher` into `BehaviorAnalyzer` data flow
- Capability: extend `uses` edges to struct-type fields

**Out of scope** (deferred):
- External dependency node grouping (Package layer)
- Flow multi-depth recursive tracing (complex, needs struct method fix first)
- gopls integration improvements

### 1.3 Success Criteria

| Layer | Before | After |
|-------|--------|-------|
| Package nodes (with `--atlas-no-tests`) | 38 | ≤ 28 |
| Goroutine PNG generation | Fails (pixel limit) | Succeeds |
| Flow diagram type | sequenceDiagram | flowchart LR |
| Flow callchain for method handlers | 0 | > 0 |
| Capability implements edges | 0 | ≥ fixture count |
| Capability uses edges | 16 | ≥ 50 (struct fields) |
| All existing tests | 1331 pass | ≥ 1331 pass |

---

## 2. Iteration Plan

### Iteration 1 — `--atlas-no-tests` Global Filter (P0)

**Objective**: Exclude `*_test.go` files and test directories from all four Atlas layers via a single call-site configuration.

**Pre-check (before writing any code)**:

`src/cli/commands/analyze.ts` already contains:
```
Line 186: .option('--atlas-no-tests', 'Exclude test files from Atlas extraction')
Line 57:  includeTests: !cliOptions.atlasNoTests,
```
The CLI flag exists and is already wired to `includeTests` (negated) in `AtlasGenerationOptions`. **Do not modify `analyze.ts`.** The work in this iteration is:
1. Add `excludeTests?: boolean` to `AtlasConfig` (complements existing `includeTests` in `AtlasGenerationOptions`)
2. Wire `excludeTests` through `parseProject → generateAtlas → excludePatterns` for belt-and-suspenders glob-level filtering
3. Verify existing `includeTests` flow also reaches `parseToRawData` correctly

**Files modified**:
- `src/plugins/golang/atlas/types.ts` — add `excludeTests?: boolean` to `AtlasConfig`
- `src/plugins/golang/atlas/index.ts` — extend `excludePatterns` in `generateAtlas()`
- `tests/plugins/golang/atlas/go-atlas-plugin.test.ts` — new tests

**TDD Story 1.1: AtlasConfig type**

```
🔴 Red: TypeScript compile error — `excludeTests` does not exist on `AtlasConfig`
```
```typescript
// Test: types compile correctly with new field
const config: AtlasConfig = { enabled: true, excludeTests: true };
```
```
🟢 Green: Add `excludeTests?: boolean` to AtlasConfig in atlas/types.ts
```

**TDD Story 1.2: excludePatterns extension in generateAtlas()**

```
🔴 Red: parseToRawData called with excludePatterns that does NOT include *_test.go
         even when options.excludeTests = true
```
```typescript
// tests/plugins/golang/atlas/go-atlas-plugin.test.ts
it('passes *_test.go to excludePatterns when excludeTests=true', async () => {
  const spy = vi.spyOn((plugin as any).goPlugin, 'parseToRawData');
  await plugin.generateAtlas('/some/path', { excludeTests: true });
  const callOptions = spy.mock.calls[0][1];
  expect(callOptions.excludePatterns).toContain('**/*_test.go');
});

it('does NOT add test patterns when excludeTests is falsy', async () => {
  const spy = vi.spyOn((plugin as any).goPlugin, 'parseToRawData');
  await plugin.generateAtlas('/some/path', {});
  const callOptions = spy.mock.calls[0][1];
  expect(callOptions.excludePatterns).not.toContain('**/*_test.go');
});
```
```
🟢 Green:
  // atlas/index.ts — generateAtlas()
  const rawData = await this.goPlugin.parseToRawData(rootPath, {
    workspaceRoot: rootPath,
    excludePatterns: [
      '**/vendor/**',
      '**/testdata/**',
      ...(options.excludeTests
        ? ['**/*_test.go', '**/tests/**', '**/testutil/**']
        : []),
    ],
    extractBodies: options.functionBodyStrategy !== 'none',
    selectiveExtraction: options.functionBodyStrategy === 'selective',
  });
```

**TDD Story 1.3: parseProject respects AtlasConfig.excludeTests**

```
🔴 Red: parseProject with atlas.excludeTests=true does not set excludeTests
         in the options passed to generateAtlas()
```
```typescript
it('passes excludeTests from AtlasConfig to generateAtlas', async () => {
  const spy = vi.spyOn(plugin, 'generateAtlas');
  await plugin.parseProject('/root', {
    languageSpecific: { atlas: { enabled: true, excludeTests: true } },
  });
  expect(spy.mock.calls[0][1]).toMatchObject({ excludeTests: true });
});
```
```
🟢 Green:
  // atlas/index.ts — parseProject()
  const atlas = await this.generateAtlas(workspaceRoot, {
    functionBodyStrategy: atlasConfig.functionBodyStrategy ?? 'selective',
    includeTests: atlasConfig.includeTests,
    excludeTests: atlasConfig.excludeTests,   // new
    entryPointTypes: atlasConfig.entryPointTypes,
    followIndirectCalls: atlasConfig.followIndirectCalls,
  });
```

**Acceptance criteria**:
- [ ] `AtlasConfig.excludeTests` field exists and is typed correctly
- [ ] `generateAtlas({ excludeTests: true })` → `excludePatterns` includes `**/*_test.go`
- [ ] `generateAtlas({})` → `excludePatterns` does NOT include test patterns
- [ ] `parseProject` with `atlas.excludeTests: true` propagates to `generateAtlas`
- [ ] All existing tests still pass

---

### Iteration 2 — Flow Layer: `flowchart LR` Redesign (P0)

**Objective**: Replace `sequenceDiagram` with `flowchart LR` in `renderFlowGraph()`. Group entry points by package directory into subgraphs. Handle `HandleFunc` label degradation (no HTTP method available).

**Files modified**:
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts` — rewrite `renderFlowGraph()`
- `src/plugins/golang/atlas/types.ts` — add `flowFormat?: 'flowchart' | 'sequence'` to `AtlasConfig`
- `tests/plugins/golang/atlas/mermaid-templates.test.ts` — new stories for Flow

**TDD Story 2.1: Basic flowchart output**

```
🔴 Red: renderFlowGraph() still returns string starting with 'sequenceDiagram'
```
```typescript
it('renders Flow graph as flowchart LR by default', () => {
  const graph: FlowGraph = {
    entryPoints: [
      {
        id: 'entry-1', type: 'http-get', path: '/products', handler: 'ListProducts',
        middleware: [], location: { file: 'pkg/catalog/routes.go', line: 10 },
      },
    ],
    callChains: [{ id: 'chain-1', entryPoint: 'entry-1', calls: [] }],
  };
  const result = MermaidTemplates.renderFlowGraph(graph);
  expect(result).toMatch(/^flowchart LR/);
  expect(result).not.toContain('sequenceDiagram');
});
```
```
🟢 Green: Restructure renderFlowGraph() — this is a full method rewrite, NOT a one-line change.
         The current implementation iterates `callChains` to find and render entries.
         The new implementation must iterate `entryPoints` as the primary loop for subgraph grouping,
         then reference `callChains` for edge rendering. Approximate structure:

           function renderFlowGraph(graph, format='flowchart'): string {
             if (format === 'sequence') return renderFlowGraphAsSequence(graph);  // Story 2.4
             const lines = ['flowchart LR'];
             // Group entryPoints by directory
             const groups = groupByDir(graph.entryPoints);
             for (const [dir, entries] of groups) {
               lines.push(`  subgraph ${sanitizeId(dir)}["${dir}"]`);
               for (const entry of entries) {
                 lines.push(`    ${sanitizeId(entry.id)}["${formatEntryLabel(entry)}"]`);
               }
               lines.push('  end');
             }
             // Render call edges from callChains
             for (const chain of graph.callChains) {
               for (const call of chain.calls) {
                 lines.push(`  ${sanitizeId(chain.entryPoint)} --> ${sanitizeId(call.to)}`);
               }
             }
             return lines.join('\n');
           }
```

**TDD Story 2.2: Subgraph grouping by package directory**

```
🔴 Red: multiple entry points from same directory not wrapped in a subgraph
```
```typescript
it('groups entry points by package directory into subgraphs', () => {
  const graph: FlowGraph = {
    entryPoints: [
      { id: 'e1', type: 'http-get',  path: '/a', handler: 'HandlerA', middleware: [],
        location: { file: 'pkg/catalog/routes.go', line: 5 } },
      { id: 'e2', type: 'http-post', path: '/b', handler: 'HandlerB', middleware: [],
        location: { file: 'pkg/catalog/routes.go', line: 10 } },
      { id: 'e3', type: 'http-get',  path: '/c', handler: 'HandlerC', middleware: [],
        location: { file: 'pkg/hub/server.go', line: 20 } },
    ],
    callChains: [],
  };
  const result = MermaidTemplates.renderFlowGraph(graph);
  // Two subgraphs: catalog and hub
  const subgraphMatches = result.match(/subgraph /g);
  expect(subgraphMatches).toHaveLength(2);
});
```
```
🟢 Green: Group entryPoints by path.dirname(location.file), emit one subgraph per group
```

**TDD Story 2.3: HandleFunc label degradation (no HTTP method)**

```
🔴 Red: HandleFunc-registered handler node label starts with a METHOD prefix
```
```typescript
it('omits METHOD prefix for http-handler type (HandleFunc)', () => {
  const graph: FlowGraph = {
    entryPoints: [
      { id: 'e1', type: 'http-handler', path: '/v1/sessions', handler: 'handleSessions',
        middleware: [], location: { file: 'pkg/hub/server.go', line: 5 } },
    ],
    callChains: [{ id: 'c1', entryPoint: 'e1', calls: [] }],
  };
  const result = MermaidTemplates.renderFlowGraph(graph);
  // Node label should be "/v1/sessions\nhandleSessions" — no "GET " or "POST " prefix
  expect(result).toContain('"/v1/sessions');
  expect(result).not.toMatch(/"(GET|POST|PUT|DELETE|PATCH) \/v1\/sessions/);
});

it('includes METHOD prefix for explicit http-get type (router.GET)', () => {
  const graph: FlowGraph = {
    entryPoints: [
      { id: 'e1', type: 'http-get', path: '/products', handler: 'ListProducts',
        middleware: [], location: { file: 'pkg/catalog/routes.go', line: 10 } },
    ],
    callChains: [{ id: 'c1', entryPoint: 'e1', calls: [] }],
  };
  const result = MermaidTemplates.renderFlowGraph(graph);
  expect(result).toContain('"GET /products');
});
```

**TDD Story 2.4: Backward compatibility via `--atlas-flow-format sequence`**

```
🔴 Red: renderFlowGraph() has no format parameter; old sequenceDiagram unavailable
```
```typescript
it('renders sequenceDiagram when format="sequence" is passed', () => {
  const graph: FlowGraph = { entryPoints: [], callChains: [] };
  const result = MermaidTemplates.renderFlowGraph(graph, 'sequence');
  expect(result).toMatch(/^sequenceDiagram/);
});
```
```
🟢 Green: Add format parameter: renderFlowGraph(graph, format: 'flowchart'|'sequence' = 'flowchart')
         Refactor old implementation into renderFlowGraphAsSequence()
         New default calls renderFlowGraphAsFlowchart()
```

**TDD Story 2.5: Output passes Mermaid parse validation**

```typescript
it('generated flowchart is valid Mermaid syntax (smoke test)', () => {
  // Use a known-good graph with multiple groups and one callchain
  const graph = buildFixtureFlowGraph();
  const mmd = MermaidTemplates.renderFlowGraph(graph);
  // Structural check: starts with flowchart, has subgraph...end pairs
  const subgraphCount = (mmd.match(/\bsubgraph\b/g) ?? []).length;
  const endCount = (mmd.match(/\bend\b/g) ?? []).length;
  expect(subgraphCount).toBe(endCount);
  expect(mmd).not.toContain('Note over :');   // old bug must not regress
});
```

**Acceptance criteria**:
- [ ] `renderFlowGraph()` default output starts with `flowchart LR`
- [ ] Entry points from same directory grouped in same `subgraph`
- [ ] `http-handler` type nodes have no METHOD prefix; `http-get` etc. have METHOD prefix
- [ ] `renderFlowGraph(graph, 'sequence')` still produces `sequenceDiagram` output
- [ ] `subgraph` and `end` counts are balanced in output
- [ ] `Note over :` never appears in output (regression guard)

---

### Iteration 3 — Flow Layer: Struct Method Handler Resolution (P1)

**Objective**: Fix `traceCallsFromEntry` to also search `pkg.structs[i].methods`, so handlers registered as receiver methods (e.g. `s.handleSessions`) produce non-empty call chains.

**Files modified**:
- `src/plugins/golang/atlas/builders/flow-graph-builder.ts`
- `tests/plugins/golang/atlas/flow-graph-builder.test.ts`

**Critical design note**: `FlowGraphBuilder.build(rawData)` detects entry points **internally** via
`detectEntryPoints(rawData)` — there is no way to inject entry points from outside. The rawData
must contain a HandleFunc registration call that references the struct method, so that
`detectEntryPoints` auto-generates the entry. The entry ID format is auto-generated as
`entry-{pkg.fullName}-{startLine}`.

**TDD Story 3.1: Method handler produces callchain**

```
🔴 Red: HandleFunc registers 's.handleSessions' (struct method), but traceCallsFromEntry
         only searches pkg.functions — struct method body is never found, callchain is empty
```
```typescript
it('traces calls from a struct method handler registered via HandleFunc', async () => {
  // rawData must contain: (1) a HandleFunc call that registers the method,
  // and (2) the struct definition with that method's body.
  // build() will: detectEntryPoints → find the HandleFunc → auto-generate entry ID
  //               traceCallsFromEntry → look up handler 's.handleSessions'
  const rawData: GoRawData = {
    moduleName: 'example.com/app',
    packages: [{
      name: 'hub', fullName: 'pkg/hub', sourceFiles: [],
      imports: [], functions: [{
        name: 'SetupRoutes',
        exported: true,
        parameters: [], returnTypes: [],
        location: { file: 'pkg/hub/server.go', startLine: 1, endLine: 15 },
        body: {
          // HandleFunc call at line 10 → detectEntryPoints generates entry ID 'entry-pkg/hub-10'
          calls: [{ functionName: 'HandleFunc',
                     args: ['/v1/sessions', 's.handleSessions'],
                     location: { file: 'pkg/hub/server.go', startLine: 10, endLine: 10 } }],
          goSpawns: [], channelOps: [],
        },
      }],
      structs: [{
        name: 'Server',
        packageName: 'pkg/hub',
        fields: [], embeddedTypes: [], exported: true,
        location: { file: 'pkg/hub/server.go', startLine: 20, endLine: 50 },
        methods: [{
          name: 'handleSessions',
          exported: false,
          parameters: [], returnTypes: [],
          location: { file: 'pkg/hub/server.go', startLine: 25, endLine: 35 },
          body: {
            calls: [{ functionName: 'CreateSession', packageName: 'engine',
                       location: { file: 'pkg/hub/server.go', startLine: 27, endLine: 27 } }],
            goSpawns: [], channelOps: [],
          },
        }],
      }],
      interfaces: [],
    }],
  };

  const builder = new FlowGraphBuilder();
  const result = await builder.build(rawData);

  // Entry ID is auto-generated by detectEntryPoints from the HandleFunc call at line 10
  const entry = result.entryPoints.find(e => e.handler?.endsWith('handleSessions'));
  expect(entry).toBeDefined();

  const chain = result.callChains.find(c => c.entryPoint === entry!.id);
  // With fix: struct method body is found → callchain has 1 call
  expect(chain?.calls).toHaveLength(1);
  expect(chain?.calls[0].to).toContain('CreateSession');
});
```

```
🔴 Red (regression): existing standalone function handler still works
```
```typescript
it('still traces calls from standalone function handlers', () => {
  // ... existing test pattern — ensure no regression
});
```

```
🟢 Green:
  private traceCallsFromEntry(rawData: GoRawData, entry: EntryPoint): CallEdge[] {
    const calls: CallEdge[] = [];
    if (!entry.handler) return calls;
    const handlerFnName = entry.handler.split('.').at(-1) ?? entry.handler;

    for (const pkg of rawData.packages) {
      // existing: standalone functions
      for (const func of pkg.functions) {
        if (func.name !== handlerFnName || !func.body) continue;
        calls.push(...this.extractCallEdges(func.body.calls, entry.handler));
      }
      // new: struct methods
      for (const struct of pkg.structs) {
        for (const method of struct.methods) {
          if (method.name !== handlerFnName || !method.body) continue;
          calls.push(...this.extractCallEdges(method.body.calls, entry.handler));
        }
      }
    }
    return calls;
  }
```

**TDD Story 3.2: extractCallEdges helper (refactor)**

The current `traceCallsFromEntry` inlines the edge-building logic. Extract it as a private helper to avoid duplication for the struct methods case:

```typescript
private extractCallEdges(calls: GoCallExpr[], fromName: string): CallEdge[] {
  return calls.map(call => ({
    from: fromName,
    to: call.packageName ? `${call.packageName}.${call.functionName}` : call.functionName,
    type: 'direct' as const,
    confidence: 0.7,
  }));
}
```

**Acceptance criteria**:
- [ ] Struct method handler → callchain is non-empty when method has `body.calls`
- [ ] Standalone function handler → unchanged behavior (regression test green)
- [ ] `extractCallEdges` helper extracted (no logic duplication)
- [ ] Fixture: `pkg/hub.Server.handleSessions` with 1 body call → chain has 1 `CallEdge`

---

### Iteration 4 — Goroutine: Node Naming Fix + sanitizeId Length Limit (P1)

**Objective**: Fix the goroutine node display name extraction. The original ID format is `pkg/hub.Server.run.spawn-42` (dot-separated, hyphen before line number). The v1.0 proposal used wrong regex `/_spawn_\d+$/` and `split('_')` — both fail on the actual format.

**Files modified**:
- `src/plugins/golang/atlas/renderers/mermaid-templates.ts` — fix `renderGoroutineTopology` display name logic + `sanitizeId` length limit
- `tests/plugins/golang/atlas/mermaid-templates.test.ts` — new Goroutine naming stories

**TDD Story 4.1: formatGoroutineName unit tests**

```
🔴 Red: name extraction function does not exist yet as a testable unit
```
```typescript
// Extract the logic into a private static method for testability
// Note: GoroutineNode.name is typed as `string` (not optional) — use '' for empty name
// to match production behavior. The private method accepts `name?: string` for test convenience.
describe('formatGoroutineName', () => {
  const fmt = (id: string, name: string = '') =>
    (MermaidTemplates as any).formatGoroutineName({ id, name });

  it('returns node.name directly when non-empty', () => {
    expect(fmt('any.id.spawn-5', 'myFunc')).toBe('myFunc');
  });

  it('extracts last two dot-parts before .spawn-N', () => {
    expect(fmt('pkg/hub.Server.run.spawn-42')).toBe('Server.run');
  });

  it('handles single-segment before spawn', () => {
    expect(fmt('pkg/hub.run.spawn-1')).toBe('hub.run');
  });

  it('handles anonymous goroutine (functionName=<anonymous>)', () => {
    expect(fmt('pkg/hub.main.spawn-3', '<anonymous>')).toBe('<anonymous>');
  });

  it('falls back to full id minus spawn when fewer than 2 parts', () => {
    expect(fmt('main.spawn-0')).toBe('main');
  });
});
```

```
🟢 Green:
  private static formatGoroutineName(node: { id: string; name?: string }): string {
    if (node.name) return node.name;
    // id format: "pkg/hub.Server.run.spawn-42"
    const withoutSpawn = node.id.replace(/\.spawn-\d+$/, '');
    const parts = withoutSpawn.split('.');
    if (parts.length >= 2) return parts.slice(-2).join('.');
    return parts[parts.length - 1] ?? node.id;
  }
```

**TDD Story 4.2: sanitizeId length limit**

```
🔴 Red: sanitizeId returns string longer than 64 chars for long IDs
```
```typescript
it('sanitizeId truncates to max 64 characters', () => {
  const longId = 'a'.repeat(100);
  const result = (MermaidTemplates as any).sanitizeId(longId);
  expect(result.length).toBeLessThanOrEqual(64);
});

it('sanitizeId replaces special chars with underscore', () => {
  expect((MermaidTemplates as any).sanitizeId('pkg/hub.Server')).toBe('pkg_hub_Server');
});
```

```
🟢 Green:
  private static sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
  }
```

**⚠️ Regression risk**: Adding `.slice(0, 64)` changes the output of `sanitizeId` for IDs longer
than 64 characters. After the Green phase, run:
```bash
npm test tests/plugins/golang/atlas/
```
Any test that matches a full sanitized ID longer than 64 characters will now fail. If failures
occur, update those test expectations to use `.slice(0, 64)` on the expected string, OR consider
adding the truncation only in the render path (not in `sanitizeId` itself) to avoid affecting
all callers.

**TDD Story 4.3: renderGoroutineTopology uses formatGoroutineName**

```
🔴 Red: goroutine node with empty name and long ID still renders with unreadable label
```
```typescript
it('renders goroutine node with extracted name when node.name is empty', () => {
  const topology: GoroutineTopology = {
    nodes: [{
      id: 'pkg/hub.Server.run.spawn-42',
      name: '',
      type: 'spawned',
      package: 'pkg/hub',
      location: { file: 'pkg/hub/server.go', line: 42 },
    }],
    edges: [], channels: [],
  };
  const result = MermaidTemplates.renderGoroutineTopology(topology);
  expect(result).toContain('"Server.run"');
  expect(result).not.toContain('[""]');  // regression: empty label must not appear
});
```

**Acceptance criteria**:
- [ ] `formatGoroutineName` correctly handles all 5 test cases above
- [ ] `sanitizeId` output ≤ 64 characters
- [ ] Goroutine nodes with empty `name` field show extracted function name, not empty string
- [ ] `[""]` label regression does not reappear

---

### Iteration 5 — Package: Edge Deduplication via `strength` (P1)

**Objective**: `PackageGraphBuilder.buildEdges()` currently emits one `PackageDependency` per import statement, causing duplicate edges between the same package pair. The template already supports `strength > 1` labels. Only the builder needs to change.

**Files modified**:
- `src/plugins/golang/atlas/builders/package-graph-builder.ts` — rewrite `buildEdges()` with `Map`
- `tests/plugins/golang/atlas/package-graph-builder.test.ts` — new dedup stories

**TDD Story 5.1: Multiple imports between same package pair → single edge with count**

```
🔴 Red: buildEdges returns 3 edges when same package is imported 3 times
```
```typescript
it('deduplicates edges and accumulates strength', () => {
  const rawData: GoRawData = {
    moduleName: 'example.com/app',
    packages: [{
      name: 'hub', fullName: 'pkg/hub', sourceFiles: [],
      imports: [
        { path: 'example.com/app/pkg/store', location: { file: 'a.go', startLine: 1, endLine: 1 } },
        { path: 'example.com/app/pkg/store', location: { file: 'b.go', startLine: 1, endLine: 1 } },
        { path: 'example.com/app/pkg/store', location: { file: 'c.go', startLine: 1, endLine: 1 } },
      ],
      functions: [], structs: [], interfaces: [],
    }],
  };

  const builder = new PackageGraphBuilder(mockGoModResolver);
  const { edges } = await builder.build(rawData);

  expect(edges).toHaveLength(1);
  expect(edges[0].strength).toBe(3);
});
```

```
🔴 Red: single import still gets strength=1 (should still work)
```
```typescript
it('single import gets strength=1', async () => {
  // ...single import fixture...
  expect(edges[0].strength).toBe(1);
});
```

```
🟢 Green:
  private buildEdges(rawData: GoRawData): PackageDependency[] {
    const edgeMap = new Map<string, { from: string; to: string; count: number }>();

    for (const pkg of rawData.packages) {
      const fromId = pkg.fullName ? `${rawData.moduleName}/${pkg.fullName}` : pkg.name;
      for (const imp of pkg.imports) {
        if (this.goModResolver.classifyImport(imp.path) === 'std') continue;
        const key = `${fromId}→${imp.path}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          edgeMap.set(key, { from: fromId, to: imp.path, count: 1 });
        }
      }
    }

    return [...edgeMap.values()].map(({ from, to, count }) => ({
      from, to, strength: count,
    }));
  }
```

**TDD Story 5.2: Mermaid output shows ref count label when strength > 1**

```typescript
it('renders |"3 refs"| label when strength=3', () => {
  // Template already has this logic; verify it still works with new builder output
  const graph: PackageGraph = {
    nodes: [
      { id: 'app/hub', name: 'pkg/hub', type: 'internal', fileCount: 1, stats: { structs: 0, interfaces: 0, functions: 0 } },
      { id: 'app/store', name: 'pkg/store', type: 'internal', fileCount: 1, stats: { structs: 0, interfaces: 0, functions: 0 } },
    ],
    edges: [{ from: 'app/hub', to: 'app/store', strength: 3 }],
    cycles: [],
  };
  const result = MermaidTemplates.renderPackageGraph(graph);
  expect(result).toContain('"3 refs"');
});
```

**Acceptance criteria**:
- [ ] 3 imports between same pair → 1 edge with `strength: 3`
- [ ] 1 import → 1 edge with `strength: 1`
- [ ] Mermaid output shows `|"3 refs"|` label when strength > 1
- [ ] No regression on cycle detection or node generation

---

### Iteration 6 — Capability: Wire InterfaceMatcher into BehaviorAnalyzer (P2)

**Objective**: `CapabilityGraphBuilder.buildEdges()` already reads `rawData.implementations` but it is never populated. Fix by calling `InterfaceMatcher.matchImplicitImplementations()` inside `BehaviorAnalyzer.buildCapabilityGraph()` when the field is absent.

**Files modified**:
- `src/plugins/golang/atlas/behavior-analyzer.ts` — add InterfaceMatcher call before builder
- `tests/plugins/golang/atlas/behavior-analyzer.test.ts` — new interface impl stories

**TDD Story 6.1: Fixture with interface + implementing struct produces implements edge**

```typescript
// tests/plugins/golang/atlas/behavior-analyzer.test.ts
it('generates implements edges when struct satisfies interface methods', async () => {
  const rawData: GoRawData = {
    moduleName: 'example.com/app',
    packages: [{
      name: 'store', fullName: 'pkg/store',
      sourceFiles: [], imports: [], functions: [],
      structs: [{
        name: 'InMemoryStore',
        packageName: 'pkg/store',
        fields: [], embeddedTypes: [], exported: true,
        location: { file: 'store.go', startLine: 1, endLine: 30 },
        methods: [
          { name: 'Get',  parameters: [], returnTypes: ['string'], exported: true,
            location: { file: 'store.go', startLine: 5, endLine: 8 } },
          { name: 'Set',  parameters: [], returnTypes: ['error'],  exported: true,
            location: { file: 'store.go', startLine: 10, endLine: 13 } },
        ],
      }],
      interfaces: [{
        name: 'Store',
        packageName: 'pkg/store',
        methods: [
          { name: 'Get', parameters: [], returnTypes: ['string'], exported: true,
            location: { file: 'store.go', startLine: 35, endLine: 35 } },
          { name: 'Set', parameters: [], returnTypes: ['error'],  exported: true,
            location: { file: 'store.go', startLine: 36, endLine: 36 } },
        ],
        embeddedInterfaces: [], exported: true,
        location: { file: 'store.go', startLine: 34, endLine: 37 },
      }],
    }],
  };

  const analyzer = new BehaviorAnalyzer(mockGoModResolver);
  const graph = await analyzer.buildCapabilityGraph(rawData);

  const implEdge = graph.edges.find(e => e.type === 'implements');
  expect(implEdge).toBeDefined();
  expect(implEdge?.source).toContain('InMemoryStore');
  expect(implEdge?.target).toContain('Store');
});
```

```
🔴 Red: no implements edge found (rawData.implementations never populated)
```

```
🟢 Green:
  // behavior-analyzer.ts
  async buildCapabilityGraph(rawData: GoRawData): Promise<CapabilityGraph> {
    // Populate implementations if not already provided
    // Note: rawData.implementations is already typed as InferredImplementation[] | undefined
    // in GoRawData — no type cast needed
    if (!rawData.implementations || rawData.implementations.length === 0) {
      const matcher = new InterfaceMatcher();
      const allStructs = rawData.packages.flatMap(p => p.structs);
      const allInterfaces = rawData.packages.flatMap(p => p.interfaces);
      rawData.implementations =
        matcher.matchImplicitImplementations(allStructs, allInterfaces);
    }
    return this.capabilityGraphBuilder.build(rawData);
  }
```

**TDD Story 6.2: Struct missing one method → no implements edge**

```typescript
it('does NOT generate implements edge when struct is missing an interface method', async () => {
  // InMemoryStore only has Get(), interface requires Get() + Set()
  // ...fixture with partial method match...
  const graph = await analyzer.buildCapabilityGraph(rawData);
  expect(graph.edges.filter(e => e.type === 'implements')).toHaveLength(0);
});
```

**TDD Story 6.3: Pre-populated implementations not overwritten**

```typescript
it('does not overwrite rawData.implementations if already populated', async () => {
  const prePopulated = [{ structName: 'A', interfaceName: 'B', confidence: 0.99,
    structPackageId: 'pkg', interfacePackageId: 'pkg', matchedMethods: [], source: 'gopls' }];
  rawData.implementations = prePopulated;
  const graph = await analyzer.buildCapabilityGraph(rawData);
  // Should still have the pre-populated impl
  expect(graph.edges.filter(e => e.type === 'implements')).toHaveLength(1);
});
```

**Acceptance criteria**:
- [ ] Fixture: `InMemoryStore` with `Get` + `Set` → 1 `implements` edge to `Store`
- [ ] Fixture: partial method match → 0 `implements` edges
- [ ] Pre-populated `rawData.implementations` not overwritten
- [ ] `matchImplicitImplementations` called only when `implementations` is absent/empty

---

### Iteration 7 — Capability: Extend `uses` Edges to Struct-Type Fields (P2)

**Objective**: `CapabilityGraphBuilder.buildEdges()` currently only creates `uses` edges for struct fields whose type is a known **interface** name. Extend to also create `uses` edges for fields whose type is a known **struct** name.

**Files modified**:
- `src/plugins/golang/atlas/builders/capability-graph-builder.ts` — one-line change in `buildEdges()`
- `tests/plugins/golang/atlas/capability-graph-builder.test.ts` — new struct-dep stories

**TDD Story 7.1: Struct field of struct type creates uses edge**

```typescript
it('generates uses edge when struct field type is another struct', async () => {
  const rawData: GoRawData = {
    moduleName: 'example.com/app',
    packages: [{
      name: 'hub', fullName: 'pkg/hub',
      sourceFiles: [], imports: [], functions: [],
      structs: [
        {
          name: 'Server',
          packageName: 'pkg/hub',
          exported: true,
          embeddedTypes: [],
          location: { file: 'server.go', startLine: 1, endLine: 20 },
          methods: [],
          fields: [{
            name: 'engine',
            type: 'Engine',         // ← another struct (not an interface)
            exported: false,
            location: { file: 'server.go', startLine: 3, endLine: 3 },
          }],
        },
        {
          name: 'Engine',
          packageName: 'pkg/hub',
          exported: true, embeddedTypes: [], methods: [], fields: [],
          location: { file: 'engine.go', startLine: 1, endLine: 10 },
        },
      ],
      interfaces: [],
    }],
  };

  const builder = new CapabilityGraphBuilder();
  const graph = await builder.build(rawData);

  const usesEdge = graph.edges.find(
    e => e.type === 'uses' && e.source.includes('Server') && e.target.includes('Engine')
  );
  expect(usesEdge).toBeDefined();
});
```

```
🔴 Red: 'Engine' not in allInterfaceNames → no uses edge generated
```

```
🟢 Green: one-line change in buildEdges()
  // Before:
  const allInterfaceNames = new Set(rawData.packages.flatMap(p => p.interfaces.map(i => i.name)));

  // After:
  const allKnownTypeNames = new Set([
    ...rawData.packages.flatMap(p => p.interfaces.map(i => i.name)),
    ...rawData.packages.flatMap(p => p.structs.map(s => s.name)),
  ]);

  // And replace allInterfaceNames.has(field.type) with allKnownTypeNames.has(field.type)
```

**⚠️ Known limitation**: `field.type` contains the simple type name (e.g., `"Engine"`) as parsed
from Go AST, while the capability graph node IDs use fully-qualified names (e.g., `"pkg/hub.Engine"`).
This means the `uses` edge target will not match any existing node — Mermaid will render it as a
dangling edge, implicitly creating an orphan node. This is the same pre-existing inconsistency that
exists for interface-typed fields. Resolving this requires a `type → nodeId` lookup map (deferred
to a future iteration). Add a TODO comment in the implementation:
```typescript
// TODO: field.type is the simple name ('Engine'), not the fully-qualified node ID ('pkg/hub.Engine').
// This creates dangling edges. Fix requires building a typeSimpleName→nodeId lookup map.
```

**TDD Story 7.2: Interface field still creates uses edge (regression)**

```typescript
it('still generates uses edge for interface-typed fields (regression)', async () => {
  // existing behavior must not regress
  // ... fixture where field type is an interface name ...
  const usesEdge = graph.edges.find(e => e.type === 'uses');
  expect(usesEdge).toBeDefined();
});
```

**TDD Story 7.3: Unknown type (primitive / external) does NOT create edge**

```typescript
it('does NOT generate uses edge for primitive or external type fields', async () => {
  // field.type = 'string' or 'time.Duration' — not in allKnownTypeNames
  const graph = await builder.build(rawData);
  const spuriousEdges = graph.edges.filter(e => e.type === 'uses');
  expect(spuriousEdges).toHaveLength(0);
});
```

**Acceptance criteria**:
- [ ] Struct field with struct type → `uses` edge created
- [ ] Struct field with interface type → `uses` edge still created (regression)
- [ ] Primitive / external type fields → no edge
- [ ] Change is a single `allKnownTypeNames` set construction (no architectural change)

---

## 3. Fixture Project Requirements

All acceptance tests must be based on self-contained fixtures in `tests/fixtures/go/`. Do not depend on `codex-swarm` or any external project.

### Required Fixtures

| Fixture Directory | Purpose | Iterations |
|-------------------|---------|-----------|
| `tests/fixtures/go/exclude-tests/` | Package with `*_test.go` files to verify filter | Iter 1 |
| `tests/fixtures/go/flow-routes/` | Multiple packages with HTTP routes (HandleFunc + router.GET) | Iter 2 |
| `tests/fixtures/go/method-handler/` | Struct receiver method registered as HTTP handler | Iter 3 |
| `tests/fixtures/go/interface-impl/` | Interface + implementing struct (full method set match) | Iter 6 |
| `tests/fixtures/go/struct-deps/` | Struct with fields referencing other structs | Iter 7 |

Fixtures are minimal Go source snippets (not compilable projects), used only for AST parsing in tests.

---

## 4. Implementation Order and Dependencies

```
Iteration 1 (P0) ─────────────────────────────────┐
  excludeTests filter                               │ Can run in parallel
Iteration 2 (P0) ─────────────────────────────────┘ (Iter 2 modifies mermaid-templates.ts,
  Flow flowchart LR                                   Iter 3 modifies flow-graph-builder.ts
                                                      — different files, no dependency)
Iteration 3 (P1) ─────────────────────────────────┐
  Flow struct method handler fix                   │ Can all run in parallel
Iteration 4 (P1) ─────────────────────────────────┤ (all modify independent files)
  Goroutine naming fix                             │
Iteration 5 (P1) ─────────────────────────────────┘
  Package edge dedup

Iteration 6 (P2) ← independent
  Capability InterfaceMatcher wiring               │ Can run in parallel
Iteration 7 (P2) ─────────────────────────────────┘
  Capability struct field uses
```

**Recommended execution sequence**:
1. Iterations 1 + 2 in parallel (P0, highest impact)
2. Iterations 3 + 4 + 5 in parallel (P1, all independent — Iter 3 does NOT depend on Iter 2)
3. Iterations 6 + 7 in parallel (P2, fully independent)

---

## 5. Testing Approach

### TDD Cycle for Each Iteration

```
1. Write failing test (🔴 Red)
2. Run: npm test — confirm failure
3. Write minimum implementation (🟢 Green)
4. Run: npm test — confirm all pass
5. Refactor if needed (♻️ Refactor)
6. Run: npm test — confirm still green
```

### Regression Safety Net

Before starting each iteration, run:
```bash
npm test -- --reporter=verbose 2>&1 | tail -5
# Expected: 1331 passed (or higher from previous iterations)
```

After each iteration, run:
```bash
npm test
npm run type-check
npm run lint
```

### Self-validation After All Iterations

```bash
npm run build
node dist/cli/index.js analyze -s /home/yale/work/codex-swarm \
  --lang go --atlas --atlas-no-tests -v

# Expected:
#   ✅ package: archguard/architecture-package.mmd (nodes ≤ 28)
#   ✅ capability: archguard/architecture-capability.mmd (implements > 0)
#   ✅ goroutine: archguard/architecture-goroutine.mmd + .png (no pixel error)
#   ✅ flow: archguard/architecture-flow.mmd (starts with flowchart LR)
```

---

## 6. Acceptance Checklist

### Phase 1 (P0) — Gate for merging to master

- [ ] **Iter 1**: `AtlasConfig.excludeTests` exists and propagates through `parseProject → generateAtlas → excludePatterns`
- [ ] **Iter 2**: `renderFlowGraph()` default output is `flowchart LR` with `subgraph` grouping
- [ ] **Iter 2**: `HandleFunc` handler nodes have no METHOD prefix
- [ ] **Iter 2**: `renderFlowGraph(graph, 'sequence')` still works
- [ ] All 1331+ tests pass, no type errors, no lint errors

### Phase 2 (P1) — Quality milestone

- [ ] **Iter 3**: Struct method handler produces non-empty `callChains.calls`
- [ ] **Iter 4**: Goroutine node display name is `"Receiver.method"` not `""`
- [ ] **Iter 4**: `sanitizeId` output is ≤ 64 characters
- [ ] **Iter 5**: Same package pair has exactly 1 edge; `strength` reflects import count
- [ ] Self-validation: `--atlas-no-tests` reduces Package nodes on codex-swarm from 38 to ≤ 28

### Phase 3 (P2) — Completeness milestone

- [ ] **Iter 6**: `implements` edges appear in Capability graph for fixture with matching method sets
- [ ] **Iter 6**: Pre-populated `rawData.implementations` not overwritten
- [ ] **Iter 7**: Struct-type fields generate `uses` edges
- [ ] **Iter 7**: Primitive/external type fields do NOT generate `uses` edges
- [ ] Self-validation: codex-swarm Capability `implements` edges > 0

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `excludePatterns` not implemented inside `parseToRawData` | Low | High | Verify `GoPlugin.parseToRawData` parameter contract before starting Iter 1 |
| Flow subgraph grouping by `path.dirname` fails on Windows paths | Low | Low | Use `path.posix` or normalize separators |
| `matchImplicitImplementations` across packages produces false positives (same struct name in different packages) | Medium | Medium | Add `structPackageId` comparison in duplicate-removal step |
| `sanitizeId` truncation breaks existing atlas tests that match full-length IDs | Medium | Medium | Run `npm test tests/plugins/golang/atlas/` immediately after Iter 4 Green; update test expectations or move truncation to render path only |
| Goroutine `sanitizeId` truncation causes ID collision | Low | Low | Append `_${line}` suffix when truncated IDs collide |
| New fixture files cause `vitest.config.ts` exclusion issues | Low | Low | Verify fixture path is not in `exclude` patterns |

---

## 8. Related Documents

- [Proposal 17 v1.1](../proposals/17-go-atlas-quality-improvements.md) — Source proposal with root cause analysis
- [Plan 16](./16-go-architecture-atlas-implementation-plan.md) — Atlas implementation (prerequisite)
- [Proposal 16](../proposals/16-go-architecture-atlas.md) — Atlas original design

---

## 9. Commit Strategy

Each iteration = one focused commit (or two commits if Red and Green phases are large):

```
fix(atlas): add excludeTests filter to suppress test noise in all layers
fix(flow-graph): replace sequenceDiagram with flowchart LR + service subgraphs
fix(flow-graph): trace handler calls from struct methods not just functions
fix(goroutine): correct node name extraction from .spawn-N ID format
fix(package-graph): deduplicate edges by accumulating strength count
feat(capability): wire InterfaceMatcher to populate implements edges
fix(capability): extend uses edges to cover struct-type fields
```
