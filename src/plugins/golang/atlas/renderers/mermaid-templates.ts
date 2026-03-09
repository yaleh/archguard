import type {
  PackageGraph,
  CapabilityGraph,
  GoroutineTopology,
  FlowGraph,
} from '../types.js';
import { renderPackageGraph } from './package-mermaid-template.js';
import { renderCapabilityGraph } from './capability-mermaid-template.js';
import { renderGoroutineTopology } from './goroutine-mermaid-template.js';
import { renderFlowGraph } from './flow-mermaid-template.js';
import {
  buildGroupTree,
  computePackageEdgeTiers,
  formatChannelLabel,
  formatGoroutineName,
  formatSpawnerLabel,
  sanitizeId,
} from './template-shared.js';

/**
 * Compatibility facade for Atlas Mermaid layer renderers.
 */
export class MermaidTemplates {
  static renderPackageGraph(graph: PackageGraph): string {
    return renderPackageGraph(graph);
  }

  static renderCapabilityGraph(graph: CapabilityGraph): string {
    return renderCapabilityGraph(graph);
  }

  static renderGoroutineTopology(topology: GoroutineTopology): string {
    return renderGoroutineTopology(topology);
  }

  static renderFlowGraph(graph: FlowGraph, format: 'flowchart' | 'sequence' = 'flowchart'): string {
    return renderFlowGraph(graph, format);
  }

  static computePackageEdgeTiers(strengths: number[]): Map<number, number> {
    return computePackageEdgeTiers(strengths);
  }

  private static buildGroupTree(nodes: Array<{ id: string; name: string }>) {
    return buildGroupTree(nodes);
  }

  private static sanitizeId(id: string): string {
    return sanitizeId(id);
  }

  private static formatSpawnerLabel(nodeId: string): string {
    return formatSpawnerLabel(nodeId);
  }

  private static formatChannelLabel(channelId: string): string {
    return formatChannelLabel(channelId);
  }

  private static formatGoroutineName(node: { id: string; name: string }): string {
    return formatGoroutineName(node);
  }
}
