/**
 * ArchJSON Mapper — converts RawKotlinFile[] → ArchJSON.
 *
 * Design:
 *  - mapEntities(): RawKotlinFile[] → Entity[]
 *  - mapRelations(): RawKotlinFile[] + Entity[] → Relation[]
 *  - map(): full ArchJSON assembly
 *
 * companion_object entries are skipped (they are merged conceptually into their host class).
 */

import { BaseArchJsonMapper, createRelation } from '@/plugins/shared/mapper-utils.js';
import { KotlinTypeExtractor } from './kotlin-type-extractor.js';
import type { RawKotlinFile, RawKotlinClass, RawKotlinMember, KotlinClassKind } from './types.js';
import type {
  ArchJSON,
  Entity,
  EntityType,
  Member,
  MemberType,
  Relation,
  RelationType,
  Decorator,
  Visibility,
} from '@/types/index.js';

// ── Kind → EntityType mapping ──────────────────────────────────────────────

const KIND_TO_ENTITY_TYPE: Record<KotlinClassKind, EntityType | null> = {
  class: 'class',
  abstract_class: 'class',
  data_class: 'class',
  sealed_class: 'class',
  object: 'class',
  companion_object: null, // skipped
  interface: 'interface',
  sealed_interface: 'interface',
  enum_class: 'enum',
};

/**
 * Returns extra synthetic decorators implied by the Kotlin kind modifier.
 * e.g. data_class → [{name:'data'}], sealed_interface → [{name:'sealed'}]
 */
function kindDecorators(kind: KotlinClassKind): Decorator[] {
  switch (kind) {
    case 'data_class':
      return [{ name: 'data' }];
    case 'sealed_class':
    case 'sealed_interface':
      return [{ name: 'sealed' }];
    case 'object':
      return [{ name: 'object' }];
    case 'companion_object':
      return [{ name: 'companion_object' }];
    default:
      return [];
  }
}

// ── ArchJsonMapper ────────────────────────────────────────────────────────

export class ArchJsonMapper extends BaseArchJsonMapper<RawKotlinFile> {
  private readonly typeExtractor = new KotlinTypeExtractor();

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Convert raw Kotlin files to Entity[].
   * companion_object classes are skipped entirely.
   */
  mapEntities(files: RawKotlinFile[]): Entity[] {
    const entities: Entity[] = [];
    const seenIds = new Set<string>();

    for (const file of files) {
      for (const cls of file.classes) {
        const entityType = KIND_TO_ENTITY_TYPE[cls.kind];
        if (entityType === null) {
          // companion_object → skip
          continue;
        }

        const id = this.createEntityId(cls.packageName, cls.name);

        // Merge kind-implied decorators with explicit class-level decorators
        const extraDecorators = kindDecorators(cls.kind);
        const classDecorators: Decorator[] = cls.decorators.map(d => ({ name: d }));
        const allDecorators: Decorator[] = [...extraDecorators, ...classDecorators];

        const members = this.mapMembers(cls.members);

        const entity: Entity = {
          id,
          name: cls.name,
          type: entityType,
          visibility: cls.visibility as Visibility,
          members,
          sourceLocation: this.createSourceLocation(cls.filePath, cls.startLine, cls.endLine),
          ...(allDecorators.length > 0 ? { decorators: allDecorators } : {}),
          ...(cls.kind === 'abstract_class' ? { isAbstract: true } : {}),
        };

        this.pushUniqueEntity(entities, seenIds, entity);
      }
    }

    return entities;
  }

