/**
 * ArchJSON Mapper - Convert Java raw data to ArchJSON format
 */

import type { Entity, Relation, Member, Visibility } from '@/types/index.js';
import type { JavaRawPackage, JavaRawClass, JavaRawInterface, JavaRawEnum } from './types.js';

export class ArchJsonMapper {
  /**
   * Map Java packages to ArchJSON entities
   */
  mapEntities(packages: JavaRawPackage[]): Entity[] {
    const entities: Entity[] = [];

    for (const pkg of packages) {
      // Map classes
      for (const cls of pkg.classes) {
        entities.push(this.mapClass(cls));
      }

      // Map interfaces
      for (const iface of pkg.interfaces) {
        entities.push(this.mapInterface(iface));
      }

      // Map enums
      for (const enumDecl of pkg.enums) {
        entities.push(this.mapEnum(enumDecl));
      }
    }

    return entities;
  }

  /**
   * Map Java class to Entity
   */
  private mapClass(cls: JavaRawClass): Entity {
    const members: Member[] = [];

    // Map fields
    for (const field of cls.fields) {
      members.push({
        name: field.name,
        type: 'field',
        visibility: this.mapVisibility(field.modifiers),
        fieldType: field.type,
        decorators:
          field.annotations.length > 0
            ? field.annotations.map((a) => ({ name: a.name, arguments: a.arguments }))
            : undefined,
      });
    }

    // Map constructors
    for (const constructor of cls.constructors) {
      members.push({
        name: cls.name,
        type: 'constructor',
        visibility: this.mapVisibility(constructor.modifiers),
        parameters: constructor.parameters.map((p) => ({
          name: p.name,
          type: p.type,
        })),
        decorators:
          constructor.annotations.length > 0
            ? constructor.annotations.map((a) => ({ name: a.name, arguments: a.arguments }))
            : undefined,
      });
    }

    // Map methods
    for (const method of cls.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: this.mapVisibility(method.modifiers),
        returnType: method.returnType,
        parameters: method.parameters.map((p) => ({
          name: p.name,
          type: p.type,
        })),
        isAbstract: method.isAbstract,
        isStatic: method.modifiers.includes('static'),
        decorators:
          method.annotations.length > 0
            ? method.annotations.map((a) => ({ name: a.name, arguments: a.arguments }))
            : undefined,
      });
    }

    return {
      id: this.createEntityId(cls.packageName, cls.name),
      name: cls.name,
      type: 'class',
      visibility: this.mapVisibility(cls.modifiers),
      members,
      sourceLocation: {
        file: cls.filePath,
        startLine: cls.startLine,
        endLine: cls.endLine,
      },
      decorators:
        cls.annotations.length > 0
          ? cls.annotations.map((a) => ({ name: a.name, arguments: a.arguments }))
          : undefined,
      isAbstract: cls.isAbstract,
      extends: cls.superClass ? [cls.superClass] : undefined,
      implements: cls.interfaces.length > 0 ? cls.interfaces : undefined,
    };
  }

  /**
   * Map Java interface to Entity
   */
  private mapInterface(iface: JavaRawInterface): Entity {
    const members: Member[] = [];

    // Map methods
    for (const method of iface.methods) {
      members.push({
        name: method.name,
        type: 'method',
        visibility: this.mapVisibility(method.modifiers),
        returnType: method.returnType,
        parameters: method.parameters.map((p) => ({
          name: p.name,
          type: p.type,
        })),
        isAbstract: true, // Interface methods are implicitly abstract
        decorators:
          method.annotations.length > 0
            ? method.annotations.map((a) => ({ name: a.name, arguments: a.arguments }))
            : undefined,
      });
    }

    return {
      id: this.createEntityId(iface.packageName, iface.name),
      name: iface.name,
      type: 'interface',
      visibility: this.mapVisibility(iface.modifiers),
      members,
      sourceLocation: {
        file: iface.filePath,
        startLine: iface.startLine,
        endLine: iface.endLine,
      },
      decorators:
        iface.annotations.length > 0
          ? iface.annotations.map((a) => ({ name: a.name, arguments: a.arguments }))
          : undefined,
      extends: iface.extends.length > 0 ? iface.extends : undefined,
    };
  }

  /**
   * Map Java enum to Entity
   */
  private mapEnum(enumDecl: JavaRawEnum): Entity {
    const members: Member[] = [];

    // Map enum constants as fields
    for (const value of enumDecl.values) {
      members.push({
        name: value,
        type: 'field',
        visibility: 'public',
        fieldType: enumDecl.name,
      });
    }

    return {
      id: this.createEntityId(enumDecl.packageName, enumDecl.name),
      name: enumDecl.name,
      type: 'enum',
      visibility: this.mapVisibility(enumDecl.modifiers),
      members,
      sourceLocation: {
        file: enumDecl.filePath,
        startLine: enumDecl.startLine,
        endLine: enumDecl.endLine,
      },
    };
  }

  /**
   * Map Java packages to ArchJSON relations
   */
  mapRelations(packages: JavaRawPackage[]): Relation[] {
    const relations: Relation[] = [];

    for (const pkg of packages) {
      // Process classes
      for (const cls of pkg.classes) {
        const sourceId = this.createEntityId(cls.packageName, cls.name);

        // Inheritance (extends)
        if (cls.superClass) {
          const targetId = this.resolveTypeId(cls.superClass, cls.packageName);
          relations.push({
            id: `${sourceId}-extends-${targetId}`,
            type: 'inheritance',
            source: sourceId,
            target: targetId,
          });
        }

        // Implementation (implements)
        for (const iface of cls.interfaces) {
          const targetId = this.resolveTypeId(iface, cls.packageName);
          relations.push({
            id: `${sourceId}-implements-${targetId}`,
            type: 'implementation',
            source: sourceId,
            target: targetId,
          });
        }

        // Field dependencies
        for (const field of cls.fields) {
          const fieldType = this.extractTypeName(field.type);
          if (this.isUserDefinedType(fieldType)) {
            const targetId = this.resolveTypeId(fieldType, cls.packageName);
            relations.push({
              id: `${sourceId}-uses-${targetId}`,
              type: 'dependency',
              source: sourceId,
              target: targetId,
            });
          }
        }

        // Method parameter dependencies
        for (const method of cls.methods) {
          for (const param of method.parameters) {
            const paramType = this.extractTypeName(param.type);
            if (this.isUserDefinedType(paramType)) {
              const targetId = this.resolveTypeId(paramType, cls.packageName);
              relations.push({
                id: `${sourceId}-uses-${targetId}`,
                type: 'dependency',
                source: sourceId,
                target: targetId,
              });
            }
          }
        }
      }

      // Process interfaces
      for (const iface of pkg.interfaces) {
        const sourceId = this.createEntityId(iface.packageName, iface.name);

        // Interface inheritance (extends)
        for (const extendedIface of iface.extends) {
          const targetId = this.resolveTypeId(extendedIface, iface.packageName);
          relations.push({
            id: `${sourceId}-extends-${targetId}`,
            type: 'inheritance',
            source: sourceId,
            target: targetId,
          });
        }
      }
    }

    return relations;
  }

  /**
   * Map Java modifiers to ArchJSON visibility
   */
  private mapVisibility(modifiers: string[]): Visibility {
    if (modifiers.includes('public')) {
      return 'public';
    } else if (modifiers.includes('private')) {
      return 'private';
    } else if (modifiers.includes('protected')) {
      return 'protected';
    }
    // Java package-private (default) - map to public for simplicity
    return 'public';
  }

  /**
   * Create entity ID from package and class name
   */
  private createEntityId(packageName: string, className: string): string {
    if (packageName) {
      return `${packageName}.${className}`;
    }
    return className;
  }

  /**
   * Resolve type ID (handle both simple and fully qualified names)
   */
  private resolveTypeId(typeName: string, currentPackage: string): string {
    // If already fully qualified (contains dot), use as-is
    if (typeName.includes('.')) {
      return typeName;
    }

    // Otherwise, assume it's in the same package
    if (currentPackage) {
      return `${currentPackage}.${typeName}`;
    }

    return typeName;
  }

  /**
   * Extract base type name from complex types (e.g., List<String> -> List)
   */
  private extractTypeName(type: string): string {
    // Remove generic parameters
    const genericIndex = type.indexOf('<');
    if (genericIndex > 0) {
      return type.substring(0, genericIndex);
    }

    // Remove array brackets
    const arrayIndex = type.indexOf('[');
    if (arrayIndex > 0) {
      return type.substring(0, arrayIndex);
    }

    return type;
  }

  /**
   * Check if a type is user-defined (not a primitive or Java standard library)
   */
  private isUserDefinedType(type: string): boolean {
    const primitives = [
      'void',
      'boolean',
      'byte',
      'char',
      'short',
      'int',
      'long',
      'float',
      'double',
      'Boolean',
      'Byte',
      'Character',
      'Short',
      'Integer',
      'Long',
      'Float',
      'Double',
      'String',
      'Object',
    ];

    // Check if it's a primitive
    if (primitives.includes(type)) {
      return false;
    }

    // Skip Java standard library types (simple heuristic)
    if (type.startsWith('java.')) {
      return false;
    }

    return true;
  }
}
