import type { PackageGraph, CapabilityGraph, GoroutineTopology, FlowGraph } from '../types.js';

/**
 * Mermaid template renderer for Go Atlas layers
 */
export class MermaidTemplates {
  static renderPackageGraph(graph: PackageGraph): string {
    let output = 'flowchart TB\n';

    for (const node of graph.nodes) {
      const style = node.type === 'cmd' ? ':::cmd' : `:::${node.type}`;
      output += `  ${this.sanitizeId(node.id)}["${node.name}"]${style}\n`;
    }

    for (const edge of graph.edges) {
      const label = edge.strength > 1 ? `|"${edge.strength} refs"|` : '';
      output += `  ${this.sanitizeId(edge.from)} -->${label} ${this.sanitizeId(edge.to)}\n`;
    }

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
      const displayName = node.name || node.id;
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

  static renderFlowGraph(graph: FlowGraph): string {
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

  private static sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}
