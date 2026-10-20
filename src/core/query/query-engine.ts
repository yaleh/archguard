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
import type { QueryScopeEntry } from '@/types/query-scope.js';
import type { PackageCoverage, TestFileInfo } from '@/types/extensions/test-analysis.js';
import type { TsModuleGraph } from '@/types/extensions/ts-analysis.js';
import {
  narrowEntities,
  filterRelationsForScope,
  filterRelationsToClosure,
} from './output-scope-filter.js';
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

/** Relation fields that can be selected for edge-list output. */
export type EdgeListField = 'from' | 'to' | 'type';

export interface QueryMethodOptions {
  outputScope?: OutputScope;
  queryFormat?: QueryOutputFormat;
  /**
   * Entity names that anchor the relation closure (the query's start entities).
   *
   * BFS relation queries return the *neighbors* of the start entity, not the start
   * entity itself. Without declaring it here, edge-list output cannot include the
   * start entity's outgoing/incoming edges. Closure = returned entity IDs ∪ anchor IDs.
   */
  anchorNames?: readonly string[];
  /**
   * Maximum number of relations to serialize (applied after closure narrowing and
   * scope filtering, in deterministic ArchJSON order). Guards against dumping an
   * unbounded edge list for high-degree entities.
   */
  topN?: number;
  /** Restrict serialized relations to these fields (default: all fields). */
  relationFields?: readonly EdgeListField[];
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
  /** Relations within the query closure. Fields may be omitted when filtered. */
  relations: Array<Partial<EdgeListRelation>>;
  /** Number of relations in the closure before `topN` truncation. */
  totalRelations?: number;
  /** True when `topN` truncated the relation list. */
  truncated?: boolean;
}

/** One in-cycle directory edge, with the raw specifier and source position. */
export interface PackageCycleEdgeEvidence {
  /** Importing directory module id (`''` is the root module). */
  from: string;
  /** Imported directory module id (`''` is the root module). */
  to: string;
  /** Raw specifier exactly as written in `file` at `line`. */
  specifier: string;
  /** Project-root-relative file containing the reference. */
  file: string;
  /** 1-based line of the reference. */
  line: number;
}

/** One directory-level strongly connected component (package-granularity cycle). */
export interface PackageCycle {
  /** Number of modules (directories) in this cycle. */
  size: number;
  /** Module IDs (project-root-relative directory paths) that form the SCC. */
  modules: string[];
  /**
   * Every edge whose endpoints both lie in this SCC, carrying the underlying
   * `specifier` + `file:line`. This is what makes a directory-level SCC
   * auditable: e.g. `["", "modules/browser-use"]` dissolves into
   * `index.ts → browser-use/*.js` plus `browser-use-mcp.ts → ../../load-env.js`,
   * showing the root end of the "cycle" is a leaf bootstrap file, not the
   * entrypoint. Absent when the graph carries no per-edge provenance (older
   * ArchJSON), or empty when no in-SCC edge has provenance.
   */
  edges?: PackageCycleEdgeEvidence[];
}

/**
 * Impact of deleting one internal package edge, measured in SCC size.
 *
 * `maxSccBefore` is the size of the largest strongly connected component in the
 * scope's internal package graph; `maxSccAfter` is that same measure after this
 * single edge is removed. `delta = maxSccBefore - maxSccAfter`, so an edge whose
 * deletion does not reduce the largest SCC reads `0` — a measured non-bridge,
 * not a missing entry.
 *
 * Removing one edge is cheap here because package graphs are small (one node per
 * directory), unlike the external per-edge Tarjan brute force this replaces.
 */
export interface PackageEdgeDeletionImpact {
  /** Importing directory module id (`''` is the root module). */
  from: string;
  /** Imported directory module id (`''` is the root module). */
  to: string;
  /**
   * Raw module specifier of the first contributing statement (edges built from
   * older ArchJSON without per-edge provenance read `''`).
   */
  specifier: string;
  /** Largest SCC size before deleting this edge. */
  maxSccBefore: number;
  /** Largest SCC size after deleting this edge. */
  maxSccAfter: number;
  /** `maxSccBefore - maxSccAfter`; `> 0` means this edge is a bridge candidate. */
  delta: number;
}

/**
 * Package-granularity cycle result.
 *
 * Three-valued by construction: `evaluated: false` (with a `reason`) means the
 * scope has no directory-level edges and the answer is genuinely unknown — it
 * must NOT be conflated with `evaluated: true, cycles: []` ("evaluated, no cycles").
 */
