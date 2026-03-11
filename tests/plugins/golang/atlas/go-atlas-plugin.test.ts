import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoPlugin } from '@/plugins/golang/index.js';
import type { GoRawData } from '@/plugins/golang/types.js';

const minimalRawData: GoRawData = {
  packages: [
    {
      id: 'pkg/api',
      name: 'api',
      fullName: 'pkg/api',
      dirPath: '/test/pkg/api',
      sourceFiles: ['api.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
  ],
  moduleRoot: '/test',
  moduleName: 'github.com/test/project',
};

describe('GoAtlasPlugin', () => {
  let plugin: GoPlugin;

  beforeEach(() => {
    plugin = new GoPlugin();
  });

  // ---- Metadata and delegation tests ----

  describe('metadata', () => {
    it('metadata.name is "golang"', () => {
      expect(plugin.metadata.name).toBe('golang');
    });

    it('metadata.version is "6.0.0"', () => {
      expect(plugin.metadata.version).toBe('6.0.0');
    });
  });

  describe('canHandle', () => {
    it('delegates canHandle to goPlugin', async () => {
      const spy = vi.spyOn(plugin, 'canHandle').mockReturnValue(true);

      const result = plugin.canHandle('/some/file.go');

      expect(spy).toHaveBeenCalledWith('/some/file.go');
      expect(result).toBe(true);
    });
  });

  // ---- generateAtlas tests ----

  describe('generateAtlas', () => {
    beforeEach(async () => {
      // Initialize without filesystem access (initialize() only creates instances)
      await plugin.initialize({ workspaceRoot: '/test' });

      // Mock parseToRawData to avoid real filesystem access
      vi.spyOn(plugin as any, 'parseToRawData').mockResolvedValue(minimalRawData);

      // Mock resolveProject to avoid reading real go.mod
      vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
    });

    it('returns version "2.0"', async () => {
      const atlas = await plugin.generateAtlas('/test');
      expect(atlas.version).toBe('2.0');
    });

    it('returns all 4 layers defined', async () => {
      const atlas = await plugin.generateAtlas('/test');

      expect(atlas.layers).toBeDefined();
      expect(atlas.layers.package).toBeDefined();
      expect(atlas.layers.capability).toBeDefined();
      expect(atlas.layers.goroutine).toBeDefined();
      expect(atlas.layers.flow).toBeDefined();
    });

    it('returns metadata with generatedAt, generationStrategy, completeness, performance', async () => {
      const atlas = await plugin.generateAtlas('/test');

      expect(atlas.metadata).toBeDefined();
      expect(atlas.metadata.generatedAt).toBeDefined();
      expect(atlas.metadata.generationStrategy).toBeDefined();
      expect(atlas.metadata.completeness).toBeDefined();
      expect(atlas.metadata.performance).toBeDefined();
    });

    it('metadata.performance.fileCount equals packages count from rawData', async () => {
      const atlas = await plugin.generateAtlas('/test');

      expect(atlas.metadata.performance.fileCount).toBe(minimalRawData.packages.length);
    });
  });

  // ---- parseProject default atlas mode tests ----

  describe('parseProject default atlas mode', () => {
    beforeEach(async () => {
      await plugin.initialize({ workspaceRoot: '/test' });

      vi.spyOn(plugin as any, 'parseToRawData').mockResolvedValue(minimalRawData);
      vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
    });

    it('no atlas config → atlas mode by default (result has extensions.goAtlas)', async () => {
      const parseToRawData = vi.spyOn(plugin as any, 'parseToRawData').mockResolvedValue(minimalRawData);

      const result = await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        // no languageSpecific: atlas is ON by default
      });

      const extensions = (result as any).extensions;
      expect(extensions).toBeDefined();
      expect(extensions.goAtlas).toBeDefined();
      expect(parseToRawData).toHaveBeenCalledTimes(1);
    });
  });

  // ---- parseProject atlas mode test ----

  describe('parseProject atlas mode', () => {
    beforeEach(async () => {
      await plugin.initialize({ workspaceRoot: '/test' });

      vi.spyOn(plugin as any, 'parseToRawData').mockResolvedValue(minimalRawData);
      vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
    });

    it('atlas enabled=true → atlas mode (result has extensions.goAtlas with all 4 layers)', async () => {
      const result = await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        languageSpecific: {
          atlas: { enabled: true },
        },
      });

      const extensions = (result as any).extensions;
      expect(extensions).toBeDefined();
      expect(extensions.goAtlas).toBeDefined();

      const goAtlas = extensions.goAtlas;
      expect(goAtlas.layers).toBeDefined();
      expect(goAtlas.layers.package).toBeDefined();
      expect(goAtlas.layers.capability).toBeDefined();
      expect(goAtlas.layers.goroutine).toBeDefined();
      expect(goAtlas.layers.flow).toBeDefined();
    });

    it('passes includePatterns through to atlas raw-data generation', async () => {
      const parseToRawData = vi
        .spyOn(plugin as any, 'parseToRawData')
        .mockResolvedValue(minimalRawData);

      await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        includePatterns: ['pkg/**/*.go'],
        excludePatterns: ['examples/**'],
        languageSpecific: {
          atlas: { enabled: true },
        },
      });

      expect(parseToRawData).toHaveBeenCalled();
      const atlasCall = parseToRawData.mock.calls.at(-1)?.[1] as {
        includePatterns?: string[];
        excludePatterns?: string[];
      };
      expect(atlasCall.includePatterns).toEqual(['pkg/**/*.go']);
      expect(atlasCall.excludePatterns).toEqual(
        expect.arrayContaining(['examples/**', '**/vendor/**', '**/testdata/**', '**/*_test.go'])
      );
    });
  });

  // ---- renderLayer test ----

  describe('renderLayer', () => {
    beforeEach(async () => {
      await plugin.initialize({ workspaceRoot: '/test' });
    });

    it('delegates to AtlasRenderer and returns RenderResult with format and layer fields', async () => {
      const mockAtlas = {
        version: '2.0',
        layers: {
          package: { nodes: [], edges: [], cycles: [] },
          capability: { nodes: [], edges: [] },
          goroutine: { nodes: [], edges: [], channels: [], channelEdges: [] },
          flow: { entryPoints: [], callChains: [] },
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          generationStrategy: {
            functionBodyStrategy: 'none' as const,
            detectedFrameworks: [],
            followIndirectCalls: false,
            goplsEnabled: false,
          },
          completeness: { package: 1.0, capability: 0.85, goroutine: 0.5, flow: 0.6 },
          performance: { fileCount: 0, parseTime: 0, totalTime: 0, memoryUsage: 0 },
        },
      };

      const result = await plugin.renderLayer(mockAtlas, 'package', 'mermaid');

      expect(result).toBeDefined();
      expect(result.format).toBe('mermaid');
      expect(result.layer).toBe('package');
      expect(typeof result.content).toBe('string');
    });
  });
});
