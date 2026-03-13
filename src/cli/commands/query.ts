/**
 * Query Command — scope-aware entity-level and structural discovery queries.
 *
 * Phase 3: entity/relationship queries (--entity, --deps-of, --used-by, etc.)
 * Phase 4: structural discovery (--type, --high-coupling, --orphans, --in-cycles)
 * Phase 5: package stats, atlas layer, test analysis, git history
 *
 * @module cli/commands/query
 */

import { Command } from 'commander';
import { resolveArchDir, loadEngine, readManifest } from '../query/engine-loader.js';
import type { QueryEngine } from '../query/query-engine.js';
import type { Entity, CycleInfo } from '@/types/index.js';
import {
  loadHistoryData,
  GitHistoryNotFoundError,
} from '../git-history/history-loader.js';
import { HistoryQuery } from '../git-history/history-query.js';
import type {
  CochangeResult,
  OwnershipResult,
  ChangeRiskResult,
  ChangeContextResult,
} from '../git-history/history-query.js';
import type { PackageStatsResult, PackageStatEntry } from '../query/query-engine.js';

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

  // Phase 5: architecture query tools
  packageStats?: string; // optional depth value
  atlasLayer?: string;

  // Phase 5: test analysis tools
  testPatterns?: true;
  testIssues?: true;
  testMetrics?: true;
  entityCoverage?: string;

  // Phase 5: git history tools
  changeContext?: string;
  cochange?: string;
  changeRisk?: string;
  ownership?: string;
  targetType?: string; // 'package' | 'file'
}

