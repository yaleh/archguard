/**
 * TsModuleGraph Mermaid Renderer
 *
 * Renders a TsModuleGraph as a Mermaid flowchart LR diagram with subgraph
 * hierarchy for internal packages.
 *
 * Hierarchy rules:
 *   A node "A/B" is a child of node "A" when "A" is also present in the node list.
 *   Nesting is applied recursively, so "A/B/C" lives inside "A/B" inside "A".
 *   External (node_modules) nodes are collected into a dedicated subgraph.
 *
 * Edge strength tiers:
 *   thin   (strength 1–2):   -->
 *   medium (strength 3–9):   ==>
 *   thick  (strength 10+):   ===>
 *
 * Cycle edges are rendered in red via linkStyle.
 */

import type { TsModuleGraph, TsModuleDependency, TsModuleNode } from '@/types/extensions.js';

/**
 * Depth-based fill/stroke palette for subgraph backgrounds.
 * Index 0 = depth-1 (outermost), index 3 = depth-4+ (clamped).
 */
const SUBGRAPH_DEPTH_STYLES = [
  'fill:#ffffff,stroke:#d0d7de,stroke-width:1px', // depth-1 (palette index 0) — outermost
  'fill:#f6f8fa,stroke:#d0d7de,stroke-width:1px', // depth-2 (palette index 1)
  'fill:#eaeef2,stroke:#8b949e,stroke-width:1px', // depth-3 (palette index 2)
  'fill:#d0d7de,stroke:#57606a,stroke-width:1px', // depth-4+ (palette index 3, clamped)
];

/**
 * Sanitize a module ID to a valid Mermaid node identifier.
 * Replaces slashes, dots, hyphens, @, and colons with underscores.
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
 * Return the parent path of a module ID, or null if it has no parent.
 * e.g. "cli/commands" → "cli",  "cli" → null
 */
function parentPath(id: string): string | null {
  const slash = id.lastIndexOf('/');
  return slash > 0 ? id.slice(0, slash) : null;
}

/**
 * A tree node used to build the package hierarchy.
 * `moduleNode` is null for virtual (synthetic) parent nodes.
 */
interface TreeNode {
  moduleNode: TsModuleNode | null;
  virtualId?: string;
  children: TreeNode[];
}

/** Return the canonical ID of a tree node (real or virtual). */
function nodeTreeId(node: TreeNode): string {
  return node.moduleNode ? node.moduleNode.id : node.virtualId;
}

/**
 * Build a forest from internal nodes using a path-segment trie.
 *
 * Steps:
 *  1. Register every node ID + all its ancestor segments into a trie
 *     (Map<parentId|null → Set<childId>>).
 *  2. Recursively build TreeNodes from trie root (null).
 *     - Real nodes: add trie-children as node.children (natural ancestor attachment).
 *     - Virtual nodes: path-compress if 1 child; create subgraph wrapper if 2+ children.
 */
function buildForest(internalNodes: TsModuleNode[]): TreeNode[] {
  const realNodeIds = new Set(internalNodes.map((n) => n.id));
  const byId = new Map<string, TreeNode>();
  for (const n of internalNodes) {
    byId.set(n.id, { moduleNode: n, children: [] });
  }

  // Build trie: parent path (null = root) → set of direct child path segments
  const trieChildren = new Map<string | null, Set<string>>();
  for (const id of realNodeIds) {
    let cur: string = id;
    let par: string | null = parentPath(cur);
    while (true) {
      if (!trieChildren.has(par)) trieChildren.set(par, new Set());
      trieChildren.get(par).add(cur);
      if (par === null) break;
      cur = par;
      par = parentPath(cur);
    }
  }

  function buildSubtree(parentId: string | null): TreeNode[] {
    const children = trieChildren.get(parentId);
    if (!children) return [];
    const result: TreeNode[] = [];
    for (const childId of children) {
      if (realNodeIds.has(childId)) {
        const treeNode = byId.get(childId);
        for (const c of buildSubtree(childId)) treeNode.children.push(c);
        result.push(treeNode);
      } else {
        const sub = buildSubtree(childId);
        if (sub.length === 0) {
          /* no real descendants — skip */
        } else if (sub.length === 1)
          result.push(sub[0]); // path compression
        else result.push({ moduleNode: null, virtualId: childId, children: sub });
      }
    }
    return result;
  }

  return buildSubtree(null);
}

/**
 * Emit Mermaid lines for a single tree node.
 * If the node has children it is wrapped in a subgraph block.
 * Virtual nodes emit only the subgraph wrapper (no self-declaration inside).
 * Indentation is controlled by the `depth` parameter.
 *
 * `subgraphStyles` accumulates { id, depth } records for every subgraph
 * opened, so the caller can emit `style` directives after all subgraphs.
 *
 * `cycleNodeIds` is the set of module IDs participating in a cycle;
 * real module nodes in this set receive :::cycle instead of :::internal.
 */
