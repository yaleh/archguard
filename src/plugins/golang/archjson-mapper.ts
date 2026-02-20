/**
 * ArchJSON Mapper - Convert Go raw data to ArchJSON format
 */

import type {
  ArchJSON,
  Entity,
  Relation,
  Member,
} from '@/types/index.js';
import type { GoRawPackage, GoRawStruct, GoRawInterface, GoFunction, InferredImplementation } from './types.js';

export class ArchJsonMapper {
  /**
   * Map Go packages to ArchJSON entities
   */
  mapEntities(packages: GoRawPackage[]): Entity[] {
    const entities: Entity[] = [];

    for (const pkg of packages) {
      // Map structs
      for (const struct of pkg.structs) {
        entities.push(this.mapStruct(struct, pkg.name));
      }

      // Map interfaces
      for (const iface of pkg.interfaces) {
        entities.push(this.mapInterface(iface, pkg.name));
      }
    }

    return entities;
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
        parameters: method.parameters.map(p => ({
          name: p.name,
          type: p.type,
        })),
      });
    }

    return {
      id: `${packageName}.${struct.name}`,
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
        parameters: method.parameters.map(p => ({
          name: p.name,
          type: p.type,
        })),
      });
    }

    return {
      id: `${packageName}.${iface.name}`,
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
  mapRelations(
    packages: GoRawPackage[],
    implementations: InferredImplementation[]
  ): Relation[] {
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
