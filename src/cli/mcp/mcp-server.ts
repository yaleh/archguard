/**
 * MCP Server — exposes ArchGuard query tools via Model Context Protocol (stdio transport).
 *
 * Provides 10 tools that mirror the CLI query command's capabilities,
 * enabling LLM agents to query architecture data programmatically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import { z } from 'zod';
import { loadEngine } from '../query/engine-loader.js';
import type {
  QueryEngine,
  EntitySummary,
  EdgeListOutput,
  PackageStatEntry,
  PackageStatsResult,
  OutputScope,
  QueryMethodOptions,
  QueryOutputFormat,
} from '../query/query-engine.js';
import type { Entity } from '@/types/index.js';
import type {
  PackageGraph,
  CapabilityGraph,
  GoroutineTopology,
} from '@/types/extensions/go-atlas.js';
import { registerAnalyzeTool } from './analyze-tool.js';
import { registerTestAnalysisTools } from './tools/test-analysis-tools.js';
import { registerGitHistoryAnalyzeTool } from './tools/git-history-analyze-tool.js';
import { registerGitHistoryTools } from './tools/git-history-tools.js';
import { registerCallGraphTools } from './tools/call-graph-tools.js';
import { registerAtlasAnalyticsTools } from './tools/atlas-analytics-tools.js';
import { mcpToolDescription } from './metadata.js';

const projectRootParam = z
  .string()
  .optional()
  .describe('Root directory of the target project. Defaults to the MCP server startup cwd.');

const scopeParam = z
  .string()
  .optional()
  .describe(
    'Query scope key, label fragment, or the synthetic alias "global". Omit to use manifest.globalScopeKey resolution.'
  );

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function resolveRoot(projectRoot: string | undefined, defaultRoot: string): string {
  if (!projectRoot) return defaultRoot;
  return path.isAbsolute(projectRoot) ? projectRoot : path.resolve(defaultRoot, projectRoot);
}

async function withEngineErrorContext<T>(
  root: string,
  fn: () => Promise<T>
): Promise<T | ReturnType<typeof textResponse>> {
  const archDir = path.join(root, '.archguard');

  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No query data found')) {
      return textResponse(
        `No query data found at ${archDir}/query.\nRun archguard_analyze({ projectRoot: "${root}" }) first.`
      );
    }
    return textResponse(`Query failed for ${root}: ${message}`);
  }
}

export function createMcpServer(defaultRoot: string = process.cwd()): McpServer {
  const server = new McpServer({
    name: 'archguard',
    version: '1.0.0',
  });

  registerTools(server, defaultRoot);
  registerAnalyzeTool(server, {
    defaultRoot,
  });
  registerTestAnalysisTools(server, defaultRoot);
  registerGitHistoryAnalyzeTool(server, defaultRoot);
  registerGitHistoryTools(server, defaultRoot);
  registerCallGraphTools(server, defaultRoot);
  registerAtlasAnalyticsTools(server, defaultRoot);
  return server;
}

/**
 * Create and start the MCP server.
 *
 * Connects to the stdio transport first (required for Claude Code to recognize
 * the server). Query data is resolved per tool call from the target project's
 * .archguard directory.
 */
export async function startMcpServer(defaultRoot: string = process.cwd()): Promise<void> {
  const server = createMcpServer(defaultRoot);

  // Connect transport before any I/O so Claude Code can complete the handshake.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ArchGuard MCP server running on stdio');
}

function serializeResult(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

const verboseParam = z
  .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().default(false))
  .describe('Return full entities with members. Default false returns summary only.');

function outputScopeParam(defaultScope: OutputScope = 'class') {
  return z
    .enum(['package', 'class', 'method'])
    .default(defaultScope)
    .describe(
      'Output granularity: "package" (package-level only), ' +
        '"class" (entity-level, no members, default), ' +
        '"method" (full entity with method signatures). ' +
        'edge-list format recommended for LLM reasoning ' +
        '(+38pp vs mermaid, format-encoding experiment, n=14 tasks).'
    );
}

const queryFormatParam = z
  .enum(['structured', 'edge-list'])
  .default('structured')
  .describe(
    'Output format: "structured" (nested JSON objects, default) or ' +
      '"edge-list" (flat { entities[], relations[] } — best for LLM reasoning).'
  );

function applyView(
  engine: QueryEngine,
  result: Entity[] | Partial<Entity>[] | EdgeListOutput,
  verbose: boolean | string | undefined
): Entity[] | Partial<Entity>[] | EntitySummary[] | EdgeListOutput {
  if (!Array.isArray(result)) return result;
  const isVerbose = verbose === 'true' ? true : (verbose ?? false);
  return isVerbose ? result : (result as Entity[]).map((e) => engine.toSummary(e));
}

/**
 * Resolve the effective OutputScope, honouring the `verbose` override:
 * if verbose=true, always use 'method' so full entities (with members) are returned.
 */
