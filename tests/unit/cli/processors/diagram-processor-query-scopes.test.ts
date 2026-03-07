/**
 * Unit tests for DiagramProcessor query scope collection.
 *
 * Verifies the InternalQueryScope collector that feeds
 * the query layer with per-source-group ArchJSON data.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagramProcessor } from '@/cli/processors/diagram-processor.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import { ProgressReporter } from '@/cli/progress.js';
import type { ArchJSON } from '@/types/index.js';

// Mock dependencies (same pattern as diagram-processor.test.ts)
vi.mock('@/cli/utils/file-discovery-service.js');
vi.mock('@/parser/parallel-parser.js');
vi.mock('@/parser/archjson-aggregator.js');
vi.mock('@/cli/utils/output-path-resolver.js');
vi.mock('@/mermaid/diagram-generator.js');

vi.mock('@/cli/cache/arch-json-disk-cache.js', () => ({
  ArchJsonDiskCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    computeKey: vi.fn().mockResolvedValue('mock-disk-cache-key'),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/mermaid/render-worker-pool.js', () => ({
  MermaidRenderWorkerPool: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 100 100"/>' }),
    terminate: vi.fn().mockResolvedValue(undefined),
  })),
}));

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

// --- Helpers ---

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

const createTestArchJSON = (entityCount = 1): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: ['test.ts'],
  entities: Array.from({ length: entityCount }, (_, i) => ({
    id: `TestClass${i}`,
    name: `TestClass${i}`,
    type: 'class' as const,
    visibility: 'public' as const,
    sourceLocation: {
      file: 'test.ts',
      startLine: 1,
      endLine: 10,
    },
    members: [],
  })),
  relations: [],
});

const createEmptyArchJSON = (): ArchJSON => ({
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: [],
  entities: [],
  relations: [],
});

describe('DiagramProcessor query scope collection', () => {
  let FileDiscoveryService: any;
  let ParallelParser: any;
  let ArchJSONAggregator: any;
  let OutputPathResolver: any;
  let MermaidDiagramGenerator: any;
  let progress: ProgressReporter;

  beforeEach(async () => {
    ({ FileDiscoveryService } = await import('@/cli/utils/file-discovery-service.js'));
    ({ ParallelParser } = await import('@/parser/parallel-parser.js'));
    ({ ArchJSONAggregator } = await import('@/parser/archjson-aggregator.js'));
    ({ OutputPathResolver } = await import('@/cli/utils/output-path-resolver.js'));
    ({ MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js'));
    progress = new ProgressReporter();
    vi.clearAllMocks();
  });

  /** Wire up all mocks so processAll() succeeds for the generic TS branch. */
  function setupMocks(archJson: ArchJSON = createTestArchJSON()) {
    (FileDiscoveryService as any).mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue(['/src/test.ts']),
    }));
    (ParallelParser as any).mockImplementation(() => ({
      parseFiles: vi.fn().mockResolvedValue(archJson),
    }));
    (ArchJSONAggregator as any).mockImplementation((json: any) => ({
      aggregate: vi.fn().mockImplementation(() => json),
    }));
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
    (MermaidDiagramGenerator as any).mockImplementation(() => ({
      generateAndRender: vi.fn().mockResolvedValue(undefined),
    }));
  }

  it('getQuerySourceGroups() returns empty array before processAll()', () => {
    setupMocks();
    const diagrams = [createDiagramConfig('test', ['./src'])];
    const processor = new DiagramProcessor({
      diagrams,
      globalConfig: createGlobalConfig(),
      progress,
    });

    expect(processor.getQuerySourceGroups()).toEqual([]);
  });

  it('returns at least one scope with kind="parsed" after processAll()', async () => {
    const archJson = createTestArchJSON(3);
    setupMocks(archJson);
    const diagrams = [createDiagramConfig('test', ['./src'])];
    const processor = new DiagramProcessor({
      diagrams,
      globalConfig: createGlobalConfig(),
      progress,
    });

    await processor.processAll();
    const scopes = processor.getQuerySourceGroups();

    expect(scopes.length).toBeGreaterThanOrEqual(1);
    const parsed = scopes.find((s) => s.kind === 'parsed');
    expect(parsed).toBeDefined();
    expect(parsed!.archJson.entities.length).toBe(3);
  });

  it('does not register scopes for empty-entity ArchJSON', async () => {
    setupMocks(createEmptyArchJSON());
    const diagrams = [createDiagramConfig('test', ['./src'])];
    const processor = new DiagramProcessor({
      diagrams,
      globalConfig: createGlobalConfig(),
      progress,
    });

    // processAll will throw because no files produce entities,
    // but we still check that no scopes were registered.
    await processor.processAll();
    const scopes = processor.getQuerySourceGroups();

    // No scope should be registered since entities array is empty
    expect(scopes.length).toBe(0);
  });

  it('key is an 8-char hex string', async () => {
    setupMocks();
    const diagrams = [createDiagramConfig('test', ['./src'])];
    const processor = new DiagramProcessor({
      diagrams,
      globalConfig: createGlobalConfig(),
      progress,
    });

    await processor.processAll();
    const scopes = processor.getQuerySourceGroups();

    expect(scopes.length).toBeGreaterThanOrEqual(1);
    for (const scope of scopes) {
      expect(scope.key).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('sources are resolved to absolute paths', async () => {
    setupMocks();
    const diagrams = [createDiagramConfig('test', ['./src'])];
    const processor = new DiagramProcessor({
      diagrams,
      globalConfig: createGlobalConfig(),
      progress,
    });

    await processor.processAll();
    const scopes = processor.getQuerySourceGroups();

    expect(scopes.length).toBeGreaterThanOrEqual(1);
    for (const scope of scopes) {
      for (const source of scope.sources) {
        // path.resolve always returns an absolute path (starts with /)
        expect(source).toMatch(/^\//);
      }
    }
  });

  it('does not overwrite a previously registered scope with the same key', async () => {
    const archJson = createTestArchJSON(2);
    setupMocks(archJson);

    // Two diagrams sharing the same sources → same key
    const diagrams = [
      createDiagramConfig('diag1', ['./src']),
      createDiagramConfig('diag2', ['./src']),
    ];
    const processor = new DiagramProcessor({
      diagrams,
      globalConfig: createGlobalConfig(),
      progress,
    });

    await processor.processAll();
    const scopes = processor.getQuerySourceGroups();

    // Same sources → only one scope entry
    expect(scopes.length).toBe(1);
  });
});
