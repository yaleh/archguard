/**
 * ValidatedMermaidGenerator - Generates Mermaid diagram code from ArchJSON
 * Ensures valid Mermaid syntax and proper structure
 *
 * v2.1.0: Integrated CommentGenerator for self-documenting diagrams
 */

import type { ArchJSON, Entity, Member, Relation } from '../types/index.js';
import type { DiagramConfig } from '../types/config.js';
import type {
  MermaidDetailLevel,
  GroupingDecision,
  PackageGroup,
  MermaidGeneratorOptions,
  MermaidTheme,
} from './types.js';
import { CommentGenerator } from './comment-generator.js';
import { isExternalDependency } from './external-dependencies.js';

/**
 * Validated Mermaid Generator
 * Generates Mermaid class diagrams with full validation
 */
export class ValidatedMermaidGenerator {
  private readonly archJson: ArchJSON;
  private readonly options: Required<MermaidGeneratorOptions>;
  private readonly diagramConfig?: DiagramConfig;
  private readonly commentGenerator: CommentGenerator;
  private readonly verbose: boolean;

  constructor(
    archJson: ArchJSON,
    options: {
      level: MermaidDetailLevel;
      grouping: GroupingDecision;
      theme?: MermaidTheme;
      includePrivate?: boolean;
      includeProtected?: boolean;
      maxDepth?: number;
      verbose?: boolean;
    },
    diagramConfig?: DiagramConfig
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
    this.diagramConfig = diagramConfig;
    this.verbose = options.verbose ?? false;
    this.commentGenerator = new CommentGenerator();
  }

  /**
   * Generate Mermaid diagram code
   *
   * v2.1.0: Adds comment generation if diagramConfig is provided
   */
  generate(): string {
    // Validate before generation
    this.validateBeforeGenerate();

    // Start with comment header (v2.1.0)
    const lines: string[] = ['classDiagram'];

    // Add metadata comments if enabled (v2.1.0)
    if (this.diagramConfig && this.diagramConfig.annotations?.enableComments !== false) {
      const comments = this.commentGenerator.generateAll(this.diagramConfig);
      if (comments) {
        lines.push(comments);
        lines.push(''); // Empty line separator
      }
    }

    // Generate based on level
    let diagramCode: string;
    switch (this.options.level) {
      case 'package':
        diagramCode = this.generatePackageLevel();
        break;
      case 'method':
        diagramCode = this.generateMethodLevel();
        break;
      case 'class':
      default:
        diagramCode = this.generateClassLevel();
        break;
    }

    // Remove the initial 'classDiagram' from diagramCode since we already added it
    const diagramLines = diagramCode.split('\n').slice(1);
    lines.push(...diagramLines);

    // v2.1.1: Add visible title at the end (bottom) or beginning (top)
    if (this.diagramConfig && this.diagramConfig.annotations?.enableVisibleTitle) {
      const visibleTitle = this.commentGenerator.generateVisibleTitle(this.diagramConfig);
      if (visibleTitle) {
        const position = this.diagramConfig.annotations.titlePosition || 'bottom';

        if (position === 'bottom') {
          // Add at the end (after diagram content)
          lines.push(visibleTitle);
        } else {
          // Add at the beginning (after classDiagram but before diagram content)
          // Insert after comments but before the first diagram line
          const insertIndex = lines.findIndex((line) => !line.startsWith('%%') && line !== 'classDiagram');
          if (insertIndex !== -1) {
            lines.splice(insertIndex, 0, visibleTitle);
          }
        }
      }
    }

    // Join and post-process
    const code = lines.join('\n');
    return this.postProcess(code);
  }

