/**
 * TsModuleGraph Mermaid Renderer
 *
 * Renders a TsModuleGraph as a Mermaid flowchart LR diagram.
 *
 * Edge strength tiers:
 *   thin   (strength 1–2):   -->
 *   medium (strength 3–9):   ==>
 *   thick  (strength 10+):   ===>
 *
 * Cycle edges are rendered in red via linkStyle.
 * node_modules nodes are rendered with dashed borders via classDef.
 */

import type { TsModuleGraph, TsModuleDependency } from '@/types/extensions.js';

/**
 * Sanitize a module ID to a valid Mermaid node identifier.
 * Replaces slashes and dots with underscores.
 */
function toNodeId(moduleId: string): string {
  return moduleId.replace(/[/.\-@:]/g, '_') || '__root__';
}

/**
 * Determine arrow style based on edge strength.
 *   strength 1–2   → thin   (-->)
 *   strength 3–9   → medium (==>)
 *   strength 10+   → thick  (===>)
 */
function arrowStyle(strength: number): string {
  if (strength >= 10) return '===>';
  if (strength >= 3) return '==>';
  return '-->';
}

/**
 * Render a TsModuleGraph as a Mermaid flowchart LR string.
 */
export function renderTsModuleGraph(graph: TsModuleGraph): string {
  const lines: string[] = [];

  lines.push('flowchart LR');

  // classDef for external node_modules nodes (dashed border)
  lines.push('  classDef external stroke-dasharray: 5 5,fill:#f9f9f9,stroke:#aaa');
  lines.push('');

  // Node declarations
  for (const node of graph.nodes) {
    const nid = toNodeId(node.id);
    const label = node.id || '(root)';
    if (node.type === 'node_modules') {
      lines.push(`  ${nid}["${label}"]:::external`);
    } else {
      lines.push(`  ${nid}["${label}"]`);
    }
  }

  lines.push('');

  // Build cycle edge set for quick lookup: "from|||to"
  const cycleModuleSets: Array<Set<string>> = graph.cycles.map((c) => new Set(c.modules));

  const isCycleEdge = (edge: TsModuleDependency): boolean => {
    return cycleModuleSets.some((s) => s.has(edge.from) && s.has(edge.to));
  };

  // Separate cycle edges from normal edges to apply linkStyle
  const normalEdges: TsModuleDependency[] = [];
  const cycleEdges: TsModuleDependency[] = [];

  for (const edge of graph.edges) {
    if (isCycleEdge(edge)) {
      cycleEdges.push(edge);
    } else {
      normalEdges.push(edge);
    }
  }

  // Track edge index for linkStyle (Mermaid counts edges in declaration order)
  let edgeIndex = 0;
  const cycleEdgeIndices: number[] = [];

  // Emit normal edges first
  for (const edge of normalEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|${edge.strength}|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    edgeIndex++;
  }

  // Emit cycle edges
  for (const edge of cycleEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|${edge.strength}|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    cycleEdgeIndices.push(edgeIndex);
    edgeIndex++;
  }

  // Apply red linkStyle to cycle edges
  if (cycleEdgeIndices.length > 0) {
    lines.push('');
    for (const idx of cycleEdgeIndices) {
      lines.push(`  linkStyle ${idx} stroke:#e74c3c,stroke-width:2px`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
