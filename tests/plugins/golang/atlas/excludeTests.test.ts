import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoAtlasPlugin } from '@/plugins/golang/atlas/index.js';
import type { GoRawData } from '@/plugins/golang/types.js';

/** Raw data that includes a mix of production and test source files */
const rawDataWithTestFiles: GoRawData = {
  packages: [
    {
      id: 'pkg/service',
      name: 'service',
      fullName: 'pkg/service',
      dirPath: '/test/pkg/service',
      sourceFiles: ['service.go', 'service_test.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
    {
      id: 'pkg/handler',
      name: 'handler',
      fullName: 'pkg/handler',
      dirPath: '/test/pkg/handler',
      sourceFiles: ['handler.go', 'handler_test.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
  ],
  moduleRoot: '/test',
  moduleName: 'github.com/test/project',
};

/** Raw data that contains only production source files (no test files) */
const rawDataWithoutTestFiles: GoRawData = {
  packages: [
    {
      id: 'pkg/service',
      name: 'service',
      fullName: 'pkg/service',
      dirPath: '/test/pkg/service',
      sourceFiles: ['service.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
    {
      id: 'pkg/handler',
      name: 'handler',
      fullName: 'pkg/handler',
      dirPath: '/test/pkg/handler',
      sourceFiles: ['handler.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
  ],
  moduleRoot: '/test',
  moduleName: 'github.com/test/project',
};

describe('GoAtlasPlugin – excludeTests filter', () => {
  let plugin: GoAtlasPlugin;

  beforeEach(async () => {
    plugin = new GoAtlasPlugin();

    vi.spyOn((plugin as any).goPlugin, 'initialize').mockResolvedValue(undefined);
    await plugin.initialize({ workspaceRoot: '/test' });

    // Mock resolveProject to avoid reading real go.mod
    vi.spyOn((plugin as any).goModResolver, 'resolveProject').mockResolvedValue(undefined);
  });

  describe('excludeTests: false (default behaviour)', () => {
    it('does NOT add **/*_test.go to excludePatterns when excludeTests is false', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithTestFiles);

      await plugin.generateAtlas('/test', { excludeTests: false });

      expect(parseToRawData).toHaveBeenCalledOnce();
      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).not.toContain('**/*_test.go');
    });

    it('does NOT add **/*_test.go to excludePatterns when excludeTests is omitted', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithTestFiles);

      await plugin.generateAtlas('/test', {});

      expect(parseToRawData).toHaveBeenCalledOnce();
      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).not.toContain('**/*_test.go');
    });

    it('rawData returned by parseToRawData may include test files when excludeTests is false', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(rawDataWithTestFiles);

      const atlas = await plugin.generateAtlas('/test', { excludeTests: false });

      // fileCount is derived from packages count in rawData
      expect(atlas.metadata.performance.fileCount).toBe(rawDataWithTestFiles.packages.length);
    });
  });

  describe('excludeTests: true', () => {
    it('adds **/*_test.go to excludePatterns when excludeTests is true', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithoutTestFiles);

      await plugin.generateAtlas('/test', { excludeTests: true });

      expect(parseToRawData).toHaveBeenCalledOnce();
      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).toContain('**/*_test.go');
    });

    it('still keeps default vendor/testdata patterns when excludeTests is true', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithoutTestFiles);

      await plugin.generateAtlas('/test', { excludeTests: true });

      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).toContain('**/vendor/**');
      expect(callArgs.excludePatterns).toContain('**/testdata/**');
    });

    it('merges caller-supplied excludePatterns with test-file pattern', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithoutTestFiles);

      await plugin.generateAtlas('/test', {
        excludeTests: true,
        excludePatterns: ['**/generated/**'],
      });

      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).toContain('**/generated/**');
      expect(callArgs.excludePatterns).toContain('**/*_test.go');
      expect(callArgs.excludePatterns).toContain('**/vendor/**');
    });

    it('rawData used for atlas reflects what parseToRawData returns (test-free data)', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(
        rawDataWithoutTestFiles
      );

      const atlas = await plugin.generateAtlas('/test', { excludeTests: true });

      expect(atlas.metadata.performance.fileCount).toBe(rawDataWithoutTestFiles.packages.length);
    });
  });

  describe('AtlasConfig.excludeTests wired via parseProject', () => {
    const minimalArchJSON = {
      version: '1.0',
      language: 'go' as const,
      timestamp: new Date().toISOString(),
      sourceFiles: [],
      entities: [],
      relations: [],
    };

    beforeEach(() => {
      vi.spyOn((plugin as any).goPlugin, 'parseProject').mockResolvedValue(minimalArchJSON);
    });

    it('passes excludeTests: true from AtlasConfig through to generateAtlas', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithoutTestFiles);

      await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        languageSpecific: {
          atlas: { enabled: true, excludeTests: true },
        },
      });

      expect(parseToRawData).toHaveBeenCalledOnce();
      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).toContain('**/*_test.go');
    });

    it('does NOT add test-file pattern when AtlasConfig.excludeTests is false', async () => {
      const parseToRawData = vi
        .spyOn((plugin as any).goPlugin, 'parseToRawData')
        .mockResolvedValue(rawDataWithTestFiles);

      await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        languageSpecific: {
          atlas: { enabled: true, excludeTests: false },
        },
      });

      expect(parseToRawData).toHaveBeenCalledOnce();
      const callArgs = parseToRawData.mock.calls[0][1] as { excludePatterns?: string[] };
      expect(callArgs.excludePatterns).not.toContain('**/*_test.go');
    });

    it('result has extensions.goAtlas when atlas is enabled with excludeTests', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(
        rawDataWithoutTestFiles
      );

      const result = await plugin.parseProject('/test', {
        workspaceRoot: '/test',
        languageSpecific: {
          atlas: { enabled: true, excludeTests: true },
        },
      });

      const extensions = (result as any).extensions;
      expect(extensions).toBeDefined();
      expect(extensions.goAtlas).toBeDefined();
      expect(extensions.goAtlas.layers).toBeDefined();
    });
  });
});
