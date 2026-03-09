/**
 * ArchJSON Mapper - Convert Go raw data to ArchJSON format
 */

import type { ArchJSON, Entity, Relation, Member } from '@/types/index.js';
import type { GoRawPackage, GoRawStruct, GoRawInterface, InferredImplementation } from './types.js';
import { BaseArchJsonMapper } from '@/plugins/shared/mapper-utils.js';

export class ArchJsonMapper extends BaseArchJsonMapper<GoRawPackage> {
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
        this.pushUniqueEntity(entities, seenIds, entity);
      }

      // Map interfaces
      for (const iface of pkg.interfaces) {
        const entity = this.mapInterface(iface, pkgId);
        this.pushUniqueEntity(entities, seenIds, entity);
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
      const targetId = rel.target;
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
        visibility: this.mapExportedVisibility(field.exported),
        fieldType: field.type,
      });
    }

    // Map methods
    for (const method of struct.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: this.mapExportedVisibility(method.exported),
        returnType: method.returnTypes.join(', ') || 'void',
        parameters: this.mapParameters(method.parameters),
      });
    }

    return {
      id: this.createEntityId(packageName, struct.name),
      name: struct.name,
      type: 'struct',
      visibility: this.mapExportedVisibility(struct.exported),
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
        visibility: this.mapExportedVisibility(method.exported),
        returnType: method.returnTypes.join(', ') || 'void',
        parameters: this.mapParameters(method.parameters),
      });
    }

    return {
      id: this.createEntityId(packageName, iface.name),
      name: iface.name,
      type: 'interface',
      visibility: this.mapExportedVisibility(iface.exported),
      members,
      sourceLocation: iface.location,
    };
  }

  /**
   * Map interface implementations to Relations
   */
  mapRelations(packages: GoRawPackage[], implementations: InferredImplementation[]): Relation[] {
    const relations: Relation[] = [];
    const seen = new Set<string>();

    // Map implementations
    for (let i = 0; i < implementations.length; i++) {
      const impl = implementations[i];
      const source = `${impl.structPackageId}.${impl.structName}`;
      const target = `${impl.interfacePackageId}.${impl.interfaceName}`;
      this.pushUniqueRelation(
        relations,
        seen,
        this.createExplicitRelation('implementation', source, target, {
          confidence: impl.confidence,
          inferenceSource: impl.source,
        })
      );
    }

    // TODO: Add dependency relations from imports

    return relations;
  }
}
