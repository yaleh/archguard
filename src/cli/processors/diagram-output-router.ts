/**
 * DiagramOutputRouter - Routes ArchJSON to the appropriate file-output generator
 *
 * Responsible for:
 * - Dispatching based on output format (json vs mermaid)
 * - Routing mermaid output to the correct renderer (Atlas, TS module graph, C++ package, default)
 * - Constructing renderer options from global config (shared helper)
 *
 * @module cli/processors/diagram-output-router
 */

import { MermaidDiagramGenerator } from '@/mermaid/diagram-generator.js';
import { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import type { DiagramConfig, GlobalConfig, DetailLevel } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporter } from '@/cli/progress.js';
import fs from 'fs-extra';
import path from 'path';

/**
 * Resolved output file paths for a single diagram.
 * Matches the shape returned by OutputPathResolver.resolve().
 */
export type OutputPaths = {
  paths: {
    json: string;
    mmd: string;
    png: string;
    svg: string;
  };
};

/**
 * DiagramOutputRouter
 *
 * Routes a fully-aggregated ArchJSON object to the appropriate output generator
 * based on format, ArchJSON extensions, and language.
 *
 * Usage:
 * ```typescript
 * const router = new DiagramOutputRouter(globalConfig, progress);
 * await router.route(archJSON, { paths }, diagram, pool);
 * ```
 */
export class DiagramOutputRouter {
  private readonly globalConfig: GlobalConfig;
  private readonly progress: ProgressReporter;

  constructor(globalConfig: GlobalConfig, progress: ProgressReporter) {
    this.globalConfig = globalConfig;
    this.progress = progress;
  }

  /**
   * Route the given ArchJSON to the appropriate output generator.
   *
   * Dispatch order:
   * 1. json format  → write JSON file directly
   * 2. mermaid + goAtlas extension → generateAtlasOutput
   * 3. mermaid + tsAnalysis.moduleGraph + level=package → generateTsModuleGraphOutput
   * 4. mermaid + language=cpp + level=package → generateCppPackageOutput
   * 5. mermaid (all other) → generateDefaultOutput (MermaidDiagramGenerator)
   */
  async route(
    archJSON: ArchJSON,
    paths: OutputPaths,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> {
    const format = diagram.format ?? this.globalConfig.format;
    const level = diagram.level;

    // Step 1: json format
    if (format === 'json') {
      await fs.writeJson(paths.paths.json, archJSON, { spaces: 2 });
      return;
    }

    // Step 2: mermaid routing — based on ArchJSON extensions and archJSON.language
    // NOTE: uses archJSON.extensions / archJSON.language, NOT diagram.language
    if (archJSON.extensions?.goAtlas) {
      await this.generateAtlasOutput(archJSON, paths, diagram, pool);
    } else if (level === 'package' && archJSON.extensions?.tsAnalysis?.moduleGraph) {
      await this.generateTsModuleGraphOutput(archJSON, paths, diagram, pool);
    } else if (level === 'package' && archJSON.language === 'cpp') {
      await this.generateCppPackageOutput(archJSON, paths, pool);
    } else {
      await this.generateDefaultOutput(archJSON, paths, level, diagram, pool);
    }
  }

  /**
   * Build IsomorphicMermaidRenderer options from the global config.
   * Theme is wrapped as { name: string } when it is a bare string.
   */
  private buildRendererOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (this.globalConfig.mermaid?.theme) {
      options.theme =
        typeof this.globalConfig.mermaid.theme === 'string'
          ? { name: this.globalConfig.mermaid.theme }
          : this.globalConfig.mermaid.theme;
    }
    if (this.globalConfig.mermaid?.transparentBackground) {
      options.backgroundColor = 'transparent';
    }
    return options;
  }

