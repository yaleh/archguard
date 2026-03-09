/**
 * Unit tests for DiagramOutputRouter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagramOutputRouter } from '@/cli/processors/diagram-output-router.js';
import type { OutputPaths } from '@/cli/processors/diagram-output-router.js';
import type { GlobalConfig, DiagramConfig, MermaidConfig } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporterLike } from '@/cli/progress.js';
import type { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock RenderHashCache
vi.mock('@/cli/cache/render-hash-cache.js', () => ({
  RenderHashCache: vi.fn().mockImplementation(() => ({
    checkHit: vi.fn().mockResolvedValue(false), // default: cache miss → always render
    writeHash: vi.fn().mockResolvedValue(undefined),
    clearHashes: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock MermaidDiagramGenerator (default output path)
vi.mock('@/mermaid/diagram-generator.js', () => ({
  MermaidDiagramGenerator: vi.fn().mockImplementation(() => ({
    generateOnly: vi.fn().mockResolvedValue([
      {
        name: 'test',
        mermaidCode: 'classDiagram\n  class Foo',
        outputPath: {
          mmd: '/out/diagram.mmd',
          svg: '/out/diagram.svg',
          png: '/out/diagram.png',
        },
      },
    ]),
  })),
}));

// Mock AtlasRenderer (Go Atlas path)
vi.mock('@/plugins/golang/atlas/renderers/atlas-renderer.js', () => ({
  AtlasRenderer: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockResolvedValue({ content: 'flowchart LR\n  A --> B', format: 'mermaid' }),
  })),
}));

// Mock IsomorphicMermaidRenderer and inlineEdgeStyles
vi.mock('@/mermaid/renderer.js', () => ({
  inlineEdgeStyles: vi.fn().mockImplementation((svg: string) => svg),
  IsomorphicMermaidRenderer: vi.fn().mockImplementation(() => ({
    renderSVGRaw: vi.fn().mockResolvedValue('<svg viewBox="0 0 100 100"/>'),
    renderSVG: vi
      .fn()
      .mockResolvedValue('<svg viewBox="0 0 100 100" style="background-color: white;"/>'),
    convertSVGToPNG: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock postProcessSVG
vi.mock('@/mermaid/post-process-svg.js', () => ({
  postProcessSVG: vi.fn().mockImplementation((svg: string) => svg + '<!-- processed -->'),
}));

// Mock TS module graph renderer
vi.mock('@/mermaid/ts-module-graph-renderer.js', () => ({
  renderTsModuleGraph: vi.fn().mockReturnValue('flowchart LR\n  mod1 --> mod2'),
}));

// Mock C++ package flowchart generator
vi.mock('@/mermaid/cpp-package-flowchart-generator.js', () => ({
  CppPackageFlowchartGenerator: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockReturnValue('flowchart LR\n  pkgA --> pkgB'),
  })),
}));

// ---- typed mock helpers -----------------------------------------------------

interface FsMock {
  writeJson: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  ensureDir: ReturnType<typeof vi.fn>;
}

async function getFsMock(): Promise<FsMock> {
  const fs = await import('fs-extra');
  return (fs as unknown as { default: FsMock }).default;
}

// ---- helpers ----------------------------------------------------------------

function makeGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    format: 'mermaid',
    outputDir: './.archguard',
    exclude: [],
    ...overrides,
  } as GlobalConfig;
}

function makePaths(): OutputPaths {
  return {
    paths: {
      json: '/out/diagram.json',
      mmd: '/out/diagram.mmd',
      svg: '/out/diagram.svg',
      png: '/out/diagram.png',
    },
  };
}

function makeArchJSON(overrides: Partial<ArchJSON> = {}): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '',
    sourceFiles: [],
    entities: [],
    relations: [],
    ...overrides,
  } as unknown as ArchJSON;
}

function makeDiagram(overrides: Partial<DiagramConfig> = {}): DiagramConfig {
  return {
    name: 'test',
    sources: ['./src'],
    level: 'class',
    ...overrides,
  } as DiagramConfig;
}

function makePool(): MermaidRenderWorkerPool {
  return {
    render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 10 10"/>' }),
    start: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
  } as unknown as MermaidRenderWorkerPool;
}

// ---- tests ------------------------------------------------------------------

describe('DiagramOutputRouter', () => {
  let progress: ProgressReporterLike;

  beforeEach(() => {
    vi.clearAllMocks();
    progress = {
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
  });

  // --------------------------------------------------------------------------
  // JSON format
  // --------------------------------------------------------------------------

  describe('JSON format', () => {
    it('writes JSON file and returns without entering mermaid branch', async () => {
      const fsMock = await getFsMock();

      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'json' }), progress);
      const archJSON = makeArchJSON();
      const paths = makePaths();

      await router.route(archJSON, paths, makeDiagram(), makePool());

      expect(fsMock.writeJson).toHaveBeenCalledOnce();
      expect(fsMock.ensureDir).toHaveBeenCalledWith('/out');
      expect(fsMock.writeJson).toHaveBeenCalledWith(paths.paths.json, archJSON, { spaces: 2 });
    });

    it('ensures the JSON parent directory before writing nested output paths', async () => {
      const fsMock = await getFsMock();

      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'json' }), progress);
      const paths: OutputPaths = {
        paths: {
          json: '/out/method/utils.json',
          mmd: '/out/method/utils.mmd',
          svg: '/out/method/utils.svg',
          png: '/out/method/utils.png',
        },
      };

      await router.route(makeArchJSON(), paths, makeDiagram({ level: 'method' }), makePool());

      expect(fsMock.ensureDir).toHaveBeenCalledWith('/out/method');
      expect(fsMock.writeJson).toHaveBeenCalledWith(paths.paths.json, expect.any(Object), {
        spaces: 2,
      });
    });

    it('canonicalizes JSON output before writing it to disk', async () => {
      const fsMock = await getFsMock();

      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'json' }), progress);
      const archJSON = makeArchJSON({
        sourceFiles: ['src/z.ts', 'src/a.ts'],
        entities: [
          {
            id: 'b',
            name: 'B',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/z.ts', startLine: 1, endLine: 2 },
          },
          {
            id: 'a',
            name: 'A',
            type: 'class',
            visibility: 'public',
            members: [],
            sourceLocation: { file: 'src/a.ts', startLine: 1, endLine: 2 },
          },
        ],
        relations: [
          { id: 'r2', type: 'dependency', source: 'b', target: 'a' },
          { id: 'r1', type: 'dependency', source: 'a', target: 'b' },
        ],
      });

      await router.route(archJSON, makePaths(), makeDiagram(), makePool());

      const writtenJson = fsMock.writeJson.mock.calls[0][1] as ArchJSON;
      expect(writtenJson.sourceFiles).toEqual(['src/a.ts', 'src/z.ts']);
      expect(writtenJson.entities.map((entity) => entity.id)).toEqual(['a', 'b']);
      expect(writtenJson.relations.map((relation) => relation.id)).toEqual(['r1', 'r2']);
    });

    it('respects diagram.format over globalConfig.format', async () => {
      const fsMock = await getFsMock();

      // globalConfig is mermaid, but diagram overrides to json
      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'mermaid' }), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ format: 'json' }), makePool());

      expect(fsMock.writeJson).toHaveBeenCalledOnce();
    });

    it('does not call any mermaid renderer for JSON format', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'json' }), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram(), makePool());

      expect(MermaidDiagramGenerator).not.toHaveBeenCalled();
      expect(IsomorphicMermaidRenderer).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Atlas routing
  // --------------------------------------------------------------------------

  describe('Atlas routing', () => {
    it('routes to generateAtlasOutput when archJSON.extensions.goAtlas is present', async () => {
      const { AtlasRenderer } = await import('@/plugins/golang/atlas/renderers/atlas-renderer.js');

      const archJSON = makeArchJSON({
        language: 'go',
        extensions: {
          goAtlas: {
            layers: {
              package: { nodes: [{ id: 'main', label: 'main', type: 'package' }], edges: [] },
            },
          },
        } as unknown as ArchJSON['extensions'],
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ language: 'go' }), makePool());

      expect(AtlasRenderer).toHaveBeenCalled();
    });

    it('passes worker pool through to Atlas renderer (pool.render called)', async () => {
      const pool = makePool();
      const archJSON = makeArchJSON({
        language: 'go',
        extensions: {
          goAtlas: {
            layers: {
              package: { nodes: [{ id: 'main', label: 'main', type: 'package' }], edges: [] },
            },
          },
        } as unknown as ArchJSON['extensions'],
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ language: 'go' }), pool);

      // Pool.render should have been called for the package layer
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(pool.render).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ mermaidCode: expect.any(String) })
      );
    });

    it('takes Atlas path regardless of diagram.language when goAtlas extension is present', async () => {
      const { AtlasRenderer } = await import('@/plugins/golang/atlas/renderers/atlas-renderer.js');

      const archJSON = makeArchJSON({
        language: 'go',
        extensions: {
          goAtlas: {
            layers: {
              package: { nodes: [{ id: 'main', label: 'main', type: 'package' }], edges: [] },
            },
          },
        } as unknown as ArchJSON['extensions'],
      });

      // diagram.language is deliberately unset — routing uses archJSON, not diagram
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ language: undefined }), makePool());

      expect(AtlasRenderer).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // TS module graph routing
  // --------------------------------------------------------------------------

  describe('TS module graph routing', () => {
    it('routes to generateTsModuleGraphOutput when tsAnalysis.moduleGraph present and level=package', async () => {
      const { renderTsModuleGraph } = await import('@/mermaid/ts-module-graph-renderer.js');

      const archJSON = makeArchJSON({
        extensions: {
          tsAnalysis: {
            version: '1.0',
            moduleGraph: {
              nodes: [{ id: 'src/core', name: 'core', type: 'internal', fileCount: 1, stats: {} }],
              edges: [],
              cycles: [],
            },
          },
        } as unknown as ArchJSON['extensions'],
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(renderTsModuleGraph).toHaveBeenCalledOnce();
    });

    it('does NOT route to TS module graph when level is not package', async () => {
      const { renderTsModuleGraph } = await import('@/mermaid/ts-module-graph-renderer.js');
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const archJSON = makeArchJSON({
        extensions: {
          tsAnalysis: {
            version: '1.0',
            moduleGraph: { nodes: [], edges: [], cycles: [] },
          },
        } as unknown as ArchJSON['extensions'],
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'class' }), makePool());

      expect(renderTsModuleGraph).not.toHaveBeenCalled();
      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // C++ package routing
  // --------------------------------------------------------------------------

  describe('C++ package routing', () => {
    it('routes to generateCppPackageOutput when language=cpp and level=package', async () => {
      const { CppPackageFlowchartGenerator } =
        await import('@/mermaid/cpp-package-flowchart-generator.js');

      const archJSON = makeArchJSON({ language: 'cpp' });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(CppPackageFlowchartGenerator).toHaveBeenCalled();
    });

    it('does NOT route to C++ package generator when level is not package', async () => {
      const { CppPackageFlowchartGenerator } =
        await import('@/mermaid/cpp-package-flowchart-generator.js');
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const archJSON = makeArchJSON({ language: 'cpp' });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'class' }), makePool());

      expect(CppPackageFlowchartGenerator).not.toHaveBeenCalled();
      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });

    it('uses archJSON.language not diagram.language for C++ routing decision', async () => {
      const { CppPackageFlowchartGenerator } =
        await import('@/mermaid/cpp-package-flowchart-generator.js');

      // archJSON.language is 'cpp' but diagram.language is undefined
      const archJSON = makeArchJSON({ language: 'cpp' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(
        archJSON,
        makePaths(),
        makeDiagram({ level: 'package', language: undefined }),
        makePool()
      );

      expect(CppPackageFlowchartGenerator).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Default routing
  // --------------------------------------------------------------------------

  describe('Default routing', () => {
    it('routes to MermaidDiagramGenerator for standard TypeScript class diagram', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'class' }), makePool());

      expect(MermaidDiagramGenerator).toHaveBeenCalled();
      const instance = vi.mocked(MermaidDiagramGenerator).mock.results[0]?.value as
        | { generateOnly: ReturnType<typeof vi.fn> }
        | undefined;
      expect(instance?.generateOnly).toHaveBeenCalledOnce();
    });

    it('routes to MermaidDiagramGenerator for method-level diagram', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'method' }), makePool());

      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });

    it('routes to MermaidDiagramGenerator for TS package-level diagram without moduleGraph', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const archJSON = makeArchJSON({ language: 'typescript' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });

    it('passes diagram config to MermaidDiagramGenerator.generateOnly', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const diagram = makeDiagram({ level: 'class', name: 'my-diagram' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), diagram, makePool());

      const instance = vi.mocked(MermaidDiagramGenerator).mock.results[0]?.value as
        | { generateOnly: ReturnType<typeof vi.fn> }
        | undefined;
      expect(instance?.generateOnly).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'class',
        diagram
      );
    });
  });

  // --------------------------------------------------------------------------
  // Render cache
  // --------------------------------------------------------------------------

  describe('Render cache', () => {
    it('cache hit skips SVG rendering (IsomorphicMermaidRenderer.renderSVG not called)', async () => {
      const { RenderHashCache } = await import('@/cli/cache/render-hash-cache.js');
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      // Override checkHit for this test
      const MockedRenderHashCache = vi.mocked(RenderHashCache);
      const cacheInstance = new MockedRenderHashCache() as unknown as {
        checkHit: ReturnType<typeof vi.fn>;
        writeHash: ReturnType<typeof vi.fn>;
      };
      cacheInstance.checkHit.mockResolvedValue(true);

      // Rebuild mock so the router picks up a hitting cache
      MockedRenderHashCache.mockImplementationOnce(
        () => cacheInstance as unknown as InstanceType<typeof RenderHashCache>
      );

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'class' }), makePool());

      const rendererInstance = vi.mocked(IsomorphicMermaidRenderer).mock.results[0]?.value as
        | { renderSVG: ReturnType<typeof vi.fn> }
        | undefined;
      // renderSVG must NOT have been called on a cache hit
      if (rendererInstance) {
        expect(rendererInstance.renderSVG).not.toHaveBeenCalled();
      }
    });

    it('cache miss triggers SVG rendering and writes hash', async () => {
      const { RenderHashCache } = await import('@/cli/cache/render-hash-cache.js');

      // Default checkHit = false (cache miss) — already set in the top-level mock
      const pool = makePool();
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'class' }), pool);

      // pool.render must have been called (pool is the rendering path now)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(pool.render).toHaveBeenCalled();

      // writeHash must have been called
      const cacheInstances = vi.mocked(RenderHashCache).mock.results;
      const anyWriteHashCalled = cacheInstances.some(
        (r) =>
          (r.value as unknown as { writeHash?: { mock?: { calls?: unknown[] } } })?.writeHash?.mock
            ?.calls?.length ?? 0 > 0
      );
      expect(anyWriteHashCalled).toBe(true);
    });

    it('each render job is checked independently (one job = one checkHit call)', async () => {
      const { RenderHashCache } = await import('@/cli/cache/render-hash-cache.js');

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'class' }), makePool());

      // The mock generateOnly returns 1 job, so checkHit should be called once
      const cacheInstances = vi.mocked(RenderHashCache).mock.results;
      const totalCheckHitCalls = cacheInstances.reduce(
        (sum: number, r) =>
          sum +
          ((r.value as unknown as { checkHit?: { mock?: { calls?: unknown[] } } })?.checkHit?.mock
            ?.calls?.length ?? 0),
        0
      );
      expect(totalCheckHitCalls).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // buildRendererOptions (tested indirectly via route())
  // --------------------------------------------------------------------------

  describe('buildRendererOptions (via route)', () => {
    it('wraps string theme as { name: theme } for IsomorphicMermaidRenderer', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({ mermaid: { theme: 'dark' } as MermaidConfig });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ theme: { name: 'dark' } })
      );
    });

    it('passes transparent background when transparentBackground is set', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({
        mermaid: { transparentBackground: true } as MermaidConfig,
      });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundColor: 'transparent' })
      );
    });

    it('passes object theme as-is (no double-wrapping)', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const themeObj = { name: 'forest', fontFamily: 'Arial' };
      const config = makeGlobalConfig({
        mermaid: { theme: themeObj as unknown as MermaidConfig['theme'] } as MermaidConfig,
      });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ theme: themeObj })
      );
    });

    it('uses white background when no mermaid config provided', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({ mermaid: undefined });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundColor: 'white' })
      );
    });

    it('uses white background when transparentBackground is false', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({
        mermaid: { transparentBackground: false } as MermaidConfig,
      });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundColor: 'white' })
      );
    });

    it('uses white background when transparentBackground is not set in mermaid config', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({ mermaid: { theme: 'forest' } as MermaidConfig });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), makePool());

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundColor: 'white' })
      );
    });
  });

  // --------------------------------------------------------------------------
  // Worker pool pass-through
  // --------------------------------------------------------------------------

  describe('Worker pool pass-through', () => {
    it('passes pool to TS module graph renderer and calls pool.render', async () => {
      const pool = makePool();
      const archJSON = makeArchJSON({
        extensions: {
          tsAnalysis: {
            version: '1.0',
            moduleGraph: {
              nodes: [{ id: 'src/core', name: 'core', type: 'internal', fileCount: 1, stats: {} }],
              edges: [],
              cycles: [],
            },
          },
        } as unknown as ArchJSON['extensions'],
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(pool.render).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ mermaidCode: expect.any(String) })
      );
    });

    it('passes pool to C++ package renderer and calls pool.render', async () => {
      const pool = makePool();
      const archJSON = makeArchJSON({ language: 'cpp' });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(pool.render).toHaveBeenCalled();
    });

    it('falls back to main thread when pool.render reports failure — uses renderSVGRaw + postProcessSVG', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');
      const { postProcessSVG } = await import('@/mermaid/post-process-svg.js');

      const pool = {
        render: vi.fn().mockResolvedValue({ success: false, error: 'worker crashed' }),
      } as unknown as MermaidRenderWorkerPool;

      const archJSON = makeArchJSON({ language: 'cpp' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      // renderSVGRaw (not renderSVG) should be called as fallback
      const instance = vi.mocked(IsomorphicMermaidRenderer).mock.results[0]?.value as
        | { renderSVGRaw: ReturnType<typeof vi.fn>; renderSVG: ReturnType<typeof vi.fn> }
        | undefined;
      expect(instance?.renderSVGRaw).toHaveBeenCalled();
      expect(instance?.renderSVG).not.toHaveBeenCalled();
      // postProcessSVG must be called on the raw SVG
      expect(postProcessSVG).toHaveBeenCalled();
    });

    it('pool success path: writes poolResult.svg directly (no additional inlineEdgeStyles wrapping)', async () => {
      const fsMock = await getFsMock();
      const { inlineEdgeStyles } = await import('@/mermaid/renderer.js');

      const poolSvg = '<svg viewBox="0 0 10 10"><!-- worker-processed --></svg>';
      const pool = {
        render: vi.fn().mockResolvedValue({ success: true, svg: poolSvg }),
      } as unknown as MermaidRenderWorkerPool;

      const archJSON = makeArchJSON({ language: 'cpp' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      // The exact poolSvg should be written (no background injection, no extra wrapping)
      const svgCall = (fsMock.writeFile.mock.calls as unknown[]).find(
        (call) => Array.isArray(call) && typeof call[0] === 'string' && call[0].endsWith('.svg')
      ) as [string, string, string] | undefined;
      expect(svgCall).toBeDefined();
      expect(svgCall?.[1]).toBe(poolSvg);
      // inlineEdgeStyles should NOT be called (post-processing done inside worker)
      expect(inlineEdgeStyles).not.toHaveBeenCalled();
    });
  });
});
