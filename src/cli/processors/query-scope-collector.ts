/**
 * QueryScopeCollector — accumulates query-layer scopes during diagram processing.
 *
 * Extracted from DiagramProcessor (Plan 34 – Phase A3).
 *
 * Responsibilities:
 * - Maintain the `queryScopes` map (first-write-wins, keyed by source hash)
 * - Maintain `_lastArchJson` with primary-role override semantics
 *
 * @module cli/processors/query-scope-collector
 */

import { hashSources } from './arch-json-provider.js';
import { realpathOrSelf } from './arch-json-utils.js';
import type { InternalQueryScope } from './diagram-processor.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type {
  TsModuleCycle,
  TsModuleCycleEdgeEvidence,
  TsModuleDependency,
  TsModuleEdgeEvidence,
  TsModuleGraph,
  TsModuleNode,
  TsModuleUnresolvedRef,
} from '@/types/extensions/ts-analysis.js';
import type { CrossScopeEdge } from '@/core/query/query-engine.js';
import path from 'path';

/**
 * QueryScopeCollector
 *
 * Accumulates one `InternalQueryScope` per unique source set encountered during
 * a `DiagramProcessor.processAll()` run. Thread-safe for sequential use within
 * a single run (no concurrent access intended).
 */
export class QueryScopeCollector {
  private readonly queryScopes = new Map<string, InternalQueryScope>();
  private _lastArchJson: ArchJSON | null = null;

  /**
   * Register a query scope for the given sources and ArchJSON.
   *
   * No-ops when:
   * - The ArchJSON has no queryable content (empty parse result)
   * - A scope with the same key is already registered (first-write-wins)
   */
  register(
    sources: string[],
    archJson: ArchJSON,
    kind: 'parsed' | 'derived',
    role?: 'primary' | 'secondary'
  ): void {
    if (!hasQueryableContent(archJson)) return;
    const key = hashSources(sources, archJson.language);
    if (this.queryScopes.has(key)) return;
    const normalizedSources = sources.map((s) => realpathOrSelf(path.resolve(s)));
    this.queryScopes.set(key, {
      key,
      sources: normalizedSources,
      archJson,
      kind,
      role,
    });
  }

  /**
   * Update the stored "last ArchJSON" with primary-role and richness semantics.
   *
   * Resolution order (highest priority first):
   * 1. If no value is stored yet: always store.
   * 2. If groupHasPrimary === true: always overwrite (explicit primary wins).
   * 3. If incoming has more entities than stored: overwrite (richer wins).
   *    This ensures pMap completion-order nondeterminism does not cause a
   *    small sub-module ArchJSON (e.g. 4 entities from method/analysis) to
   *    permanently block the larger full-project ArchJSON (e.g. 447 entities).
   * 4. Otherwise: no-op.
   */
  setLastArchJson(archJson: ArchJSON, groupHasPrimary: boolean): void {
    if (this._lastArchJson === null) {
      this._lastArchJson = archJson;
    } else if (groupHasPrimary) {
      this._lastArchJson = archJson;
    } else if ((archJson.entities?.length ?? 0) > (this._lastArchJson.entities?.length ?? 0)) {
      this._lastArchJson = archJson;
    }
    // Otherwise: no-op — stored value is richer or equal
  }

  /**
   * Return all registered query scopes.
   */
  getQuerySourceGroups(): InternalQueryScope[] {
    return Array.from(this.queryScopes.values());
  }

  /**
   * Return the stored "last ArchJSON", or null if none has been set yet.
   */
  getLastArchJson(): ArchJSON | null {
    return this._lastArchJson;
  }
}