function resolveOutputScope(
  outputScope: string | undefined,
  verbose: boolean | string | undefined,
  fallback: OutputScope = 'class'
): OutputScope {
  const isVerbose = verbose === 'true' ? true : (verbose ?? false);
  if (isVerbose) return 'method';
  return (outputScope as OutputScope | undefined) ?? fallback;
}

interface AdjacencyEdge {
  from: string;
  to: string;
  label?: string;
}

function toAtlasAdjacency(
  layer: 'package' | 'capability' | 'goroutine',
  data: PackageGraph | CapabilityGraph | GoroutineTopology
): AdjacencyEdge[] {
  if (layer === 'package') {
    const pg = data as PackageGraph;
    return pg.edges.map((e) => ({
      from: pg.nodes.find((n) => n.id === e.source)?.name ?? e.source,
      to: pg.nodes.find((n) => n.id === e.target)?.name ?? e.target,
      label: `${e.strength} refs`,
    }));
  }
  if (layer === 'capability') {
    const cg = data as CapabilityGraph;
    return cg.edges.map((e) => ({
      from: cg.nodes.find((n) => n.id === e.source)?.name ?? e.source,
      to: cg.nodes.find((n) => n.id === e.target)?.name ?? e.target,
      label: e.type,
    }));
  }
  // goroutine
  const gt = data as GoroutineTopology;
  return gt.edges.map((e) => ({
    from: gt.nodes.find((n) => n.id === e.from)?.name ?? e.from,
    to: gt.nodes.find((n) => n.id === e.to)?.name ?? e.to,
  }));
}

/**
 * Register all 10 query tools on the MCP server.
 *
 * Registers all query tools. Each tool resolves projectRoot/scope independently
 * and loads the QueryEngine from disk on demand.
 */
