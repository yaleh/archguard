/**
 * Unit tests for renderPackageGraph.
 */

import { describe, it, expect } from 'vitest';
import { renderPackageGraph } from '@/plugins/golang/atlas/renderers/package-mermaid-template.js';
import type { PackageGraph } from '@/types/extensions/go-atlas.js';

function makeGraph(overrides: Partial<PackageGraph> = {}): PackageGraph {
  return {
    nodes: [],
    edges: [],
    cycles: [],
    ...overrides,
  };
}

describe('renderPackageGraph', () => {
  it('renders ungrouped nodes with type styles', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'pkg/a', name: 'pkg/a', type: 'internal', fileCount: 1 },
        { id: 'pkg/b', name: 'pkg/b', type: 'external', fileCount: 1 },
      ],
      edges: [{ source: 'pkg/a', target: 'pkg/b', strength: 2 }],
      cycles: [],
    });
    const out = renderPackageGraph(graph);
    expect(out).toContain('flowchart TB');
    expect(out).toContain(':::internal');
    expect(out).toContain(':::external');
    expect(out).toContain('|"2 refs"|');
  });

  it('marks nodes in cycles with the cycle style', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', name: 'a', type: 'internal', fileCount: 1 },
        { id: 'b', name: 'b', type: 'internal', fileCount: 1 },
      ],
      edges: [
        { source: 'a', target: 'b', strength: 1 },
        { source: 'b', target: 'a', strength: 1 },
      ],
      cycles: [{ packages: ['a', 'b'], severity: 'warning' }],
    });
    const out = renderPackageGraph(graph);
    expect(out).toContain(':::cycle');
    expect(out).toContain('% Cycles detected');
  });

  it('renders self-loop edges with the self marker', () => {
    const graph = makeGraph({
      nodes: [{ id: 'a', name: 'a', type: 'internal', fileCount: 1 }],
      edges: [{ source: 'a', target: 'a', strength: 1 }],
      cycles: [],
    });
    const out = renderPackageGraph(graph);
    expect(out).toContain('self');
  });

  it('renders group trees and legends', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'pkg/svc/auth/login', name: 'login', type: 'internal', fileCount: 1 },
        { id: 'pkg/svc/auth/register', name: 'register', type: 'internal', fileCount: 1 },
        { id: 'pkg/svc/billing', name: 'billing', type: 'internal', fileCount: 1 },
      ],
      edges: [],
      cycles: [],
    });
    const out = renderPackageGraph(graph);
    expect(out).toContain('subgraph');
    expect(out).toContain('legend');
  });

  it('handles empty graphs', () => {
    expect(renderPackageGraph(makeGraph())).toContain('flowchart TB');
  });
});
