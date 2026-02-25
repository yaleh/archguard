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

    // Build lookup maps for resolving Go package names → full node IDs.
    // "goPackageName:typeName" → "pkg.fullName.typeName" (for impl edge resolution)
    const pkgTypeToNodeId = new Map<string, string>();
    // typeName → fullNodeId (first match wins, for uses edge resolution)
    const typeNameToNodeId = new Map<string, string>();

    for (const pkg of rawData.packages) {
      for (const iface of pkg.interfaces) {
        pkgTypeToNodeId.set(`${pkg.name}:${iface.name}`, `${pkg.fullName}.${iface.name}`);
        if (!typeNameToNodeId.has(iface.name)) {
          typeNameToNodeId.set(iface.name, `${pkg.fullName}.${iface.name}`);
        }
      }
      for (const struct of pkg.structs) {
        pkgTypeToNodeId.set(`${pkg.name}:${struct.name}`, `${pkg.fullName}.${struct.name}`);
        if (!typeNameToNodeId.has(struct.name)) {
          typeNameToNodeId.set(struct.name, `${pkg.fullName}.${struct.name}`);
        }
      }
    }

    // Use pre-computed implementations if available
    if (rawData.implementations) {
      for (const impl of rawData.implementations) {
        const sourceId = this.resolveNodeId(impl.structPackageId, impl.structName, pkgTypeToNodeId);
        const targetId = this.resolveNodeId(
          impl.interfacePackageId,
          impl.interfaceName,
          pkgTypeToNodeId
        );
        edges.push({
          id: `impl-${sourceId}-${targetId}`,
          type: 'implements',
          source: sourceId,
          target: targetId,
          confidence: impl.confidence,
        });
      }
    }

    // Detect interface/struct usage in struct fields.
    // Resolve field.type to full node ID using the type name lookup map.
    const allKnownTypeNames = new Set([
      ...rawData.packages.flatMap((p) => p.interfaces.map((i) => i.name)),
      ...rawData.packages.flatMap((p) => (p.structs || []).map((s) => s.name)),
    ]);

    for (const pkg of rawData.packages) {
      for (const struct of pkg.structs) {
        for (const field of struct.fields) {
          const bareType = this.normalizeFieldType(field.type);
          if (allKnownTypeNames.has(bareType)) {
            const targetNodeId = typeNameToNodeId.get(bareType) ?? bareType;
            edges.push({
              id: `uses-${pkg.fullName}.${struct.name}-${field.type}`,
              type: 'uses',
              source: `${pkg.fullName}.${struct.name}`,
              target: targetNodeId,
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

  /**
   * Normalize a raw Go field type string to its bare type name for lookup.
   *
   * Handles:
   * - Pointer: `*Config` → `Config`, `**T` → `T`
   * - Slice/array: `[]workerSlot` → `workerSlot`, `[4]T` → `T`
   * - Map value: `map[string]adapter.RuntimeAdapter` → `RuntimeAdapter`
   * - Package qualifier: `engine.Engine` → `Engine`, `store.Store` → `Store`
   * - Combinations: `*engine.Engine` → `Engine`
   */
  private normalizeFieldType(fieldType: string): string {
    let t = fieldType.trim();
    // Strip leading pointer star(s)
    t = t.replace(/^\*+/, '');
    // Strip slice/array prefix: [] or [N]
    t = t.replace(/^\[\d*\]/, '');
    // Handle map: extract the value type (after the closing bracket)
    const mapMatch = t.match(/^map\[.*?\](.+)$/);
    if (mapMatch) t = mapMatch[1];
    // Strip pointer again (e.g. map[K]*V → V)
    t = t.replace(/^\*+/, '');
    // Strip package qualifier: pkg.Type → Type
    const dotIdx = t.lastIndexOf('.');
    if (dotIdx >= 0) t = t.substring(dotIdx + 1);
    return t;
  }

  /**
   * Resolve a (packageId, typeName) pair to a full node ID using the lookup map.
   *
   * InterfaceMatcher stores `structPackageId = struct.packageName` (Go package name, e.g. "store"),
   * but node IDs use `pkg.fullName` (e.g. "pkg/hub/store"). This resolves the mismatch.
   *
   * Strategy:
   * 1. Try direct lookup with packageId as key (works when packageId is a Go package name)
   * 2. Try last path segment of packageId (works when packageId is already a full path)
   * 3. Fallback: construct from packageId directly (preserves backward compat)
   */
  private resolveNodeId(
    packageId: string,
    typeName: string,
    lookup: Map<string, string>
  ): string {
    // Try direct key (Go package name, e.g. "store:SQLiteStore")
    const direct = lookup.get(`${packageId}:${typeName}`);
    if (direct) return direct;

    // Try last path segment (full path like "pkg/hub/store" → "store")
    if (packageId.includes('/')) {
      const lastSegment = packageId.split('/').pop()!;
      const bySegment = lookup.get(`${lastSegment}:${typeName}`);
      if (bySegment) return bySegment;
    }

    // Fallback: construct from packageId as-is (may already be a full qualified path)
    return `${packageId}.${typeName}`;
  }
}
