/**
 * Query Command — scope-aware entity-level and structural discovery queries.
 *
 * Phase 3: entity/relationship queries (--entity, --deps-of, --used-by, etc.)
 * Phase 4: structural discovery (--type, --high-coupling, --orphans, --in-cycles)
 *
 * @module cli/commands/query
 */

import { Command } from 'commander';
import _path from 'path';
import { resolveArchDir, loadEngine, readManifest } from '../query/engine-loader.js';
import type {
  QueryEngine,
  PackageStatEntry,
  QueryMethodOptions,
  OutputScope,
  QueryOutputFormat,
  EdgeListOutput,
} from '../query/query-engine.js';
import type { Entity, CycleInfo } from '@/types/index.js';
import { loadHistoryData, GitHistoryNotFoundError } from '../git-history/history-loader.js';
import { HistoryQuery } from '../git-history/history-query.js';
import {
  computePackageFanMetrics,
  enrichPackageNodes,
} from '../mcp/tools/atlas-analytics-tools.js';

interface QueryOptions {
  archDir?: string;
  scope?: string;
  format: string;
  verbose?: boolean;

  // Phase 3: entity queries
  entity?: string;
  depsOf?: string;
  usedBy?: string;
  implementersOf?: string;
  subclassesOf?: string;
  file?: string;
  depth: string;
  cycles?: true;
  summary?: true;
  listScopes?: true;

  // Phase 4: structure discovery
  type?: string;
  highCoupling?: true;
  threshold: string;
  orphans?: true;
  inCycles?: true;

  // Phase 5: attribute queries
  attr?: string[];

  // Package stats
  packageStats?: string | boolean;
  packageStatsSortBy?: string;
  packageStatsMinFiles?: string;
  packageStatsMinLoc?: string;
  packageStatsTop?: string;

  // Phase 85: LLM-aware output
  outputScope?: string;
  queryFormat?: string;

  // Phase 93: call graph
  callers?: string;
  callersDepth?: string;

  // ADR-007 §4: Atlas layer
  atlasLayer?: string;

  // ADR-007 §4: Test analysis
  testPatterns?: true;
  testIssues?: true;
  severity?: string;
  testMetrics?: true;
  entityCoverage?: string;

  // ADR-007 §4: Atlas analytics
  packageFanin?: true;
  packageFanout?: true;
  godPackages?: true;

  // ADR-007 §4: Git history (shared --target-type flag)
  targetType?: string;
  changeContext?: string;
  cochange?: string;
  changeRisk?: string;
  ownership?: string;
}

/**
 * Parse a raw --attr option string into a key and coerced value.
 *
 * Format: `key` (presence check) or `key=value` (equality check).
 * Values are coerced: "true"/"false" → boolean, numeric strings → number, else string.
 * Splits on the FIRST `=` only so values containing `=` are preserved.
 */
export function parseAttrOption(raw: string): {
  key: string;
  value: string | number | boolean | undefined;
} {
  const eqIdx = raw.indexOf('=');
  if (eqIdx === -1) return { key: raw, value: undefined };
  const key = raw.slice(0, eqIdx);
  const rawVal = raw.slice(eqIdx + 1);
  if (rawVal === 'true') return { key, value: true };
  if (rawVal === 'false') return { key, value: false };
  const num = Number(rawVal);
  if (!isNaN(num) && rawVal !== '') return { key, value: num };
  return { key, value: rawVal };
}

function buildAttrQueryLabel(
  type: string | undefined,
  attrs: Array<{ key: string; value: string | number | boolean | undefined }>
): string {
  const parts: string[] = [];
  if (type) parts.push(`type="${type}"`);
  for (const a of attrs) {
    parts.push(a.value === undefined ? `attr:${a.key}` : `attr:${a.key}=${a.value}`);
  }
  return `Entities matching ${parts.join(', ')}`;
}

/**
 * Create the query command
 */
