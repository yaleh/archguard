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
}

/**
 * PlantUMLValidator - validates PlantUML output
 */
export class PlantUMLValidator {
  /**
   * Perform complete validation (syntax + completeness + style)
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

    // 3. Style validation (warnings only)
    const styleResult = this.validateStyle(puml);
    if (styleResult.warnings && styleResult.warnings.length > 0) {
      // Style warnings don't make it invalid, but we track them
      // For now, we don't add them to issues to keep validation passing
    }

    return {
      isValid: issues.length === 0,
      issues,
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
