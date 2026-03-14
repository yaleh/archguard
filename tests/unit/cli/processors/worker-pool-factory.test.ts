/**
 * Unit tests for WorkerPoolFactory
 *
 * Tests pool-sizing formula and MermaidRenderWorkerPool construction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';

// Mock os to control cpus() return value
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

// Mock MermaidRenderWorkerPool
vi.mock('@/mermaid/render-worker-pool.js', () => ({
  MermaidRenderWorkerPool: vi.fn().mockImplementation((size: number, opts: unknown) => ({
    _size: size,
    _opts: opts,
    start: vi.fn(),
    terminate: vi.fn(),
    render: vi.fn(),
  })),
}));

import { WorkerPoolFactory } from '@/cli/processors/worker-pool-factory.js';
import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import os from 'os';

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
    name: 'test',
    sources: ['./src'],
    level: 'class',
    ...overrides,
  };
}

function mockCpus(count: number): void {
  (os.cpus as any).mockReturnValue(
    new Array(count).fill({
      model: '',
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkerPoolFactory', () => {
  let factory: WorkerPoolFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock implementation after clearAllMocks
    (MermaidRenderWorkerPool as any).mockImplementation((size: number, opts: unknown) => ({
      _size: size,
      _opts: opts,
      start: vi.fn(),
      terminate: vi.fn(),
      render: vi.fn(),
    }));
    factory = new WorkerPoolFactory();
  });

  describe('pool sizing', () => {
    it('single non-Go diagram, 4 CPUs → poolSize = Math.max(1, Math.min(3, 1, 4)) = 1', async () => {
      mockCpus(4);
      const diagrams = [makeDiagram()];
      factory.create(diagrams, makeGlobalConfig());

      const [poolSize] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(poolSize).toBe(1);
    });

    it('10 diagrams, 8 CPUs → poolSize = Math.min(7, 10, 4) = 4', async () => {
      mockCpus(8);
      const diagrams = Array.from({ length: 10 }, (_, i) => makeDiagram({ name: `d${i}` }));
      factory.create(diagrams, makeGlobalConfig());

      const [poolSize] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(poolSize).toBe(4);
    });

    it('Go Atlas diagram with 4 layers, 2 CPUs → effectiveDiagramCount=4, poolSize = Math.max(1, Math.min(1, 4, 4)) = 1', async () => {
      mockCpus(2);
      const diagrams = [
        makeDiagram({
          language: 'go',
          languageSpecific: { atlas: { layers: ['package', 'capability', 'goroutine', 'flow'] } },
        }),
      ];
      factory.create(diagrams, makeGlobalConfig());

      const [poolSize] = (MermaidRenderWorkerPool as any).mock.calls[0];
      // Math.max(1, Math.min(cpus-1, effectiveDiagramCount, 4)) = Math.max(1, Math.min(1, 4, 4)) = 1
      expect(poolSize).toBe(1);
    });

    it('Go Atlas diagram with 4 layers, 8 CPUs → poolSize = Math.min(7, 4, 4) = 4', async () => {
      mockCpus(8);
      const diagrams = [
        makeDiagram({
          language: 'go',
          languageSpecific: { atlas: { layers: ['package', 'capability', 'goroutine', 'flow'] } },
        }),
      ];
      factory.create(diagrams, makeGlobalConfig());

      const [poolSize] = (MermaidRenderWorkerPool as any).mock.calls[0];
      // Math.max(1, Math.min(7, 4, 4)) = 4
      expect(poolSize).toBe(4);
    });
  });

  describe('pool options', () => {
    it('passes theme from globalConfig.mermaid.theme', async () => {
      mockCpus(4);
      const diagrams = [makeDiagram()];
      const config = makeGlobalConfig({ mermaid: { theme: 'dark', transparentBackground: false } });
      factory.create(diagrams, config);

      const [, opts] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(opts.theme).toBe('dark');
    });

    it('passes maxTextSize: 200000', async () => {
      mockCpus(4);
      factory.create([makeDiagram()], makeGlobalConfig());

      const [, opts] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(opts.maxTextSize).toBe(200000);
    });

    it('passes transparentBackground from globalConfig.mermaid', async () => {
      mockCpus(4);
      const config = makeGlobalConfig({
        mermaid: { theme: 'default', transparentBackground: true },
      });
      factory.create([makeDiagram()], config);

      const [, opts] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(opts.transparentBackground).toBe(true);
    });

    it('uses default theme "default" when globalConfig.mermaid is undefined', async () => {
      mockCpus(4);
      const config = makeGlobalConfig({ mermaid: undefined });
      factory.create([makeDiagram()], config);

      const [, opts] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(opts.theme).toBe('default');
    });

    it('passes themeVariables: undefined', async () => {
      mockCpus(4);
      factory.create([makeDiagram()], makeGlobalConfig());

      const [, opts] = (MermaidRenderWorkerPool as any).mock.calls[0];
      expect(opts.themeVariables).toBeUndefined();
    });
  });

  it('create() returns the MermaidRenderWorkerPool instance constructed by the factory', async () => {
    mockCpus(4);
    const result = factory.create([makeDiagram()], makeGlobalConfig());

    // The mock constructor was called once, and the result is the mock instance it returned
    expect(MermaidRenderWorkerPool).toHaveBeenCalledOnce();
    expect(result).toBe((MermaidRenderWorkerPool as any).mock.results[0].value);
  });
});
