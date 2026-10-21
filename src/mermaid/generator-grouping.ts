import type { ArchJSON } from '../types/index.js';
import type { Entity, Relation } from '../types/index.js';
import type { GroupingDecision, PackageGroup } from './types.js';

/**
 * Deterministic entity order for diagram output.
 *
 * File discovery and parallel parsing do not guarantee a stable ArchJSON order
 * (and a warm cache can hand back an already-canonicalized order), so the
 * generator sorts explicitly: same input => byte-identical `.mmd`.
 */
export function compareEntitiesForDiagram(a: Entity, b: Entity): number {
  const keyA = `${a.sourceLocation?.file ?? ''}|${a.sourceLocation?.startLine ?? 0}|${a.sourceLocation?.endLine ?? 0}|${a.id}|${a.name}`;
  const keyB = `${b.sourceLocation?.file ?? ''}|${b.sourceLocation?.startLine ?? 0}|${b.sourceLocation?.endLine ?? 0}|${b.id}|${b.name}`;
  return keyA.localeCompare(keyB);
}

/** Deterministic relation order; same rationale as compareEntitiesForDiagram. */
export function compareRelationsForDiagram(a: Relation, b: Relation): number {
  const keyA = `${a.source}|${a.target}|${a.type}|${a.id}`;
  const keyB = `${b.source}|${b.target}|${b.type}|${b.id}`;
  return keyA.localeCompare(keyB);
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
