import { describe, it, expect } from 'vitest';
import { MermaidTemplates } from '@/plugins/golang/atlas/renderers/mermaid-templates.js';
import type { FlowGraph, EntryPoint, GoroutineTopology, GoroutineNode, SpawnRelation, ChannelInfo, ChannelEdge, PackageGraph, PackageNode } from '@/types/extensions.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<EntryPoint> & { id: string }): EntryPoint {
  return {
    type: 'http-get',
    path: '/api/resource',
    handler: 'pkg.Handler',
    middleware: [],
    location: { file: '/srv/api/handler.go', line: 10 },
    ...overrides,
  };
}

function makeFlowGraph(entries: EntryPoint[], callChains = []): FlowGraph {
  return { entryPoints: entries, callChains };
}

function makePackageGraph(overrides?: Partial<PackageGraph>): PackageGraph {
  return { nodes: [], edges: [], cycles: [], ...overrides };
}

// ─── renderFlowGraph — flowchart LR (default) ─────────────────────────────────

describe('MermaidTemplates.renderFlowGraph (flowchart)', () => {
  it('starts with "flowchart LR"', () => {
    const graph = makeFlowGraph([makeEntry({ id: 'ep1' })]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result).toMatch(/^flowchart LR\n/);
  });

  it('renders entry point nodes inside a subgraph keyed by directory', () => {
    const entry = makeEntry({ id: 'ep1', location: { file: '/srv/api/handler.go', line: 5 } });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    // Subgraph label should contain the directory
    expect(result).toContain('/srv/api');
    // Node id should appear
    expect(result).toContain('ep1');
  });

  it('groups entries from the same directory into one subgraph', () => {
    const e1 = makeEntry({ id: 'ep1', location: { file: '/srv/api/a.go', line: 1 } });
    const e2 = makeEntry({ id: 'ep2', location: { file: '/srv/api/b.go', line: 2 } });
    const graph = makeFlowGraph([e1, e2]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    // Only one subgraph for /srv/api
    const subgraphMatches = result.match(/subgraph /g);
    expect(subgraphMatches).toHaveLength(1);
  });

  it('puts entries from different directories in separate subgraphs', () => {
    const e1 = makeEntry({ id: 'ep1', location: { file: '/srv/api/a.go', line: 1 } });
    const e2 = makeEntry({
      id: 'ep2',
      location: { file: '/srv/grpc/b.go', line: 2 },
      type: 'grpc-unary',
      path: '/pkg.Svc/Method',
    });
    const graph = makeFlowGraph([e1, e2]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    const subgraphMatches = result.match(/subgraph /g);
    expect(subgraphMatches).toHaveLength(2);
  });

  it('renders empty graph with just "flowchart LR"', () => {
    const graph = makeFlowGraph([]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result.trim()).toBe('flowchart LR');
  });
});

// ─── renderFlowGraph — sequence (legacy mode) ─────────────────────────────────

describe('MermaidTemplates.renderFlowGraph (sequence)', () => {
  it('starts with "sequenceDiagram" when format is sequence', () => {
    const graph = makeFlowGraph([]);
    const result = MermaidTemplates.renderFlowGraph(graph, 'sequence');
    expect(result).toMatch(/^sequenceDiagram\n/);
  });

  it('emits Note over handler with path label', () => {
    const entry = makeEntry({ id: 'ep1', handler: 'myHandler', path: '/users' });
    const graph: FlowGraph = {
      entryPoints: [entry],
      callChains: [{ id: 'chain1', entryPoint: 'ep1', calls: [] }],
    };
    const result = MermaidTemplates.renderFlowGraph(graph, 'sequence');
    expect(result).toContain('Note over myHandler');
    expect(result).toContain('/users');
  });
});

// ─── formatEntryLabel ─────────────────────────────────────────────────────────

describe('formatEntryLabel (via renderFlowGraph node labels)', () => {
  it('http-handler type uses only the path — no METHOD prefix', () => {
    const entry = makeEntry({ id: 'ep1', type: 'http-handler', path: '/api/users' });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    // Label should be exactly the path, not "HTTP-HANDLER /api/users"
    expect(result).toContain('"/api/users"');
    expect(result).not.toContain('HTTP-HANDLER');
  });

  it('http-get type uses "GET /path" format', () => {
    const entry = makeEntry({ id: 'ep1', type: 'http-get', path: '/api/users' });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result).toContain('"GET /api/users"');
  });

  it('http-post type uses "POST /path" format', () => {
    const entry = makeEntry({ id: 'ep2', type: 'http-post', path: '/api/items' });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result).toContain('"POST /api/items"');
  });

  it('http-delete type uses "DELETE /path" format', () => {
    const entry = makeEntry({ id: 'ep3', type: 'http-delete', path: '/api/items/1' });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result).toContain('"DELETE /api/items/1"');
  });

  it('grpc-unary type uses "GRPC /path" format', () => {
    const entry = makeEntry({ id: 'ep4', type: 'grpc-unary', path: '/pkg.Svc/Call' });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result).toContain('"GRPC /pkg.Svc/Call"');
  });
});