  /**
   * Generate standard Mermaid class/method/package diagram output via MermaidDiagramGenerator.
   */
  private async generateDefaultOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    level: DetailLevel,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> {
    const mermaidGenerator = new MermaidDiagramGenerator(this.globalConfig, this.progress);
    await mermaidGenerator.generateAndRender(
      archJSON,
      {
        outputDir: paths.paths.mmd.replace(/\/[^/]+$/, ''),
        baseName: paths.paths.mmd.replace(/^.*\/([^/]+)\.mmd$/, '$1'),
        paths: paths.paths,
      },
      level,
      diagram
    );
  }

  /**
   * Generate Go Architecture Atlas output (4-layer flowchart diagrams).
   *
   * Renders each requested Atlas layer as a separate Mermaid flowchart file:
   *   {name}-package.mmd/svg/png    - Package dependency graph
   *   {name}-capability.mmd/svg/png - Capability graph
   *   {name}-goroutine.mmd/svg/png  - Goroutine topology
   *   {name}-flow.mmd/svg/png       - Flow graph
   *   {name}-atlas.json             - Full Atlas data
   */
  private async generateAtlasOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> {
    const { AtlasRenderer } = await import('@/plugins/golang/atlas/renderers/atlas-renderer.js');
    const { IsomorphicMermaidRenderer, inlineEdgeStyles } = await import('@/mermaid/renderer.js');

    const atlas = archJSON.extensions.goAtlas;
    const renderer = new AtlasRenderer();

    // Determine which layers to render (from config or default to all 4)
    const requestedLayers: string[] = (
      diagram.languageSpecific?.atlas as { layers?: string[] } | undefined
    )?.layers ?? ['package', 'capability', 'goroutine', 'flow'];

    // Only render layers that have actual data
    const availableLayers = requestedLayers.filter(
      (layer) => atlas.layers[layer as keyof typeof atlas.layers]
    );

    // Derive base path by stripping .mmd extension
    const basePath = paths.paths.mmd.replace(/\.mmd$/, '');

    const mermaidRenderer = new IsomorphicMermaidRenderer(this.buildRendererOptions() as any);

    console.log('\n  Generating Go Architecture Atlas...');

    await Promise.all(
      availableLayers.map(async (layer) => {
        const result = await renderer.render(
          atlas,
          layer as Parameters<typeof renderer.render>[1],
          'mermaid'
        );

        const layerPaths = {
          mmd: `${basePath}-${layer}.mmd`,
          svg: `${basePath}-${layer}.svg`,
          png: `${basePath}-${layer}.png`,
        };

        // Write MMD and SVG unconditionally; attempt PNG separately so large
        // diagrams that exceed the pixel limit still produce MMD + SVG.
        await fs.ensureDir(path.dirname(layerPaths.mmd));
        await fs.writeFile(layerPaths.mmd, result.content, 'utf-8');

        // Render SVG: use worker pool if available, fall back to main thread
        let svg: string;
        if (pool) {
          const poolResult = await pool.render({ mermaidCode: result.content });
          if (!poolResult.success) {
            console.warn(
              `  Worker render failed: ${poolResult.error} — falling back to main thread`
            );
            svg = await mermaidRenderer.renderSVG(result.content);
          } else {
            svg = poolResult.svg!;
          }
        } else {
          svg = await mermaidRenderer.renderSVG(result.content);
        }

        const processedSvg =
          typeof inlineEdgeStyles === 'function' ? inlineEdgeStyles(svg) : svg;
        let pngFailed = false;
        await Promise.all([
          fs.writeFile(layerPaths.svg, processedSvg, 'utf-8'),
          mermaidRenderer.convertSVGToPNG(processedSvg, layerPaths.png).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  ${layer} PNG skipped (${msg}) — MMD + SVG saved`);
            pngFailed = true;
          }),
        ]);
        console.log(`  ${layer}: ${layerPaths.mmd}${pngFailed ? ' (no PNG)' : ''}`);
      })
    );

    // Save full Atlas JSON alongside the layer diagrams
    const atlasJsonPath = `${basePath}-atlas.json`;
    await fs.writeJson(atlasJsonPath, atlas, { spaces: 2 });
    console.log(`  Atlas JSON: ${atlasJsonPath}`);
    console.log(`\n  Atlas layers: ${availableLayers.join(', ')}`);
  }

  /**
   * Generate TypeScript module dependency graph output.
   *
   * Renders a TsModuleGraph as a Mermaid flowchart diagram:
   *   {name}.mmd  - Mermaid source
   *   {name}.svg  - SVG rendering
   *   {name}.png  - PNG rendering (best effort)
   */
  private async generateTsModuleGraphOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    _diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> {
    const { renderTsModuleGraph } = await import('@/mermaid/ts-module-graph-renderer.js');
    const { IsomorphicMermaidRenderer, inlineEdgeStyles } = await import('@/mermaid/renderer.js');

    const moduleGraph = archJSON.extensions.tsAnalysis.moduleGraph;
    const mmdContent = renderTsModuleGraph(moduleGraph);

    const mermaidRenderer = new IsomorphicMermaidRenderer(this.buildRendererOptions() as any);

    await fs.ensureDir(path.dirname(paths.paths.mmd));
    await fs.writeFile(paths.paths.mmd, mmdContent, 'utf-8');

    // Render SVG: use worker pool if available, fall back to main thread
    let svg: string;
    if (pool) {
      const poolResult = await pool.render({ mermaidCode: mmdContent });
      if (!poolResult.success) {
        console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
        svg = await mermaidRenderer.renderSVG(mmdContent);
      } else {
        svg = poolResult.svg!;
      }
    } else {
      svg = await mermaidRenderer.renderSVG(mmdContent);
    }

    const processedSvg = typeof inlineEdgeStyles === 'function' ? inlineEdgeStyles(svg) : svg;
    await Promise.all([
      fs.writeFile(paths.paths.svg, processedSvg, 'utf-8'),
      mermaidRenderer.convertSVGToPNG(processedSvg, paths.paths.png).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  TS module graph PNG skipped (${msg}) — MMD + SVG saved`);
      }),
    ]);
  }

