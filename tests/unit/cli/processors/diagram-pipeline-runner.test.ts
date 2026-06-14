/**
 * Unit tests for DiagramPipelineRunner
 *
 * Tests the diagram processing pipeline in isolation from DiagramProcessor:
 * aggregation, path resolution, metrics, routing, and result assembly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/parser/archjson-aggregator.js');
vi.mock('@/parser/metrics-calculator.js');
vi.mock('@/cli/utils/output-path-resolver.js');
vi.mock('@/cli/processors/diagram-output-router.js');
vi.mock('@/cli/progress/parallel-progress.js');
vi.mock('@/mermaid/render-worker-pool.js', () => ({
  MermaidRenderWorkerPool: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    terminate: vi.fn(),
    render: vi.fn().mockResolvedValue({ success: true, svg: '<svg/>' }),
  })),
}));

import { DiagramPipelineRunner } from '@/cli/processors/diagram-pipeline-runner.js';
import { ArchJSONAggregator } from '@/parser/archjson-aggregator.js';
import { MetricsCalculator } from '@/parser/metrics-calculator.js';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';
import { DiagramOutputRouter } from '@/cli/processors/diagram-output-router.js';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';
import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import type { ProgressReporterLike } from '@/cli/progress/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    outputDir: './archguard',
    format: 'mermaid',
    exclude: [],
    cli: { command: 'claude', args: [], timeout: 30000 },
    cache: { enabled: false, ttl: 0 },
    concurrency: 4,
    verbose: false,
    ...overrides,
  };
}

function makeDiagram(overrides: Partial<DiagramConfig> = {}): DiagramConfig {
  return {
    name: 'test-diagram',
    sources: ['./src'],
    level: 'class',
    ...overrides,
  };
}

function makeArchJson(entityCount = 1, relationCount = 0): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: new Date().toISOString(),
    sourceFiles: ['test.ts'],
    entities: Array.from({ length: entityCount }, (_, i) => ({
      id: `Entity${i}`,
      name: `Entity${i}`,
      type: 'class' as const,
      visibility: 'public' as const,
      sourceLocation: { file: 'test.ts', startLine: 1, endLine: 10 },
      members: [],
    })),
    relations: Array.from({ length: relationCount }, (_, i) => ({
      source: `Entity${i}`,
      target: `Entity${i + 1}`,
      type: 'dependency' as const,
    })),
  };
}

const MOCK_PATHS = {
  outputDir: './archguard',
  baseName: 'test-diagram',
  paths: {
    mmd: './archguard/test-diagram.mmd',
    svg: './archguard/test-diagram.svg',
    png: './archguard/test-diagram.png',
    json: './archguard/test-diagram.json',
  },
};

const MOCK_METRICS = {
  entityCount: 2,
  relationCount: 1,
  level: 'class' as const,
  timestamp: new Date().toISOString(),
};

function makeProgress(): ProgressReporterLike {
  return {
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    update: vi.fn(),
    stop: vi.fn(),
  } as unknown as ProgressReporterLike;
}

function makePool(): InstanceType<typeof MermaidRenderWorkerPool> {
  return (
    (MermaidRenderWorkerPool as any).mock.results[0]?.value ?? {
      start: vi.fn(),
      terminate: vi.fn(),
      render: vi.fn().mockResolvedValue({ success: true, svg: '<svg/>' }),
    }
  );
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupBaseMocks(archJson: ArchJSON = makeArchJson(1, 0)) {
  (ArchJSONAggregator as any).mockImplementation(() => ({
    aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
  }));

  (MetricsCalculator as any).mockImplementation(() => ({
    calculate: vi.fn().mockReturnValue(MOCK_METRICS),
  }));

  (OutputPathResolver as any).mockImplementation(() => ({
    resolve: vi.fn().mockReturnValue(MOCK_PATHS),
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
  }));

  (DiagramOutputRouter as any).mockImplementation(() => ({
    route: vi.fn().mockResolvedValue(undefined),
  }));

  (ParallelProgressReporter as any).mockImplementation(() => ({
    update: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  }));

  new MermaidRenderWorkerPool(1, {} as any);
  return archJson;
}

function makeRunner(
  globalConfig = makeGlobalConfig(),
  progress = makeProgress(),
  parallelProgress?: any
) {
  const aggregator = new ArchJSONAggregator() as any;
  const metricsCalc = new MetricsCalculator() as any;
  const router = new DiagramOutputRouter(globalConfig, progress) as any;
  return new DiagramPipelineRunner(
    aggregator,
    metricsCalc,
    router,
    globalConfig,
    progress,
    parallelProgress
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiagramPipelineRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply mock implementations
    (MermaidRenderWorkerPool as any).mockImplementation(() => ({
      start: vi.fn(),
      terminate: vi.fn(),
      render: vi.fn().mockResolvedValue({ success: true, svg: '<svg/>' }),
    }));
  });

  describe('successful run', () => {
    it('returns DiagramResult with success: true and correct name', async () => {
      setupBaseMocks();
      const runner = makeRunner();
      const pool = makePool();

      const result = await runner.run(makeDiagram({ name: 'my-diagram' }), makeArchJson(), pool);

      expect(result.success).toBe(true);
      expect(result.name).toBe('my-diagram');
    });

    it('sets metrics on the returned result', async () => {
      setupBaseMocks();
      const runner = makeRunner();
      const pool = makePool();

      const result = await runner.run(makeDiagram(), makeArchJson(), pool);

      expect(result.success).toBe(true);
      expect(result.metrics).toEqual(MOCK_METRICS);
    });

    it('populates stats with entities, relations, and parseTime', async () => {
      setupBaseMocks(makeArchJson(3, 2));
      const runner = makeRunner();
      const pool = makePool();

      const result = await runner.run(makeDiagram(), makeArchJson(3, 2), pool);

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats?.parseTime).toBeGreaterThanOrEqual(0);
    });

    it('format "json" → resultPaths.json populated, mmd/svg/png not set', async () => {
      setupBaseMocks();
      const runner = makeRunner(makeGlobalConfig({ format: 'json' }));
      const pool = makePool();

      const result = await runner.run(makeDiagram({ format: 'json' }), makeArchJson(), pool);

      expect(result.success).toBe(true);
      expect(result.paths?.json).toBeDefined();
      expect(result.paths?.mmd).toBeUndefined();
      expect(result.paths?.svg).toBeUndefined();
      expect(result.paths?.png).toBeUndefined();
    });

    it('format "mermaid" → resultPaths.mmd, svg, png populated', async () => {
      setupBaseMocks();
      const runner = makeRunner(makeGlobalConfig({ format: 'mermaid' }));
      const pool = makePool();

      const result = await runner.run(makeDiagram({ format: 'mermaid' }), makeArchJson(), pool);

      expect(result.success).toBe(true);
      expect(result.paths?.mmd).toBeDefined();
      expect(result.paths?.svg).toBeDefined();
      expect(result.paths?.png).toBeDefined();
    });

    it('uses moduleGraph.nodes.length for stats.entities when level=package with tsAnalysis.moduleGraph', async () => {
      const archJsonWithModuleGraph: ArchJSON = {
        ...makeArchJson(1, 0),
        extensions: {
          tsAnalysis: {
            version: '1.1',
            moduleGraph: {
              nodes: [
                {
                  id: 'a',
                  name: 'a',
                  type: 'internal',
                  fileCount: 2,
                  stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
                },
                {
                  id: 'b',
                  name: 'b',
                  type: 'internal',
                  fileCount: 3,
                  stats: { classes: 2, interfaces: 0, functions: 0, enums: 0 },
                },
                {
                  id: 'c',
                  name: 'c',
                  type: 'external',
                  fileCount: 0,
                  stats: { classes: 0, interfaces: 0, functions: 0, enums: 0 },
                },
              ],
              edges: [
                { from: 'a', to: 'b', strength: 5, importedNames: [] },
                { from: 'a', to: 'c', strength: 2, importedNames: [] },
              ],
              cycles: [],
            },
          },
        },
      };

      (ArchJSONAggregator as any).mockImplementation(() => ({
        aggregate: vi.fn().mockImplementation((json: ArchJSON) => json),
      }));
      (MetricsCalculator as any).mockImplementation(() => ({
        calculate: vi.fn().mockReturnValue(MOCK_METRICS),
      }));
      (OutputPathResolver as any).mockImplementation(() => ({
        resolve: vi.fn().mockReturnValue(MOCK_PATHS),
        ensureDirectory: vi.fn().mockResolvedValue(undefined),
      }));
      (DiagramOutputRouter as any).mockImplementation(() => ({
        route: vi.fn().mockResolvedValue(undefined),
      }));
      new MermaidRenderWorkerPool(1, {} as any);

      const runner = makeRunner();
      const pool = makePool();

      const result = await runner.run(
        makeDiagram({ level: 'package' }),
        archJsonWithModuleGraph,
        pool
      );

      expect(result.success).toBe(true);
      // moduleGraph has 3 nodes and 2 edges
      expect(result.stats?.entities).toBe(3);
      expect(result.stats?.relations).toBe(2);
    });

    it('injects global projectSemantics into ArchJSON extensions before routing', async () => {
      setupBaseMocks(makeArchJson(1, 0));
      const runner = makeRunner(
        makeGlobalConfig({
          projectSemantics: {
            suggestedDepth: 2,
            architecturalLayers: {
              'src/analysis': 'Analysis',
            },
          },
        })
      );
      const pool = makePool();

      await runner.run(makeDiagram({ level: 'package' }), makeArchJson(), pool);

      const router = (DiagramOutputRouter as any).mock.results[0].value;
      const routeMock = (router.route as any).mock;
      expect(routeMock.calls[0][0].extensions?.projectSemantics).toEqual(
        expect.objectContaining({
          suggestedDepth: 2,
          architecturalLayers: {
            'src/analysis': 'Analysis',
          },
        })
      );
    });
  });

  describe('failure handling', () => {
    it('when router.route() throws → returns DiagramResult with success: false', async () => {
      setupBaseMocks();
      (DiagramOutputRouter as any).mockImplementation(() => ({
        route: vi.fn().mockRejectedValue(new Error('render failed')),
      }));

      const runner = makeRunner();
      const pool = makePool();

      const result = await runner.run(makeDiagram(), makeArchJson(), pool);

      expect(result.success).toBe(false);
      expect(result.error).toBe('render failed');
      expect(result.name).toBe('test-diagram');
    });
  });

  describe('parallelProgress integration', () => {
    it('calls parallelProgress.update() during processing', async () => {
      setupBaseMocks();
      const parallelProgressMock = new ParallelProgressReporter([]) as any;

      const runner = makeRunner(makeGlobalConfig(), makeProgress(), parallelProgressMock);
      const pool = makePool();

      await runner.run(makeDiagram(), makeArchJson(), pool);

      expect(parallelProgressMock.update).toHaveBeenCalled();
    });

    it('calls parallelProgress.complete() on success', async () => {
      setupBaseMocks();
      const parallelProgressMock = new ParallelProgressReporter([]) as any;

      const runner = makeRunner(makeGlobalConfig(), makeProgress(), parallelProgressMock);
      const pool = makePool();

      const result = await runner.run(makeDiagram(), makeArchJson(), pool);

      expect(result.success).toBe(true);
      expect(parallelProgressMock.complete).toHaveBeenCalledWith('test-diagram');
    });

    it('calls parallelProgress.fail() on failure', async () => {
      setupBaseMocks();
      (DiagramOutputRouter as any).mockImplementation(() => ({
        route: vi.fn().mockRejectedValue(new Error('oops')),
      }));
      const parallelProgressMock = new ParallelProgressReporter([]) as any;

      const runner = makeRunner(makeGlobalConfig(), makeProgress(), parallelProgressMock);
      const pool = makePool();

      const result = await runner.run(makeDiagram(), makeArchJson(), pool);

      expect(result.success).toBe(false);
      expect(parallelProgressMock.fail).toHaveBeenCalledWith('test-diagram');
    });
  });
});
