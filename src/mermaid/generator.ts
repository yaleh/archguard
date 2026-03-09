/**
 * ValidatedMermaidGenerator - Generates Mermaid diagram code from ArchJSON
 * Ensures valid Mermaid syntax and proper structure
 *
 * v2.1.0: Integrated CommentGenerator for self-documenting diagrams
 */

import type { ArchJSON, Entity, EntityType, Member, Relation } from '../types/index.js';
import type { DiagramConfig } from '../types/config.js';
import type {
  MermaidDetailLevel,
  GroupingDecision,
  PackageGroup,
  MermaidGeneratorOptions,
  MermaidTheme,
} from './types.js';
import { CommentGenerator } from './comment-generator.js';
import { groupEntitiesByPackage } from './generator-grouping.js';
import { validateGeneratorInput } from './generator-validation.js';

// ── Semantic classDef styles for TypeScript class diagrams (Plan 19) ─────────
// Maps classDef identifier → Mermaid style string.
// EntityType 'class' maps to 'classNode' to avoid ambiguity with Mermaid's
// 'class' keyword in classDiagram syntax.
const ENTITY_CLASSDEF_STYLES: Record<string, string> = {
  classNode: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  interface: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  enum: 'fill:#fff8c5,stroke:#d4a72c,color:#633c01',
  struct: 'fill:#f6f8fa,stroke:#d0d7de,color:#24292f',
  trait: 'fill:#ddf4ff,stroke:#54aeff,color:#0969da',
  abstract_class: 'fill:#fdf4ff,stroke:#d2a8ff,color:#8250df',
  function: 'fill:#f6f8fa,stroke:#d0d7de,color:#57606a',
};

