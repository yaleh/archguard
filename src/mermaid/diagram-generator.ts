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
import type { GlobalConfig, DetailLevel } from '../types/config.js';
import type { GroupingDecision } from './types.js';
import { HeuristicGrouper, LLMGrouper } from './grouper.js';
import { ValidatedMermaidGenerator } from './generator.js';
import { MermaidValidationPipeline } from './validation-pipeline.js';
import { IsomorphicMermaidRenderer } from './renderer.js';
import { MermaidAutoRepair } from './auto-repair.js';
import { ProgressReporter } from '../cli/progress.js';

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
 * Main generator for Mermaid diagrams
 *
 * Usage:
 * ```typescript
 * const generator = new MermaidDiagramGenerator(globalConfig);
 * await generator.generateAndRender(archJson, outputOptions, 'class');
 * ```
 */
export class MermaidDiagramGenerator {
  constructor(private config: GlobalConfig) {}

  /**
   * Generate and render a Mermaid diagram
   *
   * @param archJson - Architecture JSON data
   * @param outputOptions - Output file paths
   * @param level - Detail level (package/class/method)
   */
  async generateAndRender(
    archJson: ArchJSON,
    outputOptions: MermaidOutputOptions,
    level: DetailLevel
  ): Promise<void> {
    const progress = new ProgressReporter();

    try {
      // 1. Decision Layer - Choose grouping strategy
      progress.start('🧠 Analyzing architecture...');
      let grouping: GroupingDecision;

      if (this.config.mermaid?.enableLLMGrouping !== false) {
        // Try LLM grouping first (if enabled)
        const llmGrouper = new LLMGrouper(this.config);
        try {
          grouping = await llmGrouper.getLLMGrouping(archJson, level);
          progress.succeed(
            `✅ LLM grouping complete: ${grouping.packages.length} groups`
          );
        } catch (error) {
          progress.warn('⚠️  LLM grouping failed, using heuristic');
          const heuristicGrouper = new HeuristicGrouper();
          grouping = heuristicGrouper.group(archJson);
        }
      } else {
        // Use heuristic grouping directly
        const heuristicGrouper = new HeuristicGrouper();
        grouping = heuristicGrouper.group(archJson);
        progress.succeed(
          `✅ Heuristic grouping complete: ${grouping.packages.length} groups`
        );
      }

      // 2. Deterministic Generation
      progress.start('📝 Generating Mermaid code...');
      const generator = new ValidatedMermaidGenerator(archJson, {
        level,
        grouping,
      });

      let mermaidCode = generator.generate();
      progress.succeed('✅ Mermaid code generated');

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
          const repairedReport = await pipeline.validateFull(
            mermaidCode,
            archJson
          );
          if (repairedReport.overallValid) {
            progress.succeed('✅ Repaired successfully');
          } else {
            throw new Error(
              'Auto-repair completed but validation still fails'
            );
          }
        } catch (repairError) {
          progress.fail('❌ Auto-repair failed');
          const errorMessages =
            report.stages
              .find((s) => s.name === 'parse')
              ?.result?.errors?.map((e: any) => `- ${e.message}`)
              .join('\n') || 'Unknown errors';

          throw new Error(
            `Validation failed and cannot be repaired.\nErrors:\n${errorMessages}`
          );
        }
      } else {
        progress.succeed('✅ Validation passed');
      }

      // 4. Output Quality Report
      const qualityStage = report.stages.find((s) => s.name === 'quality');
      if (qualityStage && qualityStage.result) {
        const metrics = qualityStage.result as any;
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

      // 5. Render
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

      const renderer = new IsomorphicMermaidRenderer(rendererOptions);

      await renderer.renderAndSave(mermaidCode, outputOptions.paths);
      progress.succeed('✅ Diagram rendered successfully');

      console.log('\n✨ Generated files:');
      console.log(`  📄 ${outputOptions.paths.mmd}`);
      console.log(`  🖼️  ${outputOptions.paths.svg}`);
      console.log(`  📊 ${outputOptions.paths.png}`);
    } catch (error) {
      progress.fail('❌ Generation failed');
      throw error;
    }
  }
}
