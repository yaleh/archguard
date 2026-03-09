import type { ArchJSON, Entity, Member, Module, Relation, ArchJSONMetrics } from '@/types/index.js';

export function canonicalizeArchJson(archJson: ArchJSON): ArchJSON {
  return {
    ...archJson,
    sourceFiles: [...(archJson.sourceFiles ?? [])].sort(),
    entities: [...(archJson.entities ?? [])].map(canonicalizeEntity).sort(compareEntity),
    relations: [...(archJson.relations ?? [])].sort(compareRelation),
    modules: archJson.modules
      ? [...archJson.modules].map(canonicalizeModule).sort(compareModule)
      : undefined,
    metrics: archJson.metrics ? canonicalizeMetrics(archJson.metrics) : archJson.metrics,
    extensions: canonicalizeExtensions(archJson.extensions),
  };
}

function canonicalizeEntity(entity: Entity): Entity {
  return {
    ...entity,
    genericParams: entity.genericParams ? [...entity.genericParams].sort() : entity.genericParams,
    extends: entity.extends ? [...entity.extends].sort() : entity.extends,
    implements: entity.implements ? [...entity.implements].sort() : entity.implements,
    members: [...(entity.members ?? [])].map(canonicalizeMember).sort(compareMember),
  };
}

function canonicalizeMember(member: Member): Member {
  return {
    ...member,
  };
}

function canonicalizeModule(module: Module): Module {
  return {
    ...module,
    entities: [...(module.entities ?? [])].sort(),
    submodules: module.submodules
      ? [...module.submodules].map(canonicalizeModule).sort(compareModule)
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
