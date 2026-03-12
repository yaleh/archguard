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
import { glob } from 'glob';
import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
  RawTestFile,
  RawTestCase,
} from '@/core/interfaces/language-plugin.js';
import type { TestPatternConfig } from '@/types/extensions.js';
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
import { BehaviorAnalyzer } from './atlas/behavior-analyzer.js';
import { AtlasRenderer } from './atlas/renderers/atlas-renderer.js';
import { GoModResolver } from './atlas/go-mod-resolver.js';
import { FrameworkDetector } from './atlas/framework-detector.js';
import type {
  GoArchitectureAtlas,
  AtlasConfig,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './atlas/types.js';
import { GO_ATLAS_EXTENSION_VERSION } from './atlas/types.js';

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

  readonly dependencyExtractor: IDependencyExtractor;

  // Parser internals (from former GoPlugin)
  private treeSitter!: TreeSitterBridge;
  private matcher!: InterfaceMatcher;
  private mapper!: ArchJsonMapper;
  private goplsClient: GoplsClient | null = null;
  private initialized = false;
  private workspaceRoot = '';
  private cachedModuleName = '';

  // Atlas internals (from former GoAtlasPlugin)
  private behaviorAnalyzer!: BehaviorAnalyzer;
  private atlasRenderer!: AtlasRenderer;
  private goModResolver!: GoModResolver;

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

    // Atlas components
    this.goModResolver = new GoModResolver();
    this.behaviorAnalyzer = new BehaviorAnalyzer(this.goModResolver);
    this.atlasRenderer = new AtlasRenderer();

    this.initialized = true;

    // Cache module name for use in extractTestStructure (import resolution)
    this.cachedModuleName = await this.readModuleName(config.workspaceRoot);
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
    const allStructs = packageList.flatMap((p) =>
      p.structs.map((s) => ({ ...s, packageName: p.fullName || p.name }))
    );
    const allInterfaces = packageList.flatMap((p) =>
      p.interfaces.map((i) => ({ ...i, packageName: p.fullName || p.name }))
    );
    const implementations = await this.matcher.matchWithGopls(
      allStructs,
      allInterfaces,
      this.goplsClient
    );

    // Map to ArchJSON
    const entities = this.mapper.mapEntities(packageList);
    const relations = this.mapper.mapRelations(packageList, implementations);
    const missingInterfaces = this.mapper.mapMissingInterfaceEntities(
      entities,
      relations,
      packageList
    );
    entities.push(...missingInterfaces);

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
    let rawData = await this.parseToRawData(workspaceRoot, {
      workspaceRoot,
      includePatterns: config.includePatterns,
      excludePatterns: [
        ...excludePatterns,
        '**/vendor/**',
        '**/testdata/**',
        ...(atlasConfig?.excludeTests ?? true ? ['**/*_test.go'] : []),
      ],
      extractBodies: functionBodyStrategy !== 'none',
      selectiveExtraction: functionBodyStrategy === 'selective',
    });

    // Filter test packages
    if (atlasConfig?.excludeTests ?? true) {
      rawData = {
        ...rawData,
        packages: rawData.packages.filter((pkg) => !isTestPackage(pkg.fullName)),
      };
    }

    // Build baseArchJSON from rawData (no second parse)
    const allStructs = rawData.packages.flatMap((p) =>
      p.structs.map((s) => ({ ...s, packageName: p.fullName || p.name }))
    );
    const allInterfaces = rawData.packages.flatMap((p) =>
      p.interfaces.map((i) => ({ ...i, packageName: p.fullName || p.name }))
    );
    const implementations = await this.matcher.matchWithGopls(
      allStructs,
      allInterfaces,
      this.goplsClient
    );
    const entities = this.mapper.mapEntities(rawData.packages);
    const relations = this.mapper.mapRelations(rawData.packages, implementations);
    const missingInterfaces = this.mapper.mapMissingInterfaceEntities(
      entities,
      relations,
      rawData.packages
    );
    entities.push(...missingInterfaces);
    const baseArchJSON: ArchJSON = {
      version: '1.0',
      language: 'go',
      timestamp: new Date().toISOString(),
      sourceFiles: rawData.packages.flatMap((p) => p.sourceFiles),
      workspaceRoot,
      entities,
      relations,
    };

    // Build Atlas from same rawData (no re-parse)
    const atlas = await this.buildAtlasFromRawData(workspaceRoot, rawData, {
      functionBodyStrategy,
      includeTests: atlasConfig?.includeTests,
      excludeTests: atlasConfig?.excludeTests ?? true,
      includePatterns: config.includePatterns,
      excludePatterns,
      protocols: atlasConfig?.protocols,
      customFrameworks: atlasConfig?.customFrameworks,
      entryPoints: atlasConfig?.entryPoints,
      followIndirectCalls: atlasConfig?.followIndirectCalls,
    });

    return { ...baseArchJSON, extensions: { goAtlas: atlas } };
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
    const ignore = ['**/vendor/**', '**/node_modules/**', ...(config.excludePatterns ?? [])];
    const files = config.includePatterns?.length
      ? Array.from(
          new Set(
            (
              await Promise.all(
                config.includePatterns.map((pattern) =>
                  glob(pattern, {
                    cwd: workspaceRoot,
                    absolute: true,
                    ignore,
                  })
                )
              )
            )
              .flat()
              .sort()
          )
        )
      : await glob(config.filePattern ?? '**/*.go', {
          cwd: workspaceRoot,
          absolute: true,
          ignore,
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
        const existing = packages.get(key);
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

    return this.buildAtlasFromRawData(rootPath, rawData, options, startTime);
  }

  /**
   * Render a specific layer of the atlas.
   */
  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer = 'all',
    format: RenderFormat = 'mermaid'
  ): Promise<RenderResult> {
    return this.atlasRenderer.render(atlas, layer, format);
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
   * Build GoArchitectureAtlas from already-parsed rawData.
   *
   * Called by both parseProject (which passes pre-parsed rawData to avoid
   * double-parsing) and generateAtlas (which parses then delegates here).
   */
  private async buildAtlasFromRawData(
    rootPath: string,
    rawData: GoRawData,
    options: AtlasGenerationOptions = {},
    startTime: number = performance.now()
  ): Promise<GoArchitectureAtlas> {
    // Resolve module info for import classification
    const moduleInfo = await this.goModResolver.resolveProject(rootPath);

    // Detect frameworks from module info + raw data
    const detectedFrameworks = new FrameworkDetector().detect(moduleInfo, rawData);

    // Build all four layers in parallel (no second parsing pass needed)
    const [packageGraph, capabilityGraph, goroutineTopology, flowGraph] = await Promise.all([
      this.behaviorAnalyzer.buildPackageGraph(rawData),
      this.behaviorAnalyzer.buildCapabilityGraph(rawData),
      this.behaviorAnalyzer.buildGoroutineTopology(rawData, {
        includeTests: options.includeTests,
      }),
      this.behaviorAnalyzer.buildFlowGraph(rawData, {
        detectedFrameworks,
        protocols: options.protocols,
        customFrameworks: options.customFrameworks,
        entryPoints: options.entryPoints,
        followIndirectCalls: options.followIndirectCalls,
      }),
    ]);

    const totalTime = performance.now() - startTime;

    // Emit warnings when flow graph has no entry points
    const warnings: string[] = [];
    if (flowGraph.entryPoints.length === 0) {
      warnings.push(
        `Flow graph: no entry points detected. Frameworks found: ${[...detectedFrameworks].join(', ')}. ` +
          `Add 'customFrameworks' or 'entryPoints' to archguard.config.json to configure detection.`
      );
    }

    // Return GoAtlasExtension (ADR-002 structure)
    return {
      version: GO_ATLAS_EXTENSION_VERSION,
      layers: {
        package: packageGraph,
        capability: capabilityGraph,
        goroutine: goroutineTopology,
        flow: flowGraph,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        generationStrategy: {
          functionBodyStrategy: options.functionBodyStrategy ?? 'none',
          detectedFrameworks: [...detectedFrameworks],
          protocols: options.protocols,
          followIndirectCalls: options.followIndirectCalls ?? false,
          goplsEnabled: false,
        },
        completeness: {
          package: 1.0,
          capability: 0.85,
          goroutine: options.functionBodyStrategy === 'full' ? 0.7 : 0.5,
          flow: 0.6,
        },
        performance: {
          fileCount: rawData.packages.length,
          parseTime: totalTime,
          totalTime,
          memoryUsage: process.memoryUsage().heapUsed,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  }

  /**
   * Ensure plugin is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GoPlugin not initialized. Call initialize() first.');
    }
  }

  isTestFile(filePath: string, _patternConfig?: TestPatternConfig): boolean {
    return filePath.endsWith('_test.go');
  }

  extractTestStructure(
    filePath: string,
    code: string,
    _patternConfig?: TestPatternConfig
  ): RawTestFile | null {
    if (!this.isTestFile(filePath)) return null;

    // Detect frameworks from import block
    const frameworks: string[] = [];
    const importBlock = code.match(/import\s*\(([^)]*)\)/s)?.[1] ?? '';
    if (/testify\/assert|testify\/require/.test(importBlock)) frameworks.push('testify');
    if (/testing\/quick/.test(importBlock)) frameworks.push('testing/quick');
    if (!frameworks.includes('testify')) frameworks.push('testing'); // stdlib always present for _test.go

    // Extract test functions (Test*, Benchmark*, Example*, Fuzz*)
    const fnRegex = /^func\s+(Test\w*|Benchmark\w*|Example\w*|Fuzz\w*)\s*\(/gm;
    const testCases: RawTestCase[] = [];
    let match: RegExpExecArray | null;
    while ((match = fnRegex.exec(code)) !== null) {
      const name = match[1];
      const isSkipped = new RegExp(`func\\s+${name}[^{]*\\{[^}]*t\\.Skip`, 's').test(code);
      const isBenchmark = name.startsWith('Benchmark');

      // Count assertion calls: assert.*, require.*, t.Error*, t.Fatal*, t.Log*+Fail pattern
      const assertPatterns = [
        /\bassert\.\w+\s*\(/g,
        /\brequire\.\w+\s*\(/g,
        /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/g,
      ];
      let assertionCount = 0;
      for (const pat of assertPatterns) {
        const all = code.match(pat);
        if (all) assertionCount += all.length;
      }

      testCases.push({ name, assertionCount: isBenchmark ? 0 : assertionCount, isSkipped });
    }

    if (testCases.length === 0) return null;

    // Extract imported source files from same module (non-test packages)
    const importedSourceFiles: string[] = [];
    const importLineRegex = /^\s*(?:\w+\s+)?"([^"]+)"/gm;
    while ((match = importLineRegex.exec(importBlock)) !== null) {
      const pkg = match[1];
      // If the import is from this module, strip the module prefix to get the
      // package-relative directory path (e.g. "github.com/org/app/internal/svc" → "internal/svc")
      if (this.cachedModuleName && pkg.startsWith(this.cachedModuleName + '/')) {
        importedSourceFiles.push(pkg.slice(this.cachedModuleName.length + 1));
        continue;
      }
      // Skip stdlib (no slash), testify, and other external packages
      if (!pkg.includes('/') || pkg.startsWith('github.com/') || pkg.startsWith('golang.org/')) {
        continue;
      }
      importedSourceFiles.push(pkg);
    }

    // Infer overall testTypeHint: benchmark functions → performance
    const hasBenchmark = /^func\s+Benchmark\w*\s*\(/m.test(code);
    const testTypeHint: RawTestFile['testTypeHint'] = hasBenchmark ? 'performance' : 'unit';

    return {
      filePath,
      frameworks,
      testTypeHint,
      testCases,
      importedSourceFiles,
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
}
