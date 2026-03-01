/**
 * ArchJSON Mapper - Convert Go raw data to ArchJSON format
 */

import type { ArchJSON, Entity, Relation, Member } from '@/types/index.js';
import type {
  GoRawPackage,
  GoRawStruct,
  GoRawInterface,
  InferredImplementation,
} from './types.js';
import { generateEntityId } from '@/plugins/shared/mapper-utils.js';

export class ArchJsonMapper {
  /**
   * Map Go packages to ArchJSON entities
   */
  mapEntities(packages: GoRawPackage[]): Entity[] {
    const entities: Entity[] = [];
    const seenIds = new Set<string>();

    for (const pkg of packages) {
      const pkgId = pkg.fullName || pkg.name;

      // Map structs
      for (const struct of pkg.structs) {
        const entity = this.mapStruct(struct, pkgId);
        if (!seenIds.has(entity.id)) {
          seenIds.add(entity.id);
          entities.push(entity);
        }
      }

      // Map interfaces
      for (const iface of pkg.interfaces) {
        const entity = this.mapInterface(iface, pkgId);
        if (!seenIds.has(entity.id)) {
          seenIds.add(entity.id);
          entities.push(entity);
        }
      }
    }

    return entities;
  }

  /**
   * Scan implementation relation targets and return any interface entities
   * that are referenced but not yet present in the entities array.
   * External dependency interfaces (not found in any package) are skipped silently.
   */
  mapMissingInterfaceEntities(
    entities: Entity[],
    relations: Relation[],
    packages: GoRawPackage[]
  ): Entity[] {
    const existingIds = new Set(entities.map((e) => e.id));
    const added: Entity[] = [];
    const addedIds = new Set<string>();

    // Build a lookup: "pkgFullName.TypeName" → { iface, pkgId }
    const ifaceLookup = new Map<string, { iface: GoRawInterface; pkgId: string }>();
    for (const pkg of packages) {
      const pkgId = pkg.fullName || pkg.name;
      for (const iface of pkg.interfaces) {
        ifaceLookup.set(`${pkgId}.${iface.name}`, { iface, pkgId });
      }
    }

    // Scan implementation relation targets
    for (const rel of relations) {
      if (rel.type !== 'implementation') continue;
      const targetId = rel.target as string;
      if (existingIds.has(targetId) || addedIds.has(targetId)) continue;

      const entry = ifaceLookup.get(targetId);
      if (entry) {
        const entity = this.mapInterface(entry.iface, entry.pkgId);
        added.push(entity);
        addedIds.add(targetId);
      }
      // If not found in packages (external dep), skip silently
    }

    return added;
  }

  /**
   * Map Go struct to Entity
   */
  private mapStruct(struct: GoRawStruct, packageName: string): Entity {
    const members: Member[] = [];

    // Map fields
    for (const field of struct.fields) {
      members.push({
        name: field.name,
        type: 'field',
        visibility: field.exported ? 'public' : 'private',
        fieldType: field.type,
      });
    }

    // Map methods
    for (const method of struct.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: method.exported ? 'public' : 'private',
        returnType: method.returnTypes.join(', ') || 'void',
        parameters: method.parameters.map((p) => ({
          name: p.name,
          type: p.type,
        })),
      });
    }

    return {
      id: generateEntityId(packageName, struct.name),
      name: struct.name,
      type: 'struct',
      visibility: struct.exported ? 'public' : 'private',
      members,
      sourceLocation: struct.location,
    };
  }

  /**
   * Map Go interface to Entity
   */
  private mapInterface(iface: GoRawInterface, packageName: string): Entity {
    const members: Member[] = [];

    // Map methods
    for (const method of iface.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: method.exported ? 'public' : 'private',
        returnType: method.returnTypes.join(', ') || 'void',
        parameters: method.parameters.map((p) => ({
          name: p.name,
          type: p.type,
        })),
      });
    }

    return {
      id: generateEntityId(packageName, iface.name),
      name: iface.name,
      type: 'interface',
      visibility: iface.exported ? 'public' : 'private',
      members,
      sourceLocation: iface.location,
    };
  }

  /**
   * Map interface implementations to Relations
   */
  mapRelations(packages: GoRawPackage[], implementations: InferredImplementation[]): Relation[] {
    const relations: Relation[] = [];

    // Map implementations
    for (let i = 0; i < implementations.length; i++) {
      const impl = implementations[i];
      relations.push({
        id: `impl-${i}`,
        type: 'implementation',
        source: `${impl.structPackageId}.${impl.structName}`,
        target: `${impl.interfacePackageId}.${impl.interfaceName}`,
        confidence: impl.confidence,
        inferenceSource: impl.source,
      });
    }

    // TODO: Add dependency relations from imports

    return relations;
  }
}