// ─── formatGoroutineName ──────────────────────────────────────────────────────

describe('MermaidTemplates (private) formatGoroutineName', () => {
  const fn = (node: { id: string; name: string }) =>
    (MermaidTemplates as any).formatGoroutineName(node);

  it('returns node.name when it is non-empty', () => {
    expect(fn({ id: 'main.worker.spawn-3', name: 'myGoroutine' })).toBe('myGoroutine');
  });

  it('strips .spawn-N suffix and returns last 2 dot-parts when name is empty', () => {
    // main.worker.spawn-3 → strip .spawn-3 → main.worker → last 2 → main.worker
    expect(fn({ id: 'main.worker.spawn-3', name: '' })).toBe('main.worker');
  });

  it('strips package path prefix from id when name is empty', () => {
    // "examples/user-service.main.spawn-25" → strip spawn → "examples/user-service.main"
    // → strip before last '/' → "user-service.main" → last 2 parts → "user-service.main"
    expect(fn({ id: 'examples/user-service.main.spawn-25', name: '' })).toBe('user-service.main');
  });

  it('strips path prefix from slashed id with method spawn', () => {
    // "cmd/swarm-mcp.startTestWorkersParallel.spawn-283" → "swarm-mcp.startTestWorkersParallel"
    expect(fn({ id: 'cmd/swarm-mcp.startTestWorkersParallel.spawn-283', name: '' })).toBe('swarm-mcp.startTestWorkersParallel');
  });

  it('handles id with no spawn suffix — returns last 2 parts', () => {
    expect(fn({ id: 'pkg.subpkg.handler', name: '' })).toBe('subpkg.handler');
  });

  it('handles short id with only one part', () => {
    expect(fn({ id: 'worker', name: '' })).toBe('worker');
  });

  it('handles two-part id', () => {
    expect(fn({ id: 'main.run', name: '' })).toBe('main.run');
  });

  it('strips package path prefix (slash) from non-empty name', () => {
    // "examples/user-service.NewTestHarness" → "NewTestHarness"
    expect(fn({ id: 'examples_user_service_NewTestHarness_spawn_43', name: 'examples/user-service.NewTestHarness' })).toBe('NewTestHarness');
  });

  it('leaves name unchanged when it contains no slash', () => {
    // "WorkerPool.Start" → "WorkerPool.Start" (unchanged)
    expect(fn({ id: 'pkg_hub_WorkerPool_Start_spawn_98', name: 'WorkerPool.Start' })).toBe('WorkerPool.Start');
  });

  it('strips slash prefix from cmd package main name', () => {
    // "cmd/swarm-hub.main" → "swarm-hub.main"
    expect(fn({ id: 'cmd_swarm_hub_main', name: 'cmd/swarm-hub.main' })).toBe('swarm-hub.main');
  });
});

// ─── sanitizeId ───────────────────────────────────────────────────────────────

