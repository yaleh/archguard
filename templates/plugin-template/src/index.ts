/**
 * ArchGuard Plugin Template
 *
 * This template provides a starting point for creating new language plugins.
 * Replace "MyLanguage" with your actual language name throughout this file.
 */

import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  PluginCapabilities,
} from '@archguard/core';
import type { ParseConfig } from '@archguard/core';
import type { ArchJSON, Entity, Relation, Member, SourceLocation } from '@archguard/types';

/**
 * Plugin metadata configuration
 * TODO: Update these values for your language
 */
const PLUGIN_METADATA: PluginMetadata = {
  name: 'my-language',           // Unique identifier (lowercase, hyphen-separated)
  version: '1.0.0',              // Semantic version
  displayName: 'My Language',    // Human-readable name
  fileExtensions: ['.my', '.ml'], // Supported file extensions
  author: 'Your Name',           // Your name or organization
  repository: 'https://github.com/you/archguard-my-language',
  minCoreVersion: '2.0.0',       // Minimum ArchGuard version required
  capabilities: {
    singleFileParsing: true,     // Can parse individual code strings
    incrementalParsing: true,    // Can parse specific files
    dependencyExtraction: false, // Has dependency extractor (implement if needed)
    typeInference: false,        // Can infer types for untyped code
  } as PluginCapabilities,
};

/**
 * Internal representation of parsed code structure
 * Customize this interface based on your language's constructs
 */
interface ParsedUnit {
  name: string;
  type: 'class' | 'interface' | 'enum' | 'function';
  members: Member[];
  extends?: string[];
  implements?: string[];
  location: SourceLocation;
}

/**
 * MyLanguage Plugin Implementation
 *
 * This plugin provides [brief description of what this plugin does].
 *
 * @example
 * ```typescript
 * import { MyLanguagePlugin } from '@archguard/plugin-my-language';
 *
 * const plugin = new MyLanguagePlugin();
 * await plugin.initialize({ workspaceRoot: '/path/to/project' });
 * const archJson = await plugin.parseProject('/path/to/project', config);
 * ```
 */
