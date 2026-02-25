import { describe, it, expect } from 'vitest';
import { AtlasRenderer } from '@/plugins/golang/atlas/renderers/atlas-renderer.js';
import { MermaidTemplates } from '@/plugins/golang/atlas/renderers/mermaid-templates.js';
import type { GoAtlasExtension } from '@/types/extensions.js';
import type {
  PackageGraph,
  CapabilityGraph,
  GoroutineTopology,
  FlowGraph,
} from '@/types/extensions.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeAtlas(overrides?: Partial<GoAtlasExtension>): GoAtlasExtension {
  return {
    version: '1.0',
    layers: {},
    metadata: {
      generatedAt: new Date().toISOString(),
      generationStrategy: {
        functionBodyStrategy: 'none',
        entryPointTypes: [],
        followIndirectCalls: false,
        goplsEnabled: false,
      },
      completeness: { package: 1, capability: 1, goroutine: 1, flow: 1 },
      performance: { fileCount: 0, parseTime: 0, totalTime: 0, memoryUsage: 0 },
    },
    ...overrides,
  };
}

function makePackageGraph(overrides?: Partial<PackageGraph>): PackageGraph {
  return {
    nodes: [],
    edges: [],
    cycles: [],
    ...overrides,
  };
}

function makeCapabilityGraph(overrides?: Partial<CapabilityGraph>): CapabilityGraph {
  return {
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeGoroutineTopology(overrides?: Partial<GoroutineTopology>): GoroutineTopology {
  return {
    nodes: [],
    edges: [],
    channels: [],
    ...overrides,
  };
}

function makeFlowGraph(overrides?: Partial<FlowGraph>): FlowGraph {
  return {
    entryPoints: [],
    callChains: [],
    ...overrides,
  };
}

// ─── AtlasRenderer ────────────────────────────────────────────────────────────

describe('AtlasRenderer', () => {
  let renderer: AtlasRenderer;

  beforeEach(() => {
    renderer = new AtlasRenderer();
  });

  // 1. render 'package' in mermaid
  it('renders package layer in mermaid format', async () => {
    const atlas = makeAtlas({ layers: { package: makePackageGraph() } });
    const result = await renderer.render(atlas, 'package', 'mermaid');

    expect(result.content).toMatch(/^flowchart TB/);
    expect(result.format).toBe('mermaid');
    expect(result.layer).toBe('package');
  });

  // 2. render 'capability' in mermaid
  it('renders capability layer in mermaid format', async () => {
    const atlas = makeAtlas({ layers: { capability: makeCapabilityGraph() } });
    const result = await renderer.render(atlas, 'capability', 'mermaid');

    expect(result.content).toMatch(/^flowchart LR/);
    expect(result.layer).toBe('capability');
    expect(result.format).toBe('mermaid');
  });

  // 3. render 'goroutine' in mermaid
  it('renders goroutine layer in mermaid format with classDef main', async () => {
    const atlas = makeAtlas({ layers: { goroutine: makeGoroutineTopology() } });
    const result = await renderer.render(atlas, 'goroutine', 'mermaid');

    expect(result.content).toMatch(/^flowchart TB/);
    expect(result.content).toContain('classDef main');
    expect(result.layer).toBe('goroutine');
    expect(result.format).toBe('mermaid');
  });

  // 4. render 'flow' in mermaid
  it('renders flow layer in mermaid format', async () => {
    const atlas = makeAtlas({ layers: { flow: makeFlowGraph() } });
    const result = await renderer.render(atlas, 'flow', 'mermaid');

    expect(result.content).toMatch(/^flowchart LR/);
    expect(result.layer).toBe('flow');
    expect(result.format).toBe('mermaid');
  });

  // 5. render 'all' with all 4 layers present
  it('renders all layers joined with separator', async () => {
    const atlas = makeAtlas({
      layers: {
        package: makePackageGraph(),
        capability: makeCapabilityGraph(),
        goroutine: makeGoroutineTopology(),
        flow: makeFlowGraph(),
      },
    });
    const result = await renderer.render(atlas, 'all', 'mermaid');

    const parts = result.content.split('\n---\n');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatch(/^flowchart TB/);
    expect(parts[1]).toMatch(/^flowchart LR/);
    expect(parts[2]).toMatch(/^flowchart TB/);
    expect(parts[3]).toMatch(/^flowchart LR/);
  });

  // 6. render 'all' with only partial layers present
  it('renders all with partial layers — only present layers included', async () => {
    const atlas = makeAtlas({
      layers: {
        package: makePackageGraph(),
        flow: makeFlowGraph(),
        // capability and goroutine absent
      },
    });
    const result = await renderer.render(atlas, 'all', 'mermaid');

    const parts = result.content.split('\n---\n');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^flowchart TB/);
    expect(parts[1]).toMatch(/^flowchart LR/);
  });

  // 7. render 'package' in json
  it('renders package layer in json format', async () => {
    const pkg = makePackageGraph({
      nodes: [
        {
          id: 'github.com/example/project/pkg/api',
          name: 'pkg/api',
          type: 'internal',
          fileCount: 3,
        },
      ],
    });
    const atlas = makeAtlas({ layers: { package: pkg } });
    const result = await renderer.render(atlas, 'package', 'json');

    expect(result.format).toBe('json');
    expect(result.layer).toBe('package');
    const parsed = JSON.parse(result.content);
    expect(parsed).toBeDefined();
    expect(parsed.nodes).toHaveLength(1);
  });

  // 8. throws when package layer missing
  it('throws when package layer is missing', async () => {
    const atlas = makeAtlas({ layers: {} });
    await expect(async () => renderer.render(atlas, 'package', 'mermaid')).rejects.toThrow(
      'Package layer not available'
    );
  });

  // 9. throws when capability layer missing
  it('throws when capability layer is missing', async () => {
    const atlas = makeAtlas({ layers: {} });
    await expect(async () => renderer.render(atlas, 'capability', 'mermaid')).rejects.toThrow(
      'Capability layer not available'
    );
  });

  // 10. throws when goroutine layer missing
  it('throws when goroutine layer is missing', async () => {
    const atlas = makeAtlas({ layers: {} });
    await expect(async () => renderer.render(atlas, 'goroutine', 'mermaid')).rejects.toThrow(
      'Goroutine layer not available'
    );
  });

  // 11. throws when flow layer missing
  it('throws when flow layer is missing', async () => {
    const atlas = makeAtlas({ layers: {} });
    await expect(async () => renderer.render(atlas, 'flow', 'mermaid')).rejects.toThrow(
      'Flow layer not available'
    );
  });
});

// ─── MermaidTemplates ─────────────────────────────────────────────────────────

describe('MermaidTemplates', () => {
  // 12. renderPackageGraph with nodes — node id and name present
  it('includes node id and name in package graph output', () => {
    const graph = makePackageGraph({
      nodes: [
        {
          id: 'github.com/example/project/pkg/api',
          name: 'pkg/api',
          type: 'internal',
          fileCount: 2,
        },
      ],
    });
    const output = MermaidTemplates.renderPackageGraph(graph);

    expect(output).toContain('github_com_example_project_pkg_api');
    expect(output).toContain('pkg/api');
  });

  // 13. renderPackageGraph cmd node uses :::cmd style
  it('applies :::cmd style to cmd-type nodes', () => {
    const graph = makePackageGraph({
      nodes: [{ id: 'main', name: 'main', type: 'cmd', fileCount: 1 }],
    });
    const output = MermaidTemplates.renderPackageGraph(graph);

    expect(output).toContain(':::cmd');
  });

  // 14. renderPackageGraph edge with strength=1 has no label
  it('omits strength label when edge strength is 1', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
      ],
      edges: [{ from: 'a', to: 'b', strength: 1, importPath: 'b' }],
    });
    const output = MermaidTemplates.renderPackageGraph(graph);

    expect(output).not.toContain('refs');
    // Arrow is still present
    expect(output).toContain('-->');
  });

  // 15. renderPackageGraph edge with strength=3 shows label
  it('shows refs label when edge strength is greater than 1', () => {
    const graph = makePackageGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
      ],
      edges: [{ from: 'a', to: 'b', strength: 3, importPath: 'b' }],
    });
    const output = MermaidTemplates.renderPackageGraph(graph);

    expect(output).toContain('|"3 refs"|');
  });

  // 16. renderPackageGraph with cycles shows comment block
  it('renders cycle comments with severity', () => {
    const graph = makePackageGraph({
      cycles: [
        {
          packages: ['pkg/a', 'pkg/b', 'pkg/a'],
          severity: 'error',
        },
      ],
    });
    const output = MermaidTemplates.renderPackageGraph(graph);

    expect(output).toContain('%% Cycles detected:');
    expect(output).toContain('error');
    expect(output).toContain('pkg/a');
  });

  // 17. renderCapabilityGraph interface node uses {{ }} syntax
  it('renders interface nodes with {{ }} syntax', () => {
    const graph = makeCapabilityGraph({
      nodes: [
        {
          id: 'iface1',
          name: 'IRepository',
          type: 'interface',
          package: 'pkg/repo',
          exported: true,
        },
      ],
    });
    const output = MermaidTemplates.renderCapabilityGraph(graph);

    expect(output).toContain('{{');
    expect(output).toContain('}}');
    expect(output).toContain('IRepository');
  });

  // 18. renderCapabilityGraph struct node uses [ ] syntax
  it('renders struct nodes with [ ] syntax', () => {
    const graph = makeCapabilityGraph({
      nodes: [
        { id: 'struct1', name: 'UserRepo', type: 'struct', package: 'pkg/repo', exported: true },
      ],
    });
    const output = MermaidTemplates.renderCapabilityGraph(graph);

    expect(output).toContain('["UserRepo"]');
  });

  // 19. renderCapabilityGraph implements edge uses dashed arrow with impl label
  it('renders implements edge with -.->|impl| syntax', () => {
    const graph = makeCapabilityGraph({
      nodes: [
        { id: 'iface1', name: 'IRepo', type: 'interface', package: 'pkg', exported: true },
        { id: 'struct1', name: 'Repo', type: 'struct', package: 'pkg', exported: true },
      ],
      edges: [
        { id: 'rel1', type: 'implements', source: 'struct1', target: 'iface1', confidence: 0.9 },
      ],
    });
    const output = MermaidTemplates.renderCapabilityGraph(graph);

    expect(output).toContain('-.->|impl|');
  });

  // 20. renderCapabilityGraph uses edge uses solid arrow with uses label
  it('renders uses edge with -->|uses| syntax', () => {
    const graph = makeCapabilityGraph({
      nodes: [
        { id: 'iface1', name: 'IRepo', type: 'interface', package: 'pkg', exported: true },
        { id: 'svc1', name: 'UserService', type: 'struct', package: 'pkg', exported: true },
      ],
      edges: [{ id: 'rel2', type: 'uses', source: 'svc1', target: 'iface1', confidence: 0.8 }],
    });
    const output = MermaidTemplates.renderCapabilityGraph(graph);

    expect(output).toContain('-->|uses|');
  });

  // 21. renderGoroutineTopology contains classDef declarations
  it('renders goroutine topology with classDef main and spawned', () => {
    const topology = makeGoroutineTopology();
    const output = MermaidTemplates.renderGoroutineTopology(topology);

    expect(output).toContain('classDef main');
    expect(output).toContain('classDef spawned');
  });

  // 22. renderGoroutineTopology with channels renders subgraph
  it('renders channel subgraph when channels are present', () => {
    const topology = makeGoroutineTopology({
      channels: [
        {
          id: 'ch1',
          type: 'chan Job',
          direction: 'bidirectional',
          location: { file: 'main.go', line: 10 },
        },
      ],
    });
    const output = MermaidTemplates.renderGoroutineTopology(topology);

    expect(output).toContain('subgraph channels');
    expect(output).toContain('chan Job');
  });

  // 23. sanitizeId replaces dots and slashes with underscore
  it('sanitizes ids by replacing non-alphanumeric characters with underscore', () => {
    const graph = makePackageGraph({
      nodes: [
        {
          id: 'pkg/api.Server',
          name: 'api.Server',
          type: 'internal',
          fileCount: 1,
        },
      ],
    });
    const output = MermaidTemplates.renderPackageGraph(graph);

    // sanitizeId('pkg/api.Server') => 'pkg_api_Server'
    expect(output).toContain('pkg_api_Server');
    expect(output).not.toContain('pkg/api.Server');
  });

  // 24. renderFlowGraph with no chains and no entry points returns minimal output
  it('renders empty flow graph as just flowchart LR header', () => {
    const graph = makeFlowGraph();
    const output = MermaidTemplates.renderFlowGraph(graph);

    expect(output).toBe('flowchart LR\n');
  });

  // Additional coverage: renderGoroutineTopology with main node uses :::main style
  it('applies :::main style to main-type goroutine nodes', () => {
    const topology = makeGoroutineTopology({
      nodes: [
        {
          id: 'main_goroutine',
          name: 'main',
          type: 'main',
          package: 'main',
          location: { file: 'main.go', line: 1 },
        },
      ],
    });
    const output = MermaidTemplates.renderGoroutineTopology(topology);

    expect(output).toContain(':::main');
  });

  // Additional coverage: renderGoroutineTopology with spawned node and pattern
  it('includes pattern in goroutine node label when pattern is set', () => {
    const topology = makeGoroutineTopology({
      nodes: [
        {
          id: 'worker_pool',
          name: 'workerPool',
          type: 'spawned',
          pattern: 'worker-pool',
          package: 'workers',
          location: { file: 'worker.go', line: 5 },
        },
      ],
    });
    const output = MermaidTemplates.renderGoroutineTopology(topology);

    expect(output).toContain('worker-pool');
    expect(output).toContain(':::spawned');
  });

  // Additional coverage: renderFlowGraph with an entry point and call chain (sequence format)
  it('renders flow graph sequence with entry point and calls', () => {
    const graph = makeFlowGraph({
      entryPoints: [
        {
          id: 'ep1',
          type: 'http-get',
          path: '/api/users',
          handler: 'UserHandler',
          middleware: [],
          location: { file: 'handler.go', line: 20 },
        },
      ],
      callChains: [
        {
          id: 'chain1',
          entryPoint: 'ep1',
          calls: [{ from: 'UserHandler', to: 'UserService', type: 'direct', confidence: 1.0 }],
        },
      ],
    });
    const output = MermaidTemplates.renderFlowGraph(graph, 'sequence');

    expect(output).toContain('Note over UserHandler');
    expect(output).toContain('http-get /api/users');
    expect(output).toContain('UserHandler->>+UserService: call');
    expect(output).toContain('UserService-->>-UserHandler: return');
  });

  // Additional coverage: call chain skipped when entry point not found (sequence format)
  it('skips call chain when entry point is not found', () => {
    const graph = makeFlowGraph({
      entryPoints: [],
      callChains: [
        {
          id: 'chain1',
          entryPoint: 'nonexistent',
          calls: [{ from: 'A', to: 'B', type: 'direct', confidence: 1.0 }],
        },
      ],
    });
    const output = MermaidTemplates.renderFlowGraph(graph, 'sequence');

    expect(output).toBe('sequenceDiagram\n');
    expect(output).not.toContain('A->>');
  });

  // Additional coverage: goroutine spawn edges use -->|go| syntax
  it('renders goroutine spawn edges with -->|go| syntax', () => {
    const topology = makeGoroutineTopology({
      nodes: [
        {
          id: 'main_fn',
          name: 'main',
          type: 'main',
          package: 'main',
          location: { file: 'main.go', line: 1 },
        },
        {
          id: 'worker_fn',
          name: 'worker',
          type: 'spawned',
          package: 'main',
          location: { file: 'main.go', line: 10 },
        },
      ],
      edges: [{ from: 'main_fn', to: 'worker_fn', spawnType: 'go-func' }],
    });
    const output = MermaidTemplates.renderGoroutineTopology(topology);

    expect(output).toContain('-->|go|');
  });
});
