/**
 * RelationExtractor - Extracts relationships between entities
 * Story 5: Relationship Extraction
 */

import {
  Project,
  type SourceFile,
  type ClassDeclaration,
  type InterfaceDeclaration,
} from 'ts-morph';
import type { Relation } from '@/types';

/**
 * Extracts relationships (inheritance, implementation, composition, dependency)
 * from TypeScript source code
 */
export class RelationExtractor {
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
      },
    });
  }

  /**
   * Extract all relations from TypeScript code
   * @param code - TypeScript source code string
   * @param filePath - Source file path (default: 'test.ts')
   * @returns Array of Relation objects
   */
  extract(code: string, filePath: string = 'test.ts'): Relation[] {
    const sourceFile = this.project.createSourceFile(filePath, code, {
      overwrite: true,
    });

    return this.extractFromSourceFile(sourceFile);
  }

  /**
   * Extract relations from a SourceFile
   * @param sourceFile - ts-morph SourceFile
   * @returns Array of Relation objects
   */
  extractFromSourceFile(sourceFile: SourceFile): Relation[] {
    const relations: Relation[] = [];
    const relationSet = new Set<string>();

    // Extract from classes
    for (const classDecl of sourceFile.getClasses()) {
      relations.push(...this.extractClassRelations(classDecl, relationSet));
    }

    // Extract from interfaces
    for (const interfaceDecl of sourceFile.getInterfaces()) {
      relations.push(...this.extractInterfaceRelations(interfaceDecl, relationSet));
    }

    return relations;
  }

  /**
   * Extract relations from a class
   * @param classDecl - ClassDeclaration
   * @param relationSet - Set to track unique relations
   * @returns Array of Relation objects
   */
  private extractClassRelations(classDecl: ClassDeclaration, relationSet: Set<string>): Relation[] {
    const relations: Relation[] = [];
    const className = classDecl.getName();

    if (!className) return relations;

    // Extract inheritance (extends)
    const extendsExpr = classDecl.getExtends();
    if (extendsExpr) {
      const parentName = extendsExpr.getExpression().getText();
      this.addRelation(relations, relationSet, 'inheritance', className, parentName);
    }

    // Extract implementation (implements)
    for (const impl of classDecl.getImplements()) {
      const interfaceName = impl.getExpression().getText();
      this.addRelation(relations, relationSet, 'implementation', className, interfaceName);
    }

    // Extract composition from properties
    for (const property of classDecl.getProperties()) {
      const propertyType = this.extractTypeName(property.getType().getText());
      if (propertyType && this.isCustomType(propertyType)) {
        this.addRelation(relations, relationSet, 'composition', className, propertyType);
      }
    }

    // Extract composition from constructor parameters
    for (const constructor of classDecl.getConstructors()) {
      for (const param of constructor.getParameters()) {
        const paramType = this.extractTypeName(param.getType().getText());
        if (paramType && this.isCustomType(paramType)) {
          this.addRelation(relations, relationSet, 'composition', className, paramType);
        }
      }
    }

    // Extract dependencies from method parameters and return types
    for (const method of classDecl.getMethods()) {
      // Method return type
      const returnType = this.extractTypeName(method.getReturnType().getText());
      if (returnType && this.isCustomType(returnType)) {
        this.addRelation(relations, relationSet, 'dependency', className, returnType);
      }

      // Method parameters
      for (const param of method.getParameters()) {
        const paramType = this.extractTypeName(param.getType().getText());
        if (paramType && this.isCustomType(paramType)) {
          this.addRelation(relations, relationSet, 'dependency', className, paramType);
        }
      }
    }

    return relations;
  }

  /**
   * Extract relations from an interface
   * @param interfaceDecl - InterfaceDeclaration
   * @param relationSet - Set to track unique relations
   * @returns Array of Relation objects
   */
  private extractInterfaceRelations(
    interfaceDecl: InterfaceDeclaration,
    relationSet: Set<string>
  ): Relation[] {
    const relations: Relation[] = [];
    const interfaceName = interfaceDecl.getName();

    // Extract interface extension
    for (const extendsExpr of interfaceDecl.getExtends()) {
      const parentName = extendsExpr.getExpression().getText();
      this.addRelation(relations, relationSet, 'inheritance', interfaceName, parentName);
    }

    return relations;
  }

  /**
   * Add a relation if it doesn't already exist
   * @param relations - Array to add relation to
   * @param relationSet - Set to track unique relations
   * @param type - Relation type
   * @param source - Source entity
   * @param target - Target entity
   */
  private addRelation(
    relations: Relation[],
    relationSet: Set<string>,
    type: Relation['type'],
    source: string,
    target: string
  ): void {
    const relationKey = `${type}:${source}:${target}`;

    if (!relationSet.has(relationKey)) {
      relationSet.add(relationKey);
      relations.push({
        id: `${source}_${type}_${target}`,
        type,
        source,
        target,
      });
    }
  }

  /**
   * Extract the main type name from a type string
   * Handles generics, arrays, union types, and import paths
   * @param typeText - Type as text
   * @returns Base type name or null
   */
  private extractTypeName(typeText: string): string | null {
    // Remove whitespace
    typeText = typeText.trim();

    // ✅ Handle ts-morph import() function format
    // Format: import("path").ClassName or import("./relative").ClassName
    if (typeText.startsWith('import(')) {
      const match = typeText.match(/^import\([^)]+\)\.\s*([\w.]+)/);
      if (match) {
        return match[2]; // Return the class name after the dot
      }
    }

    // ✅ Handle import___ path format (ts-morph fully qualified names)
    // Format: import___<file_path>___<actual_class_name>
    // Example: import___home_yale_work_archguard_src_cli_cache_manager___CacheStats
    if (typeText.startsWith('import___')) {
      const parts = typeText.split('___');
      if (parts.length > 0) {
        // Return the last part which is the actual class name
        const actualTypeName = parts[parts.length - 1];
        // If the last part is empty, try the second to last
        if (actualTypeName && actualTypeName.length > 0) {
          return actualTypeName;
        } else if (parts.length > 1) {
          return parts[parts.length - 2];
        }
      }
      // Fallback: if parsing fails, return null to ignore this type
      return null;
    }

    // Handle arrays (e.g., "User[]" -> "User")
    if (typeText.endsWith('[]')) {
      return this.extractTypeName(typeText.slice(0, -2));
    }

    // ✅ Handle generics (e.g., "Promise<User>" -> "User", "Map<K, V>" -> "K" and "V")
    // Must handle BEFORE checking primitive types
    const genericMatch = typeText.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const containerType = genericMatch[1];
      // For containers like Map, Set, Promise, etc., extract the inner type(s)
      const innerType = genericMatch[2];

      // For Map<K, V> or similar multi-parameter generics, extract all types
      // Split by comma outside of angle brackets
      const typeParams: string[] = [];
      let depth = 0;
      let current = '';

      for (const char of innerType) {
        if (char === '<') depth++;
        if (char === '>') depth--;
        if (char === ',' && depth === 0) {
          typeParams.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) {
        typeParams.push(current.trim());
      }

      // Return the first custom type from the parameters
      for (const param of typeParams) {
        const extracted = this.extractTypeName(param);
        if (extracted) {
          return extracted;
        }
      }

      // If no custom type found, return null
      return null;
    }

    // Handle union types - take first type
    if (typeText.includes('|')) {
      const types = typeText.split('|');
      if (types[0]) {
        return this.extractTypeName(types[0]);
      }
    }

    // Handle primitive and built-in types (check AFTER generics)
    if (this.isPrimitiveType(typeText)) {
      return null;
    }

    return typeText;
  }

  /**
   * Check if a type is a custom (user-defined) type
   * @param typeName - Type name
   * @returns True if custom type
   */
  private isCustomType(typeName: string): boolean {
    // Filter out primitives and common built-in types
    return !this.isPrimitiveType(typeName);
  }

  /**
   * Check if a type is a primitive or built-in type
   * @param typeName - Type name
   * @returns True if primitive type
   */
  private isPrimitiveType(typeName: string): boolean {
    const primitives = new Set([
      'string',
      'number',
      'boolean',
      'void',
      'any',
      'unknown',
      'null',
      'undefined',
      'never',
      'object',
      'symbol',
      'bigint',
      'Array',
      'Promise',
      'Date',
      'RegExp',
      'Map',
      'Set',
      'WeakMap',
      'WeakSet',
    ]);

    return primitives.has(typeName);
  }
}
