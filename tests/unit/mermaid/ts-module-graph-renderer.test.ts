/**
 * TsModuleGraph renderer tests
 *
 * Uses manually constructed TsModuleGraph fixtures (no builder dependency).
 * Tests must FAIL before implementation exists.
 */

import { describe, it, expect } from 'vitest';
import type { TsModuleGraph, TsModuleNode, TsModuleDependency } from '@/types/extensions.js';
import { renderTsModuleGraph } from '@/mermaid/ts-module-graph-renderer.js';

function makeNode(
  id: string,
  type: TsModuleNode['type'] = 'internal',
  fileCount = 1
): TsModuleNode {
  return {
    id,
    name: id,
    type,
    fileCount,
    stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
  };
}

function makeEdge(
  from: string,
  to: string,
  strength: number,
  importedNames: string[] = []
): TsModuleDependency {
  return { from, to, strength, importedNames };
}

describe('renderTsModuleGraph', () => {
  it('produces a flowchart LR header', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/parser')],
      edges: [makeEdge('src/cli', 'src/parser', 1)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    expect(output).toMatch(/^flowchart LR/m);
  });

  it('renders a thin arrow for strength=1 edge', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/parser')],
      edges: [makeEdge('src/cli', 'src/parser', 1)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    // Should contain both node ids and an arrow syntax
    expect(output).toContain('src/cli');
    expect(output).toContain('src/parser');
    expect(output).toMatch(/-->/);
  });

  it('renders a thick arrow indicator for strength=10 edge', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/core')],
      edges: [makeEdge('src/cli', 'src/core', 10)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    // Thick arrow: ==> or ===> or linkStyle with stroke-width
    // We check that output distinguishes high-strength edges
    expect(output).toContain('src/core');
    // Should have thick arrow notation or linkStyle for thick
    expect(output).toMatch(/===>|stroke-width:\s*[3-9]|stroke-width:\s*\d{2}/);
  });

  it('marks cycle edges with a distinct color', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b')],
      edges: [makeEdge('src/a', 'src/b', 1), makeEdge('src/b', 'src/a', 1)],
      cycles: [{ modules: ['src/a', 'src/b'], severity: 'warning' }],
    };

    const output = renderTsModuleGraph(graph);
    // Should have linkStyle with a distinctive color for cycle edges
    expect(output).toMatch(/stroke:#[a-fA-F0-9]+|stroke:red|linkStyle/);
  });

  it('renders node_modules nodes with a visually distinct style', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('path', 'node_modules')],
      edges: [makeEdge('src/cli', 'path', 1)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    // External node should appear in output
    expect(output).toContain('path');
    // Should have a dashed or distinct style applied (:::ext or style with stroke-dasharray)
    expect(output).toMatch(/stroke-dasharray|:::ext|classDef ext|:::external/);
  });

  it('generates valid node identifiers for node: built-in modules (replaces colons)', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('node:url', 'node_modules'), makeNode('node:crypto', 'node_modules')],
      edges: [makeEdge('src/cli', 'node:url', 1), makeEdge('src/cli', 'node:crypto', 1)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    const lines = output.split('\n');
    // Only check node declaration lines (contain "[") and edge lines (contain "-->", "==>")
    const declLines = lines.filter((l) => l.includes('[') || l.match(/--?>|==>/));
    for (const line of declLines) {
      const beforeLabel = line.split(/[\[\(]/)[0];
      // Node IDs must not contain colons (invalid Mermaid syntax)
      expect(beforeLabel).not.toMatch(/:/);
    }
  });

  it('generates valid node identifiers (replaces slashes with underscores)', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/parser')],
      edges: [makeEdge('src/cli', 'src/parser', 1)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    // Mermaid node IDs cannot contain slashes
    // The node ID in the graph definition line should not have raw slashes
    const lines = output.split('\n');
    const nodeLines = lines.filter((l) => l.includes('[') || l.includes('('));
    for (const line of nodeLines) {
      // Check that arrow lines don't have bare slashes in node identifiers
      // (label text in quotes/brackets is okay)
      const beforeLabel = line.split(/[\[\(]/)[0];
      expect(beforeLabel).not.toMatch(/\//);
    }
  });
});

// ---------------------------------------------------------------------------
// Subgraph hierarchy tests
// ---------------------------------------------------------------------------
describe('renderTsModuleGraph – subgraph hierarchy', () => {
  it('wraps a parent and its direct children in a subgraph', () => {
    // cli is the parent; cli/commands and cli/utils are its children
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('cli'),
        makeNode('cli/commands'),
        makeNode('cli/utils'),
        makeNode('parser'),
      ],
      edges: [
        makeEdge('cli/commands', 'parser', 1),
        makeEdge('cli/utils', 'parser', 1),
      ],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // The parent and children must be inside a subgraph block
    expect(output).toContain('subgraph');
    // subgraph label must show the parent path
    expect(output).toMatch(/subgraph\s+\S+\s*\["?cli"?\]/);
    // Both children must appear somewhere in the output
    expect(output).toContain('cli/commands');
    expect(output).toContain('cli/utils');
  });

  it('places children inside the parent subgraph, not at the top level', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('cli'), makeNode('cli/commands'), makeNode('cli/utils')],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    const lines = output.split('\n');

    // Find the subgraph block boundaries
    const subgraphStart = lines.findIndex((l) => l.match(/subgraph\s+\S+.*cli/));
    const subgraphEnd = lines.findIndex((l, i) => i > subgraphStart && l.trim() === 'end');

    expect(subgraphStart).toBeGreaterThanOrEqual(0);
    expect(subgraphEnd).toBeGreaterThan(subgraphStart);

    // cli/commands and cli/utils must appear between start and end
    const inner = lines.slice(subgraphStart + 1, subgraphEnd).join('\n');
    expect(inner).toContain('cli/commands');
    expect(inner).toContain('cli/utils');
  });

  it('nodes without children are NOT wrapped in a subgraph', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('parser'), makeNode('types')],
      edges: [makeEdge('parser', 'types', 1)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // No subgraph block should be generated
    expect(output).not.toContain('subgraph');
    expect(output).not.toContain('end');
  });

  it('handles two-level nesting (parent > child > grandchild)', () => {
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('plugins/golang'),
        makeNode('plugins/golang/atlas'),
        makeNode('plugins/golang/atlas/builders'),
      ],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // At least two subgraph blocks for the two nesting levels
    const subgraphCount = (output.match(/\bsubgraph\b/g) ?? []).length;
    expect(subgraphCount).toBeGreaterThanOrEqual(2);

    // All three nodes must appear in the output
    expect(output).toContain('plugins/golang/atlas/builders');
    expect(output).toContain('plugins/golang/atlas');
    expect(output).toContain('plugins/golang');
  });

  it('handles two independent hierarchies side by side', () => {
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('cli'),
        makeNode('cli/commands'),
        makeNode('plugins/golang'),
        makeNode('plugins/golang/atlas'),
      ],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // Both hierarchies should have their own subgraph
    const subgraphCount = (output.match(/\bsubgraph\b/g) ?? []).length;
    expect(subgraphCount).toBeGreaterThanOrEqual(2);

    expect(output).toContain('cli/commands');
    expect(output).toContain('plugins/golang/atlas');
  });

  it('subgraph identifiers must not contain slashes', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('cli'), makeNode('cli/commands')],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    const subgraphLines = output.split('\n').filter((l) => l.trimStart().startsWith('subgraph '));

    for (const line of subgraphLines) {
      // Extract the ID token (first word after "subgraph")
      const match = line.match(/subgraph\s+(\S+)/);
      expect(match).not.toBeNull();
      expect(match![1]).not.toMatch(/\//);
    }
  });

  it('edges between subgraph nodes are still emitted correctly', () => {
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('cli'),
        makeNode('cli/commands'),
        makeNode('parser'),
      ],
      edges: [makeEdge('cli/commands', 'parser', 2)],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // The edge must appear in the output (as arrow syntax)
    expect(output).toMatch(/cli_commands\s*-->|cli\/commands/);
    // Both endpoints of the edge must be referenced
    expect(output).toContain('cli/commands');
    expect(output).toContain('parser');
  });

  it('external (node_modules) nodes are grouped in a dedicated subgraph', () => {
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('cli'),
        makeNode('path', 'node_modules'),
        makeNode('os', 'node_modules'),
        makeNode('zod', 'node_modules'),
      ],
      edges: [
        makeEdge('cli', 'path', 1),
        makeEdge('cli', 'os', 1),
        makeEdge('cli', 'zod', 1),
      ],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // External deps must be grouped in a subgraph (label contains "external" or "External")
    expect(output).toMatch(/subgraph\s+\S+\s*\[.*[Ee]xternal.*\]/);
    // All three external nodes must appear inside the output
    expect(output).toContain('path');
    expect(output).toContain('os');
    expect(output).toContain('zod');
  });
});

