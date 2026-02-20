/**
 * TypeScript/JavaScript Language Plugin
 * Phase 1.1: TypeScript Plugin Migration
 */

import path from 'path';
import fs from 'fs-extra';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  PluginCapabilities,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { ArchJSON } from '@/types/index.js';
import type { IDependencyExtractor, Dependency } from '@/core/interfaces/dependency.js';
import type { IValidator, ValidationResult, ValidationError, ValidationWarning } from '@/core/interfaces/validation.js';
import { TypeScriptParser } from '@/parser/typescript-parser.js';
import { ParallelParser } from '@/parser/parallel-parser.js';

/**
 * TypeScript/JavaScript plugin for ArchGuard
 * 
 * Wraps existing TypeScriptParser and ParallelParser to conform to
 * the ILanguagePlugin interface, enabling multi-language support.
 */
export class TypeScriptPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'typescript',
    version: '1.0.0',
    displayName: 'TypeScript/JavaScript',
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: true,
    } as PluginCapabilities,
  };

  private parser!: TypeScriptParser;
  private parallelParser!: ParallelParser;
  private initialized = false;

  readonly dependencyExtractor: IDependencyExtractor = {
    extractDependencies: this.extractDeps.bind(this),
  };

  readonly validator: IValidator = {
    validate: this.validateArchJson.bind(this),
  };

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize parsers
    this.parser = new TypeScriptParser();
    this.parallelParser = new ParallelParser({
      continueOnError: true,
    });

    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given target path
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a file with supported extension
    const ext = path.extname(targetPath).toLowerCase();
    if (this.metadata.fileExtensions.includes(ext)) {
      return true;
    }

    // Check if it's a directory with TypeScript/JavaScript markers
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        // Check for package.json
        if (fs.existsSync(path.join(targetPath, 'package.json'))) {
          return true;
        }
        // Check for tsconfig.json
        if (fs.existsSync(path.join(targetPath, 'tsconfig.json'))) {
          return true;
        }
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  /**
   * Parse entire project
   * Delegates to TypeScriptParser.parseProject
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    const pattern = config.filePattern ?? '**/*.ts';
    return this.parser.parseProject(workspaceRoot, pattern);
  }

  /**
   * Parse single code string
   * Delegates to TypeScriptParser.parseCode
   */
  parseCode(code: string, filePath: string = 'source.ts'): ArchJSON {
    this.ensureInitialized();
    return this.parser.parseCode(code, filePath);
  }

  /**
   * Parse multiple files
   * Delegates to ParallelParser.parseFiles
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();
    return this.parallelParser.parseFiles(filePaths);
  }

  /**
   * Extract npm dependencies from package.json
   */
  private async extractDeps(workspaceRoot: string): Promise<Dependency[]> {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      return [];
    }

    const packageJson = await fs.readJson(packageJsonPath);
    const dependencies: Dependency[] = [];

    // Runtime dependencies
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

    // Development dependencies
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

    // Peer dependencies
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
   * Validate ArchJSON structure
   */
  private validateArchJson(archJson: ArchJSON): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    // Validate version
    if (!archJson.version) {
      errors.push({
        code: 'MISSING_VERSION',
        message: 'ArchJSON version is required',
        path: 'version',
        severity: 'error',
      });
    }

    // Validate language
    if (!archJson.language) {
      errors.push({
        code: 'MISSING_LANGUAGE',
        message: 'ArchJSON language is required',
        path: 'language',
        severity: 'error',
      });
    }

    // Validate entities
    if (archJson.entities) {
      archJson.entities.forEach((entity, index) => {
        if (!entity.id) {
          errors.push({
            code: 'MISSING_ENTITY_ID',
            message: `Entity at index ${index} is missing id`,
            path: `entities[${index}].id`,
            severity: 'error',
          });
        }

        if (!entity.name) {
          errors.push({
            code: 'MISSING_ENTITY_NAME',
            message: `Entity at index ${index} is missing name`,
            path: `entities[${index}].name`,
            severity: 'error',
          });
        }
      });
    }

    // Validate relation references
    if (archJson.relations && archJson.entities) {
      const entityIds = new Set(archJson.entities.map((e) => e.id));

      archJson.relations.forEach((relation, index) => {
        if (!entityIds.has(relation.source)) {
          warnings.push({
            code: 'DANGLING_RELATION_SOURCE',
            message: `Relation references non-existent source entity: ${relation.source}`,
            path: `relations[${index}].source`,
            severity: 'warning',
            suggestion: 'Ensure the source entity is included in the parsed scope',
          });
        }

        if (!entityIds.has(relation.target)) {
          warnings.push({
            code: 'DANGLING_RELATION_TARGET',
            message: `Relation references non-existent target entity: ${relation.target}`,
            path: `relations[${index}].target`,
            severity: 'warning',
            suggestion: 'Ensure the target entity is included in the parsed scope',
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Ensure plugin is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('TypeScriptPlugin not initialized. Call initialize() first.');
    }
  }
}
