/**
 * ArchMetrics — metrics and analysis queries over a single ArchJSON scope.
 *
 * Extracted from QueryEngine (Phase 96) to keep the query engine focused on
 * graph traversal; all aggregation/metric methods live here.
 */

import path from 'path';
import type { ArchJSON, Entity, RelationType } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type {
  PackageCoverage,
  TestFileInfo,
} from '@/types/extensions/test-analysis.js';
import { ExtensionAccessor } from './extension-accessor.js';

// ── Re-exported types ────────────────────────────────────────────────────────

export interface PackageStatEntry {
  package: string;
  fileCount: number;
  testFileCount?: number;
  entityCount: number;
  methodCount: number;
  fieldCount: number;
  loc?: number;
  languageStats?: {
    structs?: number;
    interfaces?: number;
    functions?: number;
    enums?: number;
    classes?: number;
  };
}

export interface PackageStatMeta {
  dataPath: 'go-atlas' | 'ts-module-graph' | 'oo-derived' | 'kotlin-package';
  locAvailable: boolean;
  locBasis?: 'maxEndLine';
}

export interface PackageStatsResult {
  meta: PackageStatMeta;
  packages: PackageStatEntry[];
}

// ── Class ────────────────────────────────────────────────────────────────────

export class ArchMetrics {
  private readonly entityMap: Map<string, Entity>;
  private readonly ext: ExtensionAccessor;

  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex,
    extensionAccessor?: ExtensionAccessor
  ) {
    this.entityMap = new Map(archJson.entities.map((e) => [e.id, e]));
    // Use provided accessor, or create a default one from archJson
    this.ext = extensionAccessor ?? new ExtensionAccessor(archJson);
  }

  // ----------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------

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

    const atlasEdgeCount = Object.values(this.ext.getAtlasLayers() ?? {}).reduce(
      (sum, layer) => sum + ((layer as { edges?: unknown[] }).edges?.length ?? 0),
      0
    );

    const hasAtlas = !!this.ext.getAtlasLayer('package');

    const topDependedOn = hasAtlas ? [] : computedTopDependedOn;
    const topDependedOnNote = hasAtlas
      ? 'Not available for Go Atlas projects. Use archguard_get_atlas_layer({ layer: "package" }) to find the most-imported packages.'
      : undefined;

    const topPackagesResult = this.getPackageStats(3);
    const totalPackageCount = topPackagesResult.packages.length;
    const topPackages = topPackagesResult.packages.slice(0, 10);

    // relationCountByType
    const relationCountByType: Partial<Record<RelationType, number>> = {};
    for (const [type, rels] of Object.entries(this.index.relationsByType)) {
      relationCountByType[type as RelationType] = rels.length;
    }

    // topByMethodCount
    const topByMethodCount = this.archJson.entities
      .map((e) => ({
        name: this.index.idToName[e.id] ?? e.id,
        methodCount: (e.members ?? []).filter(
          (m) => m.type === 'method' || m.type === 'constructor'
        ).length,
      }))
      .sort((a, b) => b.methodCount - a.methodCount)
      .slice(0, 10);

    // topByOutDegree
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

  // ----------------------------------------------------------------
  // Package stats
  // ----------------------------------------------------------------

  getPackageStats(depth: number = 2, topN?: number): PackageStatsResult {
    const clampedDepth = Math.max(1, Math.min(5, depth));

    // ── Path Kotlin ────────────────────────────────────────────────────────
    if (this.archJson.language === 'kotlin') {
      return this.getKotlinPackageStats(topN);
    }

    // ── Path A: Go Atlas ──────────────────────────────────────────────────
    const pg = this.ext.getAtlasLayer('package');
    if (pg) {
      const sourceNodes = pg.nodes.filter((n: { type: string }) => n.type === 'internal' || n.type === 'cmd');
      const packages: PackageStatEntry[] = sourceNodes.map((node: { name: string; fileCount: number; stats?: { structs?: number; interfaces?: number; functions?: number } }) => {
        const { entityCount, methodCount, fieldCount } = this.aggregateEntityMetrics(node.name);
        return {
          package: node.name,
          fileCount: node.fileCount,
          entityCount,
          methodCount,
          fieldCount,
          languageStats: node.stats
            ? {
                structs: node.stats.structs,
                interfaces: node.stats.interfaces,
                functions: node.stats.functions,
              }
            : undefined,
        };
      });
      const sorted = packages.sort((a: PackageStatEntry, b: PackageStatEntry) => b.fileCount - a.fileCount);
      return {
        meta: { dataPath: 'go-atlas', locAvailable: false },
        packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
      };
    }

    // ── Path B: TypeScript (tsAnalysis.moduleGraph) ───────────────────────
    const mg = this.archJson.extensions?.tsAnalysis?.moduleGraph;
    if (mg) {
      const testPattern = this.buildTestPattern();
      const ws = this.archJson.workspaceRoot;

      const moduleFiles = new Map<string, string[]>();
      for (let file of this.archJson.sourceFiles) {
        if (ws && path.isAbsolute(file)) file = path.relative(ws, file);
        const lastSlash = file.lastIndexOf('/');
        const moduleId = lastSlash >= 0 ? file.substring(0, lastSlash) : '';
        moduleFiles.set(moduleId, [...(moduleFiles.get(moduleId) ?? []), file]);
      }
      const packages: PackageStatEntry[] = mg.nodes
        .filter((n: { type: string }) => n.type === 'internal')
        .map((node: { id: string; name: string; fileCount: number; stats: { classes: number; interfaces: number; functions: number; enums: number } }) => {
          const files = moduleFiles.get(node.id) ?? [];
          const testFileCount = files.filter((f) => testPattern.test(f)).length;
          const { entityCount, methodCount, fieldCount } = this.aggregateEntityMetrics(node.id);
          return {
            package: node.name,
            fileCount: node.fileCount,
            testFileCount,
            entityCount,
            methodCount,
            fieldCount,
            languageStats: {
              classes: node.stats.classes,
              interfaces: node.stats.interfaces,
              functions: node.stats.functions,
              enums: node.stats.enums,
            },
          };
        });
      const sorted = packages.sort((a: PackageStatEntry, b: PackageStatEntry) => b.fileCount - a.fileCount);
      return {
        meta: { dataPath: 'ts-module-graph', locAvailable: false },
        packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
      };
    }

    // ── Path C: OO Fallback (Java / Python / C++) ─────────────────────────
    const testPattern = this.buildTestPattern();
    const packageFiles = new Map<string, string[]>();
    const ooWs = this.archJson.workspaceRoot;
    const addedRelFiles = new Set<string>();
    for (const rawFile of Object.keys(this.index.fileToIds)) {
      let file = rawFile;
      if (path.isAbsolute(file)) {
        file = ooWs ? path.relative(ooWs, file) : file.replace(/^.*?(?=\w)/, '');
      }
      const parts = file.split('/');
      const pkg =
        parts.length <= clampedDepth
          ? parts.slice(0, -1).join('/') || '.'
          : parts.slice(0, clampedDepth).join('/');
      packageFiles.set(pkg, [...(packageFiles.get(pkg) ?? []), file]);
      addedRelFiles.add(file);
    }
    for (const rawFile of this.archJson.sourceFiles) {
      let file = rawFile;
      if (path.isAbsolute(file)) {
        file = ooWs ? path.relative(ooWs, file) : file.replace(/^.*?(?=\w)/, '');
      }
      if (addedRelFiles.has(file)) continue;
      const parts = file.split('/');
      const pkg =
        parts.length <= clampedDepth
          ? parts.slice(0, -1).join('/') || '.'
          : parts.slice(0, clampedDepth).join('/');
      packageFiles.set(pkg, [...(packageFiles.get(pkg) ?? []), file]);
    }
    const packages: PackageStatEntry[] = [];
    for (const [pkg, files] of packageFiles) {
      let entityCount = 0,
        methodCount = 0,
        fieldCount = 0,
        loc = 0;
      let testFileCount = 0;
      for (const file of files) {
        const ids = this.index.fileToIds[file] ?? [];
        let maxLine = 0;
        for (const id of ids) {
          const entity = this.entityMap.get(id);
          if (!entity) continue;
          entityCount++;
          const members = entity.members ?? [];
          methodCount += members.filter(
            (m) => m.type === 'method' || m.type === 'constructor'
          ).length;
          fieldCount += members.filter((m) => m.type === 'property' || m.type === 'field').length;
          maxLine = Math.max(maxLine, entity.sourceLocation.endLine);
        }
        loc += maxLine;
        if (testPattern.test(file)) testFileCount++;
      }
      packages.push({
        package: pkg,
        fileCount: files.length,
        testFileCount,
        entityCount,
        methodCount,
        fieldCount,
        loc,
      });
    }
    const sorted = packages.sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0));
    return {
      meta: { dataPath: 'oo-derived', locAvailable: true, locBasis: 'maxEndLine' },
      packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
    };
  }

  /** Group Kotlin entities by logical package name (derived from entity ID). */
  private getKotlinPackageStats(topN?: number): PackageStatsResult {
    const testPattern = this.buildTestPattern();
    const ws = this.archJson.workspaceRoot;

    const pkgData = new Map<
      string,
      {
        files: Map<string, number>;
        entityCount: number;
        methodCount: number;
        fieldCount: number;
      }
    >();

    for (const entity of this.archJson.entities) {
      const lastDot = entity.id.lastIndexOf('.');
      const pkg = lastDot > 0 ? entity.id.slice(0, lastDot) : '.';

      if (!pkgData.has(pkg)) {
        pkgData.set(pkg, { files: new Map(), entityCount: 0, methodCount: 0, fieldCount: 0 });
      }
      const data = pkgData.get(pkg)!;

      let file = entity.sourceLocation.file;
      if (path.isAbsolute(file) && ws) file = path.relative(ws, file);
      const prevMax = data.files.get(file) ?? 0;
      data.files.set(file, Math.max(prevMax, entity.sourceLocation.endLine));

      data.entityCount++;
      const members = entity.members ?? [];
      data.methodCount += members.filter(
        (m) => m.type === 'method' || m.type === 'constructor'
      ).length;
      data.fieldCount += members.filter((m) => m.type === 'property' || m.type === 'field').length;
    }

    const seenFiles = new Set<string>();
    for (const data of pkgData.values()) {
      for (const file of data.files.keys()) seenFiles.add(file);
    }
    for (const rawFile of this.archJson.sourceFiles) {
      let file = rawFile;
      if (path.isAbsolute(file) && ws) file = path.relative(ws, file);
      if (seenFiles.has(file)) continue;
      const normalized = file.replace(/\\/g, '/');
      const javaIdx = normalized.indexOf('/java/');
      if (javaIdx === -1) continue;
      const afterJava = normalized.slice(javaIdx + 6);
      const lastSlash = afterJava.lastIndexOf('/');
      if (lastSlash === -1) continue;
      const pkgPath = afterJava.slice(0, lastSlash).replace(/\//g, '.');
      if (!pkgPath) continue;
      if (!pkgData.has(pkgPath)) {
        pkgData.set(pkgPath, { files: new Map(), entityCount: 0, methodCount: 0, fieldCount: 0 });
      }
      pkgData.get(pkgPath)!.files.set(file, 0);
    }

    const packages: PackageStatEntry[] = Array.from(pkgData.entries()).map(([pkg, data]) => {
      let loc = 0;
      let testFileCount = 0;
      for (const [file, maxLine] of data.files) {
        loc += maxLine;
        if (testPattern.test(file)) testFileCount++;
      }
      return {
        package: pkg,
        fileCount: data.files.size,
        testFileCount,
        entityCount: data.entityCount,
        methodCount: data.methodCount,
        fieldCount: data.fieldCount,
        loc,
      };
    });

    const sorted = packages.sort((a, b) => (b.entityCount ?? 0) - (a.entityCount ?? 0));
    return {
      meta: { dataPath: 'kotlin-package', locAvailable: true, locBasis: 'maxEndLine' },
      packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
    };
  }

  // ----------------------------------------------------------------
  // Coverage
  // ----------------------------------------------------------------

  getPackageCoverage(): PackageCoverage[] {
    const analysis = this.ext.getTestAnalysis();
    if (!analysis) return [];

    const linkByEntity = new Map<string, { score: number; testIds: string[] }>(
      analysis.coverageMap.map((l) => [
        l.sourceEntityId,
        { score: l.coverageScore, testIds: l.coveredByTestIds },
      ])
    );

    const ws = this.archJson.workspaceRoot ?? '';
    const buckets = new Map<string, { total: number; covered: number; testIds: Set<string> }>();

    for (const entity of this.archJson.entities) {
      const rawFile = entity.sourceLocation?.file ?? '';
      const relFile = ws && path.isAbsolute(rawFile) ? path.relative(ws, rawFile) : rawFile;
      const pkg = path.dirname(relFile) || '.';

      if (!buckets.has(pkg)) {
        buckets.set(pkg, { total: 0, covered: 0, testIds: new Set() });
      }
      const bucket = buckets.get(pkg)!;
      bucket.total++;

      const link = linkByEntity.get(entity.id);
      if (link && link.score > 0) {
        bucket.covered++;
        for (const tid of link.testIds) bucket.testIds.add(tid);
      }
    }

    return Array.from(buckets.entries())
      .map(([pkg, b]) => ({
        package: pkg,
        totalEntities: b.total,
        coveredEntities: b.covered,
        coverageRatio: b.total > 0 ? b.covered / b.total : 0,
        testFileIds: Array.from(b.testIds),
      }))
      .sort((a, b) => a.coverageRatio - b.coverageRatio);
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
    const analysis = this.ext.getTestAnalysis();
    if (!analysis) {
      return {
        entityId,
        coverageScore: 0,
        coveredByTestIds: [],
        testFileDetails: [],
        found: false,
      };
    }

    const link = analysis.coverageMap.find((l) => l.sourceEntityId === entityId);
    if (!link || link.coverageScore === 0) {
      return {
        entityId,
        coverageScore: link?.coverageScore ?? 0,
        coveredByTestIds: link?.coveredByTestIds ?? [],
        testFileDetails: [],
        found: link !== undefined,
      };
    }

    const testFileSet = new Set(link.coveredByTestIds);
    const testFileDetails = analysis.testFiles
      .filter((f) => testFileSet.has(f.id))
      .map((f) => ({
        id: f.id,
        testType: f.testType,
        testCaseCount: f.testCaseCount,
        assertionCount: f.assertionCount,
        assertionDensity: f.assertionDensity,
        frameworks: f.frameworks,
      }));

    return {
      entityId,
      coverageScore: link.coverageScore,
      coveredByTestIds: link.coveredByTestIds,
      testFileDetails,
      found: true,
    };
  }

  // ----------------------------------------------------------------
  // Coupling / orphan / cycle analysis
  // ----------------------------------------------------------------

  findHighCoupling(threshold: number = 8): Entity[] {
    return this.archJson.entities.filter((e) => {
      const incoming = (this.index.dependents[e.id] ?? []).length;
      const outgoing = (this.index.dependencies[e.id] ?? []).length;
      return incoming + outgoing >= threshold;
    });
  }

  findOrphans(): Entity[] {
    return this.archJson.entities.filter((e) => {
      const incoming = (this.index.dependents[e.id] ?? []).length;
      const outgoing = (this.index.dependencies[e.id] ?? []).length;
      return incoming === 0 && outgoing === 0;
    });
  }

  findInCycles(): Entity[] {
    const cycleIds = new Set(this.index.cycles.flatMap((c) => c.members));
    return this.archJson.entities.filter((e) => cycleIds.has(e.id));
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  private aggregateEntityMetrics(packagePrefix: string): {
    entityCount: number;
    methodCount: number;
    fieldCount: number;
  } {
    let entityCount = 0,
      methodCount = 0,
      fieldCount = 0;
    const sep = packagePrefix.endsWith('/') ? packagePrefix : packagePrefix + '/';
    const ws = this.archJson.workspaceRoot;
    for (const [rawFile, ids] of Object.entries(this.index.fileToIds)) {
      let file = rawFile;
      if (path.isAbsolute(file)) {
        if (ws) {
          file = path.relative(ws, file);
        } else {
          const marker = '/' + sep;
          const markerIdx = file.indexOf(marker);
          if (markerIdx >= 0) {
            file = file.substring(markerIdx + 1);
          } else {
            continue;
          }
        }
      }
      if (file !== packagePrefix && !file.startsWith(sep)) continue;
      for (const id of ids) {
        const entity = this.entityMap.get(id);
        if (!entity) continue;
        entityCount++;
        const members = entity.members ?? [];
        methodCount += members.filter(
          (m) => m.type === 'method' || m.type === 'constructor'
        ).length;
        fieldCount += members.filter((m) => m.type === 'property' || m.type === 'field').length;
      }
    }
    return { entityCount, methodCount, fieldCount };
  }

  private buildTestPattern(): RegExp {
    switch (this.archJson.language) {
      case 'typescript':
        return /\.(test|spec)\.(ts|tsx|js|jsx)$/;
      case 'kotlin':
        return /Test\.kt$|Tests\.kt$|([\\/](?:test|androidTest|sharedTest)[\\/])/;
      case 'java':
        return /Test\.java$|Tests\.java$|TestCase\.java$|([\\/]test[\\/])/;
      case 'python':
        return /(^|[\\/])test_[^\\/]+\.py$|_test\.py$/;
      case 'cpp':
        return /\.(test|spec)\.(cpp|cc|cxx)$|([\\/]|^)test[_\-]/i;
      default:
        return /\.(test|spec)\./;
    }
  }
}
