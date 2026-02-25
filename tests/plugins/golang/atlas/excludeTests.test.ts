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

/** Raw data that contains test PACKAGES (not just test files) */
const rawDataWithTestPackages: GoRawData = {
  packages: [
    {
      id: 'pkg/service',
      name: 'service',
      fullName: 'pkg/service',
      dirPath: '/test/pkg/service',
      sourceFiles: ['service.go'],
      imports: [],
      structs: [{ name: 'Service', fullName: 'pkg/service.Service', fields: [], methods: [] }],
      interfaces: [],
      functions: [],
    },
    {
      id: 'tests/integration',
      name: 'integration',
      fullName: 'tests/integration',
      dirPath: '/test/tests/integration',
      sourceFiles: ['suite.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
    {
      id: 'tests/e2e',
      name: 'e2e',
      fullName: 'tests/e2e',
      dirPath: '/test/tests/e2e',
      sourceFiles: ['e2e.go'],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
    },
    {
      id: 'pkg/testutil',
      name: 'testutil',
      fullName: 'pkg/testutil',
      dirPath: '/test/pkg/testutil',
      sourceFiles: ['helpers.go'],
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

  describe('package-level filtering (tests/* and */testutil)', () => {
    it('removes tests/* packages from rawData when excludeTests is true', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(
        rawDataWithTestPackages
      );

      const atlas = await plugin.generateAtlas('/test', { excludeTests: true });

      // Only pkg/service survives — tests/integration, tests/e2e, pkg/testutil are removed
      expect(atlas.metadata.performance.fileCount).toBe(1);
    });

    it('keeps tests/* packages when excludeTests is false', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(
        rawDataWithTestPackages
      );

      const atlas = await plugin.generateAtlas('/test', { excludeTests: false });

      // All 4 packages survive
      expect(atlas.metadata.performance.fileCount).toBe(4);
    });

    it('keeps tests/* packages when excludeTests is omitted (API default: include)', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(
        rawDataWithTestPackages
      );

      const atlas = await plugin.generateAtlas('/test', {});

      // All 4 packages survive (API-level default is still include)
      expect(atlas.metadata.performance.fileCount).toBe(4);
    });

    it('removes */testutil packages when excludeTests is true', async () => {
      vi.spyOn((plugin as any).goPlugin, 'parseToRawData').mockResolvedValue(
        rawDataWithTestPackages
      );

      const atlas = await plugin.generateAtlas('/test', { excludeTests: true });

      // pkg/testutil is removed along with tests/*
      expect(atlas.metadata.performance.fileCount).toBe(1);
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
