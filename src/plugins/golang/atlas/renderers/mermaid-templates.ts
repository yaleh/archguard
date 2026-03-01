import path from 'path';
import type {
  PackageGraph,
  PackageNode,
  CapabilityGraph,
  CapabilityNode,
  GoroutineTopology,
  GoroutineLifecycleSummary,
  FlowGraph,
  EntryPoint,
} from '../types.js';

interface GroupNode {
  prefix: string;
  children: GroupNode[];
  nodeIds: string[];
}

/** A node in the package prefix tree for capability/goroutine renderers */
interface PkgTreeNode {
  pkg: string; // full package path (empty string = virtual ancestor)
  isVirtual: boolean; // true = no real nodes, exists only as a grouping ancestor
  children: PkgTreeNode[];
}

/**
 * Mermaid template renderer for Go Atlas layers
 */
export class MermaidTemplates {
  // ── nested subgraph grouping ───────────────────────────────────────────────
  //
  // Two complementary helpers build prefix-tree structures:
  //
  //   buildGroupTree()   — used by renderPackageGraph.  Groups PackageNode[]
  //                        into ancestor prefix subgraphs when ≥2 nodes share
  //                        a prefix.  Each node is assigned to its deepest
  //                        valid group.
  //
  //   buildPackageTree() — used by renderCapabilityGraph and
  //                        renderGoroutineTopology.  Every real package path
  //                        becomes its own subgraph; virtual ancestor nodes
  //                        are inserted when ≥2 siblings share a prefix that
  //                        is not itself a real package.
  //
  // TODO: potential collision if group labels exceed 59 chars after sanitize
  /**
   * buildPackageTree(): builds a prefix tree for a list of known package paths.
   *
   * Every real package becomes a PkgTreeNode.  When ≥2 real packages share a
   * common ancestor prefix that is NOT itself a known package, a virtual node
   * is inserted so that the two siblings are grouped under a common subgraph.
   *
   * Returns the root-level PkgTreeNodes (could be real or virtual).
   */
  private static buildPackageTree(packages: string[]): PkgTreeNode[] {
    const pkgSet = new Set(packages);

    // Collect all ancestor prefixes that have ≥2 real packages beneath them
    const prefixCount = new Map<string, number>();
    for (const pkg of packages) {
      const segs = pkg.split('/');
      for (let d = 1; d < segs.length; d++) {
        const prefix = segs.slice(0, d).join('/');
        prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
      }
    }
    // A prefix becomes a virtual group if it has ≥2 packages beneath it
    // AND is not itself a known package (real packages get their own nodes)
    const virtualGroups = new Set<string>();
    for (const [prefix, count] of prefixCount) {
      if (count >= 2 && !pkgSet.has(prefix)) {
        virtualGroups.add(prefix);
      }
    }

    // All nodes in the tree (real + virtual)
    const allPrefixes = new Set([...packages, ...virtualGroups]);
    const nodeMap = new Map<string, PkgTreeNode>();
    for (const p of allPrefixes) {
      nodeMap.set(p, { pkg: p, isVirtual: !pkgSet.has(p), children: [] });
    }

    // Find the immediate parent (longest matching ancestor in allPrefixes)
    const parentOf = (pkg: string): string | null => {
      const segs = pkg.split('/');
      for (let d = segs.length - 1; d >= 1; d--) {
        const prefix = segs.slice(0, d).join('/');
        if (allPrefixes.has(prefix)) return prefix;
      }
      return null;
    };

    // Wire parent→child edges
    const roots: PkgTreeNode[] = [];
    for (const p of allPrefixes) {
      const parent = parentOf(p);
      if (parent && nodeMap.has(parent)) {
        nodeMap.get(parent).children.push(nodeMap.get(p));
      } else {
        roots.push(nodeMap.get(p));
      }
    }

    return roots;
  }

