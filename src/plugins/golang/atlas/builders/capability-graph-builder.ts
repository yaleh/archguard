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
    const allNodes = this.buildNodes(rawData);
    const rawEdges = this.buildEdges(rawData);

    // Deduplicate edges: keep first occurrence of each (source, target, type) triple
    const edgeSeen = new Set<string>();
    const edges: CapabilityRelation[] = [];
    for (const edge of rawEdges) {
      const key = `${edge.type}:${edge.source}:${edge.target}`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key);
        edges.push(edge);
      }
    }

    // Interface-centric filter:
    // - Always keep interface nodes
    // - Keep struct nodes only if referenced in at least one edge
    const referencedIds = new Set<string>();
    for (const edge of edges) {
      referencedIds.add(edge.source);
      referencedIds.add(edge.target);
    }

    const nodes = allNodes.filter(
      (node) => node.type === 'interface' || referencedIds.has(node.id)
    );

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
        // Also register under the full import path so that structPackageId values
        // produced with fullName (e.g. "pkg/hub/store") resolve correctly.
        pkgTypeToNodeId.set(`${pkg.fullName}:${iface.name}`, `${pkg.fullName}.${iface.name}`);
        if (!typeNameToNodeId.has(iface.name)) {
          typeNameToNodeId.set(iface.name, `${pkg.fullName}.${iface.name}`);
        }
      }
      for (const struct of pkg.structs) {
        pkgTypeToNodeId.set(`${pkg.name}:${struct.name}`, `${pkg.fullName}.${struct.name}`);
        // Also register under the full import path for unambiguous resolution.
        pkgTypeToNodeId.set(`${pkg.fullName}:${struct.name}`, `${pkg.fullName}.${struct.name}`);
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
            // Resolve field type to node ID with priority:
            // 1. Explicit package qualifier (e.g. "models.Event" → qualifier="models")
            // 2. Same-package by full import path (unqualified types are same-package in Go)
            // 3. Same-package by short name
            // 4. Cross-package fallback (first-match-wins — may be ambiguous)
            const qualifier = this.extractTypeQualifier(field.type);
            // Resolution priority:
            // 1. Explicit qualifier (e.g. "models.Event" → qualifier="models"):
            //    look up in pkgTypeToNodeId by qualifier. If no match, the type is
            //    external (stdlib / third-party) — do NOT fall through to bare-name lookup.
            // 2. Same-package by full import path (unqualified → must be same-package in Go)
            // 3. Same-package by short name
            //
            // typeNameToNodeId (first-match-wins cross-package bare-name lookup) is
            // intentionally NOT used as a fallback. In valid Go source, a cross-package
            // type reference must carry a qualifier, so bare-name resolution would only
            // produce false-positive edges (e.g. http.Client → examples/user-service.Client,
            // or same-package func-type → a struct of the same name in another package).
            const targetNodeId = (qualifier
              ? pkgTypeToNodeId.get(`${qualifier}:${bareType}`)
              : pkgTypeToNodeId.get(`${pkg.fullName}:${bareType}`) ??
                pkgTypeToNodeId.get(`${pkg.name}:${bareType}`));
            if (targetNodeId === undefined) continue;
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
   * Extract the Go package qualifier from a raw field type string.
   *
   * Examples:
   * - "chan *models.Event" → "models"
   * - "*engine.Engine"    → "engine"
   * - "[]store.Store"     → "store"
   * - "map[string]*V"     → null (map value has no qualifier)
   * - "string"            → null
   *
   * The qualifier is the simple identifier before the dot in a qualified type name.
   * It corresponds to the Go package short name, which is used as the key prefix in
   * pkgTypeToNodeId ("models:Event" → "pkg/hub/models.Event").
   */
  private extractTypeQualifier(fieldType: string): string | null {
    let t = fieldType.trim();
    // Strip chan keyword
    t = t.replace(/^chan\s+/, '');
    // Strip leading pointer(s)
    t = t.replace(/^\*+/, '');
    // Strip slice/array prefix: [] or [N]
    t = t.replace(/^\[\d*\]/, '');
    // Handle map: extract value type (after the closing bracket)
    const mapMatch = t.match(/^map\[.*?\](.+)$/);
    if (mapMatch) t = mapMatch[1].trim();
    // Strip pointer again (e.g. map[K]*V → V)
    t = t.replace(/^\*+/, '');
    // Extract qualifier: the part before the first dot, if it is a simple Go identifier (no slashes)
    const dotIdx = t.indexOf('.');
    if (dotIdx > 0) {
      const qualifier = t.slice(0, dotIdx);
      // Only return if qualifier looks like a Go package name (simple identifier, no further dots)
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(qualifier)) return qualifier;
    }
    return null;
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