export function createQueryCommand(): Command {
  return (
    new Command('query')
      .description('Query architecture entities and relationships')

      // Common options
      .option('--arch-dir <dir>', 'ArchGuard work directory')
      .option('--scope <key>', 'Query scope key')
      .option('--format <type>', 'Output format: json|text', 'text')
      .option('--verbose', 'Return full entities in JSON output instead of summary')

      // Phase 3: entity queries
      .option('--entity <name>', 'Find entity by name')
      .option('--deps-of <name>', 'Find dependencies of entity')
      .option('--used-by <name>', 'Find dependents of entity')
      .option('--implementers-of <name>', 'Find implementers of interface')
      .option('--subclasses-of <name>', 'Find subclasses of class')
      .option('--file <path>', 'Find entities in file')
      .option('--depth <n>', 'BFS depth for --deps-of/--used-by (1-5)', '1')
      .option('--cycles', 'Show dependency cycles')
      .option('--summary', 'Show scope summary')
      .option('--list-scopes', 'List available query scopes')

      // Phase 4: structure discovery
      .option('--type <entityType>', 'Filter entities by type')
      .option('--high-coupling', 'Find high-coupling entities')
      .option('--threshold <n>', 'Coupling threshold for --high-coupling', '8')
      .option('--orphans', 'Find orphan entities (no relations)')
      .option('--in-cycles', 'Find entities participating in cycles')

      // Phase 5: attribute queries
      .option(
        '--attr <keyOrPair...>',
        'Filter by attribute key or key=value pair (repeatable, AND-composed)'
      )

      // Package stats
      .option('--package-stats [depth]', 'Show package statistics (optional depth 1-5, default: 2)')
      .option(
        '--package-stats-sort-by <key>',
        'Sort packages by: loc|fileCount|entityCount|methodCount (default: loc)'
      )
      .option('--package-stats-min-files <n>', 'Exclude packages with fewer than N files')
      .option(
        '--package-stats-min-loc <n>',
        'Exclude packages with loc below N (no effect for Go/TypeScript)'
      )
      .option('--package-stats-top <n>', 'Limit output to top N packages')

      // Phase 85: LLM-aware output
      .option('--output-scope <scope>', 'Output granularity: package|class|method (default: class)')
      .option(
        '--query-format <format>',
        'Output format: structured|edge-list (default: structured)'
      )

      // Phase 93: call graph
      .option('--callers <entity>', 'Find callers of entity (use "Class" or "Class.method")')
      .option('--callers-depth <n>', 'BFS depth for --callers (1-5)', '1')

      // ADR-007 §4: Atlas layer (mirrors archguard_get_atlas_layer)
      .option(
        '--atlas-layer <layer>',
        'Show Go Atlas layer data: package|capability|goroutine|flow'
      )

      // ADR-007 §4: Test analysis (mirrors archguard_detect_test_patterns / get_test_*)
      .option('--test-patterns', 'Show detected test pattern config and framework summary')
      .option('--test-issues', 'Show static test quality issues (orphans, zero-assertions, skips)')
      .option('--severity <level>', 'Filter --test-issues by severity: warning|info (default: all)')
      .option('--test-metrics', 'Show test suite metrics and package coverage breakdown')
      .option('--entity-coverage <entityId>', 'Show test coverage for a specific entity ID')

      // ADR-007 §4: Atlas analytics (mirrors archguard_get_package_fan* / detect_god_packages)
      .option('--package-fanin', 'List Atlas packages ranked by fan-in (most-depended-on first)')
      .option('--package-fanout', 'List Atlas packages ranked by fan-out (most-dependent-on first)')
      .option('--god-packages', 'Detect Atlas packages that violate single-responsibility')

      // ADR-007 §4: Git history (mirrors archguard_get_change_* / get_ownership)
      .option(
        '--target-type <type>',
        'Target type for git history queries: file|package (default: file)'
      )
      .option('--change-context <path>', 'Show change context (churn/ownership/risk) for a path')
      .option('--cochange <path>', 'Show co-change neighbors for a path')
      .option('--change-risk <path>', 'Show change risk score for a path')
      .option('--ownership <path>', 'Show maintainer ownership for a path')

      .action(queryHandler)
  );
}