describe('MermaidTemplates (private) sanitizeId', () => {
  const fn = (id: string) => (MermaidTemplates as any).sanitizeId(id);

  it('replaces non-alphanumeric/underscore characters with underscores', () => {
    expect(fn('foo.bar/baz')).toBe('foo_bar_baz');
  });

  it('truncates result to 64 characters for a 100-char input', () => {
    const long = 'a'.repeat(100);
    const result = fn(long);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.length).toBe(64);
  });

  it('returns string as-is when already valid and short', () => {
    expect(fn('validId_123')).toBe('validId_123');
  });

  it('truncates sanitized result with special chars to ≤ 64 chars', () => {
    const long = 'a-'.repeat(50); // 100 chars, all hyphens become underscores
    const result = fn(long);
    expect(result.length).toBeLessThanOrEqual(64);
  });
});

// ─── renderPackageGraph ───────────────────────────────────────────────────────

describe('MermaidTemplates.renderPackageGraph', () => {
  it('emits classDef for all node roles', () => {
    const graph = makePackageGraph();
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).toContain('classDef internal');
    expect(result).toContain('classDef cmd');
    expect(result).toContain('classDef tests');
    expect(result).toContain('classDef examples');
    expect(result).toContain('classDef testutil');
    expect(result).toContain('classDef vendor');
    expect(result).toContain('classDef external');
    expect(result).toContain('classDef cycle');
  });

  it('applies node.type as CSS class', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 3 } as PackageNode,
        { id: 'cmd/server', name: 'cmd/server', type: 'cmd', fileCount: 1 } as PackageNode,
      ],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).toMatch(/pkg_hub\["pkg\/hub"\]:::internal/);
    expect(result).toMatch(/cmd_server\["cmd\/server"\]:::cmd/);
  });
});

// ─── renderPackageGraph — cycles (P2) ────────────────────────────────────────

describe('MermaidTemplates.renderPackageGraph — cycles', () => {
  it('renders self-loop edge as dashed arrow with warning label', () => {
    const graph = makePackageGraph({
      nodes: [{ id: 'pkg/runtime', name: 'pkg/runtime', type: 'internal', fileCount: 2 }],
      edges: [{ from: 'pkg/runtime', to: 'pkg/runtime', strength: 1 }],
      cycles: [{ packages: ['pkg/runtime'], severity: 'warning' }],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).toContain('pkg_runtime -.->|"⚠ self"| pkg_runtime');
    expect(result).not.toMatch(/pkg_runtime --> pkg_runtime/);
  });

  it('applies :::cycle to nodes in a multi-package cycle', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'pkg/a', name: 'pkg/a', type: 'internal', fileCount: 1 },
        { id: 'pkg/b', name: 'pkg/b', type: 'internal', fileCount: 1 },
      ],
      edges: [
        { from: 'pkg/a', to: 'pkg/b', strength: 1 },
        { from: 'pkg/b', to: 'pkg/a', strength: 1 },
      ],
      cycles: [{ packages: ['pkg/a', 'pkg/b'], severity: 'error' }],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).toMatch(/pkg_a\[.*\]:::cycle/);
    expect(result).toMatch(/pkg_b\[.*\]:::cycle/);
  });

  it('does not apply :::cycle to self-loop nodes', () => {
    const graph = makePackageGraph({
      nodes: [{ id: 'pkg/runtime', name: 'pkg/runtime', type: 'internal', fileCount: 2 }],
      edges: [{ from: 'pkg/runtime', to: 'pkg/runtime', strength: 1 }],
      cycles: [{ packages: ['pkg/runtime'], severity: 'warning' }],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).not.toMatch(/pkg_runtime\[.*\]:::cycle/);
    expect(result).toMatch(/pkg_runtime\[.*\]:::internal/);
  });
});

// ─── renderPackageGraph — subgraph grouping (P3) ─────────────────────────────

