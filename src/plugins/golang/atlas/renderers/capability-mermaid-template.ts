import type { CapabilityGraph, CapabilityNode } from '../types.js';
import {
  FLOWCHART_INIT,
  SUBGRAPH_DEPTH_STYLES,
  buildPackageTree,
  createSubgraphId,
  formatCapabilityLabel,
  isHotspot,
  sanitizeId,
} from './template-shared.js';

export function renderCapabilityGraph(graph: CapabilityGraph): string {
  if (graph.nodes.length === 0) {
    return FLOWCHART_INIT + 'flowchart LR';
  }

  let output = FLOWCHART_INIT + 'flowchart LR\n';
  const nodesByPkg = new Map<string, CapabilityNode[]>();
  for (const node of graph.nodes) {
    if (!nodesByPkg.has(node.package)) nodesByPkg.set(node.package, []);
    nodesByPkg.get(node.package)!.push(node);
  }

  const pkgRoots = buildPackageTree(Array.from(nodesByPkg.keys()));
  const usedSubgraphIds = new Set<string>();
  const capDepthMap = new Map<string, number>();
  let hasHotspotNode = false;

  const renderCapNode = (treeNode: { pkg: string; isVirtual: boolean; children: any[] }, indent: string, depth: number): void => {
    const sgId = createSubgraphId(treeNode.pkg, usedSubgraphIds);
    capDepthMap.set(sgId, depth);
    output += `${indent}subgraph ${sgId}["${treeNode.pkg}"]\n`;
    for (const child of treeNode.children) {
      renderCapNode(child, `${indent}  `, depth + 1);
    }
    if (!treeNode.isVirtual) {
      for (const node of nodesByPkg.get(treeNode.pkg) ?? []) {
        const id = sanitizeId(node.id);
        const label = formatCapabilityLabel(node);
        const hotspot = isHotspot(node);
        if (hotspot) hasHotspotNode = true;
        const classSuffix = hotspot
          ? ':::hotspot'
          : node.type === 'interface'
            ? ':::interface'
            : ':::concrete';
        output +=
          node.type === 'interface'
            ? `${indent}  ${id}{{"${label}"}}${classSuffix}\n`
            : `${indent}  ${id}["${label}"]${classSuffix}\n`;
      }
    }
    output += `${indent}end\n`;
  };

  for (const root of pkgRoots) {
    renderCapNode(root, '', 0);
  }

  for (const [sgId, sgDepth] of capDepthMap) {
    output += `  style ${sgId} ${
      SUBGRAPH_DEPTH_STYLES[Math.min(sgDepth, SUBGRAPH_DEPTH_STYLES.length - 1)]
    }\n`;
  }

  const hasConcreteEdge = graph.edges.some((edge) => edge.concreteUsage === true);
  output += '  subgraph legend["Legend"]\n';
  output += '    direction LR\n';
  output += '    legend_interface{{"interface"}}:::interface\n';
  output += '    legend_concrete["concrete"]:::concrete\n';
  if (hasHotspotNode) output += '    legend_hotspot["hotspot (≥11m or fi>5)"]:::hotspot\n';
  output += '    legend_impl["-.-> implements"]\n';
  output += '    legend_uses["--> uses"]\n';
  if (hasConcreteEdge) output += '    legend_conc["==> concrete usage"]\n';
  output += '  end\n';
  output += '  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01\n';
  output += '  classDef interface fill:#ddf4ff,stroke:#54aeff,color:#0550ae\n';
  output += '  classDef concrete fill:#dafbe1,stroke:#2da44e,color:#116329\n';
  if (hasHotspotNode) {
    output += '  classDef hotspot fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e\n';
  }

  for (const edge of graph.edges) {
    const src = sanitizeId(edge.source);
    const tgt = sanitizeId(edge.target);
    if (edge.type === 'implements') {
      output += `  ${src} -.->|impl| ${tgt}\n`;
    } else if (edge.concreteUsage === true) {
      output += `  ${src} ==>|conc| ${tgt}\n`;
    } else {
      output += `  ${src} -->|uses| ${tgt}\n`;
    }
  }

  return output;
}
