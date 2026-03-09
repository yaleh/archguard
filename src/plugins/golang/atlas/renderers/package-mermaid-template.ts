import type { PackageGraph } from '../types.js';
import {
  FLOWCHART_INIT,
  SUBGRAPH_DEPTH_STYLES,
  buildGroupTree,
  computePackageEdgeTiers,
  renderGroupNodes,
  renderPackageLegend,
  sanitizeId,
} from './template-shared.js';

export function renderPackageGraph(graph: PackageGraph): string {
  let output = FLOWCHART_INIT + 'flowchart TB\n';
  const cycleNodeIds = new Set(graph.cycles.filter((c) => c.packages.length > 1).flatMap((c) => c.packages));
  const activeTypes = new Set(graph.nodes.map((n) => n.type as string));
  if (cycleNodeIds.size > 0) activeTypes.add('cycle');

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const { roots, grouped } = buildGroupTree(graph.nodes);

  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) inDegree.set(node.id, 0);
  for (const edge of graph.edges) {
    if (edge.from !== edge.to) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const diff = (inDegree.get(b.id) ?? 0) - (inDegree.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  for (const node of sortedNodes) {
    if (!grouped.has(node.id)) {
      const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
      output += `  ${sanitizeId(node.id)}["${node.name}"]${style}\n`;
    }
  }

  const subgraphDepthMap = new Map<string, number>();
  output += renderGroupNodes(
    roots,
    nodeMap,
    cycleNodeIds,
    '  ',
    new Set<string>(),
    subgraphDepthMap,
    inDegree
  );
  output += renderPackageLegend(activeTypes);

  for (const [sgId, sgDepth] of subgraphDepthMap) {
    output += `  style ${sgId} ${
      SUBGRAPH_DEPTH_STYLES[Math.min(sgDepth, SUBGRAPH_DEPTH_STYLES.length - 1)]
    }\n`;
  }

  output += '\n';
  output += '  classDef cmd      fill:#ffebe9,stroke:#cf222e,color:#82071e\n';
  output += '  classDef tests    fill:#f6f8fa,stroke:#d0d7de,color:#57606a\n';
  output += '  classDef examples fill:#ddf4ff,stroke:#54aeff,color:#0550ae\n';
  output += '  classDef testutil fill:#f6f8fa,stroke:#d0d7de,color:#57606a\n';
  output += '  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329\n';
  output += '  classDef vendor   fill:#fdf4ff,stroke:#d2a8ff,color:#6e40c9\n';
  output += '  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01\n';
  output +=
    '  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:3px,color:#82071e,font-weight:bold\n';

  const edgeThicknesses: Array<{ index: number; strength: number }> = [];
  let edgeIndex = 0;
  output += '\n';
  for (const edge of graph.edges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    if (edge.from === edge.to) {
      output += `  ${fromId} -.->|"⚠ self"| ${toId}\n`;
      edgeIndex += 1;
      continue;
    }
    const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
    output += `  ${fromId} -->${label} ${toId}\n`;
    edgeThicknesses.push({ index: edgeIndex, strength: edge.strength });
    edgeIndex += 1;
  }

  if (edgeThicknesses.length > 0) {
    const tiers = computePackageEdgeTiers(edgeThicknesses.map((edge) => edge.strength));
    if (tiers.size > 0) {
      output += '\n';
      for (const { index, strength } of edgeThicknesses) {
        const width = tiers.get(strength);
        if (width !== undefined) {
          output += `  linkStyle ${index} stroke-width:${width}px\n`;
        }
      }
    }
  }

  if (graph.cycles.length > 0) {
    output += '\n  %% Cycles detected:\n';
    for (const cycle of graph.cycles) {
      output += `  %% ${cycle.severity}: ${cycle.packages.join(' → ')}\n`;
    }
  }

  return output;
}
