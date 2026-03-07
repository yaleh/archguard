/**
 * Unit tests for DiagramOutputRouter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagramOutputRouter } from '@/cli/processors/diagram-output-router.js';
import type { OutputPaths } from '@/cli/processors/diagram-output-router.js';
import type { GlobalConfig } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock MermaidDiagramGenerator (default output path)
vi.mock('@/mermaid/diagram-generator.js', () => ({
  MermaidDiagramGenerator: vi.fn().mockImplementation(() => ({
    generateAndRender: vi.fn().mockResolvedValue(undefined),
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
    renderSVG: vi.fn().mockResolvedValue('<svg viewBox="0 0 100 100"/>'),
    convertSVGToPNG: vi.fn().mockResolvedValue(undefined),
  })),
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
  } as ArchJSON;
}

function makeDiagram(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test',
    sources: ['./src'],
    level: 'class',
    ...overrides,
  } as any;
}

function makePool() {
  return {
    render: vi.fn().mockResolvedValue({ success: true, svg: '<svg viewBox="0 0 10 10"/>' }),
    start: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ---- tests ------------------------------------------------------------------

describe('DiagramOutputRouter', () => {
  let progress: any;

  beforeEach(() => {
    vi.clearAllMocks();
    progress = { start: vi.fn(), succeed: vi.fn(), fail: vi.fn(), update: vi.fn() };
  });

  // --------------------------------------------------------------------------
  // JSON format
  // --------------------------------------------------------------------------

  describe('JSON format', () => {
    it('writes JSON file and returns without entering mermaid branch', async () => {
      const fs = await import('fs-extra');
      const fsMock = (fs as any).default;

      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'json' }), progress);
      const archJSON = makeArchJSON();
      const paths = makePaths();

      await router.route(archJSON, paths, makeDiagram(), null);

      expect(fsMock.writeJson).toHaveBeenCalledOnce();
      expect(fsMock.writeJson).toHaveBeenCalledWith(paths.paths.json, archJSON, { spaces: 2 });
    });

    it('respects diagram.format over globalConfig.format', async () => {
      const fs = await import('fs-extra');
      const fsMock = (fs as any).default;

      // globalConfig is mermaid, but diagram overrides to json
      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'mermaid' }), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ format: 'json' }), null);

      expect(fsMock.writeJson).toHaveBeenCalledOnce();
    });

    it('does not call any mermaid renderer for JSON format', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const router = new DiagramOutputRouter(makeGlobalConfig({ format: 'json' }), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram(), null);

      expect(MermaidDiagramGenerator).not.toHaveBeenCalled();
      expect(IsomorphicMermaidRenderer).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Atlas routing
  // --------------------------------------------------------------------------

  describe('Atlas routing', () => {
    it('routes to generateAtlasOutput when archJSON.extensions.goAtlas is present', async () => {
      const { AtlasRenderer } = await import(
        '@/plugins/golang/atlas/renderers/atlas-renderer.js'
      );

      const archJSON = makeArchJSON({
        language: 'go',
        extensions: {
          goAtlas: {
            layers: {
              package: { nodes: [{ id: 'main', label: 'main', type: 'package' }], edges: [] },
            },
          },
        } as any,
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ language: 'go' }), null);

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
        } as any,
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ language: 'go' }), pool);

      // Pool.render should have been called for the package layer
      expect(pool.render).toHaveBeenCalledWith(
        expect.objectContaining({ mermaidCode: expect.any(String) })
      );
    });

    it('takes Atlas path regardless of diagram.language when goAtlas extension is present', async () => {
      const { AtlasRenderer } = await import(
        '@/plugins/golang/atlas/renderers/atlas-renderer.js'
      );

      const archJSON = makeArchJSON({
        language: 'go',
        extensions: {
          goAtlas: {
            layers: {
              package: { nodes: [{ id: 'main', label: 'main', type: 'package' }], edges: [] },
            },
          },
        } as any,
      });

      // diagram.language is deliberately unset — routing uses archJSON, not diagram
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ language: undefined }), null);

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
        } as any,
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

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
        } as any,
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'class' }), null);

      expect(renderTsModuleGraph).not.toHaveBeenCalled();
      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // C++ package routing
  // --------------------------------------------------------------------------

  describe('C++ package routing', () => {
    it('routes to generateCppPackageOutput when language=cpp and level=package', async () => {
      const { CppPackageFlowchartGenerator } = await import(
        '@/mermaid/cpp-package-flowchart-generator.js'
      );

      const archJSON = makeArchJSON({ language: 'cpp' });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

      expect(CppPackageFlowchartGenerator).toHaveBeenCalled();
    });

    it('does NOT route to C++ package generator when level is not package', async () => {
      const { CppPackageFlowchartGenerator } = await import(
        '@/mermaid/cpp-package-flowchart-generator.js'
      );
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const archJSON = makeArchJSON({ language: 'cpp' });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'class' }), null);

      expect(CppPackageFlowchartGenerator).not.toHaveBeenCalled();
      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });

    it('uses archJSON.language not diagram.language for C++ routing decision', async () => {
      const { CppPackageFlowchartGenerator } = await import(
        '@/mermaid/cpp-package-flowchart-generator.js'
      );

      // archJSON.language is 'cpp' but diagram.language is undefined
      const archJSON = makeArchJSON({ language: 'cpp' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(
        archJSON,
        makePaths(),
        makeDiagram({ level: 'package', language: undefined }),
        null
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
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'class' }), null);

      expect(MermaidDiagramGenerator).toHaveBeenCalled();
      const instance = (MermaidDiagramGenerator as any).mock.results[0].value;
      expect(instance.generateAndRender).toHaveBeenCalledOnce();
    });

    it('routes to MermaidDiagramGenerator for method-level diagram', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), makeDiagram({ level: 'method' }), null);

      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });

    it('routes to MermaidDiagramGenerator for TS package-level diagram without moduleGraph', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const archJSON = makeArchJSON({ language: 'typescript' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

      expect(MermaidDiagramGenerator).toHaveBeenCalled();
    });

    it('passes diagram config to MermaidDiagramGenerator.generateAndRender', async () => {
      const { MermaidDiagramGenerator } = await import('@/mermaid/diagram-generator.js');

      const diagram = makeDiagram({ level: 'class', name: 'my-diagram' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(makeArchJSON(), makePaths(), diagram, null);

      const instance = (MermaidDiagramGenerator as any).mock.results[0].value;
      expect(instance.generateAndRender).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'class',
        diagram
      );
    });
  });

  // --------------------------------------------------------------------------
  // buildRendererOptions (tested indirectly via route())
  // --------------------------------------------------------------------------

  describe('buildRendererOptions (via route)', () => {
    it('wraps string theme as { name: theme } for IsomorphicMermaidRenderer', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({ mermaid: { theme: 'dark' } as any });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ theme: { name: 'dark' } })
      );
    });

    it('passes transparent background when transparentBackground is set', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({
        mermaid: { transparentBackground: true } as any,
      });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundColor: 'transparent' })
      );
    });

    it('passes object theme as-is (no double-wrapping)', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const themeObj = { name: 'forest', fontFamily: 'Arial' };
      const config = makeGlobalConfig({ mermaid: { theme: themeObj as any } as any });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith(
        expect.objectContaining({ theme: themeObj })
      );
    });

    it('returns empty options when no mermaid config provided', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const archJSON = makeArchJSON({ language: 'cpp' });
      const config = makeGlobalConfig({ mermaid: undefined });

      const router = new DiagramOutputRouter(config, progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), null);

      expect(IsomorphicMermaidRenderer).toHaveBeenCalledWith({});
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
        } as any,
      });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      expect(pool.render).toHaveBeenCalledWith(
        expect.objectContaining({ mermaidCode: expect.any(String) })
      );
    });

    it('passes pool to C++ package renderer and calls pool.render', async () => {
      const pool = makePool();
      const archJSON = makeArchJSON({ language: 'cpp' });

      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      expect(pool.render).toHaveBeenCalled();
    });

    it('falls back to main thread when pool.render reports failure', async () => {
      const { IsomorphicMermaidRenderer } = await import('@/mermaid/renderer.js');

      const pool = {
        render: vi.fn().mockResolvedValue({ success: false, error: 'worker crashed' }),
      } as any;

      const archJSON = makeArchJSON({ language: 'cpp' });
      const router = new DiagramOutputRouter(makeGlobalConfig(), progress);
      await router.route(archJSON, makePaths(), makeDiagram({ level: 'package' }), pool);

      // IsomorphicMermaidRenderer.renderSVG should be called as fallback
      const instance = (IsomorphicMermaidRenderer as any).mock.results[0].value;
      expect(instance.renderSVG).toHaveBeenCalled();
    });
  });
});
