import { describe, it, expect } from 'vitest';
import { MermaidTemplates } from '@/plugins/golang/atlas/renderers/mermaid-templates.js';
import { FlowGraphBuilder } from '@/plugins/golang/atlas/builders/flow-graph-builder.js';
import type {
  FlowGraph,
  EntryPoint,
  GoroutineTopology,
  GoroutineLifecycleSummary,
  GoroutineNode,
  SpawnRelation,
  ChannelInfo,
  ChannelEdge,
  PackageGraph,
  PackageNode,
} from '@/types/extensions.js';
import type {
  CapabilityGraph,
  CapabilityNode,
  CapabilityRelation,
} from '@/plugins/golang/atlas/types.js';
import type { GoRawData, GoRawPackage } from '@/plugins/golang/types.js';

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
    // The two entries are in different groups — verify each entry node id appears
    // Note: nested buildPackageTree may add virtual ancestor subgraphs, so we
    // check for at least 2 subgraphs (one per entry group) rather than exactly 2.
    const subgraphMatches = result.match(/subgraph /g);
    expect(subgraphMatches).not.toBeNull();
    expect(subgraphMatches.length).toBeGreaterThanOrEqual(2);
    // Both entry node ids should appear
    expect(result).toContain('ep1');
    expect(result).toContain('ep2');
  });

  it('renders empty graph with just "flowchart LR"', () => {
    const graph = makeFlowGraph([]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    expect(result.trim()).toBe('flowchart LR');
  });
});

// ─── renderFlowGraph - node labels ────────────────────────────────────────────

