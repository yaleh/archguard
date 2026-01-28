/**
 * Analyze Command v2.0 - Completely rewritten for unified diagram processing
 *
 * Breaking Changes from v1.x:
 * - Removed: --batch, --stdin, -o/--output, --base-dir, --skip-missing, --no-batch-index
 * - Changed: -s/--source renamed to --sources (plural)
 * - Added: -l/--level, --diagrams filter
 * - Single processing path: Everything goes through DiagramProcessor
 *
 * @module cli/commands/analyze
 * @version 2.0.0
 */

import { Command } from 'commander';
import os from 'os';
import { ProgressReporter } from '../progress.js';
import { ConfigLoader } from '../config-loader.js';
import { ErrorHandler } from '../error-handler.js';
import { DiagramProcessor } from '../processors/diagram-processor.js';
import { DiagramIndexGenerator } from '../utils/diagram-index-generator.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '../../types/config.js';
import type { DiagramResult } from '../processors/diagram-processor.js';

/**
 * Normalize CLI options to DiagramConfig[]
 *
 * Priority:
 * 1. If config.diagrams exists and not empty → use config file
 * 2. If CLI provides sources → create single diagram from CLI
 * 3. Otherwise → use default config
 *
 * @param config - Loaded configuration
 * @param cliOptions - CLI options
 * @returns Array of DiagramConfig
 */
export function normalizeToDiagrams(config: Config, cliOptions: CLIOptions): DiagramConfig[] {
  // Priority 1: Config file diagrams
  if (config.diagrams && config.diagrams.length > 0) {
    return config.diagrams as DiagramConfig[];
  }

  // Priority 2: CLI shortcut
  if (cliOptions.sources && cliOptions.sources.length > 0) {
    const diagram: DiagramConfig = {
      name: cliOptions.name || 'architecture',
      sources: cliOptions.sources,
      level: cliOptions.level || 'class',
      format: cliOptions.format,
      exclude: cliOptions.exclude,
    };
    return [diagram];
  }

  // Priority 3: Default diagram
  return [
    {
      name: 'architecture',
      sources: ['./src'],
      level: 'class',
    },
  ];
}

/**
 * Filter diagrams by names
 *
 * @param diagrams - All diagrams
 * @param selectedNames - Names to filter (undefined = return all)
 * @returns Filtered diagrams
 */
export function filterDiagrams(
  diagrams: DiagramConfig[],
  selectedNames?: string[]
): DiagramConfig[] {
  if (!selectedNames || selectedNames.length === 0) {
    return diagrams;
  }

  return diagrams.filter((d) => selectedNames.includes(d.name));
}

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
      .option('--diagrams <names...>', 'Generate specific diagrams (comma-separated)')

      // ========== CLI Shortcut (Single Diagram) ==========
      .option('-s, --sources <paths...>', 'Source directories (creates single diagram)')
      .option('-l, --level <level>', 'Detail level: package|class|method (default: class)', 'class')
      .option('-n, --name <name>', 'Diagram name (default: architecture)', 'architecture')

      // ========== Global Config Overrides ==========
      .option('-f, --format <type>', 'Output format: mermaid|json (default: mermaid)')
      .option('--output-dir <dir>', 'Output directory')
      .option('-e, --exclude <patterns...>', 'Exclude patterns')
      .option('--no-cache', 'Disable cache')
      .option('-c, --concurrency <num>', 'Parallel parsing concurrency', `${os.cpus().length}`)
      .option('-v, --verbose', 'Verbose output', false)

      // ========== Mermaid-Specific Options ==========
      .option('--no-llm-grouping', 'Disable LLM grouping (use heuristic)')
      .option('--mermaid-theme <theme>', 'Mermaid theme: default|forest|dark|neutral')
      .option('--mermaid-renderer <renderer>', 'Mermaid renderer: isomorphic|cli')

      // ========== Claude CLI Configuration ==========
      .option('--cli-command <command>', 'Claude CLI command')
      .option('--cli-args <args>', 'Additional CLI arguments (space-separated)')

      .action(analyzeCommandHandler)
  );
}