  /**
   * Validate ArchJSON before generation
   */
  private validateBeforeGenerate(): void {
    // Check for circular references
    const entityIds = new Set(this.archJson.entities.map((e) => e.id));
    const filteredWarnings: string[] = [];

    for (const relation of this.archJson.relations) {
      const sourceExists = entityIds.has(relation.source);
      const targetExists = entityIds.has(relation.target);

      if (!sourceExists || !targetExists) {
        // Check if the undefined entities are external dependencies
        const sourceIsExternal = !sourceExists && isExternalDependency(relation.source);
        const targetIsExternal = !targetExists && isExternalDependency(relation.target);

        // Only warn if both are not external dependencies
        if (!sourceIsExternal || !targetIsExternal) {
          const warningParts: string[] = [];

          if (!sourceExists && !sourceIsExternal) {
            warningParts.push(`source: ${relation.source}`);
          }
          if (!targetExists && !targetIsExternal) {
            warningParts.push(`target: ${relation.target}`);
          }

          if (warningParts.length > 0) {
            filteredWarnings.push(`  - ${relation.source} -> ${relation.target} (${warningParts.join(', ')})`);
          }
        }
      }
    }

    // Print warnings (if any)
    if (filteredWarnings.length > 0) {
      console.warn(`⚠️  Warning: ${filteredWarnings.length} relation(s) reference undefined entities:`);
      console.warn(filteredWarnings.join('\n'));
    }

    // Log filtered warnings in verbose mode
    if (this.verbose) {
      const filteredCount = this.archJson.relations.filter(
        (r) =>
          (!entityIds.has(r.source) && isExternalDependency(r.source)) ||
          (!entityIds.has(r.target) && isExternalDependency(r.target))
      ).length;

      if (filteredCount > 0) {
        console.debug(`🔇 Filtered ${filteredCount} external dependency warning(s)`);
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
          lines.push(`    class ${this.escapeId(this.normalizeEntityName(entity.name))}`);
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
            lines.push(...this.generateClassDefinition(entity, 2, true));
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
        lines.push(...this.generateClassDefinition(entity, 1, true));
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

    // Class declaration - Mermaid doesn't support generics in class names
    // Remove generic parameters from the class name
    const className = this.escapeId(this.normalizeEntityName(entity.name));
    const classType = entity.type === 'interface' ? 'class' : entity.type;
    lines.push(`${padding}${classType} ${className} {`);

    // Add members (with null check)
    const members = entity.members || [];
    for (const member of members) {
      if (!this.shouldIncludeMember(member)) {
        continue;
      }

      const memberLine = this.generateMemberLine(member, detailed);
      lines.push(`${padding}  ${memberLine}`);
    }

    lines.push(`${padding}}`);

    // Note: Inheritance/implementation relations are generated separately
    // at the end of the diagram to ensure parent classes are defined first

    return lines;
  }

  /**
   * Generate member line - Enhanced to handle default values
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

      // Build parameters string, removing default values
      const params =
        member.parameters
          ?.map((p) => {
            const optional = p.isOptional ? '?' : '';
            const paramType = p.type ? `: ${this.sanitizeType(p.type)}` : '';
            return `${p.name}${optional}${paramType}`;
          })
          .join(', ') || '';

      return `${visibility}${staticModifier}${abstractModifier}${async}${member.name}(${params})${returnType}`;
    } else {
      // Fallback for unknown member types
      return `${visibility}${member.name}`;
    }
  }

  /**
   * Normalize entity name for Mermaid diagram
   * Handles import___ path format and import() function format from ts-morph
   */
  private normalizeEntityName(name: string): string {
    // Remove special characters that aren't valid in Mermaid identifiers

    // ✅ Handle ts-morph import() function format
    // Format: import("path").ClassName or import("./relative").ClassName
    if (name.startsWith('import(')) {
      const match = name.match(/^import\([^)]+\)\.\s*([\w.]+)/);
      if (match) {
        return match[2]; // Return the class name after the dot
      }
    }

    // ✅ Handle import___ path format (ts-morph fully qualified names)
    // Format: import___<file_path>___<actual_class_name>
    // Example: import___home_yale_work_archguard_src_cli_cache_manager___CacheStats
    if (name.startsWith('import___')) {
      const parts = name.split('___');
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length > 0) {
          return lastPart;
        }
      }
    }

    // Handle complex type objects
    if (name.startsWith('{') || name.includes('=>')) {
      return '[Type]';
    }

