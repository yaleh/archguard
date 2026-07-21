import { GoAtlasCoordinator } from './go-atlas-coordinator.js';
import type {
  GoArchitectureAtlas,
  AtlasGenerationOptions,
  AtlasLayer,
  RenderFormat,
  RenderResult,
} from './atlas/types.js';
import type { GoPlugin } from './index.js';

function isTestPackage(fullName: string): boolean {
  if (fullName.startsWith('tests/') || fullName === 'tests') return true;
  const segs = fullName.split('/');
  if (segs.some((s) => s === 'testutil' || s === 'hubtest')) return true;
  return false;
}

function inferBodyStrategy(
  explicit?: 'none' | 'selective' | 'full'
): 'none' | 'selective' | 'full' {
  return explicit ?? 'none';
}

/**
 * GoAtlasAdapter — composition adapter for GoPlugin's IGoAtlas surface.
 *
 * Owns the `generateAtlas()` and `renderLayer()` implementations that were
 * previously inlined in GoPlugin, keeping GoPlugin focused on ILanguagePlugin.
 * GoPlugin proxies both methods to this adapter; the IGoAtlas interface contract
 * is preserved externally (GoPlugin still implements IGoAtlas).
 *
 * ADR-001 constraint: parseToRawData is called exactly once per generateAtlas()
 * invocation via plugin.parseToRawData() (the public API). Never calls
 * parseProject() internally — that path calls buildAtlasFromRawData directly
 * to avoid double-parse.
 */
export class GoAtlasAdapter {
  constructor(
    private readonly plugin: GoPlugin,
    private readonly atlasCoordinator: GoAtlasCoordinator
  ) {}

  async generateAtlas(
    rootPath: string,
    options: AtlasGenerationOptions = {}
  ): Promise<GoArchitectureAtlas> {
    const startTime = performance.now();

    const excludePatterns = [
      ...(options.excludePatterns || []),
      '**/vendor/**',
      '**/testdata/**',
      ...(options.excludeTests ? ['**/*_test.go'] : []),
    ];

    const functionBodyStrategy = inferBodyStrategy(options.functionBodyStrategy);

    let rawData = await this.plugin.parseToRawData(rootPath, {
      workspaceRoot: rootPath,
      includePatterns: options.includePatterns,
      excludePatterns,
      extractBodies: functionBodyStrategy !== 'none',
      selectiveExtraction: functionBodyStrategy === 'selective',
    });

    if (options.excludeTests) {
      rawData = {
        ...rawData,
        packages: rawData.packages.filter((pkg) => !isTestPackage(pkg.fullName)),
      };
    }

    return this.atlasCoordinator.buildAtlasFromRawData(rootPath, rawData, options, startTime);
  }

  async renderLayer(
    atlas: GoArchitectureAtlas,
    layer: AtlasLayer = 'all',
    format: RenderFormat = 'mermaid'
  ): Promise<RenderResult> {
    return this.atlasCoordinator.renderLayer(atlas, layer, format);
  }
}