export interface PackageCyclesResult {
  granularity: 'package';
  evaluated: boolean;
  /** Present only when `evaluated` is false — why package cycles could not be computed. */
  reason?: string;
  cycles: PackageCycle[];
  /**
   * Largest SCC size in the internal package graph (singletons included; `0`
   * when the graph has no internal nodes). Present only when `evaluated`.
   */
  maxScc?: number;
  /**
   * Every internal package edge, ranked by single-edge deletion impact
   * (`delta` descending, then deterministically by endpoints). Present only when
   * `evaluated` — `[]` honestly means "evaluated, no internal package edges".
   */
  edgeDeletions?: PackageEdgeDeletionImpact[];
  /**
   * Bridge/keystone candidates: the subset of {@link edgeDeletions} with
   * `delta > 0`, i.e. edges whose single deletion shrinks the largest SCC.
   * Present only when `evaluated`.
   */
  bridges?: PackageEdgeDeletionImpact[];
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
    this.relationQueryService = new RelationQueryService(
      options.archJson,
      options.archIndex,
      this.entityQueryService
    );
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

  /**
   * Return directory-level cycles (strongly connected components of the TS
   * module graph). Unlike {@link getCycles}, which is entity/class-granularity,
   * this answers "which directories import each other in a cycle?".
   *
   * Returns an explicitly three-valued result so a caller can distinguish
   * "no cycles at this granularity" (`evaluated: true, cycles: []`) from
   * "this granularity was not evaluated" (`evaluated: false`, with a `reason`).
   * The latter is returned for any scope without directory-level edges: non-TS
   * languages, Go Atlas scopes, or an ArchJSON lacking `tsAnalysis.moduleGraph`.
   */
  getPackageCycles(): PackageCyclesResult {
    const moduleGraph = this.extensionAccessor.getTsModuleGraph();
    if (!moduleGraph) {
      return {
        granularity: 'package',
        evaluated: false,
        reason:
          `no directory-level module graph for this scope ` +
          `(language: ${this.archJson.language}; tsAnalysis.moduleGraph absent)`,
        cycles: [],
      };
    }
    const analysis = this.computePackageGraphAnalysis(moduleGraph);
    return {
      granularity: 'package',
      evaluated: true,
      cycles: analysis.cycles,
      maxScc: analysis.maxScc,
      edgeDeletions: analysis.edgeDeletions,
      bridges: analysis.bridges,
    };
  }

  /**
   * Directory-level SCC analysis over the module graph's internal package edges.
   *
   * Returns cycles (SCCs of size > 1), the baseline `maxScc`, and the impact of
   * deleting each internal edge on `maxScc`. External (node_modules) nodes and
   * self-edges are ignored, matching the module graph's own cycle semantics.
   *
   * The per-edge ranking is what makes keystone/bridge edges answerable in one
   * call: `delta > 0` means removing that single edge shrinks the largest SCC,
   * so callers no longer have to re-run Tarjan once per edge themselves.
   */
  private computePackageGraphAnalysis(moduleGraph: TsModuleGraph): {
    cycles: PackageCycle[];
    maxScc: number;
    edgeDeletions: PackageEdgeDeletionImpact[];
    bridges: PackageEdgeDeletionImpact[];
  } {
    const internal = new Set(
      moduleGraph.nodes.filter((n) => n.type === 'internal').map((n) => n.id)
    );
    const internalEdges = moduleGraph.edges.filter(
      (edge) => edge.from !== edge.to && internal.has(edge.from) && internal.has(edge.to)
    );

    const sccs = this.stronglyConnectedComponents(internal, internalEdges);
    const maxScc = sccs.reduce((max, scc) => Math.max(max, scc.length), 0);

    // One Tarjan run per internal edge. Package graphs are directory-sized
    // (tens of nodes, low hundreds of edges), so this stays cheap and keeps the
    // result exact rather than approximate.
    const edgeDeletions: PackageEdgeDeletionImpact[] = internalEdges.map((edge) => {
      const remaining = internalEdges.filter((candidate) => candidate !== edge);
      const maxSccAfter = this.maxSccSize(internal, remaining);
      return {
        from: edge.from,
        to: edge.to,
        // Evidence is sorted (file, line, specifier, kind) by the builder, so
        // "first" is deterministic. Legacy graphs carry no provenance → ''.
        specifier: edge.evidence?.[0]?.specifier ?? '',
        maxSccBefore: maxScc,
        maxSccAfter,
        delta: maxScc - maxSccAfter,
      };
    });
    edgeDeletions.sort(compareEdgeDeletionImpact);

    const bridges = edgeDeletions.filter((impact) => impact.delta > 0);

    const cycles = sccs
      .filter((scc) => scc.length > 1)
      .sort((a, b) => b.length - a.length || (a[0] ?? '').localeCompare(b[0] ?? ''))
      .map((modules) => {
        const members = new Set(modules);
        const edges = internalEdges
          .filter((edge) => members.has(edge.from) && members.has(edge.to))
          .flatMap((edge) =>
            (edge.evidence ?? []).map((evidence) => ({
              from: edge.from,
              to: edge.to,
              specifier: evidence.specifier,
              file: evidence.file,
              line: evidence.line,
            }))
          )
          .sort(comparePackageCycleEvidence);
        const cycle: PackageCycle = { size: modules.length, modules };
        if (edges.length > 0) cycle.edges = edges;
        return cycle;
      });

    return { cycles, maxScc, edgeDeletions, bridges };
  }

