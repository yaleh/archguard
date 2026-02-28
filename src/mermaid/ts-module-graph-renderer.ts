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
  return node.moduleNode ? node.moduleNode.id : node.virtualId!;
}

/**
 * After the initial forest is built, group root nodes that share a common
 * path prefix (when that prefix itself is NOT a real node) into a synthetic
 * virtual parent subgraph.  Only groups of 2+ nodes are merged; a lone node
 * is left ungrouped.  Applied recursively until stable.
 */
function applyVirtualGrouping(roots: TreeNode[], realNodeIds: Set<string>): TreeNode[] {
  const prefixGroups = new Map<string, TreeNode[]>();
  const ungrouped: TreeNode[] = [];

  for (const root of roots) {
    const id = nodeTreeId(root);
    const parent = parentPath(id);
    if (parent !== null && !realNodeIds.has(parent)) {
      const list = prefixGroups.get(parent) ?? [];
      list.push(root);
      prefixGroups.set(parent, list);
    } else {
      ungrouped.push(root);
    }
  }

  let changed = false;
  const result: TreeNode[] = [...ungrouped];
  for (const [parentId, children] of prefixGroups) {
    if (children.length >= 2) {
      result.push({ moduleNode: null, virtualId: parentId, children });
      changed = true;
    } else {
      result.push(...children);
    }
  }

  // Re-apply until no more groupings can be formed (handles multi-level gaps)
  return changed ? applyVirtualGrouping(result, realNodeIds) : result;
}

/**
 * Build a forest (list of root TreeNodes) from the internal nodes,
 * honouring only parent-child relationships where the parent is also
 * present in the node set.  After tree construction, virtual parent nodes
 * are injected for orphan sibling groups.
 */
function buildForest(internalNodes: TsModuleNode[]): TreeNode[] {
  const realNodeIds = new Set(internalNodes.map((n) => n.id));
  const byId = new Map<string, TreeNode>();
  for (const n of internalNodes) {
    byId.set(n.id, { moduleNode: n, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const n of internalNodes) {
    const parent = parentPath(n.id);
    if (parent !== null && byId.has(parent)) {
      byId.get(parent)!.children.push(byId.get(n.id)!);
    } else {
      roots.push(byId.get(n.id)!);
    }
  }

  return applyVirtualGrouping(roots, realNodeIds);
}

/**
 * Emit Mermaid lines for a single tree node.
 * If the node has children it is wrapped in a subgraph block.
 * Virtual nodes emit only the subgraph wrapper (no self-declaration inside).
 * Indentation is controlled by the `depth` parameter.
 */
function emitTreeNode(node: TreeNode, lines: string[], depth: number): void {
  const pad = '  '.repeat(depth);
  const id = nodeTreeId(node);
  const nid = toNodeId(id);
  const label = id || '(root)';

  if (node.children.length === 0) {
    // Leaf node – plain declaration
    lines.push(`${pad}${nid}["${label}"]`);
  } else {
    // Parent or virtual node – wrap in subgraph
    const sgId = `${nid}_group`;
    lines.push(`${pad}subgraph ${sgId}["${label}"]`);
    if (node.moduleNode !== null) {
      // Real parent declares itself inside the subgraph
      lines.push(`${pad}  ${nid}["${label}"]`);
    }
    for (const child of node.children) {
      emitTreeNode(child, lines, depth + 1);
    }
    lines.push(`${pad}end`);
  }
}

/**
 * Render a TsModuleGraph as a Mermaid flowchart LR string.
 */
export function renderTsModuleGraph(graph: TsModuleGraph): string {
  const lines: string[] = [];

  lines.push('flowchart LR');
  lines.push('  classDef external stroke-dasharray: 5 5,fill:#f9f9f9,stroke:#aaa');
  lines.push('');

  // Partition nodes into internal and external
  const internalNodes = graph.nodes.filter((n) => n.type !== 'node_modules');
  const externalNodes = graph.nodes.filter((n) => n.type === 'node_modules');

  // --- Internal nodes: emit with subgraph hierarchy ---
  const forest = buildForest(internalNodes);
  for (const root of forest) {
    emitTreeNode(root, lines, 1);
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
    const label = edge.strength > 1 ? `|${edge.strength}|` : '';
    lines.push(`  ${fromId} ${arrow}${label} ${toId}`);
    edgeIndex++;
  }

  for (const edge of cycleEdges) {
    const fromId = toNodeId(edge.from);
    const toId = toNodeId(edge.to);
    const arrow = arrowStyle(edge.strength);
    const label = edge.strength > 1 ? `|${edge.strength}|` : '';
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