function entityTypeToClassDef(type: EntityType): string {
  return type === 'class' ? 'classNode' : type;
}

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
  private _entityIdToName: Map<string, string> | null = null;

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
    validateGeneratorInput(this.archJson, this.verbose);

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
          const insertIndex = lines.findIndex(
            (line) => !line.startsWith('%%') && line !== 'classDiagram'
          );
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
   * Generate package-level diagram
   */
  private generatePackageLevel(): string {
    const lines: string[] = ['classDiagram'];

    // Group entities by packages
    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);

    for (const group of packageGroups) {
      const entityLines: string[] = [];
      for (const entityId of group.entities) {
        const entity = this.archJson.entities.find((e) => e.id === entityId);
        if (entity) {
          entityLines.push(`    class ${this.escapeId(this.normalizeEntityName(entity.name))}`);
        }
      }
      // Skip empty namespaces — Mermaid classDiagram does not allow empty namespace blocks
      if (entityLines.length === 0) continue;
      lines.push(`  namespace ${this.escapeId(group.name)} {`);
      lines.push(...entityLines);
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

    // Emit semantic classDef block (Plan 19)
    for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
      lines.push(`  classDef ${name} ${style}`);
    }
    lines.push('');

    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);
    // Filter out standalone free functions — they appear as empty class nodes in diagrams
    const visibleEntities = this.archJson.entities.filter((e) => e.type !== 'function');
    const knownEntityNames = new Set(visibleEntities.map((e) => e.name));
    const knownEntityIds = new Set(visibleEntities.map((e) => e.id));

    // If we have grouping, use namespaces
    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        const entityLines: string[] = [];
        for (const entityId of group.entities) {
          const entity = visibleEntities.find((e) => e.id === entityId);
          if (entity) {
            entityLines.push(...this.generateClassDefinition(entity, 2, true));
          }
        }
        // Skip empty namespaces — Mermaid classDiagram does not allow empty namespace blocks
        if (entityLines.length === 0) continue;
        lines.push(`  namespace ${this.escapeId(group.name)} {`);
        lines.push(...entityLines);
        lines.push('  }');
      }

      // Add relationships: source must be known (by name or scoped ID); unknown targets render as ghost nodes.
      // Noisy targets (inline types, generics, literals) are filtered.
      for (const relation of this.archJson.relations) {
        if (
          (knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source)) &&
          (knownEntityIds.has(relation.target) ||
            knownEntityNames.has(relation.target) ||
            !this.isNoisyTarget(relation.target))
        ) {
          lines.push(`  ${this.generateRelationLine(relation)}`);
        }
      }
    } else {
      // No grouping or default grouping, just list all classes
      for (const entity of visibleEntities) {
        lines.push(...this.generateClassDefinition(entity, 1, true));
      }

      // Add relationships: source must be known (by name or scoped ID); unknown targets render as ghost nodes.
      // Noisy targets (inline types, generics, literals) are filtered.
      for (const relation of this.archJson.relations) {
        if (
          (knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source)) &&
          (knownEntityIds.has(relation.target) ||
            knownEntityNames.has(relation.target) ||
            !this.isNoisyTarget(relation.target))
        ) {
          lines.push(`  ${this.generateRelationLine(relation)}`);
        }
      }
    }

    // Emit node type annotations (Plan 19)
    // classDiagram uses `class NodeId:::StyleName` (STYLE_SEPARATOR) to apply classDef styles
    lines.push('');
    lines.push('  %% Node type annotations');
    const seenAnnotationsClass = new Set<string>();
    for (const entity of visibleEntities) {
      const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
      if (seenAnnotationsClass.has(normalizedId)) continue;
      seenAnnotationsClass.add(normalizedId);
      lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate method-level diagram (detailed)
   */
  private generateMethodLevel(): string {
    const lines: string[] = ['classDiagram'];

    // Emit semantic classDef block (Plan 19)
    for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
      lines.push(`  classDef ${name} ${style}`);
    }
    lines.push('');

    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);
    // Filter out standalone free functions — they appear as empty class nodes in diagrams
    const visibleEntities = this.archJson.entities.filter((e) => e.type !== 'function');
    const knownEntityNames = new Set(visibleEntities.map((e) => e.name));
    const knownEntityIds = new Set(visibleEntities.map((e) => e.id));

    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        const entityLines: string[] = [];
        for (const entityId of group.entities) {
          const entity = visibleEntities.find((e) => e.id === entityId);
          if (entity) {
            entityLines.push(...this.generateClassDefinition(entity, 2, true));
          }
        }
        // Skip empty namespaces — Mermaid classDiagram does not allow empty namespace blocks
        if (entityLines.length === 0) continue;
        lines.push(`  namespace ${this.escapeId(group.name)} {`);
        lines.push(...entityLines);
        lines.push('  }');
      }
    } else {
      for (const entity of visibleEntities) {
        lines.push(...this.generateClassDefinition(entity, 1, true));
      }
    }

    // Add relationships: source must be known (by name or scoped ID); unknown targets render as ghost nodes.
    // Noisy targets (inline types, generics, literals) are filtered.
    for (const relation of this.archJson.relations) {
      if (
        (knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source)) &&
        !this.isNoisyTarget(relation.target)
      ) {
        lines.push(`  ${this.generateRelationLine(relation)}`);
      }
    }

    // Emit node type annotations (Plan 19)
    // classDiagram uses `class NodeId:::StyleName` (STYLE_SEPARATOR) to apply classDef styles
    lines.push('');
    lines.push('  %% Node type annotations');
    const seenAnnotationsMethod = new Set<string>();
    for (const entity of visibleEntities) {
      const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
      if (seenAnnotationsMethod.has(normalizedId)) continue;
      seenAnnotationsMethod.add(normalizedId);
      lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
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
    // Mermaid classDiagram only supports 'class' keyword; map all entity types accordingly
    const classType = 'class'; // Mermaid classDiagram only uses the 'class' keyword
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
   * v2.2.1: Fixed static/abstract modifiers to use Mermaid-compatible syntax
   */
  private generateMemberLine(member: Member, detailed: boolean): string {
    const visibility = this.getVisibilitySymbol(member.visibility);
    // Mermaid syntax: 'static' not '{static}', 'abstract' not '{abstract}'
    const staticModifier = member.isStatic ? 'static ' : '';
    const abstractModifier = member.isAbstract ? 'abstract ' : '';

    if (member.type === 'property') {
      const readonly = member.isReadonly ? 'readonly ' : '';
      const optional = member.isOptional ? '?' : '';
      const type = member.fieldType ? `: ${this.sanitizeType(member.fieldType)}` : '';
      return `${visibility}${staticModifier}${abstractModifier}${readonly}${member.name}${optional}${type}`;
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
   * Handles import___ path format and import() function format from ts-morph,
   * and scoped entity IDs produced by TypeScriptParser.parseProject().
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

    // ✅ Handle scoped entity IDs produced by TypeScriptParser.parseProject()
    // Format: "src/mermaid/auto-repair.ts.MermaidAutoRepair"
    // These are generated when parseTsProject() is used (e.g. when a package-level
    // diagram shares the same source group with class/method diagrams).
    const scopedMatch = name.match(/(?:\.ts|\.js)\.([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (scopedMatch) {
      return scopedMatch[1];
    }

    // Handle complex type objects
    if (name.startsWith('{') || name.includes('=>')) {
      return '[Type]';
    }

    return name;
  }

  private get entityIdToName(): Map<string, string> {
    if (!this._entityIdToName) {
      this._entityIdToName = new Map(this.archJson.entities.map((e) => [e.id, e.name]));
    }
    return this._entityIdToName;
  }

  /**
   * Generate relation line
   */
  private generateRelationLine(relation: Relation): string {
    const resolve = (id: string): string => {
      const simpleName = this.entityIdToName.get(id);
      return this.escapeId(this.normalizeEntityName(simpleName ?? id));
    };
    const source = resolve(relation.source);
    const target = resolve(relation.target);

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
   * Returns true for relation targets that are too noisy/complex to render.
   * These are inline types, string/numeric literals, arrow functions, single-letter generics,
   * and namespace-qualified utility types (e.g. z.infer).
   * Cross-module types (unknown entities) are allowed and rendered as Mermaid ghost nodes.
   */
  private isNoisyTarget(target: string): boolean {
    return (
      target.startsWith('{') || // inline object: { host: string }
      target.startsWith('"') || // string literal: "200"
      target.startsWith("'") || // string literal: '200'
      target.startsWith('(') || // function type: (a: A) => B
      target.includes('=>') || // arrow function type
      /^\d/.test(target) || // numeric literal: 100, 200
      /^[A-Z]$/.test(target) || // single-letter generic: T, K, V
      /^[a-z]\w*\./.test(target) // namespace-qualified utility type: z.infer, zod.any
    );
  }

  /**
   * Generate all relations for package level
   */
  private generateRelations(_packageGroups: PackageGroup[]): string[] {
    const lines: string[] = [];
    const knownEntityNames = new Set(this.archJson.entities.map((e) => e.name));
    const knownEntityIds = new Set(this.archJson.entities.map((e) => e.id));

    for (const relation of this.archJson.relations) {
      if (
        (knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source)) &&
        !this.isNoisyTarget(relation.target)
      ) {
        lines.push(`  ${this.generateRelationLine(relation)}`);
      }
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
   *
   * v2.2.1: Fixed nested generics to avoid Mermaid parsing errors
   * Now simplifies Promise<Array<T>> -> Promise instead of Promise~Array~T~
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

    // 4. Handle Promise types - Use loop to remove nested generics from innermost to outermost
    // Promise<Array<T>> -> Promise<Array> -> Promise -> any
    // Promise<z.infer<typeof config>> -> Promise<z.infer> -> Promise -> any
    while (simplified.includes('Promise<')) {
      // Remove the innermost generic (e.g., Array<T> -> Array)
      simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
      // If we just removed a Promise<...>, replace Promise with any
      simplified = simplified.replace(/\bPromise\b/g, 'any');
    }

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

    // 8. Handle remaining generic types - Remove all generics from innermost to outermost
    // Map<K, V>, Set<T>, z.infer<...> -> Map, Set, z.infer -> Map, Set, any (if z.infer)
    while (simplified.match(/\w+</)) {
      simplified = simplified.replace(/(\w+)<([^<>]*)>/g, '$1');
    }
    // Special case: z.infer -> any (it's a Zod utility type that's too complex)
    simplified = simplified.replace(/\bz\.infer\b/g, 'any');

    // 9. Normalize whitespace
    simplified = simplified.replace(/\s+/g, ' ').trim();

    // 10. If still too complex or empty, return 'any'
    if (simplified.length > 50 || simplified === '') {
      return 'any';
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
   * Generate one or more class diagrams, splitting by package group when the total
   * number of visible entities exceeds maxNodesPerDiagram.
   *
   * Return semantics:
   *   [{ name: null, content }]        → not split; caller uses original diagram name
   *   [{ name: 'groupA', content }, …] → split; caller appends group name to path
   */
  public generateClassDiagrams(
    maxNodesPerDiagram: number
  ): Array<{ name: string | null; content: string }> {
    const visibleEntities = this.archJson.entities.filter((e) => e.type !== 'function');
    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);

    // Only keep groups that have at least one visible entity
    const visibleEntityIdSet = new Set(visibleEntities.map((e) => e.id));
    const visibleGroups = packageGroups.filter((g) =>
      g.entities.some((id) => visibleEntityIdSet.has(id))
    );

    const totalNodes = visibleEntities.length;

    // Determine if we should split:
    // - not split if at or below limit
    // - not split if 0 or 1 visible groups
    // - not split if the only group is 'Default'
    const shouldSplit =
      totalNodes > maxNodesPerDiagram &&
      visibleGroups.length > 1 &&
      !(visibleGroups.length === 1 && visibleGroups[0].name === 'Default');

    if (!shouldSplit) {
      return [{ name: null, content: this.generate() }];
    }

    // Split: build one diagram per visible group
    const knownEntityIds = new Set(visibleEntities.map((e) => e.id));
    const knownEntityNames = new Set(visibleEntities.map((e) => e.name));

    const results: Array<{ name: string | null; content: string }> = [];

    for (const group of visibleGroups) {
      const groupEntityIdSet = new Set(group.entities);
      const groupEntities = visibleEntities.filter((e) => groupEntityIdSet.has(e.id));

      if (groupEntities.length === 0) continue;

      const groupEntityNames = new Set(groupEntities.map((e) => e.name));

      const lines: string[] = ['classDiagram'];

      // Emit semantic classDef block
      for (const [name, style] of Object.entries(ENTITY_CLASSDEF_STYLES)) {
        lines.push(`  classDef ${name} ${style}`);
      }
      lines.push('');

      // Emit namespace block for this group
      lines.push(`  namespace ${this.escapeId(group.name)} {`);
      for (const entity of groupEntities) {
        lines.push(...this.generateClassDefinition(entity, 2, true));
      }
      lines.push('  }');

      // Emit relations: source must be in this group; target must be a known entity
      for (const relation of this.archJson.relations) {
        const sourceInGroup =
          groupEntityIdSet.has(relation.source) || groupEntityNames.has(relation.source);
        const targetKnown =
          knownEntityIds.has(relation.target) || knownEntityNames.has(relation.target);
        if (sourceInGroup && (targetKnown || !this.isNoisyTarget(relation.target))) {
          lines.push(`  ${this.generateRelationLine(relation)}`);
        }
      }

      // Emit node type annotations
      lines.push('');
      lines.push('  %% Node type annotations');
      const seenAnnotations = new Set<string>();
      for (const entity of groupEntities) {
        const normalizedId = this.escapeId(this.normalizeEntityName(entity.name));
        if (seenAnnotations.has(normalizedId)) continue;
        seenAnnotations.add(normalizedId);
        lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
      }

      results.push({ name: group.name, content: this.postProcess(lines.join('\n')) });
    }

    return results;
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
