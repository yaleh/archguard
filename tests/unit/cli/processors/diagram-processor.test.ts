/**
 * Unit tests for DiagramProcessor
 *
 * TDD test suite for the unified diagram processing component (v2.0 core)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagramProcessor } from '@/cli/processors/diagram-processor.js';
import { PluginRegistry } from '@/core/plugin-registry.js';
import type { ILanguagePlugin } from '@/core/interfaces/index.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import { ProgressReporter } from '@/cli/progress.js';
import type { ArchJSON } from '@/types/index.js';

// Mock dependencies
vi.mock('@/cli/utils/file-discovery-service.js');
vi.mock('@/parser/parallel-parser.js');
vi.mock('@/parser/archjson-aggregator.js');
vi.mock('@/cli/utils/output-path-resolver.js');
vi.mock('@/mermaid/diagram-generator.js');
vi.mock('fs-extra', () => ({
  default: {
    writeJson: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue({}),
    pathExists: vi.fn().mockResolvedValue(false),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock cli-progress for ParallelProgressReporter
vi.mock('cli-progress', () => ({
  MultiBar: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockReturnValue({
      update: vi.fn(),
    }),
    stop: vi.fn(),
  })),
  Presets: {
    shades_classic: {},
  },
}));

describe('DiagramProcessor', () => {
  // Test data
  const createGlobalConfig = (): GlobalConfig => ({
    outputDir: './archguard',
    format: 'mermaid',
    exclude: ['**/*.test.ts'],
    cli: {
      command: 'claude',
      args: [],
      timeout: 180000,
    },
    cache: {
      enabled: true,
      ttl: 3600,
    },
    concurrency: 4,
    verbose: false,
  });

  const createDiagramConfig = (name: string, sources: string[]): DiagramConfig => ({
    name,
    sources,
    level: 'class',
    description: `Test diagram: ${name}`,
  });

  const createTestArchJSON = (): ArchJSON => ({
    version: '1.0',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities: [
      {
        id: 'TestClass',
        name: 'TestClass',
        type: 'class',
        visibility: 'public',
        sourceLocation: {
          file: 'test.ts',
          startLine: 1,
          endLine: 10,
        },
        members: [],
      },
    ],
    relations: [],
  });

  let progress: ProgressReporter;

  beforeEach(() => {
    progress = new ProgressReporter();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create processor with valid options', () => {
      const diagrams = [createDiagramConfig('test', ['./src'])];
      const globalConfig = createGlobalConfig();

      const processor = new DiagramProcessor({
        diagrams,
        globalConfig,
        progress,
      });

      expect(processor).toBeDefined();
    });

    it('should throw error if diagrams array is empty', () => {
      const globalConfig = createGlobalConfig();

      expect(() => {
        new DiagramProcessor({
          diagrams: [],
          globalConfig,
          progress,
        });
      }).toThrow('At least one diagram configuration is required');
    });
  });

  describe('processAll', () => {
    it('should process single diagram successfully', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor
      const diagrams = [createDiagramConfig('test', ['./src'])];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      const results = await processor.processAll();

      // Verify results
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].name).toBe('test');
      expect(results[0].stats).toBeDefined();
      expect(results[0].stats?.entities).toBe(1);
      expect(results[0].stats?.relations).toBe(0);
    });

    it('should process multiple diagrams independently', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi
        .fn()
        .mockReturnValueOnce({
          outputDir: './archguard',
          baseName: 'diagram1',
          paths: {
            mmd: './archguard/diagram1.mmd',
            png: './archguard/diagram1.png',
            svg: './archguard/diagram1.svg',
            json: './archguard/diagram1.json',
          },
        })
        .mockReturnValueOnce({
          outputDir: './archguard',
          baseName: 'diagram2',
          paths: {
            mmd: './archguard/diagram2.mmd',
            png: './archguard/diagram2.png',
            svg: './archguard/diagram2.svg',
            json: './archguard/diagram2.json',
          },
        });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Create processor with multiple diagrams
      const diagrams = [
        createDiagramConfig('diagram1', ['./src/module1']),
        createDiagramConfig('diagram2', ['./src/module2']),
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      const results = await processor.processAll();

      // Verify results
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].name).toBe('diagram1');
      expect(results[1].success).toBe(true);
      expect(results[1].name).toBe('diagram2');
    });

    it('should handle diagram processing failure without affecting others', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockImplementation(({ sources }: { sources: string[] }) => {
        // Fail for module2, succeed for others
        if (sources.includes('./src/module2')) {
          throw new Error('Discovery failed');
        }
        return Promise.resolve(['/src/test.ts']);
      });
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with multiple diagrams
      const diagrams = [
        createDiagramConfig('diagram1', ['./src/module1']),
        createDiagramConfig('diagram2', ['./src/module2']), // This will fail
        createDiagramConfig('diagram3', ['./src/module3']),
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      const results = await processor.processAll();

      // Verify results
      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[0].name).toBe('diagram1');
      expect(results[1].success).toBe(false);
      expect(results[1].name).toBe('diagram2');
      expect(results[1].error).toBe('Discovery failed');
      expect(results[2].success).toBe(true);
      expect(results[2].name).toBe('diagram3');
    });

    it('should correctly apply level aggregation', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with package level
      const diagrams = [
        {
          name: 'test',
          sources: ['./src'],
          level: 'package' as const,
        },
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      await processor.processAll();

      // Verify aggregator was called with 'package' level
      expect(mockAggregate).toHaveBeenCalledWith(expect.any(Object), 'package');
    });

    it('should support different output formats', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor with JSON format
      const diagrams = [
        {
          name: 'test',
          sources: ['./src'],
          level: 'class' as const,
          format: 'json' as const,
        },
      ];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      const results = await processor.processAll();

      // Verify JSON file was written (no PlantUML generation)
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].paths?.json).toBe('./archguard/test.json');
    });

    it('should report detailed statistics', async () => {
      // Mock FileDiscoveryService
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      const testArchJSON = createTestArchJSON();
      testArchJSON.entities = [
        testArchJSON.entities[0],
        { ...testArchJSON.entities[0], id: 'TestClass2', name: 'TestClass2' },
      ];
      testArchJSON.relations = [
        {
          id: 'rel-1',
          type: 'dependency',
          source: 'TestClass',
          target: 'TestClass2',
        },
      ];
      const mockParseFiles = vi.fn().mockResolvedValue(testArchJSON);
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const mockGenerateAndRender = vi.fn().mockResolvedValue(undefined);
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: mockGenerateAndRender,
      }));

      // Create processor
      const diagrams = [createDiagramConfig('test', ['./src'])];
      const globalConfig = createGlobalConfig();
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });

      // Process diagrams
      const results = await processor.processAll();

      // Verify statistics
      expect(results[0].stats).toBeDefined();
      expect(results[0].stats?.entities).toBe(2);
      expect(results[0].stats?.relations).toBe(1);
      expect(results[0].stats?.parseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('PluginRegistry routing', () => {
    const createMockPlugin = (name: string): ILanguagePlugin => ({
      metadata: {
        name,
        version: '1.0.0',
        displayName: `Mock ${name} plugin`,
        fileExtensions: ['.ts'],
        author: 'test',
        minCoreVersion: '1.0.0',
        capabilities: {
          singleFileParsing: false,
          incrementalParsing: false,
          dependencyExtraction: false,
          typeInference: false,
        },
      },
      initialize: vi.fn().mockResolvedValue(undefined),
      parseProject: vi.fn().mockResolvedValue(createTestArchJSON()),
      canHandle: vi.fn().mockReturnValue(true),
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    beforeEach(async () => {
      // Mock OutputPathResolver for these tests
      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      const mockResolve = vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'test',
        paths: {
          mmd: './archguard/test.mmd',
          png: './archguard/test.png',
          svg: './archguard/test.svg',
          json: './archguard/test.json',
        },
      });
      const mockEnsureDirectory = vi.fn().mockResolvedValue(undefined);
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: vi.fn().mockResolvedValue(undefined),
      }));

      // Mock ArchJSONAggregator
      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
      }));
    });

    it('uses registry golang plugin instead of dynamic import for Go diagrams', async () => {
      const mockGoPlugin = createMockPlugin('golang');
      const registry = new PluginRegistry();
      registry.register(mockGoPlugin);

      const diagrams: DiagramConfig[] = [
        {
          name: 'go-test',
          sources: ['./src'],
          level: 'class',
          language: 'go',
        },
      ];

      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
        registry,
      });
      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      expect(mockGoPlugin.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: expect.any(String) })
      );
      expect(mockGoPlugin.parseProject).toHaveBeenCalled();
    });

    it('uses registry typescript plugin for package-level diagrams', async () => {
      const mockTsPlugin = createMockPlugin('typescript');
      const registry = new PluginRegistry();
      registry.register(mockTsPlugin);

      const diagrams: DiagramConfig[] = [
        {
          name: 'ts-package',
          sources: ['./src'],
          level: 'package',
        },
      ];

      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
        registry,
      });
      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      expect(mockTsPlugin.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: expect.any(String) })
      );
      expect(mockTsPlugin.parseProject).toHaveBeenCalled();
    });

    it('falls back gracefully when registry has no plugin for language', async () => {
      // Empty registry — no plugins registered
      const registry = new PluginRegistry();

      // Mock ParallelParser as fallback for non-Go, non-package path
      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: vi.fn().mockResolvedValue(createTestArchJSON()),
      }));
      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
      }));

      // A standard class-level TypeScript diagram (no language field, no package level)
      const diagrams: DiagramConfig[] = [
        {
          name: 'ts-class',
          sources: ['./src'],
          level: 'class',
        },
      ];

      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
        registry,
      });
      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
    });
  });

  describe('DiagramProcessor — metrics integration', () => {
    /**
     * Shared setup: mock all dependencies for a single diagram processed with
     * json format unless overridden.
     */
    const setupMocks = async (opts: {
      format?: 'json' | 'mermaid';
      level?: 'class' | 'package' | 'method';
      archJSON?: ArchJSON;
    } = {}) => {
      const archJSON = opts.archJSON ?? createTestArchJSON();

      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
      }));

      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: vi.fn().mockResolvedValue(archJSON),
      }));

      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      (ArchJSONAggregator as any).mockImplementation(() => ({
        // Return the same reference to simulate 'method'-level pass-through
        aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
      }));

      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: vi.fn().mockReturnValue({
          outputDir: './archguard',
          baseName: 'test',
          paths: {
            mmd: './archguard/test.mmd',
            png: './archguard/test.png',
            svg: './archguard/test.svg',
            json: './archguard/test.json',
          },
        }),
        ensureDirectory: vi.fn().mockResolvedValue(undefined),
      }));

      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      (MermaidDiagramGenerator as any).mockImplementation(() => ({
        generateAndRender: vi.fn().mockResolvedValue(undefined),
      }));

      return archJSON;
    };

    it('json format: output ArchJSON contains metrics field', async () => {
      await setupMocks({ format: 'json' });

      const fs = (await import('fs-extra')).default;
      let writtenData: unknown;
      (fs.writeJson as any).mockImplementation((_path: string, data: unknown) => {
        writtenData = data;
        return Promise.resolve();
      });

      const diagrams = [
        { name: 'test', sources: ['./src'], level: 'class' as const, format: 'json' as const },
      ];
      const processor = new DiagramProcessor({ diagrams, globalConfig: createGlobalConfig(), progress });
      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      expect(writtenData).toBeDefined();
      expect((writtenData as any).metrics).toBeDefined();
    });

    it('json format: metrics.level matches diagram.level', async () => {
      await setupMocks({ format: 'json' });

      const fs = (await import('fs-extra')).default;
      let writtenData: unknown;
      (fs.writeJson as any).mockImplementation((_path: string, data: unknown) => {
        writtenData = data;
        return Promise.resolve();
      });

      const diagrams = [
        { name: 'test', sources: ['./src'], level: 'class' as const, format: 'json' as const },
      ];
      const processor = new DiagramProcessor({ diagrams, globalConfig: createGlobalConfig(), progress });
      await processor.processAll();

      expect((writtenData as any).metrics.level).toBe('class');
    });

    it('json format: metrics.entityCount === aggregatedJSON.entities.length', async () => {
      const archJSON = createTestArchJSON();
      // 1 entity in createTestArchJSON
      await setupMocks({ format: 'json', archJSON });

      const fs = (await import('fs-extra')).default;
      let writtenData: unknown;
      (fs.writeJson as any).mockImplementation((_path: string, data: unknown) => {
        writtenData = data;
        return Promise.resolve();
      });

      const diagrams = [
        { name: 'test', sources: ['./src'], level: 'class' as const, format: 'json' as const },
      ];
      const processor = new DiagramProcessor({ diagrams, globalConfig: createGlobalConfig(), progress });
      await processor.processAll();

      expect((writtenData as any).metrics.entityCount).toBe(archJSON.entities.length);
    });

    it('mermaid format: does not compute metrics, output object has no metrics field', async () => {
      await setupMocks({ format: 'mermaid' });

      const fs = (await import('fs-extra')).default;
      let writtenData: unknown = undefined;
      (fs.writeJson as any).mockImplementation((_path: string, data: unknown) => {
        writtenData = data;
        return Promise.resolve();
      });

      // globalConfig format is 'mermaid' by default; no diagram-level format override
      const diagrams = [
        { name: 'test', sources: ['./src'], level: 'class' as const },
      ];
      const globalConfig = { ...createGlobalConfig(), format: 'mermaid' as const };
      const processor = new DiagramProcessor({ diagrams, globalConfig, progress });
      await processor.processAll();

      // writeJson should NOT have been called for mermaid format
      // (MermaidDiagramGenerator is mocked and doesn't call writeJson)
      // writtenData remains undefined, confirming no JSON was written with metrics
      expect(writtenData).toBeUndefined();
    });

    it('method level: does not mutate rawArchJSON (cached object has no metrics field)', async () => {
      const rawArchJSON = createTestArchJSON();
      await setupMocks({ format: 'json', archJSON: rawArchJSON });

      const fs = (await import('fs-extra')).default;
      (fs.writeJson as any).mockImplementation(() => Promise.resolve());

      const diagrams = [
        { name: 'test', sources: ['./src'], level: 'method' as const, format: 'json' as const },
      ];
      const processor = new DiagramProcessor({ diagrams, globalConfig: createGlobalConfig(), progress });
      await processor.processAll();

      // rawArchJSON must not have been mutated
      expect((rawArchJSON as any).metrics).toBeUndefined();
    });

    it('metrics field does not affect existing DiagramResult.stats values', async () => {
      const archJSON = createTestArchJSON();
      // createTestArchJSON has 1 entity, 0 relations
      await setupMocks({ format: 'json', archJSON });

      const fs = (await import('fs-extra')).default;
      (fs.writeJson as any).mockImplementation(() => Promise.resolve());

      const diagrams = [
        { name: 'test', sources: ['./src'], level: 'class' as const, format: 'json' as const },
      ];
      const processor = new DiagramProcessor({ diagrams, globalConfig: createGlobalConfig(), progress });
      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      expect(results[0].stats?.entities).toBe(archJSON.entities.length);
      expect(results[0].stats?.relations).toBe(archJSON.relations.length);
    });
  });
});
