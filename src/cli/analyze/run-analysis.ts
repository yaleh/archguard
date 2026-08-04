import path from 'path';
import { ConfigLoader } from '../config-loader.js';
import type { Config } from '../config-loader.js';
import type { CLIOptions, DiagramConfig } from '@/types/config.js';
import type { GlobalConfig } from '@/types/config.js';
import type { ProgressReporterLike } from '../progress/index.js';
import { globalEntityTypeRegistry } from '@/core/entity-type-registry.js';
import { DiagramProcessor } from '../processors/diagram-processor.js';
import { DiagramIndexGenerator } from '../utils/diagram-index-generator.js';
import { ParseCache } from '@/parser/parse-cache.js';
import { persistQueryScopes } from '../query/query-artifacts.js';
import { readManifest, writeManifest, cleanStaleDiagrams } from '../cache/diagram-manifest.js';
import { normalizeToDiagrams } from './normalize-to-diagrams.js';
import type { DiagramResult } from '../processors/diagram-processor.js';
import { TestAnalyzer } from '@/analysis/test-analyzer.js';
import { TestOutputWriter } from '../utils/test-output-writer.js';
import { loadProjectSemanticsSidecar } from '@/analysis/project-semantics-loader.js';
import {
  PROJECT_SEMANTICS_VERSION,
  mergeProjectSemantics,
  type ProjectSemantics,
} from '@/types/extensions/project-semantics.js';
import { MetricsHistoryWriter } from '../metrics-history-writer.js';
import {
  computePackageFanMetricsFromRelations,
  computeCycleMetrics,
  extractPackageName,
} from '../mcp/tools/package-metrics-tools.js';
import {
  hasParserRuntimeEnvOverride,
  runtimeDiagnosticVisible,
  selectParserBackendFor,
  type SelectParserBackendOptions,
} from '@/plugins/shared/parser-runtime.js';
import { createLanguagePlugin } from '@/plugins/shared/plugin-factory.js';
import { ProcessParseWorkerPools } from '@/parser/process-parse-worker-pools.js';
import type { ParseWorkerLanguage } from '@/parser/parse-worker-pool.js';

/**
 * Load and initialize the plugin for a language, injecting the parser backend
 * selected by the per-language runtime resolver (TASK-39).
 *
 * There is deliberately NO language-plugin→TypeScript fallback here: a failed
 * Go/Java/Python/C++/Kotlin initialization surfaces as an explicit
 * language-specific error (e.g. ParserInitializationError) and is never
 * silently analyzed as TypeScript.
 */
export async function loadPluginForLanguage(
  language: string,
  workspaceRoot: string,
  parserRuntime: SelectParserBackendOptions = {}
): Promise<import('@/core/interfaces/language-plugin.js').ILanguagePlugin> {
  let plugin: import('@/core/interfaces/language-plugin.js').ILanguagePlugin;

  if (
    language === 'go' ||
    language === 'java' ||
    language === 'python' ||
    language === 'cpp' ||
    language === 'kotlin'
  ) {
    plugin = await createLanguagePlugin(language, parserRuntime);
  } else {
    const { TypeScriptPlugin } = await import('@/plugins/typescript/index.js');
    plugin = new TypeScriptPlugin();
  }
  await plugin.initialize?.({ workspaceRoot });
  if (plugin.metadata?.customEntityTypes) {
    for (const decl of plugin.metadata.customEntityTypes) {
      globalEntityTypeRegistry.register(decl);
    }
  }
  return plugin;
}

export interface RunAnalysisOptions {
  sessionRoot: string;
  workDir: string;
  cliOptions: Partial<CLIOptions>;
  reporter: ProgressReporterLike;
  parseWorkerPools?: ProcessParseWorkerPools;
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
  const archguardDir = config.workDir || workDir;
  const mergedProjectSemantics = await resolveProjectSemantics(config, archguardDir);
  config.projectSemantics = mergedProjectSemantics;
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
  const poolRegistry = options.parseWorkerPools ?? new ProcessParseWorkerPools();
  const ownsPools = options.parseWorkerPools === undefined;
  const language = (selectedDiagrams[0]?.language ?? 'typescript') as ParseWorkerLanguage;
  const runtimeConfig = config as Config & Pick<GlobalConfig, 'parserRuntime' | 'nativeModuleRoot'>;
  let parserRuntime: 'native' | 'wasm';
  if (language === 'typescript') {
    parserRuntime = 'native';
  } else {
    const selection = await selectParserBackendFor(language, {
      policy: hasParserRuntimeEnvOverride() ? undefined : runtimeConfig.parserRuntime,
      policySource:
        !hasParserRuntimeEnvOverride() && runtimeConfig.parserRuntime ? 'config' : undefined,
      nativeModuleRoot: runtimeConfig.nativeModuleRoot,
    });
    parserRuntime = selection.runtime;
    // TASK-43: effective-runtime visibility — verbose mode, or any fallback event
    // even non-verbose. Via the reporter: stderr in MCP mode, never stdout.
    if (runtimeDiagnosticVisible(config.verbose === true, selection)) {
      reporter.info(selection.diagnostic);
    }
  }
  const parseWorkerPool = poolRegistry.get({
    language,
    runtime: parserRuntime,
    workspaceRoot: sessionRoot,
    concurrency: config.concurrency,
  });
  const processor = new DiagramProcessor({
    diagrams: selectedDiagrams,
    globalConfig: config as unknown as GlobalConfig,
    progress: reporter,
    parseCache,
    parseWorkerPool,
    parserRuntime,
  });

