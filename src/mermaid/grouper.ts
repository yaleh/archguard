/**
 * Grouper implementations for organizing entities into packages
 */

import type { ArchJSON } from '../types/index.js';
import type { GroupingDecision, PackageGroup, LayoutDecision, GrouperConfig } from './types.js';

/**
 * Heuristic Grouper - Groups entities based on file path patterns
 * Uses simple heuristics to determine package structure
 */
export class HeuristicGrouper {
  private readonly config: Required<GrouperConfig>;

  constructor(config?: Partial<GrouperConfig>) {
    this.config = {
      strategy: 'heuristic',
      maxPackages: config?.maxPackages ?? 10,
      maxEntitiesPerPackage: config?.maxEntitiesPerPackage ?? 20,
      customRules: config?.customRules ?? [],
    };
  }

  /**
   * Group entities into packages based on heuristics
   */
  group(archJson: ArchJSON): GroupingDecision {
    if (archJson.entities.length === 0) {
      return {
        packages: [],
        layout: {
          direction: 'TB',
          reasoning: 'Default layout for empty architecture',
        },
      };
    }

    // Apply custom rules first
    const customGrouped = this.applyCustomRules(archJson);
    if (customGrouped) {
      return customGrouped;
    }

    // Group by file path
    const packages = this.groupByPath(archJson);

    // Merge small packages if needed
    const mergedPackages = this.mergeSmallPackages(packages);

    // Apply limits
    const limitedPackages = this.applyLimits(mergedPackages);

    // Generate layout decision
    const layout = this.generateLayoutDecision(limitedPackages);

    return {
      packages: limitedPackages,
      layout,
    };
  }

  /**
   * Apply custom grouping rules
   */
  private applyCustomRules(archJson: ArchJSON): GroupingDecision | null {
    if (this.config.customRules.length === 0) {
      return null;
    }

    const packageMap = new Map<string, string[]>();
    const usedEntityIds = new Set<string>();

    // Apply custom rules in priority order
    const sortedRules = [...this.config.customRules].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );

    for (const rule of sortedRules) {
      for (const entity of archJson.entities) {
        if (usedEntityIds.has(entity.id)) {
          continue;
        }

        if (rule.pattern.test(entity.sourceLocation.file)) {
          if (!packageMap.has(rule.packageName)) {
            packageMap.set(rule.packageName, []);
          }
          packageMap.get(rule.packageName).push(entity.id);
          usedEntityIds.add(entity.id);
        }
      }
    }

    if (packageMap.size === 0) {
      return null;
    }

    const packages: PackageGroup[] = Array.from(packageMap.entries()).map(([name, entities]) => ({
      name,
      entities,
      reasoning: 'Grouped by custom rule',
    }));