describe('renderFlowGraph - node labels', () => {
  it('declares handler node with original dotted name as label', () => {
    const graph: FlowGraph = {
      entryPoints: [
        {
          id: 'entry-pkg/hub-1',
          type: 'http-get',
          path: '/foo',
          handler: 'r.handler.GetFoo',
          middleware: [],
          package: 'pkg/hub',
          location: { file: '/x/pkg/hub/s.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [{ from: 'r.handler.GetFoo', to: 'store.Find', type: 'direct', confidence: 0.7 }],
        },
      ],
    };
    const mmd = MermaidTemplates.renderFlowGraph(graph);
    // Handler node must be declared with original name as label
    expect(mmd).toContain('r_handler_GetFoo["r.handler.GetFoo"]');
  });

  it('declares callee node with original dotted name as label', () => {
    const graph: FlowGraph = {
      entryPoints: [
        {
          id: 'entry-pkg/hub-1',
          type: 'http-get',
          path: '/foo',
          handler: 'myHandler',
          middleware: [],
          package: 'pkg/hub',
          location: { file: '/x/pkg/hub/s.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [{ from: 'myHandler', to: 'fmt.Sprintf', type: 'direct', confidence: 0.7 }],
        },
      ],
    };
    const mmd = MermaidTemplates.renderFlowGraph(graph);
    // Callee node must show original name
    expect(mmd).toContain('fmt_Sprintf["fmt.Sprintf"]');
  });

  it('does not redeclare entry nodes that are already in subgraphs', () => {
    const graph: FlowGraph = {
      entryPoints: [
        {
          id: 'entry-pkg/hub-1',
          type: 'http-get',
          path: '/foo',
          handler: 'myHandler',
          middleware: [],
          package: 'pkg/hub',
          location: { file: '/x/pkg/hub/s.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [{ from: 'myHandler', to: 'store.Get', type: 'direct', confidence: 0.7 }],
        },
      ],
    };
    const mmd = MermaidTemplates.renderFlowGraph(graph);
    // entry node id should appear exactly once as a declaration (inside subgraph)
    const entryId = (MermaidTemplates as any).sanitizeId('entry-pkg/hub-1');
    const declarations = (mmd.match(new RegExp(`^\\s*${entryId}\\[`, 'gm')) ?? []).length;
    expect(declarations).toBe(1);
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
    expect(fn({ id: 'cmd/swarm-mcp.startTestWorkersParallel.spawn-283', name: '' })).toBe(
      'swarm-mcp.startTestWorkersParallel'
    );
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
    expect(
      fn({
        id: 'examples_user_service_NewTestHarness_spawn_43',
        name: 'examples/user-service.NewTestHarness',
      })
    ).toBe('NewTestHarness');
  });

  it('leaves name unchanged when it contains no slash', () => {
    // "WorkerPool.Start" → "WorkerPool.Start" (unchanged)
    expect(fn({ id: 'pkg_hub_WorkerPool_Start_spawn_98', name: 'WorkerPool.Start' })).toBe(
      'WorkerPool.Start'
    );
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

// ─── computePackageEdgeTiers ─────────────────────────────────────────────────

describe('MermaidTemplates.computePackageEdgeTiers', () => {
  it('returns empty map for empty input', () => {
    expect(MermaidTemplates.computePackageEdgeTiers([])).toEqual(new Map());
  });

  it('returns empty map when all strengths are equal', () => {
    expect(MermaidTemplates.computePackageEdgeTiers([3, 3, 3, 3])).toEqual(new Map());
    expect(MermaidTemplates.computePackageEdgeTiers([1])).toEqual(new Map());
  });

  it('assigns heavy tier to max, no entry for min — two distinct values', () => {
    // [1, 5]: p50=5 >= max=5 → fallback: thMedium=1, thHeavy=5
    const tiers = MermaidTemplates.computePackageEdgeTiers([1, 1, 5]);
    expect(tiers.has(1)).toBe(false); // at thMedium → default
    expect(tiers.get(5)).toBe(5.0); // >= thHeavy → heavy
  });

  it('assigns medium and heavy tiers for three distinct values', () => {
    // [1, 3, 6]: p50=sorted[1]=3, p85=sorted[2]=6 → medium>3, heavy>=6
    const tiers = MermaidTemplates.computePackageEdgeTiers([1, 3, 6]);
    expect(tiers.has(1)).toBe(false);
    expect(tiers.get(3)).toBeUndefined(); // at p50, not > p50
    expect(tiers.get(6)).toBe(5.0); // >= p85 → heavy
  });

  it('handles skewed distribution (many low, few high)', () => {
    // Twelve 1s, then 3,3,3,4,5,5,6,6 — typical Go package graph
    const strengths = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 4, 5, 5, 6, 6];
    const tiers = MermaidTemplates.computePackageEdgeTiers(strengths);
    // median (p50) = 1; p85 ≥ 5
    expect(tiers.has(1)).toBe(false); // at median → default
    expect(tiers.get(3)).toBe(3.0); // > median but < p85 → medium
    expect(tiers.get(4)).toBe(3.0); // medium
    const heavyVal = tiers.get(6);
    expect(heavyVal).toBe(5.0); // heavy
    expect([3.0, 5.0]).toContain(tiers.get(5)); // 5 is either medium or heavy
  });

  it('fallback: median==max triggers min/max split', () => {
    // All high: [4, 4, 4, 4, 8] — p50=4=max? No: max=8
    // [4, 4, 8, 8, 8]: p50=sorted[2]=8 = max → fallback
    const tiers = MermaidTemplates.computePackageEdgeTiers([8, 8, 8, 8, 4]);
    // fallback: thMedium=4, thHeavy=8
    expect(tiers.has(4)).toBe(false); // at thMedium → default
    expect(tiers.get(8)).toBe(5.0); // >= thHeavy → heavy
  });

  it('assigns only heavy tier for two-element [1, N] input', () => {
    // [1, 6]: p50=sorted[1]=6 >= max=6 → fallback: thMedium=1, thHeavy=6
    const tiers = MermaidTemplates.computePackageEdgeTiers([1, 6]);
    expect(tiers.has(1)).toBe(false);
    expect(tiers.get(6)).toBe(5.0);
  });
});

// ─── renderPackageGraph — linkStyle (dynamic edge thickness) ─────────────────

describe('MermaidTemplates.renderPackageGraph — dynamic edge thickness', () => {
  it('emits no linkStyle when all edges have the same strength', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
        { id: 'c', name: 'c', type: 'internal', fileCount: 1 },
      ],
      edges: [
        { from: 'a', to: 'b', strength: 3 },
        { from: 'a', to: 'c', strength: 3 },
      ],
      cycles: [],
    });
    expect(MermaidTemplates.renderPackageGraph(graph)).not.toContain('linkStyle');
  });

  it('emits linkStyle for heavy edges with the correct index', () => {
    // Three edges: [1, 1, 8] — edge at index 2 is heavy
    const graph = makePackageGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
        { id: 'c', name: 'c', type: 'internal', fileCount: 1 },
        { id: 'd', name: 'd', type: 'internal', fileCount: 1 },
      ],
      edges: [
        { from: 'a', to: 'b', strength: 1 },
        { from: 'a', to: 'c', strength: 1 },
        { from: 'a', to: 'd', strength: 8 },
      ],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    // strength=8 is at index 2 (0-based)
    expect(result).toContain('linkStyle 2 stroke-width:5px');
    // strength=1 edges should not have linkStyle
    expect(result).not.toContain('linkStyle 0');
    expect(result).not.toContain('linkStyle 1');
  });

  it('self-loop counts toward linkStyle index but is not styled', () => {
    // edges: [self-loop(0), regular(1), heavy(2)]
    const graph = makePackageGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
        { id: 'c', name: 'c', type: 'internal', fileCount: 1 },
      ],
      edges: [
        { from: 'a', to: 'a', strength: 1 }, // index 0 — self-loop, not styled
        { from: 'a', to: 'b', strength: 1 }, // index 1
        { from: 'a', to: 'c', strength: 9 }, // index 2 — heavy
      ],
      cycles: [{ packages: ['a'], severity: 'warning' }],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    // heavy edge is at global index 2 (self-loop takes index 0)
    expect(result).toContain('linkStyle 2 stroke-width:5px');
    // self-loop (index 0) should not appear in linkStyle
    expect(result).not.toContain('linkStyle 0');
  });

  it('linkStyle block appears after all edge declarations', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
        { id: 'c', name: 'c', type: 'internal', fileCount: 1 },
      ],
      edges: [
        { from: 'a', to: 'b', strength: 1 },
        { from: 'a', to: 'c', strength: 6 },
      ],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    const lastEdge = result.lastIndexOf(' --> ');
    const linkStyle = result.indexOf('linkStyle');
    expect(linkStyle).toBeGreaterThan(lastEdge);
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
        { id: 'mod/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 1 },
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
      nodes: [{ id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 2 }],
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
        { id: 'mod/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/hub/m', name: 'pkg/hub/m', type: 'internal', fileCount: 1 },
      ],
      edges: [{ from: 'mod/pkg/hub', to: 'mod/pkg/hub/m', strength: 3 }],
      cycles: [],
    });
    const result = MermaidTemplates.renderPackageGraph(graph);
    const subgraphEnd = result.lastIndexOf('end');
    const edgeLine = result.indexOf('mod_pkg_hub -->');
    expect(edgeLine).toBeGreaterThan(subgraphEnd);
  });

  it('renders nested subgraphs: grp_pkg contains grp_pkg_hub', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'mod/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 1 },
        { id: 'mod/pkg/logging', name: 'pkg/logging', type: 'internal', fileCount: 1 },
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
      { id: 'mod/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/store', name: 'pkg/hub/store', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/logging', name: 'pkg/logging', type: 'internal', fileCount: 1 },
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
      { id: 'mod/pkg/hub', name: 'pkg/hub', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/hub/models', name: 'pkg/hub/models', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/store', name: 'pkg/store', type: 'internal', fileCount: 1 },
      { id: 'mod/pkg/logging', name: 'pkg/logging', type: 'internal', fileCount: 1 },
    ];
    const { roots } = buildGroupTree(nodes);
    const pkgRoot = roots[0];
    const hubGroup = pkgRoot.children.find((c) => c.prefix === 'pkg/hub');
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
  function makeTopology(
    overrides?: Partial<{
      nodes: GoroutineNode[];
      edges: SpawnRelation[];
      channels: ChannelInfo[];
      channelEdges: ChannelEdge[];
    }>
  ) {
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
    const lines = out.split('\n').filter((l) => l.includes('cmd_app_main['));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(':::main');
    expect(lines[0]).not.toContain(':::spawner');
  });

  it('includes classDef for spawner style', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'spawn1',
          name: 'fn',
          type: 'spawned' as const,
          package: 'p',
          location: { file: 'f.go', line: 1 },
        },
      ],
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
    const sgStart = lines.findIndex((l) => l.includes('grp_pkg_hub'));
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
      channelEdges: [{ from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' }],
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
      channelEdges: [{ from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' }],
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
    const spawnerLines = lines.filter(
      (l) => l.includes('chan_pkg_hub_50[') && l.includes(':::spawner')
    );
    expect(spawnerLines).toHaveLength(0);
  });

  it('sanitizes IDs in channelEdge arrows', () => {
    const topology = makeTopology({
      channelEdges: [{ from: 'pkg/hub.WorkerPool.Start', to: 'chan-pkg/hub-50', edgeType: 'make' }],
    });
    const out = MermaidTemplates.renderGoroutineTopology(topology);
    // Sanitized IDs should not contain slashes, dots, or hyphens
    expect(out).not.toMatch(/pkg\/hub/);
    expect(out).toContain('pkg_hub_WorkerPool_Start');
    expect(out).toContain('chan_pkg_hub_50');
  });
});