export class MyLanguagePlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = PLUGIN_METADATA;

  private initialized = false;
  private verbose = false;

  /**
   * Initialize the plugin
   *
   * Called once when the plugin is loaded. Use this method to:
   * - Validate required tools are available
   * - Set up caching directories
   * - Initialize parsers and resources
   *
   * @param config - Initialization configuration
   * @throws {PluginInitializationError} When initialization fails
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.verbose = config.verbose ?? false;

    if (this.verbose) {
      console.log(`[${this.metadata.displayName}] Initializing...`);
      console.log(`[${this.metadata.displayName}] Workspace: ${config.workspaceRoot}`);
    }

    // TODO: Add initialization logic here
    // Example: Initialize tree-sitter parser
    // this.parser = new Parser();
    // this.parser.setLanguage(MyLanguage);

    // Example: Check for required tools
    // if (!await this.checkToolAvailability()) {
    //   throw new ToolDependencyError(this.metadata.name, 'required-tool', '1.0.0');
    // }

    this.initialized = true;

    if (this.verbose) {
      console.log(`[${this.metadata.displayName}] Initialization complete`);
    }
  }

  /**
   * Check if this plugin can handle the given file or directory
   *
   * Used for automatic plugin detection. The plugin should check:
   * - File extensions for individual files
   * - Project markers for directories (e.g., package.json, go.mod)
   *
   * @param targetPath - Path to file or directory
   * @returns true if the plugin can handle this target
   */
  canHandle(targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();

    // Check if it's a file with supported extension
    if (this.metadata.fileExtensions.includes(ext)) {
      return true;
    }

    // Check if it's a directory with project markers
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        // TODO: Add your language's project markers
        // Example: myproject.toml, MyLanguagefile, etc.
        const markers = ['myproject.toml', 'MyLanguagefile'];

        for (const marker of markers) {
          if (fs.existsSync(path.join(targetPath, marker))) {
            return true;
          }
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Parse entire project and return ArchJSON representation
   *
   * This is the primary parsing method that analyzes all relevant files
   * in the workspace and produces a complete architectural model.
   *
   * @param workspaceRoot - Root directory of the project to analyze
   * @param config - Parsing configuration options
   * @returns Promise resolving to ArchJSON representation of the project
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    if (this.verbose) {
      console.log(`[${this.metadata.displayName}] Parsing project: ${workspaceRoot}`);
    }

    // Find all source files
    const pattern = config.filePattern ?? `**/*{${this.metadata.fileExtensions.join(',')}}`;
    const files = await glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/dist/**',
        '**/build/**',
        ...config.excludePatterns,
      ],
    });

    if (this.verbose) {
      console.log(`[${this.metadata.displayName}] Found ${files.length} files to parse`);
    }

    // Parse all files and collect results
    const allEntities: Entity[] = [];
    const allRelations: Relation[] = [];

    for (const file of files) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const result = this.parseCode(code, file);
        allEntities.push(...result.entities);
        allRelations.push(...result.relations);
      } catch (error) {
        console.warn(`[${this.metadata.displayName}] Failed to parse ${file}:`, error);
        // Continue with other files
      }
    }

    return {
      version: '1.0',
      language: this.metadata.name as ArchJSON['language'],
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities: allEntities,
      relations: allRelations,
    };
  }

  /**
   * Parse a single code string and return ArchJSON representation
   *
   * Useful for testing, IDE integrations, or incremental analysis.
   *
   * @param code - Source code string to parse
   * @param filePath - Optional file path for context
   * @returns ArchJSON representation of the code
   */
  parseCode(code: string, filePath: string = `source${this.metadata.fileExtensions[0]}`): ArchJSON {
    this.ensureInitialized();

    // TODO: Implement your parsing logic here
    // This example uses a simple regex-based approach
    // For production, consider using tree-sitter or a proper parser

    const units = this.parseToUnits(code, filePath);
    const entities = this.mapToEntities(units, filePath);
    const relations = this.extractRelations(units, filePath);

    return {
      version: '1.0',
      language: this.metadata.name as ArchJSON['language'],
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations,
    };
  }

  /**
   * Parse specific files and return ArchJSON representation
   *
   * Allows targeted analysis of specific files without full project scan.
   *
   * @param filePaths - Array of absolute file paths to parse
   * @returns Promise resolving to ArchJSON representation of the files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    const allEntities: Entity[] = [];
    const allRelations: Relation[] = [];

    for (const file of filePaths) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const result = this.parseCode(code, file);
        allEntities.push(...result.entities);
        allRelations.push(...result.relations);
      } catch (error) {
        console.warn(`[${this.metadata.displayName}] Failed to parse ${file}:`, error);
      }
    }

    return {
      version: '1.0',
      language: this.metadata.name as ArchJSON['language'],
      timestamp: new Date().toISOString(),
      sourceFiles: filePaths,
      entities: allEntities,
      relations: allRelations,
    };
  }

  /**
   * Clean up plugin resources
   *
   * Called when the plugin is no longer needed. Clean up:
   * - Close any open files or connections
   * - Clear temporary caches
   * - Release system resources
   */
  async dispose(): Promise<void> {
    if (this.verbose) {
      console.log(`[${this.metadata.displayName}] Disposing resources`);
    }

    // TODO: Clean up any resources
    // Example: Close LSP client connections
    // await this.lspClient?.dispose();

    this.initialized = false;
  }

  // ==================== Private Helper Methods ====================

  /**
   * Ensure plugin is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `${this.metadata.displayName} plugin not initialized. Call initialize() first.`
      );
    }
  }

  /**
   * Parse source code to internal unit representation
   *
   * TODO: Implement language-specific parsing logic
   */
  private parseToUnits(code: string, filePath: string): ParsedUnit[] {
    const units: ParsedUnit[] = [];

    // TODO: Replace with actual parsing logic
    // Example: Using tree-sitter
    // const tree = this.parser.parse(code);
    // return this.extractUnitsFromTree(tree, code);

    // Simple regex example (replace with proper parser)
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g;
    let match;

    while ((match = classRegex.exec(code)) !== null) {
      const startLine = this.getLineNumber(code, match.index);
      const endLine = this.getLineNumber(code, match.index + match[0].length);

      units.push({
        name: match[1],
        type: 'class',
        members: [], // TODO: Extract members
        extends: match[2] ? [match[2]] : undefined,
        implements: match[3] ? match[3].split(',').map(s => s.trim()) : undefined,
        location: { file: filePath, startLine, endLine },
      });
    }

    return units;
  }

  /**
   * Map parsed units to ArchJSON entities
   */
  private mapToEntities(units: ParsedUnit[], filePath: string): Entity[] {
    return units.map((unit, index) => ({
      id: `${filePath}#${unit.name}`,
      name: unit.name,
      type: unit.type,
      visibility: 'public' as const, // TODO: Extract actual visibility
      members: unit.members,
      sourceLocation: unit.location,
      extends: unit.extends,
      implements: unit.implements,
    }));
  }

  /**
   * Extract relationships from parsed units
   */
  private extractRelations(units: ParsedUnit[], filePath: string): Relation[] {
    const relations: Relation[] = [];

    for (const unit of units) {
      // Extract inheritance relations
      if (unit.extends) {
        for (const parent of unit.extends) {
          relations.push({
            id: `${filePath}#${unit.name}->extends->${parent}`,
            type: 'inheritance',
            source: `${filePath}#${unit.name}`,
            target: `${filePath}#${parent}`,
          });
        }
      }

      // Extract implementation relations
      if (unit.implements) {
        for (const iface of unit.implements) {
          relations.push({
            id: `${filePath}#${unit.name}->implements->${iface}`,
            type: 'implementation',
            source: `${filePath}#${unit.name}`,
            target: `${filePath}#${iface}`,
          });
        }
      }
    }

    return relations;
  }

  /**
   * Get line number for a character index
   */
  private getLineNumber(code: string, index: number): number {
    return code.substring(0, index).split('\n').length;
  }
}

// Default export for plugin discovery
export default MyLanguagePlugin;
