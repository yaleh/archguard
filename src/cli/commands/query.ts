/**
 * Query Command — scope-aware entity-level and structural discovery queries.
 *
 * Phase 3: entity/relationship queries (--entity, --deps-of, --used-by, etc.)
 * Phase 4: structural discovery (--type, --high-coupling, --orphans, --in-cycles)
 *
 * @module cli/commands/query
 */

import { Command } from 'commander';
import { resolveArchDir, loadEngine, readManifest } from '../query/engine-loader.js';
import type { QueryEngine, PackageStatEntry } from '../query/query-engine.js';
import type { Entity, CycleInfo } from '@/types/index.js';

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
}

/**
 * Parse a raw --attr option string into a key and coerced value.
 *
 * Format: `key` (presence check) or `key=value` (equality check).
 * Values are coerced: "true"/"false" → boolean, numeric strings → number, else string.
 * Splits on the FIRST `=` only so values containing `=` are preserved.
 */
export function parseAttrOption(raw: string): { key: string; value: string | number | boolean | undefined } {
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
      .option('--attr <keyOrPair...>', 'Filter by attribute key or key=value pair (repeatable, AND-composed)')

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
    } else if (opts.type || opts.attr?.length) {
      const parsedAttrs = (opts.attr ?? []).map(parseAttrOption);
      const [first, ...rest] = parsedAttrs;
      let entities: Entity[];
      if (opts.type) {
        entities = first
          ? engine.findByTypeAndAttr(opts.type, first.key, first.value)
          : engine.findByType(opts.type);
      } else {
        entities = engine.findByAttr(first.key, first.value);
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
    } else if (opts.packageStats !== undefined) {
      const depth =
        typeof opts.packageStats === 'string' ? parseInt(opts.packageStats, 10) : 2;
      const statsResult = engine.getPackageStats(depth);
      let packages = statsResult.packages;

      const sortBy = opts.packageStatsSortBy ?? 'loc';
      const minFiles =
        opts.packageStatsMinFiles !== undefined ? parseInt(opts.packageStatsMinFiles, 10) : undefined;
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
}