/**
 * Analyze command handler (v2.0 - completely rewritten)
 */
async function analyzeCommandHandler(cliOptions: CLIOptions): Promise<void> {
  const progress = new ProgressReporter();

  try {
    // Step 1: Load configuration
    progress.start('Loading configuration...');
    const configLoader = new ConfigLoader(process.cwd());

    // Build partial config for override
    const configOverrides: Partial<Config> = {};
    if (cliOptions.format) configOverrides.format = cliOptions.format;
    if (cliOptions.outputDir) configOverrides.outputDir = cliOptions.outputDir;
    if (cliOptions.exclude) configOverrides.exclude = cliOptions.exclude;
    if (cliOptions.cache !== undefined) {
      configOverrides.cache = { enabled: cliOptions.cache, ttl: 86400 };
    }
    if (cliOptions.concurrency) {
      configOverrides.concurrency = parseInt(String(cliOptions.concurrency), 10);
    }
    if (cliOptions.verbose !== undefined) configOverrides.verbose = cliOptions.verbose;
    if (cliOptions.cliCommand || cliOptions.cliArgs) {
      configOverrides.cli = {
        command: cliOptions.cliCommand || 'claude',
        args: cliOptions.cliArgs ? cliOptions.cliArgs.split(' ') : [],
        timeout: 60000,
      };
    }

    // Mermaid-specific options
    if (
      cliOptions.llmGrouping !== undefined ||
      cliOptions.mermaidTheme !== undefined ||
      cliOptions.mermaidRenderer !== undefined
    ) {
      configOverrides.mermaid = {
        enableLLMGrouping: cliOptions.llmGrouping,
        theme: cliOptions.mermaidTheme,
        renderer: cliOptions.mermaidRenderer,
      };
    }

    const config = await configLoader.load(configOverrides, cliOptions.config);
    progress.succeed('Configuration loaded');

    // Step 2: Normalize to DiagramConfig[]
    const diagrams = normalizeToDiagrams(config, cliOptions);
    progress.info(`Found ${diagrams.length} diagram(s) to generate`);

    // Step 3: Filter diagrams if needed
    const selectedDiagrams = filterDiagrams(diagrams, cliOptions.diagrams);

    if (selectedDiagrams.length === 0) {
      progress.warn('No diagrams selected');
      process.exit(0);
    }

    if (selectedDiagrams.length !== diagrams.length) {
      progress.info(`Filtered to ${selectedDiagrams.length} diagram(s)`);
    }

    // Step 4: Check Claude CLI availability (if needed)
    const needsClaude = selectedDiagrams.some((d) => (d.format || config.format) !== 'json');

    if (needsClaude) {
      progress.start('Checking Claude Code CLI...');
      const { isClaudeCodeAvailable } = await import('../../utils/cli-detector.js');
      const cliAvailable = await isClaudeCodeAvailable();

      if (!cliAvailable) {
        progress.fail('Claude Code CLI not found');
        console.error(
          '\nPlease install Claude Code CLI from: https://docs.anthropic.com/claude-code\n\n' +
            'To verify installation: claude --version\n'
        );
        process.exit(1);
      }

      progress.succeed('Claude Code CLI available');
    }

    // Step 5: Unified processing (core!)
    const processor = new DiagramProcessor({
      diagrams: selectedDiagrams,
      globalConfig: config as any, // Config type is compatible with GlobalConfig at runtime
      progress,
    });

    const results = await processor.processAll();

    // Step 6: Generate index (if multiple diagrams)
    if (results.length > 1) {
      progress.start('Generating index...');
      const indexGenerator = new DiagramIndexGenerator(config as any);
      await indexGenerator.generate(results);
      progress.succeed('Index generated');
    }

    // Step 7: Display results
    displayResults(results, config);

    // Exit with error if any diagram failed
    const hasFailed = results.some((r) => !r.success);
    process.exit(hasFailed ? 1 : 0);
  } catch (error) {
    progress.fail('Analysis failed');
    const errorHandler = new ErrorHandler();
    console.error(errorHandler.format(error, { verbose: cliOptions.verbose || false }));
    process.exit(1);
  }
}