  /**
   * Generate C++ package-level flowchart output.
   *
   * Renders a C++ package dependency graph as a Mermaid flowchart LR diagram:
   *   {name}.mmd  - Mermaid source
   *   {name}.svg  - SVG rendering
   *   {name}.png  - PNG rendering (best effort)
   */
  private async generateCppPackageOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> {
    const { CppPackageFlowchartGenerator } =
      await import('@/mermaid/cpp-package-flowchart-generator.js');
    const { IsomorphicMermaidRenderer, inlineEdgeStyles } = await import('@/mermaid/renderer.js');

    const generator = new CppPackageFlowchartGenerator();
    const mmdContent = generator.generate(archJSON);

    const mermaidRenderer = new IsomorphicMermaidRenderer(this.buildRendererOptions() as any);

    await fs.ensureDir(path.dirname(paths.paths.mmd));
    await fs.writeFile(paths.paths.mmd, mmdContent, 'utf-8');

    // Render SVG: use worker pool if available, fall back to main thread
    let svg: string;
    if (pool) {
      const poolResult = await pool.render({ mermaidCode: mmdContent });
      if (!poolResult.success) {
        console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
        svg = await mermaidRenderer.renderSVG(mmdContent);
      } else {
        svg = poolResult.svg!;
      }
    } else {
      svg = await mermaidRenderer.renderSVG(mmdContent);
    }

    const processedSvg = typeof inlineEdgeStyles === 'function' ? inlineEdgeStyles(svg) : svg;
    await Promise.all([
      fs.writeFile(paths.paths.svg, processedSvg, 'utf-8'),
      mermaidRenderer.convertSVGToPNG(processedSvg, paths.paths.png).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  C++ package graph PNG skipped (${msg}) — MMD + SVG saved`);
      }),
    ]);
  }
}