// ─── renderCapabilityGraph — hierarchical subgraph grouping ──────────────────

function makeCapNode(
  id: string,
  name: string,
  type: 'interface' | 'struct',
  pkg: string
): CapabilityNode {
  return { id, name, type, package: pkg, exported: true };
}

function makeCapEdge(
  source: string,
  target: string,
  type: 'implements' | 'uses'
): CapabilityRelation {
  return { id: `${type}-${source}-${target}`, type, source, target, confidence: 1.0 };
}

describe('renderCapabilityGraph', () => {
  it('renders nodes in package subgraph', () => {
    const graph: CapabilityGraph = {
      nodes: [makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub')],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    expect(output).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(output).toContain('pkg_hub_Server["Server"]');
    expect(output).toContain('end');
  });

  it('renders interface nodes with diamond syntax inside subgraph', () => {
    const graph: CapabilityGraph = {
      nodes: [makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub')],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    expect(output).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(output).toContain('pkg_hub_Store{{"Store"}}');
  });

  it('nests sub-package subgraph inside parent subgraph', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.WorkerPool', 'WorkerPool', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub/engine.Engine', 'Engine', 'struct', 'pkg/hub/engine'),
      ],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    // pkg/hub/engine subgraph should appear INSIDE pkg/hub subgraph
    const hubStart = output.indexOf('subgraph grp_pkg_hub[');
    const hubEnd = output.indexOf('\nend', hubStart);
    const engineStart = output.indexOf('subgraph grp_pkg_hub_engine[');
    expect(hubStart).toBeGreaterThan(-1);
    expect(engineStart).toBeGreaterThan(hubStart);
    expect(engineStart).toBeLessThan(hubEnd);
  });

  it('renders multiple top-level packages as separate subgraphs', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/adapter.RuntimeAdapter', 'RuntimeAdapter', 'interface', 'pkg/adapter'),
      ],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    expect(output).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(output).toContain('subgraph grp_pkg_adapter["pkg/adapter"]');
  });

  it('renders edges after all subgraphs', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Engine', 'Engine', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub'),
      ],
      edges: [makeCapEdge('pkg/hub.Engine', 'pkg/hub.Store', 'implements')],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    const lastEnd = output.lastIndexOf('\nend');
    const edgeLine = output.indexOf('-.->|impl|');
    expect(edgeLine).toBeGreaterThan(lastEnd);
  });

  it('renders implements edge with dashed arrow', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub'),
      ],
      edges: [makeCapEdge('pkg/hub.Server', 'pkg/hub.Store', 'implements')],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    expect(output).toContain('pkg_hub_Server -.->|impl| pkg_hub_Store');
  });

  it('renders uses edge with solid arrow', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Engine', 'Engine', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub'),
      ],
      edges: [makeCapEdge('pkg/hub.Engine', 'pkg/hub.Store', 'uses')],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    expect(output).toContain('pkg_hub_Engine -->|uses| pkg_hub_Store');
  });

  it('handles deeply nested packages (3 levels)', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub/engine.Engine', 'Engine', 'struct', 'pkg/hub/engine'),
        makeCapNode(
          'pkg/hub/engine/store.SQLiteStore',
          'SQLiteStore',
          'struct',
          'pkg/hub/engine/store'
        ),
      ],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    // All three subgraphs should exist with correct nesting order
    expect(output).toContain('subgraph grp_pkg_hub[');
    expect(output).toContain('subgraph grp_pkg_hub_engine[');
    expect(output).toContain('subgraph grp_pkg_hub_engine_store[');
    // engine/store subgraph must appear after engine subgraph
    const engineIdx = output.indexOf('subgraph grp_pkg_hub_engine[');
    const storeIdx = output.indexOf('subgraph grp_pkg_hub_engine_store[');
    expect(storeIdx).toBeGreaterThan(engineIdx);
  });

  it('renders empty graph as flowchart LR with no subgraphs', () => {
    const graph: CapabilityGraph = { nodes: [], edges: [] };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    expect(output.trim()).toBe('flowchart LR');
  });
});

