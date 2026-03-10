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
import type { QueryEngine, EntitySummary, PackageStatEntry, PackageStatsResult } from '../query/query-engine.js';
import type { Entity } from '@/types/index.js';
import type { PackageGraph, CapabilityGraph, GoroutineTopology } from '@/types/extensions.js';
import { registerAnalyzeTool } from './analyze-tool.js';

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

function serializeEntities(entities: unknown[]): string {
  return JSON.stringify(entities, null, 2);
}

const verboseParam = z
  .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().default(false))
  .describe('Return full entities with members. Default false returns summary only.');

function applyView(
  engine: QueryEngine,
  entities: Entity[],
  verbose: boolean | string | undefined
): Entity[] | EntitySummary[] {
  const isVerbose = verbose === 'true' ? true : (verbose ?? false);
  return isVerbose ? entities : entities.map((e) => engine.toSummary(e));
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
      from: pg.nodes.find((n) => n.id === e.from)?.name ?? e.from,
      to: pg.nodes.find((n) => n.id === e.to)?.name ?? e.to,
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
    'Find architecture entities by exact name match',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Entity name to search for'),
      verbose: verboseParam,
    },
    async ({ projectRoot, scope, name, verbose }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const payload = applyView(engine, engine.findEntity(name), verbose);
        return textResponse(serializeEntities(payload));
      });
    }
  );

  server.tool(
    'archguard_get_dependencies',
    'Get dependencies of a named entity (what it depends on). Operates at entity (class/struct) level; for Go package-level dependencies use archguard_get_atlas_layer.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Entity name'),
      depth: z.coerce.number().min(1).max(5).default(1).describe('BFS traversal depth (1-5)'),
      verbose: verboseParam,
    },
    async ({ projectRoot, scope, name, depth, verbose }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const payload = applyView(engine, engine.getDependencies(name, depth), verbose);
        return textResponse(serializeEntities(payload));
      });
    }
  );

  server.tool(
    'archguard_get_dependents',
    'Get dependents of a named entity (what depends on it). Operates at entity (class/struct) level; for Go package-level reverse dependencies use archguard_get_atlas_layer.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Entity name'),
      depth: z.coerce.number().min(1).max(5).default(1).describe('BFS traversal depth (1-5)'),
      verbose: verboseParam,
    },
    async ({ projectRoot, scope, name, depth, verbose }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const payload = applyView(engine, engine.getDependents(name, depth), verbose);
        return textResponse(serializeEntities(payload));
      });
    }
  );

  server.tool(
    'archguard_find_implementers',
    'Find classes that implement a given interface. For Go, finds struct types satisfying an interface via implicit structural typing.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Interface name'),
      verbose: verboseParam,
    },
    async ({ projectRoot, scope, name, verbose }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const payload = applyView(engine, engine.findImplementers(name), verbose);
        return textResponse(serializeEntities(payload));
      });
    }
  );

  server.tool(
    'archguard_find_subclasses',
    'Find subclasses of a given class. Only applicable to OO languages; Go has no class inheritance and will always return empty.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      name: z.string().describe('Class name'),
      verbose: verboseParam,
    },
    async ({ projectRoot, scope, name, verbose }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const payload = applyView(engine, engine.findSubclasses(name), verbose);
        return textResponse(serializeEntities(payload));
      });
    }
  );

  server.tool(
    'archguard_get_file_entities',
    'Get all entities defined in a specific file',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
      filePath: z.string().describe('Source file path (e.g. "cli/query/query-engine.ts")'),
      verbose: verboseParam,
    },
    async ({ projectRoot, scope, filePath, verbose }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      return withEngineErrorContext(root, async () => {
        const engine = await loadEngine(path.join(root, '.archguard'), scope);
        const payload = applyView(engine, engine.getFileEntities(filePath), verbose);
        return textResponse(serializeEntities(payload));
      });
    }
  );

  server.tool(
    'archguard_detect_cycles',
    'Detect dependency cycles in the architecture. For Go: the compiler prevents import cycles, so this tool will return empty for any valid Go project.',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
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
    'Get a summary of the architecture scope',
    {
      projectRoot: projectRootParam,
      scope: scopeParam,
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
    'Get per-package volume metrics (file count, entity count, approximate line count) ' +
      'sorted and filtered by threshold.',
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
