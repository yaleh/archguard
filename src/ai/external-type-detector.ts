/**
 * External Type Detector
 * Detects external type references in ArchJSON that are not defined in the current module
 */

import type { ArchJSON } from '../types/index.js';

/**
 * External type reference information
 */
export interface ExternalTypeReference {
  /** Type name */
  name: string;

  /** Inferred type (class, interface, or enum) */
  type: 'class' | 'interface' | 'enum';

  /** Inferred package name */
  package?: string;

  /** Entities that reference this external type */
  referencedBy: string[];
}

/**
 * Configuration options for ExternalTypeDetector
 */
export interface DetectorOptions {
  /** Additional built-in types to filter out */
  additionalBuiltIns?: string[];

  /** Custom package inference rules */
  packageRules?: Map<string, string>;
}

/**
 * Detects external type references in ArchJSON
 */
export class ExternalTypeDetector {
  private readonly builtInTypes: Set<string>;

  constructor(options?: DetectorOptions) {
    // Initialize built-in types
    this.builtInTypes = new Set([
      // TypeScript built-in types
      'string',
      'number',
      'boolean',
      'void',
      'any',
      'unknown',
      'never',
      'null',
      'undefined',
      'Date',
      'Array',
      'Object',
      'Function',
      'Promise',
      'Map',
      'Set',
      'Error',
      'TypeError',
      'SyntaxError',
      'ReferenceError',
      'RegExp',

      // Node.js types
      'Buffer',
      'EventEmitter',
      'Stream',
      'Readable',
      'Writable',
      'Transform',
      'fs',
      'path',
      'http',
      'https',

      // ts-morph types (should be filtered out)
      'Project',
      'SourceFile',
      'ClassDeclaration',
      'InterfaceDeclaration',
      'EnumDeclaration',
      'MethodDeclaration',
      'PropertyDeclaration',
      'ConstructorDeclaration',
      'ParameterDeclaration',
      'TypeChecker',
      'Symbol',
      'Type',
      'Node',
      'SyntaxKind',

      // Common npm packages
      'Ora',
      'chalk',
      'Command',
      'commander',
      'inquirer',
      'execa',
      'Anthropic',
      'AnthropicMessage',

      // Generic type parameters
      'T',
      'K',
      'V',
      'R',
      'P',
      'U',
      'E',
    ]);

    // Add additional built-in types if provided
    if (options?.additionalBuiltIns) {
      options.additionalBuiltIns.forEach((type) => this.builtInTypes.add(type));
    }
  }

  /**
   * Detect external type references from ArchJSON
   *
   * @param archJson - Architecture JSON data
   * @param options - Optional configuration
   * @returns Array of external type references
   */
  detect(archJson: ArchJSON, options?: DetectorOptions): ExternalTypeReference[] {
    // 1. Collect all defined entity names
    const definedEntities = new Set(archJson.entities.map((e) => e.name));

    // 2. Collect all external type references from relations
    const externalRefs = new Map<string, Set<string>>();

    for (const relation of archJson.relations) {
      // Check source
      if (!definedEntities.has(relation.source) && !this.isBuiltInType(relation.source)) {
        if (!externalRefs.has(relation.source)) {
          externalRefs.set(relation.source, new Set());
        }
        externalRefs.get(relation.source)!.add(relation.target);
      }

      // Check target
      if (!definedEntities.has(relation.target) && !this.isBuiltInType(relation.target)) {
        if (!externalRefs.has(relation.target)) {
          externalRefs.set(relation.target, new Set());
        }
        externalRefs.get(relation.target)!.add(relation.source);
      }
    }

    // 3. Convert to ExternalTypeReference array
    const result: ExternalTypeReference[] = [];

    for (const [name, referencedBySet] of externalRefs) {
      result.push({
        name,
        type: this.inferType(name),
        package: this.inferPackage(name, options?.packageRules),
        referencedBy: Array.from(referencedBySet),
      });
    }

    return result;
  }

  /**
   * Check if a type is a built-in type that should be filtered out
   *
   * @private
   * @param name - Type name
   * @returns True if built-in type
   */
  private isBuiltInType(name: string): boolean {
    return this.builtInTypes.has(name);
  }

  /**
   * Infer the type (class, interface, or enum) from the name
   *
   * Simple heuristics:
   * - Ends with Options, Config, Event, or starts with I → interface
   * - All uppercase → enum
   * - Otherwise → class
   *
   * @private
   * @param name - Type name
   * @returns Inferred type
   */
  private inferType(name: string): 'class' | 'interface' | 'enum' {
    // Check for interface patterns
    if (
      name.endsWith('Options') ||
      name.endsWith('Config') ||
      name.endsWith('Event') ||
      name.startsWith('I')
    ) {
      return 'interface';
    }

    // Check for enum patterns (all uppercase)
    if (name === name.toUpperCase() && name.length > 1) {
      return 'enum';
    }

    // Default to class
    return 'class';
  }

  /**
   * Infer the package name for an external type
   *
   * Uses built-in rules and optional custom rules.
   *
   * @private
   * @param name - Type name
   * @param customRules - Optional custom package rules
   * @returns Inferred package name or undefined
   */
  private inferPackage(name: string, customRules?: Map<string, string>): string | undefined {
    // Check custom rules first
    if (customRules?.has(name)) {
      return customRules.get(name);
    }

    // Built-in rules for known types
    const typesModuleTypes = [
      'ArchJSON',
      'Entity',
      'Relation',
      'Member',
      'Visibility',
      'Decorator',
      'Parameter',
      'SourceLocation',
      'EntityType',
      'RelationType',
      'MemberType',
    ];

    if (typesModuleTypes.includes(name)) {
      return 'Types';
    }

    // Default: no package inference
    return undefined;
  }
}
