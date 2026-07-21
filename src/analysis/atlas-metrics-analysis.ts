/**
 * Atlas package fan-in/fan-out metric computation.
 * Extracted from the MCP tool layer per ADR-006 ("tools should be thin").
 */

import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';

export interface EnrichedPackageNode extends PackageNode {
  fanIn: number;
  fanOut: number;
}

/**
 * Compute fan-in and fan-out counts for each node in a PackageGraph.
 *
 * fanIn[id]  = number of edges whose target === id
 * fanOut[id] = number of edges whose source === id
 */
export function computePackageFanMetrics(graph: PackageGraph): {
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
} {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();

  for (const edge of graph.edges) {
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
  }

  return { fanIn, fanOut };
}

/**
 * Enrich PackageNode array with computed fanIn/fanOut metrics.
 * Nodes absent from either map receive a default of 0.
 */
export function enrichPackageNodes(
  nodes: PackageNode[],
  fanIn: Map<string, number>,
  fanOut: Map<string, number>
): EnrichedPackageNode[] {
  return nodes.map((node) => ({
    ...node,
    fanIn: fanIn.get(node.id) ?? 0,
    fanOut: fanOut.get(node.id) ?? 0,
  }));
}
