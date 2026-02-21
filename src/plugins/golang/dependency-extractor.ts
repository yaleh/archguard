/**
 * Dependency extractor for Go projects
 *
 * Extracts dependencies from go.mod files
 */

import fs from 'fs-extra';
import path from 'path';
import type { Dependency, IDependencyExtractor } from '@/core/interfaces/dependency.js';

/**
 * Parsed go.mod structure
 */
interface GoModInfo {
  module: string;
  goVersion: string;
  dependencies: Dependency[];
}

/**
 * Go dependency extractor
 *
 * Supports parsing go.mod files (Go modules)
 */
export class DependencyExtractor implements IDependencyExtractor {
  /**
   * Extract dependencies from Go project
   */
  async extractDependencies(workspaceRoot: string): Promise<Dependency[]> {
    const goModPath = path.join(workspaceRoot, 'go.mod');

    if (!(await fs.pathExists(goModPath))) {
      return [];
    }

    try {
      const content = await fs.readFile(goModPath, 'utf-8');
      const parsed = this.parseGoMod(content);
      return parsed.dependencies;
    } catch (error) {
      console.warn(`Error parsing go.mod: ${error}`);
      return [];
    }
  }

  /**
   * Parse go.mod content
   */
  private parseGoMod(content: string): GoModInfo {
    const lines = content.split('\n');
    const dependencies: Dependency[] = [];

    let moduleName = '';
    let goVersion = '';
    let inRequireBlock = false;

    for (let line of lines) {
      line = line.trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Skip standalone comments (not inline // indirect)
      if (line.startsWith('//') && !line.includes(' indirect')) {
        continue;
      }

      // Parse module directive
      if (line.startsWith('module ')) {
        moduleName = line.substring(7).trim();
        continue;
      }

      // Parse go version
      if (line.startsWith('go ')) {
        goVersion = line.substring(3).trim();
        continue;
      }

      // Skip replace, exclude, retract directives
      if (
        line.startsWith('replace ') ||
        line.startsWith('exclude ') ||
        line.startsWith('retract ')
      ) {
        continue;
      }

      // Handle single-line require
      if (line.startsWith('require ') && !line.includes('(')) {
        const dep = this.parseRequireLine(line.substring(8).trim());
        if (dep) {
          dependencies.push(dep);
        }
        continue;
      }

      // Handle require block start
      if (line === 'require (') {
        inRequireBlock = true;
        continue;
      }

      // Handle require block end
      if (line === ')' && inRequireBlock) {
        inRequireBlock = false;
        continue;
      }

      // Parse dependencies inside require block
      if (inRequireBlock) {
        const dep = this.parseRequireLine(line);
        if (dep) {
          dependencies.push(dep);
        }
      }
    }

    return {
      module: moduleName,
      goVersion,
      dependencies,
    };
  }

  /**
   * Parse a single require line
   *
   * Formats:
   * - github.com/gin-gonic/gin v1.9.0
   * - github.com/gin-gonic/gin v1.9.0 // indirect
   * - // Comment line (ignored)
   */
  private parseRequireLine(line: string): Dependency | null {
    // Remove inline comments except // indirect
    const indirectMatch = line.match(/\/\/\s*indirect/);
    const isIndirect = indirectMatch !== null;

    // Remove comments for parsing
    const cleanLine = line.replace(/\/\/.*$/, '').trim();

    // Skip pure comment lines
    if (!cleanLine || cleanLine.startsWith('//')) {
      return null;
    }

    // Parse: module/path version
    // Version can be:
    // - v1.2.3 (semantic version)
    // - v0.0.0-20231201183741-6cbirds (pseudo-version)
    // - v1.2.3+incompatible

    const parts = cleanLine.split(/\s+/);
    if (parts.length < 2) {
      // Invalid line format, skip
      return null;
    }

    const name = parts[0];
    const version = parts[1];

    // Validate module path (basic check)
    if (!name || name.startsWith('//') || !version) {
      return null;
    }

    return {
      name,
      version,
      type: 'gomod',
      scope: 'runtime',
      source: 'go.mod',
      isDirect: !isIndirect,
    };
  }
}
