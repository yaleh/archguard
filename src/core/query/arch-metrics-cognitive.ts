import type { ArchJSON, RelationType } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type { ExtensionAccessor } from './extension-accessor.js';
import type { PackageStatEntry, StructureMetrics } from './arch-metrics-structure.js';

// ── CognitiveMetrics ─────────────────────────────────────────────────────────

export class CognitiveMetrics {
  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex,
    private readonly ext: ExtensionAccessor,
    private readonly structure: StructureMetrics
  ) {}

  getSummary(): {
    entityCount: number;
    relationCount: number;
    topDependedOn: Array<{ name: string; dependentCount: number }>;
    topDependedOnNote?: string;
    relationCountByType: Partial<Record<RelationType, number>>;
    topByMethodCount: Array<{ name: string; methodCount: number }>;
    topByOutDegree: Array<{ name: string; outDegree: number }>;
    totalPackageCount: number;
    topPackages: PackageStatEntry[];
  } {
    const computedTopDependedOn = Object.entries(this.index.dependents)
      .map(([id, deps]) => ({
        name: this.index.idToName[id] ?? id,
        dependentCount: deps.length,
      }))
      .sort((a, b) => b.dependentCount - a.dependentCount)
      .slice(0, 10);

    const atlasEdgeCount = Object.values(this.ext.getAtlasLayers() ?? {}).reduce<number>(
      (sum, layer) => sum + ((layer as { edges?: unknown[] }).edges?.length ?? 0),
      0
    );

    const hasAtlas = !!this.ext.getAtlasLayer('package');

    const topDependedOn = hasAtlas ? [] : computedTopDependedOn;
    const topDependedOnNote = hasAtlas
      ? 'Not available for Go Atlas projects. Use archguard_get_atlas_layer({ layer: "package" }) to find the most-imported packages.'
      : undefined;

    const topPackagesResult = this.structure.getPackageStats(3);
    const totalPackageCount = topPackagesResult.packages.length;
    const topPackages = topPackagesResult.packages.slice(0, 10);

    const relationCountByType: Partial<Record<RelationType, number>> = {};
    for (const [type, rels] of Object.entries(this.index.relationsByType)) {
      relationCountByType[type as RelationType] = rels.length;
    }

    const topByMethodCount = this.archJson.entities
      .map((e) => ({
        name: this.index.idToName[e.id] ?? e.id,
        methodCount: (e.members ?? []).filter(
          (m) => m.type === 'method' || m.type === 'constructor'
        ).length,
      }))
      .sort((a, b) => b.methodCount - a.methodCount)
      .slice(0, 10);

    const topByOutDegree = this.archJson.entities
      .map((e) => ({
        name: this.index.idToName[e.id] ?? e.id,
        outDegree: (this.index.dependencies[e.id] ?? []).length,
      }))
      .sort((a, b) => b.outDegree - a.outDegree)
      .slice(0, 10);

    return {
      entityCount: this.archJson.entities.length,
      relationCount: atlasEdgeCount > 0 ? atlasEdgeCount : this.archJson.relations.length,
      topDependedOn,
      topDependedOnNote,
      relationCountByType,
      topByMethodCount,
      topByOutDegree,
      totalPackageCount,
      topPackages,
    };
  }
}
