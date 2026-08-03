/**
 * Unit tests for renderGoroutineTopology.
 */

import { describe, it, expect } from 'vitest';
import { renderGoroutineTopology } from '@/plugins/golang/atlas/renderers/goroutine-mermaid-template.js';
import type { GoroutineTopology } from '@/types/extensions/go-atlas.js';

function makeTopology(overrides: Partial<GoroutineTopology> = {}): GoroutineTopology {
  return {
    nodes: [],
    edges: [],
    channels: [],
    channelEdges: [],
    ...overrides,
  };
}

describe('renderGoroutineTopology', () => {
  it('renders main and spawned goroutines with package groups', () => {
    const topology = makeTopology({
      nodes: [
        { id: 'main', name: 'main.main', type: 'main', package: 'pkg/main', location: { file: 'main.go', line: 1 } },
        { id: 'pkg/svc/handler.spawn-1', name: 'pkg/svc/handler', type: 'spawned', package: 'pkg/svc', location: { file: 'svc.go', line: 5 } },
      ],
      edges: [{ from: 'main', to: 'pkg/svc/handler.spawn-1' }],
      channels: [],
      channelEdges: [],
    });
    const out = renderGoroutineTopology(topology);
    expect(out).toContain('flowchart TB');
    expect(out).toContain(':::main');
    expect(out).toContain(':::spawned');
    expect(out).toContain('-->|go|');
    expect(out).toContain('legend');
  });

  it('renders channels and channel edges with a channels subgraph', () => {
    const topology = makeTopology({
      nodes: [
        { id: 'main', name: 'main.main', type: 'main', package: 'pkg/main', location: { file: 'main.go', line: 1 } },
        { id: 'worker', name: 'worker', type: 'spawned', package: 'pkg/main', location: { file: 'main.go', line: 2 } },
      ],
      edges: [],
      channels: [{ id: 'chan-jobs', name: 'jobs', type: 'chan Job', direction: 'bidirectional', location: { file: 'main.go', line: 3 } }],
      channelEdges: [{ from: 'main', to: 'chan-jobs', edgeType: 'send' }],
    });
    const out = renderGoroutineTopology(topology);
    expect(out).toContain('subgraph channels');
    expect(out).toContain(':::channel');
    expect(out).toContain('-->|send|');
    expect(out).toContain('legend_make');
  });

  it('marks spawned goroutines without an exit as noexit', () => {
    const topology = makeTopology({
      nodes: [
        { id: 'main', name: 'main.main', type: 'main', package: 'p', location: { file: 'm.go', line: 1 } },
        { id: 'orphan', name: 'orphan', type: 'spawned', package: 'p', location: { file: 'o.go', line: 2 } },
      ],
      edges: [{ from: 'main', to: 'orphan' }],
      channels: [],
      channelEdges: [],
      lifecycle: [{ nodeId: 'orphan', receivesContext: false, hasCancellationCheck: false, orphan: true }],
    });
    const out = renderGoroutineTopology(topology);
    expect(out).toContain('no exit');
    expect(out).toContain(':::spawned_noexit');
  });

  it('handles empty topologies', () => {
    const out = renderGoroutineTopology(makeTopology());
    expect(out).toContain('flowchart TB');
  });
});
