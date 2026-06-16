/**
 * Go Language Plugin (merged)
 *
 * Single class implementing both ILanguagePlugin and IGoAtlas.
 * Absorbs all fields and methods from the former GoPlugin and GoAtlasPlugin,
 * fixes the double-parse bug (parseToRawData called exactly once per parseProject),
 * and removes the atlasConfig.enabled === false standard-mode fallback.
 */

import path from 'path';
import fs from 'fs-extra';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  RawTestFile,
} from '@/core/interfaces/language-plugin.js';
import type { TestPatternConfig } from '@/types/extensions/test-analysis.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import { type ArchJSON, ARCHJSON_SCHEMA_VERSION } from '@/types/index.js';
import { GoplsInterfaceResolver } from './gopls-interface-resolver.js';
import { GoParseCoordinator, type GoRawData, type TreeSitterParseOptions } from './go-parse-coordinator.js';
import { DependencyExtractor } from './dependency-extractor.js';
import type {
  GoArchitectureAtlas,
  AtlasConfig,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './atlas/types.js';
import { GoAtlasCoordinator } from './go-atlas-coordinator.js';
import { GoTestAnalyzer } from './go-test-analyzer.js';

// Re-export types for external use
export type { IDependencyExtractor } from '@/core/interfaces/dependency.js';

/**
 * Returns true if a package's fullName indicates it is a test or testutil package.
 * Used to filter test packages from rawData when excludeTests is set.
 *
 * Matches: tests/*, tests, pkg/testutil, pkg/hub/testutil, pkg/hubtest
 */
function isTestPackage(fullName: string): boolean {
  if (fullName.startsWith('tests/') || fullName === 'tests') return true;
  const segs = fullName.split('/');
  if (segs.some((s) => s === 'testutil' || s === 'hubtest')) return true;
  return false;
}

function inferBodyStrategy(
  layers: AtlasLayer[],
  explicit?: 'none' | 'selective' | 'full'
): 'none' | 'selective' | 'full' {
  if (explicit) return explicit;
  const needsBody = layers.some((l) => l === 'goroutine' || l === 'flow');
  return needsBody ? 'selective' : 'none';
}

/**
 * IGoAtlas - Atlas-specific interface (Proposal v5.1 §4.5.2)
 */
export interface IGoAtlas {
  generateAtlas(rootPath: string, options?: AtlasGenerationOptions): Promise<GoArchitectureAtlas>;
  renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer,
    format: RenderFormat
  ): Promise<RenderResult>;
}

/**
 * Go plugin for ArchGuard (merged GoPlugin + GoAtlasPlugin)
 *
 * Uses tree-sitter-go for parsing Go source code and extracting
 * architecture information including structs, interfaces, and
 * implicit interface implementations.
 *
 * Also implements IGoAtlas for generating the four-layer Go Architecture Atlas.
 * Atlas mode is always active when parseProject is called; the double-parse
 * bug from the old composition design is eliminated by calling parseToRawData
 * exactly once per parseProject invocation.
 */
