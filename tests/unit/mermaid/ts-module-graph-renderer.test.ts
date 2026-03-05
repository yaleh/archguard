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

  it('produces a %%{init}%% layout header as the first line', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/parser')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^%%\{init:/);
    expect(lines[1]).toMatch(/^flowchart LR/);
    expect(output).toContain("'curve': 'basis'");
  });

  it('quotes edge labels for strength > 1', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
      edges: [makeEdge('a', 'b', 1), makeEdge('a', 'c', 3)],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).not.toMatch(/\|"1 refs"\|/);
    expect(output).toContain('|"3 refs"|');
  });

  it('classDef block has 3 entries, appears before edges, and has no stroke-dasharray syntax bug', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('a'), makeNode('b')],
      edges: [makeEdge('a', 'b', 1)],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('classDef internal fill:#dafbe1');
    expect(output).toContain('classDef external fill:#fff8c5');
    expect(output).toContain('classDef cycle    fill:#ffebe9');
    expect(output).not.toMatch(/stroke-dasharray: /);
    const classDefPos = output.indexOf('classDef internal');
    const firstEdgePos = output.search(/\n  \w+ -->/);
    if (firstEdgePos !== -1) {
      expect(classDefPos).toBeLessThan(firstEdgePos);
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

    // The legend is always present — verify no CONTENT subgraphs before legend
    const legendIdx = output.indexOf('\n  subgraph legend[');
    expect(legendIdx).toBeGreaterThan(0); // legend always present
    const beforeLegend = output.slice(0, legendIdx);
    expect(beforeLegend).not.toContain('subgraph'); // no content subgraphs before legend
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

    // The legend is always present — verify no CONTENT subgraphs before legend
    const legendIdx = output.indexOf('\n  subgraph legend[');
    expect(legendIdx).toBeGreaterThan(0); // legend always present
    const beforeLegend = output.slice(0, legendIdx);
    expect(beforeLegend).not.toContain('subgraph'); // no content subgraphs before legend
  });

  it('does not double-group when real parent node already exists', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('cli'), makeNode('cli/commands'), makeNode('cli/utils')],
      edges: [],
      cycles: [],
    };

    const output = renderTsModuleGraph(graph);

    // Real parent "cli" provides one content subgraph; legend adds one more.
    // Count subgraphs only in the portion before the legend.
    const legendIdx = output.indexOf('\n  subgraph legend[');
    expect(legendIdx).toBeGreaterThan(0); // legend always present
    const beforeLegend = output.slice(0, legendIdx);
    const subgraphCount = (beforeLegend.match(/\bsubgraph\b/g) ?? []).length;
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

// ---------------------------------------------------------------------------
// Depth-based subgraph background style tests
// ---------------------------------------------------------------------------

function makeNodeExt(name: string): TsModuleNode {
  return { id: name, name, type: 'node_modules', path: name };
}

