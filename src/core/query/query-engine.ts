/**
 * QueryEngine — loads a single scope's ArchJSON + ArchIndex and provides query methods.
 *
 * Pure in-memory query object with no disk I/O. Use engine-loader.ts for loading from disk.
 *
 * QueryEngine members: ~20 public + 2 private (down from 32 before Phase 109-111).
 * Entity-search logic lives in EntityQueryService; extension access in ExtensionAccessor;
 * metrics/aggregation in ArchMetrics. QueryEngine is now a thin coordination layer.
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
import { ExtensionAccessor } from './extension-accessor.js';
import { EntityQueryService } from './entity-query-service.js';
import { RelationQueryService } from './relation-query-service.js';
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
  private readonly metrics: ArchMetrics;
  private readonly extensionAccessor: ExtensionAccessor;
  private readonly entityQueryService: EntityQueryService;
  readonly relationQueryService: RelationQueryService;

  constructor(options: QueryEngineOptions) {
    this.archJson = options.archJson;
    this.index = options.archIndex;
    this.scopeEntry = options.scopeEntry;
    this.extensionAccessor = new ExtensionAccessor(options.archJson);
    this.entityQueryService = new EntityQueryService(options.archJson, options.archIndex);
    this.relationQueryService = new RelationQueryService(options.archJson, options.archIndex, this.entityQueryService);
    this.metrics = new ArchMetrics(options.archJson, options.archIndex, this.extensionAccessor);
  }

  // ----------------------------------------------------------------
  // Query methods
  // ----------------------------------------------------------------

  /** Find entities by exact name match. */
  findEntity(
    name: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    return this.applyOutputOptions(this.entityQueryService.findEntity(name), options);
  }

  /** Get all entities defined in a given file. */
  getFileEntities(
    filePath: string,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    return this.applyOutputOptions(this.entityQueryService.getFileEntities(filePath), options);
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
    const hasAtlas = !!this.archJson.extensions?.goAtlas;

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
    return this.applyOutputOptions(this.entityQueryService.findByType(entityType), options);
  }

  /** Find entities that have the given attribute key (optionally matching a specific value). */
  findByAttr(
    key: string,
    value?: string | number | boolean,
    options?: QueryMethodOptions
  ): Entity[] | Partial<Entity>[] | EdgeListOutput {
    return this.applyOutputOptions(this.entityQueryService.findByAttr(key, value), options);
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
    return this.applyOutputOptions(
      this.entityQueryService.findByTypeAndAttr(entityType, attrKey, attrValue),
      options
    );
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

}
