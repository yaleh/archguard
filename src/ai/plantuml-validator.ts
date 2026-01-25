/**
 * PlantUML Validator
 * Validates generated PlantUML syntax and completeness
 */

import { ArchJSON } from '../types';

/**
 * Validation result structure
 */
export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  errors?: string[];
  warnings?: string[];
  missingEntities?: string[];
  undefinedReferences?: string[]; // New: undefined entity references in relationships
}

/**
 * PlantUMLValidator - validates PlantUML output
 */
export class PlantUMLValidator {
  /**
   * Perform complete validation (syntax + completeness + relationships + style)
   */
  validate(puml: string, archJson: ArchJSON): ValidationResult {
    const issues: string[] = [];

    // 1. Syntax validation (critical)
    const syntaxResult = this.validateSyntax(puml);
    if (!syntaxResult.isValid) {
      issues.push(...(syntaxResult.errors || []));
    }

    // 2. Completeness validation (critical)
    const completenessResult = this.validateCompleteness(puml, archJson);
    if (!completenessResult.isValid) {
      const missingEntities = completenessResult.missingEntities || [];
      issues.push(...missingEntities.map((entity) => `Missing entity: ${entity}`));
    }

    // 3. Relationship validation (NEW - critical)
    const relationshipResult = this.validateRelationshipReferences(puml, archJson);
    if (!relationshipResult.isValid) {
      const undefinedRefs = relationshipResult.undefinedReferences || [];
      issues.push(...undefinedRefs);
    }

    // 4. Style validation (warnings only)
    const styleResult = this.validateStyle(puml);
    if (styleResult.warnings && styleResult.warnings.length > 0) {
      // Style warnings don't make it invalid, but we track them
      // For now, we don't add them to issues to keep validation passing
    }

    return {
      isValid: issues.length === 0,
      issues,
      undefinedReferences: relationshipResult.undefinedReferences,
    };
  }

  /**
   * Validate PlantUML syntax
   */
  validateSyntax(puml: string): ValidationResult {
    const errors: string[] = [];

    // Check for required tags
    if (!puml.includes('@startuml')) {
      errors.push('Missing @startuml');
    }

    if (!puml.includes('@enduml')) {
      errors.push('Missing @enduml');
    }

    // Check for common syntax errors
    if (puml.includes('class class') || puml.includes('interface interface')) {
      errors.push('Duplicate "class" keyword');
    }

    // More syntax checks can be added here
    // - Malformed relationships
    // - Invalid visibility modifiers
    // - Unclosed braces
    // etc.

    return {
      isValid: errors.length === 0,
      issues: errors,
      errors,
    };
  }

  /**
   * Validate completeness against ArchJSON
   */
  validateCompleteness(puml: string, archJson: ArchJSON): ValidationResult {
    const missingEntities: string[] = [];

    // Check if all entities are present in the PlantUML
    for (const entity of archJson.entities) {
      // Create regex to find entity declaration
      // Matches: "class EntityName", "interface EntityName", "enum EntityName"
      const regex = new RegExp(`\\b(class|interface|enum)\\s+${this.escapeRegex(entity.name)}\\b`);

      if (!regex.test(puml)) {
        missingEntities.push(entity.name);
      }
    }

    return {
      isValid: missingEntities.length === 0,
      issues: missingEntities.map((e) => `Missing: ${e}`),
      missingEntities,
    };
  }

  /**
   * ✅ NEW: Validate relationship references
   * Ensures all relationships only reference defined entities
   */
  validateRelationshipReferences(puml: string, archJson: ArchJSON): ValidationResult {
    const undefinedReferences: string[] = [];

    // 1. Extract all defined entity names from PlantUML
    const definedEntities = new Set<string>();

    // Match: class EntityName, interface EntityName, enum EntityName
    const entityRegex = /\b(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = entityRegex.exec(puml)) !== null) {
      if (match[2]) {
        definedEntities.add(match[2]); // match[2] is the entity name
      }
    }

