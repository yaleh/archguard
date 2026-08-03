/**
 * Unit tests for renderCapabilityGraph.
 */

import { describe, it, expect } from 'vitest';
import { renderCapabilityGraph } from '@/plugins/golang/atlas/renderers/capability-mermaid-template.js';
import type { CapabilityGraph } from '@/types/extensions/go-atlas.js';

function makeGraph(overrides: Partial<CapabilityGraph> = {}): CapabilityGraph {
  return {
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function node(id: string, name: string, overrides: Record<string, unknown> = {}): any {
  return { id, name, type: 'interface', package: 'pkg/svc', exported: true, ...overrides };
}

describe('renderCapabilityGraph', () => {
  it('returns just the init line for empty graphs', () => {
    expect(renderCapabilityGraph(makeGraph())).toContain('flowchart LR');
  });

  it('renders interface and concrete nodes with package subgraphs', () => {
    const graph = makeGraph({
      nodes: [node('svc.API', 'API'), node('svc.Impl', 'Impl', { type: 'concrete' })],
      edges: [{ source: 'svc.API', target: 'svc.Impl', type: 'implements' }],
    });
    const out = renderCapabilityGraph(graph);
    expect(out).toContain('subgraph');
    expect(out).toContain(':::interface');
    expect(out).toContain(':::concrete');
    expect(out).toContain('|impl|');
    expect(out).toContain('legend');
  });

  it('flags hotspot nodes and renders the hotspot legend', () => {
    const graph = makeGraph({
      nodes: [node('svc.Big', 'Big', { type: 'concrete', methodCount: 12 })],
      edges: [],
    });
    const out = renderCapabilityGraph(graph);
    expect(out).toContain(':::hotspot');
    expect(out).toContain('legend_hotspot');
  });

  it('flags concrete-heavy nodes in full mode', () => {
    const graph = makeGraph({
      nodes: [node('svc.Heavy', 'Heavy', { type: 'concrete', isPackageHotspot: true })],
      edges: [],
    });
    const out = renderCapabilityGraph(graph);
    expect(out).toContain(':::concrete-heavy');
    expect(out).toContain('legend_cheavy');
  });

  it('renders concrete usage edges and uses edges', () => {
    const graph = makeGraph({
      nodes: [
        node('a', 'A'),
        node('b', 'B', { type: 'concrete' }),
        node('c', 'C', { type: 'concrete' }),
      ],
      edges: [
        { source: 'a', target: 'b', type: 'uses', concreteUsage: true },
        { source: 'b', target: 'c', type: 'uses' },
      ],
    });
    const out = renderCapabilityGraph(graph);
    expect(out).toContain('==>|conc|');
    expect(out).toContain('-->|uses|');
    expect(out).toContain('legend_conc');
  });
});
