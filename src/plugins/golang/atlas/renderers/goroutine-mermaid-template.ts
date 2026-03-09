import type { GoroutineTopology } from '../types.js';
import {
  FLOWCHART_INIT,
  SUBGRAPH_DEPTH_STYLES,
  buildPackageTree,
  createSubgraphId,
  formatChannelLabel,
  formatGoroutineName,
  formatSpawnerLabel,
  getLifecycleTag,
  sanitizeId,
} from './template-shared.js';

export function renderGoroutineTopology(topology: GoroutineTopology): string {
  let output = FLOWCHART_INIT + 'flowchart TB\n';
  type NodeDecl = { rawId: string; label: string; style: string };

  const packageGroups = new Map<string, NodeDecl[]>();
  const ungrouped: NodeDecl[] = [];
  const declaredIds = new Set<string>();
  const addDecl = (pkg: string | undefined, decl: NodeDecl) => {
    if (pkg) {
      if (!packageGroups.has(pkg)) packageGroups.set(pkg, []);
      packageGroups.get(pkg)!.push(decl);
    } else {
      ungrouped.push(decl);
    }
    declaredIds.add(decl.rawId);
  };

  const nodeIdToPackage = new Map<string, string>();
  for (const node of topology.nodes) {
    if (node.package) nodeIdToPackage.set(node.id, node.package);
  }

  for (const node of topology.nodes) {
    const patternLabel = node.pattern ? ` (${node.pattern})` : '';
    const displayName = formatGoroutineName(node);
    const lifecycleTag = node.type === 'spawned' ? getLifecycleTag(node.id, topology.lifecycle) : '';
    const label = `${displayName}${patternLabel}${lifecycleTag}`;
    const style =
      node.type === 'main'
        ? ':::main'
        : label.includes('\u26a0 no exit')
          ? ':::spawned_noexit'
          : ':::spawned';
    addDecl(node.package || undefined, { rawId: node.id, label, style });
  }

  for (const edge of topology.edges) {
    if (!declaredIds.has(edge.from)) {
      addDecl(nodeIdToPackage.get(edge.to), {
        rawId: edge.from,
        label: formatSpawnerLabel(edge.from),
        style: ':::spawner',
      });
    }
  }

  for (const edge of topology.channelEdges) {
    if (!edge.from.startsWith('chan-') && !declaredIds.has(edge.from)) {
      addDecl(nodeIdToPackage.get(edge.to), {
        rawId: edge.from,
        label: formatSpawnerLabel(edge.from),
        style: ':::spawner',
      });
    }
  }

  const usedSubgraphIds = new Set<string>();
  const depthMap = new Map<string, number>();
  const renderTreeNode = (treeNode: { pkg: string; isVirtual: boolean; children: any[] }, indent: string, depth: number): void => {
    const sgId = createSubgraphId(treeNode.pkg, usedSubgraphIds);
    depthMap.set(sgId, depth);
    output += `\n${indent}subgraph ${sgId}["${treeNode.pkg}"]\n`;
    for (const child of treeNode.children) {
      renderTreeNode(child, `${indent}  `, depth + 1);
    }
    if (!treeNode.isVirtual) {
      for (const decl of packageGroups.get(treeNode.pkg) ?? []) {
        output += `${indent}  ${sanitizeId(decl.rawId)}["${decl.label}"]${decl.style}\n`;
      }
    }
    output += `${indent}end\n`;
  };

  for (const root of buildPackageTree(Array.from(packageGroups.keys()))) {
    renderTreeNode(root, '  ', 0);
  }

  for (const decl of ungrouped) {
    output += `  ${sanitizeId(decl.rawId)}["${decl.label}"]${decl.style}\n`;
  }

  output += '\n';
  for (const [sgId, sgDepth] of depthMap) {
    output += `  style ${sgId} ${
      SUBGRAPH_DEPTH_STYLES[Math.min(sgDepth, SUBGRAPH_DEPTH_STYLES.length - 1)]
    }\n`;
  }

  for (const edge of topology.edges) {
    output += `  ${sanitizeId(edge.from)} -->|go| ${sanitizeId(edge.to)}\n`;
  }

  if (topology.channels.length > 0) {
    output += '\n  subgraph channels\n';
    for (const channel of topology.channels) {
      const label = channel.type !== 'chan' ? channel.type : formatChannelLabel(channel.id);
      output += `    ${sanitizeId(channel.id)}[("${label}")]:::channel\n`;
    }
    output += '  end\n';
    output += '  style channels fill:#ffffff,stroke:#d0d7de,stroke-width:1px\n';
  }

  for (const edge of topology.channelEdges) {
    output += `  ${sanitizeId(edge.from)} -->|${edge.edgeType}| ${sanitizeId(edge.to)}\n`;
  }

  const hasNormalSpawned = [...packageGroups.values()]
    .flat()
    .concat(ungrouped)
    .some((decl) => decl.style === ':::spawned');

  output += '\n  subgraph legend["Legend"]\n';
  output += '    direction LR\n';
  output += '    legend_main["main"]:::main\n';
  output += '    legend_spawner["spawner"]:::spawner\n';
  if (hasNormalSpawned) output += '    legend_spawned["spawned ✓"]:::spawned\n';
  output += '    legend_spawned_noexit["spawned ⚠ no exit"]:::spawned_noexit\n';
  output += '    legend_channel["channel"]:::channel\n';
  output += '    legend_go["--> go (goroutine launch)"]\n';
  if (topology.channels.length > 0) output += '    legend_make["--> make/send/recv"]\n';
  output += '  end\n';
  output += '  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01\n';
  output += '\n  classDef main fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e\n';
  output += '  classDef spawned fill:#dafbe1,stroke:#2da44e,color:#116329\n';
  output += '  classDef spawner fill:#ddf4ff,stroke:#54aeff,color:#0550ae\n';
  output +=
    '  classDef spawned_noexit fill:#fff3cd,stroke:#d4a72c,stroke-width:2px,color:#633c01\n';
  output += '  classDef channel fill:#fff8c5,stroke:#d4a72c,color:#633c01\n';

  return output;
}
