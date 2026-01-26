/**
 * ValidatedMermaidGenerator - Generates Mermaid diagram code from ArchJSON
 * Ensures valid Mermaid syntax and proper structure
 */

import type { ArchJSON, Entity, Member, Relation } from '../types/index.js';
import type {
  MermaidDetailLevel,
  GroupingDecision,
  PackageGroup,
  MermaidGeneratorOptions,
  MermaidTheme,
} from './types.js';

/**
 * Validated Mermaid Generator
 * Generates Mermaid class diagrams with full validation
 */
export class ValidatedMermaidGenerator {
  private readonly archJson: ArchJSON;
  private readonly options: Required<MermaidGeneratorOptions>;

  constructor(
    archJson: ArchJSON,
    options: {
      level: MermaidDetailLevel;
      grouping: GroupingDecision;
      theme?: MermaidTheme;
      includePrivate?: boolean;
      includeProtected?: boolean;
      maxDepth?: number;
    }
  ) {
    this.archJson = archJson;
    this.options = {
      level: options.level,
      grouping: options.grouping,
      theme: options.theme || { name: 'default' },
      includePrivate: options.includePrivate ?? true,
      includeProtected: options.includeProtected ?? true,
      maxDepth: options.maxDepth ?? 3,
    };
  }

  /**
   * Generate Mermaid diagram code
   */
  generate(): string {
    // Validate before generation
    this.validateBeforeGenerate();

    // Generate based on level
    let code: string;
    switch (this.options.level) {
      case 'package':
        code = this.generatePackageLevel();
        break;
      case 'method':
        code = this.generateMethodLevel();
        break;
      case 'class':
      default:
        code = this.generateClassLevel();
        break;
    }

    // Post-process and return
    return this.postProcess(code);
  }

  /**
   * Validate ArchJSON before generation
   */
  private validateBeforeGenerate(): void {
    // Check for circular references
    const entityIds = new Set(this.archJson.entities.map((e) => e.id));

    for (const relation of this.archJson.relations) {
      if (!entityIds.has(relation.source) || !entityIds.has(relation.target)) {
        console.warn(
          `Warning: Relation references undefined entity: ${relation.source} -> ${relation.target}`
        );
      }
    }

    // Validate entity names don't contain problematic characters
    for (const entity of this.archJson.entities) {
      if (entity.name.includes('\n') || entity.name.includes('"')) {
        throw new Error(`Invalid entity name: ${entity.name}`);
      }
    }
  }

  /**
   * Generate package-level diagram
   */
  private generatePackageLevel(): string {
    const lines: string[] = ['classDiagram'];

    // Group entities by packages
    const packageGroups = this.groupEntitiesByPackage();

    for (const group of packageGroups) {
      lines.push(`  namespace ${this.escapeId(group.name)} {`);

      for (const entityId of group.entities) {
        const entity = this.archJson.entities.find((e) => e.id === entityId);
        if (entity) {
          lines.push(`    class ${this.escapeId(entity.name)}`);
        }
      }

      lines.push('  }');
    }

    // Add relationships
    lines.push(...this.generateRelations(packageGroups));

    return lines.join('\n');
  }

  /**
   * Generate class-level diagram
   */
  private generateClassLevel(): string {
    const lines: string[] = ['classDiagram'];

    const packageGroups = this.groupEntitiesByPackage();

    // If we have grouping, use namespaces
    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        lines.push(`  namespace ${this.escapeId(group.name)} {`);

        for (const entityId of group.entities) {
          const entity = this.archJson.entities.find((e) => e.id === entityId);
          if (entity) {
            lines.push(...this.generateClassDefinition(entity, 2));
          }
        }

        lines.push('  }');
      }

