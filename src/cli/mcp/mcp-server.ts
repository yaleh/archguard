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
import { registerCognitiveSummaryTool } from './tools/cognitive-summary-tool.js';
import { registerCcbTool } from './tools/ccb-tool.js';
import { registerPackageMetricsTools } from './tools/package-metrics-tools.js';
import { registerMetricTrendTools } from './tools/metric-trend-tools.js';
import { registerEvidencePackTool } from './tools/git-history-evidence-pack-tool.js';
import { runBackendQuery } from './codebase-memory-backend.js';

const projectRootParam = z
  .string()
  .optional()
  .describe('Root directory of the target project. Defaults to the MCP server startup cwd.');

const backendParam = z
  .enum(['archguard', 'codebase-memory'])
  .optional()
  .describe(
    'Optional query backend. Omit (or "archguard") for the default ArchGuard ' +
      '.archguard/query path (unchanged behavior). "codebase-memory" routes the ' +
      'query through the external Codebase Memory graph backend and returns a ' +
      'BackendResult envelope with provenance and diagnostics.'
  );

const codebaseMemoryProjectParam = z
  .string()
  .optional()
  .describe(
    'Explicit Codebase Memory project name. Only used when backend="codebase-memory"; ' +
      'when omitted the project is resolved from projectRoot.'
  );

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
  registerCognitiveSummaryTool(server, defaultRoot);
  registerCcbTool(server, defaultRoot);
  registerPackageMetricsTools(server, defaultRoot); // registers: archguard_get_package_metrics
  registerMetricTrendTools(server, defaultRoot); // registers: archguard_get_metric_trend
  registerEvidencePackTool(server, defaultRoot); // registers: archguard_get_evidence_pack
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

/** True when the caller explicitly selected the Codebase Memory backend. */
function isCodebaseMemoryBackend(backend: string | undefined): boolean {
  return backend === 'codebase-memory';
}

