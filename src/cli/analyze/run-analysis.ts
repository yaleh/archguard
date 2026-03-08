import path from 'path';
import { ConfigLoader } from '../config-loader.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '@/types/config.js';
import type { ProgressReporterLike } from '../progress.js';
import { DiagramProcessor } from '../processors/diagram-processor.js';
import { DiagramIndexGenerator } from '../utils/diagram-index-generator.js';
import { ParseCache } from '@/parser/parse-cache.js';
import { persistQueryScopes } from '../query/query-artifacts.js';
import { readManifest, writeManifest, cleanStaleDiagrams } from '../cache/diagram-manifest.js';
import { normalizeToDiagrams } from './normalize-to-diagrams.js';
import type { DiagramResult } from '../processors/diagram-processor.js';

export interface RunAnalysisOptions {
  sessionRoot: string;
  workDir: string;
  cliOptions: Partial<CLIOptions>;
  reporter: ProgressReporterLike;
}

export interface RunAnalysisResult {
  config: Config;
  diagrams: DiagramConfig[];
  results: DiagramResult[];
  queryScopesPersisted: number;
  persistedScopeKeys: string[];
  hasDiagramFailures: boolean;
}

function isPartialRun(cliOptions: Partial<CLIOptions>): boolean {
  const hasLevelFilter = Array.isArray(cliOptions.diagrams) && cliOptions.diagrams.length > 0;
  const hasSourceOverride = Array.isArray(cliOptions.sources) && cliOptions.sources.length > 0;
  return hasLevelFilter || hasSourceOverride;
}

export async function runAnalysis(options: RunAnalysisOptions): Promise<RunAnalysisResult> {
  const { sessionRoot, workDir, cliOptions, reporter } = options;
  reporter.start('Loading configuration...');

  const configLoader = new ConfigLoader(sessionRoot);
  const configOverrides = buildConfigOverrides(cliOptions, workDir, sessionRoot);
  const config = await configLoader.load(configOverrides, cliOptions.config);
  reporter.succeed('Configuration loaded');

  const selectedDiagrams = (
    await normalizeToDiagrams(config, cliOptions as CLIOptions, sessionRoot)
  ).map((diagram) => ({
    ...diagram,
    sources: diagram.sources.map((source) => path.resolve(sessionRoot, source)),
  }));
  reporter.info(`Found ${selectedDiagrams.length} diagram(s) to generate`);

  if (selectedDiagrams.length === 0) {
    return {
      config,
      diagrams: [],
      results: [],
      queryScopesPersisted: 0,
      persistedScopeKeys: [],
      hasDiagramFailures: false,
    };
  }

  const cacheDir = config.cache?.dir || path.join(config.workDir || '.archguard', 'cache');
  const outputDir = config.outputDir || path.join(config.workDir || '.archguard', 'output');
  const partial = isPartialRun(cliOptions);
  const existingManifest = await readManifest(cacheDir);
  if (existingManifest && !partial) {
    const currentNames = selectedDiagrams.map((d) => d.name);
    const stale = await cleanStaleDiagrams(currentNames, existingManifest, outputDir);
    if (stale.length > 0 && config.verbose) {
      reporter.info(`Cleaned ${stale.length} stale diagram(s): ${stale.join(', ')}`);
    }
  }

  const parseCache = new ParseCache();
  const processor = new DiagramProcessor({
    diagrams: selectedDiagrams,
    globalConfig: config as any,
    progress: reporter,
    parseCache,
  });

  const results = await processor.processAll();

  const successfulNames = results.filter((r) => r.success).map((r) => r.name);
  if (successfulNames.length > 0 && !partial) {
    try {
      await writeManifest(cacheDir, successfulNames, outputDir);
    } catch (err) {
      if (config.verbose) {
        const msg = err instanceof Error ? err.message : String(err);
        reporter.warn(`[manifest] Failed to write diagram manifest: ${msg}`);
      }
    }
  }

  let persistedScopeKeys: string[] = [];
  let hasArtifactFailures = results.some((r) => !r.success);
  const queryScopes = processor.getQuerySourceGroups();
  if (queryScopes.length > 0) {
    try {
      const preferredGlobalScopeKey = queryScopes.find((scope) => scope.role === 'primary')?.key;
      const entries = await persistQueryScopes(config.workDir || workDir, queryScopes, {
        preferredGlobalScopeKey,
      });
      persistedScopeKeys = entries.map((entry) => entry.key);
      if (config.verbose) {
        reporter.info(
          `Persisted ${entries.length} query scope(s) to ${config.workDir || workDir}/query/`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reporter.warn(`[query] Failed to persist query scopes: ${msg}`);
    }
  }

  if (results.length > 1) {
    try {
      reporter.start('Generating index...');
      const indexGenerator = new DiagramIndexGenerator(config as any);
      await indexGenerator.generate(results);
      reporter.succeed('Index generated');
    } catch (err) {
      hasArtifactFailures = true;
      const msg = err instanceof Error ? err.message : String(err);
      reporter.warn(`[index] Failed to generate index: ${msg}`);
    }
  }

  return {
    config,
    diagrams: selectedDiagrams,
    results,
    queryScopesPersisted: persistedScopeKeys.length,
    persistedScopeKeys,
    hasDiagramFailures: hasArtifactFailures,
  };
}

function buildConfigOverrides(
  cliOptions: Partial<CLIOptions>,
  workDir: string,
  sessionRoot: string
): Partial<Config> {
  const configOverrides: Partial<Config> = { workDir };
  if (cliOptions.format) configOverrides.format = cliOptions.format;
  if (cliOptions.exclude) configOverrides.exclude = cliOptions.exclude;
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
  if (cliOptions.mermaidTheme !== undefined || cliOptions.mermaidRenderer !== undefined) {
    configOverrides.mermaid = {
      theme: cliOptions.mermaidTheme,
      renderer: cliOptions.mermaidRenderer,
      transparentBackground: true,
    };
  }
  if (cliOptions.outputDir) configOverrides.outputDir = cliOptions.outputDir;

  if (
    cliOptions.sources &&
    cliOptions.sources.length > 0 &&
    !cliOptions.outputDir &&
    !cliOptions.workDir
  ) {
    const sourcePath = path.resolve(sessionRoot, cliOptions.sources[0]);
    if (!sourcePath.startsWith(sessionRoot)) {
      const SOURCE_ROOT_NAMES = ['src', 'lib', 'app', 'source'];
      const basename = path.basename(sourcePath);
      const projectRoot = SOURCE_ROOT_NAMES.includes(basename)
        ? path.dirname(sourcePath)
        : sourcePath;
      configOverrides.workDir = path.join(projectRoot, '.archguard');
    }
  }

  return configOverrides;
}