    return name;
  }

  /**
   * Generate relation line
   */
  private generateRelationLine(relation: Relation): string {
    const source = this.escapeId(this.normalizeEntityName(relation.source));
    const target = this.escapeId(this.normalizeEntityName(relation.target));

    switch (relation.type) {
      case 'inheritance':
        // Mermaid syntax: Parent <|-- Child
        // In ArchJSON: source = child, target = parent
        // So we need: target <|-- source
        return `${target} <|-- ${source}`;
      case 'implementation':
        // Mermaid syntax: Interface <|.. ImplementingClass
        // In ArchJSON: source = implementing class, target = interface
        // So we need: target <|.. source
        return `${target} <|.. ${source}`;
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
   * Escape entity ID for Mermaid - Enhanced to remove generic parameters
   */
  private escapeId(id: string): string {
    if (!id) return 'Unknown';

    let escaped = id;

    // Remove generic parameters from class/interface names
    // CacheEntry<T> -> CacheEntry
    // Map<K, V> -> Map
    escaped = escaped.replace(/<[^>]*>$/g, '');

    // Replace remaining special characters with underscores
    // Mermaid doesn't support quoted identifiers in all contexts
    return escaped.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Sanitize type string - Enhanced version to handle complex types
   */
  private sanitizeType(type: string): string {
    if (!type) return 'any';

    // Normalize import() paths first - extract actual class names
    // This handles import("path").ClassName -> ClassName
    type = this.normalizeTypeName(type);

    let simplified = type;

    // 1. Remove inline object types FIRST (before any other processing)
    // Use iterative approach to handle nested objects correctly
    // Example: { a: { b: number } } -> { a: object } -> object
    let prevLength: number;
    do {
      prevLength = simplified.length;
      simplified = simplified.replace(/\{[^{}]*\}/g, 'object');
    } while (simplified.length !== prevLength && simplified.includes('{'));

    // 2. Handle TypeScript advanced types
    // Partial<T>, Required<T>, Readonly<T>, Pick<T, K>, Omit<T, K>, etc.
    const advancedTypePattern =
      /^(Partial|Required|Readonly|Pick|Omit|Record|Exclude|Extract|ReturnType|Parameters|DeepPartial)<.+>$/;
    if (advancedTypePattern.test(simplified)) {
      return 'any';
    }

    // 3. Remove function types: (args) => ReturnType
    simplified = simplified.replace(/\([^)]*\)\s*=>\s*/g, 'Function');

    // 4. Handle Promise types - convert Promise<T> to Promise~T~
    simplified = simplified.replace(/Promise<(.+?)>/g, (match, innerType) => {
      const sanitizedInner = this.simplifyGenericType(innerType);
      return `Promise~${sanitizedInner}~`;
    });

    // 5. Remove union types (A | B | C) -> any
    if (simplified.includes('|')) {
      return 'any';
    }

    // 6. Remove intersection types (A & B & C) -> object
    if (simplified.includes('&')) {
      return 'object';
    }

    // 7. Handle array types - must do this before generics
    // Array<Array<T>> -> Array, Array<T> -> Array, T[] -> Array
    // Use a loop to handle nested arrays
    let prevLength2: number;
    do {
      prevLength2 = simplified.length;
      simplified = simplified.replace(/Array<[^>]+>/g, 'Array');
    } while (simplified.length !== prevLength2); // Keep looping until no more changes
    simplified = simplified.replace(/\w+\[\]/g, 'Array'); // T[] -> Array
    simplified = simplified.replace(/Array+/g, 'Array'); // Collapse ArrayArray -> Array

    // 8. Handle generic types - convert to tilde notation
    // Map<K, V> -> Map~KV~
    // For nested generics, flatten them completely
    while (simplified.includes('<')) {
      const match = simplified.match(/<([^>]+)>/);
      if (!match) break;

      const content = match[1];
      const flattened = content
        .replace(/\s*,\s*/g, '')
        .replace(/\s+/g, '')
        .replace(/<[^>]+>/g, '');
      simplified = simplified.replace(/<[^>]+>/, `~${flattened}`);
    }

    // 9. Normalize whitespace
    simplified = simplified.replace(/\s+/g, ' ').trim();

    // 10. If still too complex or empty, return 'any'
    if (simplified.length > 50 || simplified === '') {
      return 'any';
    }

    return simplified;
  }

  /**
   * Simplify generic type content (for Promise<...>)
   */
  private simplifyGenericType(type: string): string {
    // Remove spaces
    let simplified = type.replace(/\s+/g, '');
    // Remove commas
    simplified = simplified.replace(/,/g, '');
    // If still too long, truncate
    if (simplified.length > 20) {
      return simplified.substring(0, 20);
    }
    return simplified;
  }

  /**
   * Normalize type names by extracting actual class names from import paths
   * Handles both import("path").ClassName and import___path___ClassName formats
   */
  private normalizeTypeName(type: string): string {
    // Handle import() function format: import("path").ClassName
    // This can appear in Promise<import("path").ClassName> or as standalone type
    const importPattern = /import\([^)]+\)\.\s*([\w.]+)/g;
    type = type.replace(importPattern, '$1');

    // Handle import___ format (ts-morph fully qualified names)
    const importPathPattern = /import___[^_]+___([\w]+)/g;
    type = type.replace(importPathPattern, '$1');

    return type;
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