function hasQueryableContent(archJson: ArchJSON): boolean {
  if ((archJson.entities?.length ?? 0) > 0) return true;
  return (archJson.extensions?.goAtlas?.layers?.package?.nodes?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Merged multi-scope view
// ---------------------------------------------------------------------------

/** A merged view over two or more independently analysed query scopes. */
export interface MergedQueryView {
  /**
   * Union of the scopes' source roots. Module ids in {@link archJson} are
   * relative to the common ancestor of those roots, so a directory in one
   * subsystem and a directory in another share one coordinate space.
   */
  sources: string[];
  /** Merged ArchJSON: entities, relations and (when present) module graphs. */
  archJson: ArchJSON;
  /** Import edges recovered across scope boundaries, in merged coordinates. */
  crossScopeEdges: CrossScopeEdge[];
}

interface ScopeLayout {
  key: string;
  root: string;
  archJson: ArchJSON;
  /** Scope-relative entity id → merged entity id. */
  entityIdMap: Map<string, string>;
  /** Scope-relative entity id → absolute source file. */
  absFileByEntityId: Map<string, string>;
}

interface ResolvedTarget {
  mergedId: string;
  scopeKey: string;
}

interface EdgeAccumulator {
  from: string;
  to: string;
  strength: number;
  typeOnlyStrength?: number;
  typeOnlyKnown: boolean;
  valueStrength?: number;
  valueKnown: boolean;
  importedNames: Set<string>;
  evidence: TsModuleEdgeEvidence[];
}

interface NodeAccumulator extends TsModuleNode {
  isInternal: boolean;
}

interface DerivedModuleEdge {
  names: Set<string>;
  files: Set<string>;
}

/**
 * Merge independently analysed scopes into one dependency view.
 *
 * Per-scope ArchJSON is unchanged by analysis, so an import that leaves a
 * source root is dropped from the importing scope's module graph. The
 * entity-level relation survives, though, and still names the imported file
 * relative to that scope. This function re-bases every scope onto the common
 * ancestor of their roots, resolves those dangling relation targets against
 * the other scopes' entities, and returns a single ArchJSON whose relations
 * and module graph carry the cross-scope edge.
 *
 * Returns `null` when fewer than two queryable scopes were provided — a single
 * scope is already its own complete view and must not be rewritten.
 */
export function mergeQueryScopes(scopes: readonly InternalQueryScope[]): MergedQueryView | null {
  const eligible = scopes.filter(
    (scope) => scope.sources.length > 0 && hasQueryableContent(scope.archJson)
  );
  if (eligible.length < 2) return null;

  const roots = eligible.map((scope) => path.resolve(realpathOrSelf(scope.sources[0])));
  const commonRoot = commonAncestor(roots);

  // Pass 1: re-base each scope's entities. Entity ids are rebuilt from the
  // absolute source file, so identical scope-relative ids in two scopes
  // (e.g. both have "x.ts.X") can never collide in the merged view.
  const layouts: ScopeLayout[] = eligible.map((scope, i) => {
    const root = roots[i];
    const entityIdMap = new Map<string, string>();
    const absFileByEntityId = new Map<string, string>();
    for (const entity of scope.archJson.entities ?? []) {
      const absFile = entityAbsFile(root, entity);
      const mergedId =
        absFile === undefined
          ? `${scope.key}/${entity.id}`
          : `${toPosix(path.relative(commonRoot, absFile))}.${entity.name}`;
      entityIdMap.set(entity.id, mergedId);
      if (absFile !== undefined) absFileByEntityId.set(entity.id, absFile);
    }
    return { key: scope.key, root, archJson: scope.archJson, entityIdMap, absFileByEntityId };
  });

  // Lazily built, per importing scope: the target string as it appears in that
  // scope → the entity it names in another scope. Only built when a dangling
  // path-like relation target actually needs resolving.
  const targetMaps = new Map<number, Map<string, ResolvedTarget>>();
  const targetMapFor = (scopeIndex: number): Map<string, ResolvedTarget> => {
    let map = targetMaps.get(scopeIndex);
    if (map) return map;
    map = new Map();
    const fromRoot = layouts[scopeIndex].root;
    for (let j = 0; j < layouts.length; j++) {
      if (j === scopeIndex) continue;
      const other = layouts[j];
      for (const entity of other.archJson.entities ?? []) {
        const absFile = other.absFileByEntityId.get(entity.id);
        const mergedId = other.entityIdMap.get(entity.id);
        if (absFile === undefined || mergedId === undefined) continue;
        const seen = `${toPosix(path.relative(fromRoot, absFile))}.${entity.name}`;
        map.set(seen, { mergedId, scopeKey: other.key });
      }
    }
    targetMaps.set(scopeIndex, map);
    return map;
  };

  const entities = new Map<string, Entity>();
  const absFileByMergedId = new Map<string, string>();
  for (const layout of layouts) {
    for (const entity of layout.archJson.entities ?? []) {
      const mergedId = layout.entityIdMap.get(entity.id);
      if (mergedId === undefined) continue;
      if (!entities.has(mergedId)) {
        entities.set(mergedId, { ...entity, id: mergedId });
      }
      const absFile = layout.absFileByEntityId.get(entity.id);
      if (absFile !== undefined && !absFileByMergedId.has(mergedId)) {
        absFileByMergedId.set(mergedId, absFile);
      }
    }
  }

  const relations: Relation[] = [];
  const seenRelations = new Set<string>();
  const crossScopeEdges: CrossScopeEdge[] = [];
  const seenCrossEdges = new Set<string>();
  const derivedModuleEdges = new Map<string, DerivedModuleEdge>();

  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i];
    for (const relation of layout.archJson.relations ?? []) {
      const source =
        layout.entityIdMap.get(relation.source) ?? mergedFallbackId(layout, relation.source);
      const sameScopeTarget = layout.entityIdMap.get(relation.target);
      let target = sameScopeTarget;
      let targetScope = sameScopeTarget === undefined ? undefined : layout.key;
      if (target === undefined) {
        const resolved = isPathLikeTarget(relation.target)
          ? targetMapFor(i).get(relation.target)
          : undefined;
        if (resolved) {
          target = resolved.mergedId;
          targetScope = resolved.scopeKey;
        } else {
          target = isPathLikeTarget(relation.target)
            ? rebasePathTarget(commonRoot, layout.root, relation.target)
            : relation.target;
        }
      }

      const dedupeKey = [
        relation.type,
        source,
        target,
        relation.sourceMethod ?? '',
        relation.targetMethod ?? '',
      ].join('|');
      if (seenRelations.has(dedupeKey)) continue;
      seenRelations.add(dedupeKey);
      relations.push({
        ...relation,
        id: `${source}_${relation.type}_${target}`,
        source,
        target,
      });

      if (targetScope === undefined || targetScope === layout.key) continue;

      const fromFile = layout.absFileByEntityId.get(relation.source);
      const toFile = absFileByMergedId.get(target);
      if (fromFile === undefined || toFile === undefined) continue;
      const fromModule = moduleIdOf(commonRoot, path.dirname(fromFile));
      const toModule = moduleIdOf(commonRoot, path.dirname(toFile));
      if (fromModule === toModule) continue;

      const edgeKey = `${fromModule}|${toModule}|${source}|${target}`;
      if (!seenCrossEdges.has(edgeKey)) {
        seenCrossEdges.add(edgeKey);
        crossScopeEdges.push({
          from: fromModule,
          to: toModule,
          fromScope: layout.key,
          toScope: targetScope,
          source,
          target,
        });
      }

      const moduleKey = `${fromModule}\u0000${toModule}`;
      let derived = derivedModuleEdges.get(moduleKey);
      if (!derived) {
        derived = { names: new Set(), files: new Set() };
        derivedModuleEdges.set(moduleKey, derived);
      }
      derived.names.add(entities.get(target)?.name ?? target.split('.').pop() ?? target);
      derived.files.add(toPosix(path.relative(commonRoot, fromFile)));
    }
  }

  // Module graphs: re-base internal node ids onto the common root, then fold
  // the cross-scope relations back in as directory-level edges.
  const nodes = new Map<string, NodeAccumulator>();
  const edgeMap = new Map<string, EdgeAccumulator>();
  const unresolved: TsModuleUnresolvedRef[] = [];
  let hasModuleGraph = false;
  let graphVersion = '1.0';
  let unevaluatedDynamicImports = 0;

  const addEdge = (
    from: string,
    to: string,
    edge: {
      strength: number;
      typeOnlyStrength?: number;
      valueStrength?: number;
      importedNames: readonly string[];
      evidence: readonly TsModuleEdgeEvidence[];
    }
  ): void => {
    if (from === to) return;
    const key = `${from}\u0000${to}`;
    let acc = edgeMap.get(key);
    if (!acc) {
      acc = {
        from,
        to,
        strength: 0,
        typeOnlyKnown: true,
        valueKnown: true,
        importedNames: new Set(),
        evidence: [],
      };
      edgeMap.set(key, acc);
    }
    acc.strength += edge.strength;
    if (edge.typeOnlyStrength === undefined) acc.typeOnlyKnown = false;
    else if (acc.typeOnlyKnown)
      acc.typeOnlyStrength = (acc.typeOnlyStrength ?? 0) + edge.typeOnlyStrength;
    if (edge.valueStrength === undefined) acc.valueKnown = false;
    else if (acc.valueKnown) acc.valueStrength = (acc.valueStrength ?? 0) + edge.valueStrength;
    for (const name of edge.importedNames) acc.importedNames.add(name);
    acc.evidence.push(...edge.evidence);
  };

  for (const layout of layouts) {
    const graph = layout.archJson.extensions?.tsAnalysis?.moduleGraph;
    if (!graph) continue;
    hasModuleGraph = true;
    graphVersion = layout.archJson.extensions?.tsAnalysis?.version ?? graphVersion;

    const internalIds = new Set(
      (graph.nodes ?? []).filter((node) => node.type === 'internal').map((node) => node.id)
    );
    const rebaseModule = (id: string): string =>
      internalIds.has(id) ? moduleIdOf(commonRoot, path.resolve(layout.root, id)) : id;

    for (const node of graph.nodes ?? []) {
      const id = node.type === 'internal' ? rebaseModule(node.id) : node.id;
      let acc = nodes.get(id);
      if (!acc) {
        acc = {
          id,
          name: node.type === 'internal' ? id || '(root)' : node.name,
          type: node.type,
          fileCount: 0,
          stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
          isInternal: node.type === 'internal',
        };
        nodes.set(id, acc);
      }
      acc.fileCount += node.fileCount;
      acc.stats.classes += node.stats.classes;
      acc.stats.interfaces += node.stats.interfaces;
      acc.stats.functions += node.stats.functions;
      acc.stats.enums += node.stats.enums;
    }

    for (const edge of graph.edges ?? []) {
      addEdge(rebaseModule(edge.from), rebaseModule(edge.to), {
        strength: edge.strength,
        typeOnlyStrength: edge.typeOnlyStrength,
        valueStrength: edge.valueStrength,
        importedNames: edge.importedNames ?? [],
        evidence: (edge.evidence ?? []).map((evidence) => ({
          ...evidence,
          file: toPosix(path.relative(commonRoot, path.resolve(layout.root, evidence.file))),
        })),
      });
    }

    for (const ref of graph.unresolved ?? []) {
      unresolved.push({ from: rebaseModule(ref.from), specifier: ref.specifier });
    }
    if (graph.unevaluatedDynamicImports !== undefined) {
      unevaluatedDynamicImports += graph.unevaluatedDynamicImports;
    }
  }

  for (const [moduleKey, derived] of derivedModuleEdges) {
    const separator = moduleKey.indexOf('\u0000');
    const from = moduleKey.slice(0, separator);
    const to = moduleKey.slice(separator + 1);
    if (!nodes.has(from) || !nodes.has(to)) continue;
    addEdge(from, to, {
      // Relations do not preserve statement boundaries, so this counts the
      // distinct importing files, not the raw statement count. The split
      // fields stay unknown (absent), matching the "undefined means unknown"
      // contract for edges that predate them.
      strength: derived.files.size,
      importedNames: [...derived.names],
      // Raw specifiers and source positions are not retained by relations.
      // An empty specifier + line 0 is the established "no provenance"
      // signal (see PackageEdgeDeletionImpact.specifier and
      // TsModuleEdgeEvidence.line).
      evidence: [...derived.files]
        .sort()
        .map((file) => ({ specifier: '', file, line: 0, kind: 'import' as const })),
    });
  }

  const tsAnalysisVersion = graphVersion || '1.0';
  const moduleGraph: TsModuleGraph | undefined = hasModuleGraph
    ? {
        nodes: [...nodes.values()]
          .sort((a, b) =>
            a.isInternal === b.isInternal ? a.id.localeCompare(b.id) : a.isInternal ? -1 : 1
          )
          .map(({ isInternal: _isInternal, ...node }) => node),
        edges: [...edgeMap.values()]
          .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
          .map(toModuleDependency),
        cycles: [],
      }
    : undefined;
  if (moduleGraph) {
    moduleGraph.cycles = computeModuleCycles(moduleGraph);
    if (unresolved.length > 0) moduleGraph.unresolved = unresolved;
    if (unevaluatedDynamicImports > 0) {
      moduleGraph.unevaluatedDynamicImports = unevaluatedDynamicImports;
    }
  }

  const sourceFiles = [
    ...new Set(layouts.flatMap((layout) => (layout.archJson.sourceFiles ?? []).map(String))),
  ].sort();
  const first = layouts[0].archJson;
  const extensions: ArchJSON['extensions'] = {};
  if (moduleGraph) extensions.tsAnalysis = { version: tsAnalysisVersion, moduleGraph };
  const projectSemantics = first.extensions?.projectSemantics;
  if (projectSemantics) extensions.projectSemantics = projectSemantics;

  const archJson: ArchJSON = {
    version: first.version,
    language: first.language,
    timestamp: new Date().toISOString(),
    sourceFiles,
    entities: [...entities.values()],
    relations,
    workspaceRoot: commonRoot,
    extensions,
  };

  crossScopeEdges.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target)
  );

  return {
    sources: [...new Set(eligible.flatMap((scope) => scope.sources))].sort(),
    archJson,
    crossScopeEdges,
  };
}