/** Build the backend adapter context (resolved root + optional project). */
function backendContext(root: string, codebaseMemoryProject: string | undefined) {
  return {
    projectRoot: root,
    ...(codebaseMemoryProject !== undefined ? { codebaseMemoryProject } : {}),
  };
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
    "Find entities by name, type, or attribute filter. Provide 'name' for exact match, 'entityType' to filter by type, or 'attrFilter' for attribute key-value pairs (AND-composed). Use outputScope param to control result granularity.",
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
      backend: backendParam,
      codebaseMemoryProject: codebaseMemoryProjectParam,
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
      backend,
      codebaseMemoryProject,
    }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      if (isCodebaseMemoryBackend(backend)) {
        const envelope = await runBackendQuery(
          backendContext(root, codebaseMemoryProject),
          (adapter) => adapter.findEntity(name ?? ''),
          { results: [] }
        );
        return textResponse(serializeResult(envelope));
      }
      return withEngineErrorContext(root, async () => {
        const { engine } = await loadEngine(path.join(root, '.archguard'), scope);

        // Phase 1: look up with structured format so the result is always Entity[]
        // and safe for .filter(). Edge-list serialization is applied in Phase 2.
        const lookupScope = resolveOutputScope(outputScope, verbose);
        const lookupOptions: QueryMethodOptions = {
          outputScope: lookupScope,
          queryFormat: 'structured',
        };

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
    'Return direct and transitive class-level dependency graph with method signatures (outputScope=method by default); call graph edges (method→method calls) are not included — only class-level structural relations. For Go package-level dependencies use archguard_get_atlas_layer.',
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
        const { engine, relationQueryService } = await loadEngine(
          path.join(root, '.archguard'),
          scope
        );
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(
          engine,
          engine.applyOutputOptions(
            relationQueryService.getDependencies(name, depth),
            queryOptions
          ),
          verbose
        );
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_get_dependents',
    'Return entities that depend on the named entity, with method signatures (outputScope=method by default). For Go package-level reverse dependencies use archguard_get_atlas_layer.',
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
        const { engine, relationQueryService } = await loadEngine(
          path.join(root, '.archguard'),
          scope
        );
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(
          engine,
          engine.applyOutputOptions(relationQueryService.getDependents(name, depth), queryOptions),
          verbose
        );
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_find_implementers',
    'Find classes that implement a given interface. For Go, finds struct types satisfying an interface via implicit structural typing. Use outputScope param to control result granularity.',
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
        const { engine, relationQueryService } = await loadEngine(
          path.join(root, '.archguard'),
          scope
        );
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(
          engine,
          engine.applyOutputOptions(relationQueryService.findImplementers(name), queryOptions),
          verbose
        );
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_find_subclasses',
    'Find subclasses of a given class. Only applicable to OO languages; Go has no class inheritance and will always return empty. Use outputScope param to control result granularity.',
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
        const { engine, relationQueryService } = await loadEngine(
          path.join(root, '.archguard'),
          scope
        );
        const queryOptions: QueryMethodOptions = {
          outputScope: resolveOutputScope(outputScope, verbose),
          queryFormat: queryFormat as QueryOutputFormat,
        };
        const payload = applyView(
          engine,
          engine.applyOutputOptions(relationQueryService.findSubclasses(name), queryOptions),
          verbose
        );
        return textResponse(serializeResult(payload));
      });
    }
  );

  server.tool(
    'archguard_get_file_entities',
    // adr-ok: ADR-006 — low-priority legacy description; pending fix to "Return all entities defined in..."
    'Get all entities defined in a specific file. Use outputScope param to control result granularity.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      filePath: z.string().describe('Source file path (e.g. "cli/query/query-engine.ts")'),
      verbose: verboseParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
      backend: backendParam,
      codebaseMemoryProject: codebaseMemoryProjectParam,
    },
    async ({
      projectRoot,
      scope,
      filePath,
      verbose,
      outputScope,
      queryFormat,
      backend,
      codebaseMemoryProject,
    }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      if (isCodebaseMemoryBackend(backend)) {
        const envelope = await runBackendQuery(
          backendContext(root, codebaseMemoryProject),
          (adapter) => adapter.getFileEntities(filePath),
          { file: filePath, results: [] }
        );
        return textResponse(serializeResult(envelope));
      }
      return withEngineErrorContext(root, async () => {
        const { engine } = await loadEngine(path.join(root, '.archguard'), scope);
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
    'Detect dependency cycles in the architecture. For Go: the compiler prevents import cycles, so this tool will return empty for any valid Go project. Use outputScope param to control result granularity.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      outputScope: outputScopeParam('class'),
      queryFormat: queryFormatParam,
    },
    async ({ projectRoot, scope }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const { engine } = await loadEngine(path.join(root, '.archguard'), scope);
        return textResponse(JSON.stringify(engine.getCycles(), null, 2));
      });
    }
  );

  server.tool(
    'archguard_summary',
    'Return pre-computed architecture statistics: exact entity/relation counts (no graph enumeration needed), relation breakdown by type, top-N entities by in-degree / out-degree / method count. ALWAYS call this tool first for any counting or ranking query — do NOT attempt to enumerate or count items from other tool outputs. Default outputScope=package (L1 granularity); for method-level detail call archguard_get_dependencies.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      outputScope: outputScopeParam('package'),
      queryFormat: queryFormatParam,
      backend: backendParam,
      codebaseMemoryProject: codebaseMemoryProjectParam,
    },
    async ({ projectRoot, scope, backend, codebaseMemoryProject }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      if (isCodebaseMemoryBackend(backend)) {
        const envelope = await runBackendQuery(
          backendContext(root, codebaseMemoryProject),
          (adapter) => adapter.getArchitecture(),
          {}
        );
        return textResponse(serializeResult(envelope));
      }
      return withEngineErrorContext(root, async () => {
        const { engine } = await loadEngine(path.join(root, '.archguard'), scope);
        return textResponse(JSON.stringify(engine.getSummary(), null, 2));
      });
    }
  );

  server.tool(
    'archguard_get_atlas_layer',
    'Query a named layer of the Go Atlas architecture graph; returns nodes and edges for ' +
      '`package`, `capability`, `goroutine`, or call chains for `flow`.',
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
        const { extensionAccessor } = await loadEngine(path.join(root, '.archguard'), scope);

        if (!extensionAccessor.hasAtlasExtension()) {
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

        const data = extensionAccessor.getAtlasLayer(layer as any);

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
    // adr-ok: ADR-006 — low-priority legacy description; pending fix to "Return per-package volume metrics..."
    'Get per-package volume metrics (file count, entity count, approximate line count) sorted and filtered by threshold. Returns package-level data only (outputScope=package by default); entity-level detail is stripped.',
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
        const { engine } = await loadEngine(path.join(root, '.archguard'), scope);
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
