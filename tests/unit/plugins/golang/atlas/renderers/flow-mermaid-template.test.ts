/**
 * Unit tests for renderFlowGraph.
 */

import { describe, it, expect } from 'vitest';
import { renderFlowGraph } from '@/plugins/golang/atlas/renderers/flow-mermaid-template.js';
import type { FlowGraph } from '@/types/extensions/go-atlas.js';

function makeGraph(overrides: Partial<FlowGraph> = {}): FlowGraph {
  return {
    entryPoints: [],
    callChains: [],
    ...overrides,
  };
}

describe('renderFlowGraph — sequence format', () => {
  it('renders a sequenceDiagram with notes and calls', () => {
    const graph = makeGraph({
      entryPoints: [
        {
          id: 'ep1',
          protocol: 'http',
          method: 'GET',
          framework: 'gin',
          path: '/api/x',
          handler: 'handler.Run',
          middleware: [],
          location: { file: 'main.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'c1',
          entryPoint: 'ep1',
          calls: [{ from: 'handler.Run', to: 'svc.Process', type: 'direct', confidence: 1 }],
        },
      ],
    });
    const out = renderFlowGraph(graph, 'sequence');
    expect(out).toContain('sequenceDiagram');
    expect(out).toContain('Note over handler_Run: GET /api/x');
    expect(out).toContain('handler_Run->>+svc_Process: call');
    expect(out).toContain('svc_Process-->>-handler_Run: return');
  });

  it('skips chains with unknown entry points', () => {
    const graph = makeGraph({
      entryPoints: [],
      callChains: [{ id: 'c1', entryPoint: 'ghost', calls: [] }],
    });
    const out = renderFlowGraph(graph, 'sequence');
    expect(out).toContain('sequenceDiagram');
  });
});

describe('renderFlowGraph — flowchart format', () => {
  it('renders entry packages, handlers, and edges', () => {
    const graph = makeGraph({
      entryPoints: [
        {
          id: 'ep1',
          protocol: 'http',
          method: 'GET',
          framework: 'gin',
          path: '/api/x',
          handler: 'handler.Run',
          middleware: [],
          location: { file: 'pkg/main.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'c1',
          entryPoint: 'ep1',
          calls: [{ from: 'handler.Run', to: 'svc.Process', type: 'direct', confidence: 1 }],
        },
      ],
    });
    const out = renderFlowGraph(graph, 'flowchart');
    expect(out).toContain('flowchart LR');
    expect(out).toContain('subgraph');
    expect(out).toContain(':::entry');
    expect(out).toContain(':::handler');
    expect(out).toContain(':::util');
    expect(out).toContain('legend');
  });

  it('renders interface and indirect edges with legend entries', () => {
    const graph = makeGraph({
      entryPoints: [
        {
          id: 'ep1',
          protocol: 'http',
          method: 'GET',
          framework: 'gin',
          path: '/a',
          handler: 'h.Run',
          middleware: [],
          location: { file: 'pkg/main.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'c1',
          entryPoint: 'ep1',
          calls: [
            { from: 'h.Run', to: 'iface.Call', type: 'interface', confidence: 0.7 },
            { from: 'h.Run', to: 'cb.Fire', type: 'indirect', confidence: 0.5 },
          ],
        },
      ],
    });
    const out = renderFlowGraph(graph, 'flowchart');
    expect(out).toContain('|iface|');
    expect(out).toContain('|indir|');
    expect(out).toContain('legend_edge_iface');
    expect(out).toContain('legend_edge_indir');
  });

  it('deduplicates edges between the same nodes', () => {
    const graph = makeGraph({
      entryPoints: [
        {
          id: 'ep1',
          protocol: 'http',
          method: 'GET',
          framework: 'gin',
          path: '/a',
          handler: 'h.Run',
          middleware: [],
          location: { file: 'pkg/main.go', line: 1 },
        },
      ],
      callChains: [
        {
          id: 'c1',
          entryPoint: 'ep1',
          calls: [
            { from: 'a.F', to: 'b.G', type: 'direct', confidence: 1 },
            { from: 'a.F', to: 'b.G', type: 'direct', confidence: 1 },
          ],
        },
      ],
    });
    const out = renderFlowGraph(graph, 'flowchart');
    const occurrences = out.split('a_F --> b_G').length - 1;
    expect(occurrences).toBe(1);
  });

  it('handles empty graphs', () => {
    const out = renderFlowGraph(makeGraph(), 'flowchart');
    expect(out).toContain('flowchart LR');
  });
});
