/**
 * MCP Server — exposes ArchGuard query tools via Model Context Protocol (stdio transport).
 *
 * Provides 8 tools that mirror the CLI query command's capabilities,
 * enabling LLM agents to query architecture data programmatically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import { z } from 'zod';
import { loadEngine } from '../query/engine-loader.js';
import type { QueryEngine, EntitySummary } from '../query/query-engine.js';
import type { Entity } from '@/types/index.js';
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

/**
 * Register all 8 query tools on the MCP server.
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
    'Get dependencies of a named entity (what it depends on)',
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
    'Get dependents of a named entity (what depends on it)',
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
    'Find classes that implement a given interface',
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
    'Find subclasses of a given class',
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
    'Detect dependency cycles in the architecture',
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
}
