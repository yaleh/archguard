import type {
  ILanguagePlugin,
  PluginMetadata,
  PluginInitConfig,
} from '@/core/interfaces/language-plugin.js';
import type { ParseConfig } from '@/core/interfaces/parser.js';
import type { IDependencyExtractor } from '@/core/interfaces/dependency.js';
import type { ArchJSON } from '@/types/index.js';
import { GoPlugin } from '../index.js';
import { BehaviorAnalyzer } from './behavior-analyzer.js';
import { AtlasRenderer } from './renderers/atlas-renderer.js';
import { GoModResolver } from './go-mod-resolver.js';
import type {
  GoArchitectureAtlas,
  AtlasConfig,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './types.js';

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
 * Go Architecture Atlas Plugin
 *
 * ARCHITECTURE (ADR-001 v1.2):
 * - Uses COMPOSITION, not inheritance
 * - Delegates standard parsing to GoPlugin via public parseToRawData()
 * - NO bracket hacks (this.goPlugin['treeSitter'])
 * - All GoPlugin internals remain private
 * - Plugin name 'golang' replaces GoPlugin in Registry (Proposal v5.1 §4.5.5)
 * - Atlas config via ParseConfig.languageSpecific.atlas (Proposal v5.1 §4.5.6)
 */
export class GoAtlasPlugin implements ILanguagePlugin, IGoAtlas {
  readonly metadata: PluginMetadata = {
    name: 'golang', // Replaces GoPlugin in Registry (§4.5.5)
    version: '5.0.0',
    displayName: 'Go Architecture Atlas',
    fileExtensions: ['.go'],
    author: 'ArchGuard Team',
    minCoreVersion: '2.0.0',
    capabilities: {
      singleFileParsing: true,
      incrementalParsing: false,
      dependencyExtraction: true,
      typeInference: true,
    },
  };

  // Composed components (ADR-001)
  private goPlugin: GoPlugin;
  private behaviorAnalyzer: BehaviorAnalyzer;
  private atlasRenderer: AtlasRenderer;
  private goModResolver: GoModResolver;

  // Delegated property
  readonly dependencyExtractor: IDependencyExtractor;

  constructor() {
    this.goPlugin = new GoPlugin();
    this.goModResolver = new GoModResolver();
    this.behaviorAnalyzer = new BehaviorAnalyzer(this.goModResolver);
    this.atlasRenderer = new AtlasRenderer();
    this.dependencyExtractor = this.goPlugin.dependencyExtractor;
  }

  // ========== ILanguagePlugin (delegate to GoPlugin) ==========

  async initialize(config: PluginInitConfig): Promise<void> {
    await this.goPlugin.initialize(config);
  }

  canHandle(targetPath: string): boolean {
    return this.goPlugin.canHandle(targetPath);
  }

  parseCode(code: string, filePath?: string): ArchJSON {
    return this.goPlugin.parseCode(code, filePath);
  }

  async parseFiles(filePaths: string[]): Promise<ArchJSON> {
    return this.goPlugin.parseFiles(filePaths);
  }

  async parseProject(workspaceRoot: string, config: ParseConfig): Promise<ArchJSON> {
    // Check Atlas config via languageSpecific (Proposal v5.1 §4.5.6)
    const atlasConfig = config.languageSpecific?.['atlas'] as AtlasConfig | undefined;

    // Standard mode: delegate entirely to GoPlugin
    if (!atlasConfig?.enabled) {
      return this.goPlugin.parseProject(workspaceRoot, config);
    }

    // Atlas mode: get base ArchJSON + generate Atlas extension
    const baseArchJSON = await this.goPlugin.parseProject(workspaceRoot, config);
    const atlas = await this.generateAtlas(workspaceRoot, {
      functionBodyStrategy: atlasConfig.functionBodyStrategy ?? 'selective',
      includeTests: atlasConfig.includeTests,
      excludeTests: atlasConfig.excludeTests,
      excludePatterns: atlasConfig.excludePatterns,
      entryPointTypes: atlasConfig.entryPointTypes,
      followIndirectCalls: atlasConfig.followIndirectCalls,
    });

    return {
      ...baseArchJSON,
      extensions: { goAtlas: atlas },
    };
  }

  // ========== IGoAtlas ==========

  async generateAtlas(
    rootPath: string,
    options: AtlasGenerationOptions = {}
  ): Promise<GoArchitectureAtlas> {
    const startTime = performance.now();

    // 1. Get raw data via GoPlugin public API (with body extraction integrated)
    const excludePatterns = [
      ...(options.excludePatterns || []),
      '**/vendor/**',
      '**/testdata/**',
      ...(options.excludeTests ? ['**/*_test.go'] : []),
    ];
    const rawData = await this.goPlugin.parseToRawData(rootPath, {
      workspaceRoot: rootPath,
      excludePatterns,
      extractBodies: options.functionBodyStrategy !== 'none',
      selectiveExtraction: options.functionBodyStrategy === 'selective',
    });

    // 2. Resolve module info for import classification
    await this.goModResolver.resolveProject(rootPath);

    // 3. Build all four layers in parallel (no second parsing pass needed)
    const [packageGraph, capabilityGraph, goroutineTopology, flowGraph] = await Promise.all([
      this.behaviorAnalyzer.buildPackageGraph(rawData),
      this.behaviorAnalyzer.buildCapabilityGraph(rawData),
      this.behaviorAnalyzer.buildGoroutineTopology(rawData, {
        includeTests: options.includeTests,
      }),
      this.behaviorAnalyzer.buildFlowGraph(rawData, {
        entryPointTypes: options.entryPointTypes,
        followIndirectCalls: options.followIndirectCalls,
      }),
    ]);

    const totalTime = performance.now() - startTime;

    // 4. Return GoAtlasExtension (ADR-002 structure)
    return {
      version: '1.0',
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
          entryPointTypes: options.entryPointTypes ?? [],
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
      },
    };
  }

  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer = 'all',
    format: RenderFormat = 'mermaid'
  ): Promise<RenderResult> {
    return this.atlasRenderer.render(atlas, layer, format);
  }

  async dispose(): Promise<void> {
    await this.goPlugin.dispose();
  }
}