describe('MermaidTemplates.renderPackageGraph — subgraph grouping', () => {
  interface GroupNode {
    prefix: string;
    children: GroupNode[];
    nodeIds: string[];
  }
  const buildGroupTree = (nodes: PackageNode[]) =>
    (MermaidTemplates as any).buildGroupTree(nodes) as { roots: GroupNode[]; grouped: Set<string> };

  it('wraps grouped nodes in subgraph blocks using grp_ prefix', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'mod/pkg/hub',        name: 'pkg/hub',        type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
      ],
      edges: [],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(result).toContain('end');
    expect(result).toContain('mod_pkg_hub["pkg/hub"]:::internal');
    expect(result).not.toMatch(/subgraph mod_pkg_hub/);
  });

  it('emits single-member packages as top-level nodes without subgraph', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 2 },
      ],
      edges: [],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    expect(result).not.toContain('subgraph');
    expect(result).toContain('mod_pkg_store["pkg/store"]:::internal');
  });

  it('emits all edges after all subgraph blocks', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'mod/pkg/hub',   name: 'pkg/hub',   type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/hub/m', name: 'pkg/hub/m', type: 'internal', fileCount: 1 },
      ],
      edges: [{ from: 'mod/pkg/hub', to: 'mod/pkg/hub/m', strength: 3 }],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    const subgraphEnd = result.lastIndexOf('end');
    const edgeLine   = result.indexOf('mod_pkg_hub -->');
    expect(edgeLine).toBeGreaterThan(subgraphEnd);
  });

  it('renders nested subgraphs: grp_pkg contains grp_pkg_hub', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'mod/pkg/hub',        name: 'pkg/hub',        type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/store',      name: 'pkg/store',      type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/logging',    name: 'pkg/logging',    type: 'internal', fileCount: 1 },
      ],
      edges: [],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    // Outer subgraph exists
    expect(result).toContain('subgraph grp_pkg["pkg"]');
    // Inner subgraph exists
    expect(result).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    // pkg/hub node is inside the inner subgraph (appears somewhere in result)
    expect(result).toContain('mod_pkg_hub["pkg/hub"]:::internal');
    // pkg/store and pkg/logging are direct children of grp_pkg (appear in result)
    expect(result).toContain('mod_pkg_store["pkg/store"]:::internal');
    // The inner subgraph appears after the outer subgraph opening
    const innerEnd = result.indexOf('subgraph grp_pkg_hub');
    const outerEnd = result.indexOf('subgraph grp_pkg["pkg"]');
    expect(innerEnd).toBeGreaterThan(outerEnd);
  });
});

// ─── buildGroupTree ───────────────────────────────────────────────────────────

