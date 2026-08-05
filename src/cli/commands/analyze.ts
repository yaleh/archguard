/**
 * Analyze Command v3.0 - Redesigned flags for auto-detection-first workflow
 *
 * Breaking Changes from v2.x:
 * - Removed: -l/--level, -n/--name
 * - Changed: --diagrams now filters by level (not by diagram name)
 * - Changed: -s/--sources triggers auto-detect then optional level filter
 * - Single processing path: Everything goes through DiagramProcessor
 *
 * @module cli/commands/analyze
 * @version 3.0.0
 */

import { Command } from 'commander';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { ProgressReporter } from '../progress/index.js';
import { ErrorHandler } from '../errors/index.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions } from '../../types/config.js';
import type { DiagramResult } from '../processors/diagram-processor.js';
import { runAnalysis } from '../analyze/run-analysis.js';
import { loadSnapshots, resolveCommitSha } from '@/analysis/snapshot-store.js';
import { computeDirectionHint } from '@/analysis/gim/direction-hint.js';
import { buildAdjacencyMatrix, normalizeColumns } from '@/analysis/jl/adjacency-builder.js';
import { computeMode, computeK, buildAchlioptas, project } from '@/analysis/jl/jl-projector.js';
import { computeIntrinsicDimension } from '@/analysis/jl/intrinsic-dimension.js';
import { appendSnapshot, readHistoryFile } from '@/analysis/jl/history-writer.js';
import { DriftCalculator } from '@/analysis/jl/drift-calculator.js';
import { determineDriftExitCode } from '@/analysis/jl/drift-exit-code.js';
import { resolveBaselineSnapshot, snapshotFromArchJson } from '../utils/drift-baseline.js';
import type { BaselineResolution } from '../utils/drift-baseline.js';
import { formatDriftReport } from '../utils/drift-reporter.js';
import {
  DEFAULT_JL_CONFIG,
  DRIFT_THRESHOLDS,
  FEATURE_VERSION,
  TREND_DELTA_THRESHOLD,
} from '@/analysis/jl/types.js';
import type {
  ArchHealthHistory,
  DriftOptions,
  DriftSnapshot,
  IntrinsicDimensionResult,
  JLConfig,
} from '@/analysis/jl/types.js';
import type { ArchJSON } from '@/types/index.js';

/**
 * Normalize CLI options to DiagramConfig[]
 *
 * Priority:
 * 1. If config.diagrams exists and not empty → use config file (apply level filter)
 * 2. If CLI provides sources → auto-detect from sources[0] path (apply level filter)
 *    Special case: Go Atlas → return single atlas diagram (skip auto-detect)
 * 3. Otherwise → auto-detect from rootDir (apply level filter)
 *
 * @param config - Loaded configuration
 * @param cliOptions - CLI options
 * @param rootDir - Project root directory (default: process.cwd())
 * @returns Array of DiagramConfig
 */
export { normalizeToDiagrams, filterByLevels } from '../analyze/normalize-to-diagrams.js';

/**
 * Display results summary
 *
 * @param results - Array of diagram results
 * @param config - Global configuration
 */
function displayResults(results: DiagramResult[], config: Config): void {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log('\n✅ Analysis complete!\n');

  if (successful.length > 0) {
    console.log('📊 Successful diagrams:');
    for (const result of successful) {
      console.log(`  - ${result.name}`);
      if (result.stats) {
        console.log(`    Entities: ${result.stats.entities}, Relations: ${result.stats.relations}`);
      }
      if (result.paths?.png) {
        console.log(`    PNG: ${result.paths.png}`);
      } else if (result.paths?.json) {
        console.log(`    JSON: ${result.paths.json}`);
      } else if (result.paths?.svg) {
        console.log(`    SVG: ${result.paths.svg}`);
      }
    }
  }

  if (failed.length > 0) {
    console.log('\n⚠️  Failed diagrams:');
    for (const result of failed) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
  }

  console.log(`\n📁 Output directory: ${config.outputDir}`);

  if (results.length > 1) {
    console.log(`📖 Index: ${config.outputDir}/index.md\n`);
  } else {
    console.log('');
  }
}

/**
 * Create the analyze command (v2.0)
 */
