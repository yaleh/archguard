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
import { ConfigLoader } from '../config-loader.js';
import { ErrorHandler } from '../error-handler.js';
import { DiagramProcessor } from '../processors/diagram-processor.js';
import { DiagramIndexGenerator } from '../utils/diagram-index-generator.js';
import { detectProjectStructure } from '../utils/project-structure-detector.js';
import { detectCppProjectStructure } from '../utils/cpp-project-structure-detector.js';
import { ParseCache } from '@/parser/parse-cache.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '../../types/config.js';
import { persistQueryScopes } from '../query/query-artifacts.js';
import type { DiagramResult } from '../processors/diagram-processor.js';

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
export async function normalizeToDiagrams(
  config: Config,
  cliOptions: CLIOptions,
  rootDir?: string
): Promise<DiagramConfig[]> {
  // Priority 1: Config file diagrams
  if (config.diagrams && config.diagrams.length > 0) {
    return filterByLevels(config.diagrams as DiagramConfig[], cliOptions.diagrams);
  }

  // Priority 2: CLI sources → language-specific or auto-detect
  if (cliOptions.sources && cliOptions.sources.length > 0) {
    // Resolve effective language (--atlas implies 'go')
    const language = cliOptions.lang ?? (cliOptions.atlas ? 'go' : undefined);
    // Atlas is enabled by default for Go unless --no-atlas is passed
    const atlasEnabled = language === 'go' && !cliOptions.noAtlas;

    // Go Atlas special case: single diagram, skip auto-detection
    if (atlasEnabled) {
      const diagram: DiagramConfig = {
        name: 'architecture',
        sources: cliOptions.sources,
        level: 'package',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language,
        languageSpecific: {
          atlas: {
            enabled: true,
            functionBodyStrategy: cliOptions.atlasStrategy ?? 'selective',
            excludeTests: !cliOptions.atlasIncludeTests,
            protocols: cliOptions.atlasProtocols?.split(',').map((s) => s.trim()),
            layers: cliOptions.atlasLayers?.split(',').map((s) => s.trim()),
          },
        },
      };
      return [diagram];
    }

    // Go without atlas (--lang go --no-atlas): single diagram, no atlas config
    if (language === 'go' && cliOptions.noAtlas) {
      const diagram: DiagramConfig = {
        name: 'architecture',
        sources: cliOptions.sources,
        level: 'class',
        format: cliOptions.format,
        exclude: cliOptions.exclude,
        language,
      };
      return [diagram];
    }

    // C++: auto-detect module structure (package + class + per-module class diagrams)
    // NOTE: only sources[0] is used; multiple --sources paths are not supported for C++
    if (language === 'cpp') {
      const sourcePath = path.resolve(cliOptions.sources[0]);
      const moduleName = path.basename(sourcePath);
      const diagrams = await detectCppProjectStructure(sourcePath, moduleName, {
        format: cliOptions.format,
        exclude: cliOptions.exclude,
      });
      return filterByLevels(diagrams, cliOptions.diagrams);
    }

    // TypeScript/other: auto-detect from sources[0]
    const externalSourceRoot = path.resolve(cliOptions.sources[0]);
    const diagrams = await detectProjectStructure(process.cwd(), externalSourceRoot);
    return filterByLevels(diagrams, cliOptions.diagrams);
  }

  // Priority 3: Auto-detect from rootDir
  const diagrams = await detectProjectStructure(rootDir ?? process.cwd());
  return filterByLevels(diagrams, cliOptions.diagrams);
}

/**
 * Filter diagrams by level
 *
 * @param diagrams - All diagrams
 * @param levels - Level values to filter by (undefined = return all)
 * @returns Filtered diagrams
 */
export function filterByLevels(diagrams: DiagramConfig[], levels?: string[]): DiagramConfig[] {
  if (!levels || levels.length === 0) {
    return diagrams;
  }

  return diagrams.filter((d) => levels.includes(d.level ?? 'class'));
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
    // Step 1: Load configuration
    progress.start('Loading configuration...');
    const configLoader = new ConfigLoader(process.cwd());

    // Build partial config for override
    const configOverrides: Partial<Config> = {};
    if (cliOptions.format) configOverrides.format = cliOptions.format;
    if (cliOptions.exclude) configOverrides.exclude = cliOptions.exclude;
    if (cliOptions.workDir) configOverrides.workDir = cliOptions.workDir;
    if (cliOptions.cache !== undefined) {
      configOverrides.cache = { enabled: cliOptions.cache, ttl: 86400 } as Config['cache'];
    }
    if (cliOptions.cacheDir) {
      configOverrides.cache = {
        enabled: cliOptions.cache ?? true,
        ttl: 86400,
        dir: cliOptions.cacheDir,
      };
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
    if (cliOptions.mermaidTheme !== undefined || cliOptions.mermaidRenderer !== undefined) {
      configOverrides.mermaid = {
        theme: cliOptions.mermaidTheme,
        renderer: cliOptions.mermaidRenderer,
        transparentBackground: true,
      };
    }

    // Smart outputDir inference: if sources point outside cwd, infer project root
    if (
      cliOptions.sources &&
      cliOptions.sources.length > 0 &&
      !cliOptions.outputDir &&
      !cliOptions.workDir
    ) {
      const sourcePath = path.resolve(cliOptions.sources[0]);
      const cwd = process.cwd();
      if (!sourcePath.startsWith(cwd)) {
        const SOURCE_ROOT_NAMES = ['src', 'lib', 'app', 'source'];
        const basename = path.basename(sourcePath);
        const projectRoot = SOURCE_ROOT_NAMES.includes(basename)
          ? path.dirname(sourcePath)
          : sourcePath;
        configOverrides.workDir = path.join(projectRoot, '.archguard');
      }
    }

    // Apply explicit outputDir override after smart inference (CLI wins)
    if (cliOptions.outputDir) configOverrides.outputDir = cliOptions.outputDir;

    const config = await configLoader.load(configOverrides, cliOptions.config);
    progress.succeed('Configuration loaded');

    // Step 2: Normalize to DiagramConfig[] (filtering by level is handled inside)
    const selectedDiagrams = await normalizeToDiagrams(config, cliOptions, process.cwd());
    progress.info(`Found ${selectedDiagrams.length} diagram(s) to generate`);

    if (selectedDiagrams.length === 0) {
      progress.warn('No diagrams selected');
      process.exit(0);
    }

    // Step 4: Unified processing (core!)
    const parseCache = new ParseCache();
    const processor = new DiagramProcessor({
      diagrams: selectedDiagrams,
      globalConfig: config as any, // Config type is compatible with GlobalConfig at runtime
      progress,
      parseCache,
    });

    const results = await processor.processAll();

    // Step 5.5: Persist query scopes (non-blocking — warnings only on failure)
    const queryScopes = processor.getQuerySourceGroups();
    if (queryScopes.length > 0) {
      try {
        const workDir = config.workDir || '.archguard';
        await persistQueryScopes(workDir, queryScopes);
        if (config.verbose) {
          progress.info(`Persisted ${queryScopes.length} query scope(s) to ${workDir}/query/`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[query] Failed to persist query scopes: ${msg}`);
      }
    }

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
