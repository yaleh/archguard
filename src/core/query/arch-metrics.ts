/**
 * ArchMetrics — metrics and analysis queries over a single ArchJSON scope.
 *
 * Thin composer over three metric-domain modules:
 *   arch-metrics-structure  → package stats, coupling, orphans, cycles
 *   arch-metrics-quality    → test coverage
 *   arch-metrics-cognitive  → summary aggregations
 */

import type { ArchJSON, Entity, RelationType } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type { PackageCoverage, TestFileInfo } from '@/types/extensions/test-analysis.js';
import { ExtensionAccessor } from './extension-accessor.js';
import {
  StructureMetrics,
  type PackageStatEntry,
  type PackageStatMeta,
  type PackageStatsResult,
} from './arch-metrics-structure.js';
import { QualityMetrics } from './arch-metrics-quality.js';
import { CognitiveMetrics } from './arch-metrics-cognitive.js';

// ── Re-exported types ────────────────────────────────────────────────────────

export type { PackageStatEntry, PackageStatMeta, PackageStatsResult };

// ── Class ────────────────────────────────────────────────────────────────────

export class ArchMetrics {
  private readonly structure: StructureMetrics;
  private readonly quality: QualityMetrics;
  private readonly cognitive: CognitiveMetrics;

  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex,
    extensionAccessor?: ExtensionAccessor
  ) {
    const entityMap = new Map<string, Entity>(archJson.entities.map((e) => [e.id, e]));
    const ext = extensionAccessor ?? new ExtensionAccessor(archJson);
    this.structure = new StructureMetrics(archJson, index, ext, entityMap);
    this.quality = new QualityMetrics(archJson, ext);
    this.cognitive = new CognitiveMetrics(archJson, index, ext, this.structure);
  }

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
    return this.cognitive.getSummary();
  }

  getPackageStats(depth: number = 2, topN?: number): PackageStatsResult {
    return this.structure.getPackageStats(depth, topN);
  }

  getPackageCoverage(): PackageCoverage[] {
    return this.quality.getPackageCoverage();
  }

  getEntityCoverage(entityId: string): {
    entityId: string;
    coverageScore: number;
    coveredByTestIds: string[];
    testFileDetails: Array<{
      id: string;
      testType: TestFileInfo['testType'];
      testCaseCount: number;
      assertionCount: number;
      assertionDensity: number;
      frameworks: string[];
    }>;
    found: boolean;
  } {
    return this.quality.getEntityCoverage(entityId);
  }

  findHighCoupling(threshold: number = 8): Entity[] {
    return this.structure.findHighCoupling(threshold);
  }

  findOrphans(): Entity[] {
    return this.structure.findOrphans();
  }

  findInCycles(): Entity[] {
    return this.structure.findInCycles();
  }
}
