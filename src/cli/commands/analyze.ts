/**
 * Analyze Command - Main CLI command for analyzing TypeScript projects
 * Story 6: Enhanced with parallel processing
 */

import { Command } from 'commander';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import globby from 'globby';
import { ParallelParser } from '@/parser/parallel-parser';
import { PlantUMLGenerator } from '@/ai/plantuml-generator';
import { ProgressReporter } from '../progress';
import type { AnalyzeOptions } from '../types';

/**
 * Create the analyze command
 */
export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze TypeScript project and generate architecture diagrams')
    .option('-s, --source <path>', 'Source directory to analyze', './src')
    .option('-o, --output <path>', 'Output file path')
    .option('-f, --format <type>', 'Output format (plantuml|json|svg)', 'plantuml')
    .option('-e, --exclude <patterns...>', 'Exclude patterns')
    .option('--no-cache', 'Disable cache')
    .option('-c, --concurrency <num>', 'Parallel parsing concurrency', `${os.cpus().length}`)
    .option('-v, --verbose', 'Verbose output', false)
    .action(analyzeCommandHandler);
}

/**
 * Analyze command handler
 */
async function analyzeCommandHandler(options: AnalyzeOptions): Promise<void> {
  const progress = new ProgressReporter();

  try {
    // Parse concurrency option
    const concurrency = parseInt(String(options.concurrency || os.cpus().length), 10);

    // Find TypeScript files
    progress.start('Finding TypeScript files...');
    const sourceDir = path.resolve(options.source || './src');
    const files = await globby([
      `${sourceDir}/**/*.ts`,
      `!${sourceDir}/**/*.test.ts`,
      `!${sourceDir}/**/*.spec.ts`,
      `!**/node_modules/**`,
      ...(options.exclude?.map((p) => `!${p}`) || []),
    ]);

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
      if (options.verbose) {
        progress.warn(`Error parsing ${file}: ${error}`);
      }
    });

    const metrics = await parser.parseFilesWithMetrics(files);
    const archJSON = metrics.result;

    progress.succeed(
      `Parsed ${files.length} files in ${(metrics.parseTime / 1000).toFixed(2)}s (${metrics.filesPerSecond.toFixed(1)} files/sec)`
    );

    // Handle output format
    if (options.format === 'json') {
      // JSON output
      const outputPath = options.output || path.join(process.cwd(), 'architecture.json');
      await fs.writeFile(outputPath, JSON.stringify(archJSON, null, 2));
      progress.succeed(`Saved ArchJSON to ${outputPath}`);
    } else {
      // PlantUML output (default)
      progress.start('Generating PlantUML diagram...');

      const generator = new PlantUMLGenerator({
        apiKey: process.env.ANTHROPIC_API_KEY || '',
      });

      const plantuml = await generator.generate(archJSON);
      const outputPath = options.output || path.join(process.cwd(), 'architecture.puml');

      await fs.writeFile(outputPath, plantuml);
      progress.succeed(`Generated PlantUML diagram: ${outputPath}`);

      // Show statistics
      if (options.verbose) {
        progress.info(`Entities: ${archJSON.entities.length}`);
        progress.info(`Relations: ${archJSON.relations.length}`);
        progress.info(`Memory: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    process.exit(0);
  } catch (error) {
    progress.fail('Analysis failed');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
