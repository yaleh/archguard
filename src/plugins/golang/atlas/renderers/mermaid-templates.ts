import path from 'path';
import type {
  PackageGraph,
  PackageNode,
  CapabilityGraph,
  GoroutineTopology,
  FlowGraph,
  EntryPoint,
} from '../types.js';

interface GroupNode {
  prefix: string;
  children: GroupNode[];
  nodeIds: string[];
}

/**
 * Mermaid template renderer for Go Atlas layers
 */
export class MermaidTemplates {
  // ── nested subgraph grouping ───────────────────────────────────────────────
  //
  // buildGroupTree(): builds a prefix-tree of subgraph groups.
  //   A prefix becomes a group when ≥2 package nodes fall under it.
  //   Groups nest: 'pkg/hub' is a child of 'pkg' when both are valid.
  //   Each node is assigned to its deepest valid group.
  //
  // TODO: potential collision if group labels exceed 59 chars after sanitize
  private static buildGroupTree(
    nodes: PackageNode[]
  ): { roots: GroupNode[]; grouped: Set<string> } {
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
        nodeObjects.get(parent)!.children.push(nodeObjects.get(prefix)!);
      } else {
        roots.push(nodeObjects.get(prefix)!);
      }
    }

    // Assign each node to its deepest group
    const grouped = new Set<string>();
    for (const node of nodes) {
      const group = deepestGroupFor(node.name);
      if (group && nodeObjects.has(group)) {
        nodeObjects.get(group)!.nodeIds.push(node.id);
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
      out += MermaidTemplates.renderGroupNodes(group.children, nodeMap, cycleNodeIds, indent + '  ');
      // Then emit this group's direct node members
      for (const nodeId of group.nodeIds) {
        const node = nodeMap.get(nodeId)!;
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
      graph.cycles
        .filter(c => c.packages.length > 1)
        .flatMap(c => c.packages)
    );

    // --- nested subgraph grouping (P4) ---
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
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
    output += '\n';
    for (const edge of graph.edges) {
      const fromId = MermaidTemplates.sanitizeId(edge.from);
      const toId   = MermaidTemplates.sanitizeId(edge.to);
      if (edge.from === edge.to) {
        output += `  ${fromId} -.->|"⚠ self"| ${toId}\n`;
        continue;
      }
      const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
      output += `  ${fromId} -->${label} ${toId}\n`;
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
    let output = 'flowchart LR\n';

    for (const node of graph.nodes) {
      if (node.type === 'interface') {
        output += `  ${this.sanitizeId(node.id)}{{"${node.name}"}}\n`;
      } else {
        output += `  ${this.sanitizeId(node.id)}["${node.name}"]\n`;
      }
    }

    for (const edge of graph.edges) {
      if (edge.type === 'implements') {
        output += `  ${this.sanitizeId(edge.source)} -.->|impl| ${this.sanitizeId(edge.target)}\n`;
      } else {
        output += `  ${this.sanitizeId(edge.source)} -->|uses| ${this.sanitizeId(edge.target)}\n`;
      }
    }

    return output;
  }

  static renderGoroutineTopology(topology: GoroutineTopology): string {
    let output = 'flowchart TB\n';

    // Track declared node IDs (by raw id, before sanitize)
    const declaredIds = new Set<string>();

    for (const node of topology.nodes) {
      const style = node.type === 'main' ? ':::main' : ':::spawned';
      const patternLabel = node.pattern ? ` (${node.pattern})` : '';
      const displayName = MermaidTemplates.formatGoroutineName(node);
      output += `  ${this.sanitizeId(node.id)}["${displayName}${patternLabel}"]${style}\n`;
      declaredIds.add(node.id);
    }

    // Declare spawner nodes that are not already declared
    for (const edge of topology.edges) {
      if (!declaredIds.has(edge.from)) {
        const label = MermaidTemplates.formatSpawnerLabel(edge.from);
        output += `  ${this.sanitizeId(edge.from)}["${label}"]:::spawner\n`;
        declaredIds.add(edge.from);
      }
    }

    for (const edge of topology.edges) {
      output += `  ${this.sanitizeId(edge.from)} -->|go| ${this.sanitizeId(edge.to)}\n`;
    }

    if (topology.channels.length > 0) {
      output += '\n  subgraph channels\n';
      for (const ch of topology.channels) {
        output += `    ${this.sanitizeId(ch.id)}[("${ch.type}")]:::channel\n`;
      }
      output += '  end\n';
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
          const pathLabel = entry.path || entry.id;
          output += `\n  Note over ${handlerId}: ${entry.type} ${pathLabel}\n`;
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

    // flowchart LR — group entry points by directory into subgraphs
    let output = 'flowchart LR\n';

    // Group entry points by their directory
    const dirGroups = new Map<string, EntryPoint[]>();
    for (const entry of graph.entryPoints) {
      const dir = path.dirname(entry.location.file);
      if (!dirGroups.has(dir)) {
        dirGroups.set(dir, []);
      }
      dirGroups.get(dir).push(entry);
    }

    // Emit subgraph per directory with entry point nodes
    for (const [dir, entries] of dirGroups) {
      const subgraphId = this.sanitizeId(dir);
      output += `\n  subgraph ${subgraphId}["${dir}"]\n`;
      for (const entry of entries) {
        const nodeId = this.sanitizeId(entry.id);
        const label = this.formatEntryLabel(entry);
        output += `    ${nodeId}["${label}"]\n`;
      }
      output += '  end\n';
    }

    // Emit call-chain edges
    for (const chain of graph.callChains) {
      const entry = graph.entryPoints.find((e) => e.id === chain.entryPoint);
      if (!entry) continue;

      const entryNodeId = this.sanitizeId(entry.id);

      for (const call of chain.calls) {
        const fromId = this.sanitizeId(call.from);
        const toId = this.sanitizeId(call.to);
        if (!fromId || !toId) continue;

        // Connect entry node to first call if from matches handler
        if (call.from === entry.handler) {
          output += `  ${entryNodeId} --> ${fromId}\n`;
        }
        output += `  ${fromId} --> ${toId}\n`;
      }
    }

    return output;
  }

  private static formatEntryLabel(entry: EntryPoint): string {
    if (entry.type === 'http-handler') {
      return entry.path;
    }
    // Map type to METHOD string
    const methodMap: Record<string, string> = {
      'http-get': 'GET',
      'http-post': 'POST',
      'http-put': 'PUT',
      'http-delete': 'DELETE',
      'http-patch': 'PATCH',
      'grpc-unary': 'GRPC',
      'grpc-stream': 'GRPC',
      'cli-command': 'CMD',
    };
    const method = methodMap[entry.type] ?? entry.type.toUpperCase();
    return `${method} ${entry.path}`;
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
        if (symbol.length > 0 && symbol[0] === symbol[0].toUpperCase() && symbol[0] !== symbol[0].toLowerCase()) {
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

  private static sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
  }
}
