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
import { RenderHashCache } from '@/cli/cache/render-hash-cache.js';
import type { RenderOptions } from '@/cli/cache/render-hash-cache.js';
import type { DiagramConfig, GlobalConfig, DetailLevel } from '@/types/config.js';
import type { ArchJSON } from '@/types/index.js';
import type { ProgressReporterLike } from '@/cli/progress.js';
import { canonicalizeArchJson } from '@/cli/utils/canonicalize-arch-json.js';
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
  private readonly progress: ProgressReporterLike;
  private readonly renderCache: RenderHashCache;

  constructor(globalConfig: GlobalConfig, progress: ProgressReporterLike) {
    this.globalConfig = globalConfig;
    this.progress = progress;
    this.renderCache = new RenderHashCache();
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
      await fs.ensureDir(path.dirname(paths.paths.json));
      await fs.writeJson(paths.paths.json, canonicalizeArchJson(archJSON), { spaces: 2 });
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
   * Build RenderOptions (theme string + transparentBackground) from the global config.
   * Used as input to RenderHashCache key computation.
   */
  private buildRenderOptions(): RenderOptions {
    const mermaid = this.globalConfig.mermaid;
    let theme = 'default';
    if (mermaid?.theme) {
      theme =
        typeof mermaid.theme === 'string'
          ? mermaid.theme
          : (mermaid.theme as { name?: string }).name ?? 'default';
    }
    return {
      theme,
      transparentBackground: mermaid?.transparentBackground ?? false,
    };
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
    options.backgroundColor = this.globalConfig.mermaid?.transparentBackground
      ? 'transparent'
      : 'white';
    return options;
  }

  /**
   * Inject background-color into the SVG root element style attribute.
   * Used to post-process SVGs returned by the worker pool, which bypasses
   * IsomorphicMermaidRenderer.renderSVG() and returns raw Mermaid output.
   */
  private injectBackground(svg: string): string {
    const transparent = this.globalConfig.mermaid?.transparentBackground;
    if (transparent) return svg;
    const bg = 'white';
    const styleMatch = svg.match(/<svg[^>]*style="([^"]*)"/);
    if (styleMatch) {
      return svg.replace(/(<svg[^>]*style=")([^"]*)(")/g, `$1$2; background-color: ${bg};$3`);
    }
    return svg.replace(/<svg/, `<svg style="background-color: ${bg};"`);
  }

  /**
   * Generate standard Mermaid class/method/package diagram output via MermaidDiagramGenerator.
   * Uses generateOnly + manual render so we can apply RenderHashCache per job.
   */
  private async generateDefaultOutput(
    archJSON: ArchJSON,
    paths: OutputPaths,
    level: DetailLevel,
    diagram: DiagramConfig,
    pool: MermaidRenderWorkerPool | null
  ): Promise<void> {
    const renderOptions = this.buildRenderOptions();
    const mermaidGenerator = new MermaidDiagramGenerator(this.globalConfig, this.progress);

    const jobs = await mermaidGenerator.generateOnly(
      archJSON,
      {
        outputDir: paths.paths.mmd.replace(/\/[^/]+$/, ''),
        baseName: paths.paths.mmd.replace(/^.*\/([^/]+)\.mmd$/, '$1'),
        paths: paths.paths,
      },
      level,
      diagram
    );

    const { IsomorphicMermaidRenderer, inlineEdgeStyles } = await import('@/mermaid/renderer.js');
    const mermaidRenderer = new IsomorphicMermaidRenderer(this.buildRendererOptions() as any);

    for (const job of jobs) {
      await fs.ensureDir(path.dirname(job.outputPath.mmd));
      await fs.writeFile(job.outputPath.mmd, job.mermaidCode, 'utf-8');

      if (await this.renderCache.checkHit(job.outputPath.mmd, job.mermaidCode, renderOptions)) {
        continue; // Cache hit — skip rendering
      }

      // Render SVG: use worker pool if available, fall back to main thread
      let svg: string;
      if (pool) {
        const poolResult = await pool.render({ mermaidCode: job.mermaidCode });
        if (!poolResult.success) {
          console.warn(
            `  Worker render failed: ${poolResult.error} — falling back to main thread`
          );
          svg = await mermaidRenderer.renderSVG(job.mermaidCode);
        } else {
          svg = this.injectBackground(poolResult.svg!);
        }
      } else {
        svg = await mermaidRenderer.renderSVG(job.mermaidCode);
      }

      const processedSvg = typeof inlineEdgeStyles === 'function' ? inlineEdgeStyles(svg) : svg;
      await Promise.all([
        fs.writeFile(job.outputPath.svg, processedSvg, 'utf-8'),
        mermaidRenderer
          .convertSVGToPNG(processedSvg, job.outputPath.png)
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  ${job.name} PNG skipped (${msg}) — MMD + SVG saved`);
          }),
      ]);

      await this.renderCache.writeHash(job.outputPath.mmd, job.mermaidCode, renderOptions);
    }
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

    console.error('\n  Generating Go Architecture Atlas...');

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

        // Write MMD unconditionally; attempt PNG separately so large
        // diagrams that exceed the pixel limit still produce MMD + SVG.
        await fs.ensureDir(path.dirname(layerPaths.mmd));
        await fs.writeFile(layerPaths.mmd, result.content, 'utf-8');

        const renderOptions = this.buildRenderOptions();
        if (await this.renderCache.checkHit(layerPaths.mmd, result.content, renderOptions)) {
          console.error(`  ${layer}: cached`);
          return; // Cache hit — skip rendering this layer
        }

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
            svg = this.injectBackground(poolResult.svg!);
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
        await this.renderCache.writeHash(layerPaths.mmd, result.content, renderOptions);
        console.error(`  ${layer}: ${layerPaths.mmd}${pngFailed ? ' (no PNG)' : ''}`);
      })
    );

    // Save full Atlas JSON alongside the layer diagrams
    const atlasJsonPath = `${basePath}-atlas.json`;
    await fs.writeJson(atlasJsonPath, atlas, { spaces: 2 });
    console.error(`  Atlas JSON: ${atlasJsonPath}`);
    console.error(`\n  Atlas layers: ${availableLayers.join(', ')}`);
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

    const renderOptions = this.buildRenderOptions();
    if (await this.renderCache.checkHit(paths.paths.mmd, mmdContent, renderOptions)) {
      return; // Cache hit
    }

    // Render SVG: use worker pool if available, fall back to main thread
    let svg: string;
    if (pool) {
      const poolResult = await pool.render({ mermaidCode: mmdContent });
      if (!poolResult.success) {
        console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
        svg = await mermaidRenderer.renderSVG(mmdContent);
      } else {
        svg = this.injectBackground(poolResult.svg!);
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

    await this.renderCache.writeHash(paths.paths.mmd, mmdContent, renderOptions);
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

    const renderOptions = this.buildRenderOptions();
    if (await this.renderCache.checkHit(paths.paths.mmd, mmdContent, renderOptions)) {
      return; // Cache hit
    }

    // Render SVG: use worker pool if available, fall back to main thread
    let svg: string;
    if (pool) {
      const poolResult = await pool.render({ mermaidCode: mmdContent });
      if (!poolResult.success) {
        console.warn(`  Worker render failed: ${poolResult.error} — falling back to main thread`);
        svg = await mermaidRenderer.renderSVG(mmdContent);
      } else {
        svg = this.injectBackground(poolResult.svg!);
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

    await this.renderCache.writeHash(paths.paths.mmd, mmdContent, renderOptions);
  }
}
