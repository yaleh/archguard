/**
 * Structural Validator
 * Validates the structural integrity of Mermaid diagrams
 */

import type { ArchJSON } from '../types/index.js';
import type {
  StructuralValidationResult,
  StructuralIssue,
} from './types.js';

/**
 * Validates structural properties of Mermaid diagrams
 */
export class StructuralValidator {
  /**
   * Validate structural integrity
   */
  validate(mermaidCode: string, archJson: ArchJSON): StructuralValidationResult {
    const issues: StructuralIssue[] = [];

    // Check for missing entities
    issues.push(...this.checkMissingEntities(mermaidCode, archJson));

    // Check for invalid relations
    issues.push(...this.checkInvalidRelations(mermaidCode, archJson));

    // Check for circular dependencies
    issues.push(...this.checkCircularDependencies(archJson));

    // Check for orphan entities
    issues.push(...this.checkOrphanEntities(mermaidCode, archJson));

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Check for missing entities in Mermaid code
   */
  private checkMissingEntities(mermaidCode: string, archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    for (const entity of archJson.entities) {
      const entityPattern = new RegExp(`\\bclass\\s+${this.escapeRegex(entity.name)}\\b`, 'i');
      if (!entityPattern.test(mermaidCode)) {
        issues.push({
          type: 'missing-entity',
          message: `Entity not found in diagram: ${entity.name}`,
          entity: entity.name,
          details: {
            id: entity.id,
            type: entity.type,
          },
        });
      }
    }

    return issues;
  }

  /**
   * Check for invalid relations
   */
  private checkInvalidRelations(mermaidCode: string, archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    for (const relation of archJson.relations) {
      const sourceExists = archJson.entities.some((e) => e.id === relation.source);
      const targetExists = archJson.entities.some((e) => e.id === relation.target);

      if (!sourceExists || !targetExists) {
        issues.push({
          type: 'invalid-relation',
          message: `Relation references undefined entity: ${relation.source} -> ${relation.target}`,
          details: {
            relationId: relation.id,
            relationType: relation.type,
            sourceExists,
            targetExists,
          },
        });
      }
    }

    return issues;
  }

  /**
   * Check for circular dependencies
   */
  private checkCircularDependencies(archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (entityId: string): boolean => {
      if (recursionStack.has(entityId)) {
        return true; // Cycle detected
      }
      if (visited.has(entityId)) {
        return false; // Already checked
      }

      visited.add(entityId);
      recursionStack.add(entityId);

      // Get all outgoing relations
      const outgoingRelations = archJson.relations.filter((r) => r.source === entityId);
      for (const relation of outgoingRelations) {
        if (dfs(relation.target)) {
          return true;
        }
      }

      recursionStack.delete(entityId);
      return false;
    };

    for (const entity of archJson.entities) {
      if (dfs(entity.id)) {
        issues.push({
          type: 'circular-dependency',
          message: `Circular dependency detected involving: ${entity.name}`,
          entity: entity.name,
        });
        break; // Report one cycle at a time
      }
    }

    return issues;
  }

  /**
   * Check for orphan entities (no relations)
   */
  private checkOrphanEntities(mermaidCode: string, archJson: ArchJSON): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    // Build entity relation map
    const entityRelationCount = new Map<string, number>();
    for (const entity of archJson.entities) {
      entityRelationCount.set(entity.id, 0);
    }

    // Count relations
    for (const relation of archJson.relations) {
      entityRelationCount.set(relation.source, (entityRelationCount.get(relation.source) ?? 0) + 1);
      entityRelationCount.set(relation.target, (entityRelationCount.get(relation.target) ?? 0) + 1);
    }

    // Find entities with no relations
    for (const [entityId, count] of entityRelationCount.entries()) {
      if (count === 0) {
        const entity = archJson.entities.find((e) => e.id === entityId);
        if (entity) {
          issues.push({
            type: 'orphan-entity',
            message: `Entity has no relations: ${entity.name}`,
            entity: entity.name,
            details: {
              id: entity.id,
            },
          });
        }
      }
    }

    return issues;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
