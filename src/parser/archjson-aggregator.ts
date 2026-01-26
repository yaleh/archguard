/**
 * ArchJSON Aggregator - Three-level detail aggregator (v2.0 core component)
 *
 * Aggregates ArchJSON to different detail levels:
 * - package: High-level overview (packages only)
 * - class: Default level (classes with public members)
 * - method: Full detail (all members including private)
 *
 * @module parser/archjson-aggregator
 * @version 2.0.0
 */

import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type { DetailLevel } from '@/types/config.js';

/**
 * Aggregates ArchJSON to different detail levels
 *
 * This is the core innovation of v2.0 - allowing users to control
 * the level of detail in generated diagrams.
 */
export class ArchJSONAggregator {
  /**
   * Aggregate ArchJSON to specified detail level
   *
   * @param archJSON - The full ArchJSON to aggregate
   * @param level - Target detail level
   * @returns Aggregated ArchJSON
   */
  aggregate(archJSON: ArchJSON, level: DetailLevel): ArchJSON {
    switch (level) {
      case 'method':
        // Return original - no filtering needed
        return archJSON;

      case 'class':
        return this.aggregateToClassLevel(archJSON);

      case 'package':
        return this.aggregateToPackageLevel(archJSON);

      default:
        throw new Error(`Unknown detail level: ${level}`);
    }
  }

  /**
   * Aggregate to class level - keep only public members
   *
   * @param archJSON - Full ArchJSON
   * @returns ArchJSON with only public members
   */
  private aggregateToClassLevel(archJSON: ArchJSON): ArchJSON {
    return {
      ...archJSON,
      entities: archJSON.entities.map((entity) => ({
        ...entity,
        members: entity.members.filter(
          (member) => member.visibility === 'public' || member.visibility === undefined
        ),
      })),
    };
  }

  /**
   * Aggregate to package level - show only packages
   *
   * @param archJSON - Full ArchJSON
   * @returns ArchJSON with package-level entities and relations
   */
  private aggregateToPackageLevel(archJSON: ArchJSON): ArchJSON {
    const packages = this.extractPackages(archJSON.entities);
    const packageRelations = this.analyzePackageDependencies(archJSON.entities, archJSON.relations);

    // Create package entities
    const packageEntities: Entity[] = packages.map((pkg) => {
      const firstEntityInPackage = archJSON.entities.find(
        (e) => this.extractPackageFromFile(e.sourceLocation.file) === pkg
      );

      return {
        id: pkg,
        name: pkg,
        type: 'package' as any, // Type assertion needed as 'package' is not in EntityType
        visibility: 'public' as const,
        members: [],
        sourceLocation: firstEntityInPackage
          ? firstEntityInPackage.sourceLocation
          : { file: '', startLine: 0, endLine: 0 },
      };
    });

    return {
      ...archJSON,
      entities: packageEntities,
      relations: packageRelations,
    };
  }

  /**
   * Extract unique package names from entities
   *
   * Package name is extracted from the file path's directory after '/src/'.
   * Example: "/path/to/src/parser/file.ts" -> "parser"
   * Example: "/path/to/src/cli/commands/analyze.ts" -> "cli"
   *
   * @param entities - Array of entities
   * @returns Array of unique package names
   */
  private extractPackages(entities: Entity[]): string[] {
    const packages = new Set<string>();

    for (const entity of entities) {
      const packageName = this.extractPackageFromFile(entity.sourceLocation.file);
      packages.add(packageName);
    }

    return Array.from(packages).filter((pkg) => pkg !== '').sort();
  }

  /**
   * Extract package name from file path
   *
   * Supports both absolute and relative paths:
   * - Absolute: "/path/to/src/parser/file.ts" -> "parser"
   * - Relative with src: "src/parser/file.ts" -> "parser"
   * - Relative without src: "parser/file.ts" -> "parser"
   *
   * @param filePath - File path to extract package from
   * @returns Package name or empty string if not found
   */
  private extractPackageFromFile(filePath: string): string {
    // Normalize path separators to forward slashes
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Try to find '/src/' or 'src/' at the beginning
    let afterSrc: string;
    const srcIndex = normalizedPath.indexOf('/src/');
    if (srcIndex !== -1) {
      // Found '/src/' - extract everything after it
      afterSrc = normalizedPath.substring(srcIndex + 5); // 5 = length of '/src/'
    } else if (normalizedPath.startsWith('src/')) {
      // Path starts with 'src/' - extract everything after 'src/'
      afterSrc = normalizedPath.substring(4); // 4 = length of 'src/'
    } else {
      // No 'src/' prefix - use the whole path (for relative paths like 'parser/file.ts')
      afterSrc = normalizedPath;
    }

    // Find the first slash to get the first directory
    const firstSlashIndex = afterSrc.indexOf('/');
    if (firstSlashIndex === -1) {
      // No subdirectory - file is directly in the directory
      return '';
    }

    return afterSrc.substring(0, firstSlashIndex);
  }

  /**
   * Analyze package-level dependencies from class-level relations
   *
   * Maps class relations to package relations and deduplicates them.
   * Filters out self-relations within the same package.
   *
   * @param entities - Array of entities
   * @param relations - Array of class-level relations
   * @returns Array of package-level relations
   */
  private analyzePackageDependencies(entities: Entity[], relations: Relation[]): Relation[] {
    // Create entity ID to package mapping (using file paths)
    const entityToPackage = new Map<string, string>();
    for (const entity of entities) {
      const packageName = this.extractPackageFromFile(entity.sourceLocation.file);
      entityToPackage.set(entity.id, packageName);
    }

    // Map class relations to package relations
    const packageRelationsMap = new Map<string, Relation>();

    for (const relation of relations) {
      const sourcePackage = entityToPackage.get(relation.source);
      const targetPackage = entityToPackage.get(relation.target);

      // Skip if packages are unknown, empty, or same
      if (
        sourcePackage === undefined ||
        targetPackage === undefined ||
        sourcePackage === '' ||
        targetPackage === '' ||
        sourcePackage === targetPackage
      ) {
        continue;
      }

      // Create unique key for deduplication
      const key = `${sourcePackage}:${targetPackage}:${relation.type}`;

      if (!packageRelationsMap.has(key)) {
        packageRelationsMap.set(key, {
          id: `pkg-${sourcePackage}-${targetPackage}`,
          type: relation.type,
          source: sourcePackage,
          target: targetPackage,
        });
      }
    }

    return Array.from(packageRelationsMap.values());
  }
}
