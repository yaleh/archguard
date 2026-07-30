/**
 * Tests for GoAtlasAdapter — Phase A (TASK-27)
 *
 * Verifies:
 * 1. generateAtlas() calls GoPlugin.parseToRawData() exactly once
 * 2. renderLayer() delegates to GoAtlasCoordinator.renderLayer()
 * 3. parseProject() double-parse protection: parseToRawData called exactly once
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nativeParserBackend } from '@/plugins/shared/native-parser-backend.js';
import { GoPlugin } from '@/plugins/golang/index.js';
import type { GoRawData } from '@/plugins/golang/types.js';

const FAKE_RAW_DATA: GoRawData = {
  packages: [],
  moduleRoot: '/tmp',
  moduleName: 'github.com/test/project',
  implementations: [],
};

const FAKE_ARCH_JSON_BASE = {
  entities: [],
  relations: [],
};

const FAKE_ATLAS = {
  version: '1.0.0',
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
      protocols: undefined,
      followIndirectCalls: false,
      goplsEnabled: false,
    },
    completeness: { package: 1, capability: 1, goroutine: 1, flow: 1 },
    performance: { fileCount: 0, parseTime: 0, totalTime: 0, memoryUsage: 0 },
  },
};

describe('GoAtlasAdapter', () => {
  let plugin: GoPlugin;

  beforeEach(async () => {
    plugin = new GoPlugin(nativeParserBackend);
    await plugin.initialize({ workspaceRoot: '/tmp' });
  });

  describe('generateAtlas() — parseToRawData call count', () => {
    it('calls parseToRawData exactly once per generateAtlas() invocation', async () => {
      const spy = vi.spyOn(plugin, 'parseToRawData').mockResolvedValue(FAKE_RAW_DATA);
      vi.spyOn((plugin as any).atlasCoordinator, 'buildAtlasFromRawData').mockResolvedValue(
        FAKE_ATLAS
      );

      await plugin.generateAtlas('/tmp', { excludeTests: true });

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('each separate generateAtlas() call invokes parseToRawData exactly once', async () => {
      const spy = vi.spyOn(plugin, 'parseToRawData').mockResolvedValue(FAKE_RAW_DATA);
      vi.spyOn((plugin as any).atlasCoordinator, 'buildAtlasFromRawData').mockResolvedValue(
        FAKE_ATLAS
      );

      await plugin.generateAtlas('/tmp');
      expect(spy).toHaveBeenCalledTimes(1);

      await plugin.generateAtlas('/tmp');
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('renderLayer() — delegation to atlasCoordinator', () => {
    it('returns a RenderResult with the expected shape', async () => {
      const result = await plugin.renderLayer(FAKE_ATLAS as any, 'package', 'mermaid');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('format');
      expect(result).toHaveProperty('layer');
      expect(result.format).toBe('mermaid');
      expect(result.layer).toBe('package');
    });

    it('delegates to atlasCoordinator.renderLayer()', async () => {
      const coordinatorSpy = vi
        .spyOn((plugin as any).atlasCoordinator, 'renderLayer')
        .mockResolvedValue({ content: 'mocked', format: 'mermaid', layer: 'flow' });

      const result = await plugin.renderLayer(FAKE_ATLAS as any, 'flow', 'mermaid');
      expect(coordinatorSpy).toHaveBeenCalledTimes(1);
      expect(coordinatorSpy).toHaveBeenCalledWith(FAKE_ATLAS, 'flow', 'mermaid');
      expect(result.content).toBe('mocked');
    });
  });

  describe('parseProject() — double-parse protection', () => {
    it('calls parseToRawData exactly once per parseProject() invocation', async () => {
      const spy = vi.spyOn(plugin, 'parseToRawData').mockResolvedValue(FAKE_RAW_DATA);
      vi.spyOn((plugin as any).coordinator, 'buildArchJson').mockResolvedValue(FAKE_ARCH_JSON_BASE);
      vi.spyOn((plugin as any).coordinator, 'mapCallRelations').mockReturnValue([]);
      vi.spyOn((plugin as any).atlasCoordinator, 'buildAtlasFromRawData').mockResolvedValue(
        FAKE_ATLAS
      );

      await plugin.parseProject('/tmp', {
        workspaceRoot: '/tmp',
        includePatterns: [],
        excludePatterns: [],
      });

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
