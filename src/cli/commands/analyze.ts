/**
 * Analyze Command - Main CLI command for analyzing TypeScript projects
 * Story 2.2: Enhanced with Claude Code CLI detection
 */

import { Command } from 'commander';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { ParallelParser } from '@/parser/parallel-parser';
import { PlantUMLGenerator } from '@/ai/plantuml-generator';
import { ProgressReporter } from '../progress';
import { ConfigLoader } from '../config-loader';
import { OutputPathResolver } from '../utils/output-path-resolver';
import { ErrorHandler } from '../error-handler';
import { FileDiscoveryService } from '../utils/file-discovery-service';
import type { Config } from '../config-loader';
import type { AnalyzeOptions } from '../types';

/**
 * Create the analyze command
 */
export function createAnalyzeCommand(): Command {
  return (
    new Command('analyze')
      .description('Analyze TypeScript project and generate architecture diagrams')
      .option('-s, --source <paths...>', 'Source directories to analyze (can specify multiple)', ['./src'])
      .option('-o, --output <path>', 'Output file path')
      .option('-f, --format <type>', 'Output format (plantuml|json|svg)', 'plantuml')
      .option('-e, --exclude <patterns...>', 'Exclude patterns')
      .option('--no-cache', 'Disable cache')
      .option('-c, --concurrency <num>', 'Parallel parsing concurrency', `${os.cpus().length}`)
      .option('-v, --verbose', 'Verbose output', false)
      // Phase 4.2: CLI parameter integration
      .option('--cli-command <command>', 'Claude CLI command to use', 'claude')
      .option('--cli-args <args>', 'Additional CLI arguments (space-separated)')
      .option('--output-dir <dir>', 'Output directory for diagrams', './archguard')
      .action(analyzeCommandHandler)
  );
}

/**
 * Build ConfigLoader options from CLI options
 * Priority: CLI options > config file > defaults
 */
function buildConfigLoaderOptions(options: AnalyzeOptions): Partial<Config> {
  const configLoaderOptions: {
    source?: string | string[];
    output?: string;
    format?: 'plantuml' | 'json' | 'svg';
    exclude?: string[];
    cli?: {
      command?: string;
      args?: string[];
    };
    outputDir?: string;
    cache?: {
      enabled: boolean;
    };
    concurrency?: number;
    verbose?: boolean;
  } = {};

  // Basic options
  // Normalize source to array if needed (commander.js may return string or array)
  if (options.source) {
    configLoaderOptions.source = Array.isArray(options.source)
      ? options.source
      : [options.source];
  }
  if (options.output) configLoaderOptions.output = options.output;
  if (options.format) configLoaderOptions.format = options.format;
  if (options.exclude) configLoaderOptions.exclude = options.exclude;

  // Phase 4.2: CLI-specific options
  if (options.cliCommand || options.cliArgs) {
    const cliOptions: {
      command?: string;
      args?: string[];
    } = {};
    if (options.cliCommand) cliOptions.command = options.cliCommand;
    if (options.cliArgs) cliOptions.args = options.cliArgs.split(' ');
    configLoaderOptions.cli = cliOptions;
  }

  if (options.outputDir) configLoaderOptions.outputDir = options.outputDir;

  // Cache options
  if (options.cache !== undefined) {
    configLoaderOptions.cache = { enabled: options.cache };
  }

  // Other options
  if (options.concurrency) {
    configLoaderOptions.concurrency = parseInt(String(options.concurrency), 10);
  }
  if (options.verbose !== undefined) {
    configLoaderOptions.verbose = options.verbose;
  }

  return configLoaderOptions as Partial<Config>;
}

/**
 * Analyze command handler
 */
async function analyzeCommandHandler(options: AnalyzeOptions): Promise<void> {
  const progress = new ProgressReporter();

  try {
    // Phase 4.2: Load configuration with CLI options priority
    const configLoader = new ConfigLoader(process.cwd());
    const config = await configLoader.load(buildConfigLoaderOptions(options));

    // Use config values with fallback to options for backward compatibility
    const concurrency = config.concurrency || os.cpus().length;

    // Find TypeScript files using FileDiscoveryService
    progress.start('Finding TypeScript files...');

    // Normalize source to array
    const sourcePaths = Array.isArray(config.source) ? config.source : [config.source];

    // Use FileDiscoveryService for file discovery
    const discoveryService = new FileDiscoveryService();
    const files = await discoveryService.discoverFiles({
      sources: sourcePaths,
      baseDir: process.cwd(),
      exclude: config.exclude,
      skipMissing: false,
    });

    progress.succeed(`Found ${files.length} TypeScript files`);

    if (files.length === 0) {
      progress.warn('No TypeScript files found');
      process.exit(0);
    }

    // Parse files with parallel processing
    progress.start('Parsing TypeScript files...');
    const parser = new ParallelParser({
      concurrency,
      continueOnError: true,
    });

    // Attach progress events
    let completedFiles = 0;
    parser.on('file:complete', () => {
      completedFiles++;
      progress.update(completedFiles, files.length);
    });

    parser.on('file:error', ({ file, error }: { file: string; error: string }) => {
      if (config.verbose) {
        progress.warn(`Error parsing ${file}: ${error}`);
      }
    });

    const metrics = await parser.parseFilesWithMetrics(files);
    const archJSON = metrics.result;

    progress.succeed(
      `Parsed ${files.length} files in ${(metrics.parseTime / 1000).toFixed(2)}s (${metrics.filesPerSecond.toFixed(1)} files/sec)`
    );

    // Handle output format
    if (config.format === 'json') {
      // JSON output
      const outputPath = config.output || path.join(process.cwd(), 'architecture.json');
      await fs.writeFile(outputPath, JSON.stringify(archJSON, null, 2));
      progress.succeed(`Saved ArchJSON to ${outputPath}`);
    } else {
      // PlantUML output (default)
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

      const generator = new PlantUMLGenerator(config);

      // Use OutputPathResolver for centralized path management
      const pathResolver = new OutputPathResolver(config);
      await pathResolver.ensureDirectory();
      const paths = pathResolver.resolve({});

      if (config.format === 'svg') {
        // SVG output
        progress.start('Generating SVG diagram...');
        const plantuml = await generator.generate(archJSON);

        await fs.writeFile(paths.paths.svg, plantuml);
        progress.succeed(`Generated SVG diagram: ${paths.paths.svg}`);
      } else {
        // PNG output (default) - also saves .puml file
        progress.start('Generating PlantUML diagram...');

        await generator.generateAndRender(archJSON, paths);

        progress.succeed(`Generated diagram: ${paths.paths.png}`);

        // Show statistics
        if (config.verbose) {
          progress.info(`Entities: ${archJSON.entities.length}`);
          progress.info(`Relations: ${archJSON.relations.length}`);
          progress.info(`Memory: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    progress.fail('Analysis failed');
    const errorHandler = new ErrorHandler();
    console.error(errorHandler.format(error, { verbose: options.verbose || false }));
    process.exit(1);
  }
}