describe('renderTsModuleGraph – subgraph depth styles', () => {
  it('top-level (depth-1) subgraph receives fill:#ffffff style', () => {
    // Two siblings under 'a' create a virtual 'a' subgraph at depth-1.
    // Virtual grouping requires 2+ siblings sharing the same prefix.
    const graph: TsModuleGraph = {
      nodes: [makeNode('a/b'), makeNode('a/c')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // 'a' becomes a depth-1 virtual subgraph with id 'a_group'
    expect(output).toMatch(/style a_group fill:#ffffff/);
  });

  it('depth-2 subgraph receives fill:#f6f8fa style', () => {
    // plugins/golang (real parent) + plugins/golang/atlas (child) + plugins/java (sibling)
    // => virtual 'plugins' subgraph at depth-1, real 'plugins/golang' subgraph at depth-2
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
    expect(output).toMatch(/style plugins_golang_group fill:#f6f8fa/);
  });

  it('depth-3 subgraph receives fill:#eaeef2 style', () => {
    // a/b/c (real parent) + a/b/c/x (child) + a/b/d (sibling of a/b/c)
    // => virtual 'a/b' at depth-1, real 'a/b/c' at depth-2
    // Wait — virtual 'a/b' is at depth-1, so 'a/b/c' is depth-2.
    // To get depth-3 we need an outer wrapper: add a/g sibling of a/b -> virtual 'a' at d1,
    // virtual 'a/b' at d2, real 'a/b/c' at d3.
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('a/b/c'),
        makeNode('a/b/c/x'),
        makeNode('a/b/d'),
        makeNode('a/g'),
      ],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // a=depth1, a/b=depth2, a/b/c=depth3
    expect(output).toMatch(/style a_b_c_group fill:#eaeef2/);
  });

  it('depth-4+ subgraph receives fill:#d0d7de style (clamped)', () => {
    // Need 4 nesting levels. Add siblings at each level to trigger virtual grouping:
    // a/b/c/d (real) + a/b/c/d/x (child) + a/b/c/e (sibling) + a/b/f + a/g
    // => a(d1), a/b(d2), a/b/c(d3), a/b/c/d(d4) — d4 clamped to fill:#d0d7de
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('a/b/c/d'),
        makeNode('a/b/c/d/x'),
        makeNode('a/b/c/e'),
        makeNode('a/b/f'),
        makeNode('a/g'),
      ],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // a/b/c/d is depth-4, clamped to palette index 3 → fill:#d0d7de
    expect(output).toMatch(/style a_b_c_d_group fill:#d0d7de/);
  });

  it('external_deps subgraph receives fill:#ffffff style when external nodes present', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNodeExt('lodash')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('style external_deps fill:#ffffff,stroke:#d0d7de,stroke-width:1px');
  });

  it('style directives appear after subgraph end blocks and before classDef lines', () => {
    // Two siblings create a virtual subgraph, giving us both 'end' and 'style' lines to check.
    const graph: TsModuleGraph = {
      nodes: [makeNode('a/b'), makeNode('a/c')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // Find positions
    const lastEndBeforeClassDef = (() => {
      const classDefIdx = output.indexOf('  classDef internal');
      const beforeClassDef = output.slice(0, classDefIdx);
      // last 'end' before classDef
      return beforeClassDef.lastIndexOf('\n  end');
    })();
    const styleIdx = output.indexOf('\n  style a_group ');
    const classDefIdx = output.indexOf('\n  classDef internal');
    expect(lastEndBeforeClassDef).toBeLessThan(styleIdx);
    expect(styleIdx).toBeLessThan(classDefIdx);
  });

  it('style directive ID matches the subgraph ID token in the subgraph declaration', () => {
    // Two siblings under 'src/cli' create a virtual 'src/cli' subgraph.
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli/utils'), makeNode('src/cli/commands')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // Find the subgraph ID from the declaration
    const subgraphMatch = output.match(/subgraph (src_cli_group)\[/);
    expect(subgraphMatch).not.toBeNull();
    const sgId = subgraphMatch![1];
    // The style directive must use the same ID
    expect(output).toContain(`style ${sgId} `);
  });
});

// ---------------------------------------------------------------------------
// Node role annotation tests
// ---------------------------------------------------------------------------
describe('renderTsModuleGraph – node role annotations', () => {
  it('internal leaf node declaration contains :::internal', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/parser')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // 'src/cli' becomes a leaf in subgraph src_group; its declaration should have :::internal
    expect(output).toMatch(/src_cli\["[^"]+"\]:::internal/);
  });

  it('internal real-parent self-declaration (inside its own subgraph) contains :::internal', () => {
    // When a node is both a parent (has children) AND a real module (moduleNode !== null),
    // it emits a self-declaration inside its own subgraph.
    // To get a "real parent": need two nodes where one is a prefix of the other
    // e.g., 'src' and 'src/cli' — 'src' may be a real module AND parent
    // BUT the builder only creates real parents when a module exists at 'src' level.
    // Simplest: 'src/cli/a' and 'src/cli/b' — 'src/cli' is a virtual parent (no real node).
    // For real parent with self-decl: use 'src' as a node AND 'src/utils' as a child.
    const graph: TsModuleGraph = {
      nodes: [makeNode('src'), makeNode('src/utils')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // 'src' is real parent: emits self-decl inside src_group subgraph
    expect(output).toMatch(/src\["[^"]+"\]:::internal/);
  });

  it('virtual parent node declaration (subgraph wrapper) has NO ::: suffix', () => {
    // 'src/cli/a' and 'src/cli/b' → 'src/cli' is a virtual parent (no real node for it)
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli/a'), makeNode('src/cli/b')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // Virtual parent creates: subgraph src_cli_group["src/cli"]
    // It should NOT emit a self-declaration (no node line for src_cli)
    // And the subgraph line itself should not have :::
    expect(output).not.toMatch(/subgraph src_cli_group\["[^"]+"\]:::/);
    // No self-declaration for the virtual parent
    expect(output).not.toMatch(/\bsrc_cli\["[^"]+"\]/);
  });

  it('node_modules leaf declaration contains :::external', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNodeExt('lodash')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toMatch(/lodash\["[^"]+"\]:::external/);
  });

  it('cycle-participating node contains :::cycle, not :::internal', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b')],
      edges: [makeEdge('src/a', 'src/b', 1), makeEdge('src/b', 'src/a', 1)],
      cycles: [{ modules: ['src/a', 'src/b'], severity: 'error' }],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toMatch(/src_a\["[^"]+"\]:::cycle/);
    expect(output).toMatch(/src_b\["[^"]+"\]:::cycle/);
  });

  it('cycle annotation takes priority: a cycle node does NOT also have :::internal', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b')],
      edges: [makeEdge('src/a', 'src/b', 1), makeEdge('src/b', 'src/a', 1)],
      cycles: [{ modules: ['src/a', 'src/b'], severity: 'error' }],
    };
    const output = renderTsModuleGraph(graph);
    // Should have :::cycle, not :::internal
    expect(output).not.toMatch(/src_a\["[^"]+"\]:::internal/);
    expect(output).not.toMatch(/src_b\["[^"]+"\]:::internal/);
  });

  it('non-cycle node in a graph that has cycles still gets :::internal', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b'), makeNode('src/c')],
      edges: [makeEdge('src/a', 'src/b', 1), makeEdge('src/b', 'src/a', 1)],
      cycles: [{ modules: ['src/a', 'src/b'], severity: 'error' }],
    };
    const output = renderTsModuleGraph(graph);
    // src/c is not in cycle
    expect(output).toMatch(/src_c\["[^"]+"\]:::internal/);
  });
});

// ---------------------------------------------------------------------------
// Legend subgraph tests
// ---------------------------------------------------------------------------
describe('renderTsModuleGraph – legend subgraph', () => {
  it('legend subgraph is always present', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('subgraph legend["Legend"]');
  });

  it('legend always contains legend_internal["internal module"]:::internal', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('legend_internal["internal module"]:::internal');
  });

  it('legend always contains legend_edge node', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('legend_edge');
  });

  it('legend uses direction LR', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // direction LR must appear inside the legend subgraph
    const legendStart = output.indexOf('subgraph legend["Legend"]');
    // Search for '  end' as a line boundary (not 'end' as substring of 'legend_internal' etc.)
    const legendEnd = output.indexOf('\n  end', legendStart);
    const legendBlock = output.slice(legendStart, legendEnd);
    expect(legendBlock).toContain('direction LR');
  });

  it('legend omits legend_external when no node_modules nodes', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNode('src/parser')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).not.toContain('legend_external');
  });

  it('legend includes legend_external["external dependency"]:::external when node_modules nodes exist', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli'), makeNodeExt('lodash')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('legend_external["external dependency"]:::external');
  });

  it('legend omits legend_cycle when no cycles', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).not.toContain('legend_cycle');
  });

  it('legend includes legend_cycle["cycle ⚠"]:::cycle when cycleNodeIds.size > 0', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b')],
      edges: [makeEdge('src/a', 'src/b', 1), makeEdge('src/b', 'src/a', 1)],
      cycles: [{ modules: ['src/a', 'src/b'], severity: 'error' }],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('legend_cycle');
    expect(output).toContain(':::cycle');
  });

  it('legend has amber style: fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toContain('style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01');
  });

  it('legend subgraph appears before style grp_* directives in output', () => {
    // Two siblings under 'src/cli' force a virtual parent subgraph with a _group style directive.
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli/a'), makeNode('src/cli/b')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    const legendIdx = output.indexOf('subgraph legend["Legend"]');
    const styleIdx = output.search(/style \w+_group /);
    expect(legendIdx).toBeGreaterThan(0);
    expect(styleIdx).toBeGreaterThan(0);
    expect(legendIdx).toBeLessThan(styleIdx);
  });

  it('legend subgraph appears before classDef lines in output', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/cli')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    const legendIdx = output.indexOf('subgraph legend["Legend"]');
    const classDefIdx = output.indexOf('classDef internal');
    expect(legendIdx).toBeLessThan(classDefIdx);
  });

  it('no graph edges reference legend node IDs', () => {
    const graph: TsModuleGraph = {
      nodes: [makeNode('src/a'), makeNode('src/b')],
      edges: [makeEdge('src/a', 'src/b', 1)],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // Extract actual graph edge lines: lines where --> appears as a graph arrow,
    // not inside a label string. Real edge lines match: "  nodeId --> nodeId"
    // (the --> is not preceded by a quote character).
    const edgeLines = output.split('\n').filter(l => /^\s+\w[\w_]* (?:-->|==>|===>)/.test(l));
    for (const line of edgeLines) {
      expect(line).not.toContain('legend_');
    }
  });
});

