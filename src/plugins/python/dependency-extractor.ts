/**
 * Dependency extractor for Python projects
 *
 * Extracts dependencies from requirements.txt and pyproject.toml (Poetry)
 */

import fs from 'fs-extra';
import path from 'path';
import type { Dependency, IDependencyExtractor } from '@/core/interfaces/dependency.js';

/**
 * Python dependency extractor
 *
 * Supports:
 * - requirements.txt (pip)
 * - pyproject.toml (Poetry)
 */
export class DependencyExtractor implements IDependencyExtractor {
  /**
   * Extract dependencies from Python project
   */
  async extractDependencies(workspaceRoot: string): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    // Check for pyproject.toml first (Poetry projects)
    const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
    if (await fs.pathExists(pyprojectPath)) {
      const poetryDeps = await this.extractPoetryDependencies(pyprojectPath);
      dependencies.push(...poetryDeps);
      // If pyproject.toml exists, prefer it over requirements.txt
      return dependencies;
    }

    // Fallback to requirements.txt
    const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
    if (await fs.pathExists(requirementsPath)) {
      const pipDeps = await this.extractPipDependencies(requirementsPath);
      dependencies.push(...pipDeps);
    }

    return dependencies;
  }

  /**
   * Extract dependencies from requirements.txt
   */
  private async extractPipDependencies(requirementsPath: string): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    try {
      const content = await fs.readFile(requirementsPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        // Parse requirement line
        const dep = this.parseRequirementLine(trimmed);
        if (dep) {
          dependencies.push(dep);
        }
      }
    } catch (error) {
      console.warn(`Error parsing requirements.txt: ${error}`);
    }

    return dependencies;
  }

  /**
   * Parse a single requirement line
   */
  private parseRequirementLine(line: string): Dependency | null {
    try {
      // Remove extras and markers for basic parsing
      // e.g., "requests[security]==2.25.0" -> "requests==2.25.0"
      // e.g., "pytest>=6.0; python_version >= '3.6'" -> "pytest>=6.0"
      let cleanLine = line.split(';')[0].trim(); // Remove markers
      const extrasMatch = cleanLine.match(/^([a-zA-Z0-9_-]+)\[.*?\]/);
      if (extrasMatch) {
        cleanLine = cleanLine.replace(/\[.*?\]/, '');
      }

      // Parse package name and version
      const versionOperators = ['==', '>=', '<=', '~=', '!=', '>', '<'];
      let packageName = cleanLine;
      let version = '*';

      for (const op of versionOperators) {
        const idx = cleanLine.indexOf(op);
        if (idx !== -1) {
          packageName = cleanLine.substring(0, idx).trim();
          // Extract just the version number, not the operator
          const versionPart = cleanLine.substring(idx + op.length).trim();
          version = op + versionPart;
          break;
        }
      }

      // Validate package name
      if (!packageName || !/^[a-zA-Z0-9_-]+$/.test(packageName)) {
        return null;
      }

      return {
        name: packageName,
        version,
        type: 'pip',
        scope: 'runtime',
        source: 'requirements.txt',
        isDirect: true,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract dependencies from pyproject.toml (Poetry format)
   */
  private async extractPoetryDependencies(pyprojectPath: string): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    try {
      const content = await fs.readFile(pyprojectPath, 'utf-8');

      // Simple TOML parsing for Poetry format
      // In production, we'd use a proper TOML parser, but for now we'll use regex

      // Extract [tool.poetry.dependencies]
      const depsSection = this.extractTomlSection(content, 'tool.poetry.dependencies');
      if (depsSection) {
        const deps = this.parsePoetryDepsSection(depsSection, 'runtime');
        dependencies.push(...deps);
      }

      // Extract [tool.poetry.dev-dependencies]
      const devDepsSection = this.extractTomlSection(content, 'tool.poetry.dev-dependencies');
      if (devDepsSection) {
        const deps = this.parsePoetryDepsSection(devDepsSection, 'development');
        dependencies.push(...deps);
      }

      // Check for optional dependencies in extras
      const extrasSection = this.extractTomlSection(content, 'tool.poetry.extras');
      if (extrasSection) {
        // Mark previously found optional dependencies
        const optionalPackages = this.parseExtrasSection(extrasSection);
        for (const dep of dependencies) {
          if (optionalPackages.includes(dep.name)) {
            dep.scope = 'optional';
          }
        }
      }
    } catch (error) {
      console.warn(`Error parsing pyproject.toml: ${error}`);
    }

    return dependencies;
  }

  /**
   * Extract a TOML section by name
   */
  private extractTomlSection(content: string, sectionName: string): string | null {
    // Match section header and capture everything until the next section or end of file
    const lines = content.split('\n');
    let inSection = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if we're entering the target section
      if (trimmed === `[${sectionName}]`) {
        inSection = true;
        continue;
      }

      // Check if we're entering a different section (stop capturing)
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        if (inSection) {
          break; // End of our section
        }
        continue;
      }

      // Collect lines within our section
      if (inSection) {
        sectionLines.push(line);
      }
    }

    return sectionLines.length > 0 ? sectionLines.join('\n') : null;
  }

  /**
   * Parse Poetry dependencies section
   */
  private parsePoetryDepsSection(
    section: string,
    scope: 'runtime' | 'development'
  ): Dependency[] {
    const dependencies: Dependency[] = [];
    const lines = section.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse: package = "version" or package = { version = "version", ... }
      const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']([^"']+)["']/);
      if (simpleMatch) {
        const [, name, version] = simpleMatch;

        // Skip python version constraint
        if (name === 'python') {
          continue;
        }

        dependencies.push({
          name,
          version,
          type: 'pip',
          scope,
          source: 'pyproject.toml',
          isDirect: true,
        });
        continue;
      }

      // Parse complex format: package = { version = "^2.0.0", optional = true }
      const complexMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{(.+)\}/);
      if (complexMatch) {
        const [, name, attrs] = complexMatch;

        // Skip python version constraint
        if (name === 'python') {
          continue;
        }

        // Extract version
        const versionMatch = attrs.match(/version\s*=\s*["']([^"']+)["']/);
        const version = versionMatch ? versionMatch[1] : '*';

        // Check if optional
        const isOptional = attrs.includes('optional = true');
        const depScope = isOptional ? 'optional' : scope;

        dependencies.push({
          name,
          version,
          type: 'pip',
          scope: depScope,
          source: 'pyproject.toml',
          isDirect: true,
        });
      }
    }

    return dependencies;
  }

  /**
   * Parse extras section to get list of optional package names
   */
  private parseExtrasSection(section: string): string[] {
    const packages: string[] = [];

    // Extract all package names from extras arrays
    // e.g., web = ["flask", "requests"]
    const arrayMatches = section.matchAll(/\[([^\]]+)\]/g);

    for (const match of arrayMatches) {
      const items = match[1];
      const packageNames = items
        .split(',')
        .map(s => s.trim().replace(/["']/g, ''))
        .filter(s => s.length > 0);

      packages.push(...packageNames);
    }

    return packages;
  }
}