// ─── renderCapabilityGraph — nested subgraphs via buildGroupTree ──────────────

describe('renderCapabilityGraph - nested subgraphs', () => {
  it('groups pkg/hub and pkg/hub/store into nested subgraph', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub/store.Store', 'Store', 'interface', 'pkg/hub/store'),
      ],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    // pkg/hub/store subgraph must appear inside pkg/hub subgraph
    const hubStart = output.indexOf('subgraph grp_pkg_hub[');
    const hubEnd = output.indexOf('\nend', hubStart);
    const storeStart = output.indexOf('subgraph grp_pkg_hub_store[');
    expect(hubStart).toBeGreaterThan(-1);
    expect(storeStart).toBeGreaterThan(hubStart);
    expect(storeStart).toBeLessThan(hubEnd);
  });

  it('creates top-level pkg group when multiple pkg/* packages exist', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub/store.Store', 'Store', 'interface', 'pkg/hub/store'),
        makeCapNode('pkg/catalog.Catalog', 'Catalog', 'struct', 'pkg/catalog'),
        makeCapNode(
          'pkg/catalog/store.CatalogStore',
          'CatalogStore',
          'struct',
          'pkg/catalog/store'
        ),
      ],
      edges: [],
    };
    const output = MermaidTemplates.renderCapabilityGraph(graph);
    // Top-level pkg group should exist wrapping both pkg/hub and pkg/catalog
    expect(output).toContain('subgraph grp_pkg["pkg"]');
    // Both sub-groups should be inside the pkg group
    const pkgStart = output.indexOf('subgraph grp_pkg[');
    const pkgEnd = output.lastIndexOf('end');
    const hubStart = output.indexOf('subgraph grp_pkg_hub[');
    const catalogStart = output.indexOf('subgraph grp_pkg_catalog[');
    expect(hubStart).toBeGreaterThan(pkgStart);
    expect(catalogStart).toBeGreaterThan(pkgStart);
    expect(hubStart).toBeLessThan(pkgEnd);
    expect(catalogStart).toBeLessThan(pkgEnd);
  });
});