      // Add all relationships at the end
      for (const relation of this.archJson.relations) {
        lines.push(`  ${this.generateRelationLine(relation)}`);
      }
    } else {
      // No grouping or default grouping, just list all classes
      for (const entity of this.archJson.entities) {
        lines.push(...this.generateClassDefinition(entity, 1));
      }

      // Add all relationships
      for (const relation of this.archJson.relations) {
        lines.push(`  ${this.generateRelationLine(relation)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate method-level diagram (detailed)
   */
  private generateMethodLevel(): string {
    const lines: string[] = ['classDiagram'];

    const packageGroups = this.groupEntitiesByPackage();

    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        lines.push(`  namespace ${this.escapeId(group.name)} {`);

        for (const entityId of group.entities) {
          const entity = this.archJson.entities.find((e) => e.id === entityId);
          if (entity) {
            lines.push(...this.generateClassDefinition(entity, 2, true));
          }
        }

        lines.push('  }');
      }
    } else {
      for (const entity of this.archJson.entities) {
        lines.push(...this.generateClassDefinition(entity, 1, true));
      }
    }

    // Add relationships
    for (const relation of this.archJson.relations) {
      lines.push(`  ${this.generateRelationLine(relation)}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate class definition with members
   */
  private generateClassDefinition(entity: Entity, indent: number, detailed = false): string[] {
    const lines: string[] = [];
    const padding = '  '.repeat(indent);

    // Class declaration with generic parameters
    const genericSuffix = entity.genericParams?.length ? `<${entity.genericParams.join(', ')}>` : '';
    const classType = entity.type === 'interface' ? 'class' : entity.type;
    lines.push(`${padding}${classType} ${this.escapeId(entity.name)}${genericSuffix} {`);

    // Add members
    for (const member of entity.members) {
      if (!this.shouldIncludeMember(member)) {
        continue;
      }

      const memberLine = this.generateMemberLine(member, detailed);
      lines.push(`${padding}  ${memberLine}`);
    }

    lines.push(`${padding}}`);

    // Add inheritance/implementation
    if (entity.extends && entity.extends.length > 0) {
      for (const parent of entity.extends) {
        lines.push(`${padding}${this.escapeId(parent)} <|-- ${this.escapeId(entity.name)}`);
      }
    }

    if (entity.implements && entity.implements.length > 0) {
      for (const iface of entity.implements) {
        lines.push(`${padding}${this.escapeId(iface)} <|.. ${this.escapeId(entity.name)}`);
      }
    }

    return lines;
  }

  /**
   * Generate member line
   */
  private generateMemberLine(member: Member, detailed: boolean): string {
    const visibility = this.getVisibilitySymbol(member.visibility);
    const staticModifier = member.isStatic ? '{static}' : '';
    const abstractModifier = member.isAbstract ? '{abstract}' : '';

    if (member.type === 'property') {
      const readonly = member.isReadonly ? 'readonly' : '';
      const optional = member.isOptional ? '?' : '';
      const type = member.fieldType ? `: ${this.sanitizeType(member.fieldType)}` : '';
      return `${visibility}${staticModifier}${abstractModifier}${readonly} ${member.name}${optional}${type}`;
    } else if (member.type === 'method' || member.type === 'constructor') {
      const async = member.isAsync ? 'async ' : '';
      const returnType = member.returnType ? `: ${this.sanitizeType(member.returnType)}` : '';
      const params = this.generateParameters(member.parameters, detailed);
      return `${visibility}${staticModifier}${abstractModifier}${async}${member.name}(${params})${returnType}`;
    }

    return `${visibility} ${member.name}`;
  }

  /**
   * Generate parameters list
   */
  private generateParameters(parameters?: Member['parameters'], detailed = true): string {
    if (!parameters || parameters.length === 0) {
      return '';
    }

    return parameters
      .map((param) => {
        const optional = param.isOptional ? '?' : '';
        // Skip default values in Mermaid - they're not well supported
        // const defaultStr = param.defaultValue ? ` = ${param.defaultValue}` : '';
        return `${param.name}${optional}: ${this.sanitizeType(param.type)}`;
      })
      .join(', ');
  }

  /**
   * Generate relation line
   */
  private generateRelationLine(relation: Relation): string {
    const source = this.escapeId(relation.source);
    const target = this.escapeId(relation.target);

    switch (relation.type) {
      case 'inheritance':
        return `${source} <|-- ${target}`;
      case 'implementation':
        return `${source} <|.. ${target}`;
      case 'composition':
        return `${source} *-- ${target}`;
      case 'aggregation':
        return `${source} o-- ${target}`;
      case 'dependency':
      default:
        return `${source} --> ${target}`;
    }
  }

  /**
   * Generate all relations for package level
   */
  private generateRelations(_packageGroups: PackageGroup[]): string[] {
    const lines: string[] = [];

    for (const relation of this.archJson.relations) {
      lines.push(`  ${this.generateRelationLine(relation)}`);
    }

    return lines;
  }

  /**
   * Group entities by package
   */
  private groupEntitiesByPackage(): PackageGroup[] {
    if (this.options.grouping.packages.length === 0) {
      // If no explicit grouping, create a single default package with all entities
      return [
        {
          name: 'Default',
          entities: this.archJson.entities.map((e) => e.id),
          reasoning: 'Default package containing all entities',
        },
      ];
    }

    return this.options.grouping.packages.map((pkg) => ({
      name: pkg.name,
      entities: pkg.entities.filter((id) => this.archJson.entities.some((e) => e.id === id)),
      reasoning: pkg.reasoning,
    }));
  }

  /**
   * Check if member should be included based on visibility
   */
  private shouldIncludeMember(member: Member): boolean {
    if (member.visibility === 'private' && !this.options.includePrivate) {
      return false;
    }
    if (member.visibility === 'protected' && !this.options.includeProtected) {
      return false;
    }
    return true;
  }

  /**
   * Get visibility symbol
   */
  private getVisibilitySymbol(visibility: Member['visibility']): string {
    switch (visibility) {
      case 'public':
        return '+';
      case 'private':
        return '-';
      case 'protected':
        return '#';
      default:
        return '+';
    }
  }

  /**
   * Escape entity ID for Mermaid
   */
  private escapeId(id: string): string {
    // For all IDs (including namespaces), replace special characters with underscores
    // Mermaid doesn't support quoted identifiers in all contexts
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Sanitize type string
   */
  private sanitizeType(type: string): string {
    if (!type) return 'any';

    // Simplify complex types for better readability
    let simplified = type;

    // Remove inline object types like { field: type }
    simplified = simplified.replace(/\{[^}]*\}/g, 'object');

    // Remove function types
    simplified = simplified.replace(/\([^)]*\)\s*=>\s*/, 'function');

    // Remove union types complexity
    simplified = simplified.replace(/\|/g, ' or ');

    // Remove intersection types
    simplified = simplified.replace(/&/g, ' and ');

    // Handle generic types - convert angle brackets to tilde notation
    simplified = simplified.replace(/</g, '~').replace(/>/g, '~');

    // Remove array brackets notation
    simplified = simplified.replace(/\[\]/g, 'Array');

    // Normalize whitespace
    simplified = simplified.replace(/\s+/g, ' ').trim();

    // If still too complex or empty, just return 'any'
    if (simplified.length > 50 || simplified === '') {
      return 'any';
    }

    return simplified;
  }

  /**
   * Post-process generated code
   */
  private postProcess(code: string): string {
    // Clean up extra whitespace
    let processed = code.trim();

    // Ensure proper spacing
    processed = processed.replace(/\n{3,}/g, '\n\n');

    return processed;
  }
}