export function createAnalyzeCommand(): Command {
  return (
    new Command('analyze')
      .description(
        'Analyze source code and generate architecture diagrams (TypeScript, Go, Java, Python, C++, Kotlin)'
      )

      // ========== Configuration File ==========
      .option('--config <path>', 'Config file path (default: archguard.config.json)')
      .option(
        '--diagrams <levels...>',
        'Filter by diagram level: package|class|method (language-dependent)'
      )

      // ========== Source Auto-Detection ==========
      .option(
        '-s, --sources <paths...>',
        'Source directories (auto-detects project structure, generates multi-diagram)'
      )
      .option(
        '--lang <language>',
        'Language plugin: typescript|go|java|python|cpp|kotlin (default: auto-detect)'
      )

      // ========== Global Config Overrides ==========
      .option('-f, --format <type>', 'Output format: mermaid|json (default: mermaid)')
      .option('--work-dir <dir>', 'ArchGuard work directory (default: ./.archguard)')
      .option('--cache-dir <dir>', 'Cache directory (default: <work-dir>/cache)')
      .option('--output-dir <dir>', 'Output directory')
      .option('-e, --exclude <patterns...>', 'Exclude patterns')
      .option('--no-cache', 'Disable cache')
      .option('-c, --concurrency <num>', 'Parallel parsing concurrency', `${os.cpus().length}`)
      .option('-v, --verbose', 'Verbose output', false)

      // ========== Mermaid-Specific Options ==========
      .option('--mermaid-theme <theme>', 'Mermaid theme: default|forest|dark|neutral')
      .option('--mermaid-renderer <renderer>', 'Mermaid renderer: isomorphic|cli')

      // ========== Claude CLI Configuration ==========
      .option('--cli-command <command>', 'Claude CLI command')
      .option('--cli-args <args>', 'Additional CLI arguments (space-separated)')

      // ========== Test Analysis ==========
      .option('--include-tests', 'Include test system analysis in output')
      .option(
        '--tests-only',
        'Run only test analysis (uses cached ArchJSON if available, skips diagram generation)'
      )
      .option(
        '--include-git',
        'Also analyze git commit history (writes artifacts to <work-dir>/query/git-history/)'
      )
      // ========== Go Architecture Atlas ==========
      .option(
        '--atlas-layers <layers>',
        'Atlas layers to generate (comma-separated): package,capability,goroutine,flow',
        'package,capability,goroutine,flow'
      )
      .option(
        '--atlas-strategy <strategy>',
        'Function body extraction strategy: none|selective|full',
        'selective'
      )
      .option(
        '--atlas-no-tests',
        'Exclude test files from Atlas extraction (deprecated: now the default)'
      )
      .option(
        '--atlas-include-tests',
        'Include test packages in Atlas extraction (overrides default exclusion)'
      )
      .option(
        '--atlas-protocols <protocols>',
        'Protocols to include in flow graph (comma-separated: http,grpc,cli,message,scheduler)'
      )
      .option(
        '--atlas-entry-pattern <pattern>',
        'Regex matched against call.functionName for custom entry point detection (protocol: custom)'
      )
      .option(
        '--atlas-capability-mode <mode>',
        'Capability diagram mode: interface (default) | full (adds hotspot/complex-package structs)'
      )
      .option('--gim', 'Output GIM direction hint to .archguard/gim/direction.json', false)
      .option(
        '--arch-health',
        'Compute and persist architecture intrinsic dimension (d_int) to .archguard/arch-health-history.json',
        false
      )
      .option(
        '--drift-base <commit>',
        'Compare architecture drift against this baseline commit (resolved from arch-health-history.json). ' +
          'Exit 1 when any entity drift meets/exceeds --drift-threshold, 2 on an invalid commit, 0 with a ' +
          'message when no baseline snapshot exists.'
      )
      .option(
        '--drift-threshold <n>',
        'Drift CI/CD gate threshold (default 3.0); exit 1 when any entity drift meets/exceeds it',
        '3.0'
      )

      .action(analyzeCommandHandler)
  );
}

/**
 * Analyze command handler (v3.0 - redesigned flags)
 */