  /** Size of the largest SCC in `edges` (0 when there are no internal nodes). */
  private maxSccSize(
    internal: ReadonlySet<string>,
    edges: readonly Pick<TsModuleGraph['edges'][number], 'from' | 'to'>[]
  ): number {
    return this.stronglyConnectedComponents(internal, edges).reduce(
      (max, scc) => Math.max(max, scc.length),
      0
    );
  }

  /**
   * Tarjan SCC over internal directory edges. Returns every component —
   * singletons included — so callers can measure the largest SCC; cycle
   * reporting filters to size > 1 itself. Members of each SCC are sorted.
   */
  private stronglyConnectedComponents(
    internal: ReadonlySet<string>,
    edges: readonly Pick<TsModuleGraph['edges'][number], 'from' | 'to'>[]
  ): string[][] {
    const adj = new Map<string, string[]>();
    for (const id of internal) adj.set(id, []);
    for (const edge of edges) {
      adj.get(edge.from)?.push(edge.to);
    }

    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let counter = 0;

    const strongConnect = (v: string): void => {
      index.set(v, counter);
      lowlink.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      for (const w of adj.get(v) ?? []) {
        if (!index.has(w)) {
          strongConnect(w);
          lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v) ?? 0, index.get(w) ?? 0));
        }
      }
      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = [];
        let w = '';
        do {
          w = stack.pop() ?? '';
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc.sort());
      }
    };

    for (const id of internal) {
      if (!index.has(id)) strongConnect(id);
    }

    return sccs;
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
      /**
       * Which kind of package graph backs `packageGraph`: `'go-atlas'` when a
       * Go Atlas package graph is present, `'none'` otherwise (e.g. TypeScript,
       * where only directory-level edges exist but are not exposed as a package
       * graph). Callers can branch on this without probing the Atlas-only tools.
       */
      packageGraphKind: 'go-atlas' | 'none';
      /** Human-readable explanation of `packageGraph` / `packageGraphKind`. */
      packageGraphReason: string;
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
      packageGraphKind: hasAtlas ? ('go-atlas' as const) : ('none' as const),
      packageGraphReason: hasAtlas
        ? 'Go Atlas package graph is available for this scope; ' +
          'archguard_get_package_fanin, archguard_get_package_fanout and archguard_get_atlas_layer are usable.'
        : 'Package-graph tools (archguard_get_package_fanin, archguard_get_package_fanout, ' +
          'archguard_get_atlas_layer) require a Go project analyzed with Atlas mode; this scope has none. ' +
          'Use archguard_get_package_stats or archguard_summary(outputScope=package) instead, ' +
          'and archguard_detect_cycles(outputScope=package) for directory-level cycles on TypeScript.',
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
      // Restrict relations to the query closure: the returned entity set plus the
      // explicitly declared start entities. Serializing `this.archJson.relations`
      // here used to leak the whole scope's graph (500k+ chars for large projects).
      const closureIds = new Set<string>();
      for (const entity of entities) {
        if (entity.id) closureIds.add(entity.id);
      }
      for (const anchorName of options.anchorNames ?? []) {
        for (const id of this.index.nameToIds[anchorName] ?? []) {
          closureIds.add(id);
        }
      }

      const closureRelations = filterRelationsToClosure(this.archJson.relations, closureIds);
      const scopedRelations = filterRelationsForScope(closureRelations, scope);
      const totalRelations = scopedRelations.length;
      const limitedRelations =
        options.topN !== undefined ? scopedRelations.slice(0, options.topN) : scopedRelations;

      return serialize(narrowed, limitedRelations, scope, {
        relationFields: options.relationFields,
        totalRelations: options.topN !== undefined ? totalRelations : undefined,
        truncated:
          options.topN !== undefined ? limitedRelations.length < totalRelations : undefined,
      });
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

/**
 * Deterministic ordering for edge-deletion impacts: highest SCC reduction first,
 * then endpoints/specifier so equal-delta edges have a stable rank.
 */
function compareEdgeDeletionImpact(
  a: PackageEdgeDeletionImpact,
  b: PackageEdgeDeletionImpact
): number {
  return (
    b.delta - a.delta ||
    a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to) ||
    a.specifier.localeCompare(b.specifier)
  );
}

/** Deterministic ordering for in-cycle edge evidence (stable in JSON output). */
function comparePackageCycleEvidence(
  a: PackageCycleEdgeEvidence,
  b: PackageCycleEdgeEvidence
): number {
  return (
    a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.specifier.localeCompare(b.specifier)
  );
}