/**
 * Query command handler
 */
async function queryHandler(opts: QueryOptions): Promise<void> {
  try {
    validateQueryOptions(opts);

    // --list-scopes: read manifest directly, no engine needed
    if (opts.listScopes) {
      await handleListScopes(opts);
      return;
    }

    // Load engine
    const archDir = resolveArchDir(opts.archDir);
    const { engine, extensionAccessor, relationQueryService } = await loadEngine(
      archDir,
      opts.scope
    );
    const isJson = opts.format === 'json';
    const scopeEntry = engine.getScopeEntry();

    // Build QueryMethodOptions from Phase 85 flags (only when at least one is set)
    const queryOptions: QueryMethodOptions | undefined =
      opts.outputScope || opts.queryFormat
        ? {
            outputScope: opts.outputScope as OutputScope | undefined,
            queryFormat: opts.queryFormat as QueryOutputFormat | undefined,
          }
        : undefined;

    // Determine which query to run
    let result: unknown;

    // When queryOptions are present, the engine already applies scope/format narrowing.
    // In that case we bypass projectEntitiesForOutput (which would strip members via toSummary).
    // For text output we still use the pre-options entities for formatEntityList.
    const useRawEngineResult = !!queryOptions;

    if (opts.entity) {
      const raw = engine.findEntity(opts.entity, queryOptions);
      const entities = toDisplayEntities(raw);
      result = useRawEngineResult ? raw : projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Entities matching "${opts.entity}"`);
    } else if (opts.depsOf) {
      const depth = parseBoundedInt(opts.depth, '--depth', 1, 5);
      const raw = engine.applyOutputOptions(
        relationQueryService.getDependencies(opts.depsOf, depth),
        queryOptions
      );
      const entities = toDisplayEntities(raw);
      result = useRawEngineResult ? raw : projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Dependencies of "${opts.depsOf}" (depth: ${depth})`);
    } else if (opts.usedBy) {
      const depth = parseBoundedInt(opts.depth, '--depth', 1, 5);
      const raw = engine.applyOutputOptions(
        relationQueryService.getDependents(opts.usedBy, depth),
        queryOptions
      );
      const entities = toDisplayEntities(raw);
      result = useRawEngineResult ? raw : projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Dependents of "${opts.usedBy}" (depth: ${depth})`);
    } else if (opts.implementersOf) {
      const raw = engine.applyOutputOptions(
        relationQueryService.findImplementers(opts.implementersOf),
        queryOptions
      );
      const entities = toDisplayEntities(raw);
      result = useRawEngineResult ? raw : projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Implementers of "${opts.implementersOf}"`);
    } else if (opts.subclassesOf) {
      const raw = engine.applyOutputOptions(
        relationQueryService.findSubclasses(opts.subclassesOf),
        queryOptions
      );
      const entities = toDisplayEntities(raw);
      result = useRawEngineResult ? raw : projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Subclasses of "${opts.subclassesOf}"`);
    } else if (opts.file) {
      const raw = engine.getFileEntities(opts.file, queryOptions);
      const entities = toDisplayEntities(raw);
      result = useRawEngineResult ? raw : projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Entities in ${opts.file}`);
    } else if (opts.cycles) {
      const cycles = engine.getCycles();
      result = cycles;
      if (!isJson) formatCycles(cycles);
    } else if (opts.summary) {
      const summary = engine.getSummary();
      result = summary;
      if (!isJson) formatSummary(summary);
    } else if (opts.type || opts.attr?.length) {
      const parsedAttrs = (opts.attr ?? []).map(parseAttrOption);
      const [first, ...rest] = parsedAttrs;
      let entities: Entity[];
      if (opts.type) {
        entities = (
          first
            ? engine.findByTypeAndAttr(opts.type, first.key, first.value)
            : engine.findByType(opts.type)
        ) as Entity[];
      } else {
        entities = engine.findByAttr(first.key, first.value) as Entity[];
      }
      // AND-compose remaining attrs
      for (const attr of rest) {
        entities = entities.filter((e) =>
          attr.value === undefined
            ? e.attributes != null && attr.key in e.attributes
            : e.attributes?.[attr.key] === attr.value
        );
      }
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, buildAttrQueryLabel(opts.type, parsedAttrs));
    } else if (opts.highCoupling) {
      const threshold = parseBoundedInt(opts.threshold, '--threshold', 1);
      const entities = engine.findHighCoupling(threshold);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `High-coupling entities (threshold: ${threshold})`);
    } else if (opts.orphans) {
      const entities = engine.findOrphans();
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, 'Orphan entities (no relations)');
    } else if (opts.inCycles) {
      const entities = engine.findInCycles();
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, 'Entities in dependency cycles');
    } else if (opts.callers) {
      const callersDepth = parseBoundedInt(opts.callersDepth ?? '1', '--callers-depth', 1, 5);
      const callers = relationQueryService.findCallers(opts.callers, callersDepth);
      result = { entityName: opts.callers, depth: callersDepth, callers };
      if (!isJson) {
        console.log(`Callers of "${opts.callers}" (depth: ${callersDepth}):`);
        if (callers.length === 0) {
          console.log('  (none)');
        } else {
          for (const c of callers) {
            console.log(`  depth=${c.depth}  ${c.callerEntity}.${c.callerMethod}  [${c.callType}]`);
          }
        }
      }
    } else if (opts.atlasLayer) {
      if (!extensionAccessor.hasAtlasExtension()) {
        console.error('Error: No Atlas data found. Run archguard analyze with --lang go first.');
        process.exit(1);
      }
      const layerData = extensionAccessor.getAtlasLayer(opts.atlasLayer as any);
      if (layerData === undefined) {
        console.error(`Error: Atlas layer "${opts.atlasLayer}" is empty or not generated.`);
        process.exit(1);
      }
      result = layerData;
      if (!isJson) console.log(JSON.stringify(layerData, null, 2));
    } else if (opts.testPatterns) {
      if (!extensionAccessor.hasTestAnalysis()) {
        console.error(
          'Error: No test analysis data. Run archguard analyze with --include-tests first.'
        );
        process.exit(1);
      }
      const analysis = extensionAccessor.getTestAnalysis();
      const frameworks = [...new Set(analysis.testFiles.flatMap((f) => f.frameworks))];
      result = {
        patternConfigSource: analysis.patternConfigSource,
        totalTestFiles: analysis.metrics.totalTestFiles,
        frameworks,
      };
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.testIssues) {
      if (!extensionAccessor.hasTestAnalysis()) {
        console.error(
          'Error: No test analysis data. Run archguard analyze with --include-tests first.'
        );
        process.exit(1);
      }
      const analysis = extensionAccessor.getTestAnalysis();
      const issues = opts.severity
        ? analysis.issues.filter((i) => i.severity === opts.severity)
        : analysis.issues;
      result = { issues };
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.testMetrics) {
      if (!extensionAccessor.hasTestAnalysis()) {
        console.error(
          'Error: No test analysis data. Run archguard analyze with --include-tests first.'
        );
        process.exit(1);
      }
      const analysis = extensionAccessor.getTestAnalysis();
      result = { ...analysis.metrics, packageCoverage: engine.getPackageCoverage() };
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.entityCoverage) {
      if (!extensionAccessor.hasTestAnalysis()) {
        console.error(
          'Error: No test analysis data. Run archguard analyze with --include-tests first.'
        );
        process.exit(1);
      }
      result = engine.getEntityCoverage(opts.entityCoverage);
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.packageFanin) {
      if (!extensionAccessor.hasAtlasExtension()) {
        console.error('Error: No Atlas data found. Run archguard analyze with --lang go first.');
        process.exit(1);
      }
      const graph = extensionAccessor.getAtlasLayer('package');
      if (!graph) {
        console.error('Error: No package data in Atlas package layer.');
        process.exit(1);
      }
      const { fanIn, fanOut } = computePackageFanMetrics(graph);
      const enriched = enrichPackageNodes(graph.nodes, fanIn, fanOut);
      enriched.sort((a, b) => b.fanIn - a.fanIn);
      result = { packages: enriched };
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.packageFanout) {
      if (!extensionAccessor.hasAtlasExtension()) {
        console.error('Error: No Atlas data found. Run archguard analyze with --lang go first.');
        process.exit(1);
      }
      const graph = extensionAccessor.getAtlasLayer('package');
      if (!graph) {
        console.error('Error: No package data in Atlas package layer.');
        process.exit(1);
      }
      const { fanIn, fanOut } = computePackageFanMetrics(graph);
      const enriched = enrichPackageNodes(graph.nodes, fanIn, fanOut);
      enriched.sort((a, b) => b.fanOut - a.fanOut);
      result = { packages: enriched };
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.godPackages) {
      if (!extensionAccessor.hasAtlasExtension()) {
        console.error('Error: No Atlas data found. Run archguard analyze with --lang go first.');
        process.exit(1);
      }
      const graph = extensionAccessor.getAtlasLayer('package');
      if (!graph) {
        console.error('Error: No package data in Atlas package layer.');
        process.exit(1);
      }
      const { fanIn, fanOut } = computePackageFanMetrics(graph);
      const enriched = enrichPackageNodes(graph.nodes, fanIn, fanOut);
      const godPackages = enriched
        .map((node) => {
          const reasons: string[] = [];
          if (node.fanIn >= 5) reasons.push('highFanIn');
          if (node.fileCount >= 20) reasons.push('tooManyFiles');
          if (node.stats) {
            if (node.stats.structs >= 20) reasons.push('tooManyStructs');
            if (node.stats.functions >= 50) reasons.push('tooManyFunctions');
          }
          return { ...node, reasons };
        })
        .filter((n) => n.reasons.length > 0);
      result = { godPackages };
      if (!isJson) console.log(JSON.stringify(result, null, 2));
    } else if (opts.changeContext || opts.cochange || opts.changeRisk || opts.ownership) {
      const target = opts.changeContext ?? opts.cochange ?? opts.changeRisk ?? opts.ownership;
      const targetType = (opts.targetType ?? 'file') as 'file' | 'package';
      try {
        const data = await loadHistoryData(archDir);
        const query = new HistoryQuery(data);
        if (opts.changeContext) {
          result = query.getChangeContext(targetType, target);
        } else if (opts.cochange) {
          result = query.getCochange(targetType, target);
        } else if (opts.changeRisk) {
          result = query.getChangeRisk(targetType, target);
        } else {
          result = query.getOwnership(targetType, target);
        }
        if (!isJson) console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof GitHistoryNotFoundError) {
          console.error('Error: No git history data found. Run archguard analyze-git first.');
        } else {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    } else if (opts.packageStats !== undefined) {
      const depth = typeof opts.packageStats === 'string' ? parseInt(opts.packageStats, 10) : 2;
      const statsResult = engine.getPackageStats(depth);
      let packages = statsResult.packages;

      const sortBy = opts.packageStatsSortBy ?? 'loc';
      const minFiles =
        opts.packageStatsMinFiles !== undefined
          ? parseInt(opts.packageStatsMinFiles, 10)
          : undefined;
      const minLoc =
        opts.packageStatsMinLoc !== undefined ? parseInt(opts.packageStatsMinLoc, 10) : undefined;
      const topN =
        opts.packageStatsTop !== undefined ? parseInt(opts.packageStatsTop, 10) : undefined;

      if (minFiles !== undefined) {
        packages = packages.filter((p) => p.fileCount >= minFiles);
      }
      if (minLoc !== undefined && statsResult.meta.locAvailable) {
        packages = packages.filter((p) => (p.loc ?? 0) >= minLoc);
      }

      packages = packages.sort((a, b) => {
        const val = (p: PackageStatEntry): number =>
          sortBy === 'fileCount'
            ? p.fileCount
            : sortBy === 'entityCount'
              ? p.entityCount
              : sortBy === 'methodCount'
                ? p.methodCount
                : (p.loc ?? p.fileCount);
        return val(b) - val(a);
      });

      if (topN !== undefined) packages = packages.slice(0, topN);

      result = { meta: statsResult.meta, packages };
      if (!isJson) formatPackageStats(packages, statsResult.meta.locAvailable);
    } else {
      console.error('No query option specified. Use --help to see available options.');
      process.exit(1);
    }

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    }

    // Derived scope note (after output)
    if (scopeEntry.kind === 'derived' && !isJson) {
      console.log(
        '\n[Note: This scope is a derived (partial) view, not a complete project analysis.]'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export function validateQueryOptions(opts: QueryOptions): void {
  const primaryOptions = [
    opts.entity,
    opts.depsOf,
    opts.usedBy,
    opts.implementersOf,
    opts.subclassesOf,
    opts.file,
    opts.cycles,
    opts.summary,
    opts.listScopes,
    opts.type,
    opts.highCoupling,
    opts.orphans,
    opts.inCycles,
    opts.packageStats !== undefined ? true : undefined,
    opts.callers,
    opts.atlasLayer,
    opts.testPatterns,
    opts.testIssues,
    opts.testMetrics,
    opts.entityCoverage,
    opts.packageFanin,
    opts.packageFanout,
    opts.godPackages,
    opts.changeContext,
    opts.cochange,
    opts.changeRisk,
    opts.ownership,
  ].filter(Boolean);

  if (primaryOptions.length > 1) {
    throw new Error('Specify exactly one primary query option.');
  }

  if (opts.attr?.length && primaryOptions.length === 0) {
    throw new Error(
      '--attr requires a primary query option (e.g. --type). To filter by attribute alone, use --type with a custom type name.'
    );
  }

  if (opts.depsOf || opts.usedBy) {
    parseBoundedInt(opts.depth, '--depth', 1, 5);
  }

  if (opts.highCoupling) {
    parseBoundedInt(opts.threshold, '--threshold', 1);
  }

  const validScopes = ['package', 'class', 'method'];
  const validFormats = ['structured', 'edge-list'];
  if (opts.outputScope && !validScopes.includes(opts.outputScope)) {
    throw new Error(
      `Invalid --output-scope: "${opts.outputScope}". Expected: ${validScopes.join('|')}.`
    );
  }
  if (opts.queryFormat && !validFormats.includes(opts.queryFormat)) {
    throw new Error(
      `Invalid --query-format: "${opts.queryFormat}". Expected: ${validFormats.join('|')}.`
    );
  }
}

function parseBoundedInt(value: string, flagName: string, min: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    const range = max !== undefined ? ` (${min}-${max})` : ` (>= ${min})`;
    throw new Error(`Invalid ${flagName}: "${value}". Expected an integer${range}.`);
  }
  return parsed;
}

function projectEntitiesForOutput(
  engine: QueryEngine,
  entities: Entity[],
  verbose: boolean | undefined
): Entity[] | ReturnType<QueryEngine['toSummary']>[] {
  return verbose ? entities : entities.map((entity) => engine.toSummary(entity));
}

/**
 * Unwrap engine result to Entity[] for text display.
 * When queryFormat=edge-list the engine returns EdgeListOutput (non-array);
 * reconstruct minimal Entity-like objects so formatEntityList can iterate safely.
 */
function toDisplayEntities(raw: Entity[] | Partial<Entity>[] | EdgeListOutput): Entity[] {
  if (Array.isArray(raw)) return raw as Entity[];
  const out = raw;
  return out.entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    sourceLocation: { file: e.sourceFile, startLine: 0, endLine: 0 },
    visibility: 'public' as const,
    members: [],
    relations: [],
    annotations: [],
    packages: [],
  })) as unknown as Entity[];
}

