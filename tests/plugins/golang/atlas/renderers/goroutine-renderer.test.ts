import { describe, it, expect } from 'vitest';
import { renderGoroutineTopology } from '@/plugins/golang/atlas/renderers/goroutine-mermaid-template.js';
import type {
  GoroutineTopology,
  GoroutineNode,
  SpawnRelation,
  ChannelInfo,
  ChannelEdge,
} from '@/types/extensions/go-atlas.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTopology(
  overrides?: Partial<{
    nodes: GoroutineNode[];
    edges: SpawnRelation[];
    channels: ChannelInfo[];
    channelEdges: ChannelEdge[];
  }>
): GoroutineTopology {
  return { nodes: [], edges: [], channels: [], channelEdges: [], ...overrides };
}

function makeNode(
  id: string,
  name: string,
  pkg: string,
  type: 'main' | 'spawned' = 'spawned'
): GoroutineNode {
  return { id, name, type, package: pkg, location: { file: `${pkg}/main.go`, line: 1 } };
}

// ─── basic rendering ──────────────────────────────────────────────────────────

describe('renderGoroutineTopology — direct import', () => {
  it('returns a valid Mermaid string containing flowchart for empty topology', () => {
    const topology = makeTopology();
    const result = renderGoroutineTopology(topology);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/flowchart/);
  });

  it('includes the init directive for empty topology', () => {
    const topology = makeTopology();
    const result = renderGoroutineTopology(topology);
    expect(result).toMatch(/%%\{init:/);
  });

  it('single goroutine node name appears in output', () => {
    const topology = makeTopology({
      nodes: [makeNode('pkg/hub.Worker.spawn-1', 'myWorker', 'pkg/hub')],
    });
    const result = renderGoroutineTopology(topology);
    expect(result).toContain('"myWorker"');
  });

  it('goroutine with channel edge — channel appears in output', () => {
    const topology = makeTopology({
      nodes: [makeNode('pkg/hub.Worker.spawn-1', 'worker', 'pkg/hub')],
      channels: [
        {
          id: 'chan-pkg/hub-10',
          name: 'jobs',
          type: 'chan',
          direction: 'bidirectional',
          location: { file: 'hub.go', line: 10 },
        },
      ],
      channelEdges: [
        { from: 'pkg/hub.Worker.spawn-1', to: 'chan-pkg/hub-10', edgeType: 'send' },
      ],
    });
    const result = renderGoroutineTopology(topology);
    expect(result).toContain('chan_pkg_hub_10');
    expect(result).toContain('-->|send|');
  });

  it('goroutine type=main gets :::main style', () => {
    const topology = makeTopology({
      nodes: [makeNode('cmd/app.main', 'main', 'cmd/app', 'main')],
    });
    const result = renderGoroutineTopology(topology);
    expect(result).toContain(':::main');
  });

  it('goroutine type=spawned gets :::spawned style', () => {
    const topology = makeTopology({
      nodes: [makeNode('pkg/hub.Worker.spawn-1', 'worker', 'pkg/hub', 'spawned')],
    });
    const result = renderGoroutineTopology(topology);
    expect(result).toContain(':::spawned');
  });

  it('spawner from edge appears as node with :::spawner style', () => {
    const topology = makeTopology({
      nodes: [makeNode('pkg/hub.Worker.spawn-1', 'worker', 'pkg/hub')],
      edges: [
        {
          from: 'pkg/hub.Server.Start',
          to: 'pkg/hub.Worker.spawn-1',
          spawnType: 'go-stmt',
        },
      ],
    });
    const result = renderGoroutineTopology(topology);
    expect(result).toContain(':::spawner');
    expect(result).toContain('Server.Start');
  });

  it('multiple goroutines with same package are in the same subgraph', () => {
    const topology = makeTopology({
      nodes: [
        makeNode('pkg/hub.A.spawn-1', 'A', 'pkg/hub'),
        makeNode('pkg/hub.B.spawn-2', 'B', 'pkg/hub'),
      ],
    });
    const result = renderGoroutineTopology(topology);
    expect(result).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(result).toContain('"A"');
    expect(result).toContain('"B"');
  });

  it('snapshot: complete topology with 2 goroutines, 1 channel, 1 spawner', () => {
    const topology = makeTopology({
      nodes: [
        makeNode('pkg/hub.WorkerPool.Start.spawn-10', 'WorkerPool.Start', 'pkg/hub'),
        makeNode('pkg/hub.WorkerPool.Monitor.spawn-20', 'WorkerPool.Monitor', 'pkg/hub'),
      ],
      edges: [
        {
          from: 'pkg/hub.WorkerPool.Init',
          to: 'pkg/hub.WorkerPool.Start.spawn-10',
          spawnType: 'go-stmt',
        },
        {
          from: 'pkg/hub.WorkerPool.Init',
          to: 'pkg/hub.WorkerPool.Monitor.spawn-20',
          spawnType: 'go-stmt',
        },
      ],
      channels: [
        {
          id: 'chan-pkg/hub-5',
          name: 'tasks',
          type: 'chan',
          direction: 'bidirectional',
          location: { file: 'hub.go', line: 5 },
        },
      ],
      channelEdges: [
        { from: 'pkg/hub.WorkerPool.Init', to: 'chan-pkg/hub-5', edgeType: 'make' },
        { from: 'chan-pkg/hub-5', to: 'pkg/hub.WorkerPool.Start.spawn-10', edgeType: 'recv' },
      ],
    });
    const result = renderGoroutineTopology(topology);
    // Structure checks
    expect(result).toContain('flowchart TB');
    expect(result).toContain('"WorkerPool.Start"');
    expect(result).toContain('"WorkerPool.Monitor"');
    expect(result).toContain('-->|go|');
    expect(result).toContain('-->|make|');
    expect(result).toContain('-->|recv|');
    expect(result).toContain('subgraph channels');
    expect(result).toContain('classDef main');
    expect(result).toContain('classDef spawner');
    expect(result).toContain('classDef spawned');
  });
});