function emitTreeNode(
  node: TreeNode,
  lines: string[],
  depth: number,
  subgraphStyles: Array<{ id: string; depth: number }>,
  cycleNodeIds: Set<string>
): void {
  const pad = '  '.repeat(depth);
  const id = nodeTreeId(node);
  const nid = toNodeId(id);
  const label = id || '(root)';

  // Role annotation only for real module nodes (moduleNode !== null).
  // Virtual (synthetic) parent nodes get no annotation.
  const roleClass =
    node.moduleNode !== null ? (cycleNodeIds.has(id) ? ':::cycle' : ':::internal') : '';

  if (node.children.length === 0) {
    // Leaf node – plain declaration with role annotation
    lines.push(`${pad}${nid}["${label}"]${roleClass}`);
  } else {
    // Parent or virtual node – wrap in subgraph
    const sgId = `${nid}_group`;
    subgraphStyles.push({ id: sgId, depth }); // record depth before recursing
    lines.push(`${pad}subgraph ${sgId}["${label}"]`);
    if (node.moduleNode !== null) {
      // Real parent declares itself inside the subgraph with role annotation
      lines.push(`${pad}  ${nid}["${label}"]${roleClass}`);
    }
    for (const child of node.children) {
      emitTreeNode(child, lines, depth + 1, subgraphStyles, cycleNodeIds);
    }
    lines.push(`${pad}end`);
  }
}

/**
 * Render a TsModuleGraph as a Mermaid flowchart LR string.
 */
export function renderTsModuleGraph(graph: TsModuleGraph): string {
  const lines: string[] = [];

  lines.push("%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'curve': 'basis'}}}%%");
  lines.push('flowchart LR');
  lines.push('');

  // Partition nodes into internal and external
  const internalNodes = graph.nodes.filter((n) => n.type !== 'node_modules');
  const externalNodes = graph.nodes.filter((n) => n.type === 'node_modules');

  // Build cycle node set for :::cycle role annotation
  const cycleNodeIds = new Set(graph.cycles.flatMap((c) => c.modules));

  // --- Internal nodes: emit with subgraph hierarchy ---
  const subgraphStyles: Array<{ id: string; depth: number }> = [];
  const forest = buildForest(internalNodes);
  for (const root of forest) {
    emitTreeNode(root, lines, 1, subgraphStyles, cycleNodeIds);
  }

  // --- External nodes: group in a dedicated subgraph ---
  if (externalNodes.length > 0) {
    lines.push('  subgraph external_deps["External Dependencies"]');
    for (const node of externalNodes) {
      const nid = toNodeId(node.id);
      const label = node.id;
      lines.push(`    ${nid}["${label}"]:::external`);
    }
    lines.push('  end');
  }

  // --- Legend subgraph (before style directives — matches Go Atlas section order) ---
  lines.push('  subgraph legend["Legend"]');
  lines.push('    direction LR');
  lines.push('    legend_internal["internal module"]:::internal');
  if (externalNodes.length > 0) {
    lines.push('    legend_external["external dependency"]:::external');
  }
  if (cycleNodeIds.size > 0) {
    lines.push('    legend_cycle["cycle \u26a0"]:::cycle');
  }
  lines.push('    legend_edge["--> depends on (bolder = more imports)"]');
  lines.push('  end');
  lines.push('  style legend fill:#fff8c5,stroke:#d4a72c,stroke-dasharray:5 5,color:#633c01');
  lines.push('');

  // --- Depth-based subgraph background styles ---
  for (const { id, depth } of subgraphStyles) {
    const paletteIndex = Math.min(depth - 1, SUBGRAPH_DEPTH_STYLES.length - 1);
    lines.push(`  style ${id} ${SUBGRAPH_DEPTH_STYLES[paletteIndex]}`);
  }
  if (externalNodes.length > 0) {
    lines.push(`  style external_deps fill:#ffffff,stroke:#d0d7de,stroke-width:1px`);
  }

  lines.push('');

  // --- classDef block (before edges — matches Go Atlas output order) ---
  lines.push('  classDef internal fill:#dafbe1,stroke:#2da44e,color:#116329');
  lines.push('  classDef external fill:#fff8c5,stroke:#d4a72c,color:#633c01');
  lines.push(
    '  classDef cycle    fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#82071e,font-weight:bold'
  );
  lines.push('');

  // --- Edges ---
  // Build cycle edge set for quick lookup
  const cycleModuleSets: Array<Set<string>> = graph.cycles.map((c) => new Set(c.modules));
  const isCycleEdge = (edge: TsModuleDependency): boolean =>
    cycleModuleSets.some((s) => s.has(edge.from) && s.has(edge.to));

  const normalEdges: TsModuleDependency[] = [];
  const cycleEdges: TsModuleDependency[] = [];
  for (const edge of graph.edges) {
    if (isCycleEdge(edge)) {
      cycleEdges.push(edge);
    } else {
      normalEdges.push(edge);
    }
  }

  let edgeIndex = 0;
  const cycleEdgeIndices: number[] = [];

  for (const edge of normalEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    edgeIndex++;
  }

  for (const edge of cycleEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    cycleEdgeIndices.push(edgeIndex);
    edgeIndex++;
  }

  if (cycleEdgeIndices.length > 0) {
    lines.push('');
    for (const idx of cycleEdgeIndices) {
      lines.push(`  linkStyle ${idx} stroke:#e74c3c,stroke-width:2px`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
