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

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerCallGraphTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_find_callers',
    'Return direct and transitive callers of an entity or method using ' +
      'statically-extracted call edges; call archguard_analyze first. ' +
      'Precision: TypeScript ~85% (TypeChecker-resolved; parseProject path only — ' +
      'parseCode and ParallelParser paths do not generate call edges), ' +
      'Go ~90% (gopls-assisted; entry-point-reachable paths only), ' +
      'Java ~60% (tree-sitter heuristic; field-type resolution only), ' +
      'Python ~40% (duck-typed; self.field calls only). ' +
      'Dynamic dispatch, callbacks, and reflection are not resolved.',
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
        return textResponse(JSON.stringify({ entityName, depth: depth ?? 1, callers }, null, 2));
      } catch {
        const root = resolveRoot(projectRoot, defaultRoot);
        return textResponse(
          `No analysis data found for project at "${root}".\n` +
            `Run archguard_analyze({ projectRoot: "${root}" }) first.`
        );
      }
    }
  );
}
