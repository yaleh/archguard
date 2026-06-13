/**
 * QueryEngine — loads a single scope's ArchJSON + ArchIndex and provides query methods.
 *
 * Pure in-memory query object with no disk I/O. Use engine-loader.ts for loading from disk.
 */

import type { ArchJSON, Entity, RelationType, CycleInfo } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { GoAtlasLayers } from '@/types/extensions/go-atlas.js';
import type {
  PackageCoverage,
  TestFileInfo,
} from '@/types/extensions/test-analysis.js';
import { narrowEntities, filterRelationsForScope } from './output-scope-filter.js';
import { serialize } from './edge-list-serializer.js';
import { ArchMetrics } from './arch-metrics.js';
export type { PackageStatEntry, PackageStatMeta, PackageStatsResult } from './arch-metrics.js';

export interface EntitySummary {
  id: string;
  name: string;
  type: string;
  visibility: string;
  file: string;
  methodCount: number;
  fieldCount: number;
}

export interface QueryEngineOptions {
  archJson: ArchJSON;
  archIndex: ArchIndex;
  scopeEntry: QueryScopeEntry;
}

export type OutputScope = 'package' | 'class' | 'method';
export type QueryOutputFormat = 'structured' | 'edge-list';

export interface QueryMethodOptions {
  outputScope?: OutputScope;
  queryFormat?: QueryOutputFormat;
}

export interface EdgeListEntity {
  id: string;
  name: string;
  type: string;
  sourceFile: string;
  methods: Array<{
    name: string;
    params: Array<{ name: string; type: string }>;
    returnType: string;
  }>;
}

export interface EdgeListRelation {
  from: string;
  to: string;
  type: string;
}

export interface EdgeListOutput {
  entities: EdgeListEntity[];
  relations: EdgeListRelation[];
}

export class QueryEngine {
  private archJson: ArchJSON;
  private index: ArchIndex;
  private scopeEntry: QueryScopeEntry;
  private entityMap: Map<string, Entity>;
  private readonly metrics: ArchMetrics;

  constructor(options: QueryEngineOptions) {
    this.archJson = options.archJson;
    this.index = options.archIndex;
    this.scopeEntry = options.scopeEntry;
    // Build entity map for fast lookup
    this.entityMap = new Map(options.archJson.entities.map((e) => [e.id, e]));
    this.metrics = new ArchMetrics(options.archJson, options.archIndex);
  }

  // ----------------------------------------------------------------
  // Query methods
  // ----------------------------------------------------------------

  /** Find entities by exact name match. */
  findEntity(
    name: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const ids = this.index.nameToIds[name] ?? [];
    const entities = ids.map((id) => this.entityMap.get(id)).filter(Boolean);
    return this.applyOutputOptions(entities, options);
  }

  /** BFS along the dependencies direction (what entityName depends on). */
  getDependencies(
    entityName: string,
    depth: number = 1,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    return this.applyOutputOptions(this.bfs(entityName, 'dependencies', depth), options);
  }

  /** BFS along the dependents direction (what depends on entityName). */
  getDependents(
    entityName: string,
    depth: number = 1,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    return this.applyOutputOptions(this.bfs(entityName, 'dependents', depth), options);
  }

  /** Find entities that implement the given interface (relation.type === 'implementation'). */
  findImplementers(
    interfaceName: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const pairs = this.index.relationsByType['implementation'] ?? [];
    const ids = this.index.nameToIds[interfaceName] ?? [];
    const targetSet = new Set(ids);
    const implementerIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    const entities = [...new Set(implementerIds)]
      .map((id) => this.entityMap.get(id))
      .filter(Boolean);
    return this.applyOutputOptions(entities, options);
  }

  /** Find subclasses of the given class (relation.type === 'inheritance'). */
  findSubclasses(
    className: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const pairs = this.index.relationsByType['inheritance'] ?? [];
    const ids = this.index.nameToIds[className] ?? [];
    const targetSet = new Set(ids);
    const subclassIds = pairs
      .filter(([, target]) => targetSet.has(target))
      .map(([source]) => source);
    const entities = [...new Set(subclassIds)].map((id) => this.entityMap.get(id)).filter(Boolean);
    return this.applyOutputOptions(entities, options);
  }