// -- List scopes handler --

async function handleListScopes(opts: QueryOptions): Promise<void> {
  const archDir = resolveArchDir(opts.archDir);
  const manifest = await readManifest(archDir);

  if (opts.format === 'json') {
    console.log(JSON.stringify(manifest.scopes, null, 2));
    return;
  }

  if (manifest.scopes.length === 0) {
    console.log('No query scopes available. Run `archguard analyze` first.');
    return;
  }

  console.log('Available query scopes:\n');
  for (const scope of manifest.scopes) {
    console.log(`  ${scope.key} (${scope.kind})`);
    console.log(`    Label:    ${scope.label}`);
    console.log(`    Language: ${scope.language}`);
    console.log(`    Sources:  ${scope.sources.join(', ')}`);
    console.log(`    Entities: ${scope.entityCount}, Relations: ${scope.relationCount}`);
    console.log('');
  }
  console.log(`Total: ${manifest.scopes.length} scope(s)`);
}

// -- Text formatters --

function formatEntityList(entities: Entity[], title: string): void {
  console.log(`${title}:\n`);
  if (entities.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const e of entities) {
    const loc = e.sourceLocation;
    console.log(`  ${e.name} (${e.type}) @ ${loc.file}:${loc.startLine}`);
  }
  console.log(`\n  Total: ${entities.length}`);
}

