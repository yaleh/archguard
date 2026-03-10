/**
 * Unit tests for DiagramProcessor
 *
 * TDD test suite for the unified diagram processing component (v2.0 core)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagramProcessor, deriveSubModuleArchJSON } from '@/cli/processors/diagram-processor.js';
import { PluginRegistry } from '@/core/plugin-registry.js';
import type { ILanguagePlugin } from '@/core/interfaces/index.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import { ProgressReporter } from '@/cli/progress.js';
import type { ArchJSON } from '@/types/index.js';

// Mock os so we can control cpus() in pool-size tests
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: {
      ...actual,
      cpus: vi.fn(() => actual.cpus()),
    },
  };
});

// Mock dependencies
vi.mock('@/cli/utils/file-discovery-service.js');
vi.mock('@/parser/parallel-parser.js');
vi.mock('@/parser/archjson-aggregator.js');
vi.mock('@/cli/utils/output-path-resolver.js');
vi.mock('@/mermaid/diagram-generator.js');
vi.mock('@/plugins/golang/source-scope.js', () => ({
  planGoAnalysisScope: vi.fn().mockResolvedValue({
    workspaceRoot: '/project',
    includePatterns: ['src/**/*.go'],
    excludePatterns: [],
  }),
}));

// Mock ArchJsonDiskCache so disk I/O is skipped in unit tests
vi.mock('@/cli/cache/arch-json-disk-cache.js', () => ({
  ArchJsonDiskCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    computeKey: vi.fn().mockResolvedValue('mock-disk-cache-key'),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock RenderHashCache so render sidecar files are never touched in unit tests
vi.mock('@/cli/cache/render-hash-cache.js', () => ({
  RenderHashCache: vi.fn().mockImplementation(() => ({
    checkHit: vi.fn().mockResolvedValue(false), // always miss → always render
    writeHash: vi.fn().mockResolvedValue(undefined),
    clearHashes: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock render-worker-pool so DiagramProcessor can be instantiated without workers
vi.mock('@/mermaid/render-worker-pool.js', () => ({
  MermaidRenderWorkerPool: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 100 100"/>' }),
    terminate: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock AtlasRenderer for Go Atlas diagram tests
vi.mock('@/plugins/golang/atlas/renderers/atlas-renderer.js', () => ({
  AtlasRenderer: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockResolvedValue({ content: 'flowchart LR\n  A --> B', format: 'mermaid' }),
  })),
}));
vi.mock('fs-extra', () => ({
  default: {
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue({}),
    pathExists: vi.fn().mockResolvedValue(false),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/mermaid/ts-module-graph-renderer.js', () => ({
  renderTsModuleGraph: vi.fn().mockReturnValue('flowchart LR\n  A --> B'),
}));

vi.mock('@/mermaid/renderer.js', () => ({
  inlineEdgeStyles: vi.fn().mockImplementation((svg: string) => svg),
  IsomorphicMermaidRenderer: vi.fn().mockImplementation(() => ({
    renderSVG: vi.fn().mockResolvedValue('<svg/>'),
    renderPNG: vi.fn().mockResolvedValue(undefined),
    convertSVGToPNG: vi.fn().mockResolvedValue(undefined),
  })),
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

describe('deriveSubModuleArchJSON', () => {
  it('filters entities by filePath prefix', () => {
    const parent = {
      version: '1.0',
      language: 'typescript' as const,
      timestamp: '',
      sourceFiles: [],
      entities: [
        { id: 'e1', name: 'A', type: 'class' as const, filePath: '/src/core/a.ts' },
        { id: 'e2', name: 'B', type: 'class' as const, filePath: '/src/shared/b.ts' },
        { id: 'e3', name: 'C', type: 'class' as const, filePath: '/src/core/c.ts' },
      ],
      relations: [
        { source: 'e1', target: 'e2', type: 'dependency' as const },
        { source: 'e1', target: 'e3', type: 'dependency' as const },
        { source: 'e2', target: 'e3', type: 'dependency' as const },
      ],
    };
    const result = deriveSubModuleArchJSON(parent as unknown as ArchJSON, '/src/core');
    // e1, e3 are in sub-module; e2 is a cross-module stub (target of e1→e2)
    expect(result.entities.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
    // e1→e2 (cross-module outgoing) + e1→e3 (intra-module); e2→e3 excluded (e2 not in sub-module)
    expect(result.relations).toHaveLength(2);
    expect(result.relations).toContainEqual(
      expect.objectContaining({ source: 'e1', target: 'e3' })
    );
    expect(result.relations).toContainEqual(
      expect.objectContaining({ source: 'e1', target: 'e2' })
    );
  });

  it('filters moduleGraph nodes and edges by path prefix', () => {
    const parent = {
      version: '1.0',
      language: 'typescript' as const,
      timestamp: '',
      sourceFiles: [],
      entities: [],
      relations: [],
      extensions: {
        tsAnalysis: {
          version: '1.0',
          moduleGraph: {
            nodes: [
              {
                id: 'src/core',
                name: 'core',
                type: 'internal' as const,
                fileCount: 2,
                stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
              },
              {
                id: 'src/shared',
                name: 'shared',
                type: 'internal' as const,
                fileCount: 1,
                stats: { classes: 0, interfaces: 0, functions: 1, enums: 0 },
              },
            ],
            edges: [{ from: 'src/core', to: 'src/shared', strength: 1, importedNames: [] }],
            cycles: [],
          },
        },
      },
    };
    const result = deriveSubModuleArchJSON(parent as unknown as ArchJSON, '/abs/path/src/core');
    const mg = result.extensions?.tsAnalysis?.moduleGraph;
    expect(mg?.nodes).toHaveLength(1);
    expect(mg?.nodes[0].id).toBe('src/core');
    expect(mg?.edges).toHaveLength(0);
  });

  it('preserves non-moduleGraph extension fields', () => {
    const parent = {
      version: '1.0',
      language: 'typescript' as const,
      timestamp: '',
      sourceFiles: [],
      entities: [],
      relations: [],
      extensions: {
        tsAnalysis: { version: '1.0', moduleGraph: { nodes: [], edges: [], cycles: [] } },
      },
    };
    const result = deriveSubModuleArchJSON(parent as unknown as ArchJSON, '/src');
    expect(result.version).toBe('1.0');
    expect(result.extensions?.tsAnalysis).toBeDefined();
  });

  it('returns empty entities and relations when no filePath matches', () => {
    const parent = {
      version: '1.0',
      language: 'typescript' as const,
      timestamp: '',
      sourceFiles: [],
      entities: [{ id: 'e1', name: 'A', type: 'class' as const, filePath: '/src/core/a.ts' }],
      relations: [],
    };
    const result = deriveSubModuleArchJSON(parent as unknown as ArchJSON, '/src/other');
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('includes cross-module relations when source is in sub-module', () => {
    const parent: ArchJSON = {
      version: '1.0',
      language: 'cpp',
      timestamp: '',
      sourceFiles: [],
      entities: [
        {
          id: 'src.Renderer',
          name: 'Renderer',
          type: 'class',
          visibility: 'public',
          members: [{ name: 'ctx', type: 'field', visibility: 'public' }],
          sourceLocation: { file: '/proj/src/renderer.h', startLine: 1, endLine: 10 },
        },
        {
          id: 'ggml.ggml_context',
          name: 'ggml_context',
          type: 'struct',
          visibility: 'public',
          members: [{ name: 'mem_size', type: 'field', visibility: 'public' }],
          sourceLocation: { file: '/proj/ggml/ggml.h', startLine: 1, endLine: 20 },
        },
      ],
      relations: [
        {
          id: 'r1',
          type: 'composition',
          source: 'src.Renderer',
          target: 'ggml.ggml_context',
          inferenceSource: 'explicit',
        },
      ],
    };
    const derived = deriveSubModuleArchJSON(parent, '/proj/src');

    // The relation should be included (source is in sub-module)
    expect(derived.relations).toHaveLength(1);
    expect(derived.relations[0].source).toBe('src.Renderer');
    expect(derived.relations[0].target).toBe('ggml.ggml_context');
  });

  it('adds stub entity for cross-module relation target', () => {
    const parent: ArchJSON = {
      version: '1.0',
      language: 'cpp',
      timestamp: '',
      sourceFiles: [],
      entities: [
        {
          id: 'src.Renderer',
          name: 'Renderer',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/proj/src/renderer.h', startLine: 1, endLine: 10 },
        },
        {
          id: 'ggml.ggml_context',
          name: 'ggml_context',
          type: 'struct',
          visibility: 'public',
          members: [
            { name: 'mem_size', type: 'field', visibility: 'public' },
            { name: 'alloc', type: 'field', visibility: 'public' },
          ],
          sourceLocation: { file: '/proj/ggml/ggml.h', startLine: 1, endLine: 20 },
        },
      ],
      relations: [
        {
          id: 'r1',
          type: 'composition',
          source: 'src.Renderer',
          target: 'ggml.ggml_context',
          inferenceSource: 'explicit',
        },
      ],
    };
    const derived = deriveSubModuleArchJSON(parent, '/proj/src');

    // Both entities appear in derived ArchJSON (Renderer as full, ggml_context as stub)
    expect(derived.entities).toHaveLength(2);
    const stub = derived.entities.find((e) => e.id === 'ggml.ggml_context');
    expect(stub).toBeDefined();
    expect(stub.members).toHaveLength(0); // stub has no members

    // Original in sub-module entity is unchanged
    const renderer = derived.entities.find((e) => e.id === 'src.Renderer');
    expect(renderer).toBeDefined();
  });

  it('does not add stub for intra-module relations (already in entity set)', () => {
    const parent: ArchJSON = {
      version: '1.0',
      language: 'cpp',
      timestamp: '',
      sourceFiles: [],
      entities: [
        {
          id: 'src.A',
          name: 'A',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/proj/src/a.h', startLine: 1, endLine: 5 },
        },
        {
          id: 'src.B',
          name: 'B',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/proj/src/b.h', startLine: 1, endLine: 5 },
        },
      ],
      relations: [
        {
          id: 'r1',
          type: 'dependency',
          source: 'src.A',
          target: 'src.B',
          inferenceSource: 'explicit',
        },
      ],
    };
    const derived = deriveSubModuleArchJSON(parent, '/proj/src');

    // Only 2 entities (no stub needed since both are in sub-module)
    expect(derived.entities).toHaveLength(2);
    expect(derived.relations).toHaveLength(1);
  });

  it('does not include relations where source is outside sub-module', () => {
    // Relations FROM other modules TO this module's entities should NOT appear
    // (only outgoing are included to keep diagram focused on THIS module's dependencies)
    const parent: ArchJSON = {
      version: '1.0',
      language: 'cpp',
      timestamp: '',
      sourceFiles: [],
      entities: [
        {
          id: 'src.Base',
          name: 'Base',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/proj/src/base.h', startLine: 1, endLine: 5 },
        },
        {
          id: 'tools.Derived',
          name: 'Derived',
          type: 'class',
          visibility: 'public',
          members: [],
          sourceLocation: { file: '/proj/tools/derived.h', startLine: 1, endLine: 5 },
        },
      ],
      relations: [
        {
          id: 'r1',
          type: 'inheritance',
          source: 'tools.Derived',
          target: 'src.Base',
          inferenceSource: 'explicit',
        },
      ],
    };
    // Derive the src sub-module
    const derived = deriveSubModuleArchJSON(parent, '/proj/src');

    // src.Base is in sub-module but the relation source (tools.Derived) is NOT
    // So the relation should NOT appear in the src sub-module diagram
    expect(derived.relations).toHaveLength(0);
    // src.Base appears as normal entity
    expect(derived.entities).toHaveLength(1);
    expect(derived.entities[0].id).toBe('src.Base');
  });
});

describe('deriveSubModuleArchJSON – relative filePath + absolute subPath (workspaceRoot fix)', () => {
  it('matches entities when filePath is relative and subPath is absolute with workspaceRoot', () => {
    const parent: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '',
      sourceFiles: [],
      entities: [
        { id: 'e1', name: 'Error', type: 'class', filePath: 'shared/error.ts' },
        { id: 'e2', name: 'Config', type: 'class', filePath: 'shared/config.ts' },
        { id: 'e3', name: 'Engine', type: 'class', filePath: 'engine.ts' },
      ],
      relations: [
        { source: 'e1', target: 'e3', type: 'dependency' },
        { source: 'e1', target: 'e2', type: 'dependency' },
      ],
    };
    // subPath is absolute, filePaths are relative to workspaceRoot='/abs/src'
    const result = deriveSubModuleArchJSON(parent, '/abs/src/shared', '/abs/src');
    // e1 and e2 are in sub-module; e3 is a cross-module stub (target of e1→e3)
    expect(result.entities.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(result.relations).toHaveLength(2);
    expect(result.relations).toContainEqual(
      expect.objectContaining({ source: 'e1', target: 'e2' })
    );
    expect(result.relations).toContainEqual(
      expect.objectContaining({ source: 'e1', target: 'e3' })
    );
  });

  it('still works without workspaceRoot when filePath is already absolute', () => {
    const parent: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '',
      sourceFiles: [],
      entities: [
        { id: 'e1', name: 'A', type: 'class', filePath: '/abs/src/shared/a.ts' },
        { id: 'e2', name: 'B', type: 'class', filePath: '/abs/src/b.ts' },
      ],
      relations: [],
    };
    const result = deriveSubModuleArchJSON(parent, '/abs/src/shared');
    expect(result.entities.map((e) => e.id)).toEqual(['e1']);
  });
});

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
    // These variables hold vi-mocked constructor functions for dependency injection testing.
    // The mock pattern (assign from dynamic import + .mockImplementation()) requires `any` here
    // because TypeScript cannot statically resolve the vi.Mock constructor type across modules.
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
    let FileDiscoveryService: any;
    let ParallelParser: any;
    let ArchJSONAggregator: any;
    let OutputPathResolver: any;
    let MermaidDiagramGenerator: any;

    beforeEach(async () => {
      ({ FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js'));
      ({ ParallelParser } = await import('@/parser/parallel-parser.js'));
      ({ ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js'));
      ({ OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js'));
      ({ MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js'));
    });

    it('should process single diagram successfully', async () => {
      // Mock FileDiscoveryService
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      FileDiscoveryService.mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      ParallelParser.mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      ArchJSONAggregator.mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
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
      OutputPathResolver.mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const mockGenerateAndRender = vi.fn().mockResolvedValue([]);
      MermaidDiagramGenerator.mockImplementation(() => ({
        generateOnly: mockGenerateAndRender,
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
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      FileDiscoveryService.mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      ParallelParser.mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      ArchJSONAggregator.mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
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
      OutputPathResolver.mockImplementation(() => ({
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
      const mockDiscoverFiles = vi.fn().mockImplementation(({ sources }: { sources: string[] }) => {
        // Fail for module2, succeed for others
        if (sources.includes('./src/module2')) {
          throw new Error('Discovery failed');
        }
        return Promise.resolve(['/src/test.ts']);
      });
      FileDiscoveryService.mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      ParallelParser.mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      ArchJSONAggregator.mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
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
      OutputPathResolver.mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const mockGenerateAndRender = vi.fn().mockResolvedValue([]);
      MermaidDiagramGenerator.mockImplementation(() => ({
        generateOnly: mockGenerateAndRender,
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
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      FileDiscoveryService.mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      ParallelParser.mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      ArchJSONAggregator.mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
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
      OutputPathResolver.mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const mockGenerateAndRender = vi.fn().mockResolvedValue([]);
      MermaidDiagramGenerator.mockImplementation(() => ({
        generateOnly: mockGenerateAndRender,
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
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      FileDiscoveryService.mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
      const mockParseFiles = vi.fn().mockResolvedValue(createTestArchJSON());
      ParallelParser.mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      ArchJSONAggregator.mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
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
      OutputPathResolver.mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const mockGenerateAndRender = vi.fn().mockResolvedValue([]);
      MermaidDiagramGenerator.mockImplementation(() => ({
        generateOnly: mockGenerateAndRender,
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
      const mockDiscoverFiles = vi.fn().mockResolvedValue(['/src/test.ts']);
      FileDiscoveryService.mockImplementation(() => ({
        discoverFiles: mockDiscoverFiles,
      }));

      // Mock ParallelParser
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
      ParallelParser.mockImplementation(() => ({
        parseFiles: mockParseFiles,
      }));

      // Mock ArchJSONAggregator
      const mockAggregate = vi.fn().mockImplementation((json) => json);
      ArchJSONAggregator.mockImplementation(() => ({
        aggregate: mockAggregate,
      }));

      // Mock OutputPathResolver
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
      OutputPathResolver.mockImplementation(() => ({
        resolve: mockResolve,
        ensureDirectory: mockEnsureDirectory,
      }));

      // Mock MermaidDiagramGenerator
      const mockGenerateAndRender = vi.fn().mockResolvedValue([]);
      MermaidDiagramGenerator.mockImplementation(() => ({
        generateOnly: mockGenerateAndRender,
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
        generateOnly: vi.fn().mockResolvedValue([]),
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
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockGoPlugin.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: expect.any(String) })
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
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
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockTsPlugin.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: expect.any(String) })
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
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
    const setupMocks = async (
      opts: {
        format?: 'json' | 'mermaid';
        level?: 'class' | 'package' | 'method';
        archJSON?: ArchJSON;
      } = {}
    ) => {
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
        generateOnly: vi.fn().mockResolvedValue([]),
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
      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
      });
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
      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
      });
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
      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
      });
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
      const diagrams = [{ name: 'test', sources: ['./src'], level: 'class' as const }];
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
      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
      });
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
      const processor = new DiagramProcessor({
        diagrams,
        globalConfig: createGlobalConfig(),
        progress,
      });
      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      expect(results[0].stats?.entities).toBe(archJSON.entities.length);
      expect(results[0].stats?.relations).toBe(archJSON.relations.length);
    });
  });

  describe('regression: package-level TS stats must reflect moduleGraph, not aggregatedJSON', () => {
    /**
     * Regression test for the index.md stats inaccuracy bug.
     *
     * Bug: For `level === 'package'` TypeScript diagrams, the diagram is rendered
     * from `extensions.tsAnalysis.moduleGraph` (nodes + edges), but DiagramResult.stats
     * was reading from `aggregatedJSON.entities.length` / `.relations.length` — a
     * different data source that gave wrong counts (e.g. Entities: 2, Relations: 0
     * instead of Entities: 7, Relations: 7).
     *
     * Fix: When moduleGraph is present and level === 'package', stats derive from
     * moduleGraph.nodes.length and moduleGraph.edges.length.
     */
    const buildArchJSONWithModuleGraph = (): ArchJSON => {
      const base = createTestArchJSON();
      return {
        ...base,
        // Standard aggregation gives 1 entity, 0 relations at package level
        entities: base.entities.slice(0, 1),
        relations: [],
        extensions: {
          tsAnalysis: {
            version: '1.0',
            moduleGraph: {
              nodes: [
                {
                  id: '__root__',
                  name: '(root)',
                  type: 'internal',
                  fileCount: 5,
                  stats: { classes: 2, interfaces: 1, functions: 8, enums: 0 },
                },
                {
                  id: 'openai_api_protocols',
                  name: 'openai_api_protocols',
                  type: 'internal',
                  fileCount: 3,
                  stats: { classes: 4, interfaces: 6, functions: 0, enums: 0 },
                },
                {
                  id: 'shared',
                  name: 'shared',
                  type: 'internal',
                  fileCount: 8,
                  stats: { classes: 10, interfaces: 3, functions: 5, enums: 1 },
                },
                {
                  id: '@mlc-ai/web-runtime',
                  name: '@mlc-ai/web-runtime',
                  type: 'external',
                  fileCount: 0,
                  stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
                },
              ],
              edges: [
                { from: '__root__', to: 'openai_api_protocols', strength: 12, importedNames: [] },
                { from: '__root__', to: 'shared', strength: 22, importedNames: [] },
                { from: '__root__', to: '@mlc-ai/web-runtime', strength: 8, importedNames: [] },
                { from: 'openai_api_protocols', to: 'shared', strength: 5, importedNames: [] },
              ],
              cycles: [],
            },
          },
        },
      };
    };

    it('stats.entities reflects moduleGraph.nodes.length, not aggregatedJSON.entities.length', async () => {
      const archJSONWithGraph = buildArchJSONWithModuleGraph();

      // Sanity check: entity counts differ between the two data sources
      expect(archJSONWithGraph.entities.length).toBe(1);
      expect(archJSONWithGraph.extensions?.tsAnalysis?.moduleGraph?.nodes.length).toBe(4);

      const registry = new PluginRegistry();
      const mockTsPlugin: ILanguagePlugin = {
        metadata: {
          name: 'typescript',
          version: '1.0.0',
          displayName: 'Mock TypeScript plugin',
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
        parseProject: vi.fn().mockResolvedValue(archJSONWithGraph),
        canHandle: vi.fn().mockReturnValue(true),
        dispose: vi.fn().mockResolvedValue(undefined),
      };
      registry.register(mockTsPlugin);

      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
      }));

      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: vi.fn().mockReturnValue({
          outputDir: './archguard',
          baseName: 'package',
          paths: {
            mmd: './archguard/overview/package.mmd',
            png: './archguard/overview/package.png',
            svg: './archguard/overview/package.svg',
            json: './archguard/overview/package.json',
          },
        }),
        ensureDirectory: vi.fn().mockResolvedValue(undefined),
      }));

      const processor = new DiagramProcessor({
        diagrams: [{ name: 'overview/package', sources: ['./src'], level: 'package' }],
        globalConfig: createGlobalConfig(),
        progress,
        registry,
      });

      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      // Must use moduleGraph counts, NOT aggregatedJSON.entities.length (which is 1)
      expect(results[0].stats?.entities).toBe(4); // moduleGraph.nodes.length
      expect(results[0].stats?.relations).toBe(4); // moduleGraph.edges.length
    });

    it('stats.relations reflects moduleGraph.edges.length, not aggregatedJSON.relations.length', async () => {
      const archJSONWithGraph = buildArchJSONWithModuleGraph();

      // aggregatedJSON has 0 relations; moduleGraph has 4 edges
      expect(archJSONWithGraph.relations.length).toBe(0);
      expect(archJSONWithGraph.extensions?.tsAnalysis?.moduleGraph?.edges.length).toBe(4);

      const registry = new PluginRegistry();
      const mockTsPlugin: ILanguagePlugin = {
        metadata: {
          name: 'typescript',
          version: '1.0.0',
          displayName: 'Mock TypeScript plugin',
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
        parseProject: vi.fn().mockResolvedValue(archJSONWithGraph),
        canHandle: vi.fn().mockReturnValue(true),
        dispose: vi.fn().mockResolvedValue(undefined),
      };
      registry.register(mockTsPlugin);

      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
      }));

      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: vi.fn().mockReturnValue({
          outputDir: './archguard',
          baseName: 'package',
          paths: {
            mmd: './archguard/overview/package.mmd',
            png: './archguard/overview/package.png',
            svg: './archguard/overview/package.svg',
            json: './archguard/overview/package.json',
          },
        }),
        ensureDirectory: vi.fn().mockResolvedValue(undefined),
      }));

      const processor = new DiagramProcessor({
        diagrams: [{ name: 'overview/package', sources: ['./src'], level: 'package' }],
        globalConfig: createGlobalConfig(),
        progress,
        registry,
      });

      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      expect(results[0].stats?.relations).toBe(4); // moduleGraph.edges.length, NOT 0
    });

    it('non-package diagrams still use aggregatedJSON entity/relation counts', async () => {
      // For class/method level, stats must still come from aggregatedJSON, not moduleGraph
      const archJSONWithGraph = buildArchJSONWithModuleGraph();

      const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
      (FileDiscoveryService as any).mockImplementation(() => ({
        discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
      }));

      const { ParallelParser } = await import('@/parser/parallel-parser.js');
      (ParallelParser as any).mockImplementation(() => ({
        parseFiles: vi.fn().mockResolvedValue(archJSONWithGraph),
      }));

      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      (ArchJSONAggregator as any).mockImplementation(() => ({
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
        generateOnly: vi.fn().mockResolvedValue([]),
      }));

      const processor = new DiagramProcessor({
        diagrams: [{ name: 'class/all', sources: ['./src'], level: 'class' }],
        globalConfig: createGlobalConfig(),
        progress,
      });

      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      // class-level: stats from aggregatedJSON.entities (1), not moduleGraph.nodes (4)
      expect(results[0].stats?.entities).toBe(archJSONWithGraph.entities.length);
      expect(results[0].stats?.relations).toBe(archJSONWithGraph.relations.length);
    });
  });

  describe('Go Atlas project — stats show Atlas package layer counts', () => {
    it('stats.entities and stats.relations use Atlas package layer when goAtlas extension is present', async () => {
      // Build a minimal AggregatedArchJSON mock with goAtlas extension
      const goAtlasArchJSON: ArchJSON = {
        version: '1.0',
        language: 'go',
        timestamp: new Date().toISOString(),
        sourceFiles: ['main.go'],
        entities: [],
        relations: [],
        extensions: {
          goAtlas: {
            version: '2.0',
            layers: {
              package: {
                nodes: [
                  { id: 'pkg/a', name: 'a', type: 'internal', fileCount: 1 },
                  { id: 'pkg/b', name: 'b', type: 'internal', fileCount: 2 },
                  { id: 'pkg/c', name: 'c', type: 'internal', fileCount: 1 },
                ],
                edges: [
                  { from: 'pkg/a', to: 'pkg/b', strength: 1 },
                  { from: 'pkg/a', to: 'pkg/c', strength: 2 },
                  { from: 'pkg/b', to: 'pkg/c', strength: 1 },
                  { from: 'pkg/c', to: 'pkg/a', strength: 1 },
                  { from: 'pkg/b', to: 'pkg/a', strength: 3 },
                ],
                cycles: [],
              } as any,
            },
            metadata: {
              generatedAt: new Date().toISOString(),
              generationStrategy: {
                functionBodyStrategy: 'none',
                detectedFrameworks: [],
                followIndirectCalls: false,
                goplsEnabled: false,
              },
              completeness: { package: 1, capability: 0, goroutine: 0, flow: 0 },
              performance: { fileCount: 3, parseTime: 5, totalTime: 10, memoryUsage: 512 },
            },
          },
        },
      };

      const registry = new PluginRegistry();
      const mockGoPlugin: ILanguagePlugin = {
        metadata: {
          name: 'golang',
          version: '1.0.0',
          displayName: 'Mock Go plugin',
          fileExtensions: ['.go'],
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
        parseProject: vi.fn().mockResolvedValue(goAtlasArchJSON),
        canHandle: vi.fn().mockReturnValue(true),
        dispose: vi.fn().mockResolvedValue(undefined),
      };
      registry.register(mockGoPlugin);

      const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
      }));

      const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: vi.fn().mockReturnValue({
          outputDir: './archguard',
          baseName: 'package',
          paths: {
            mmd: './archguard/overview/package.mmd',
            png: './archguard/overview/package.png',
            svg: './archguard/overview/package.svg',
            json: './archguard/overview/package.json',
          },
        }),
        ensureDirectory: vi.fn().mockResolvedValue(undefined),
      }));

      const { AtlasRenderer } =
        (await import('@/plugins/golang/atlas/renderers/atlas-renderer.js')) as any;
      AtlasRenderer.mockImplementation(() => ({
        render: vi
          .fn()
          .mockResolvedValue({ content: 'flowchart LR\n  A --> B', format: 'mermaid' }),
      }));

      const processor = new DiagramProcessor({
        diagrams: [{ name: 'overview/package', sources: ['./src'], level: 'package', language: 'go' }],
        globalConfig: createGlobalConfig(),
        progress,
        registry,
      });

      const results = await processor.processAll();

      expect(results[0].success).toBe(true);
      // Must use Atlas package layer counts, NOT aggregatedJSON.entities/relations (which are empty)
      expect(results[0].stats?.entities).toBe(3); // atlasPackageLayer.nodes.length
      expect(results[0].stats?.relations).toBe(5); // atlasPackageLayer.edges.length
    });
  });
});

describe('Atlas layer parallel rendering', () => {
  /**
   * Helper: create a minimal GoAtlas ArchJSON with all 4 layers present.
   */
  const createGoAtlasArchJSON = (): ArchJSON => ({
    version: '1.0',
    language: 'go' as const,
    timestamp: new Date().toISOString(),
    sourceFiles: ['main.go'],
    entities: [],
    relations: [],
    extensions: {
      goAtlas: {
        version: '2.0',
        layers: {
          package: { nodes: [], edges: [] } as any,
          capability: { nodes: [], edges: [] } as any,
          goroutine: { nodes: [], edges: [] } as any,
          flow: { nodes: [], edges: [] } as any,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          generationStrategy: {
            functionBodyStrategy: 'none',
            detectedFrameworks: [],
            followIndirectCalls: false,
            goplsEnabled: false,
          },
          completeness: { package: 1, capability: 1, goroutine: 1, flow: 1 },
          performance: { fileCount: 1, parseTime: 10, totalTime: 20, memoryUsage: 1024 },
        },
      },
    },
  });

  /**
   * Create a mock Go plugin that returns a Go Atlas ArchJSON.
   */
  const createMockGoPlugin = (goAtlasArchJSON: ArchJSON): ILanguagePlugin => ({
    metadata: {
      name: 'golang',
      version: '1.0.0',
      displayName: 'Mock Go plugin',
      fileExtensions: ['.go'],
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
    parseProject: vi.fn().mockResolvedValue(goAtlasArchJSON),
    canHandle: vi.fn().mockReturnValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  });

  /**
   * Setup standard mocks needed for Go Atlas processing.
   */
  const setupCommonMocks = async () => {
    const { ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js');
    (ArchJSONAggregator as any).mockImplementation(() => ({
      aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
    }));

    const { OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js');
    (OutputPathResolver as any).mockImplementation(() => ({
      resolve: vi.fn().mockReturnValue({
        outputDir: './archguard',
        baseName: 'go-atlas',
        paths: {
          mmd: './archguard/go-atlas.mmd',
          png: './archguard/go-atlas.png',
          svg: './archguard/go-atlas.svg',
          json: './archguard/go-atlas.json',
        },
      }),
      ensureDirectory: vi.fn().mockResolvedValue(undefined),
    }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateAtlasOutput renders all 4 layers concurrently (maxConcurrent > 1)', async () => {
    /**
     * Verifies that all 4 Atlas layers are rendered concurrently with Promise.all.
     *
     * Strategy: use vi.spyOn on the dynamically-imported AtlasRenderer to intercept
     * render() calls, introducing a small async delay. We track the peak number of
     * simultaneously in-flight renders via a shared counter.
     *
     * - BEFORE fix (sequential for-loop):  maxConcurrent === 1  → test FAILS
     * - AFTER fix  (Promise.all):          maxConcurrent === 4  → test PASSES
     *
     * Note: AtlasRenderer is dynamically imported inside generateAtlasOutput, so we
     * use the module mock already set at file top. We override via mockImplementation.
     */
    const goAtlasArchJSON = createGoAtlasArchJSON();
    const mockGoPlugin = createMockGoPlugin(goAtlasArchJSON);
    await setupCommonMocks();

    // Track concurrency of AtlasRenderer.render calls
    let concurrentRenders = 0;
    let maxConcurrent = 0;

    // AtlasRenderer is dynamically imported in generateAtlasOutput.
    // We mock the module using the factory pattern via vi.doMock (not hoisted).
    const { AtlasRenderer } =
      (await import('@/plugins/golang/atlas/renderers/atlas-renderer.js')) as any;
    AtlasRenderer.mockImplementation(() => ({
      render: vi.fn().mockImplementation(async () => {
        concurrentRenders++;
        maxConcurrent = Math.max(maxConcurrent, concurrentRenders);
        // Introduce a small delay so concurrent calls can overlap
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrentRenders--;
        return { content: 'flowchart LR\n  A --> B', format: 'mermaid' };
      }),
    }));

    const registry = new PluginRegistry();
    registry.register(mockGoPlugin);

    const processor = new DiagramProcessor({
      diagrams: [{ name: 'go-atlas', sources: ['./src'], level: 'package', language: 'go' }],
      globalConfig: {
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 30000 },
        cache: { enabled: false, ttl: 0 },
        concurrency: 4,
        verbose: false,
      },
      progress: new ProgressReporter(),
      registry,
    });

    const results = await processor.processAll();

    expect(results[0].success).toBe(true);
    // With parallel rendering all 4 layers should be in-flight simultaneously
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('creates worker pool for single diagram (poolSize=1)', async () => {
    /**
     * Phase C: pool is always created (poolSize >= 1), even for a single diagram.
     * Verify MermaidRenderWorkerPool constructor is called with poolSize >= 1.
     */
    await setupCommonMocks();

    // Setup mocks for a plain single TypeScript diagram (no Atlas)
    const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
    (FileDiscoveryService as any).mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
    }));

    const { ParallelParser } = await import('@/parser/parallel-parser.js');
    (ParallelParser as any).mockImplementation(() => ({
      parseFiles: vi.fn().mockResolvedValue({
        version: '1.0',
        language: 'typescript',
        timestamp: '',
        sourceFiles: [],
        entities: [],
        relations: [],
      }),
    }));

    const { MermaidRenderWorkerPool } = (await import('@/mermaid/render-worker-pool.js')) as any;
    const constructorCalls: number[] = [];
    MermaidRenderWorkerPool.mockImplementation((size: number) => {
      constructorCalls.push(size);
      return {
        start: vi.fn().mockResolvedValue(undefined),
        render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 100 100"/>' }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
    (MermaidDiagramGenerator as any).mockImplementation(() => ({
      generateOnly: vi.fn().mockResolvedValue([]),
    }));

    const processor = new DiagramProcessor({
      diagrams: [{ name: 'single', sources: ['./src'], level: 'class' }],
      globalConfig: {
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 30000 },
        cache: { enabled: false, ttl: 0 },
        concurrency: 4,
        verbose: false,
      },
      progress: new ProgressReporter(),
    });

    await processor.processAll();

    // Pool must be created even for a single diagram (poolSize >= 1)
    expect(constructorCalls.length).toBeGreaterThan(0);
    expect(constructorCalls[0]).toBeGreaterThanOrEqual(1);
  });

  it('skips pool.start() when all diagrams use json format', async () => {
    /**
     * Phase C: when format is json, no rendering is needed — pool.start() must NOT be called.
     */
    await setupCommonMocks();

    const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
    (FileDiscoveryService as any).mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
    }));

    const { ParallelParser } = await import('@/parser/parallel-parser.js');
    (ParallelParser as any).mockImplementation(() => ({
      parseFiles: vi.fn().mockResolvedValue({
        version: '1.0',
        language: 'typescript',
        timestamp: '',
        sourceFiles: [],
        entities: [],
        relations: [],
      }),
    }));

    const { MermaidRenderWorkerPool } = (await import('@/mermaid/render-worker-pool.js')) as any;
    const startSpy = vi.fn().mockResolvedValue(undefined);
    MermaidRenderWorkerPool.mockImplementation((_size: number) => ({
      start: startSpy,
      render: vi.fn().mockResolvedValue({ success: true, svg: '<svg/>' }),
      terminate: vi.fn().mockResolvedValue(undefined),
    }));

    const processor = new DiagramProcessor({
      diagrams: [{ name: 'json-only', sources: ['./src'], level: 'class' }],
      globalConfig: {
        outputDir: './archguard',
        format: 'json', // all diagrams are json
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 30000 },
        cache: { enabled: false, ttl: 0 },
        concurrency: 4,
        verbose: false,
      },
      progress: new ProgressReporter(),
    });

    await processor.processAll();

    // Pool is created but start() must NOT be called when all diagrams are json
    expect(MermaidRenderWorkerPool).toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('calls pool.start() when at least one diagram uses mermaid format', async () => {
    /**
     * Phase C: even if globalConfig.format=json, a per-diagram format:'mermaid' override
     * must trigger pool.start().
     */
    await setupCommonMocks();

    const { FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js');
    (FileDiscoveryService as any).mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
    }));

    const { ParallelParser } = await import('@/parser/parallel-parser.js');
    (ParallelParser as any).mockImplementation(() => ({
      parseFiles: vi.fn().mockResolvedValue({
        version: '1.0',
        language: 'typescript',
        timestamp: '',
        sourceFiles: [],
        entities: [],
        relations: [],
      }),
    }));

    const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
    (MermaidDiagramGenerator as any).mockImplementation(() => ({
      generateOnly: vi.fn().mockResolvedValue([]),
    }));

    const { MermaidRenderWorkerPool } = (await import('@/mermaid/render-worker-pool.js')) as any;
    const startSpy = vi.fn().mockResolvedValue(undefined);
    MermaidRenderWorkerPool.mockImplementation((_size: number) => ({
      start: startSpy,
      render: vi.fn().mockResolvedValue({ success: true, svg: '<svg/>' }),
      terminate: vi.fn().mockResolvedValue(undefined),
    }));

    const processor = new DiagramProcessor({
      diagrams: [
        // diagram-level format override to mermaid, while globalConfig is json
        { name: 'mermaid-one', sources: ['./src'], level: 'class', format: 'mermaid' as const },
      ],
      globalConfig: {
        outputDir: './archguard',
        format: 'json', // global default is json
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 30000 },
        cache: { enabled: false, ttl: 0 },
        concurrency: 4,
        verbose: false,
      },
      progress: new ProgressReporter(),
    });

    await processor.processAll();

    // start() MUST be called because one diagram has format:'mermaid'
    expect(startSpy).toHaveBeenCalledOnce();
  });

  it('Go Atlas single diagram uses effectiveDiagramCount based on layer count', async () => {
    /**
     * Phase C: 1 Go Atlas diagram with 4 layers → poolSize = min(cpus-1, 4, 4).
     * With 8 mocked CPUs → poolSize = min(7, 4, 4) = 4.
     */
    const goAtlasArchJSON = createGoAtlasArchJSON();
    const mockGoPlugin = createMockGoPlugin(goAtlasArchJSON);
    await setupCommonMocks();

    // Mock os.cpus() to return 8 CPUs using the vi.mock('os') at the top
    const osMod = await import('os');
    (osMod.default.cpus as any).mockReturnValue(
      new Array(8).fill({
        model: '',
        speed: 0,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      })
    );

    const { AtlasRenderer } =
      (await import('@/plugins/golang/atlas/renderers/atlas-renderer.js')) as any;
    AtlasRenderer.mockImplementation(() => ({
      render: vi.fn().mockResolvedValue({ content: 'flowchart LR\n  A --> B', format: 'mermaid' }),
    }));

    const { MermaidRenderWorkerPool } = (await import('@/mermaid/render-worker-pool.js')) as any;
    const constructorCalls: number[] = [];
    MermaidRenderWorkerPool.mockImplementation((size: number) => {
      constructorCalls.push(size);
      return {
        start: vi.fn().mockResolvedValue(undefined),
        render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 100 100"/>' }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
    });

    const registry = new PluginRegistry();
    registry.register(mockGoPlugin);

    const processor = new DiagramProcessor({
      diagrams: [{ name: 'go-atlas', sources: ['./src'], level: 'package', language: 'go' }],
      globalConfig: {
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 30000 },
        cache: { enabled: false, ttl: 0 },
        concurrency: 4,
        verbose: false,
      },
      progress: new ProgressReporter(),
      registry,
    });

    await processor.processAll();

    // With 8 CPUs and 4 atlas layers: poolSize = min(8-1, 4, 4) = 4
    expect(constructorCalls.length).toBeGreaterThan(0);
    expect(constructorCalls[0]).toBe(4);
  });

  it('processAll creates worker pool for a single Go Atlas diagram (MermaidRenderWorkerPool instantiated)', async () => {
    /**
     * Verifies that a worker pool is created even when diagramCount === 1,
     * if the single diagram is a Go Atlas diagram.
     *
     * Strategy: verify that MermaidRenderWorkerPool constructor is called with a
     * positive pool size. If poolSize === 0, the constructor would never be called.
     *
     * - BEFORE fix: poolSize === 0 for diagramCount === 1 → constructor never called
     * - AFTER fix:  poolSize === 4 for Go Atlas → constructor called with size > 0
     */
    const goAtlasArchJSON = createGoAtlasArchJSON();
    const mockGoPlugin = createMockGoPlugin(goAtlasArchJSON);
    await setupCommonMocks();

    // AtlasRenderer: simple mock that returns valid content
    const { AtlasRenderer } =
      (await import('@/plugins/golang/atlas/renderers/atlas-renderer.js')) as any;
    AtlasRenderer.mockImplementation(() => ({
      render: vi.fn().mockResolvedValue({ content: 'flowchart LR\n  A --> B', format: 'mermaid' }),
    }));

    // MermaidRenderWorkerPool: capture constructor arguments to verify pool size
    const { MermaidRenderWorkerPool } = (await import('@/mermaid/render-worker-pool.js')) as any;
    const constructorCalls: number[] = [];
    MermaidRenderWorkerPool.mockImplementation((size: number) => {
      constructorCalls.push(size);
      return {
        start: vi.fn().mockResolvedValue(undefined),
        render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 100 100"/>' }),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
    });

    const registry = new PluginRegistry();
    registry.register(mockGoPlugin);

    const processor = new DiagramProcessor({
      diagrams: [{ name: 'go-atlas', sources: ['./src'], level: 'package', language: 'go' }],
      globalConfig: {
        outputDir: './archguard',
        format: 'mermaid',
        exclude: [],
        cli: { command: 'claude', args: [], timeout: 30000 },
        cache: { enabled: false, ttl: 0 },
        concurrency: 4,
        verbose: false,
      },
      progress: new ProgressReporter(),
      registry,
    });

    const results = await processor.processAll();

    expect(results[0].success).toBe(true);
    // MermaidRenderWorkerPool must have been instantiated with poolSize > 0
    // (proves pool was created rather than set to null)
    expect(constructorCalls.length).toBeGreaterThan(0);
    expect(constructorCalls[0]).toBeGreaterThan(0);
  });
});