  /** Get all entities defined in a given file. */
  getFileEntities(
    filePath: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const ids = this.index.fileToIds[filePath] ?? [];
    const entities = ids.map((id) => this.entityMap.get(id)).filter(Boolean);
    return this.applyOutputOptions(entities, options);
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
    topPackages: import('./arch-metrics.js').PackageStatEntry[];
    totalPackageCount: number;
    relationCountByType: Partial<Record<RelationType, number>>;
    topByMethodCount: Array<{ name: string; methodCount: number }>;
    topByOutDegree: Array<{ name: string; outDegree: number }>;
  } {
    const hasImplementation = (this.index.relationsByType['implementation']?.length ?? 0) > 0;
    const hasAtlas = !!this.archJson.extensions?.goAtlas?.layers?.package;

    const capabilities = {
      classHierarchy: this.archJson.language !== 'go',
      interfaceImplementation: hasImplementation,
      packageGraph: hasAtlas,
      cycleDetection: this.archJson.language !== 'go',
    };

    const metricsResult = this.metrics.getSummary();

    return {
      ...metricsResult,
      language: this.archJson.language,
      kind: this.scopeEntry.kind,
      capabilities,
    };
  }

  // ----------------------------------------------------------------
  // Search methods
  // ----------------------------------------------------------------

  /** Find entities matching a given EntityType. */
  findByType(
    entityType: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const entities = this.archJson.entities.filter((e) => {
      if (entityType === 'abstract_class') {
        return e.type === 'abstract_class' || (e.isAbstract && e.type === 'class');
      }
      return e.type === entityType;
    });
    return this.applyOutputOptions(entities, options);
  }

  /** Find entities that have the given attribute key (optionally matching a specific value). */
  findByAttr(
    key: string,
    value?: string | number | boolean,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const entities = this.archJson.entities.filter((e) => {
      if (!e.attributes) return false;
      if (value === undefined) return key in e.attributes;
      return e.attributes[key] === value;
    });
    return this.applyOutputOptions(entities, options);
  }

  /**
   * Find entities by type, optionally filtered by an attribute key/value.
   *
   * - entityType only → equivalent to findByType(entityType)
   * - + attrKey (no attrValue) → presence check: entity must have the attribute key
   * - + attrKey + attrValue → value match: entity must have attribute key equal to attrValue
   */
  findByTypeAndAttr(
    entityType: string,
    attrKey?: string,
    attrValue?: string | number | boolean,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    const base = this.archJson.entities.filter((e) => {
      if (entityType === 'abstract_class') {
        return e.type === 'abstract_class' || (e.isAbstract && e.type === 'class');
      }
      return e.type === entityType;
    });
    const entities = base.filter((e) => {
      if (!attrKey) return true;
      if (!e.attributes) return false;
      if (attrValue === undefined) return attrKey in e.attributes;
      return e.attributes[attrKey] === attrValue;
    });
    return this.applyOutputOptions(entities, options);
  }

  /** Find entities whose total incoming + outgoing edges >= threshold. */
  findHighCoupling(threshold: number = 8): Entity[] {
    return this.metrics.findHighCoupling(threshold);
  }

  /** Find entities with zero incoming AND zero outgoing edges. */
  findOrphans(): Entity[] {
    return this.metrics.findOrphans();
  }

  /** Find entities that appear in any cycle. */
  findInCycles(): Entity[] {
    return this.metrics.findInCycles();
  }