export async function analyzeCommandHandler(cliOptions: CLIOptions): Promise<void> {
  const progress = new ProgressReporter();

  try {
    const result = await runAnalysis({
      sessionRoot: process.cwd(),
      workDir: inferCliWorkDir(process.cwd(), cliOptions),
      cliOptions,
      reporter: progress,
    });

    if (result.diagrams.length === 0) {
      progress.warn('No diagrams selected');
      process.exit(0);
    }
    displayResults(result.results, result.config);

    if (cliOptions.gim) {
      await writeGimOutput(result.config.outputDir);
    }

    let driftExitCode: 0 | 1 | 2 | undefined;

    if (cliOptions.archHealth) {
      try {
        const archJson = result.lastArchJson ?? null;
        if (archJson) {
          const archguardDir = result.config.workDir ?? '.archguard';
          await runArchHealth(archJson, archguardDir);

          if (cliOptions.driftBase !== undefined) {
            const driftOptions = parseDriftOptions(cliOptions);
            const commitSha = (await resolveCommitSha()) ?? undefined;
            const currentSnapshot = snapshotFromArchJson(
              archJson,
              new Date().toISOString(),
              commitSha
            );
            const driftCheck = await runDriftCheck(archguardDir, driftOptions, currentSnapshot);
            // eslint-disable-next-line no-console
            console.log(`\n${driftCheck.message}`);
            driftExitCode = driftCheck.exitCode;
          }
        } else {
          progress.warn('--arch-health: no ArchJSON available to analyze');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.warn(`[arch-health] Failed: ${message}`);
      }
    }

    if (driftExitCode !== undefined && driftExitCode !== 0) {
      process.exit(driftExitCode);
    }
    process.exit(result.hasDiagramFailures ? 1 : 0);
  } catch (error) {
    progress.fail('Analysis failed');
    const errorHandler = new ErrorHandler();
    console.error(errorHandler.format(error, { verbose: cliOptions.verbose || false }));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Architecture intrinsic dimension (--arch-health)
// ---------------------------------------------------------------------------

/**
 * Orchestrate the JL intrinsic-dimension pipeline:
 *
 *   AdjacencyBuilder → JLProjector (adaptive) → computeIntrinsicDimension
 *     → appendSnapshot → print
 *
 * Writes `.archguard/arch-health-history.json` and prints mode / d_int /
 * d_int_norm / previous snapshot / trend. Exported for scoped testing.
 *
 * @param archJson - Parsed ArchJSON for the analyzed scope.
 * @param archguardDir - The `.archguard` work directory for the project.
 * @param config - JL configuration (defaults applied when omitted).
 */
export async function runArchHealth(
  archJson: ArchJSON,
  archguardDir: string,
  config: JLConfig = DEFAULT_JL_CONFIG
): Promise<void> {
  const matrix = buildAdjacencyMatrix(archJson);
  const normalized = normalizeColumns(matrix);
  const entityCount = archJson.entities.length;
  const mode = computeMode(entityCount, config);

  let data: number[][];
  let k: number | null = null;
  let epsilon: number | null = null;

  if (mode === 'jl') {
    epsilon = config.epsilon;
    k = computeK(entityCount, config.epsilon);
    const achlioptas = buildAchlioptas(k, entityCount, config.seed);
    data = project(normalized, achlioptas, k);
  } else {
    data = normalized;
  }

  const result: IntrinsicDimensionResult = {
    ...computeIntrinsicDimension({
      matrix: data,
      entityCount,
      mode,
      k,
      epsilon,
      featureVersion: FEATURE_VERSION,
    }),
    // Persist entity IDs (O(n)) for cross-snapshot drift alignment (TASK-65).
    // adjacencyRows are never persisted (AC5).
    entityIndex: archJson.entities.map((e) => e.id),
  };

  const append = await appendSnapshot(archguardDir, archJson.language, result);
  if (!append.ok) {
    console.warn(`[arch-health] snapshot not persisted: ${append.reason ?? 'unknown reason'}`);
  }

  printArchHealth(result, append.previous, config.directModeThreshold);
}

function printArchHealth(
  result: IntrinsicDimensionResult,
  previous: IntrinsicDimensionResult | null,
  threshold: number
): void {
  // eslint-disable-next-line no-console
  console.log('\nArchitecture Intrinsic Dimension');
  // eslint-disable-next-line no-console
  console.log(
    `  Mode:       ${result.mode.toUpperCase()} (n=${result.entityCount}, threshold=${threshold})`
  );
  // eslint-disable-next-line no-console
  console.log(`  d_int:      ${result.dInt} / ${result.entityCount} entities`);
  // eslint-disable-next-line no-console
  console.log(`  d_int_norm: ${result.dIntNormalized.toFixed(4)}`);

  if (previous) {
    const delta = result.dIntNormalized - previous.dIntNormalized;
    const trend =
      delta > TREND_DELTA_THRESHOLD
        ? 'RISING'
        : delta < -TREND_DELTA_THRESHOLD
          ? 'DECREASING'
          : 'STABLE';
    // eslint-disable-next-line no-console
    console.log(
      `  Previous:   ${previous.dInt} / ${previous.entityCount} entities  ` +
        `(d_int_norm: ${previous.dIntNormalized.toFixed(4)}, ${previous.timestamp})`
    );
    // eslint-disable-next-line no-console
    console.log(
      `  Trend:      ${trend} (Δd_int_norm = ${delta >= 0 ? '+' : ''}${delta.toFixed(4)})`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('  Previous:   none');
    // eslint-disable-next-line no-console
    console.log('  Trend:      STABLE');
  }
}

// ---------------------------------------------------------------------------
// Architecture drift gate (--drift-base / --drift-threshold)
// ---------------------------------------------------------------------------

/**
 * Parse the CLI drift options into a `DriftOptions` value.
 *
 * With no flags, the gate is off (`base` undefined) and the threshold defaults
 * to 3.0 (DRIFT_THRESHOLDS.critical). An unparseable `--drift-threshold` falls
 * back to the default rather than crashing the gate.
 *
 * @param opts - Raw CLI options.
 */
export function parseDriftOptions(opts: CLIOptions): DriftOptions {
  const rawThreshold = opts.driftThreshold;
  const threshold =
    rawThreshold === undefined ? DRIFT_THRESHOLDS.critical : Number(rawThreshold);
  return {
    base: opts.driftBase,
    threshold: Number.isFinite(threshold) ? threshold : DRIFT_THRESHOLDS.critical,
  };
}

export interface DriftCheckResult {
  exitCode: 0 | 1 | 2;
  message: string;
}

export interface DriftCheckDeps {
  /** Override the history reader (default: readHistoryFile). */
  readHistory?: (archDir: string) => Promise<ArchHealthHistory | null>;
  /** Override baseline resolution (default: resolveBaselineSnapshot). */
  resolveBaseline?: (
    base: string | undefined,
    history: ArchHealthHistory | null,
    root: string
  ) => Promise<BaselineResolution>;
  /** Git repository root (default: parent of the .archguard dir). */
  root?: string;
}

/**
 * Run the drift CI/CD gate.
 *
 * Resolves the baseline snapshot for `--drift-base`, compares it against the
 * current snapshot, and returns the gate verdict:
 *
 *   0 — no baseline available (explanatory message) or threshold not breached.
 *   1 — at least one entity drift ≥ threshold.
 *   2 — `--drift-base` commit not found in history.
 *
 * @param archguardDir - The `.archguard` work directory.
 * @param options - Parsed drift options.
 * @param currentSnapshot - Snapshot for the commit being analyzed.
 * @param deps - Injectable dependencies (tests override the baseline resolver).
 */
export async function runDriftCheck(
  archguardDir: string,
  options: DriftOptions,
  currentSnapshot: DriftSnapshot,
  deps: DriftCheckDeps = {}
): Promise<DriftCheckResult> {
  const readHistory = deps.readHistory ?? readHistoryFile;
  const resolveBaseline =
    deps.resolveBaseline ??
    ((base: string | undefined, history: ArchHealthHistory | null, root: string) =>
      resolveBaselineSnapshot(base, history, root));
  const root = deps.root ?? path.dirname(archguardDir);

  const history = await readHistory(archguardDir);
  if (history === null || history.snapshots.length === 0) {
    return { exitCode: 0, message: 'no baseline available' };
  }

  const resolution = await resolveBaseline(options.base, history, root);
  if (resolution.kind === 'no-baseline') {
    return { exitCode: 0, message: 'no baseline available' };
  }
  if (resolution.kind === 'invalid-commit') {
    return { exitCode: 2, message: `invalid drift-base commit: ${resolution.commit}` };
  }

  const report = DriftCalculator.compare(resolution.snapshot, currentSnapshot, {
    threshold: options.threshold,
  });
  const exitCode = determineDriftExitCode(report, options.threshold);
  return { exitCode, message: formatDriftReport(report) };
}

async function writeGimOutput(outputDir: string): Promise<void> {
  const snapshots = await loadSnapshots(outputDir);
  const hint = computeDirectionHint(snapshots);
  const gimDir = path.join(outputDir, 'gim');
  await fs.mkdirp(gimDir);
  await fs.writeJson(path.join(gimDir, 'direction.json'), hint, { spaces: 2 });
  console.log(`\n🔭 GIM direction: ${hint.direction} (confidence: ${hint.confidence ?? 'n/a'})`);
  console.log(`   → ${hint.recommendation}`);
}

function inferCliWorkDir(sessionRoot: string, cliOptions: CLIOptions): string {
  if (cliOptions.workDir) {
    return cliOptions.workDir;
  }
  if (cliOptions.sources && cliOptions.sources.length > 0 && !cliOptions.outputDir) {
    const sourcePath = path.resolve(sessionRoot, cliOptions.sources[0]);
    if (!sourcePath.startsWith(sessionRoot)) {
      const SOURCE_ROOT_NAMES = ['src', 'lib', 'app', 'source'];
      const basename = path.basename(sourcePath);
      const projectRoot = SOURCE_ROOT_NAMES.includes(basename)
        ? path.dirname(sourcePath)
        : sourcePath;
      return path.join(projectRoot, '.archguard');
    }
  }
  return path.join(sessionRoot, '.archguard');
}