    // Also add entities from ArchJSON (in case regex missed something)
    for (const entity of archJson.entities) {
      definedEntities.add(entity.name);
    }

    // 2. Known external types to ignore (built-ins and common libraries)
    const externalTypes = new Set([
      // JavaScript/TypeScript built-ins
      'string',
      'number',
      'boolean',
      'void',
      'any',
      'unknown',
      'never',
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
      'EventEmitter',
      'Readable',
      'Writable',
      'Stream',

      // Node.js types
      'Buffer',
      'fs',
      'path',
      'http',
      'https',

      // Common npm packages (context-specific)
      'Ora',
      'chalk',
      'commander',
      'inquirer',
      'execa',
      'Anthropic',
      'AnthropicMessage',

      // Generic type parameters (should not be in relationships)
      'T',
      'K',
      'V',
      'R',
      'P',
    ]);

    // 3. Extract all entity references from relationships
    // Match patterns like:
    //   EntityA *-- EntityB
    //   EntityA --> EntityB : label
    //   EntityA --|> EntityB
    const relationshipLines = puml
      .split('\n')
      .filter(
        (line) =>
          line.includes('--') ||
          line.includes('..>') ||
          line.includes('-->') ||
          line.includes('*--') ||
          line.includes('-o') ||
          line.includes('--|>')
      );

    for (const line of relationshipLines) {
      // Extract entity references from the line
      // This regex matches patterns like:
      //   EntityA *-- EntityB
      //   EntityA --> EntityB : label
      //   EntityA --|> EntityB
      const relationMatch = line.match(
        /([A-Za-z_][A-Za-z0-9_.]*)\s+[*\-|.>]+\s+([A-Za-z_][A-Za-z0-9_.]*)/
      );

      if (relationMatch) {
        const sourceEntity = relationMatch[1];
        const targetEntity = relationMatch[2];

        // Clean up entity names (remove qualifiers like "Map<string, string>")
        const source = this.cleanEntityName(sourceEntity || '');
        const target = this.cleanEntityName(targetEntity || '');

        // Check if referenced entities are defined
        if (!definedEntities.has(source) && !externalTypes.has(source)) {
          const msg = `Relationship references undefined entity: "${source}" (line: "${line.trim()}")`;
          if (!undefinedReferences.includes(msg)) {
            undefinedReferences.push(msg);
          }
        }

        if (!definedEntities.has(target) && !externalTypes.has(target)) {
          const msg = `Relationship references undefined entity: "${target}" (line: "${line.trim()}")`;
          if (!undefinedReferences.includes(msg)) {
            undefinedReferences.push(msg);
          }
        }
      }
    }

    return {
      isValid: undefinedReferences.length === 0,
      issues: undefinedReferences,
      undefinedReferences,
    };
  }

  /**
   * Clean entity name by removing generic parameters and quotes
   * Examples:
   *   "Map<string, string>" -> Map
   *   Anthropic.Message -> Anthropic
   */
  private cleanEntityName(name: string): string {
    // Remove quotes
    name = name.replace(/^"|"$/g, '');

    // Remove generic parameters: Map<K, V> -> Map
    name = name.replace(/<[^>]*>/g, '');

    // Remove qualified names: Anthropic.Message -> Anthropic
    name = name.replace(/\.[A-Za-z].*$/, '');

    // Remove any remaining special characters
    name = name.replace(/[^A-Za-z0-9_]/g, '');

    return name;
  }

  /**
   * Validate style and best practices (non-blocking)
   */
  validateStyle(puml: string): ValidationResult {
    const warnings: string[] = [];

    // Check for theme
    if (!puml.includes('!theme')) {
      warnings.push('Consider adding a theme (!theme cerulean-outline)');
    }

    // Check for packages (good practice for organization)
    if (!puml.includes('package')) {
      warnings.push('Consider grouping classes with packages');
    }

    // Style checks don't block validation
    return {
      isValid: true,
      issues: warnings,
      warnings,
    };
  }

  /**
   * Escape special regex characters in entity names
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