  /**
   * Apply outputScope and queryFormat options to a result set.
   * - No options → return as-is (backward compatibility)
   * - scope='class' (default): strip members[]
   * - scope='method': keep all fields including members[]
   * - scope='package': keep only id, name, type, sourceLocation.file
   * - format='edge-list': serialize to flat { entities, relations } structure
   * - format='structured' (default): return narrowed entity array
   */
  applyOutputOptions(
    entities: Entity[],
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    if (!options) return entities; // no options = return as-is (backward compat)

    const scope = options.outputScope ?? 'class';
    const format = options.queryFormat ?? 'structured';

    const narrowed = narrowEntities(entities, scope);
    if (format === 'edge-list') {
      const filteredRelations = filterRelationsForScope(this.archJson.relations, scope);
      return serialize(narrowed, filteredRelations, scope);
    }
    return narrowed;
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
  getTestAnalysis(): import('@/types/extensions/test-analysis.js').TestAnalysis | undefined {
    return this.archJson.extensions?.testAnalysis;
  }

  /** Returns true when the ArchJSON carries a testAnalysis extension. */
  hasTestAnalysis(): boolean {
    return this.archJson.extensions?.testAnalysis !== undefined;
  }

  /**
   * Aggregate CoverageLink[] into per-package buckets.
   * Delegates to ArchMetrics.
   */
  getPackageCoverage(): PackageCoverage[] {
    return this.metrics.getPackageCoverage();
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
    return this.metrics.getEntityCoverage(entityId);
  }

  getPackageStats(
    depth: number = 2,
    topN?: number
  ): import('./arch-metrics.js').PackageStatsResult {
    return this.metrics.getPackageStats(depth, topN);
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

  /**
   * BFS over call edges to find all callers of a given entity (and optionally a specific method).
   *
   * @param entityName  Entity name or "ClassName.methodName" for method-level filtering.
   * @param depth       BFS depth (1–5; clamped automatically).
   */
  findCallers(
    entityName: string,
    depth: number = 1
  ): Array<{ callerEntity: string; callerMethod: string; callType: string; depth: number }> {
    const maxDepth = Math.min(Math.max(depth, 1), 5);
    const dotIdx = entityName.indexOf('.');
    const [targetClass, targetMethod] =
      dotIdx !== -1
        ? [entityName.slice(0, dotIdx), entityName.slice(dotIdx + 1)]
        : [entityName, undefined];

    // Resolve target entity IDs from name
    const targetIds = new Set(this.index.nameToIds[targetClass] ?? []);
    if (targetIds.size === 0) return [];

    const callEdges = this.archJson.relations.filter((r) => r.type === 'call');
    const result: Array<{
      callerEntity: string;
      callerMethod: string;
      callType: string;
      depth: number;
    }> = [];
    const visited = new Set<string>();

    interface QueueItem {
      targetIds: Set<string>;
      targetMethod: string | undefined;
      currentDepth: number;
    }

    const queue: QueueItem[] = [{ targetIds, targetMethod, currentDepth: 1 }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const { targetIds: tIds, targetMethod: tMethod, currentDepth } = item;
      if (currentDepth > maxDepth) continue;

      // Collect callers at this level grouped by (source, sourceMethod) to feed next BFS level
      const nextTargetIds = new Set<string>();
      const nextTargetMethods = new Map<string, string | undefined>();

      for (const edge of callEdges) {
        if (!tIds.has(edge.target)) continue;
        if (tMethod && edge.targetMethod !== tMethod) continue;

        const callerKey = `${edge.source}:${edge.sourceMethod ?? ''}@${currentDepth}`;
        if (visited.has(callerKey)) continue;
        visited.add(callerKey);

        result.push({
          callerEntity: edge.source,
          callerMethod: edge.sourceMethod ?? '',
          callType: edge.callType ?? 'direct',
          depth: currentDepth,
        });

        if (currentDepth < maxDepth) {
          nextTargetIds.add(edge.source);
          // Track the source method to use as method filter at next depth
          if (!nextTargetMethods.has(edge.source)) {
            nextTargetMethods.set(edge.source, edge.sourceMethod);
          } else {
            // Multiple source methods from same entity → no method filter at next level
            nextTargetMethods.set(edge.source, undefined);
          }
        }
      }

      if (nextTargetIds.size > 0 && currentDepth < maxDepth) {
        queue.push({
          targetIds: nextTargetIds,
          targetMethod: undefined, // at deeper levels, don't restrict target method
          currentDepth: currentDepth + 1,
        });
      }
    }

    return result;
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
