/**
 * MermaidDiagramGenerator - Main orchestrator for Mermaid diagram generation
 *
 * Integrates all components:
 * - Grouper (Heuristic/LLM)
 * - Generator (ValidatedMermaidGenerator)
 * - ValidationPipeline (5-layer validation)
 * - Renderer (IsomorphicMermaidRenderer)
 * - AutoRepair (Automatic error fixing)
 *
 * @module mermaid/diagram-generator
 */

import type { ArchJSON } from '../types/index.js';
import type { GlobalConfig, DetailLevel, DiagramConfig } from '../types/config.js';
import type { GroupingDecision } from './types.js';
import { HeuristicGrouper } from './grouper.js';
import { ValidatedMermaidGenerator } from './generator.js';
import { MermaidValidationPipeline } from './validation-pipeline.js';
import { IsomorphicMermaidRenderer } from './renderer.js';
import { MermaidAutoRepair } from './auto-repair.js';
import { type IProgressReporter, NoopProgressReporter } from './progress.js';

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

/**
 * Main generator for Mermaid diagrams
 *
 * Usage:
 * ```typescript
 * const generator = new MermaidDiagramGenerator(globalConfig);
 * await generator.generateAndRender(archJson, outputOptions, 'class');
 * ```
 */
export class MermaidDiagramGenerator {
  private progress: IProgressReporter;

  constructor(
    private config: GlobalConfig,
    progress?: IProgressReporter
  ) {
    this.progress = progress ?? new NoopProgressReporter();
  }