  let results: DiagramResult[];
  try {
    results = await processor.processAll();
  } finally {
    if (ownsPools) await poolRegistry.terminate();
  }

  // Test analysis — invoked when --include-tests or --tests-only is set
  if (cliOptions.includeTests || cliOptions.testsOnly) {
    const archJson = processor.getLastArchJson();
    if (archJson) {
      try {
        reporter.start('Running test analysis...');
        const language = archJson.language ?? 'typescript';
        const workspaceRoot = archJson.workspaceRoot ?? sessionRoot;
        // parserRuntime/nativeModuleRoot are optional GlobalConfig extensions
        // (src/types/config-global.ts); the zod file schema does not strip
        // them when a Config object is constructed programmatically.
        const runtimeConfig = config as Config &
          Pick<GlobalConfig, 'parserRuntime' | 'nativeModuleRoot'>;
        const plugin = await loadPluginForLanguage(language, workspaceRoot, {
          // Canonical env policy (ARCHGUARD_PARSER_RUNTIME) takes precedence
          // over the config value when set.
          policy: hasParserRuntimeEnvOverride() ? undefined : runtimeConfig.parserRuntime,
          policySource:
            !hasParserRuntimeEnvOverride() && runtimeConfig.parserRuntime ? 'config' : undefined,
          nativeModuleRoot: runtimeConfig.nativeModuleRoot,
          // TASK-43: surface diagnostics through the reporter (stderr in MCP mode,
          // never MCP stdout) when verbose OR on any fallback event.
          onDiagnostic: (line, sel) => {
            if (runtimeDiagnosticVisible(config.verbose === true, sel)) reporter.info(line);
          },
        });
        const analyzer = new TestAnalyzer();
        const testAnalysis = await analyzer.analyze(archJson, plugin, {
          workspaceRoot,
          projectSemantics: mergedProjectSemantics,
        });

        // Attach result to archJson extensions
        if (!archJson.extensions) {
          archJson.extensions = {};
        }
        archJson.extensions.testAnalysis = testAnalysis;

        // Persist testAnalysis to a standalone query file so MCP tools can read it
        // (arch.json extensions are not reliably updated after processAll in multi-source runs)
        const queryDir = path.join(config.workDir || workDir, 'query');
        await import('fs-extra').then((fs) =>
          fs.default.outputJson(path.join(queryDir, 'test-analysis.json'), testAnalysis, {
            spaces: 2,
          })
        );

        // Write test output files
        const testOutputDir = config.outputDir || path.join(config.workDir || workDir, 'output');
        const writer = new TestOutputWriter();
        await writer.write(testAnalysis, testOutputDir);

        // Generate coverage heatmap
        await processor.generateTestCoverageHeatmap(testAnalysis, archJson, testOutputDir);

        reporter.succeed(
          `Test analysis complete: ${testAnalysis.metrics.totalTestFiles} test files found`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reporter.warn(`[test-analysis] Failed: ${msg}`);
      }
    } else if (config.verbose) {
      reporter.warn('[test-analysis] No ArchJSON available for test analysis');
    }
  }

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

  // Metrics history — append per-analyze package metrics snapshot to JSONL
  {
    const metricsArchJson = processor.getLastArchJson();
    if (metricsArchJson && metricsArchJson.entities && metricsArchJson.relations) {
      try {
        const entityIds = metricsArchJson.entities.map((e) => e.id);
        const allPackageNames = new Set(entityIds.map(extractPackageName));

        const { fanIn, fanOut } = computePackageFanMetricsFromRelations(
          metricsArchJson.relations,
          allPackageNames
        );

        const cycleMetrics = computeCycleMetrics([], allPackageNames);

        // Count entities per package
        const entityCountByPackage = new Map<string, number>();
        for (const pkg of allPackageNames) {
          entityCountByPackage.set(pkg, 0);
        }
        for (const entityId of entityIds) {
          const pkg = extractPackageName(entityId);
          if (allPackageNames.has(pkg)) {
            entityCountByPackage.set(pkg, (entityCountByPackage.get(pkg) ?? 0) + 1);
          }
        }

        const packages = Array.from(allPackageNames).map((pkg) => {
          const cm = cycleMetrics.get(pkg) ?? { cycleCount: 0, cyclesWith: [] };
          return {
            name: pkg,
            fanIn: fanIn.get(pkg) ?? 0,
            fanOut: fanOut.get(pkg) ?? 0,
            cycleCount: cm.cycleCount,
            entityCount: entityCountByPackage.get(pkg) ?? 0,
          };
        });

        const metricsOutputDir = config.workDir || workDir;
        const metricsWriter = new MetricsHistoryWriter();
        await metricsWriter.append(packages, metricsOutputDir);

        if (config.verbose) {
          reporter.info(`[metrics-history] Appended snapshot for ${packages.length} packages`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reporter.warn(`[metrics-history] Failed to append metrics snapshot: ${msg}`);
      }
    }
  }

  if (results.length > 1) {
    try {
      reporter.start('Generating index...');
      const indexGenerator = new DiagramIndexGenerator(config as unknown as GlobalConfig);
      await indexGenerator.generate(results);
      reporter.succeed('Index generated');
    } catch (err) {
      hasArtifactFailures = true;
      const msg = err instanceof Error ? err.message : String(err);
      reporter.warn(`[index] Failed to generate index: ${msg}`);
    }
  }

  // Git history analysis — invoked when --include-git is set
  if (cliOptions.includeGit) {
    try {
      reporter.start('Analyzing git history...');
      const {
        readGitLog,
        getHeadRef,
        getCurrentBranch,
        isGitRepo,
        getGitRoot: getGitRootFn,
      } = await import('../git-history/git-log-reader.js');
      const { aggregateFileMetrics, aggregatePackageMetrics } =
        await import('../git-history/history-aggregator.js');
      const { writeHistoryArtifacts } = await import('../git-history/history-writer.js');

      const gitArchJson = processor.getLastArchJson();
      const projectRoot = gitArchJson?.workspaceRoot ?? sessionRoot;
      if (!isGitRepo(projectRoot)) {
        reporter.warn('[git-history] Not a git repository — skipping git history analysis');
      } else {
        const sinceDays = 90;
        const maxCommits = 500;
        const includeMerges = false;
        const granularities: ('package' | 'file')[] = ['package', 'file'];

        const gitRepoRoot = getGitRootFn(projectRoot) ?? projectRoot;
        const gitSubDir =
          gitRepoRoot !== projectRoot
            ? path.relative(gitRepoRoot, projectRoot).replace(/\\/g, '/')
            : undefined;
        const rawCommits = readGitLog(gitRepoRoot, {
          sinceDays,
          maxCommits,
          includeMerges,
          pathFilter: gitSubDir,
        });
        // Strip the subdirectory prefix from file paths so metrics are relative to projectRoot
        const subDirPrefix = gitSubDir ? gitSubDir + '/' : '';
        const commits = subDirPrefix
          ? rawCommits.map((c) => ({
              ...c,
              files: c.files
                .filter((f) => f.path.startsWith(subDirPrefix))
                .map((f) => ({ ...f, path: f.path.slice(subDirPrefix.length) })),
            }))
          : rawCommits;
        if (commits.length === 0) {
          reporter.warn(`[git-history] No commits found in the last ${sinceDays} days`);
        } else {
          const fileMetrics = aggregateFileMetrics(commits);
          const packageMetrics = aggregatePackageMetrics(fileMetrics);
          const headRef = getHeadRef(gitRepoRoot);
          const analyzedBranch = getCurrentBranch(gitRepoRoot);
          const manifest = {
            version: '1' as const,
            generatedAt: new Date().toISOString(),
            headRef,
            analyzedBranch,
            sinceDays,
            maxCommits,
            totalCommits: commits.length,
            includeMerges,
            granularities,
          };
          const artifacts = {
            manifest,
            packageMetrics,
            fileMetrics,
          };
          const archguardDir = config.workDir || workDir;
          await writeHistoryArtifacts(archguardDir, artifacts);
          reporter.succeed(
            `Git history analysis complete: ${commits.length} commits, ${fileMetrics.length} files, ${packageMetrics.length} packages`
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reporter.warn(`[git-history] Failed: ${msg}`);
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

const EMPTY_PROJECT_SEMANTICS_DEFAULTS: Partial<ProjectSemantics> = {
  version: PROJECT_SEMANTICS_VERSION,
  nonProductionPatterns: [],
  barrelFiles: [],
  additionalTestPatterns: [],
  customAssertionPatterns: [],
};

async function resolveProjectSemantics(
  config: Config,
  archguardDir: string
): Promise<Partial<ProjectSemantics>> {
  const sidecarSemantics = await loadProjectSemanticsSidecar(archguardDir);

  return mergeProjectSemantics(
    config.projectSemantics,
    sidecarSemantics,
    EMPTY_PROJECT_SEMANTICS_DEFAULTS
  );
}
