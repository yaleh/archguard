/**
 * MCP Server — exposes ArchGuard query tools via Model Context Protocol (stdio transport).
 *
 * Provides 8 tools that mirror the CLI query command's capabilities,
 * enabling LLM agents to query architecture data programmatically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadEngine } from '../query/engine-loader.js';
import type { QueryEngine, EntitySummary } from '../query/query-engine.js';
import type { Entity } from '@/types/index.js';

/**
 * Create and start the MCP server.
 *
 * Connects to the stdio transport first (required for Claude Code to recognize
 * the server), then loads the QueryEngine lazily on the first tool call.
 * This prevents the process from exiting before the protocol handshake completes
 * when arch data is missing or the scope is ambiguous.
 */
export async function startMcpServer(archDir: string, scopeKey?: string): Promise<void> {
  const server = new McpServer({
    name: 'archguard',
    version: '1.0.0',
  });

  // Lazy engine: loaded once on first tool call, cached as a Promise.
  // Errors surface as tool-call failures rather than process exit.
  let enginePromise: ReturnType<typeof loadEngine> | null = null;
  const getEngine = () => {
    if (!enginePromise) enginePromise = loadEngine(archDir, scopeKey);
    return enginePromise;
  };

  registerTools(server, getEngine);

  // Connect transport before any I/O so Claude Code can complete the handshake.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ArchGuard MCP server running on stdio');
}

function serializeEntities(entities: unknown[]): string {
  return JSON.stringify(entities, null, 2);
}

const compactParam = z
  .boolean()
  .default(true)
  .describe('Return summary only (name/type/file/counts). Set false for full members.');

function applyCompact(
  engine: QueryEngine,
  entities: Entity[],
  compact: boolean | undefined,
): Entity[] | EntitySummary[] {
  return (compact ?? true) ? entities.map(e => engine.toSummary(e)) : entities;
}

/**
 * Register all 8 query tools on the MCP server.
 *
 * Accepts either a QueryEngine (for testing) or a lazy getter that returns a
 * Promise<QueryEngine> (for production, so the engine loads on first tool call).
 */
export function registerTools(
  server: McpServer,
  engineOrGetter: QueryEngine | (() => Promise<QueryEngine>),
): void {
  const get = (): Promise<QueryEngine> =>
    typeof engineOrGetter === 'function'
      ? engineOrGetter()
      : Promise.resolve(engineOrGetter);

  server.tool(
    'archguard_find_entity',
    'Find architecture entities by exact name match',
    { name: z.string().describe('Entity name to search for') },
    async ({ name }) => {
      const engine = await get();
      return { content: [{ type: 'text' as const, text: serializeEntities(engine.findEntity(name)) }] };
    },
  );

  server.tool(
    'archguard_get_dependencies',
    'Get dependencies of a named entity (what it depends on)',
    {
      name: z.string().describe('Entity name'),
      depth: z.coerce.number().min(1).max(5).default(1).describe('BFS traversal depth (1-5)'),
      compact: compactParam,
    },
    async ({ name, depth, compact }) => {
      const engine = await get();
      const payload = applyCompact(engine, engine.getDependencies(name, depth), compact);
      return { content: [{ type: 'text' as const, text: serializeEntities(payload) }] };
    },
  );

  server.tool(
    'archguard_get_dependents',
    'Get dependents of a named entity (what depends on it)',
    {
      name: z.string().describe('Entity name'),
      depth: z.coerce.number().min(1).max(5).default(1).describe('BFS traversal depth (1-5)'),
      compact: compactParam,
    },
    async ({ name, depth, compact }) => {
      const engine = await get();
      const payload = applyCompact(engine, engine.getDependents(name, depth), compact);
      return { content: [{ type: 'text' as const, text: serializeEntities(payload) }] };
    },
  );

  server.tool(
    'archguard_find_implementers',
    'Find classes that implement a given interface',
    {
      name: z.string().describe('Interface name'),
      compact: compactParam,
    },
    async ({ name, compact }) => {
      const engine = await get();
      const payload = applyCompact(engine, engine.findImplementers(name), compact);
      return { content: [{ type: 'text' as const, text: serializeEntities(payload) }] };
    },
  );

  server.tool(
    'archguard_find_subclasses',
    'Find subclasses of a given class',
    {
      name: z.string().describe('Class name'),
      compact: compactParam,
    },
    async ({ name, compact }) => {
      const engine = await get();
      const payload = applyCompact(engine, engine.findSubclasses(name), compact);
      return { content: [{ type: 'text' as const, text: serializeEntities(payload) }] };
    },
  );

  server.tool(
    'archguard_get_file_entities',
    'Get all entities defined in a specific file',
    { filePath: z.string().describe('Source file path (e.g. "cli/query/query-engine.ts")') },
    async ({ filePath }) => {
      const engine = await get();
      return { content: [{ type: 'text' as const, text: serializeEntities(engine.getFileEntities(filePath)) }] };
    },
  );

  server.tool(
    'archguard_detect_cycles',
    'Detect dependency cycles in the architecture',
    {},
    async () => {
      const engine = await get();
      return { content: [{ type: 'text' as const, text: JSON.stringify(engine.getCycles(), null, 2) }] };
    },
  );

  server.tool(
    'archguard_summary',
    'Get a summary of the architecture scope',
    {},
    async () => {
      const engine = await get();
      return { content: [{ type: 'text' as const, text: JSON.stringify(engine.getSummary(), null, 2) }] };
    },
  );
}
