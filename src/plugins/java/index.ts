/**
 * Java Language Plugin
 * Phase 3.A: Tree-sitter-based Java parser
 */

import path from 'path';
import fs from 'fs-extra';
import { glob } from 'glob';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { IDependencyExtractor, Dependency } from '@/core/interfaces/dependency.js';
import type { ArchJSON } from '@/types/index.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { DependencyExtractor } from './dependency-extractor.js';
import type { JavaRawPackage } from './types.js';

/**
 * Java plugin for ArchGuard
 *
 * Uses tree-sitter-java for parsing Java source code and extracting
 * architecture information including classes, interfaces, enums, and
 * their relationships.
 */
export class JavaPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'java',
    version: '1.0.0',
    displayName: 'Java',
    fileExtensions: ['.java'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: true,
      dependencyExtraction: true,
      typeInference: false,
    },
  };

  private treeSitter!: TreeSitterBridge;
  private mapper!: ArchJsonMapper;
  private depExtractor!: DependencyExtractor;
  private initialized = false;

  /**
   * Dependency extractor instance
   */
  get dependencyExtractor(): IDependencyExtractor | undefined {
    return {
      extractDependencies: async (workspaceRoot: string): Promise<Dependency[]> => {
        this.ensureInitialized();
        return this.depExtractor.extract(workspaceRoot);
      },
    };
  }

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.treeSitter = new TreeSitterBridge();
    this.mapper = new ArchJsonMapper();
    this.depExtractor = new DependencyExtractor();

    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given target path
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a .java file
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.java') {
      return true;
    }

    // Check if it's a directory with pom.xml or build.gradle
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        if (
          fs.existsSync(path.join(targetPath, 'pom.xml')) ||
          fs.existsSync(path.join(targetPath, 'build.gradle'))
        ) {
          return true;
        }
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  /**
   * Parse entire Java project
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    this.ensureInitialized();

    // Find all .java files
    const pattern = config.filePattern ?? '**/*.java';
    const files = await glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ['**/target/**', '**/build/**', '**/node_modules/**', ...config.excludePatterns],
    });

    // Parse all files
    const packages = new Map<string, JavaRawPackage>();

    for (const file of files) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const pkg = this.treeSitter.parseCode(code, file);

        // Merge into packages map
        if (packages.has(pkg.name)) {
          const existing = packages.get(pkg.name);
          existing.classes.push(...pkg.classes);
          existing.interfaces.push(...pkg.interfaces);
          existing.enums.push(...pkg.enums);
        } else {
          packages.set(pkg.name, pkg);
        }
      } catch (error) {
        console.warn(`Failed to parse ${file}:`, error);
        // Continue with other files
      }
    }

    const packageList = Array.from(packages.values());

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList);

    return {
      version: '1.0',
      language: 'java',
      timestamp: new Date().toISOString(),
      sourceFiles: files,
      entities,
      relations,
    };
  }

  /**
   * Parse single Java file
   */
  parseCode(code: string, filePath: string = 'source.java'): ArchJSON {
    this.ensureInitialized();

    try {
      const pkg = this.treeSitter.parseCode(code, filePath);

      // Map to ArchJSON
      const entities = this.mapper.mapEntities([pkg]);
      const relations = this.mapper.mapRelations([pkg]);

      return {
        version: '1.0',
        language: 'java',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities,
        relations,
      };
    } catch (error) {
      console.warn(`Failed to parse code:`, error);
      // Return empty result on error
      return {
        version: '1.0',
        language: 'java',
        timestamp: new Date().toISOString(),
        sourceFiles: [filePath],
        entities: [],
        relations: [],
      };
    }
  }

  /**
   * Parse multiple Java files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    const packages = new Map<string, JavaRawPackage>();

    for (const file of filePaths) {
      try {
        const code = await fs.readFile(file, 'utf-8');
        const pkg = this.treeSitter.parseCode(code, file);

        // Merge into packages map
        if (packages.has(pkg.name)) {
          const existing = packages.get(pkg.name);
          existing.classes.push(...pkg.classes);
          existing.interfaces.push(...pkg.interfaces);
          existing.enums.push(...pkg.enums);
        } else {
          packages.set(pkg.name, pkg);
        }
      } catch (error) {
        console.warn(`Failed to parse ${file}:`, error);
        // Continue with other files
      }
    }

    const packageList = Array.from(packages.values());

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList);

    return {
      version: '1.0',
      language: 'java',
      timestamp: new Date().toISOString(),
      sourceFiles: filePaths,
      entities,
      relations,
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
      throw new Error('JavaPlugin not initialized. Call initialize() first.');
    }
  }
}
