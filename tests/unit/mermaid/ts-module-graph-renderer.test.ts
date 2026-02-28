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