// ---------------------------------------------------------------------------
// Virtual parent grouping tests
// ---------------------------------------------------------------------------
describe('renderTsModuleGraph – virtual parent grouping', () => {
  it('groups sibling nodes sharing a prefix under a virtual subgraph when real parent is absent', () => {
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('plugins/golang'),
        makeNode('plugins/java'),
        makeNode('plugins/python'),
      ],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // A virtual "plugins" subgraph must be created
    expect(output).toMatch(/subgraph\s+\S+\s*\["?plugins"?\]/);
    // All three nodes must appear
    expect(output).toContain('plugins/golang');
    expect(output).toContain('plugins/java');
    expect(output).toContain('plugins/python');
  });

  it('does not create a virtual parent when only one node has that prefix', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('plugins/java'), makeNode('core')],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // No subgraph since only one plugins/* node
    expect(output).not.toContain('subgraph');
  });

  it('does not double-group when real parent node already exists', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('cli'), makeNode('cli/commands'), makeNode('cli/utils')],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // Real parent "cli" provides one subgraph; no extra virtual subgraph
    const subgraphCount = (output.match(/\bsubgraph\b/g) ?? []).length;
    expect(subgraphCount).toBe(1);
  });

  it('places all prefix-sibling nodes inside the virtual subgraph, unrelated nodes outside', () => {
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('plugins/golang'),
        makeNode('plugins/java'),
        makeNode('plugins/python'),
        makeNode('parser'),
      ],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    const lines = output.split('\n');

    const subgraphStart = lines.findIndex((l) => l.match(/subgraph\s+\S+.*plugins/));
    const subgraphEnd = lines.findIndex((l, i) => i > subgraphStart && l.trim() === 'end');

    expect(subgraphStart).toBeGreaterThanOrEqual(0);
    expect(subgraphEnd).toBeGreaterThan(subgraphStart);

    const inner = lines.slice(subgraphStart + 1, subgraphEnd).join('\n');
    expect(inner).toContain('plugins/golang');
    expect(inner).toContain('plugins/java');
    expect(inner).toContain('plugins/python');
    // unrelated node must NOT be inside the virtual subgraph
    expect(inner).not.toContain('parser');
  });

  it('virtual subgraph ID must not contain slashes', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('plugins/java'), makeNode('plugins/python')],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);
    const subgraphLines = output.split('\n').filter((l) => l.trimStart().startsWith('subgraph '));

    for (const line of subgraphLines) {
      const match = line.match(/subgraph\s+(\S+)/);
      expect(match).not.toBeNull();
      expect(match![1]).not.toMatch(/\//);
    }
  });

  it('wraps real subgraph nodes within the virtual parent (mixed real-subgraph + leaf siblings)', () => {
    // plugins/golang has a child, so it becomes a real subgraph
    // plugins/java is a leaf
    // Both should be inside a virtual "plugins" subgraph
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('plugins/golang'),
        makeNode('plugins/golang/atlas'),
        makeNode('plugins/java'),
      ],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // virtual plugins + real plugins/golang = at least 2 subgraphs
    const subgraphCount = (output.match(/\bsubgraph\b/g) ?? []).length;
    expect(subgraphCount).toBeGreaterThanOrEqual(2);
    // virtual plugins subgraph must exist
    expect(output).toMatch(/subgraph\s+\S+\s*\["?plugins"?\]/);
  });
});