    return {
      packages,
      layout: {
        direction: 'TB',
        reasoning: 'Layout based on custom grouping rules',
      },
    };
  }

  /**
   * Group entities by their file paths
   */
  private groupByPath(archJson: ArchJSON): PackageGroup[] {
    const packageMap = new Map<string, string[]>();

    for (const entity of archJson.entities) {
      const packageName = this.extractPackageName(entity.sourceLocation.file);

      if (!packageMap.has(packageName)) {
        packageMap.set(packageName, []);
      }

      packageMap.get(packageName).push(entity.id);
    }

    return Array.from(packageMap.entries()).map(([rawName, entities]) => ({
      name: this.formatPackageName(rawName),
      entities,
      reasoning: `Grouped by path: ${rawName}`,
    }));
  }

  /**
   * Extract package name from file path
   */
  private extractPackageName(filePath: string): string {
    if (!filePath || filePath.trim() === '') {
      return 'core';
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');

    // Find key directory indicators
    const srcIndex = parts.findIndex((p) =>
      ['src', 'lib', 'packages', 'app', 'server', 'client'].includes(p)
    );

    if (srcIndex >= 0) {
      // Check for monorepo structure: packages/<package-name>/...
      if (parts[srcIndex] === 'packages' && srcIndex + 1 < parts.length) {
        const packageName = parts[srcIndex + 1];
        if (packageName) {
          return packageName;
        }
      }

      // Regular structure: src/<directory>/...
      if (srcIndex + 1 < parts.length) {
        const nextPart = parts[srcIndex + 1];

        // Skip common directories that shouldn't be packages
        if (
          nextPart &&
          !['index', 'types', 'interfaces', 'utils', 'helpers', 'common', 'shared'].includes(
            nextPart
          )
        ) {
          return nextPart;
        }
      }
    }

    // If no clear structure, use the parent directory name
    if (parts.length >= 2) {
      const parentDir = parts[parts.length - 2];
      if (parentDir && parentDir !== '.' && parentDir !== '..' && parentDir !== '') {
        return parentDir;
      }
    }

    // Fallback to core
    return 'core';
  }

  /**
   * Format package name for display
   */
  private formatPackageName(dir: string): string {
    // Convert to Title Case
    const formatted = dir
      .split(/[-_]/)
      .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
      .join(' ');

    // Add "Layer" suffix if not already present
    if (!formatted.includes('Layer') && !formatted.includes('Package')) {
      return `${formatted} Layer`;
    }

    return formatted;
  }

  /**
   * Merge small packages to reduce fragmentation
   */
  private mergeSmallPackages(packages: PackageGroup[]): PackageGroup[] {
    const threshold = 2; // Merge packages with <= 2 entities
    const merged: PackageGroup[] = [];
    const skipIndices = new Set<number>();

    for (let i = 0; i < packages.length; i++) {
      if (skipIndices.has(i)) {
        continue;
      }

      const current = packages[i];
      if (!current) continue;

      if (current.entities.length <= threshold && i + 1 < packages.length) {
        // Merge with next package
        const next = packages[i + 1];
        if (next && !skipIndices.has(i + 1)) {
          merged.push({
            name: `${current.name} & ${next.name}`,
            entities: [...current.entities, ...next.entities],
            reasoning: `Merged small packages: ${current.reasoning}, ${next.reasoning}`,
          });
          skipIndices.add(i + 1);
          continue;
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /**
   * Apply configuration limits
   */
  private applyLimits(packages: PackageGroup[]): PackageGroup[] {
    let result = [...packages];

    // Limit by max packages
    if (result.length > this.config.maxPackages) {
      // Keep largest packages
      result = result
        .sort((a, b) => b.entities.length - a.entities.length)
        .slice(0, this.config.maxPackages);
    }

    // Limit entities per package
    if (this.config.maxEntitiesPerPackage < Infinity) {
      result = result.map((pkg) => ({
        ...pkg,
        entities: pkg.entities.slice(0, this.config.maxEntitiesPerPackage),
      }));
    }

    return result;
  }

  /**
   * Generate layout decision
   */
  private generateLayoutDecision(packages: PackageGroup[]): LayoutDecision {
    // Determine layout direction based on package structure
    let direction: LayoutDecision['direction'] = 'TB';

    if (packages.length <= 2) {
      direction = 'LR'; // Left-to-right for simple structures
    } else if (packages.length > 5) {
      direction = 'TB'; // Top-to-bottom for complex structures
    }

    const reasoning = `Layout direction: ${direction} based on ${packages.length} packages`;

    return {
      direction,
      reasoning,
    };
  }
}

/**
 * LLM Grouper - Groups entities using LLM analysis
 */
export class LLMGrouper {
  constructor(private config: any) {}

  /**
   * Group entities using LLM analysis
   */
  async group(archJson: ArchJSON): Promise<GroupingDecision> {
    return this.groupWithFallback(archJson);
  }

  /**
   * Get grouping decision from LLM
   */
  async getLLMGrouping(archJson: ArchJSON, level: string): Promise<GroupingDecision> {
    const { PromptManager } = await import('./llm/prompt-manager.js');
    const { ClaudeClient } = await import('./llm/claude-client.js');

    const templateManager = new PromptManager();
    const wrapper = new ClaudeClient(this.config);

    // Build entity list
    const entitiesList = archJson.entities
      .map((e) => `- ${e.id}: ${e.name} (${e.type}) in ${e.sourceLocation.file}`)
      .join('\n');

    // Build summary
    const summary = {
      entityCount: archJson.entities.length,
      relationCount: archJson.relations.length,
    };

    // Render prompt
    const prompt = await templateManager.render('mermaid-grouping', {
      ENTITY_COUNT: String(summary.entityCount),
      RELATION_COUNT: String(summary.relationCount),
      ENTITIES_LIST: entitiesList,
      DETAIL_LEVEL: level,
    });

    // Call LLM
    const response = await wrapper.callCLI(prompt);

    // Extract JSON from response
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(jsonStr);
      return {
        packages: parsed.packages,
        layout: parsed.layout,
      };
    } catch (error) {
      throw new Error('Failed to extract JSON from LLM response');
    }
  }

  /**
   * Group with fallback to heuristic if LLM fails
   */
  async groupWithFallback(archJson: ArchJSON): Promise<GroupingDecision> {
    try {
      return await this.getLLMGrouping(archJson, 'class');
    } catch (error) {
      console.warn('⚠️  LLM grouping failed, falling back to heuristic:', (error as Error).message);
      const heuristicGrouper = new HeuristicGrouper();
      return heuristicGrouper.group(archJson);
    }
  }
}
