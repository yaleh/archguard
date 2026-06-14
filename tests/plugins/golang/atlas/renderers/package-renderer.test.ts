import { describe, it, expect } from 'vitest';
import { renderPackageGraph } from '@/plugins/golang/atlas/renderers/package-mermaid-template.js';
import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePackageGraph(overrides?: Partial<PackageGraph>): PackageGraph {
  return { nodes: [], edges: [], cycles: [], ...overrides };
}

function makeNode(
  id: string,
  name: string,
  type: PackageNode['type'],
  fileCount = 1
): PackageNode {
  return { id, name, type, fileCount };
}

// ─── renderPackageGraph — direct import ───────────────────────────────────────

describe('renderPackageGraph — direct import', () => {
  it('empty graph returns valid Mermaid string with flowchart TB', () => {
    const graph = makePackageGraph();
    const result = renderPackageGraph(graph);
    expect(typeof result).toBe('string');
    expect(result).toContain('flowchart TB');
  });

  it('empty graph includes init directive', () => {
    const graph = makePackageGraph();
    const result = renderPackageGraph(graph);
    expect(result).toMatch(/%%\{init:/);
  });

  it('single internal node appears with :::internal style', () => {
    const graph = makePackageGraph({
      nodes: [makeNode('pkg/hub', 'pkg/hub', 'internal')],
    });
    const result = renderPackageGraph(graph);
    expect(result).toContain('pkg_hub["pkg/hub"]:::internal');
  });

  it('cmd node appears with :::cmd style', () => {
    const graph = makePackageGraph({
      nodes: [makeNode('cmd/server', 'cmd/server', 'cmd')],
    });
    const result = renderPackageGraph(graph);
    expect(result).toContain('cmd_server["cmd/server"]:::cmd');
  });

  it('emits classDef blocks for all known node roles', () => {
    const graph = makePackageGraph();
    const result = renderPackageGraph(graph);
    expect(result).toContain('classDef internal');
    expect(result).toContain('classDef cmd');
    expect(result).toContain('classDef tests');
    expect(result).toContain('classDef examples');
    expect(result).toContain('classDef external');
    expect(result).toContain('classDef vendor');
    expect(result).toContain('classDef cycle');
  });

  it('nodes are connected by --> edge', () => {
    const graph = makePackageGraph({
      nodes: [
        makeNode('pkg/hub', 'pkg/hub', 'internal'),
        makeNode('pkg/store', 'pkg/store', 'internal'),
      ],
      edges: [{ source: 'pkg/hub', target: 'pkg/store', strength: 1 }],
    });
    const result = renderPackageGraph(graph);
    expect(result).toContain('pkg_hub -->');
    expect(result).toContain('pkg_store');
  });

  it('self-loop edge renders as dashed arrow with warning label', () => {
    const graph = makePackageGraph({
      nodes: [makeNode('pkg/runtime', 'pkg/runtime', 'internal')],
      edges: [{ source: 'pkg/runtime', target: 'pkg/runtime', strength: 1 }],
      cycles: [{ packages: ['pkg/runtime'], severity: 'warning' }],
    });
    const result = renderPackageGraph(graph);
    expect(result).toContain('pkg_runtime -.->|"⚠ self"| pkg_runtime');
  });

  it('nodes in a multi-package cycle get :::cycle style', () => {
    const graph = makePackageGraph({
      nodes: [
        makeNode('pkg/a', 'pkg/a', 'internal'),
        makeNode('pkg/b', 'pkg/b', 'internal'),
      ],
      edges: [
        { source: 'pkg/a', target: 'pkg/b', strength: 1 },
        { source: 'pkg/b', target: 'pkg/a', strength: 1 },
      ],
      cycles: [{ packages: ['pkg/a', 'pkg/b'], severity: 'error' }],
    });
    const result = renderPackageGraph(graph);
    expect(result).toMatch(/pkg_a\[.*\]:::cycle/);
    expect(result).toMatch(/pkg_b\[.*\]:::cycle/);
  });

  it('heavy edge (distinct strengths) emits linkStyle', () => {
    const graph = makePackageGraph({
      nodes: [
        makeNode('pkg/a', 'pkg/a', 'internal'),
        makeNode('pkg/b', 'pkg/b', 'internal'),
        makeNode('pkg/c', 'pkg/c', 'internal'),
      ],
      edges: [
        { source: 'pkg/a', target: 'pkg/b', strength: 1 },
        { source: 'pkg/a', target: 'pkg/c', strength: 8 },
      ],
    });
    const result = renderPackageGraph(graph);
    expect(result).toContain('linkStyle');
  });

  it('snapshot: realistic package graph with multiple node types and edges', () => {
    const graph = makePackageGraph({
      nodes: [
        makeNode('cmd/server', 'cmd/server', 'cmd'),
        makeNode('pkg/hub', 'pkg/hub', 'internal', 3),
        makeNode('pkg/hub/store', 'pkg/hub/store', 'internal', 2),
        makeNode('pkg/adapter', 'pkg/adapter', 'internal', 1),
      ],
      edges: [
        { source: 'cmd/server', target: 'pkg/hub', strength: 1 },
        { source: 'pkg/hub', target: 'pkg/hub/store', strength: 2 },
        { source: 'pkg/hub', target: 'pkg/adapter', strength: 1 },
      ],
    });
    const result = renderPackageGraph(graph);
    expect(result).toContain('flowchart TB');
    expect(result).toContain('cmd_server["cmd/server"]:::cmd');
    expect(result).toContain('-->');
    // Subgraph grouping for pkg hierarchy
    expect(result).toContain('subgraph grp_pkg_hub');
    expect(result).toContain('classDef cmd');
    expect(result).toContain('classDef internal');
  });
});
