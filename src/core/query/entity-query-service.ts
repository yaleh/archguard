/**
 * EntityQueryService — entity-search methods over a single ArchJSON scope.
 *
 * Extracted from QueryEngine (Phase 110) to enforce single responsibility.
 * Returns raw Entity[] — callers are responsible for applying output options
 * (scope narrowing, format serialization) via QueryEngine.applyOutputOptions().
 *
 * No import from query-engine.ts to avoid circular dependencies.
 */

import type { ArchJSON, Entity } from '@/types/index.js';
import type { ArchIndex } from './arch-index.js';

export class EntityQueryService {
  private readonly entityMap: Map<string, Entity>;

  constructor(
    private readonly archJson: ArchJSON,
    private readonly index: ArchIndex
  ) {
    this.entityMap = new Map(archJson.entities.map((e) => [e.id, e]));
  }

  /** Find entities by exact name match. */
  findEntity(name: string): Entity[] {
    const ids = this.index.nameToIds[name] ?? [];
    return ids.map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Find entities matching a given EntityType. */
  findByType(entityType: string): Entity[] {
    return this.archJson.entities.filter((e) => {
      if (entityType === 'abstract_class') {
        return e.type === 'abstract_class' || (e.isAbstract && e.type === 'class');
      }
      return e.type === entityType;
    });
  }

  /** Find entities that have the given attribute key (optionally matching a specific value). */
  findByAttr(key: string, value?: string | number | boolean): Entity[] {
    return this.archJson.entities.filter((e) => {
      if (!e.attributes) return false;
      if (value === undefined) return key in e.attributes;
      return e.attributes[key] === value;
    });
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
    attrValue?: string | number | boolean
  ): Entity[] {
    const base = this.findByType(entityType);
    return base.filter((e) => {
      if (!attrKey) return true;
      if (!e.attributes) return false;
      if (attrValue === undefined) return attrKey in e.attributes;
      return e.attributes[attrKey] === attrValue;
    });
  }

  /** Get all entities defined in a given file. */
  getFileEntities(filePath: string): Entity[] {
    const ids = this.index.fileToIds[filePath] ?? [];
    return ids.map((id) => this.entityMap.get(id)).filter(Boolean);
  }

  /** Lookup a single entity by ID. */
  getById(id: string): Entity | undefined {
    return this.entityMap.get(id);
  }
}