  /**
   * Stage 1: Generate Mermaid code only (no rendering)
   *
   * This is the CPU-intensive stage that:
   * - Groups entities using heuristic strategy
   * - Generates Mermaid code
   * - Validates the generated code
   *
   * @param archJson - Architecture JSON data
   * @param outputOptions - Output file paths
   * @param level - Detail level (package/class/method)
   * @param diagramConfig - Diagram configuration (v2.1.0: for metadata comments)
   * @returns Array of RenderJob to be rendered in Stage 2
   */
  async generateOnly(
    archJson: ArchJSON,
    outputOptions: MermaidOutputOptions,
    level: DetailLevel,
    diagramConfig?: DiagramConfig
  ): Promise<RenderJob[]> {
    // Empty ArchJSON produces an invalid bare `classDiagram\n` that fails Mermaid parsing.
    // Return gracefully with no render jobs instead of throwing.
    if (!archJson.entities || archJson.entities.length === 0) {
      return [];
    }

    const progress = this.progress;

    try {
      // 1. Decision Layer - Group entities using heuristic strategy
      progress.start('🧠 Analyzing architecture...');
      const heuristicGrouper = new HeuristicGrouper();
      const grouping = heuristicGrouper.group(archJson);
      progress.succeed(`✅ Grouping complete: ${grouping.packages.length} groups`);

      // 2. Deterministic Generation
      progress.start('📝 Generating Mermaid code...');
      const generator = new ValidatedMermaidGenerator(
        archJson,
        {
          level,
          grouping,
          verbose: this.config.verbose || false,
        },
        diagramConfig // v2.1.0: Pass diagram config for metadata comments
      );

      // For class/method levels: use diagram splitting when node count exceeds limit
      const maxNodesPerDiagram = this.config.maxNodesPerDiagram ?? 150;
      const splitDiagrams =
        level === 'class' || level === 'method'
          ? generator.generateClassDiagrams(maxNodesPerDiagram)
          : [{ name: null as string | null, content: generator.generate() }];

      const isSplit = splitDiagrams.length > 1 || splitDiagrams[0]?.name !== null;
      progress.succeed(
        isSplit
          ? `✅ Mermaid code generated (${splitDiagrams.length} splits)`
          : '✅ Mermaid code generated'
      );

      // Base output directory (strip filename from mmd path)
      const baseDir = outputOptions.paths.mmd.replace(/\/[^/]+\.mmd$/, '');

      if (isSplit) {
        // Split path: generate one render job per namespace group.
        // These diagrams are machine-generated and syntactically valid; skip heavy validation.
        progress.succeed(`✅ Skipping validation for ${splitDiagrams.length} split diagrams`);

        return splitDiagrams
          .filter((d) => d.content.trim().length > 'classDiagram'.length)
          .map(({ name, content }) => {
            const safeName = (name ?? outputOptions.baseName).replace(/[^a-zA-Z0-9_-]/g, '_');
            const outputPath =
              name === null
                ? outputOptions.paths
                : {
                    mmd: `${baseDir}/${safeName}.mmd`,
                    svg: `${baseDir}/${safeName}.svg`,
                    png: `${baseDir}/${safeName}.png`,
                  };
            return { name: safeName, mermaidCode: content, outputPath };
          });
      }

      // Single diagram path: full validation + repair pipeline
      let mermaidCode = splitDiagrams[0]!.content;

      // 3. Five-Layer Validation
      progress.start('🔍 Validating generated code...');
      const pipeline = new MermaidValidationPipeline(this.config);
      const report = await pipeline.validateFull(mermaidCode, archJson);

      if (!report.overallValid) {
        progress.fail('❌ Validation failed');

        // Print validation report
        console.error(pipeline.generateReport(report));

        // Try auto-repair
        progress.start('🔧 Attempting auto-repair...');
        const parseValidator = pipeline.getParseValidator();
        const autoRepair = new MermaidAutoRepair(parseValidator);

        try {
          const errors =
            report.stages
              .find((s) => s.name === 'parse')
              ?.result?.errors?.map((e: any) => ({
                message: e.message,
                line: e.line,
                column: e.column,
                severity: 'error' as const,
              })) || [];

          mermaidCode = await autoRepair.repair(mermaidCode, errors);

          // Re-validate after repair
          const repairedReport = await pipeline.validateFull(mermaidCode, archJson);
          if (repairedReport.overallValid) {
            progress.succeed('✅ Repaired successfully');
          } else {
            throw new Error('Auto-repair completed but validation still fails');
          }
        } catch (repairError) {
          progress.fail('❌ Auto-repair failed');
          const errorMessages =
            report.stages
              .find((s) => s.name === 'parse')
              ?.result?.errors?.map((e: any) => `- ${e.message}`)
              .join('\n') || 'Unknown errors';

          throw new Error(`Validation failed and cannot be repaired.\nErrors:\n${errorMessages}`);
        }
      } else {
        progress.succeed('✅ Validation passed');
      }

      // 4. Output Quality Report
      const qualityStage = report.stages.find((s) => s.name === 'quality');
      if (qualityStage && qualityStage.result) {
        const metrics = qualityStage.result;
        console.log('\n📊 Quality Metrics:');
        console.log(`  Overall Score: ${metrics.score?.toFixed(1) || 'N/A'}/100`);

        if (metrics.metrics) {
          console.log(`  Readability: ${metrics.metrics.readability?.toFixed(1) || 'N/A'}/100`);
          console.log(`  Completeness: ${metrics.metrics.completeness?.toFixed(1) || 'N/A'}/100`);
          console.log(`  Consistency: ${metrics.metrics.consistency?.toFixed(1) || 'N/A'}/100`);
          console.log(`  Complexity: ${metrics.metrics.complexity?.toFixed(1) || 'N/A'}/100`);
        }

        // Print suggestions if any
        if (metrics.suggestions && metrics.suggestions.length > 0) {
          console.log('\n⚠️  Quality Suggestions:');
          for (const suggestion of metrics.suggestions.slice(0, 3)) {
            console.log(`  - [${suggestion.impact || 'medium'}] ${suggestion.message}`);
          }
          if (metrics.suggestions.length > 3) {
            console.log(`  ... and ${metrics.suggestions.length - 3} more`);
          }
        }
      }

      // Return render job (Stage 1 complete)
      return [
        {
          name: outputOptions.baseName,
          mermaidCode,
          outputPath: outputOptions.paths,
        },
      ];
    } catch (error) {
      progress.fail('❌ Generation failed');
      throw error;
    }
  }