// ─── renderGoroutineTopology — nested subgraphs via buildGroupTree ────────────

describe('renderGoroutineTopology - nested subgraphs', () => {
  function makeTopology(overrides?: Partial<GoroutineTopology>): GoroutineTopology {
    return { nodes: [], edges: [], channels: [], channelEdges: [], ...overrides };
  }

  it('groups pkg/hub and pkg/hub/store goroutines under nested subgraph', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.Start.spawn-1',
          name: 'WorkerPool.Start',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 1 },
        },
        {
          id: 'pkg/hub/store.Repo.Save.spawn-2',
          name: 'Repo.Save',
          type: 'spawned' as const,
          package: 'pkg/hub/store',
          location: { file: 'store.go', line: 2 },
        },
      ],
    });
    const output = MermaidTemplates.renderGoroutineTopology(topology);
    // pkg/hub/store subgraph must appear inside pkg/hub subgraph
    const lines = output.split('\n');
    const hubStart = lines.findIndex((l) => l.includes('subgraph grp_pkg_hub['));
    const storeStart = lines.findIndex((l) => l.includes('subgraph grp_pkg_hub_store['));
    // Find the closing 'end' of grp_pkg_hub (first 'end' after hub, that is NOT the store's end)
    const hubEnd = lines.findIndex((l, i) => i > hubStart && l.trim() === 'end' && i > storeStart);
    expect(hubStart).toBeGreaterThan(-1);
    expect(storeStart).toBeGreaterThan(hubStart);
    expect(storeStart).toBeLessThan(hubEnd);
  });

  it('creates top-level pkg group when multiple pkg/* packages exist', () => {
    const topology = makeTopology({
      nodes: [
        {
          id: 'pkg/hub.WorkerPool.spawn-1',
          name: 'WorkerPool',
          type: 'spawned' as const,
          package: 'pkg/hub',
          location: { file: 'worker.go', line: 1 },
        },
        {
          id: 'pkg/catalog.Indexer.spawn-2',
          name: 'Indexer',
          type: 'spawned' as const,
          package: 'pkg/catalog',
          location: { file: 'catalog.go', line: 2 },
        },
      ],
    });
    const output = MermaidTemplates.renderGoroutineTopology(topology);
    // Top-level pkg group should wrap both pkg/hub and pkg/catalog
    expect(output).toContain('subgraph grp_pkg["pkg"]');
    const pkgStart = output.indexOf('subgraph grp_pkg[');
    const pkgEnd = output.lastIndexOf('end');
    const hubStart = output.indexOf('subgraph grp_pkg_hub[');
    const catalogStart = output.indexOf('subgraph grp_pkg_catalog[');
    expect(hubStart).toBeGreaterThan(pkgStart);
    expect(catalogStart).toBeGreaterThan(pkgStart);
    expect(hubStart).toBeLessThan(pkgEnd);
    expect(catalogStart).toBeLessThan(pkgEnd);
  });
});

// ─── renderFlowGraph — nested subgraphs and labels ───────────────────────────

describe('renderFlowGraph - nested subgraphs and labels', () => {
  function makeRawData(overrides?: Partial<GoRawData>): GoRawData {
    return {
      packages: [],
      moduleRoot: '/test',
      moduleName: 'github.com/test/project',
      ...overrides,
    };
  }

  function makePackage(overrides?: Partial<GoRawPackage>): GoRawPackage {
    return {
      id: 'pkg/hub',
      name: 'hub',
      fullName: 'pkg/hub',
      dirPath: '/abs/path/pkg/hub',
      sourceFiles: ['server.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
      ...overrides,
    };
  }

  it('uses package name as subgraph label, not absolute file path', () => {
    // entry with package: 'pkg/hub', location.file: '/abs/path/pkg/hub/server.go'
    const entry = makeEntry({
      id: 'entry-pkg_hub-10',
      package: 'pkg/hub',
      location: { file: '/abs/path/pkg/hub/server.go', line: 10 },
    });
    const graph = makeFlowGraph([entry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    // Subgraph label must be the Go package path, not the absolute directory
    expect(result).toContain('"pkg/hub"');
    expect(result).not.toContain('/abs/path/pkg/hub');
  });

  it('groups pkg/hub and pkg/catalog under nested pkg subgraph', () => {
    const hubEntry = makeEntry({
      id: 'entry-pkg_hub-10',
      package: 'pkg/hub',
      location: { file: '/abs/path/pkg/hub/server.go', line: 10 },
    });
    const catalogEntry = makeEntry({
      id: 'entry-pkg_catalog-20',
      package: 'pkg/catalog',
      location: { file: '/abs/path/pkg/catalog/catalog.go', line: 20 },
    });
    const graph = makeFlowGraph([hubEntry, catalogEntry]);
    const result = MermaidTemplates.renderFlowGraph(graph);
    // Virtual ancestor 'pkg' group should be created wrapping both sub-packages
    expect(result).toContain('subgraph grp_pkg["pkg"]');
    // Both real package subgraphs should be inside the pkg subgraph
    const pkgStart = result.indexOf('subgraph grp_pkg[');
    const pkgEnd = result.lastIndexOf('end');
    const hubStart = result.indexOf('subgraph grp_pkg_hub[');
    const catalogStart = result.indexOf('subgraph grp_pkg_catalog[');
    expect(hubStart).toBeGreaterThan(pkgStart);
    expect(catalogStart).toBeGreaterThan(pkgStart);
    expect(hubStart).toBeLessThan(pkgEnd);
    expect(catalogStart).toBeLessThan(pkgEnd);
  });

  it('populates package field in entry points from flow-graph-builder', async () => {
    const builder = new FlowGraphBuilder();
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/hub',
          functions: [
            {
              name: 'SetupRoutes',
              packageName: 'hub',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: '/abs/path/pkg/hub/server.go', startLine: 5, endLine: 20 },
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/healthz', 's.handleHealth'],
                    location: { file: '/abs/path/pkg/hub/server.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            },
          ],
        }),
      ],
    });

    const result = await builder.build(rawData);
    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].package).toBe('pkg/hub');
  });
});

