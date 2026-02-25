import path from 'path';
import type {
  PackageGraph,
  PackageNode,
  CapabilityGraph,
  GoroutineTopology,
  FlowGraph,
  EntryPoint,
} from '../types.js';

/**
 * Mermaid template renderer for Go Atlas layers
 */
export class MermaidTemplates {
  // Two-layer grouping rule:
  //   Top-level dirs (cmd, tests, examples) → group by first segment alone
  //   All other multi-segment paths         → group by first two segments
  private static readonly TOP_LEVEL_GROUP_DIRS = new Set(['cmd', 'tests', 'examples']);

  private static getGroupPrefix(name: string): string | null {
    const segs = name.split('/');
    if (segs.length < 2) return null;
    if (MermaidTemplates.TOP_LEVEL_GROUP_DIRS.has(segs[0])) return segs[0];
    return segs.slice(0, 2).join('/');
  }

  private static buildGroups(nodes: PackageNode[]): Map<string, string[]> {
    const prefixCount = new Map<string, number>();
    for (const node of nodes) {
      const prefix = MermaidTemplates.getGroupPrefix(node.name);
      if (prefix) prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
    }
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const prefix = MermaidTemplates.getGroupPrefix(node.name);
      if (prefix && (prefixCount.get(prefix) ?? 0) >= 2) {
        const members = groups.get(prefix) ?? [];
        members.push(node.id);
        groups.set(prefix, members);
      }
    }
    return groups;
  }

  static renderPackageGraph(graph: PackageGraph): string {
    let output = 'flowchart TB\n';

    // --- cycle detection (P2) ---
    const cycleNodeIds = new Set(
      graph.cycles
        .filter(c => c.packages.length > 1)
        .flatMap(c => c.packages)
    );

    // --- subgraph grouping (P3) ---
    const groups = MermaidTemplates.buildGroups(graph.nodes);
    const nodeGroupMap = new Map<string, string>();
    for (const [label, ids] of groups) {
      for (const id of ids) nodeGroupMap.set(id, label);
    }

    // Pass 1: top-level nodes (not in any group)
    for (const node of graph.nodes) {
      if (!nodeGroupMap.has(node.id)) {
        const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
        output += `  ${MermaidTemplates.sanitizeId(node.id)}["${node.name}"]${style}\n`;
      }
    }

    // Pass 1 cont.: subgraph blocks
    for (const [label, ids] of groups) {
      const sgId = 'grp_' + MermaidTemplates.sanitizeId(label);
      output += `\n  subgraph ${sgId}["${label}"]\n`;
      for (const id of ids) {
        const node = graph.nodes.find(n => n.id === id)!;
        const style = cycleNodeIds.has(node.id) ? ':::cycle' : `:::${node.type}`;
        output += `    ${MermaidTemplates.sanitizeId(node.id)}["${node.name}"]${style}\n`;
      }
      output += '  end\n';
    }

    // Pass 2: classDef block (P0) — placed before edges so lastIndexOf('end') in
    // classDef vendor doesn't interfere with edge-ordering assertions
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

    for (const node of topology.nodes) {
      const style = node.type === 'main' ? ':::main' : ':::spawned';
      const patternLabel = node.pattern ? ` (${node.pattern})` : '';
      const displayName = MermaidTemplates.formatGoroutineName(node);
      output += `  ${this.sanitizeId(node.id)}["${displayName}${patternLabel}"]${style}\n`;
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

  private static formatGoroutineName(node: { id: string; name: string }): string {
    if (node.name) return node.name;
    // Strip .spawn-N suffix, take last 2 dot-separated parts
    const stripped = node.id.replace(/\.spawn-\d+$/, '');
    const parts = stripped.split('.');
    return parts.slice(-2).join('.');
  }

  private static sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
  }
}