  private static buildGroupTree(nodes: Array<{ id: string; name: string }>): {
    roots: GroupNode[];
    grouped: Set<string>;
  } {
    // Count all nodes under every ancestor prefix
    const prefixMembers = new Map<string, string[]>();
    for (const node of nodes) {
      const segs = node.name.split('/');
      for (let d = 1; d <= segs.length; d++) {
        const prefix = segs.slice(0, d).join('/');
        const arr = prefixMembers.get(prefix) ?? [];
        arr.push(node.id);
        prefixMembers.set(prefix, arr);
      }
    }

    // Valid groups: prefixes with ≥2 nodes below them
    const validPrefixes = new Set<string>();
    for (const [prefix, ids] of prefixMembers) {
      if (ids.length >= 2) validPrefixes.add(prefix);
    }

    // Deepest valid group prefix for a node name
    const deepestGroupFor = (name: string): string | null => {
      const segs = name.split('/');
      for (let d = segs.length; d >= 1; d--) {
        const prefix = segs.slice(0, d).join('/');
        if (validPrefixes.has(prefix)) return prefix;
      }
      return null;
    };

    // Immediate valid parent group for a prefix
    const parentGroupFor = (prefix: string): string | null => {
      const segs = prefix.split('/');
      for (let d = segs.length - 1; d >= 1; d--) {
        const p = segs.slice(0, d).join('/');
        if (validPrefixes.has(p)) return p;
      }
      return null;
    };

    // Build GroupNode objects
    const nodeObjects = new Map<string, GroupNode>();
    for (const prefix of validPrefixes) {
      nodeObjects.set(prefix, { prefix, children: [], nodeIds: [] });
    }

    // Wire parent–child relationships
    const roots: GroupNode[] = [];
    for (const prefix of validPrefixes) {
      const parent = parentGroupFor(prefix);
      if (parent && nodeObjects.has(parent)) {
        nodeObjects.get(parent).children.push(nodeObjects.get(prefix));
      } else {
        roots.push(nodeObjects.get(prefix));
      }
    }

    // Assign each node to its deepest group
    const grouped = new Set<string>();
    for (const node of nodes) {
      const group = deepestGroupFor(node.name);
      if (group && nodeObjects.has(group)) {
        nodeObjects.get(group).nodeIds.push(node.id);
        grouped.add(node.id);
      }
    }

    return { roots, grouped };
  }

  // Recursive subgraph renderer
  private static renderGroupNodes(
    groups: GroupNode[],
    nodeMap: Map<string, PackageNode>,
    cycleNodeIds: Set<string>,
    indent: string
  ): string {
    let out = '';
    for (const group of groups) {
      const sgId = 'grp_' + MermaidTemplates.sanitizeId(group.prefix);
      out += `\n${indent}subgraph ${sgId}["${group.prefix}"]\n`;
      // Recurse: emit nested child groups first
      out += MermaidTemplates.renderGroupNodes(
        group.children,
        nodeMap,
        cycleNodeIds,
        indent + '  '
      );
      // Then emit this group's direct node members
      for (const nodeId of group.nodeIds) {
        const node = nodeMap.get(nodeId);
        const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
        out += `${indent}  ${MermaidTemplates.sanitizeId(node.id)}["${node.name}"]${style}\n`;
      }
      out += `${indent}end\n`;
    }
    return out;
  }