export class GoPlugin implements ILanguagePlugin, IGoAtlas {
  readonly metadata: PluginMetadata = {
    name: 'golang',
    version: '6.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    author: 'ArchGuard Team',
    repository: 'https://github.com/archguard/archguard',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
      testStructureExtraction: true,
    },
  };

  readonly supportedLevels = ['package', 'capability', 'goroutine', 'flow'] as const;

  readonly dependencyExtractor: DependencyExtractor;

  // Parser internals (from former GoPlugin)
  private resolver!: GoplsInterfaceResolver;
  private coordinator!: GoParseCoordinator;
  private initialized = false;
  private workspaceRoot = '';
  private cachedModuleName = '';

  // Atlas + test analysis coordinators
  private atlasCoordinator!: GoAtlasCoordinator;
  private testAnalyzer!: GoTestAnalyzer;

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

    this.resolver = new GoplsInterfaceResolver();
    this.coordinator = new GoParseCoordinator(this.resolver);
    this.atlasCoordinator = new GoAtlasCoordinator();

    this.initialized = true;

    // Cache module name for use in extractTestStructure (import resolution)
    this.cachedModuleName = await this.coordinator.initModuleName(config.workspaceRoot);
    // Initialize gopls resolver (optional — falls back to name-based matching)
    await this.resolver.initialize(config.workspaceRoot);
    this.testAnalyzer = new GoTestAnalyzer(this.cachedModuleName);
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
   * Parse single Go file
   * Note: gopls not used for single file parsing (requires workspace context)
   */
  parseCode(code: string, filePath: string = 'source.go'): ArchJSON {
    this.ensureInitialized();
    return this.coordinator.parseCodeToArchJson(code, filePath, this.cachedModuleName);
  }

  /**
   * Parse multiple Go files
   */
  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    this.ensureInitialized();
    return this.coordinator.parseFileListToArchJson(filePaths, this.cachedModuleName);
  }

  /**
   * Parse entire Go project — THE CRITICAL FIX
   *
   * Calls parseToRawData exactly once. Builds both base ArchJSON and the
   * GoArchitectureAtlas extension from the same rawData, eliminating the
   * double-parse bug present in the old GoAtlasPlugin composition design.
   *
   * Atlas mode is always active; the atlasConfig.enabled === false branch
   * has been removed.
   */
  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    const atlasConfig = config.languageSpecific?.['atlas'] as AtlasConfig | undefined;
    const layers = atlasConfig?.layers ?? ['package', 'capability', 'goroutine', 'flow'];
    const functionBodyStrategy = inferBodyStrategy(layers, atlasConfig?.functionBodyStrategy);

    // Parse ONCE
    const excludePatterns = [
      ...(config.excludePatterns ?? []),
      ...(atlasConfig?.excludePatterns ?? []),
    ];
    const forcedFnNames = (atlasConfig?.entryPoints ?? []).map(
      (ep) => ep.function.split('.').at(-1) ?? ep.function
    );
    let rawData = await this.parseToRawData(workspaceRoot, {
      workspaceRoot,
      includePatterns: config.includePatterns,
      excludePatterns: [
        ...excludePatterns,
        '**/vendor/**',
        '**/testdata/**',
        ...((atlasConfig?.excludeTests ?? true) ? ['**/*_test.go'] : []),
      ],
      extractBodies: functionBodyStrategy !== 'none',
      selectiveExtraction: functionBodyStrategy === 'selective',
      forceExtractFunctions: forcedFnNames.length > 0 ? forcedFnNames : undefined,
    });

    // Filter test packages
    if (atlasConfig?.excludeTests ?? true) {
      rawData = {
        ...rawData,
        packages: rawData.packages.filter((pkg) => !isTestPackage(pkg.fullName)),
      };
    }

    // Build baseArchJSON from rawData (no second parse)
    const base = await this.coordinator.buildArchJson(rawData, workspaceRoot);
    const baseArchJSON: ArchJSON = {
      version: ARCHJSON_SCHEMA_VERSION,
      language: 'go',
      timestamp: new Date().toISOString(),
      ...base,
    };

    // Build Atlas from same rawData (no re-parse)
    const atlas = await this.atlasCoordinator.buildAtlasFromRawData(workspaceRoot, rawData, {
      functionBodyStrategy,
      includeTests: atlasConfig?.includeTests,
      excludeTests: atlasConfig?.excludeTests ?? true,
      includePatterns: config.includePatterns,
      excludePatterns,
      protocols: atlasConfig?.protocols,
      customFrameworks: atlasConfig?.customFrameworks,
      entryPoints: atlasConfig?.entryPoints,
      followIndirectCalls: atlasConfig?.followIndirectCalls,
      entryPointPattern: atlasConfig?.entryPointPattern,
    });

    // Map call relations from the flow graph (must happen after atlas is built)
    const callRelations = this.coordinator.mapCallRelations(atlas?.layers?.flow);

    return {
      ...baseArchJSON,
      relations: [...baseArchJSON.relations, ...callRelations],
      extensions: { goAtlas: atlas },
    };
  }

  /**
   * PUBLIC: Parse project to raw data
   *
   * Public API — called by tests and external tooling.
   * Returns GoRawData (not ArchJSON) to avoid unnecessary mapping.
   * Accepts TreeSitterParseOptions for body extraction control.
   */
  async parseToRawData(
    workspaceRoot: string,
    config: ParseConfig & TreeSitterParseOptions
  ): Promise<GoRawData> {
    this.ensureInitialized();
    this.workspaceRoot = workspaceRoot;
    return this.coordinator.parseToRawData(workspaceRoot, config);
  }

  // ========== IGoAtlas ==========

  /**
   * Generate Go Architecture Atlas from a given root path.
   *
   * This method calls parseToRawData internally and is intended for
   * standalone invocation (not from parseProject, which uses buildAtlasFromRawData
   * to avoid double-parsing).
   */
  async generateAtlas(
    rootPath: string,
    options: AtlasGenerationOptions = {}
  ): Promise<GoArchitectureAtlas> {
    const startTime = performance.now();

    // Get raw data (with body extraction integrated)
    const excludePatterns = [
      ...(options.excludePatterns || []),
      '**/vendor/**',
      '**/testdata/**',
      ...(options.excludeTests ? ['**/*_test.go'] : []),
    ];
    let rawData = await this.parseToRawData(rootPath, {
      workspaceRoot: rootPath,
      includePatterns: options.includePatterns,
      excludePatterns,
      extractBodies: options.functionBodyStrategy !== 'none',
      selectiveExtraction: options.functionBodyStrategy === 'selective',
    });

    // Filter test packages from rawData when excludeTests is set
    if (options.excludeTests) {
      rawData = {
        ...rawData,
        packages: rawData.packages.filter((pkg) => !isTestPackage(pkg.fullName)),
      };
    }

    return this.atlasCoordinator.buildAtlasFromRawData(rootPath, rawData, options, startTime);
  }

  /**
   * Render a specific layer of the atlas.
   */
  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer = 'all',
    format: RenderFormat = 'mermaid'
  ): Promise<RenderResult> {
    return this.atlasCoordinator.renderLayer(atlas, layer, format);
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    await this.resolver.dispose();
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

  isTestFile(filePath: string, patternConfig?: TestPatternConfig): boolean {
    return this.testAnalyzer.isTestFile(filePath, patternConfig);
  }

  extractTestStructure(
    filePath: string,
    code: string,
    patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    return this.testAnalyzer.extractTestStructure(filePath, code, patternConfig);
  }

}