function commonAncestor(paths: readonly string[]): string {
  if (paths.length === 0) return path.parse(process.cwd()).root;
  const split = paths.map((p) => p.split(path.sep));
  let common = split[0];
  for (const parts of split.slice(1)) {
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  const joined = common.join(path.sep);
  return joined === '' ? path.sep : joined;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function moduleIdOf(commonRoot: string, absFileOrDir: string): string {
  const relative = toPosix(path.relative(commonRoot, absFileOrDir));
  return relative === '.' ? '' : relative;
}

function entityAbsFile(root: string, entity: Entity): string | undefined {
  const located = entity.sourceLocation?.file;
  if (located) return path.resolve(root, located);
  const suffix = `.${entity.name}`;
  if (entity.name && entity.id.endsWith(suffix)) {
    return path.resolve(root, entity.id.slice(0, entity.id.length - suffix.length));
  }
  return undefined;
}

function mergedFallbackId(layout: ScopeLayout, id: string): string {
  // Relation endpoints are entity ids, so a miss means the entity was not in
  // this scope's list. Keep it namespaced rather than letting two scopes'
  // identical dangling ids silently merge.
  return `${layout.key}/${id}`;
}

function isPathLikeTarget(target: string): boolean {
  const lastDot = target.lastIndexOf('.');
  const filePart = lastDot > 0 ? target.slice(0, lastDot) : target;
  return (
    filePart.startsWith('.') ||
    path.isAbsolute(filePart) ||
    filePart.includes('/') ||
    filePart.includes('\\')
  );
}

/**
 * Re-base a dangling relation target (imported file + entity name) from a
 * scope root onto the merged common root. Used when the target names a file
 * outside every known scope; it stays visible instead of silently vanishing.
 */
function rebasePathTarget(commonRoot: string, root: string, target: string): string {
  const lastDot = target.lastIndexOf('.');
  if (lastDot <= 0) return target;
  const filePart = target.slice(0, lastDot);
  const name = target.slice(lastDot + 1);
  if (!isPathLikeTarget(target)) return target;
  const absFile = path.resolve(root, filePart);
  return `${moduleIdOf(commonRoot, absFile)}.${name}`;
}

function toModuleDependency(acc: EdgeAccumulator): TsModuleDependency {
  return {
    from: acc.from,
    to: acc.to,
    strength: acc.strength,
    ...(acc.typeOnlyKnown ? { typeOnlyStrength: acc.typeOnlyStrength ?? 0 } : {}),
    ...(acc.valueKnown ? { valueStrength: acc.valueStrength ?? 0 } : {}),
    importedNames: [...acc.importedNames].sort(),
    evidence: acc.evidence
      .slice()
      .sort(
        (a, b) =>
          a.file.localeCompare(b.file) ||
          a.line - b.line ||
          a.specifier.localeCompare(b.specifier) ||
          a.kind.localeCompare(b.kind)
      ),
  };
}

/**
 * Tarjan SCC over internal directory modules, mirroring the module-graph
 * builder's cycle semantics (self-edges and external nodes excluded).
 * Iterative so a deeply chained monorepo cannot overflow the call stack.
 */
function computeModuleCycles(graph: TsModuleGraph): TsModuleCycle[] {
  const internal = new Set(graph.nodes.filter((n) => n.type === 'internal').map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const id of internal) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    if (!internal.has(edge.from) || !internal.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
  }

  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let nextIndex = 0;

  for (const start of internal) {
    if (indices.has(start)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    indices.set(start, nextIndex);
    low.set(start, nextIndex);
    nextIndex++;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbors.length) {
        const neighbor = neighbors[frame.next++];
        if (!indices.has(neighbor)) {
          indices.set(neighbor, nextIndex);
          low.set(neighbor, nextIndex);
          nextIndex++;
          stack.push(neighbor);
          onStack.add(neighbor);
          work.push({ node: neighbor, next: 0 });
        } else if (onStack.has(neighbor)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, indices.get(neighbor) ?? 0));
        }
        continue;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1];
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }
      if (low.get(frame.node) === indices.get(frame.node)) {
        const scc: string[] = [];
        let member: string;
        do {
          member = stack.pop() ?? frame.node;
          onStack.delete(member);
          scc.push(member);
        } while (member !== frame.node);
        sccs.push(scc);
      }
    }
  }

  return sccs
    .filter((scc) => scc.length > 1)
    .map((modules) => {
      const members = new Set(modules);
      const edges: TsModuleCycleEdgeEvidence[] = graph.edges
        .filter((edge) => members.has(edge.from) && members.has(edge.to))
        .flatMap((edge) =>
          edge.evidence.map((evidence) => ({
            from: edge.from,
            to: edge.to,
            specifier: evidence.specifier,
            file: evidence.file,
            line: evidence.line,
          }))
        )
        .sort(
          (a, b) =>
            a.from.localeCompare(b.from) ||
            a.to.localeCompare(b.to) ||
            a.file.localeCompare(b.file) ||
            a.line - b.line ||
            a.specifier.localeCompare(b.specifier)
        );
      return {
        modules: [...modules].sort(),
        severity: modules.length === 2 ? 'warning' : 'error',
        edges,
      } satisfies TsModuleCycle;
    })
    .sort(
      (a, b) => b.modules.length - a.modules.length || a.modules[0].localeCompare(b.modules[0])
    );
}