// ─── renderFlowGraph - edge deduplication ─────────────────────────────────────

describe('renderFlowGraph - edge deduplication', () => {
  it('emits entry→handler edge exactly once even when handler has many calls', () => {
    const graph: FlowGraph = {
      entryPoints: [
        {
          id: 'entry-pkg/hub-1',
          type: 'http-get',
          path: '/foo',
          handler: 'myHandler',
          middleware: [],
          package: 'pkg/hub',
          location: { file: '/x/pkg/hub/s.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [
            { from: 'myHandler', to: 'a.DoA', type: 'direct', confidence: 0.7 },
            { from: 'myHandler', to: 'b.DoB', type: 'direct', confidence: 0.7 },
            { from: 'myHandler', to: 'c.DoC', type: 'direct', confidence: 0.7 },
          ],
        },
      ],
    };
    const mmd = MermaidTemplates.renderFlowGraph(graph);
    // entry→handler should appear exactly once
    const entryId = (MermaidTemplates as any).sanitizeId('entry-pkg/hub-1');
    const handlerId = (MermaidTemplates as any).sanitizeId('myHandler');
    const entryToHandlerMatches = (mmd.match(new RegExp(`${entryId}.*${handlerId}`, 'g')) ?? [])
      .length;
    expect(entryToHandlerMatches).toBe(1);
  });

  it('emits handler→callee edges without duplicates', () => {
    const graph: FlowGraph = {
      entryPoints: [
        {
          id: 'entry-pkg/hub-1',
          type: 'http-get',
          path: '/bar',
          handler: 'myHandler',
          middleware: [],
          package: 'pkg/hub',
          location: { file: '/x/pkg/hub/s.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [
            { from: 'myHandler', to: 'store.Get', type: 'direct', confidence: 0.7 },
            { from: 'myHandler', to: 'store.Get', type: 'direct', confidence: 0.7 }, // duplicate
            { from: 'myHandler', to: 'store.Get', type: 'direct', confidence: 0.7 }, // duplicate
          ],
        },
      ],
    };
    const mmd = MermaidTemplates.renderFlowGraph(graph);
    const handlerId = (MermaidTemplates as any).sanitizeId('myHandler');
    const storeId = (MermaidTemplates as any).sanitizeId('store.Get');
    const count = (mmd.match(new RegExp(`${handlerId}.*${storeId}`, 'g')) ?? []).length;
    expect(count).toBe(1);
  });

  it('adds entry label on entry→handler edge', () => {
    const graph: FlowGraph = {
      entryPoints: [
        {
          id: 'entry-pkg/hub-1',
          type: 'http-post',
          path: '/items',
          handler: 'myHandler',
          middleware: [],
          package: 'pkg/hub',
          location: { file: '/x/pkg/hub/s.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'chain-entry-pkg/hub-1',
          entryPoint: 'entry-pkg/hub-1',
          calls: [{ from: 'myHandler', to: 'store.Create', type: 'direct', confidence: 0.7 }],
        },
      ],
    };
    const mmd = MermaidTemplates.renderFlowGraph(graph);
    expect(mmd).toContain('1 calls');
  });
});

// ─── Phase B-render: capability graph metric labels and hotspot ───────────────

describe('Phase B-render: capability graph metric labels and hotspot', () => {
  function makeCapNode(
    overrides: Partial<CapabilityNode> & { id: string; name: string }
  ): CapabilityNode {
    return {
      type: 'struct',
      package: 'pkg/svc',
      exported: true,
      ...overrides,
    };
  }

  function makeCapGraph(
    nodes: CapabilityNode[],
    edges: CapabilityRelation[] = []
  ): CapabilityGraph {
    return { nodes, edges };
  }

  // Test 1: struct node with methodCount=8, fieldCount=12
  it('struct node with methodCount=8 fieldCount=12 renders label as "hub.Server [12f 8m]"', () => {
    const node = makeCapNode({
      id: 'n1',
      name: 'hub.Server',
      type: 'struct',
      methodCount: 8,
      fieldCount: 12,
    });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).toContain('["hub.Server [12f 8m]"]');
  });

  // Test 2: interface node with methodCount=20, fanIn=5
  it('interface node with methodCount=20 fanIn=5 renders label as "{{"store.Store [20m | fi:5]"}}"', () => {
    const node = makeCapNode({
      id: 'n2',
      name: 'store.Store',
      type: 'interface',
      methodCount: 20,
      fanIn: 5,
    });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).toContain('{{"store.Store [20m | fi:5]"}}');
  });

  // Test 3: node with only fanOut=3
  it('node with only fanOut=3 renders label as "Foo [fo:3]"', () => {
    const node = makeCapNode({ id: 'n3', name: 'Foo', fanOut: 3 });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).toContain('["Foo [fo:3]"]');
  });

  // Test 4: node with zero/undefined metrics renders plain label
  it('node with zero/undefined metrics renders plain label without brackets', () => {
    const node = makeCapNode({ id: 'n4', name: 'Foo' });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).toContain('["Foo"]');
    expect(output).not.toContain('["Foo [');
  });

  // Test 5: node with methodCount > 10 receives :::hotspot CSS class
  it('node with methodCount > 10 receives :::hotspot CSS class', () => {
    const node = makeCapNode({ id: 'n5', name: 'BigStruct', methodCount: 11 });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).toContain(':::hotspot');
  });

  // Test 6: node with fanIn > 5 receives :::hotspot CSS class
  it('node with fanIn > 5 receives :::hotspot CSS class', () => {
    const node = makeCapNode({ id: 'n6', name: 'HotNode', fanIn: 6 });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).toContain(':::hotspot');
  });

  // Test 7: node below both thresholds does NOT receive :::hotspot
  it('node below both hotspot thresholds does NOT receive :::hotspot', () => {
    const node = makeCapNode({ id: 'n7', name: 'CoolNode', methodCount: 10, fanIn: 5 });
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph([node]));
    expect(output).not.toContain(':::hotspot');
  });

  // Test 8: when NO node qualifies for hotspot, classDef hotspot is absent
  it('classDef hotspot is absent when no node qualifies', () => {
    const nodes = [
      makeCapNode({ id: 'n8a', name: 'Small', methodCount: 3 }),
      makeCapNode({ id: 'n8b', name: 'Medium', fanIn: 2 }),
    ];
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph(nodes));
    expect(output).not.toContain('classDef hotspot');
  });

  // Test 9: when at least one node qualifies, classDef hotspot is present
  it('classDef hotspot fill:#ff7675,... is present when at least one node qualifies', () => {
    const nodes = [
      makeCapNode({ id: 'n9a', name: 'HotOne', methodCount: 15 }),
      makeCapNode({ id: 'n9b', name: 'CoolOne', methodCount: 2 }),
    ];
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph(nodes));
    expect(output).toContain('classDef hotspot fill:#ff7675,stroke:#d63031,stroke-width:2px');
  });

  // Test 10: uses edge with concreteUsage: true renders as ==>|conc|
  it('uses edge with concreteUsage:true renders as ==>|conc|', () => {
    const nodes = [
      makeCapNode({ id: 'src1', name: 'SvcImpl', type: 'struct' }),
      makeCapNode({ id: 'tgt1', name: 'Store', type: 'struct' }),
    ];
    const edges: CapabilityRelation[] = [
      {
        id: 'e1',
        type: 'uses',
        source: 'src1',
        target: 'tgt1',
        confidence: 0.9,
        concreteUsage: true,
      },
    ];
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph(nodes, edges));
    expect(output).toContain('==>|conc|');
  });

  // Test 11: uses edge with concreteUsage: false renders as -->|uses|
  it('uses edge with concreteUsage:false renders as -->|uses|', () => {
    const nodes = [
      makeCapNode({ id: 'src2', name: 'SvcImpl', type: 'struct' }),
      makeCapNode({ id: 'tgt2', name: 'IStore', type: 'interface' }),
    ];
    const edges: CapabilityRelation[] = [
      {
        id: 'e2',
        type: 'uses',
        source: 'src2',
        target: 'tgt2',
        confidence: 0.8,
        concreteUsage: false,
      },
    ];
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph(nodes, edges));
    expect(output).toContain('-->|uses|');
    expect(output).not.toContain('==>|conc|');
  });

  // Test 12: implements edge renders as -.->|impl| regardless of concreteUsage
  it('implements edge renders as -.->|impl| regardless of concreteUsage', () => {
    const nodes = [
      makeCapNode({ id: 'src3', name: 'RepoImpl', type: 'struct' }),
      makeCapNode({ id: 'tgt3', name: 'IRepo', type: 'interface' }),
    ];
    const edges: CapabilityRelation[] = [
      {
        id: 'e3',
        type: 'implements',
        source: 'src3',
        target: 'tgt3',
        confidence: 1.0,
        concreteUsage: true,
      },
    ];
    const output = MermaidTemplates.renderCapabilityGraph(makeCapGraph(nodes, edges));
    expect(output).toContain('-.->|impl|');
    expect(output).not.toContain('==>|conc|');
  });
});

