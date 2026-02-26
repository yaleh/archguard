/**
 * Go Language Plugin
 * Phase 2.A: Tree-sitter-based Go parser
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
import type { ArchJSON } from '@/types/index.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import { TreeSitterBridge } from './tree-sitter-bridge.js';
import type { TreeSitterParseOptions } from './tree-sitter-bridge.js';
import { InterfaceMatcher } from './interface-matcher.js';
import { ArchJsonMapper } from './archjson-mapper.js';
import { GoplsClient } from './gopls-client.js';
import { DependencyExtractor } from './dependency-extractor.js';
import type { GoRawPackage, GoRawData } from './types.js';

// Re-export for external use
export type { IDependencyExtractor } from '@/core/interfaces/dependency.js';

/**
 * Go plugin for ArchGuard
 *
 * Uses tree-sitter-go for parsing Go source code and extracting
 * architecture information including structs, interfaces, and
 * implicit interface implementations.
 */
export class GoPlugin implements ILanguagePlugin {
  readonly metadata: PluginMetadata = {
    name: 'golang',
    version: '1.0.0',
    displayName: 'Go (Golang)',
    fileExtensions: ['.go'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  readonly dependencyExtractor: IDependencyExtractor;

  private treeSitter!: TreeSitterBridge;
  private matcher!: InterfaceMatcher;
  private mapper!: ArchJsonMapper;
  private goplsClient: GoplsClient | null = null;
  private initialized = false;
  private workspaceRoot = '';

  constructor() {
    this.dependencyExtractor = new DependencyExtractor();
  }

  /**
   * Initialize the plugin
   */
  async initialize(config: PluginInitConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.treeSitter = new TreeSitterBridge();
    this.matcher = new InterfaceMatcher();
    this.mapper = new ArchJsonMapper();

    // Try to initialize gopls (optional enhancement)
    try {
      this.goplsClient = new GoplsClient();
      // Note: We'll initialize gopls with workspace root when parseProject is called
    } catch (error) {
      console.warn('gopls not available, using fallback interface matcher');
      this.goplsClient = null;
    }

    this.initialized = true;
  }

  /**
   * Check if plugin can handle the given target path
   */
  canHandle(targetPath: string): boolean {
    // Check if it's a .go file
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.go') {
      return true;
    }

    // Check if it's a directory with go.mod
    try {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        if (fs.existsSync(path.join(targetPath, 'go.mod'))) {
          return true;
        }
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  /**
   * PUBLIC: Parse project to raw data
   *
   * Exposed for GoAtlasPlugin composition (ADR-001 v1.2).
   * Returns GoRawData (not ArchJSON) to avoid unnecessary mapping.
   * Accepts TreeSitterParseOptions for body extraction control.
   */
  async parseToRawData(
    workspaceRoot: string,
    config: ParseConfig & TreeSitterParseOptions
  ): Promise<GoRawData> {
    this.ensureInitialized();

    this.workspaceRoot = workspaceRoot;

    // Initialize gopls if available
    if (this.goplsClient && !this.goplsClient.isInitialized()) {
      try {
        await this.goplsClient.initialize(workspaceRoot);
      } catch (error) {
        console.warn('Failed to initialize gopls, using fallback:', error);
        this.goplsClient = null;
      }
    }

    // Find all .go files
    const pattern = config.filePattern ?? '**/*.go';
    const files = await glob(pattern, {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ['**/vendor/**', '**/node_modules/**', ...(config.excludePatterns ?? [])],
    });

    const moduleName = await this.readModuleName(workspaceRoot);

    // Parse all files — merge by fullName (not name!)
    const packages = new Map<string, GoRawPackage>();

    for (const file of files) {
      const code = await fs.readFile(file, 'utf-8');
      const pkg = this.treeSitter.parseCode(code, file, {
        extractBodies: config.extractBodies,
        selectiveExtraction: config.selectiveExtraction,
      });

      // Compute fullName from file path relative to module root
      const relDir = path.relative(workspaceRoot, path.dirname(file));
      pkg.fullName = relDir || pkg.name;
      pkg.dirPath = path.dirname(file);
      pkg.id = pkg.fullName;

      // Merge by fullName (prevents same-name package collision)
      const key = pkg.fullName;
      if (packages.has(key)) {
        const existing = packages.get(key)!;
        existing.structs.push(...pkg.structs);
        existing.interfaces.push(...pkg.interfaces);
        existing.functions.push(...pkg.functions);
        existing.imports.push(...pkg.imports);
        existing.sourceFiles.push(...pkg.sourceFiles);
        // Accumulate orphaned methods for later re-attachment
        if (pkg.orphanedMethods?.length) {
          if (!existing.orphanedMethods) existing.orphanedMethods = [];
          existing.orphanedMethods.push(...pkg.orphanedMethods);
        }
      } else {
        packages.set(key, pkg);
      }
    }

    // Re-attach orphaned methods: methods whose receiver struct was in another file
    for (const pkg of packages.values()) {
      if (!pkg.orphanedMethods?.length) continue;
      for (const method of pkg.orphanedMethods) {
        const struct = pkg.structs.find((s) => s.name === method.receiverType);
        if (struct) {
          struct.methods.push(method);
        }
      }
      pkg.orphanedMethods = [];
    }

    return {
      packages: Array.from(packages.values()),
      moduleRoot: workspaceRoot,
      moduleName,
    };
  }

  /**
   * Parse entire Go project
   * Refactored to reuse parseToRawData()
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    const rawData = await this.parseToRawData(workspaceRoot, config);

    // Match interface implementations (using gopls if available)
    const allStructs = rawData.packages.flatMap((p) => p.structs);
    const allInterfaces = rawData.packages.flatMap((p) => p.interfaces);
    const implementations = await this.matcher.matchWithGopls(
      allStructs,
      allInterfaces,
      this.goplsClient
    );

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(rawData.packages);
    const relations = this.mapper.mapRelations(rawData.packages, implementations);

    return {
      version: '1.0',
      language: 'go',
      timestamp: new Date().toISOString(),
      sourceFiles: rawData.packages.flatMap((p) => p.sourceFiles),
      entities,
      relations,
    };
  }

  private async readModuleName(workspaceRoot: string): Promise<string> {
    try {
      const goModContent = await fs.readFile(`${workspaceRoot}/go.mod`, 'utf-8');
      const match = goModContent.match(/^module\s+(.+)$/m);
      return match ? match[1].trim() : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Parse single Go file
   * Note: gopls not used for single file parsing (requires workspace context)
   */
  parseCode(code: string, filePath: string = 'source.go'): ArchJSON {
    this.ensureInitialized();

    const pkg = this.treeSitter.parseCode(code, filePath);

    // Match implementations within single file (name-based only)
    const implementations = this.matcher.matchImplicitImplementations(pkg.structs, pkg.interfaces);

    // Map to ArchJSON
    const entities = this.mapper.mapEntities([pkg]);
    const relations = this.mapper.mapRelations([pkg], implementations);

    return {
      version: '1.0',
      language: 'go',
      timestamp: new Date().toISOString(),
      sourceFiles: [filePath],
      entities,
      relations,
    };
  }

  /**
   * Parse multiple Go files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();

    // Try to initialize gopls if we have a workspace context
    if (this.goplsClient && !this.goplsClient.isInitialized() && this.workspaceRoot) {
      try {
        await this.goplsClient.initialize(this.workspaceRoot);
      } catch (error) {
        console.warn('Failed to initialize gopls:', error);
        this.goplsClient = null;
      }
    }

    const packages = new Map<string, GoRawPackage>();

    for (const file of filePaths) {
      const code = await fs.readFile(file, 'utf-8');
      const pkg = this.treeSitter.parseCode(code, file);

      // Use directory path as key to avoid same-name package collisions
      const key = path.dirname(file);
      pkg.fullName = pkg.fullName || key;
      pkg.dirPath = pkg.dirPath || key;

      // Merge into packages map
      if (packages.has(key)) {
        const existing = packages.get(key);
        existing.structs.push(...pkg.structs);
        existing.interfaces.push(...pkg.interfaces);
        existing.functions.push(...pkg.functions);
        existing.imports.push(...pkg.imports);
        existing.sourceFiles.push(...pkg.sourceFiles);
      } else {
        packages.set(key, pkg);
      }
    }

    const packageList = Array.from(packages.values());

    // Match implementations (using gopls if available)
    const allStructs = packageList.flatMap((p) => p.structs);
    const allInterfaces = packageList.flatMap((p) => p.interfaces);
    const implementations = await this.matcher.matchWithGopls(
      allStructs,
      allInterfaces,
      this.goplsClient
    );

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList, implementations);

    return {
      version: '1.0',
      language: 'go',
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
    // Cleanup gopls client
    if (this.goplsClient) {
      try {
        await this.goplsClient.dispose();
      } catch (error) {
        console.warn('Error disposing gopls client:', error);
      }
      this.goplsClient = null;
    }

    this.initialized = false;
  }

  /**
   * Ensure plugin is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GoPlugin not initialized. Call initialize() first.');
    }
  }
}
