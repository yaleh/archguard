import type { Relation, RelationType } from '@/types/index.js';

/**
 * Generate a dot-separated entity ID: packageName.EntityName
 */
export function generateEntityId(packageName: string, entityName: string): string {
  return `${packageName}.${entityName}`;
}

/**
 * Create a structured Relation object with id = source_type_target
 */
export function createRelation(type: RelationType, source: string, target: string): Relation {
  return {
    id: `${source}_${type}_${target}`,
    type,
    source,
    target,
  };
}
