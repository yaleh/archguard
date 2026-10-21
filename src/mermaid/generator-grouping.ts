import type { ArchJSON } from '../types/index.js';
import type { GroupingDecision, PackageGroup } from './types.js';

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
