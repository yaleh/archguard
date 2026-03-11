/**
 * QueryEngine — loads a single scope's ArchJSON + ArchIndex and provides query methods.
 *
 * Pure in-memory query object with no disk I/O. Use engine-loader.ts for loading from disk.
 */

import path from 'path';
import type { ArchJSON, Entity, Relation, RelationType, CycleInfo } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type { QueryScopeEntry } from './query-manifest.js';
import type { GoAtlasLayers, TsModuleGraph, TestAnalysis } from '@/types/extensions.js';

export interface EntitySummary {
  id: string;
  name: string;
  type: string;
  visibility: string;
  file: string;
  methodCount: number;
  fieldCount: number;
}

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
  dataPath: 'go-atlas' | 'ts-module-graph' | 'oo-derived';
  locAvailable: boolean;
  locBasis?: 'maxEndLine';
}

export interface PackageStatsResult {
  meta: PackageStatMeta;
  packages: PackageStatEntry[];
}

export interface QueryEngineOptions {
  archJson: ArchJSON;
  archIndex: ArchIndex;
  scopeEntry: QueryScopeEntry;
}

export class QueryEngine {
  private archJson: ArchJSON;
  private index: ArchIndex;
  private scopeEntry: QueryScopeEntry;
  private entityMap: Map<string, Entity>;

  constructor(options: QueryEngineOptions) {
    this.archJson = options.archJson;
    this.index = options.archIndex;
    this.scopeEntry = options.scopeEntry;
    // Build entity map for fast lookup
    this.entityMap = new Map(options.archJson.entities.map((e) => [e.id, e]));
  }

  // ----------------------------------------------------------------
  // Query methods
  // ----------------------------------------------------------------

