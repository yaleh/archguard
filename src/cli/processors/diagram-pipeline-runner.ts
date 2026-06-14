/**
 * DiagramPipelineRunner — executes the per-diagram processing pipeline.
 *
 * Extracted from DiagramProcessor.processDiagramWithArchJSON (Plan 34 – Phase A4).
 *
 * Pipeline steps:
 * 1. Aggregate ArchJSON to the requested detail level
 * 2. Resolve output paths
 * 3. Compute metrics
 * 4. Route to the appropriate output generator
 * 5. Assemble and return DiagramResult
 *
 * @module cli/processors/diagram-pipeline-runner
 */

import { ArchJSONAggregator } from '@/parser/archjson-aggregator.js';
import { MetricsCalculator } from '@/parser/metrics-calculator.js';
import { OutputPathResolver } from '@/cli/utils/output-path-resolver.js';
import { DiagramOutputRouter } from './diagram-output-router.js';
import { ParallelProgressReporter } from '@/cli/progress/parallel-progress.js';
import type { ProgressReporterLike } from '@/cli/progress/index.js';
import type { DiagramConfig, GlobalConfig } from '@/types/config.js';
import type { ArchJSON, ArchJSONMetrics } from '@/types/index.js';
import type { DiagramResult } from './diagram-processor.js';
import type { MermaidRenderWorkerPool } from '@/mermaid/render-worker-pool.js';
import { buildMetricVector } from '@/analysis/metric-vector-builder.js';
import { buildArchIndex } from '@/core/query/arch-index-builder.js';
import { QueryEngine } from '@/core/query/query-engine.js';
import { saveSnapshot, pruneSnapshots, resolveCommitSha, resolveBranch } from '@/analysis/snapshot-store.js';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
let _archguardVersion: string;
try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  _archguardVersion = (_require('../../../package.json') as { version: string }).version;
} catch {
  _archguardVersion = '0.1.23';
}

/**
 * DiagramPipelineRunner
 *
 * Stateless per-diagram pipeline executor. Accepts a `parallelProgress` argument
 * on `run()` so the runner itself does not need to be reconstructed when the
 * parallel progress reporter is created after construction.
 */
export class DiagramPipelineRunner {
  constructor(
    private readonly aggregator: ArchJSONAggregator,
    private readonly metricsCalculator: MetricsCalculator,
    private readonly router: DiagramOutputRouter,
    private readonly globalConfig: GlobalConfig,
    private readonly progress: ProgressReporterLike,
    private readonly parallelProgress?: ParallelProgressReporter
  ) {}

