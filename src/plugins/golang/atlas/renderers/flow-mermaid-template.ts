import type { CallEdge, FlowGraph, EntryPoint } from '../types.js';
import {
  FLOWCHART_INIT,
  SEQUENCE_INIT,
  SUBGRAPH_DEPTH_STYLES,
  buildPackageTree,
  createSubgraphId,
  formatEntryLabel,
  packageOfEntry,
  sanitizeId,
} from './template-shared.js';

export function renderFlowGraph(
  graph: FlowGraph,
  format: 'flowchart' | 'sequence' = 'flowchart'
): string {
  if (format === 'sequence') {
    let output = SEQUENCE_INIT + 'sequenceDiagram\n';
    for (const chain of graph.callChains) {
      const entry = graph.entryPoints.find((candidate) => candidate.id === chain.entryPoint);
      if (!entry) continue;
      const handlerId = sanitizeId(entry.handler);
      if (handlerId) {
        output += `\n  Note over ${handlerId}: ${formatEntryLabel(entry)}\n`;
      }
      for (const call of chain.calls) {
        const fromId = sanitizeId(call.from);
        const toId = sanitizeId(call.to);
        if (!fromId || !toId) continue;
        output += `  ${fromId}->>+${toId}: call\n`;
        output += `  ${toId}-->>-${fromId}: return\n`;
      }
    }
    return output;
  }

  let output = FLOWCHART_INIT + 'flowchart LR\n';
  const pkgGroups = new Map<string, EntryPoint[]>();
  for (const entry of graph.entryPoints) {
    const pkg = packageOfEntry(entry);
    if (!pkgGroups.has(pkg)) pkgGroups.set(pkg, []);
    pkgGroups.get(pkg)!.push(entry);
  }

  const depthMap = new Map<string, number>();
  const usedSubgraphIds = new Set<string>();
  const renderEntryPkg = (
    node: { pkg: string; isVirtual: boolean; children: any[] },
    indent: string,
    depth: number
  ): void => {
    const sgId = createSubgraphId(node.pkg, usedSubgraphIds);
    depthMap.set(sgId, depth);
    output += `${indent}subgraph ${sgId}["${node.pkg}"]\n`;
    for (const child of node.children) {
      renderEntryPkg(child, `${indent}  `, depth + 1);
    }
    if (!node.isVirtual) {
      for (const entry of pkgGroups.get(node.pkg) ?? []) {
        output += `${indent}  ${sanitizeId(entry.id)}["${formatEntryLabel(entry)}"]:::entry\n`;
      }
    }
    output += `${indent}end\n`;
  };

  for (const root of buildPackageTree(Array.from(pkgGroups.keys()))) {
    renderEntryPkg(root, '  ', 0);
  }

  for (const [sgId, sgDepth] of depthMap) {
    output += `  style ${sgId} ${
      SUBGRAPH_DEPTH_STYLES[Math.min(sgDepth, SUBGRAPH_DEPTH_STYLES.length - 1)]
    }\n`;
  }

  const handlerNodeIds = new Set(graph.entryPoints.map((entry) => sanitizeId(entry.handler)));
  const declaredNodeIds = new Set(graph.entryPoints.map((entry) => sanitizeId(entry.id)));
  let hasIfaceEdge = false;
  let hasIndirEdge = false;
  const emittedEdges = new Set<string>();

  const addEdge = (from: string, to: string, label?: string, callEdge?: CallEdge): void => {
    const key = `${from}\x00${to}`;
    if (emittedEdges.has(key)) return;
    emittedEdges.add(key);
    if (callEdge) {
      if (callEdge.type === 'interface') {
        hasIfaceEdge = true;
        output += `  ${from} -.->|iface| ${to}\n`;
      } else if (callEdge.type === 'indirect') {
        hasIndirEdge = true;
        output += `  ${from} -.->|indir| ${to}\n`;
      } else {
        output += `  ${from} --> ${to}\n`;
      }
      return;
    }
    output += label ? `  ${from} -->|${label}| ${to}\n` : `  ${from} --> ${to}\n`;
  };

  const declareNode = (id: string, originalName: string): void => {
    if (declaredNodeIds.has(id)) return;
    declaredNodeIds.add(id);
    const classSuffix = handlerNodeIds.has(id) ? ':::handler' : ':::util';
    output += `  ${id}["${originalName}"]${classSuffix}\n`;
  };

  for (const chain of graph.callChains) {
    const entry = graph.entryPoints.find((candidate) => candidate.id === chain.entryPoint);
    if (!entry || chain.calls.length === 0) continue;

    const entryNodeId = sanitizeId(entry.id);
    const handlerNodeId = sanitizeId(entry.handler);
    declareNode(handlerNodeId, entry.handler);
    addEdge(entryNodeId, handlerNodeId, `"${chain.calls.length} calls"`);

    for (const call of chain.calls) {
      const fromId = sanitizeId(call.from);
      const toId = sanitizeId(call.to);
      if (!fromId || !toId) continue;
      declareNode(fromId, call.from);
      declareNode(toId, call.to);
      addEdge(fromId, toId, undefined, call);
    }
  }

  output += '\n  subgraph legend["Legend"]\n';
  output += '    direction LR\n';
  output += '    legend_entry["entry point"]:::entry\n';
  output += '    legend_handler["handler"]:::handler\n';
  output += '    legend_util["utility"]:::util\n';
  output += '    legend_edge_calls["→|N calls| entry → handler"]\n';
  output += '    legend_edge_direct["→ direct call"]\n';
  if (hasIfaceEdge) output += '    legend_edge_iface["-·→|iface| interface dispatch"]\n';
  if (hasIndirEdge) output += '    legend_edge_indir["-·→|indir| indirect call"]\n';
  output += '  end\n';
  output += '  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01\n';
  output += '\n  classDef entry fill:#ffebe9,stroke:#cf222e,color:#82071e\n';
  output += '  classDef handler fill:#ddf4ff,stroke:#54aeff,color:#0550ae\n';
  output += '  classDef util fill:#f6f8fa,stroke:#d0d7de,color:#57606a\n';

  return output;
}