const GIT_HISTORY_NOT_FOUND_MSG =
  'No git history data found. Run `archguard analyze --include-git` first.';

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

      // Phase 5: architecture query tools
      .option(
        '--package-stats [depth]',
        'Show package statistics (optional depth 1-5, default: 2)'
      )
      .option(
        '--atlas-layer <layer>',
        'Show Go Atlas layer (package|capability|goroutine|flow)'
      )

      // Phase 5: test analysis tools
      .option('--test-patterns', 'Show detected test frameworks and pattern config')
      .option('--test-issues', 'Show test quality issues')
      .option('--test-metrics', 'Show test metrics summary')
      .option('--entity-coverage <entityId>', 'Show test coverage for an entity by ID')

      // Phase 5: git history query tools
      .option(
        '--target-type <type>',
        'Target type for git history queries: package|file (default: file)',
        'file'
      )
      .option('--change-context <target>', 'Show change context for a file or package')
      .option('--cochange <target>', 'Show co-change neighbors for a file or package')
      .option('--change-risk <target>', 'Show change risk score for a file or package')
      .option('--ownership <target>', 'Show maintainer ownership for a file or package')

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

    // Git history tools — load history data, no engine needed
    if (opts.changeContext || opts.cochange || opts.changeRisk || opts.ownership) {
      await handleGitHistoryQuery(opts);
      return;
    }

    // Load engine
    const archDir = resolveArchDir(opts.archDir);
    const engine = await loadEngine(archDir, opts.scope);
    const isJson = opts.format === 'json';
    const scopeEntry = engine.getScopeEntry();

    // Determine which query to run
    let result: unknown;

    if (opts.entity) {
      const entities = engine.findEntity(opts.entity);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Entities matching "${opts.entity}"`);
    } else if (opts.depsOf) {
      const depth = parseBoundedInt(opts.depth, '--depth', 1, 5);
      const entities = engine.getDependencies(opts.depsOf, depth);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Dependencies of "${opts.depsOf}" (depth: ${depth})`);
    } else if (opts.usedBy) {
      const depth = parseBoundedInt(opts.depth, '--depth', 1, 5);
      const entities = engine.getDependents(opts.usedBy, depth);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Dependents of "${opts.usedBy}" (depth: ${depth})`);
    } else if (opts.implementersOf) {
      const entities = engine.findImplementers(opts.implementersOf);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Implementers of "${opts.implementersOf}"`);
    } else if (opts.subclassesOf) {
      const entities = engine.findSubclasses(opts.subclassesOf);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Subclasses of "${opts.subclassesOf}"`);
    } else if (opts.file) {
      const entities = engine.getFileEntities(opts.file);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Entities in ${opts.file}`);
    } else if (opts.cycles) {
      const cycles = engine.getCycles();
      result = cycles;
      if (!isJson) formatCycles(cycles);
    } else if (opts.summary) {
      const summary = engine.getSummary();
      result = summary;
      if (!isJson) formatSummary(summary);
    } else if (opts.type) {
      const entities = engine.findByType(opts.type);
      result = projectEntitiesForOutput(engine, entities, opts.verbose);
      if (!isJson) formatEntityList(entities, `Entities of type "${opts.type}"`);
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
    } else if (opts.packageStats !== undefined) {
      const rawDepth = opts.packageStats as unknown;
      const depth =
        rawDepth === true || rawDepth === '' || rawDepth === undefined
          ? 2
          : parseBoundedInt(String(rawDepth), '--package-stats', 1, 5);
      const statsResult = engine.getPackageStats(depth);
      result = statsResult;
      if (!isJson) formatPackageStats(statsResult);
    } else if (opts.atlasLayer) {
      const validLayers = ['package', 'capability', 'goroutine', 'flow'] as const;
      if (!validLayers.includes(opts.atlasLayer as (typeof validLayers)[number])) {
        throw new Error(
          `Invalid --atlas-layer: "${opts.atlasLayer}". Expected one of: ${validLayers.join('|')}`
        );
      }
      const layer = engine.getAtlasLayer(
        opts.atlasLayer as 'package' | 'capability' | 'goroutine' | 'flow'
      );
      if (!layer) {
        throw new Error(
          `Atlas layer "${opts.atlasLayer}" not found. Run \`archguard analyze --lang go\` first.`
        );
      }
      result = layer;
      if (!isJson) formatAtlasLayer(opts.atlasLayer, layer);
    } else if (opts.testPatterns) {
      const analysis = engine.getTestAnalysis();
      if (!analysis) {
        throw new Error(
          'No test analysis data found. Run `archguard analyze --include-tests` first.'
        );
      }
      const frameworks = [...new Set(analysis.testFiles.flatMap((f) => f.frameworks))];
      result = {
        detectedFrameworks: frameworks.map((f) => ({ name: f, confidence: 'high' })),
        patternConfigSource: analysis.patternConfigSource,
        totalTestFiles: analysis.metrics.totalTestFiles,
      };
      if (!isJson) formatTestPatterns(result as ReturnType<typeof buildTestPatternsResult>);
    } else if (opts.testIssues) {
      const analysis = engine.getTestAnalysis();
      if (!analysis) {
        throw new Error(
          'No test analysis data found. Run `archguard analyze --include-tests` first.'
        );
      }
      result = analysis.issues;
      if (!isJson) formatTestIssues(analysis.issues);
    } else if (opts.testMetrics) {
      const analysis = engine.getTestAnalysis();
      if (!analysis) {
        throw new Error(
          'No test analysis data found. Run `archguard analyze --include-tests` first.'
        );
      }
      result = analysis.metrics;
      if (!isJson) formatTestMetrics(analysis.metrics as unknown as Record<string, unknown>);
    } else if (opts.entityCoverage) {
      if (!engine.hasTestAnalysis()) {
        throw new Error(
          'No test analysis data found. Run `archguard analyze --include-tests` first.'
        );
      }
      const coverage = engine.getEntityCoverage(opts.entityCoverage);
      result = coverage;
      if (!isJson) formatEntityCoverage(coverage);
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

/**
 * Handle git history queries (no engine required — loads history artifacts directly).
 */
async function handleGitHistoryQuery(opts: QueryOptions): Promise<void> {
  const archDir = resolveArchDir(opts.archDir);
  const isJson = opts.format === 'json';
  const targetType = (opts.targetType as 'package' | 'file') ?? 'file';

  let data: Awaited<ReturnType<typeof loadHistoryData>>;
  try {
    data = await loadHistoryData(archDir);
  } catch (err) {
    if (err instanceof GitHistoryNotFoundError) {
      console.error(`Error: ${GIT_HISTORY_NOT_FOUND_MSG}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }

  const query = new HistoryQuery(data);

  let result: CochangeResult | OwnershipResult | ChangeRiskResult | ChangeContextResult;

  try {
    if (opts.changeContext) {
      result = query.getChangeContext(targetType, opts.changeContext);
      if (!isJson) formatChangeContext(result as ChangeContextResult);
    } else if (opts.cochange) {
      result = query.getCochange(targetType, opts.cochange);
      if (!isJson) formatCochange(result as CochangeResult);
    } else if (opts.changeRisk) {
      result = query.getChangeRisk(targetType, opts.changeRisk);
      if (!isJson) formatChangeRisk(result as ChangeRiskResult);
    } else {
      // opts.ownership must be set
      result = query.getOwnership(targetType, opts.ownership!);
      if (!isJson) formatOwnership(result as OwnershipResult);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  if (isJson) {
    console.log(JSON.stringify(result!, null, 2));
  }
}

function validateQueryOptions(opts: QueryOptions): void {
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
    // Phase 5 options
    opts.packageStats !== undefined ? true : undefined,
    opts.atlasLayer,
    opts.testPatterns,
    opts.testIssues,
    opts.testMetrics,
    opts.entityCoverage,
    opts.changeContext,
    opts.cochange,
    opts.changeRisk,
    opts.ownership,
  ].filter(Boolean);

  if (primaryOptions.length > 1) {
    throw new Error('Specify exactly one primary query option.');
  }

  if (opts.depsOf || opts.usedBy) {
    parseBoundedInt(opts.depth, '--depth', 1, 5);
  }

  if (opts.highCoupling) {
    parseBoundedInt(opts.threshold, '--threshold', 1);
  }

  if (opts.targetType && opts.targetType !== 'package' && opts.targetType !== 'file') {
    throw new Error(
      `Invalid --target-type: "${opts.targetType}". Expected "package" or "file".`
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
}

function formatPackageStats(statsResult: PackageStatsResult): void {
  const { meta, packages } = statsResult;
  console.log(`Package Statistics (data: ${meta.dataPath}):\n`);
  if (packages.length === 0) {
    console.log('  (none)');
    return;
  }

  // Print table header
  const locHeader = meta.locAvailable ? '  LOC' : '';
  console.log(
    `  ${'Package'.padEnd(40)} ${'Files'.padStart(6)} ${'Entities'.padStart(8)} ${'Methods'.padStart(8)}${locHeader}`
  );
  console.log('  ' + '-'.repeat(meta.locAvailable ? 72 : 66));

  for (const pkg of packages) {
    const locStr = meta.locAvailable && pkg.loc !== undefined ? `  ${String(pkg.loc).padStart(6)}` : '';
    console.log(
      `  ${pkg.package.padEnd(40)} ${String(pkg.fileCount).padStart(6)} ${String(pkg.entityCount).padStart(8)} ${String(pkg.methodCount).padStart(8)}${locStr}`
    );
  }
  console.log(`\n  Total: ${packages.length} package(s)`);
}

function formatAtlasLayer(layerName: string, layer: unknown): void {
  const l = layer as { nodes?: unknown[]; edges?: unknown[] };
  const nodeCount = l.nodes?.length ?? 0;
  const edgeCount = l.edges?.length ?? 0;
  console.log(`Atlas Layer: ${layerName}\n`);
  console.log(`  Nodes: ${nodeCount}`);
  console.log(`  Edges: ${edgeCount}`);
  if (nodeCount > 0) {
    console.log('\n  Use --format json to see full layer data.');
  }
}

interface TestPatternsResult {
  detectedFrameworks: Array<{ name: string; confidence: string }>;
  patternConfigSource: string;
  totalTestFiles: number;
}

function buildTestPatternsResult(result: unknown): TestPatternsResult {
  return result as TestPatternsResult;
}

function formatTestPatterns(result: TestPatternsResult): void {
  console.log('Detected Test Patterns:\n');
  console.log(`  Test files: ${result.totalTestFiles}`);
  console.log(`  Pattern config source: ${result.patternConfigSource}`);
  if (result.detectedFrameworks.length > 0) {
    console.log('\n  Frameworks:');
    for (const fw of result.detectedFrameworks) {
      console.log(`    ${fw.name} (confidence: ${fw.confidence})`);
    }
  } else {
    console.log('\n  No frameworks detected.');
  }
}

function formatTestIssues(issues: Array<{ severity: string; type: string; message: string; file?: string }>): void {
  if (issues.length === 0) {
    console.log('No test quality issues found.');
    return;
  }
  console.log(`Test Quality Issues (${issues.length}):\n`);
  for (const issue of issues) {
    const location = issue.file ? ` @ ${issue.file}` : '';
    console.log(`  [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.message}${location}`);
  }
}

function formatTestMetrics(metrics: Record<string, unknown>): void {
  console.log('Test Metrics:\n');
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') {
      console.log(`  ${key}: ${typeof value === 'number' && !Number.isInteger(value) ? (value as number).toFixed(3) : value}`);
    } else if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}:`);
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        console.log(`    ${k2}: ${v2}`);
      }
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
}

function formatEntityCoverage(
  coverage: ReturnType<QueryEngine['getEntityCoverage']>
): void {
  if (!coverage.found) {
    console.log(`Entity "${coverage.entityId}" not found in test analysis data.`);
    return;
  }
  console.log(`Entity Coverage: ${coverage.entityId}\n`);
  console.log(`  Coverage score:   ${coverage.coverageScore.toFixed(3)}`);
  console.log(`  Covered by tests: ${coverage.coveredByTestIds.length}`);
  if (coverage.testFileDetails.length > 0) {
    console.log('\n  Test files:');
    for (const tf of coverage.testFileDetails) {
      console.log(
        `    ${tf.id} (${tf.testType}) — ${tf.testCaseCount} cases, ${tf.assertionCount} assertions`
      );
    }
  }
}

// -- Git history text formatters --

function formatChangeContext(result: ChangeContextResult): void {
  console.log(`Change Context: ${result.target} (${result.targetType})\n`);
  const s = result.summary;
  console.log(`  Commits:      ${s.commitCount}`);
  console.log(`  Active days:  ${s.activeDays}`);
  console.log(`  Primary owner: ${s.primaryOwner}`);
  console.log(`  Last changed: ${s.lastChangedAt}`);

  const churn = result.recentChurn;
  console.log(`\n  Churn — added: ${churn.addedLines}, deleted: ${churn.deletedLines}`);

  const risk = result.risk;
  console.log(`\n  Risk: ${risk.riskLevel} (score: ${risk.riskScore.toFixed(3)}, top factor: ${risk.topFactor})`);

  if (result.topCochangeNeighbors.length > 0) {
    console.log('\n  Top co-change neighbors:');
    for (const n of result.topCochangeNeighbors) {
      console.log(`    ${n.target} (strength: ${n.strength.toFixed(3)}, joint changes: ${n.jointChangeCount})`);
    }
  }

  console.log(`\n  Analyzed: last ${result.analyzedWindow.sinceDays} days, ${result.analyzedWindow.totalCommits} commits`);
}

function formatCochange(result: CochangeResult): void {
  console.log(`Co-change Neighbors: ${result.target} (${result.targetType})\n`);
  if (result.neighbors.length === 0) {
    console.log('  (no co-change neighbors found)');
  } else {
    for (const n of result.neighbors) {
      console.log(`  ${n.target}`);
      console.log(`    strength: ${n.strength.toFixed(3)}, joint changes: ${n.jointChangeCount}`);
    }
  }
  console.log(`\n  Analyzed: last ${result.analyzedWindow.sinceDays} days, ${result.analyzedWindow.totalCommits} commits`);
  console.log(`  Note: ${result.limitation}`);
}

function formatChangeRisk(result: ChangeRiskResult): void {
  console.log(`Change Risk: ${result.target} (${result.targetType})\n`);
  console.log(`  Risk score: ${result.riskScore.toFixed(3)} (${result.riskLevel})`);
  console.log('\n  Risk factors:');
  for (const [key, val] of Object.entries(result.factors)) {
    console.log(`    ${key}: ${(val as number).toFixed(3)}`);
  }
  console.log('\n  Factor explanations:');
  for (const [key, val] of Object.entries(result.factorExplanations)) {
    console.log(`    ${key}: ${val}`);
  }
  console.log(`\n  Note: ${result.limitation}`);
}

function formatOwnership(result: OwnershipResult): void {
  console.log(`Ownership: ${result.target} (${result.targetType})\n`);
  console.log(`  Primary owner: ${result.primaryOwner} (${(result.primaryOwnerShare * 100).toFixed(1)}%)`);
  console.log(`  Active maintainers: ${result.activeMaintainers}`);
  console.log(`  Bus factor: ${result.busFactor}`);
  if (result.contributors.length > 0) {
    console.log('\n  Contributors:');
    for (const c of result.contributors) {
      console.log(`    ${c.email}: ${c.commitCount} commits (${(c.share * 100).toFixed(1)}%)`);
    }
  }
  console.log(`\n  Analyzed: last ${result.analyzedWindow.sinceDays} days, ${result.analyzedWindow.totalCommits} commits`);
}
