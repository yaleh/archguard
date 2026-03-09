import type {
  Entity,
  Parameter,
  Relation,
  RelationType,
  SourceLocation,
  Visibility,
} from '@/types/index.js';

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

export abstract class BaseArchJsonMapper<TPackage, TRawEntity = never> {
  protected createEntityId(packageName: string, entityName: string): string {
    return generateEntityId(packageName, entityName);
  }

  protected createSourceLocation(
    file: string,
    startLine: number,
    endLine: number
  ): SourceLocation {
    return { file, startLine, endLine };
  }

  protected mapExportedVisibility(exported: boolean): Visibility {
    return exported ? 'public' : 'private';
  }

  protected mapModifierVisibility(
    modifiers: string[],
    fallback: Visibility = 'public'
  ): Visibility {
    if (modifiers.includes('public')) return 'public';
    if (modifiers.includes('private')) return 'private';
    if (modifiers.includes('protected')) return 'protected';
    return fallback;
  }

  protected mapParameters<
    T extends { name: string; type?: string; defaultValue?: string; isOptional?: boolean },
  >(parameters: T[], defaultType = 'any'): Parameter[] {
    return parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type || defaultType,
      ...(parameter.isOptional !== undefined ? { isOptional: parameter.isOptional } : {}),
      ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {}),
    }));
  }

  protected pushUniqueEntity(
    entities: Entity[],
    seenIds: Set<string>,
    entity: Entity
  ): void {
    if (seenIds.has(entity.id)) {
      return;
    }
    seenIds.add(entity.id);
    entities.push(entity);
  }

  protected pushUniqueRelation(
    relations: Relation[],
    seenKeys: Set<string>,
    relation: Relation,
    key = `${relation.type}:${relation.source}:${relation.target}`
  ): void {
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    relations.push(relation);
  }

  protected createExplicitRelation(
    type: RelationType,
    source: string,
    target: string,
    extras: Partial<Relation> = {}
  ): Relation {
    return {
      ...createRelation(type, source, target),
      ...extras,
    };
  }
}
