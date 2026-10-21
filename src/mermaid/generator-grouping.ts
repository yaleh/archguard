import type { ArchJSON } from '../types/index.js';
import type { Entity, Relation } from '../types/index.js';
import type { GroupingDecision, PackageGroup } from './types.js';

/**
 * Deterministic entity order for diagram output.
 *
 * File discovery and parallel parsing do not guarantee a stable ArchJSON order
 * (and a warm cache can hand back an already-canonicalized order), so the
 * generator sorts explicitly: same input => byte-identical `.mmd`.
 *
 * The key is `id|name`, the same total order `canonicalizeArchJson()` applies
 * before the PlantUML path groups. Entity ids are derived from the file path
 * and symbol name, so this order is stable across cold-parse, warm-cache and
 * parallel-parse runs. Within-group output therefore matches the canonical
 * order the `.puml` golden was captured against; ordering by source location
 * instead would reorder PlantUML output (and skip line numbers lexicographically).
 */
export function compareEntitiesForDiagram(a: Entity, b: Entity): number {
  return `${a.id}|${a.name}`.localeCompare(`${b.id}|${b.name}`);
}

/** Deterministic relation order; same key as `canonicalizeArchJson()`. */
export function compareRelationsForDiagram(a: Relation, b: Relation): number {
  return `${a.id}|${a.source}|${a.target}|${a.type}`.localeCompare(
    `${b.id}|${b.source}|${b.target}|${b.type}`
  );
}

export function groupEntitiesByPackage(
  archJson: ArchJSON,
  grouping: GroupingDecision
): PackageGroup[] {
  if (grouping.packages.length === 0) {
    return [
      {
        name: 'Default',
        entities: archJson.entities.map((entity) => entity.id),
        reasoning: 'Default package containing all entities',
      },
    ];
  }

  return grouping.packages.map((pkg) => ({
    name: pkg.name,
    entities: pkg.entities.filter((id) => archJson.entities.some((entity) => entity.id === id)),
    reasoning: pkg.reasoning,
    // Directory-aware groups carry their path so the generator can emit a
    // dotted namespace id (`src.user`) instead of a flattened display name.
    ...(pkg.path && pkg.path.length > 0 ? { path: pkg.path } : {}),
  }));
}
