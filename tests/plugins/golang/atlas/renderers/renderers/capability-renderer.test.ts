import { describe, it, expect } from 'vitest';
import { renderCapabilityGraph } from '@/plugins/golang/atlas/renderers/capability-mermaid-template.js';
import type { CapabilityGraph, CapabilityNode, CapabilityRelation } from '@/plugins/golang/atlas/types.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCapNode(
  id: string,
  name: string,
  type: 'interface' | 'struct',
  pkg: string,
  overrides?: Partial<CapabilityNode>
): CapabilityNode {
  return { id, name, type, package: pkg, exported: true, ...overrides };
}

function makeCapEdge(
  source: string,
  target: string,
  type: 'implements' | 'uses'
): CapabilityRelation {
  return { id: `${type}-${source}-${target}`, type, source, target, confidence: 1.0 };
}

// ─── renderCapabilityGraph — direct import ────────────────────────────────────

describe('renderCapabilityGraph — direct import', () => {
  it('empty graph returns valid Mermaid string with flowchart LR', () => {
    const graph: CapabilityGraph = { nodes: [], edges: [] };
    const result = renderCapabilityGraph(graph);
    expect(typeof result).toBe('string');
    expect(result).toContain('flowchart LR');
  });

  it('empty graph has no subgraph blocks', () => {
    const graph: CapabilityGraph = { nodes: [], edges: [] };
    const result = renderCapabilityGraph(graph);
    expect(result).not.toContain('subgraph');
  });

  it('single struct capability appears in output inside a package subgraph', () => {
    const graph: CapabilityGraph = {
      nodes: [makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub')],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(result).toContain('pkg_hub_Server["Server"]:::concrete');
  });

  it('single interface capability uses double-brace syntax', () => {
    const graph: CapabilityGraph = {
      nodes: [makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub')],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('pkg_hub_Store{{"Store"}}:::interface');
  });

  it('hotspot node (methodCount > 10) gets :::hotspot style', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.BigService', 'BigService', 'struct', 'pkg/hub', { methodCount: 15 }),
      ],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain(':::hotspot');
    expect(result).toContain('classDef hotspot');
  });

  it('hotspot node (fanIn > 5) gets :::hotspot style', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.CoreAdapter', 'CoreAdapter', 'struct', 'pkg/hub', { fanIn: 8 }),
      ],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain(':::hotspot');
  });

  it('implements edge renders as dashed arrow with impl label', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub'),
      ],
      edges: [makeCapEdge('pkg/hub.Server', 'pkg/hub.Store', 'implements')],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('pkg_hub_Server -.->|impl| pkg_hub_Store');
  });

  it('uses edge renders as solid arrow with uses label', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Engine', 'Engine', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub'),
      ],
      edges: [makeCapEdge('pkg/hub.Engine', 'pkg/hub.Store', 'uses')],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('pkg_hub_Engine -->|uses| pkg_hub_Store');
  });

  it('multiple packages rendered in separate subgraphs', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/adapter.Adapter', 'Adapter', 'struct', 'pkg/adapter'),
      ],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('subgraph grp_pkg_hub["pkg/hub"]');
    expect(result).toContain('subgraph grp_pkg_adapter["pkg/adapter"]');
  });

  it('nested sub-package is inside parent subgraph', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub'),
        makeCapNode('pkg/hub/engine.Engine', 'Engine', 'struct', 'pkg/hub/engine'),
      ],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    const hubStart = result.indexOf('subgraph grp_pkg_hub[');
    const engineStart = result.indexOf('subgraph grp_pkg_hub_engine[');
    const hubEnd = result.indexOf('\nend', hubStart);
    expect(hubStart).toBeGreaterThan(-1);
    expect(engineStart).toBeGreaterThan(hubStart);
    expect(engineStart).toBeLessThan(hubEnd);
  });

  it('capability label includes field and method counts when present', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Worker', 'Worker', 'struct', 'pkg/hub', {
          fieldCount: 3,
          methodCount: 5,
        }),
      ],
      edges: [],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('3f');
    expect(result).toContain('5m');
  });

  it('snapshot: complete realistic capability graph', () => {
    const graph: CapabilityGraph = {
      nodes: [
        makeCapNode('pkg/hub.Server', 'Server', 'struct', 'pkg/hub', {
          fieldCount: 2,
          methodCount: 4,
          fanOut: 3,
        }),
        makeCapNode('pkg/hub.Store', 'Store', 'interface', 'pkg/hub'),
        makeCapNode('pkg/hub/pg.PgStore', 'PgStore', 'struct', 'pkg/hub/pg', { fieldCount: 1 }),
      ],
      edges: [
        makeCapEdge('pkg/hub/pg.PgStore', 'pkg/hub.Store', 'implements'),
        makeCapEdge('pkg/hub.Server', 'pkg/hub.Store', 'uses'),
      ],
    };
    const result = renderCapabilityGraph(graph);
    expect(result).toContain('flowchart LR');
    expect(result).toContain('subgraph grp_pkg_hub[');
    expect(result).toContain('subgraph grp_pkg_hub_pg[');
    expect(result).toContain('pkg_hub_Store{{"Store"}}:::interface');
    expect(result).toContain('pkg_hub_Server["Server');
    expect(result).toContain('pkg_hub_pg_PgStore["PgStore');
    expect(result).toContain('-.->|impl|');
    expect(result).toContain('-->|uses|');
    expect(result).toContain('classDef interface');
    expect(result).toContain('classDef concrete');
  });
});
