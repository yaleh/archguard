import type { GoRawData } from '../../types.js';
import type { CapabilityGraph, CapabilityNode, CapabilityRelation } from '../types.js';

/**
 * Capability (interface usage) graph builder
 *
 * Uses existing interface implementation data for detection.
 * Output types from ADR-002 (CapabilityGraph, CapabilityNode, CapabilityRelation).
 *
 * NOTE: ADR-002 uses flat nodes/edges structure (no redundant
 * implementors/consumers fields on InterfaceCapability).
 */
export class CapabilityGraphBuilder {
  build(rawData: GoRawData): Promise<CapabilityGraph> {
    const nodes = this.buildNodes(rawData);
    const edges = this.buildEdges(rawData);

    return Promise.resolve({ nodes, edges });
  }

  private buildNodes(rawData: GoRawData): CapabilityNode[] {
    const nodes: CapabilityNode[] = [];

    for (const pkg of rawData.packages) {
      for (const iface of pkg.interfaces) {
        nodes.push({
          id: `${pkg.fullName}.${iface.name}`,
          name: iface.name,
          type: 'interface',
          package: pkg.fullName,
          exported: iface.exported,
        });
      }

      for (const struct of pkg.structs) {
        nodes.push({
          id: `${pkg.fullName}.${struct.name}`,
          name: struct.name,
          type: 'struct',
          package: pkg.fullName,
          exported: struct.exported,
        });
      }
    }

    return nodes;
  }

  private buildEdges(rawData: GoRawData): CapabilityRelation[] {
    const edges: CapabilityRelation[] = [];

    // Use pre-computed implementations if available
    if (rawData.implementations) {
      for (const impl of rawData.implementations) {
        edges.push({
          id: `impl-${impl.structPackageId}.${impl.structName}-${impl.interfacePackageId}.${impl.interfaceName}`,
          type: 'implements',
          source: `${impl.structPackageId}.${impl.structName}`,
          target: `${impl.interfacePackageId}.${impl.interfaceName}`,
          confidence: impl.confidence,
        });
      }
    }

    // Detect interface/struct usage in struct fields
    // TODO: field.type is a simple name (e.g., "Engine") but node ID is "pkg/hub.Engine" — may create dangling edges
    const allKnownTypeNames = new Set([
      ...rawData.packages.flatMap((p) => p.interfaces.map((i) => i.name)),
      ...rawData.packages.flatMap((p) => (p.structs || []).map((s) => s.name)),
    ]);

    for (const pkg of rawData.packages) {
      for (const struct of pkg.structs) {
        for (const field of struct.fields) {
          if (allKnownTypeNames.has(field.type)) {
            edges.push({
              id: `uses-${pkg.fullName}.${struct.name}-${field.type}`,
              type: 'uses',
              source: `${pkg.fullName}.${struct.name}`,
              target: field.type,
              confidence: 0.9,
              context: {
                fieldType: true,
                usageLocations: [`${field.location.file}:${field.location.startLine}`],
              },
            });
          }
        }
      }
    }

    return edges;
  }
}