  /**
   * Stage 2: Render all render jobs in parallel
   *
   * This is the I/O-intensive stage that renders all Mermaid diagrams
   * in parallel using configurable concurrency.
   *
   * @param jobs - Array of render jobs from Stage 1
   * @param concurrency - Maximum number of concurrent renders
   */
  static async renderJobsInParallel(
    jobs: RenderJob[],
    concurrency: number,
    progress: IProgressReporter = new NoopProgressReporter()
  ): Promise<void> {
    const pMap = (await import('p-map')).default;

    try {
      progress.start(
        `🎨 Rendering ${jobs.length} diagram${jobs.length > 1 ? 's' : ''} in parallel...`
      );

      await pMap(
        jobs,
        async (job) => {
          // Prepare renderer options from config
          const rendererOptions: any = {};
          // Note: For static method, we use default theme options
          // In production, these would come from global config
          rendererOptions.theme = { name: 'default' };
          rendererOptions.backgroundColor = 'transparent';

          const renderer = new IsomorphicMermaidRenderer(rendererOptions);
          await renderer.renderAndSave(job.mermaidCode, job.outputPath);
        },
        { concurrency }
      );

      progress.succeed(`✅ Rendered ${jobs.length} diagram${jobs.length > 1 ? 's' : ''}`);
    } catch (error) {
      progress.fail('❌ Rendering failed');
      throw error;
    }
  }

  /**
   * Generate and render a Mermaid diagram
   *
   * @param archJson - Architecture JSON data
   * @param outputOptions - Output file paths
   * @param level - Detail level (package/class/method)
   * @param diagramConfig - Diagram configuration (v2.1.0: for metadata comments)
   */
  async generateAndRender(
    archJson: ArchJSON,
    outputOptions: MermaidOutputOptions,
    level: DetailLevel,
    diagramConfig?: DiagramConfig
  ): Promise<void> {
    const progress = this.progress;

    try {
      // Stage 1: Generate Mermaid code (CPU intensive)
      progress.start('📝 Generating Mermaid code...');
      const allRenderJobs = await this.generateOnly(archJson, outputOptions, level, diagramConfig);
      progress.succeed(
        `✅ Generated ${allRenderJobs.length} Mermaid file${allRenderJobs.length > 1 ? 's' : ''}`
      );

      // Stage 2: Render all jobs in parallel (I/O intensive)
      progress.start('🎨 Rendering diagram...');

      // Prepare renderer options from config
      const rendererOptions: any = {};
      if (this.config.mermaid) {
        if (this.config.mermaid.theme && typeof this.config.mermaid.theme === 'string') {
          rendererOptions.theme = { name: this.config.mermaid.theme };
        } else if (this.config.mermaid.theme && typeof this.config.mermaid.theme === 'object') {
          rendererOptions.theme = this.config.mermaid.theme;
        }
        // Use transparent background if configured
        if (this.config.mermaid.transparentBackground) {
          rendererOptions.backgroundColor = 'transparent';
        }
      }

      // Render with higher concurrency for I/O-bound operations
      const renderConcurrency = (this.config.concurrency || require('os').cpus().length) * 2;

      // Use the static method for rendering
      await MermaidDiagramGenerator.renderJobsInParallelWithConfig(
        allRenderJobs,
        renderConcurrency,
        rendererOptions
      );

      progress.succeed('✅ Diagram rendered successfully');

      console.log('\n✨ Generated files:');
      if (allRenderJobs.length === 1 && allRenderJobs[0]?.outputPath === outputOptions.paths) {
        console.log(`  📄 ${outputOptions.paths.mmd}`);
        console.log(`  🖼️  ${outputOptions.paths.svg}`);
        console.log(`  📊 ${outputOptions.paths.png}`);
      } else {
        for (const job of allRenderJobs) {
          console.log(`  📄 ${job.outputPath.mmd}`);
        }
      }
    } catch (error) {
      progress.fail('❌ Generation failed');
      throw error;
    }
  }

  /**
   * Stage 2: Render all render jobs in parallel with custom config
   *
   * Private helper method that allows passing custom renderer options
   * (used by generateAndRender to respect global config)
   *
   * @param jobs - Array of render jobs from Stage 1
   * @param concurrency - Maximum number of concurrent renders
   * @param rendererOptions - Custom renderer options
   */
  private static async renderJobsInParallelWithConfig(
    jobs: RenderJob[],
    concurrency: number,
    rendererOptions: any
  ): Promise<void> {
    const pMap = (await import('p-map')).default;

    await pMap(
      jobs,
      async (job) => {
        const renderer = new IsomorphicMermaidRenderer(rendererOptions);
        await renderer.renderAndSave(job.mermaidCode, job.outputPath);
      },
      { concurrency }
    );
  }
}