  /**
   * Process a single diagram with pre-parsed ArchJSON.
   *
   * @param diagram       - Diagram configuration
   * @param rawArchJSON   - Pre-parsed ArchJSON (before aggregation)
   * @param pool          - Worker pool for parallel SVG rendering
   * @param parallelProgress - Optional parallel progress reporter; overrides the
   *                          instance-level one if provided.
   * @returns DiagramResult
   */
  async run(
    diagram: DiagramConfig,
    rawArchJSON: ArchJSON,
    pool: MermaidRenderWorkerPool,
    parallelProgress?: ParallelProgressReporter
  ): Promise<DiagramResult> {
    // Prefer the call-site parallelProgress over the instance-level one.
    const progress = parallelProgress ?? this.parallelProgress;
    const startTime = Date.now();

    try {
      // For single diagram, use original progress reporter
      if (!progress) {
        this.progress.start(`Processing diagram: ${diagram.name}`);
      }

      // 1. Aggregate to specified level
      if (progress) {
        progress.update(diagram.name, 50, 'Aggregating');
      }
      const aggregatedJSON = this.aggregator.aggregate(rawArchJSON, diagram.level);

      // 2. Resolve output paths
      if (progress) {
        progress.update(diagram.name, 60, 'Preparing output');
      }
      const pathResolver = new OutputPathResolver({
        outputDir: this.globalConfig.outputDir,
        output: undefined, // Not using legacy output field
      });

      const paths = pathResolver.resolve({ name: diagram.name });
      await pathResolver.ensureDirectory({ name: diagram.name });

      // 3. Generate output based on format
      if (progress) {
        progress.update(diagram.name, 70, 'Generating output');
      }
      const format = diagram.format || this.globalConfig.format;

      // Compute metrics unconditionally so they can be attached to the DiagramResult
      // (consumers like DiagramIndexGenerator need them regardless of output format).
      // Always embed metrics so json format gets them; mermaid renderers ignore the field.
      const computedMetrics: ArchJSONMetrics = this.metricsCalculator.calculate(
        aggregatedJSON,
        diagram.level
      );
      const outputJSON: ArchJSON = {
        ...aggregatedJSON,
        metrics: computedMetrics,
        extensions: {
          ...(aggregatedJSON.extensions ?? {}),
          ...(this.globalConfig.projectSemantics
            ? { projectSemantics: this.globalConfig.projectSemantics as NonNullable<ArchJSON['extensions']>['projectSemantics'] }
            : {}),
        },
      };

      // Compute and attach MetricVector after metrics are populated.
      // Build a lightweight QueryEngine to reuse getPackageStats() logic.
      const archIndex = buildArchIndex(outputJSON, '');
      const queryEngine = new QueryEngine({
        archJson: outputJSON,
        archIndex,
        scopeEntry: {
          key: '',
          label: diagram.name,
          language: outputJSON.language,
          kind: 'parsed',
          sources: diagram.sources,
          entityCount: outputJSON.entities.length,
          relationCount: outputJSON.relations.length,
          hasAtlasExtension: new ExtensionAccessor(outputJSON).hasAtlasExtension(),
        },
      });
      const packageStats = queryEngine.getPackageStats().packages;
      outputJSON.metricVector = buildMetricVector(outputJSON, packageStats);

      // B4: Auto-snapshot after MetricVector is computed.
      try {
        const commitSha = await resolveCommitSha();
        const branch = await resolveBranch();
        const snapshot: MetricSnapshot = {
          schemaVersion: 1,
          commitSha,
          branch,
          timestamp: new Date().toISOString(),
          archguardVersion: _archguardVersion,
          metricVector: outputJSON.metricVector,
        };
        const outputDir = this.globalConfig.outputDir ?? '.archguard';
        await saveSnapshot(outputDir, snapshot);
        await pruneSnapshots(outputDir, 100);
        if (this.globalConfig.verbose) {
          console.log(`Snapshot saved to ${outputDir}/snapshots/`);
        }
      } catch {
        // Snapshot failures must not break the main pipeline
      }

      if (this.globalConfig.verbose) {
        const v = outputJSON.metricVector;
        console.log(
          `MetricVector: entities=${v.totalEntities}, relations=${v.totalRelations}, ` +
          `sccCount=${v.sccCount}, maxInDegree=${v.maxInDegree}, ` +
          `giniInDegree=${v.giniInDegree.toFixed(2)}, packages=${v.packageCount}`
        );
      }

      await this.router.route(outputJSON, paths, diagram, pool);

      if (progress) {
        progress.update(diagram.name, 90, 'Finalizing');
      }

      const parseTime = Date.now() - startTime;

      if (progress) {
        progress.complete(diagram.name);
      } else {
        this.progress.succeed(`Diagram ${diagram.name} completed`);
      }

      // Build result paths based on format
      const resultPaths: DiagramResult['paths'] = {};
      if (format === 'json') {
        resultPaths.json = paths.paths.json;
      } else if (format === 'mermaid') {
        resultPaths.mmd = paths.paths.mmd;
        resultPaths.svg = paths.paths.svg;
        resultPaths.png = paths.paths.png;
      }

      // For package-level TS diagrams the rendered output comes from the
      // TsModuleGraph extension, not from aggregatedJSON.entities/relations.
      // Use moduleGraph counts so index.md reflects the actual diagram content.
      const moduleGraph = aggregatedJSON.extensions?.tsAnalysis?.moduleGraph;
      const usesModuleGraph = diagram.level === 'package' && !!moduleGraph;

      // For Go Atlas diagrams the package layer is the source of truth at package level.
      const atlasPackageLayer = new ExtensionAccessor(aggregatedJSON).getAtlasLayer('package');
      const usesAtlas = !!atlasPackageLayer && !usesModuleGraph;

      return {
        name: diagram.name,
        success: true,
        metrics: computedMetrics,
        paths: resultPaths,
        stats: {
          entities: usesModuleGraph
            ? moduleGraph.nodes.length
            : usesAtlas
              ? atlasPackageLayer.nodes.length
              : aggregatedJSON.entities.length,
          relations: usesModuleGraph
            ? moduleGraph.edges.length
            : usesAtlas
              ? atlasPackageLayer.edges.length
              : aggregatedJSON.relations.length,
          parseTime,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (progress) {
        progress.fail(diagram.name);
      } else {
        this.progress.fail(`Diagram ${diagram.name} failed: ${errorMessage}`);
      }

      return {
        name: diagram.name,
        success: false,
        error: errorMessage,
      };
    }
  }
}
