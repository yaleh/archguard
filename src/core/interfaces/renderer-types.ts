/**
 * Renderer-facing types shared between the core interface layer and the
 * language/format implementation layer.
 *
 * These describe the *contract* between a renderer facade and its callers, so
 * they belong in the core interface layer (below the concrete generators).
 * `renderer-facade.ts` and `src/mermaid/diagram-generator.ts` both re-export
 * them, so existing import paths on either side keep working (layer guard:
 * tests/unit/architecture/layer-imports.test.ts — core must not import mermaid).
 *
 * Task gap-plantuml-deterministic-generation removed the Mermaid-specific
 * vocabulary from this contract: a render job now carries a format-neutral
 * `diagramCode` plus the `format` that produced it, and its source file is
 * `outputPath.source` (`.mmd` for Mermaid, `.puml` for PlantUML).
 */

/**
 * Supported diagram source formats.
 */
export type DiagramFormat = 'mermaid' | 'plantuml';

/**
 * Output options for diagram generation.
 */
export interface DiagramOutputOptions {
  /** Output directory for generated files */
  outputDir: string;
  /** Base name for output files (without extension) */
  baseName: string;
  /** Full paths to output files */
  paths: {
    /**
     * Diagram source path: `.mmd` for Mermaid, `.puml` for PlantUML.
     * Named `source` rather than after one format's extension.
     */
    source: string;
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
  /** Generated diagram source code in `format` */
  diagramCode: string;
  /** Format that produced `diagramCode` */
  format: DiagramFormat;
  /** Output file paths */
  outputPath: {
    /** Diagram source path (`.mmd` or `.puml`) */
    source: string;
    svg: string;
    png: string;
  };
}
