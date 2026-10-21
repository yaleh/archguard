/**
 * Grouper implementations for organizing entities into packages
 */

import path from 'path';
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
      // Default: never silently drop groups. maxPackages remains an explicit
      // opt-in cap (applyLimits keeps the largest groups when set), but an
      // unbounded directory grouping must not lose classes that fall outside
      // the first N directories.
      maxPackages: config?.maxPackages ?? Infinity,
      maxEntitiesPerPackage: config?.maxEntitiesPerPackage ?? Infinity,
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
   * Group entities by their file paths.
   *
   * Class-level entities are grouped by their full project-relative directory
   * path (at least two segments where available), so the directory hierarchy is
   * preserved instead of being collapsed to a single top-level layer name.
   * Path-based package entities (e.g. C++ `src/models`) keep their existing
   * top-level grouping, and Java entities keep their Maven-module grouping.
   */
  private groupByPath(archJson: ArchJSON): PackageGroup[] {
    interface GroupAccumulator {
      name: string;
      entities: string[];
      reasoning: string;
      path?: string[];
    }

    const groups = new Map<string, GroupAccumulator>();

    const addToGroup = (
      key: string,
      name: string,
      entityId: string,
      reasoning: string,
      path?: string[]
    ): void => {
      const existing = groups.get(key);
      if (existing) {
        existing.entities.push(entityId);
        return;
      }
      groups.set(key, {
        name,
        entities: [entityId],
        reasoning,
        ...(path && path.length > 0 ? { path } : {}),
      });
    };

    for (const entity of archJson.entities) {
      // For path-based package names (e.g. "src", "src/models", "examples/batched"),
      // group by the top-level path component using the entity name directly.
      // Package entities from the aggregator always carry their canonical path as name.
      // 'package' is a valid EntityType (open union) — no cast needed.
      const isPathBased = entity.type === 'package' || entity.name.includes('/');
      if (isPathBased) {
        const topLevel = entity.name.split('/')[0];
        addToGroup(
          `path:${topLevel}`,
          this.formatPackageName(topLevel),
          entity.id,
          `Grouped by path: ${topLevel}/`
        );
        continue;
      }

      const javaModuleName =
        archJson.language === 'java'
          ? this.extractJavaMavenModuleName(entity.sourceLocation.file)
          : null;
      if (javaModuleName) {
        addToGroup(
          `maven:${javaModuleName}`,
          this.formatPackageName(javaModuleName),
          entity.id,
          `Grouped by Maven module: ${javaModuleName}`
        );
        continue;
      }

      // Directory-aware grouping: keep the full directory path so two classes
      // in sibling sub-directories can never collapse into one flat layer.
      const directoryPath = this.extractDirectorySegments(
        entity.sourceLocation.file,
        archJson.workspaceRoot
      );
      if (directoryPath.length > 0) {
        const key = `dir:${directoryPath.join('/')}`;
        addToGroup(
          key,
          this.formatDirectoryName(directoryPath),
          entity.id,
          `Grouped by directory: ${directoryPath.join('/')}`,
          directoryPath
        );
        continue;
      }

      // Fallback for entities without a usable source path: legacy heuristic.
      const legacyName = this.extractPackageName(entity.sourceLocation.file);
      addToGroup(
        `legacy:${legacyName}`,
        this.formatPackageName(legacyName),
        entity.id,
        `Grouped by path: ${legacyName}`
      );
    }

    return Array.from(groups.values());
  }

  /**
   * Derive the project-relative directory segments for a source file.
   *
   * `workspaceRoot` is used to relativize absolute paths. Absolute paths
   * outside the workspace (or with no workspace root) yield an empty result so
   * the caller falls back to the legacy single-name heuristic rather than
   * leaking machine-specific path prefixes into namespace names.
   */
  private extractDirectorySegments(filePath: string, workspaceRoot?: string): string[] {
    if (!filePath || filePath.trim() === '') {
      return [];
    }

    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedRoot = workspaceRoot?.replace(/\\/g, '/').replace(/\/+$/, '');

    let relative = normalizedFile;
    if (path.posix.isAbsolute(normalizedFile) || /^[a-zA-Z]:\//.test(normalizedFile)) {
      if (!normalizedRoot) {
        return [];
      }
      const root = normalizedRoot.replace(/^([a-zA-Z]:)/, (m) => m.toLowerCase());
      const candidate = relative.replace(/^([a-zA-Z]:)/, (m) => m.toLowerCase());
      if (candidate === root) {
        return [];
      }
      if (!candidate.startsWith(`${root}/`)) {
        return [];
      }
      relative = candidate.slice(root.length + 1);
    }

    const dir = path.posix.dirname(relative);
    if (!dir || dir === '.' || dir === '/') {
      return [];
    }

    return dir.split('/').filter((segment) => segment !== '' && segment !== '.');
  }


  private extractJavaMavenModuleName(filePath: string): string | null {
    if (!filePath || filePath.trim() === '') {
      return null;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/([^/]+)\/src\/(?:main|test)\/java\//);
    if (!match) {
      return null;
    }

    const moduleName = match[1];
    if (!moduleName || moduleName === 'src') {
      return null;
    }

    return moduleName;
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
   * Format a directory path for display, e.g. `['src', 'user']` → `Src User Layer`.
   *
   * Every segment is kept (unlike formatPackageName, which only ever sees one
   * segment) so the human-readable name still reflects the directory depth.
   */
  private formatDirectoryName(segments: string[]): string {
    const formatted = segments
      .map((segment) =>
        segment
          .split(/[-_]/)
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      )
      .filter(Boolean)
      .join(' ');

    if (!formatted) {
      return 'Core Layer';
    }

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

    const isProtectedGroup = (group: PackageGroup | undefined): boolean =>
      !!group &&
      (group.path !== undefined ||
        group.reasoning?.includes('/') === true ||
        group.reasoning?.startsWith('Grouped by Maven module:') === true);

    for (let i = 0; i < packages.length; i++) {
      if (skipIndices.has(i)) {
        continue;
      }

      const current = packages[i];
      if (!current) continue;

      // Skip merging for protected groups (directory-path / Maven module based).
      // They already represent meaningful project boundaries and merging them
      // would erase the directory hierarchy this grouping exists to preserve.
      if (current.entities.length <= threshold && !isProtectedGroup(current) && i + 1 < packages.length) {
        // Merge with next package
        const next = packages[i + 1];
        if (next && !skipIndices.has(i + 1) && !isProtectedGroup(next)) {
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
