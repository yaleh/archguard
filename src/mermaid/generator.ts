/**
 * ValidatedMermaidGenerator - Generates Mermaid diagram code from ArchJSON
 * Ensures valid Mermaid syntax and proper structure
 *
 * v2.1.0: Integrated CommentGenerator for self-documenting diagrams
 */

import path from 'path';
import type { ArchJSON } from '../types/index.js';
import type { DiagramConfig } from '../types/config.js';
import { globalEntityTypeRegistry, EntityTypeRegistry } from '@/core/entity-type-registry.js';
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
import {
  ENTITY_CLASSDEF_STYLES,
  sanitizeType as _sanitizeType,
  normalizeEntityName,
  escapeId,
  shouldIncludeMember as _shouldIncludeMember,
  generateMemberLine as _generateMemberLine,
  generateRelationLine as _generateRelationLine,
  isNoisyTarget,
  generateClassDefinition as _generateClassDefinition,
} from './generator-formatting.js';

// ENTITY_CLASSDEF_STYLES imported from generator-formatting.ts

function entityTypeToClassDef(
  type: string,
  registry: EntityTypeRegistry = globalEntityTypeRegistry
): string {
  if (type === 'class') return 'classNode';
  if (type in ENTITY_CLASSDEF_STYLES) return type;
  const custom = registry.get(type);
  if (custom?.mermaidShape && custom.mermaidShape !== 'default') {
    return custom.mermaidShape === 'component' ? 'interface' : 'classNode';
  }
  return 'classNode'; // unknown type: plain box, never throws
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

    const diagramLines = diagramCode.split('\n');
    const header = diagramLines.shift() || 'classDiagram';
    const lines: string[] = [header];

    if (this.diagramConfig && this.diagramConfig.annotations?.enableComments !== false) {
      const comments = this.commentGenerator.generateAll(this.diagramConfig);
      if (comments) {
        lines.push(comments);
        lines.push('');
      }
    }

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
          const insertIndex = lines.findIndex((line) => !line.startsWith('%%') && line !== header);
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
    if (this.getArchitecturalLayers()) {
      return this.generateLayeredPackageLevel();
    }

    const lines: string[] = ['classDiagram'];

    // Group entities by packages
    const packageGroups = groupEntitiesByPackage(this.archJson, this.options.grouping);

    for (const group of packageGroups) {
      const entityLines: string[] = [];
      for (const entityId of group.entities) {
        const entity = this.archJson.entities.find((e) => e.id === entityId);
        if (entity) {
          entityLines.push(`    class ${escapeId(normalizeEntityName(entity.name))}`);
        }
      }
      // Skip empty namespaces — Mermaid classDiagram does not allow empty namespace blocks
      if (entityLines.length === 0) continue;
      lines.push(`  namespace ${escapeId(group.name)} {`);
      lines.push(...entityLines);
      lines.push('  }');
    }

    // Add relationships
    lines.push(...this.generateRelations(packageGroups));

    return lines.join('\n');
  }

  private getArchitecturalLayers(): Record<string, string> | undefined {
    const layers = this.archJson.extensions?.projectSemantics?.architecturalLayers;
    return layers && Object.keys(layers).length > 0 ? layers : undefined;
  }

  private normalizePackagePath(filePath: string): string {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const workspaceRoot = this.archJson.workspaceRoot?.replace(/\\/g, '/');
    if (workspaceRoot && path.isAbsolute(filePath)) {
      return path.posix.dirname(path.posix.relative(workspaceRoot, normalizedFile));
    }
    return path.posix.dirname(normalizedFile);
  }

  private findMatchingLayer(
    packageName: string,
    layers: Record<string, string>
  ): { key: string; label: string } | null {
    const normalizedPackage = packageName.replace(/\\/g, '/');
    const candidates = Object.entries(layers)
      .map(([key, label]) => ({ key: key.replace(/\\/g, '/'), label }))
      .filter(({ key }) => normalizedPackage === key || normalizedPackage.startsWith(`${key}/`))
      .sort((left, right) => right.key.length - left.key.length);

    return candidates[0] ?? null;
  }

  private generateLayeredPackageLevel(): string {
    const architecturalLayers = this.getArchitecturalLayers();
    if (!architecturalLayers) {
      return this.generatePackageLevel();
    }

    const direction = this.options.grouping.layout?.direction ?? 'TB';
    const lines: string[] = [`flowchart ${direction}`];
    const entityPackageIndex = new Map<string, string>();
    const packageNames: string[] = [];
    const seenPackages = new Set<string>();

    for (const entity of this.archJson.entities) {
      const sourceFile = entity.sourceLocation?.file;
      if (!sourceFile) continue;
      const packageName = this.normalizePackagePath(sourceFile);
      if (!packageName || packageName === '.') continue;
      entityPackageIndex.set(entity.id, packageName);
      entityPackageIndex.set(entity.name, packageName);
      if (!seenPackages.has(packageName)) {
        seenPackages.add(packageName);
        packageNames.push(packageName);
      }
    }

    const groupedPackages = new Map<string, string[]>();
    const unmatchedPackages: string[] = [];
    for (const packageName of packageNames) {
      const layerMatch = this.findMatchingLayer(packageName, architecturalLayers);
      if (!layerMatch) {
        unmatchedPackages.push(packageName);
        continue;
      }
      if (!groupedPackages.has(layerMatch.label)) {
        groupedPackages.set(layerMatch.label, []);
      }
      groupedPackages.get(layerMatch.label)?.push(packageName);
    }

    const nodeIdForPackage = (packageName: string) => escapeId(`pkg_${packageName}`);
    for (const [label, layerPackages] of groupedPackages.entries()) {
      if (layerPackages.length === 0) continue;
      lines.push(`  subgraph ${escapeId(`layer_${label}`)}["${label}"]`);
      for (const packageName of layerPackages) {
        lines.push(`    ${nodeIdForPackage(packageName)}["${packageName}"]`);
      }
      lines.push('  end');
    }

    for (const packageName of unmatchedPackages) {
      lines.push(`  ${nodeIdForPackage(packageName)}["${packageName}"]`);
    }

    const relationEdges = new Set<string>();
    for (const relation of this.archJson.relations) {
      const sourcePackage =
        entityPackageIndex.get(relation.source) ??
        entityPackageIndex.get(normalizeEntityName(relation.source));
      const targetPackage =
        entityPackageIndex.get(relation.target) ??
        entityPackageIndex.get(normalizeEntityName(relation.target));

      if (!sourcePackage || !targetPackage || sourcePackage === targetPackage) {
        continue;
      }

      const edge = `  ${nodeIdForPackage(sourcePackage)} --> ${nodeIdForPackage(targetPackage)}`;
      if (!relationEdges.has(edge)) {
        relationEdges.add(edge);
        lines.push(edge);
      }
    }

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

    // Python: module-level source IDs (e.g. `pkg.mod`) map to class-level entity IDs
    const modulePrefixIndex = this.buildModulePrefixIndex(knownEntityIds);

    // If we have grouping, use namespaces
    if (packageGroups.length > 0 && packageGroups[0]?.name !== 'Default') {
      for (const group of packageGroups) {
        const entityLines: string[] = [];
        for (const entityId of group.entities) {
          const entity = visibleEntities.find((e) => e.id === entityId);
          if (entity) {
            entityLines.push(..._generateClassDefinition(entity, 2, this.options));
          }
        }
        // Skip empty namespaces — Mermaid classDiagram does not allow empty namespace blocks
        if (entityLines.length === 0) continue;
        lines.push(`  namespace ${escapeId(group.name)} {`);
        lines.push(...entityLines);
        lines.push('  }');
      }

      // Add relationships: source must be known (by name, scoped ID, or module prefix); unknown targets render as ghost nodes.
      // Noisy targets (inline types, generics, literals) are filtered.
      for (const relation of this.archJson.relations) {
        const sourceKnownDirect =
          knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
        const sourceKnownViaPrefix = !sourceKnownDirect && modulePrefixIndex.has(relation.source);
        const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
        const targetOk =
          knownEntityIds.has(relation.target) ||
          knownEntityNames.has(relation.target) ||
          sourceKnownViaPrefix || // Python module-level: skip noisy check for target too
          !isNoisyTarget(relation.target);
        if (sourceKnown && targetOk) {
          {
            const _line = _generateRelationLine(relation, this.entityIdToName);
            if (_line !== null) lines.push(`  ${_line}`);
          }
        }
      }
    } else {
      // No grouping or default grouping, just list all classes
      for (const entity of visibleEntities) {
        lines.push(..._generateClassDefinition(entity, 1, this.options));
      }

      // Add relationships: source must be known (by name, scoped ID, or module prefix); unknown targets render as ghost nodes.
      // Noisy targets (inline types, generics, literals) are filtered.
      for (const relation of this.archJson.relations) {
        const sourceKnownDirect =
          knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
        const sourceKnownViaPrefix = !sourceKnownDirect && modulePrefixIndex.has(relation.source);
        const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
        const targetOk =
          knownEntityIds.has(relation.target) ||
          knownEntityNames.has(relation.target) ||
          sourceKnownViaPrefix || // Python module-level: skip noisy check for target too
          !isNoisyTarget(relation.target);
        if (sourceKnown && targetOk) {
          {
            const _line = _generateRelationLine(relation, this.entityIdToName);
            if (_line !== null) lines.push(`  ${_line}`);
          }
        }
      }
    }

    // Emit node type annotations (Plan 19)
    // classDiagram uses `class NodeId:::StyleName` (STYLE_SEPARATOR) to apply classDef styles
    lines.push('');
    lines.push('  %% Node type annotations');
    const seenAnnotationsClass = new Set<string>();
    for (const entity of visibleEntities) {
      const normalizedId = escapeId(normalizeEntityName(entity.name));
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
            entityLines.push(..._generateClassDefinition(entity, 2, this.options));
          }
        }
        // Skip empty namespaces — Mermaid classDiagram does not allow empty namespace blocks
        if (entityLines.length === 0) continue;
        lines.push(`  namespace ${escapeId(group.name)} {`);
        lines.push(...entityLines);
        lines.push('  }');
      }
    } else {
      for (const entity of visibleEntities) {
        lines.push(..._generateClassDefinition(entity, 1, this.options));
      }
    }

    // Python: module-level source IDs (e.g. `pkg.mod`) map to class-level entity IDs
    const modulePrefixIndexMethod = this.buildModulePrefixIndex(knownEntityIds);

    // Add relationships: source must be known (by name, scoped ID, or module prefix); unknown targets render as ghost nodes.
    // Noisy targets (inline types, generics, literals) are filtered.
    for (const relation of this.archJson.relations) {
      const sourceKnownDirect =
        knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
      const sourceKnownViaPrefix =
        !sourceKnownDirect && modulePrefixIndexMethod.has(relation.source);
      const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
      // Python module-level: skip noisy check for target when source matched via prefix
      if (sourceKnown && (sourceKnownViaPrefix || !isNoisyTarget(relation.target))) {
        const _line = _generateRelationLine(relation, this.entityIdToName);
        if (_line !== null) lines.push(`  ${_line}`);
      }
    }

    // Emit node type annotations (Plan 19)
    // classDiagram uses `class NodeId:::StyleName` (STYLE_SEPARATOR) to apply classDef styles
    lines.push('');
    lines.push('  %% Node type annotations');
    const seenAnnotationsMethod = new Set<string>();
    for (const entity of visibleEntities) {
      const normalizedId = escapeId(normalizeEntityName(entity.name));
      if (seenAnnotationsMethod.has(normalizedId)) continue;
      seenAnnotationsMethod.add(normalizedId);
      lines.push(`  class ${normalizedId}:::${entityTypeToClassDef(entity.type)}`);
    }

    return lines.join('\n');
  }

  private get entityIdToName(): Map<string, string> {
    if (!this._entityIdToName) {
      this._entityIdToName = new Map(this.archJson.entities.map((e) => [e.id, e.name]));
    }
    return this._entityIdToName;
  }

  /**
   * Build a module-prefix → representative entity ID map for Python-style module-level
   * relation sources.  For each entity ID that contains a dot, the module ID (everything
   * before the last dot) is recorded.  This lets us accept relations whose source is a
   * module-level ID (e.g. `lmdeploy.pytorch.models`) even when entities are registered
   * at class level (e.g. `lmdeploy.pytorch.models.LlamaModel`).
   */
  private buildModulePrefixIndex(entityIds: Set<string>): Map<string, string> {
    const index = new Map<string, string>();
    for (const entityId of entityIds) {
      const lastDot = entityId.lastIndexOf('.');
      if (lastDot > 0) {
        const moduleId = entityId.substring(0, lastDot);
        if (!index.has(moduleId)) {
          index.set(moduleId, entityId);
        }
      }
    }
    return index;
  }

  /**
   * Generate all relations for package level
   */
  private generateRelations(_packageGroups: PackageGroup[]): string[] {
    const lines: string[] = [];
    const knownEntityNames = new Set(this.archJson.entities.map((e) => e.name));
    const knownEntityIds = new Set(this.archJson.entities.map((e) => e.id));
    // Python: module-level source IDs (e.g. `pkg.mod`) map to class-level entity IDs
    const modulePrefixIndex = this.buildModulePrefixIndex(knownEntityIds);

    for (const relation of this.archJson.relations) {
      const sourceKnownDirect =
        knownEntityNames.has(relation.source) || knownEntityIds.has(relation.source);
      const sourceKnownViaPrefix = !sourceKnownDirect && modulePrefixIndex.has(relation.source);
      const sourceKnown = sourceKnownDirect || sourceKnownViaPrefix;
      // When the source matched via module prefix (Python-style), skip the isNoisyTarget check
      // for the target because Python dotted module paths look like TypeScript namespace types.
      if (sourceKnown && (sourceKnownViaPrefix || !isNoisyTarget(relation.target))) {
        const _line = _generateRelationLine(relation, this.entityIdToName);
        if (_line !== null) lines.push(`  ${_line}`);
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
      lines.push(`  namespace ${escapeId(group.name)} {`);
      for (const entity of groupEntities) {
        lines.push(..._generateClassDefinition(entity, 2, this.options));
      }
      lines.push('  }');

      // Python: module-level source IDs (e.g. `pkg.mod`) map to class-level entity IDs
      const modulePrefixIndexGroup = this.buildModulePrefixIndex(knownEntityIds);

      // Emit relations: source must be in this group (or a module prefix of a group entity);
      // target must be a known entity or a non-noisy external ghost node.
      for (const relation of this.archJson.relations) {
        const sourceInGroupDirect =
          groupEntityIdSet.has(relation.source) || groupEntityNames.has(relation.source);
        const sourceViaPrefix = !sourceInGroupDirect && modulePrefixIndexGroup.has(relation.source);
        const sourceInGroup = sourceInGroupDirect || sourceViaPrefix;
        const targetKnown =
          knownEntityIds.has(relation.target) || knownEntityNames.has(relation.target);
        // Python module-level: skip noisy check for target when source matched via prefix
        const targetOk = targetKnown || sourceViaPrefix || !isNoisyTarget(relation.target);
        if (sourceInGroup && targetOk) {
          {
            const _line = _generateRelationLine(relation, this.entityIdToName);
            if (_line !== null) lines.push(`  ${_line}`);
          }
        }
      }

      // Emit node type annotations
      lines.push('');
      lines.push('  %% Node type annotations');
      const seenAnnotations = new Set<string>();
      for (const entity of groupEntities) {
        const normalizedId = escapeId(normalizeEntityName(entity.name));
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