function formatCycles(cycles: CycleInfo[]): void {
  if (cycles.length === 0) {
    console.log('No dependency cycles detected.');
    return;
  }

  console.log(`Found ${cycles.length} dependency cycle(s):\n`);
  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];
    console.log(`  Cycle ${i + 1} (size ${c.size}): ${c.memberNames.join(' -> ')}`);
    console.log(`    Files: ${c.files.join(', ')}`);
  }
}

function formatPackageStats(packages: PackageStatEntry[], locAvailable: boolean): void {
  if (packages.length === 0) {
    console.log('No package statistics available for this scope.');
    return;
  }
  console.log('Package Statistics:\n');
  for (const p of packages) {
    const locPart = locAvailable && p.loc !== undefined ? `, loc: ${p.loc}` : '';
    console.log(
      `  ${p.package}: files=${p.fileCount}, entities=${p.entityCount}, methods=${p.methodCount}${locPart}`
    );
  }
  console.log(`\n  Total: ${packages.length} package(s)`);
}

function formatSummary(summary: ReturnType<QueryEngine['getSummary']>): void {
  console.log('Scope Summary:\n');
  console.log(`  Language:  ${summary.language}`);
  console.log(`  Kind:      ${summary.kind}`);
  console.log(`  Entities:  ${summary.entityCount}`);
  console.log(`  Relations: ${summary.relationCount}`);

  if (summary.topDependedOn.length > 0) {
    console.log('\n  Top depended-on:');
    for (const item of summary.topDependedOn) {
      console.log(`    ${item.name}: ${item.dependentCount} dependents`);
    }
  }

  if (summary.relationCountByType && Object.keys(summary.relationCountByType).length > 0) {
    console.log('\n  Relations by type:');
    for (const [type, count] of Object.entries(summary.relationCountByType)) {
      console.log(`    ${type}: ${count}`);
    }
  }

  if (summary.topByMethodCount && summary.topByMethodCount.length > 0) {
    console.log('\n  Top by method count:');
    for (const item of summary.topByMethodCount) {
      console.log(`    ${item.name}: ${item.methodCount} methods`);
    }
  }

  if (summary.topByOutDegree && summary.topByOutDegree.length > 0) {
    console.log('\n  Top by out-degree:');
    for (const item of summary.topByOutDegree) {
      console.log(`    ${item.name}: ${item.outDegree} deps`);
    }
  }
}
