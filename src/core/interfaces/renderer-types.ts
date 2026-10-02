/**
 * Renderer-facing types shared between the core interface layer and the mermaid
 * implementation layer.
 *
 * These describe the *contract* between a renderer facade and its callers, so
 * they belong in the core interface layer (below mermaid). `renderer-facade.ts`
 * and `src/mermaid/diagram-generator.ts` both re-export them, so existing import
 * paths on either side keep working (layer guard:
 * tests/unit/architecture/layer-imports.test.ts — core must not import mermaid).
 */

/**
 * Output options for Mermaid diagram generation
 */
export interface MermaidOutputOptions {
  /** Output directory for generated files */
  outputDir: string;
  /** Base name for output files (without extension) */
  baseName: string;
  /** Full paths to output files */
  paths: {
    mmd: string;
    svg: string;
    png: string;
  };
}

/**
 * Render job for two-stage rendering
 *
 * Stage 1 (generateOnly) produces RenderJob[]
 * Stage 2 (renderJobsInParallel) consumes RenderJob[]
 */
export interface RenderJob {
  /** Diagram name */
  name: string;
  /** Generated Mermaid code */
  mermaidCode: string;
  /** Output file paths */
  outputPath: {
    mmd: string;
    svg: string;
    png: string;
  };
}