  static renderPackageGraph(graph: PackageGraph): string {
    let output = 'flowchart TB\n';

    // --- cycle detection (P2) ---
    const cycleNodeIds = new Set(
      graph.cycles.filter((c) => c.packages.length > 1).flatMap((c) => c.packages)
    );

    // --- nested subgraph grouping (P4) ---
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const { roots, grouped } = MermaidTemplates.buildGroupTree(graph.nodes);

    // Pass 1: ungrouped top-level nodes
    for (const node of graph.nodes) {
      if (!grouped.has(node.id)) {
        const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
        output += `  ${MermaidTemplates.sanitizeId(node.id)}["${node.name}"]${style}\n`;
      }
    }

    // Pass 1 cont.: recursive subgraph tree
    output += MermaidTemplates.renderGroupNodes(roots, nodeMap, cycleNodeIds, '  ');

    // Pass 2: classDef block — placed before edges so lastIndexOf('end') in
    // 'vendor' substring doesn't produce a false negative for the edge-ordering test
    output += '\n';
    output += '  classDef cmd      fill:#ff6b6b,stroke:#c0392b,color:#000\n';
    output += '  classDef tests    fill:#b2bec3,stroke:#636e72,color:#000\n';
    output += '  classDef examples fill:#74b9ff,stroke:#0984e3,color:#000\n';
    output += '  classDef testutil fill:#dfe6e9,stroke:#b2bec3,color:#000\n';
    output += '  classDef internal fill:#55efc4,stroke:#00b894,color:#000\n';
    output += '  classDef vendor   fill:#f0e6ff,stroke:#9b59b6,color:#000\n';
    output += '  classDef external fill:#ffeaa7,stroke:#fdcb6e,color:#000\n';
    output += '  classDef cycle    fill:#fd79a8,stroke:#e84393,stroke-width:3px\n';

    // Pass 3: edges (self-loops get dashed warning arrow per P2)
    // Track (edgeIndex, strength) for non-self edges to compute linkStyle tiers.
    const edgeThicknesses: Array<{ index: number; strength: number }> = [];
    let edgeIndex = 0;
    output += '\n';
    for (const edge of graph.edges) {
      const fromId = MermaidTemplates.sanitizeId(edge.from);
      const toId = MermaidTemplates.sanitizeId(edge.to);
      if (edge.from === edge.to) {
        output += `  ${fromId} -.->|"⚠ self"| ${toId}\n`;
        edgeIndex++;
        continue;
      }
      const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
      output += `  ${fromId} -->${label} ${toId}\n`;
      edgeThicknesses.push({ index: edgeIndex, strength: edge.strength });
      edgeIndex++;
    }

    // Pass 3b: dynamic linkStyle for edge thickness tiers
    if (edgeThicknesses.length > 0) {
      const tiers = MermaidTemplates.computePackageEdgeTiers(
        edgeThicknesses.map((e) => e.strength)
      );
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

    // Pass 4: cycle comment — MUST be retained (atlas-renderer.test.ts:282)
    if (graph.cycles.length > 0) {
      output += '\n  %% Cycles detected:\n';
      for (const cycle of graph.cycles) {
        output += `  %% ${cycle.severity}: ${cycle.packages.join(' → ')}\n`;
      }
    }

    return output;
  }

  static renderCapabilityGraph(graph: CapabilityGraph): string {
    if (graph.nodes.length === 0) {
      return 'flowchart LR';
    }

    let output = 'flowchart LR\n';

    // Group capability nodes by package
    const nodesByPkg = new Map<string, CapabilityNode[]>();
    for (const node of graph.nodes) {
      if (!nodesByPkg.has(node.package)) nodesByPkg.set(node.package, []);
      nodesByPkg.get(node.package).push(node);
    }

    // Build prefix-tree using buildPackageTree — every real package gets a
    // subgraph; virtual ancestor nodes group siblings under a common parent.
    const pkgList = Array.from(nodesByPkg.keys());
    const pkgRoots = MermaidTemplates.buildPackageTree(pkgList);

    // Track whether any node qualifies for hotspot styling
    let hasHotspot = false;

    // Recursive subgraph renderer for capability graph
    const renderCapNode = (treeNode: PkgTreeNode, indent: string): void => {
      const sgId = 'grp_' + MermaidTemplates.sanitizeId(treeNode.pkg);
      output += `${indent}subgraph ${sgId}["${treeNode.pkg}"]\n`;
      // Recurse into children first
      for (const child of treeNode.children) {
        renderCapNode(child, indent + '  ');
      }
      // Direct capability nodes for this real package (virtual nodes have none)
      if (!treeNode.isVirtual) {
        for (const node of nodesByPkg.get(treeNode.pkg) ?? []) {
          const mId = MermaidTemplates.sanitizeId(node.id);
          const label = MermaidTemplates.formatCapabilityLabel(node);
          const hotspotSuffix = MermaidTemplates.isHotspot(node) ? ':::hotspot' : '';
          if (hotspotSuffix) hasHotspot = true;
          if (node.type === 'interface') {
            output += `${indent}  ${mId}{{"${label}"}}${hotspotSuffix}\n`;
          } else {
            output += `${indent}  ${mId}["${label}"]${hotspotSuffix}\n`;
          }
        }
      }
      output += `${indent}end\n`;
    };

    for (const root of pkgRoots) {
      renderCapNode(root, '');
    }

    // Emit hotspot classDef only when at least one node qualifies
    if (hasHotspot) {
      output += '  classDef hotspot fill:#ff7675,stroke:#d63031,stroke-width:2px\n';
    }

    // Render edges after all subgraphs
    for (const edge of graph.edges) {
      const src = MermaidTemplates.sanitizeId(edge.source);
      const tgt = MermaidTemplates.sanitizeId(edge.target);
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

  private static formatCapabilityLabel(node: CapabilityNode): string {
    const sizeParts: string[] = [];
    if ((node.fieldCount ?? 0) > 0) sizeParts.push(`${node.fieldCount}f`);
    if ((node.methodCount ?? 0) > 0) sizeParts.push(`${node.methodCount}m`);

    const couplingParts: string[] = [];
    if ((node.fanIn ?? 0) > 0) couplingParts.push(`fi:${node.fanIn}`);
    if ((node.fanOut ?? 0) > 0) couplingParts.push(`fo:${node.fanOut}`);

    if (sizeParts.length === 0 && couplingParts.length === 0) {
      return node.name;
    }

    const sections: string[] = [];
    if (sizeParts.length > 0) sections.push(sizeParts.join(' '));
    if (couplingParts.length > 0) sections.push(couplingParts.join(' '));

    return `${node.name} [${sections.join(' | ')}]`;
  }

  private static isHotspot(node: CapabilityNode): boolean {
    return (node.methodCount ?? 0) > 10 || (node.fanIn ?? 0) > 5;
  }

  /**
   * Compute dynamic stroke-width tiers for package-graph edges.
   *
   * Uses the 50th (median) and 85th percentile of the strength distribution
   * as tier boundaries:
   *   - strength ≤ median      → default (no linkStyle emitted)
   *   - median < strength < p85 → medium  (3px)
   *   - strength ≥ p85         → heavy   (5px)
   *
   * Falls back to a min / max split when the median equals the maximum
   * (highly skewed or very few distinct values).
   *
   * Returns an empty map when all edges share the same strength (uniform).
   */
  static computePackageEdgeTiers(strengths: number[]): Map<number, number> {
    if (strengths.length === 0) return new Map();
    const sorted = [...strengths].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    if (max === min) return new Map();

    const n = sorted.length;
    let thMedium = sorted[Math.min(Math.floor(n * 0.5), n - 1)]; // median
    let thHeavy = sorted[Math.min(Math.floor(n * 0.85), n - 1)]; // 85th percentile

    // Fallback: when median collapses to max, split on min / max instead
    if (thMedium >= max) {
      thMedium = min;
      thHeavy = max;
    }

    const result = new Map<number, number>();
    for (const s of new Set(strengths)) {
      if (s >= thHeavy) {
        result.set(s, 5.0); // heavy: top ~15%
      } else if (s > thMedium) {
        result.set(s, 3.0); // medium: p50–p85
      }
      // ≤ thMedium: default stroke (no linkStyle)
    }
    return result;
  }

  static renderGoroutineTopology(topology: GoroutineTopology): string {
    let output = 'flowchart TB\n';

    // ── Build package groups ──────────────────────────────────────────────────
    type NodeDecl = { rawId: string; label: string; style: string };
    const packageGroups = new Map<string, NodeDecl[]>();
    const ungrouped: NodeDecl[] = [];
    const declaredIds = new Set<string>();

    const addDecl = (pkg: string | undefined, decl: NodeDecl) => {
      if (pkg) {
        if (!packageGroups.has(pkg)) packageGroups.set(pkg, []);
        packageGroups.get(pkg).push(decl);
      } else {
        ungrouped.push(decl);
      }
      declaredIds.add(decl.rawId);
    };

    // Build nodeId → package lookup for spawner inference
    const nodeIdToPackage = new Map<string, string>();
    for (const node of topology.nodes) {
      if (node.package) nodeIdToPackage.set(node.id, node.package);
    }

    // Add topology nodes (main, spawned)
    for (const node of topology.nodes) {
      const style = node.type === 'main' ? ':::main' : ':::spawned';
      const patternLabel = node.pattern ? ` (${node.pattern})` : '';
      const displayName = MermaidTemplates.formatGoroutineName(node);
      const lifecycleTag =
        node.type === 'spawned'
          ? MermaidTemplates.getLifecycleTag(node.id, topology.lifecycle)
          : '';
      addDecl(node.package || undefined, {
        rawId: node.id,
        label: `${displayName}${patternLabel}${lifecycleTag}`,
        style,
      });
    }

    // Add spawner nodes (infer package from corresponding spawned node)
    for (const edge of topology.edges) {
      if (!declaredIds.has(edge.from)) {
        const label = MermaidTemplates.formatSpawnerLabel(edge.from);
        const pkg = nodeIdToPackage.get(edge.to);
        addDecl(pkg, { rawId: edge.from, label, style: ':::spawner' });
      }
    }

    // Add spawner nodes from channelEdges (goroutine node IDs that aren't channels)
    for (const edge of topology.channelEdges) {
      if (!edge.from.startsWith('chan-') && !declaredIds.has(edge.from)) {
        const label = MermaidTemplates.formatSpawnerLabel(edge.from);
        const pkg = nodeIdToPackage.get(edge.to);
        addDecl(pkg, { rawId: edge.from, label, style: ':::spawner' });
      }
    }

    // ── Emit package subgraphs (nested via buildPackageTree) ─────────────────
    const pkgList = Array.from(packageGroups.keys());
    const pkgRoots = MermaidTemplates.buildPackageTree(pkgList);

    const renderGoroutineNode = (treeNode: PkgTreeNode, indent: string): void => {
      const sgId = 'grp_' + MermaidTemplates.sanitizeId(treeNode.pkg);
      output += `\n${indent}subgraph ${sgId}["${treeNode.pkg}"]\n`;
      // Recurse into children first
      for (const child of treeNode.children) {
        renderGoroutineNode(child, indent + '  ');
      }
      // Direct goroutine nodes for this real package (virtual nodes have none)
      if (!treeNode.isVirtual) {
        for (const decl of packageGroups.get(treeNode.pkg) ?? []) {
          output += `${indent}  ${this.sanitizeId(decl.rawId)}["${decl.label}"]${decl.style}\n`;
        }
      }
      output += `${indent}end\n`;
    };

    for (const root of pkgRoots) {
      renderGoroutineNode(root, '  ');
    }

    // ── Emit ungrouped nodes (no package) ────────────────────────────────────
    for (const decl of ungrouped) {
      output += `  ${this.sanitizeId(decl.rawId)}["${decl.label}"]${decl.style}\n`;
    }

    // ── Emit spawn edges ──────────────────────────────────────────────────────
    for (const edge of topology.edges) {
      output += `  ${this.sanitizeId(edge.from)} -->|go| ${this.sanitizeId(edge.to)}\n`;
    }

    // ── Channels subgraph ─────────────────────────────────────────────────────
    if (topology.channels.length > 0) {
      output += '\n  subgraph channels\n';
      for (const ch of topology.channels) {
        const label = ch.type !== 'chan' ? ch.type : MermaidTemplates.formatChannelLabel(ch.id);
        output += `    ${this.sanitizeId(ch.id)}[("${label}")]:::channel\n`;
      }
      output += '  end\n';
    }

    // ── Emit channel edges (make / send / recv) ────────────────────────────────
    for (const edge of topology.channelEdges) {
      output += `  ${this.sanitizeId(edge.from)} -->|${edge.edgeType}| ${this.sanitizeId(edge.to)}\n`;
    }

    output += '\n  classDef main fill:#f66,stroke:#333,stroke-width:2px\n';
    output += '  classDef spawned fill:#6f6,stroke:#333,stroke-width:1px\n';
    output += '  classDef spawner fill:#69f,stroke:#333,stroke-width:1px\n';
    output += '  classDef channel fill:#ff6,stroke:#333,stroke-width:1px\n';

    return output;
  }

  static renderFlowGraph(graph: FlowGraph, format: 'flowchart' | 'sequence' = 'flowchart'): string {
    if (format === 'sequence') {
      let output = 'sequenceDiagram\n';

      for (const chain of graph.callChains) {
        const entry = graph.entryPoints.find((e) => e.id === chain.entryPoint);
        if (!entry) continue;

        // Only emit Note when handler is a valid non-empty identifier
        const handlerId = this.sanitizeId(entry.handler);
        if (handlerId) {
          const entryLabel = MermaidTemplates.formatEntryLabel(entry);
          output += `\n  Note over ${handlerId}: ${entryLabel}\n`;
        }

        for (const call of chain.calls) {
          const fromId = this.sanitizeId(call.from);
          const toId = this.sanitizeId(call.to);
          if (!fromId || !toId) continue;
          output += `  ${fromId}->>+${toId}: call\n`;
          output += `  ${toId}-->>-${fromId}: return\n`;
        }
      }

      return output;
    }

    // flowchart LR — group entry points by package using prefix tree
    let output = 'flowchart LR\n';

    // Group entry points by package (fall back to dirname when package is absent)
    const pkgGroups = new Map<string, EntryPoint[]>();
    for (const entry of graph.entryPoints) {
      const pkg = entry.package ?? path.dirname(entry.location.file);
      if (!pkgGroups.has(pkg)) pkgGroups.set(pkg, []);
      pkgGroups.get(pkg).push(entry);
    }

    // Build nested package prefix tree (same as capability / goroutine renderers)
    const pkgPaths = Array.from(pkgGroups.keys());
    const pkgTree = MermaidTemplates.buildPackageTree(pkgPaths);

    // Recursive renderer: emit subgraph per tree node
    const renderEntryPkg = (node: PkgTreeNode, indent: string): void => {
      const sgId = 'grp_' + MermaidTemplates.sanitizeId(node.pkg);
      output += `${indent}subgraph ${sgId}["${node.pkg}"]\n`;
      for (const child of node.children) {
        renderEntryPkg(child, indent + '  ');
      }
      // Only real package nodes have entry points (virtual ancestors have none)
      if (!node.isVirtual) {
        for (const entry of pkgGroups.get(node.pkg) ?? []) {
          const nodeId = MermaidTemplates.sanitizeId(entry.id);
          const label = MermaidTemplates.formatEntryLabel(entry);
          output += `${indent}  ${nodeId}["${label}"]\n`;
        }
      }
      output += `${indent}end\n`;
    };

    for (const root of pkgTree) {
      renderEntryPkg(root, '  ');
    }

    // Track nodes already declared inside subgraphs (entry point nodes)
    const declaredNodeIds = new Set<string>(graph.entryPoints.map((e) => this.sanitizeId(e.id)));

    // Emit call-chain edges — deduplicated across all chains
    const emittedEdges = new Set<string>();
    const addEdge = (from: string, to: string, label?: string): void => {
      const key = `${from}\x00${to}`;
      if (emittedEdges.has(key)) return;
      emittedEdges.add(key);
      if (label) {
        output += `  ${from} -->|${label}| ${to}\n`;
      } else {
        output += `  ${from} --> ${to}\n`;
      }
    };

    // Declare a node with its original name as label (skip if already declared)
    const declareNode = (id: string, originalName: string): void => {
      if (declaredNodeIds.has(id)) return;
      declaredNodeIds.add(id);
      output += `  ${id}["${originalName}"]\n`;
    };

    for (const chain of graph.callChains) {
      const entry = graph.entryPoints.find((e) => e.id === chain.entryPoint);
      if (!entry || chain.calls.length === 0) continue;

      const entryNodeId = this.sanitizeId(entry.id);
      const handlerNodeId = this.sanitizeId(entry.handler);

      // Declare handler node with its original dotted name as label
      declareNode(handlerNodeId, entry.handler);

      // entry → handler: emit exactly once, label = unique call count
      const entryLabel = `"${chain.calls.length} calls"`;
      addEdge(entryNodeId, handlerNodeId, entryLabel);

      // handler → callee: deduplicated
      for (const call of chain.calls) {
        const fromId = this.sanitizeId(call.from);
        const toId = this.sanitizeId(call.to);
        if (!fromId || !toId) continue;
        // Declare both endpoints with their original dotted names as labels
        declareNode(fromId, call.from);
        declareNode(toId, call.to);
        addEdge(fromId, toId);
      }
    }

    return output;
  }

  private static formatEntryLabel(entry: EntryPoint): string {
    if (entry.protocol === 'http') {
      const m = entry.method ?? 'HTTP';
      return `${m} ${entry.path}`;
    }
    if (entry.protocol === 'grpc')      return `gRPC ${entry.path}`;
    if (entry.protocol === 'cli')       return `CMD ${entry.path || entry.handler}`;
    if (entry.protocol === 'message')   return `MSG ${entry.path}`;
    if (entry.protocol === 'scheduler') return `CRON ${entry.path}`;
    return entry.path || entry.id;
  }

  private static formatSpawnerLabel(nodeId: string): string {
    // Strip package path prefix (everything before last '/')
    const slashIdx = nodeId.lastIndexOf('/');
    const afterSlash = slashIdx >= 0 ? nodeId.slice(slashIdx + 1) : nodeId;
    // If method (3+ dot-parts like "hub.WorkerPool.Start"), return last 2
    // If function (1-2 dot-parts like "capabilities.NewMemoryRegistry"), return as-is
    const parts = afterSlash.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : afterSlash;
  }

  private static formatChannelLabel(channelId: string): string {
    // Channel IDs: "chan-${pkg.fullName}-${lineNum}" e.g. "chan-pkg/hub-114"
    const withoutPrefix = channelId.startsWith('chan-') ? channelId.slice(5) : channelId;
    // Strip trailing line number: "-114" → remove last "-N" segment
    const withoutSuffix = withoutPrefix.replace(/-\d+$/, '');
    // Return last segment after final '/': "pkg/hub" → "hub"
    const slashIdx = withoutSuffix.lastIndexOf('/');
    return slashIdx >= 0 ? withoutSuffix.slice(slashIdx + 1) : withoutSuffix;
  }

  private static formatGoroutineName(node: { id: string; name: string }): string {
    if (node.name) {
      // Strip package path prefix (everything up to and including the last '/')
      const slashIdx = node.name.lastIndexOf('/');
      const afterSlash = slashIdx >= 0 ? node.name.slice(slashIdx + 1) : node.name;
      // If the part before the first dot is a hyphenated package name, strip it
      // only when the symbol after the dot is an exported (capitalized) identifier.
      // e.g. "user-service.NewTestHarness" → "NewTestHarness"
      // but  "swarm-hub.main"             → "swarm-hub.main" (main is unexported)
      const dotIdx = afterSlash.indexOf('.');
      if (dotIdx > 0 && afterSlash.slice(0, dotIdx).includes('-')) {
        const symbol = afterSlash.slice(dotIdx + 1);
        if (
          symbol.length > 0 &&
          symbol[0] === symbol[0].toUpperCase() &&
          symbol[0] !== symbol[0].toLowerCase()
        ) {
          return symbol;
        }
      }
      return afterSlash;
    }
    // Strip .spawn-N suffix, strip package path prefix, take last 2 dot-separated parts
    const stripped = node.id.replace(/\.spawn-\d+$/, '');
    const afterSlash = stripped.slice(stripped.lastIndexOf('/') + 1);
    const parts = afterSlash.split('.');
    return parts.slice(-2).join('.');
  }

  private static getLifecycleTag(
    nodeId: string,
    lifecycle: GoroutineLifecycleSummary[] | undefined
  ): string {
    const entry = lifecycle?.find((l) => l.nodeId === nodeId);
    if (!entry) return '';
    if (entry.receivesContext && entry.hasCancellationCheck) return ' \u2713ctx';
    if (entry.receivesContext && !entry.cancellationCheckAvailable) return ' ctx?';
    if (entry.orphan) return ' \u26a0 no exit';
    return '';
  }

  private static sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
  }
}
