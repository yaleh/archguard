/**
 * TypeScript/JavaScript Language Plugin
 * Phase 1.1: T1.1.1 - TypeScript Plugin Implementation
 */

import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type {
  IDependencyExtractor,
  Dependency,
  DependencyScope,
} from '@/core/interfaces/dependency.js';
import type { IValidator } from '@/core/interfaces/validation.js';
import type { ArchJSON } from '@/types/index.js';
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { ParallelParser } from '@/parser/parallel-parser.js';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * TypeScript/JavaScript language plugin for ArchGuard
 *
 * Provides comprehensive parsing support for TypeScript and JavaScript projects,
 * including dependency extraction and validation capabilities.
 */
export class TypeScriptPlugin implements ILanguagePlugin {
  /**
   * Plugin metadata
   */
  readonly metadata: PluginMetadata = {
    name: 'typescript',
    version: '1.0.0',
    displayName: 'TypeScript/JavaScript',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    author: 'ArchGuard Team',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  private parser!: TypeScriptParser;
  private parallelParser!: ParallelParser;
  private workspaceRoot?: string;
  private verbose: boolean = false;

  /**
   * Initialize the plugin
   *
   * Sets up the TypeScript parser and parallel parser instances.
   *
   * @param config - Plugin initialization configuration
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    this.workspaceRoot = config.workspaceRoot;
    this.verbose = config.verbose ?? false;

    // Initialize parsers
    this.parser = new TypeScriptParser();
    this.parallelParser = new ParallelParser({
      concurrency: undefined, // Will use CPU cores by default
      continueOnError: true,
    });

    if (this.verbose) {
      console.log(`[TypeScriptPlugin] Initialized for workspace: ${this.workspaceRoot}`);
    }
  }

  /**
   * Check if this plugin can handle the given file or directory
   *
   * Checks:
   * - File extensions for individual files (.ts, .tsx, .js, .jsx)
   * - Project markers for directories (package.json, tsconfig.json)
   *
   * @param targetPath - Path to file or directory
   * @returns true if the plugin can handle this target
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a file with supported extension
    const ext = path.extname(targetPath);
    if (this.metadata.fileExtensions.includes(ext)) {
      return true;
    }

    // Check if it's a directory with TypeScript/JavaScript project markers
    // Note: This is synchronous check - in production, consider async version
    try {
      const packageJsonPath = path.join(targetPath, 'package.json');
      const tsconfigPath = path.join(targetPath, 'tsconfig.json');

      if (fs.existsSync(packageJsonPath) || fs.existsSync(tsconfigPath)) {
        return true;
      }
    } catch {
      // If path doesn't exist or is not a directory, return false
      return false;
    }

    return false;
  }

  /**
   * Clean up plugin resources
   *
   * Currently TypeScriptPlugin has no resources that require explicit cleanup,
   * but this method is provided for interface compliance and future extensibility.
   */
  async dispose(): Promise<void> {
    if (this.verbose) {
      console.log('[TypeScriptPlugin] Disposed');
    }
    // No explicit cleanup needed for current implementation
  }

  /**
   * Parse an entire project and return ArchJSON representation
   *
   * Delegates to TypeScriptParser.parseProject()
   *
   * @param workspaceRoot - Root directory of the project to analyze
   * @param config - Parsing configuration options
   * @returns Promise resolving to ArchJSON representation of the project
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    if (!this.parser) {
      throw new Error('Plugin not initialized. Call initialize() first.');
    }

    // Use file pattern from config, defaulting to all TypeScript files
    const pattern = config.filePattern ?? '**/*.ts';

    // Delegate to TypeScriptParser
    // Note: TypeScriptParser.parseProject is synchronous, so we wrap in Promise
    const result = this.parser.parseProject(workspaceRoot, pattern);

    return result;
  }

  /**
   * Parse a single code string and return ArchJSON representation
   *
   * Delegates to TypeScriptParser.parseCode()
   *
   * @param code - Source code string to parse
   * @param filePath - Optional file path for context
   * @returns ArchJSON representation of the code
   */
  parseCode(code: string, filePath: string = 'source.ts'): ArchJSON {
    if (!this.parser) {
      throw new Error('Plugin not initialized. Call initialize() first.');
    }

    // Delegate to TypeScriptParser
    return this.parser.parseCode(code, filePath);
  }

  /**
   * Parse specific files and return ArchJSON representation
   *
   * Delegates to ParallelParser.parseFiles()
   *
   * @param filePaths - Array of absolute file paths to parse
   * @returns Promise resolving to ArchJSON representation of the files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    if (!this.parallelParser) {
      throw new Error('Plugin not initialized. Call initialize() first.');
    }

    // Delegate to ParallelParser
    return this.parallelParser.parseFiles(filePaths);
  }

  /**
   * Dependency extractor implementation
   */
  readonly dependencyExtractor: IDependencyExtractor = {
    extractDependencies: this.extractDependencies.bind(this),
  };

  /**
   * Extract npm dependencies from package.json
   *
   * @param workspaceRoot - Root directory of the project
   * @returns Promise resolving to array of dependencies
   */
  private async extractDependencies(workspaceRoot: string): Promise<Dependency[]> {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');

    // Check if package.json exists
    if (!(await fs.pathExists(packageJsonPath))) {
      return [];
    }

    // Read and parse package.json
    const packageJson = await fs.readJson(packageJsonPath);
    const dependencies: Dependency[] = [];

    // Extract regular dependencies (runtime)
    if (packageJson.dependencies) {
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'npm',
          scope: 'runtime',
          source: 'package.json',
          isDirect: true,
        });
      }
    }

    // Extract devDependencies (development)
    if (packageJson.devDependencies) {
      for (const [name, version] of Object.entries(packageJson.devDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'npm',
          scope: 'development',
          source: 'package.json',
          isDirect: true,
        });
      }
    }

    // Extract peerDependencies (peer)
    if (packageJson.peerDependencies) {
      for (const [name, version] of Object.entries(packageJson.peerDependencies)) {
        dependencies.push({
          name,
          version: version as string,
          type: 'npm',
          scope: 'peer',
          source: 'package.json',
          isDirect: true,
        });
      }
    }

    return dependencies;
  }

  /**
   * Optional validator
   * Will be implemented in T1.1.4
   */
  readonly validator?: IValidator;
}