// ---------------------------------------------------------------------------
// Option C — Multi-level subgraph hierarchy fix
// ---------------------------------------------------------------------------
describe('renderTsModuleGraph – Option C multi-level grouping', () => {
  it('depth-2 uniform paths grouped under virtual parent', () => {
    // All three nodes share the "examples" prefix with no real "examples" node.
    // Expected: a single virtual "examples" subgraph containing all three.
    const graph: TsModuleGraph = {
      nodes: [
        makeNode('examples/cache-usage/src'),
        makeNode('examples/chrome-extension/src'),
        makeNode('examples/embeddings/src'),
      ],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    expect(output).toMatch(/subgraph examples_group\["examples"\]/);
    const lines = output.split('\n');
    const sgStart = lines.findIndex((l) => l.match(/subgraph examples_group/));
    const sgEnd = lines.findIndex((l, i) => i > sgStart && l.trim() === 'end');
    const inner = lines.slice(sgStart + 1, sgEnd).join('\n');
    expect(inner).toContain('examples/cache-usage/src');
    expect(inner).toContain('examples/chrome-extension/src');
    expect(inner).toContain('examples/embeddings/src');
  });

  it('orphan deep path nested under real ancestor', () => {
    // "tests" is a real node; "tests/scripts/sanity_checks" should be nested inside it.
    const graph: TsModuleGraph = {
      nodes: [makeNode('tests'), makeNode('tests/scripts/sanity_checks')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // tests_group subgraph must exist
    expect(output).toMatch(/subgraph tests_group\["tests"\]/);
    const lines = output.split('\n');
    const sgStart = lines.findIndex((l) => l.match(/subgraph tests_group/));
    const sgEnd = lines.findIndex((l, i) => i > sgStart && l.trim() === 'end');
    const inner = lines.slice(sgStart + 1, sgEnd).join('\n');
    expect(inner).toContain('tests/scripts/sanity_checks');
  });

  it('mixed-depth siblings under common virtual parent', () => {
    // a/b/c and a/b/d share virtual a/b; a/e is a sibling under virtual a.
    // Expected: virtual "a" containing virtual "a/b" (with c,d) AND leaf "a/e".
    const graph: TsModuleGraph = {
      nodes: [makeNode('a/b/c'), makeNode('a/b/d'), makeNode('a/e')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // Virtual "a" subgraph must exist
    expect(output).toMatch(/subgraph a_group\["a"\]/);
    // Virtual "a/b" subgraph must exist (2+ siblings share that prefix)
    expect(output).toMatch(/subgraph a_b_group\["a\/b"\]/);
    // All three nodes must appear in the output
    expect(output).toContain('a/b/c');
    expect(output).toContain('a/b/d');
    expect(output).toContain('a/e');
    // "a/e" must appear AFTER a_group opening and before the legend
    const lines = output.split('\n');
    const aStart = lines.findIndex((l) => l.match(/subgraph a_group/));
    const legendStart = lines.findIndex((l) => l.match(/subgraph legend/));
    const aInner = lines.slice(aStart + 1, legendStart).join('\n');
    expect(aInner).toContain('a/e');
    expect(aInner).toContain('a/b/c');
    expect(aInner).toContain('a/b/d');
  });

  it('regression: lone single-chain path stays flat (no wrapper subgraph)', () => {
    // A single node with a deep path should not get spurious virtual wrappers.
    const graph: TsModuleGraph = {
      nodes: [makeNode('utils/vram_requirements/src')],
      edges: [],
      cycles: [],
    };
    const output = renderTsModuleGraph(graph);
    // No content subgraphs before the legend
    const legendIdx = output.indexOf('\n  subgraph legend[');
    expect(legendIdx).toBeGreaterThan(0);
    const beforeLegend = output.slice(0, legendIdx);
    expect(beforeLegend).not.toContain('subgraph');
  });
});
