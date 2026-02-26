import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoAtlasPlugin } from '@/plugins/golang/atlas/index.js';
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

const minimalArchJSON = {
  version: '1.1',
  language: 'go' as const,
  timestamp: new Date().toISOString(),
  sourceFiles: [],
  entities: [],
  relations: [],
};

describe('GoAtlasPlugin', () => {
  let plugin: GoAtlasPlugin;

  beforeEach(() => {
    plugin = new GoAtlasPlugin();
  });

  // ---- Metadata and delegation tests ----

  describe('metadata', () => {
    it('metadata.name is "golang"', () => {
      expect(plugin.metadata.name).toBe('golang');
    });

    it('metadata.version is "5.0.0"', () => {
      expect(plugin.metadata.version).toBe('5.0.0');
    });
  });

  describe('canHandle', () => {
    it('delegates canHandle to goPlugin', async () => {
      const goPlugin = (plugin as any).goPlugin;
      const spy = vi.spyOn(goPlugin, 'canHandle').mockReturnValue(true);

      const result = plugin.canHandle('/some/file.go');

      expect(spy).toHaveBeenCalledWith('/some/file.go');
      expect(result).toBe(true);
    });
  });

  // ---- generateAtlas tests ----

  describe('generateAtlas', () => {
    beforeEach(async () => {
      // Mock initialize to avoid real filesystem access
      vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);
      await plugin.initialize({ workspaceRoot: '/test' });

      // Mock parseToRawData to avoid real filesystem access
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(minimalRawData);

      // Mock resolveProject to avoid reading real go.mod
      vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
    });

    it('returns version "1.1"', async () => {
      const atlas = await plugin.generateAtlas('/test');
      expect(atlas.version).toBe('1.1');
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

  // ---- parseProject standard mode tests ----

  describe('parseProject standard mode', () => {
    beforeEach(async () => {
      vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);
      await plugin.initialize({ workspaceRoot: '/test' });

      vi.spyOn((plugin as any).goPlugin, 'parseProject').mockResolvedValue(minimalArchJSON);
    });

    it('no atlas config → standard mode (result has no extensions)', async () => {
      const result = await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        // no languageSpecific
      });

      expect((result as any).extensions).toBeUndefined();
    });

    it('atlas enabled=false → standard mode (result has no extensions)', async () => {
      const result = await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        languageSpecific: {
          atlas: { enabled: false },
        },
      });

      expect((result as any).extensions).toBeUndefined();
    });
  });

  // ---- parseProject atlas mode test ----

  describe('parseProject atlas mode', () => {
    beforeEach(async () => {
      vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);
      await plugin.initialize({ workspaceRoot: '/test' });

      vi.spyOn((plugin as any).goPlugin, 'parseProject').mockResolvedValue(minimalArchJSON);
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(minimalRawData);
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
  });

  // ---- renderLayer test ----

  describe('renderLayer', () => {
    it('delegates to AtlasRenderer and returns RenderResult with format and layer fields', async () => {
      const mockAtlas = {
        version: '1.1',
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
            entryPointTypes: [],
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