describe('MermaidTemplates (private) buildGroupTree', () => {
  interface GroupNode {
    prefix: string;
    children: GroupNode[];
    nodeIds: string[];
  }
  const buildGroupTree = (nodes: PackageNode[]) =>
    (MermaidTemplates as any).buildGroupTree(nodes) as { roots: GroupNode[]; grouped: Set<string> };

  it('assigns cmd/* nodes to a single-level cmd group', () => {
    const nodes: PackageNode[] = [
      { id: 'mod/cmd/server', name: 'cmd/server', type: 'cmd', fileCount: 1 },
      { id: 'mod/cmd/worker', name: 'cmd/worker', type: 'cmd', fileCount: 1 },
    ];
    const { roots, grouped } = buildGroupTree(nodes);
    expect(roots).toHaveLength(1);
    expect(roots[0].prefix).toBe('cmd');
    expect(roots[0].children).toHaveLength(0);
    expect(roots[0].nodeIds).toHaveLength(2);
    expect(grouped.size).toBe(2);
  });

  it('builds a two-level tree: pkg contains pkg/hub sub-group', () => {
    const nodes: PackageNode[] = [
      { id: 'mod/pkg/hub',        name: 'pkg/hub',        type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/store',  name: 'pkg/hub/store',  type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/store',      name: 'pkg/store',      type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/logging',    name: 'pkg/logging',    type: 'internal', fileCount: 1 },
    ];
    const { roots, grouped } = buildGroupTree(nodes);
    // One root: pkg
    expect(roots).toHaveLength(1);
    const pkgRoot = roots[0];
    expect(pkgRoot.prefix).toBe('pkg');
    // pkg has one child: pkg/hub
    expect(pkgRoot.children).toHaveLength(1);
    expect(pkgRoot.children[0].prefix).toBe('pkg/hub');
    // pkg/hub has 3 direct nodes (pkg/hub itself + models + store)
    expect(pkgRoot.children[0].nodeIds).toHaveLength(3);
    // pkg has 2 direct nodes: pkg/store, pkg/logging
    expect(pkgRoot.nodeIds).toHaveLength(2);
    // All 5 nodes are grouped
    expect(grouped.size).toBe(5);
  });

  it('pkg/hub node belongs to pkg/hub group, not to pkg directly', () => {
    const nodes: PackageNode[] = [
      { id: 'mod/pkg/hub',        name: 'pkg/hub',        type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/store',      name: 'pkg/store',      type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/logging',    name: 'pkg/logging',    type: 'internal', fileCount: 1 },
    ];
    const { roots } = buildGroupTree(nodes);
    const pkgRoot = roots[0];
    const hubGroup = pkgRoot.children.find(c => c.prefix === 'pkg/hub')!;
    // mod/pkg/hub node is in pkg/hub group
    expect(hubGroup.nodeIds).toContain('mod/pkg/hub');
    // Not in pkg directly
    expect(pkgRoot.nodeIds).not.toContain('mod/pkg/hub');
  });

  it('does not group a single-member package', () => {
    const nodes: PackageNode[] = [
      { id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 1 },
    ];
    const { roots, grouped } = buildGroupTree(nodes);
    expect(roots).toHaveLength(0);
    expect(grouped.size).toBe(0);
  });
});

// ─── renderGoroutineTopology — integration with formatGoroutineName ───────────

describe('MermaidTemplates.renderGoroutineTopology — goroutine name display', () => {
  function makeTopology(overrides?: Partial<GoroutineTopology>): GoroutineTopology {
    return { nodes: [], edges: [], channels: [], channelEdges: [], ...overrides };
  }

  it('uses node.name as display label when it is set', () => {
    const topology = makeTopology({
      nodes: [{ id: 'main.worker.spawn-2', name: 'myWorker', type: 'spawned', pattern: undefined }],
    });
    const result = MermaidTemplates.renderGoroutineTopology(topology);
    expect(result).toContain('"myWorker"');
    expect(result).not.toContain('main.worker');
  });

  it('derives display label from id when name is empty', () => {
    const topology = makeTopology({
      nodes: [{ id: 'main.worker.spawn-2', name: '', type: 'spawned', pattern: undefined }],
    });
    const result = MermaidTemplates.renderGoroutineTopology(topology);
    // Should show last 2 parts after stripping spawn suffix: main.worker
    expect(result).toContain('"main.worker"');
  });
});

// ─── formatChannelLabel ──────────────────────────────────────────────────────

describe('MermaidTemplates (private) formatChannelLabel', () => {
  const fn = (id: string) => (MermaidTemplates as any).formatChannelLabel(id);

  it('extracts package short name from standard channel id', () => {
    expect(fn('chan-pkg/hub-114')).toBe('hub');
  });

  it('handles hyphenated package name', () => {
    expect(fn('chan-cmd/swarm-mcp-278')).toBe('swarm-mcp');
  });

  it('handles top-level package without slash', () => {
    expect(fn('chan-main-42')).toBe('main');
  });

  it('returns id as-is when no chan- prefix', () => {
    expect(fn('ch1')).toBe('ch1');
  });
});

// ─── renderGoroutineTopology — spawner node declarations ──────────────────────

describe('MermaidTemplates.renderGoroutineTopology — spawner node declarations', () => {
  function makeTopology(overrides?: Partial<{ nodes: GoroutineNode[]; edges: SpawnRelation[]; channels: ChannelInfo[]; channelEdges: ChannelEdge[] }>) {
    return { nodes: [], edges: [], channels: [], channelEdges: [], ...overrides };
  }

  it('declares undeclared spawner nodes with short labels and :::spawner style', () => {
    // edge.from = "pkg/hub.WorkerPool.Start" is NOT in nodes — must be declared
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-98',
          name: '<anonymous>',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 98 },
        },
      ],
      edges: [
        {
          from: 'pkg/hub.WorkerPool.Start',
          to: 'pkg/hub.WorkerPool.Start.spawn-98',
          spawnType: 'go-stmt' as const,
        },
      ],
    });

    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // spawner node should be declared with short label
    expect(out).toContain('["WorkerPool.Start"]');
    expect(out).toContain(':::spawner');
  });

  it('does NOT re-declare spawner when it is already in nodes list', () => {
    // edge.from = "cmd/app.main" IS in nodes (as main type)
    const topology = makeTopology({
      nodes: [
        {
          id: 'cmd/app.main',
          name: 'cmd/app.main',
          type: 'main' as const,
          package: 'cmd/app',
          location: { file: 'main.go', line: 1 },
        },
        {
          id: 'cmd/app.main.spawn-10',
          name: 'worker',
          type: 'spawned' as const,
          package: 'cmd/app',
          location: { file: 'main.go', line: 10 },
        },
      ],
      edges: [
        {
          from: 'cmd/app.main',
          to: 'cmd/app.main.spawn-10',
          spawnType: 'go-stmt' as const,
        },
      ],
    });

    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // "cmd_app_main" should appear exactly ONCE as a node declaration (the :::main one)
    const lines = out.split('\n').filter(l => l.includes('cmd_app_main['));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(':::main');
    expect(lines[0]).not.toContain(':::spawner');
  });

  it('includes classDef for spawner style', () => {
    const topology = makeTopology({
      nodes: [{ id: 'spawn1', name: 'fn', type: 'spawned' as const, package: 'p', location: { file: 'f.go', line: 1 } }],
      edges: [{ from: 'undeclared_spawner', to: 'spawn1', spawnType: 'go-stmt' as const }],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('classDef spawner');
  });

  // P1: package subgraphs
  it('groups nodes with same package into a subgraph', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-98',
          name: 'WorkerPool.Start',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 98 },
        },
        {
          id: 'pkg/hub.WorkerPool.Stop.spawn-115',
          name: 'WorkerPool.Stop',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 115 },
        },
      ],
      edges: [],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    // Both nodes should be inside the subgraph
    expect(out).toContain('"WorkerPool.Start"');
    expect(out).toContain('"WorkerPool.Stop"');
  });

  it('puts nodes from different packages into different subgraphs', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-98',
          name: 'WorkerPool.Start',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 98 },
        },
        {
          id: 'pkg/preflight.Checker.Check.spawn-199',
          name: 'Checker.Check',
          type: 'spawned' as const,
          package: 'pkg/preflight',
          location: { file: 'checker.go', line: 199 },
        },
      ],
      edges: [],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(out).toContain('subgraph grp_pkg_preflight["pkg/preflight"]');
  });

  it('places spawner in the same subgraph as its spawned node', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-98',
          name: '<anonymous>',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 98 },
        },
      ],
      edges: [
        {
          from: 'pkg/hub.WorkerPool.Start',
          to: 'pkg/hub.WorkerPool.Start.spawn-98',
          spawnType: 'go-stmt' as const,
        },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // Find the pkg/hub subgraph block
    const lines = out.split('\n');
    const sgStart = lines.findIndex(l => l.includes('grp_pkg_hub'));
    const sgEnd = lines.findIndex((l, i) => i > sgStart && l.trim() === 'end');
    const sgContent = lines.slice(sgStart, sgEnd).join('\n');
    expect(sgContent).toContain('["WorkerPool.Start"]:::spawner');
  });

  it('renders node with empty package at top-level, not in a subgraph', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'orphan.spawn-1',
          name: 'orphan',
          type: 'spawned' as const,
          package: '' as any,
          location: { file: 'x.go', line: 1 },
        },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).not.toContain('subgraph grp_');
    expect(out).toContain('"orphan"');
  });

  // P2: channel labels
  it('shows package short name for generic "chan" type channels', () => {
    const topology = makeTopology({
      channels: [
        {
          id: 'chan-pkg/hub-114',
          name: 'jobs',
          type: 'chan',
          direction: 'bidirectional' as const,
          location: { file: 'hub.go', line: 114 },
        },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('"hub"');
    expect(out).not.toContain('[("chan")]');
  });

  it('preserves rich channel type when not generic "chan"', () => {
    const topology = makeTopology({
      channels: [
        {
          id: 'ch1',
          name: 'results',
          type: 'chan Job',
          direction: 'bidirectional' as const,
          location: { file: 'main.go', line: 10 },
        },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('"chan Job"');
  });
});

// ─── renderGoroutineTopology — channelEdges rendering ──────────────────────────

describe('MermaidTemplates.renderGoroutineTopology — channelEdges', () => {
  function makeTopology(overrides?: Partial<GoroutineTopology>): GoroutineTopology {
    return { nodes: [], edges: [], channels: [], channelEdges: [], ...overrides };
  }

  it('renders a make channelEdge as "-->|make|" arrow', () => {
    const topology = makeTopology({
      channelEdges: [
        { from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('-->|make|');
    expect(out).toMatch(/pkg_hub_WorkerPool_Start\s*-->|make|\s*chan_pkg_hub_50/);
  });

  it('renders a recv channelEdge as "-->|recv|" arrow', () => {
    const topology = makeTopology({
      channelEdges: [
        { from: 'chan-pkg/hub-50', to: 'pkg/hub.WorkerPool.Start.spawn-53', edgeType: 'recv' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('-->|recv|');
  });

  it('renders a send channelEdge as "-->|send|" arrow', () => {
    const topology = makeTopology({
      channelEdges: [
        { from: 'pkg/hub.WorkerPool.Dispatch', to: 'chan-pkg/hub-50', edgeType: 'send' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('-->|send|');
  });

  it('renders no extra edges when channelEdges is empty', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.main.spawn-1',
          name: 'worker',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'hub.go', line: 1 },
        },
      ],
      channelEdges: [],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).not.toContain('-->|make|');
    expect(out).not.toContain('-->|recv|');
    expect(out).not.toContain('-->|send|');
  });

  it('renders both make and recv edges when both are present', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-53',
          name: '<anonymous>',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 53 },
        },
      ],
      channels: [
        {
          id: 'chan-pkg/hub-50',
          name: 'jobs',
          type: 'chan',
          direction: 'bidirectional' as const,
          location: { file: 'worker.go', line: 50 },
        },
      ],
      channelEdges: [
        { from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' },
        { from: 'chan-pkg/hub-50', to: 'pkg/hub.WorkerPool.Start.spawn-53', edgeType: 'recv' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    expect(out).toContain('-->|make|');
    expect(out).toContain('-->|recv|');
  });

  it('auto-declares undeclared goroutine spawner from channelEdge.from with :::spawner', () => {
    // 'pkg/hub.WorkerPool.Start' is not in nodes — must be auto-declared as spawner
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-53',
          name: '<anonymous>',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 53 },
        },
      ],
      channelEdges: [
        { from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // Spawner node should be declared with short label and :::spawner style
    expect(out).toContain('["WorkerPool.Start"]:::spawner');
  });

  it('does not auto-declare a channel ID (starting with chan-) as a spawner node', () => {
    // 'chan-pkg/hub-50' starts with 'chan-' so it should NOT be declared as a spawner
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-53',
          name: 'worker',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 53 },
        },
      ],
      channels: [
        {
          id: 'chan-pkg/hub-50',
          name: 'jobs',
          type: 'chan',
          direction: 'bidirectional' as const,
          location: { file: 'worker.go', line: 50 },
        },
      ],
      channelEdges: [
        { from: 'chan-pkg/hub-50', to: 'pkg/hub.WorkerPool.Start.spawn-53', edgeType: 'recv' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // chan-pkg/hub-50 should appear only in channels subgraph, not as a spawner node declaration
    const lines = out.split('\n');
    const spawnerLines = lines.filter(l => l.includes('chan_pkg_hub_50[') && l.includes(':::spawner'));
    expect(spawnerLines).toHaveLength(0);
  });

  it('sanitizes IDs in channelEdge arrows', () => {
    const topology = makeTopology({
      channelEdges: [
        { from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' },
      ],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // Sanitized IDs should not contain slashes, dots, or hyphens
    expect(out).not.toMatch(/pkg\/hub/);
    expect(out).toContain('pkg_hub_WorkerPool_Start');
    expect(out).toContain('chan_pkg_hub_50');
  });
});