  /** Find entities by exact name match. */
  findEntity(name: string): Entity[] {
    const ids = this.index.nameToIds[name] ?? [];
    return ids.map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** BFS along the dependencies direction (what entityName depends on). */
  getDependencies(entityName: string, depth: number = 1): Entity[] {
    return this.bfs(entityName, 'dependencies', depth);
  }

  /** BFS along the dependents direction (what depends on entityName). */
  getDependents(entityName: string, depth: number = 1): Entity[] {
    return this.bfs(entityName, 'dependents', depth);
  }

  /** Find entities that implement the given interface (relation.type === 'implementation'). */
  findImplementers(interfaceName: string): Entity[] {
    const pairs = this.index.relationsByType['implementation'] ?? [];
    const ids = this.index.nameToIds[interfaceName] ?? [];
    const targetSet = new Set(ids);
    const implementerIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    return [...new Set(implementerIds)].map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Find subclasses of the given class (relation.type === 'inheritance'). */
  findSubclasses(className: string): Entity[] {
    const pairs = this.index.relationsByType['inheritance'] ?? [];
    const ids = this.index.nameToIds[className] ?? [];
    const targetSet = new Set(ids);
    const subclassIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    return [...new Set(subclassIds)].map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Get all entities defined in a given file. */
  getFileEntities(filePath: string): Entity[] {
    const ids = this.index.fileToIds[filePath] ?? [];
    return ids.map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Return all non-trivial cycles (SCCs with size > 1). */
  getCycles(): CycleInfo[] {
    return this.index.cycles;
  }

  /** Return a summary of the scope. */
  getSummary(): {
    entityCount: number;
    relationCount: number;
    language: string;
    kind: 'parsed' | 'derived';
    topDependedOn: Array<{ name: string; dependentCount: number }>;
    topDependedOnNote?: string;
    capabilities: {
      classHierarchy: boolean;
      interfaceImplementation: boolean;
      packageGraph: boolean;
      cycleDetection: boolean;
    };
    topPackages: PackageStatEntry[];
  } {
    const computedTopDependedOn = Object.entries(this.index.dependents)
      .map(([id, deps]) => ({
        name: this.index.idToName[id] ?? id,
        dependentCount: deps.length,
      }))
      .sort((a, b) => b.dependentCount - a.dependentCount)
      .slice(0, 10);

    const atlasEdgeCount = Object.values(
      this.archJson.extensions?.goAtlas?.layers ?? {}
    ).reduce((sum, layer) => sum + ((layer as { edges?: unknown[] }).edges?.length ?? 0), 0);
    // Note: FlowGraph has no .edges (it has entryPoints/callChains); the cast safely returns 0 for it.

    const hasImplementation = (this.index.relationsByType['implementation']?.length ?? 0) > 0;
    const hasAtlas = !!this.archJson.extensions?.goAtlas?.layers?.package;

    const capabilities = {
      classHierarchy: this.archJson.language !== 'go',
      interfaceImplementation: hasImplementation,
      packageGraph: hasAtlas,
      cycleDetection: this.archJson.language !== 'go',
    };

    const topDependedOn = hasAtlas ? [] : computedTopDependedOn;
    const topDependedOnNote = hasAtlas
      ? 'Not available for Go Atlas projects. Use archguard_get_atlas_layer({ layer: "package" }) to find the most-imported packages.'
      : undefined;

    const topPackagesResult = this.getPackageStats(2, 10);
    const topPackages = topPackagesResult.packages;

    return {
      entityCount: this.archJson.entities.length,
      relationCount: atlasEdgeCount > 0 ? atlasEdgeCount : this.archJson.relations.length,
      language: this.archJson.language,
      kind: this.scopeEntry.kind,
      topDependedOn,
      topDependedOnNote,
      capabilities,
      topPackages,
    };
  }

  // ----------------------------------------------------------------
  // Search methods
  // ----------------------------------------------------------------

  /** Find entities matching a given EntityType. */
  findByType(entityType: string): Entity[] {
    return this.archJson.entities.filter((e) => {
      if (entityType === 'abstract_class') {
        return e.type === 'abstract_class' || (e.isAbstract && e.type === 'class');
      }
      return e.type === entityType;
    });
  }

  /** Find entities whose total incoming + outgoing edges >= threshold. */
  findHighCoupling(threshold: number = 8): Entity[] {
    return this.archJson.entities.filter((e) => {
      const incoming = (this.index.dependents[e.id] ?? []).length;
      const outgoing = (this.index.dependencies[e.id] ?? []).length;
      return incoming + outgoing >= threshold;
    });
  }

  /** Find entities with zero incoming AND zero outgoing edges. */
  findOrphans(): Entity[] {
    return this.archJson.entities.filter((e) => {
      const incoming = (this.index.dependents[e.id] ?? []).length;
      const outgoing = (this.index.dependencies[e.id] ?? []).length;
      return incoming === 0 && outgoing === 0;
    });
  }

  /** Find entities that appear in any cycle. */
  findInCycles(): Entity[] {
    const cycleIds = new Set(this.index.cycles.flatMap((c) => c.members));
    return this.archJson.entities.filter((e) => cycleIds.has(e.id));
  }

  /** Return the scope entry associated with this engine. */
  getScopeEntry(): QueryScopeEntry {
    return this.scopeEntry;
  }

  /** Return the named Go Atlas layer, or undefined if not present. */
  getAtlasLayer<K extends keyof GoAtlasLayers>(layer: K): GoAtlasLayers[K] | undefined {
    return this.archJson.extensions?.goAtlas?.layers?.[layer];
  }

  /** Returns true when the ArchJSON carries a goAtlas extension container. */
  hasAtlasExtension(): boolean {
    return !!this.archJson.extensions?.goAtlas;
  }

  /** Return the TestAnalysis extension, or undefined if not present. */
  getTestAnalysis(): TestAnalysis | undefined {
    return this.archJson.extensions?.testAnalysis;
  }

  /** Returns true when the ArchJSON carries a testAnalysis extension. */
  hasTestAnalysis(): boolean {
    return this.archJson.extensions?.testAnalysis !== undefined;
  }

  getPackageStats(depth: number = 2, topN?: number): PackageStatsResult {
    const clampedDepth = Math.max(1, Math.min(5, depth));

    // ── Path A: Go Atlas ──────────────────────────────────────────────────────
    const pg = this.getAtlasLayer('package');
    if (pg) {
      const sourceNodes = pg.nodes.filter(
        (n) => n.type === 'internal' || n.type === 'cmd'
      );
      const packages: PackageStatEntry[] = sourceNodes.map((node) => {
        const { entityCount, methodCount, fieldCount } =
          this.aggregateEntityMetrics(node.name);
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
      const sorted = packages.sort((a, b) => b.fileCount - a.fileCount);
      return {
        meta: { dataPath: 'go-atlas', locAvailable: false },
        packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
      };
    }

    // ── Path B: TypeScript (tsAnalysis.moduleGraph) ───────────────────────────
    const mg = this.archJson.extensions?.tsAnalysis?.moduleGraph as TsModuleGraph | undefined;
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
        .filter((n) => n.type === 'internal')
        .map((node) => {
          const files = moduleFiles.get(node.id) ?? [];
          const testFileCount = files.filter((f) => testPattern.test(f)).length;
          const { entityCount, methodCount, fieldCount } =
            this.aggregateEntityMetrics(node.id);
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
      const sorted = packages.sort((a, b) => b.fileCount - a.fileCount);
      return {
        meta: { dataPath: 'ts-module-graph', locAvailable: false },
        packages: topN !== undefined ? sorted.slice(0, topN) : sorted,
      };
    }

    // ── Path C: OO Fallback (Java / Python / C++) ─────────────────────────────
    const testPattern = this.buildTestPattern();
    const packageFiles = new Map<string, string[]>();
    const ooWs = this.archJson.workspaceRoot;
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
          fieldCount += members.filter(
            (m) => m.type === 'property' || m.type === 'field'
          ).length;
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

  /** Project a full Entity to a compact EntitySummary (no members array). */
  toSummary(entity: Entity): EntitySummary {
    const members = entity.members ?? [];
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      visibility: entity.visibility,
      file: entity.sourceLocation.file,
      methodCount: members.filter((m) => m.type === 'method' || m.type === 'constructor').length,
      fieldCount: members.filter((m) => m.type === 'property' || m.type === 'field').length,
    };
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  private aggregateEntityMetrics(
    packagePrefix: string
  ): { entityCount: number; methodCount: number; fieldCount: number } {
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
          // No workspaceRoot: match by path suffix (e.g. absolute key in global/derived scope)
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
        fieldCount += members.filter(
          (m) => m.type === 'property' || m.type === 'field'
        ).length;
      }
    }
    return { entityCount, methodCount, fieldCount };
  }

  private buildTestPattern(): RegExp {
    switch (this.archJson.language) {
      case 'typescript':
        return /\.(test|spec)\.(ts|tsx|js|jsx)$/;
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

  private bfs(
    startName: string,
    direction: 'dependencies' | 'dependents',
    maxDepth: number
  ): Entity[] {
    const clampedDepth = Math.max(1, Math.min(5, maxDepth));
    const startIds = this.index.nameToIds[startName] ?? [];
    if (startIds.length === 0) return [];

    const visited = new Set<string>(startIds);
    const result: Entity[] = [];
    let frontier = [...startIds];

    for (let d = 0; d < clampedDepth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const neighbors = this.index[direction][id] ?? [];
        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            nextFrontier.push(neighborId);
            const entity = this.entityMap.get(neighborId);
            if (entity) result.push(entity);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return result;
  }
}