export function registerTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_find_entity',
    mcpToolDescription('archguard_find_entity'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().optional().describe('Entity name to search for (exact match)'),
      entityType: z.string().optional().describe('Filter by entity type (e.g. lock_domain, class)'),
      attrFilter: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          'Attribute key-value pairs (AND-composed). Values can be string, number, or boolean.'
        ),
      verbose: verboseParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
    },
    async ({
      projectRoot,
      scope,
      name,
      entityType,
      attrFilter,
      verbose,
      outputScope,
      queryFormat,
    }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);

        // Phase 1: look up with structured format so the result is always Entity[]
        // and safe for .filter(). Edge-list serialization is applied in Phase 2.
        const lookupScope = resolveOutputScope(outputScope, verbose);
        const lookupOptions: QueryMethodOptions = { outputScope: lookupScope, queryFormat: 'structured' };

        let rawEntities: Entity[];

        if (name) {
          rawEntities = engine.findEntity(name, lookupOptions) as Entity[];
        } else {
          const attrEntries = attrFilter ? Object.entries(attrFilter) : [];
          const [[firstKey, firstVal], ...restEntries] =
            attrEntries.length > 0
              ? attrEntries
              : [[undefined, undefined] as [undefined, undefined]];

          if (entityType) {
            rawEntities = (
              firstKey !== undefined
                ? engine.findByTypeAndAttr(entityType, firstKey, firstVal, lookupOptions)
                : engine.findByType(entityType, lookupOptions)
            ) as Entity[];
          } else if (firstKey !== undefined) {
            rawEntities = engine.findByAttr(firstKey, firstVal, lookupOptions) as Entity[];
          } else {
            rawEntities = [];
          }

          // AND-compose remaining attr filters (safe: rawEntities is always Entity[])
          for (const [k, v] of restEntries) {
            rawEntities = rawEntities.filter((e) => e.attributes?.[k] === v);
          }
        }

        // Phase 2: apply the requested output format (structured or edge-list)
        const finalOptions: QueryMethodOptions = {
          outputScope: lookupScope,
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const result = engine.applyOutputOptions(rawEntities, finalOptions);
        const payload = applyView(engine, result, verbose);
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_get_dependencies',
    mcpToolDescription('archguard_get_dependencies'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Entity name'),
      depth: z.coerce.number().min(1).max(5).default(1).describe('BFS traversal depth (1-5)'),
      verbose: verboseParam,
      outputScope: outputScopeParam('method'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope, name, depth, verbose, outputScope, queryFormat }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(engine, engine.getDependencies(name, depth, queryOptions), verbose);
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_get_dependents',
    mcpToolDescription('archguard_get_dependents'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Entity name'),
      depth: z.coerce.number().min(1).max(5).default(1).describe('BFS traversal depth (1-5)'),
      verbose: verboseParam,
      outputScope: outputScopeParam('method'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope, name, depth, verbose, outputScope, queryFormat }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(engine, engine.getDependents(name, depth, queryOptions), verbose);
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_find_implementers',
    mcpToolDescription('archguard_find_implementers'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Interface name'),
      verbose: verboseParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope, name, verbose, outputScope, queryFormat }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(engine, engine.findImplementers(name, queryOptions), verbose);
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_find_subclasses',
    mcpToolDescription('archguard_find_subclasses'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Class name'),
      verbose: verboseParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope, name, verbose, outputScope, queryFormat }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(engine, engine.findSubclasses(name, queryOptions), verbose);
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_get_file_entities',
    mcpToolDescription('archguard_get_file_entities'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      filePath: z.string().describe('Source file path (e.g. "cli/query/query-engine.ts")'),
      verbose: verboseParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope, filePath, verbose, outputScope, queryFormat }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(engine, engine.getFileEntities(filePath, queryOptions), verbose);
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_detect_cycles',
    mcpToolDescription('archguard_detect_cycles'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        return textResponse(JSON.stringify(engine.getCycles(), null, 2));
      });
    }
  );

  server.tool(
    'archguard_summary',
    mcpToolDescription('archguard_summary'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      outputScope: outputScopeParam('package'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        return textResponse(JSON.stringify(engine.getSummary(), null, 2));
      });
    }
  );

  server.tool(
    'archguard_get_atlas_layer',
    mcpToolDescription('archguard_get_atlas_layer'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      layer: z
        .enum(['package', 'capability', 'goroutine', 'flow'])
        .describe('Atlas layer to retrieve'),
      format: z
        .enum(['full', 'adjacency'])
        .default('full')
        .describe(
          'full: raw layer object as JSON (works for all layers). ' +
            'adjacency: simplified [{from, to, label}] edge list — ' +
            'not supported for the flow layer.'
        ),
    },
    async ({ projectRoot, scope, layer, format }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);

        if (!engine.hasAtlasExtension()) {
          return textResponse(
            'No Atlas data found. This tool requires a Go project analyzed with Atlas mode.\n' +
              `Run: archguard_analyze({ projectRoot: "${root}", lang: "go" })`
          );
        }

        if (format === 'adjacency' && layer === 'flow') {
          return textResponse(
            `Layer "flow" does not support adjacency format. Use format="full" to retrieve entryPoints and callChains.`
          );
        }

        const data = engine.getAtlasLayer(layer as any);

        if (data === undefined) {
          return textResponse(
            `Layer "${layer}" is empty for this project (no entry points detected for this layer).`
          );
        }

        if (format === 'adjacency') {
          const edges = toAtlasAdjacency(
            layer as 'package' | 'capability' | 'goroutine',
            data as PackageGraph | CapabilityGraph | GoroutineTopology
          );
          return textResponse(JSON.stringify(edges, null, 2));
        }

        return textResponse(JSON.stringify(data, null, 2));
      });
    }
  );

  server.tool(
    'archguard_get_package_stats',
    mcpToolDescription('archguard_get_package_stats'),
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      depth: z.coerce
        .number()
        .min(1)
        .max(5)
        .default(2)
        .describe(
          'Directory depth for package grouping. Applies to Java, Python, and C++ only; ' +
            'ignored for Go (module-defined packages) and TypeScript (directory-based modules).'
        ),
      sortBy: z
        .enum(['loc', 'fileCount', 'entityCount', 'methodCount'])
        .default('loc')
        .describe(
          'Primary sort key, descending. Falls back to fileCount when loc is unavailable ' +
            '(Go Atlas and TypeScript projects).'
        ),
      minFileCount: z.coerce
        .number()
        .optional()
        .describe('Exclude packages with fewer than this many files.'),
      minLoc: z.coerce
        .number()
        .optional()
        .describe(
          'Exclude packages with loc below this threshold. ' +
            'Has no effect on Go or TypeScript (loc unavailable for these languages).'
        ),
      topN: z.coerce
        .number()
        .min(1)
        .max(200)
        .optional()
        .describe('Limit output to the top N packages after sorting and filtering.'),
      outputScope: outputScopeParam('package'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope, depth, sortBy, minFileCount, minLoc, topN }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const result: PackageStatsResult = engine.getPackageStats(depth);

        let packages = result.packages;

        // Apply filters
        if (minFileCount !== undefined) {
          packages = packages.filter((p) => p.fileCount >= minFileCount);
        }
        if (minLoc !== undefined && result.meta.locAvailable) {
          packages = packages.filter((p) => (p.loc ?? 0) >= minLoc);
        }

        // Re-sort by requested key
        packages = packages.sort((a, b) => {
          const val = (p: PackageStatEntry): number =>
            sortBy === 'fileCount'
              ? p.fileCount
              : sortBy === 'entityCount'
                ? p.entityCount
                : sortBy === 'methodCount'
                  ? p.methodCount
                  : (p.loc ?? p.fileCount); // 'loc' with fileCount fallback for extension paths
          return val(b) - val(a);
        });

        if (topN !== undefined) packages = packages.slice(0, topN);

        if (packages.length === 0) {
          return textResponse('No package statistics available for this scope.');
        }

        return textResponse(JSON.stringify({ meta: result.meta, packages }, null, 2));
      });
    }
  );
}