  /**
   * Derive Relation[] from superTypes (inheritance/implementation) and
   * field types (composition).  Uses KotlinTypeExtractor to handle generics.
   *
   * Lookup strategy for superTypes:
   *  1. Build a name→id index from allEntities (simple name and full id).
   *  2. For each superType name, resolve against the index.
   *  3. If resolved entity type === 'interface' → 'implementation'; else → 'inheritance'.
   *
   * All relations are deduplicated by `type:source:target`.
   */
  mapRelations(files: RawKotlinFile[], allEntities: Entity[]): Relation[] {
    // Build lookup: simple name → Entity
    const entityByName = new Map<string, Entity>();
    const entityById = new Map<string, Entity>();

    for (const entity of allEntities) {
      entityById.set(entity.id, entity);
      if (!entityByName.has(entity.name)) {
        entityByName.set(entity.name, entity);
      }
    }

    const seen = new Set<string>();
    const relations: Relation[] = [];

    const addRelation = (type: RelationType, srcId: string, targetId: string): void => {
      if (srcId === targetId) return;
      const key = `${type}:${srcId}:${targetId}`;
      if (seen.has(key)) return;
      seen.add(key);
      relations.push({
        ...createRelation(type, srcId, targetId),
        inferenceSource: 'explicit' as const,
      });
    };

    const resolveEntity = (typeName: string, currentPackage: string): Entity | undefined => {
      // 1. Try direct name lookup (simple class name)
      if (entityByName.has(typeName)) return entityByName.get(typeName);

      // 2. Try same-package qualified ID
      const qualifiedId = `${currentPackage}.${typeName}`;
      if (entityById.has(qualifiedId)) return entityById.get(qualifiedId);

      // 3. Try as a fully-qualified ID (if typeName already contains '.')
      if (typeName.includes('.') && entityById.has(typeName)) return entityById.get(typeName);

      return undefined;
    };

    for (const file of files) {
      for (const cls of file.classes) {
        if (cls.kind === 'companion_object') continue;

        const srcId = this.createEntityId(cls.packageName, cls.name);

        // ── SuperTypes: inheritance / implementation ────────────────────────
        for (const superTypeName of cls.superTypes) {
          const targetEntity = resolveEntity(superTypeName, cls.packageName);
          if (!targetEntity) continue;

          const relType: RelationType =
            targetEntity.type === 'interface' ? 'implementation' : 'inheritance';
          addRelation(relType, srcId, targetEntity.id);
        }

        // ── Field types: composition ────────────────────────────────────────
        for (const member of cls.members) {
          if (member.kind !== 'field' || !member.type) continue;

          const extractedTypes = this.typeExtractor.extractTypes(member.type);
          for (const typeName of extractedTypes) {
            const targetEntity = resolveEntity(typeName, cls.packageName);
            if (!targetEntity) continue;

            addRelation('composition', srcId, targetEntity.id);
          }
        }
      }
    }

    return relations;
  }

  /**
   * Full ArchJSON assembly from raw Kotlin files.
   */
  map(files: RawKotlinFile[], _moduleRoot: string, workspaceRoot: string): ArchJSON {
    const entities = this.mapEntities(files);
    const relations = this.mapRelations(files, entities);

    const sourceFiles = files.map(f => f.filePath);

    return {
      version: '1.0',
      language: 'kotlin',
      timestamp: new Date().toISOString(),
      sourceFiles,
      entities,
      relations,
      workspaceRoot,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private mapMembers(rawMembers: RawKotlinMember[]): Member[] {
    return rawMembers.map(m => this.mapMember(m));
  }

  private mapMember(m: RawKotlinMember): Member {
    const memberType: MemberType = m.kind === 'field' ? 'field' : 'method';

    const decorators: Decorator[] | undefined =
      m.decorators.length > 0 ? m.decorators.map(d => ({ name: d })) : undefined;

    const base: Member = {
      name: m.name,
      type: memberType,
      visibility: m.visibility as Visibility,
      ...(m.isStatic ? { isStatic: true } : {}),
      ...(decorators ? { decorators } : {}),
    };

    if (m.kind === 'field' && m.type) {
      return { ...base, fieldType: m.type };
    }

    if (m.kind === 'method' && m.type) {
      return { ...base, returnType: m.type };
    }

    return base;
  }
}
