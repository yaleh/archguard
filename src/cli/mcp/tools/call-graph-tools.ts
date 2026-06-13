/**
 * MCP tools for call graph analysis.
 *
 * Tools:
 * 1. archguard_find_callers — find all callers of a given entity/method (BFS, depth 1–5)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';

export function registerCallGraphTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_find_callers',
    'Find all callers of a given entity or method in the call graph. ' +
      'Use "ClassName" to find callers of any method on that class, or "ClassName.methodName" ' +
      'to restrict to a specific method. BFS depth is clamped to 1–5.',
    {
      entityName: z
        .string()
        .describe(
          'Entity name to find callers for. Use "ClassName" or "ClassName.methodName" for method-level filtering.'
        ),
      depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(1)
        .optional()
        .describe('BFS depth (1–5, default: 1). Values outside range are clamped.'),
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
    },
    async ({ entityName, depth, projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const engine = await loadEngine(archDir);
        const callers = engine.findCallers(entityName, depth ?? 1);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ entityName, depth: depth ?? 1, callers }, null, 2),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        };
      }
    }
  );
}
