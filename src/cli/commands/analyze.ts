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
import { ProgressReporter } from '../progress.js';
import { ErrorHandler } from '../error-handler.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions } from '../../types/config.js';
import type { DiagramResult } from '../processors/diagram-processor.js';
import { runAnalysis } from '../analyze/run-analysis.js';

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
      .description('Analyze TypeScript project and generate architecture diagrams')

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
      .option('--lang <language>', 'Language plugin: typescript (default: auto-detect)')

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

      // ========== Go Architecture Atlas ==========
      .option('--atlas', 'Enable Go Architecture Atlas mode (default when --lang go)')
      .option('--no-atlas', 'Disable Go Architecture Atlas mode (opt-out for --lang go)')
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

      .action(analyzeCommandHandler)
  );
}

/**
 * Analyze command handler (v3.0 - redesigned flags)
 */
async function analyzeCommandHandler(cliOptions: CLIOptions): Promise<void> {
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
    process.exit(result.hasDiagramFailures ? 1 : 0);
  } catch (error) {
    progress.fail('Analysis failed');
    const errorHandler = new ErrorHandler();
    console.error(errorHandler.format(error, { verbose: cliOptions.verbose || false }));
    process.exit(1);
  }
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
      const projectRoot = SOURCE_ROOT_NAMES.includes(basename) ? path.dirname(sourcePath) : sourcePath;
      return path.join(projectRoot, '.archguard');
    }
  }
  return path.join(sessionRoot, '.archguard');
}