// ─── Phase C-2: goroutine lifecycle node annotations ─────────────────────────

describe('Phase C-2: goroutine lifecycle node annotations', () => {
  function makeTopology(
    nodes: GoroutineNode[],
    lifecycle?: GoroutineLifecycleSummary[]
  ): GoroutineTopology {
    return { nodes, edges: [], channels: [], channelEdges: [], lifecycle };
  }

  function makeSpawnedNode(id: string, name: string): GoroutineNode {
    return {
      id,
      name,
      type: 'spawned',
      package: 'pkg/workers',
      location: { file: 'worker.go', line: 10 },
    };
  }

  // Test 1: spawned node with receivesContext:true, hasCancellationCheck:true → label contains " ✓ctx"
  it('spawned node with receivesContext and hasCancellationCheck renders " ✓ctx" annotation', () => {
    const node = makeSpawnedNode('worker1', 'runWorker');
    const lifecycle: GoroutineLifecycleSummary[] = [
      {
        nodeId: 'worker1',
        spawnTargetName: 'runWorker',
        receivesContext: true,
        cancellationCheckAvailable: true,
        hasCancellationCheck: true,
        orphan: false,
      },
    ];
    const output = MermaidTemplates.renderGoroutineTopology(makeTopology([node], lifecycle));
    expect(output).toContain(' ✓ctx');
  });

  // Test 2: spawned node with receivesContext:true, cancellationCheckAvailable:false → label contains " ctx?"
  it('spawned node with receivesContext but cancellationCheckAvailable:false renders " ctx?" annotation', () => {
    const node = makeSpawnedNode('worker2', 'processJob');
    const lifecycle: GoroutineLifecycleSummary[] = [
      {
        nodeId: 'worker2',
        spawnTargetName: 'processJob',
        receivesContext: true,
        cancellationCheckAvailable: false,
        orphan: false,
      },
    ];
    const output = MermaidTemplates.renderGoroutineTopology(makeTopology([node], lifecycle));
    expect(output).toContain(' ctx?');
  });

  // Test 3: spawned node with orphan:true → label contains " ⚠ no exit"
  it('spawned node with orphan:true renders " ⚠ no exit" annotation', () => {
    const node = makeSpawnedNode('worker3', 'leakyWorker');
    const lifecycle: GoroutineLifecycleSummary[] = [
      {
        nodeId: 'worker3',
        spawnTargetName: 'leakyWorker',
        receivesContext: false,
        cancellationCheckAvailable: false,
        orphan: true,
      },
    ];
    const output = MermaidTemplates.renderGoroutineTopology(makeTopology([node], lifecycle));
    expect(output).toContain(' ⚠ no exit');
  });

  // Test 4: spawned node with no matching lifecycle entry → label unchanged (no annotation)
  it('spawned node with no matching lifecycle entry has no annotation', () => {
    const node = makeSpawnedNode('worker4', 'cleanWorker');
    // lifecycle has a different nodeId
    const lifecycle: GoroutineLifecycleSummary[] = [
      {
        nodeId: 'other-worker',
        spawnTargetName: 'otherFn',
        receivesContext: true,
        cancellationCheckAvailable: true,
        hasCancellationCheck: true,
        orphan: false,
      },
    ];
    const output = MermaidTemplates.renderGoroutineTopology(makeTopology([node], lifecycle));
    expect(output).not.toContain(' ✓ctx');
    expect(output).not.toContain(' ctx?');
    expect(output).not.toContain(' ⚠ no exit');
  });

  // Test 5: multiple spawned nodes each render their correct individual tag
  it('multiple spawned nodes each render their correct lifecycle annotation', () => {
    const node1 = makeSpawnedNode('w1', 'goodWorker');
    const node2 = makeSpawnedNode('w2', 'orphanWorker');
    const lifecycle: GoroutineLifecycleSummary[] = [
      {
        nodeId: 'w1',
        spawnTargetName: 'goodWorker',
        receivesContext: true,
        cancellationCheckAvailable: true,
        hasCancellationCheck: true,
        orphan: false,
      },
      {
        nodeId: 'w2',
        spawnTargetName: 'orphanWorker',
        receivesContext: false,
        cancellationCheckAvailable: false,
        orphan: true,
      },
    ];
    const output = MermaidTemplates.renderGoroutineTopology(
      makeTopology([node1, node2], lifecycle)
    );
    expect(output).toContain(' ✓ctx');
    expect(output).toContain(' ⚠ no exit');
  });
});
