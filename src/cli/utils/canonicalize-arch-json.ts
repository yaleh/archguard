import type { ArchJSON, Entity, Member, Module, Relation, ArchJSONMetrics } from '@/types/index.js';

/**
 * Normalize a path-ish string to posix separators.
 */
function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Build the id/path normalizer for one ArchJSON.
 *
 * Write-side identity normalization (gap-entity-id-relative-normalization):
 * the same analysis run can emit entity ids in two shapes — Path A
 * (`TypeScriptParser.parseProject`, package-level diagrams) relativizes ids
 * against the analysis root, while Path B (the parallel parser / worker path)
 * can leak absolute ids because the worker-side plugin does not receive the
 * per-scope workspace root (see the Path B note in `parallel-parser.ts`).
 * Persisted arch.json then contained `/data/home/.../x.ts.Name` for a
 * subdirectory scope and `dir/x.ts.Name` for its parent scope, so consumers
 * that key by id or group by the id prefix produced bogus groups such as
 * `data (159)`.
 *
 * `canonicalizeArchJson` is the single choke point every persisted ArchJSON
 * passes through (query scopes, disk cache, JSON diagram output), so the
 * normalization belongs here rather than at each reader.
 *
 * Rules:
 * - an id/path under `workspaceRoot` becomes workspace-relative;
 * - all separators become `/` (also for values that are already relative);
 * - every occurrence of the root prefix is stripped, because relation ids
 *   embed both endpoints (`<source>_<type>_<target>`);
 * - anything that does not name the workspace root is left semantically
 *   untouched (external ids, bare entity names, opaque relation ids).
 */
function createWorkspaceNormalizer(workspaceRoot?: string): (value: string) => string {
  const root = workspaceRoot ? toPosix(workspaceRoot).replace(/\/+$/, '') : '';
  if (!root) return toPosix;
  const prefix = `${root}/`;
  return (value: string) => {
    if (!value) return value;
    const posix = toPosix(value);
    return posix.includes(prefix) ? posix.split(prefix).join('') : posix;
  };
}

export function canonicalizeArchJson(archJson: ArchJSON): ArchJSON {
  const normalize = createWorkspaceNormalizer(archJson.workspaceRoot);

  return {
    ...archJson,
    sourceFiles: [...(archJson.sourceFiles ?? [])].sort(),
    entities: [...(archJson.entities ?? [])]
      .map((entity) => canonicalizeEntity(entity, normalize))
      .sort(compareEntity),
    relations: [...(archJson.relations ?? [])]
      .map((relation) => canonicalizeRelation(relation, normalize))
      .sort(compareRelation),
    modules: archJson.modules
      ? [...archJson.modules]
          .map((module) => canonicalizeModule(module, normalize))
          .sort(compareModule)
      : undefined,
    metrics: archJson.metrics ? canonicalizeMetrics(archJson.metrics) : archJson.metrics,
    extensions: canonicalizeExtensions(archJson.extensions),
  };
}

function canonicalizeEntity(entity: Entity, normalize: (value: string) => string): Entity {
  return {
    ...entity,
    id: normalize(entity.id),
    sourceLocation: entity.sourceLocation
      ? { ...entity.sourceLocation, file: normalize(entity.sourceLocation.file) }
      : entity.sourceLocation,
    genericParams: entity.genericParams ? [...entity.genericParams].sort() : entity.genericParams,
    extends: entity.extends ? [...entity.extends].sort() : entity.extends,
    implements: entity.implements ? [...entity.implements].sort() : entity.implements,
    members: [...(entity.members ?? [])].map(canonicalizeMember).sort(compareMember),
  };
}

function canonicalizeRelation(relation: Relation, normalize: (value: string) => string): Relation {
  // `source`/`target` reference entity ids; `id` embeds them
  // (`<source>_<type>_<target>`). Both must move to the same coordinate or the
  // graph breaks — an entity id renamed without its relation endpoints leaves
  // an edge pointing at an id no index entry owns.
  return {
    ...relation,
    id: normalize(relation.id),
    source: normalize(relation.source),
    target: normalize(relation.target),
  };
}

function canonicalizeMember(member: Member): Member {
  return {
    ...member,
  };
}

function canonicalizeModule(module: Module, normalize: (value: string) => string): Module {
  return {
    ...module,
    entities: [...(module.entities ?? [])].map(normalize).sort(),
    submodules: module.submodules
      ? [...module.submodules]
          .map((submodule) => canonicalizeModule(submodule, normalize))
          .sort(compareModule)
      : module.submodules,
  };
}

function canonicalizeMetrics(metrics: ArchJSONMetrics): ArchJSONMetrics {
  return {
    ...metrics,
    fileStats: metrics.fileStats
      ? [...metrics.fileStats].sort((a, b) => a.file.localeCompare(b.file))
      : metrics.fileStats,
    cycles: metrics.cycles
      ? [...metrics.cycles]
          .map((cycle) => ({
            ...cycle,
            files: [...(cycle.files ?? [])].sort(),
            memberNames: [...(cycle.memberNames ?? [])].sort(),
          }))
          .sort((a, b) => a.files.join('|').localeCompare(b.files.join('|')))
      : metrics.cycles,
  };
}

function canonicalizeExtensions(extensions: ArchJSON['extensions']): ArchJSON['extensions'] {
  if (!extensions) return extensions;

  const next: Record<string, unknown> = { ...extensions };
  const tsAnalysis = next.tsAnalysis as
    | { moduleGraph?: { nodes?: unknown[]; edges?: unknown[] } }
    | undefined;
  if (tsAnalysis?.moduleGraph) {
    tsAnalysis.moduleGraph = {
      ...tsAnalysis.moduleGraph,
      nodes: [...(tsAnalysis.moduleGraph.nodes ?? [])].sort(compareJsonish),
      edges: [...(tsAnalysis.moduleGraph.edges ?? [])].sort(compareJsonish),
    };
  }

  return next as ArchJSON['extensions'];
}

function compareEntity(a: Entity, b: Entity): number {
  return `${a.id}|${a.name}`.localeCompare(`${b.id}|${b.name}`);
}

function compareMember(a: Member, b: Member): number {
  return `${a.name}|${a.type}|${a.visibility}`.localeCompare(`${b.name}|${b.type}|${b.visibility}`);
}

function compareRelation(a: Relation, b: Relation): number {
  return `${a.id}|${a.source}|${a.target}|${a.type}`.localeCompare(
    `${b.id}|${b.source}|${b.target}|${b.type}`
  );
}

function compareModule(a: Module, b: Module): number {
  return a.name.localeCompare(b.name);
}

function compareJsonish(a: unknown, b: unknown): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}
