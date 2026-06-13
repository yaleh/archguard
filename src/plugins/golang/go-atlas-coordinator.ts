import { BehaviorAnalyzer } from './atlas/behavior-analyzer.js';
import { AtlasRenderer } from './atlas/renderers/atlas-renderer.js';
import { GoModResolver } from './atlas/go-mod-resolver.js';
import { FrameworkDetector } from './atlas/framework-detector.js';
import type { GoRawData } from './types.js';
import type {
  GoArchitectureAtlas,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './atlas/types.js';
import { GO_ATLAS_EXTENSION_VERSION } from './atlas/types.js';

export class GoAtlasCoordinator {
  readonly goModResolver: GoModResolver;
  private readonly behaviorAnalyzer: BehaviorAnalyzer;
  private readonly atlasRenderer: AtlasRenderer;

  constructor() {
    this.goModResolver = new GoModResolver();
    this.behaviorAnalyzer = new BehaviorAnalyzer(this.goModResolver);
    this.atlasRenderer = new AtlasRenderer();
  }

  async buildAtlasFromRawData(
    rootPath: string,
    rawData: GoRawData,
    options: AtlasGenerationOptions = {},
    startTime: number = performance.now()
  ): Promise<GoArchitectureAtlas> {
    const moduleInfo = await this.goModResolver.resolveProject(rootPath);
    const detectedFrameworks = new FrameworkDetector().detect(moduleInfo, rawData);

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

    const warnings: string[] = [];
    if (flowGraph.entryPoints.length === 0) {
      warnings.push(
        `Flow graph: no entry points detected. Frameworks found: ${[...detectedFrameworks].join(', ')}. ` +
          `Add 'customFrameworks' or 'entryPoints' to archguard.config.json to configure detection.`
      );
    }

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

  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer = 'all',
    format: RenderFormat = 'mermaid'
  ): Promise<RenderResult> {
    return this.atlasRenderer.render(atlas, layer, format);
  }
}
