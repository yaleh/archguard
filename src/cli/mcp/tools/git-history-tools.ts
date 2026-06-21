/**
 * MCP query tools for git history signals.
 *
 * Four tools exposing evolutionary insights without raw git commands:
 *   1. archguard_get_change_context   — pre-edit context (churn, ownership, co-change, risk)
 *   2. archguard_get_cochange         — strongest co-change neighbors
 *   3. archguard_get_change_risk      — explainable risk score
 *   4. archguard_get_ownership        — maintainer concentration
 *
 * Stage 3.1 of Phase 3 (MCP Surface).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { loadHistoryData, GitHistoryNotFoundError } from '../../git-history/history-loader.js';
import { HistoryQuery } from '../../git-history/history-query.js';
import { mcpToolDescription } from '../metadata.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOT_ANALYZED_MSG =
  'No git history data found. Run `archguard_analyze_git` first to collect history artifacts.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerGitHistoryTools(server: McpServer, defaultRoot: string): void {
  // -------------------------------------------------------------------------
  // Tool 1: archguard_get_change_context
  // -------------------------------------------------------------------------

  server.tool(
    'archguard_get_change_context',
    mcpToolDescription('archguard_get_change_context'),
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      targetType: z
        .enum(['package', 'file'])
        .describe('Whether the target is a package path or a file path.'),
      target: z
        .string()
        .describe(
          'Package path or file path to query (e.g. "src/cli" or "src/cli/mcp/mcp-server.ts").'
        ),
    },
    async (params) => {
      const root = resolveRoot(params.projectRoot, defaultRoot);
      const archguardDir = path.join(root, '.archguard');

      try {
        const data = await loadHistoryData(archguardDir);
        const query = new HistoryQuery(data);
        const result = query.getChangeContext(params.targetType, params.target);
        return textResponse(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof GitHistoryNotFoundError) {
          return textResponse(NOT_ANALYZED_MSG);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResponse(`Target "${params.target}" not found in git history data. ${message}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 2: archguard_get_cochange
  // -------------------------------------------------------------------------

  server.tool(
    'archguard_get_cochange',
    mcpToolDescription('archguard_get_cochange'),
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      targetType: z
        .enum(['package', 'file'])
        .describe('Whether the target is a package path or a file path.'),
      target: z.string().describe('Package path or file path to query.'),
      topN: z.coerce
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe('Maximum number of co-change neighbors to return (default: 10, max: 20).'),
    },
    async (params) => {
      const root = resolveRoot(params.projectRoot, defaultRoot);
      const archguardDir = path.join(root, '.archguard');
      const topN = params.topN ?? 10;

      try {
        const data = await loadHistoryData(archguardDir);
        const query = new HistoryQuery(data);
        const result = query.getCochange(params.targetType, params.target, topN);
        return textResponse(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof GitHistoryNotFoundError) {
          return textResponse(NOT_ANALYZED_MSG);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResponse(`Target "${params.target}" not found in git history data. ${message}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 3: archguard_get_change_risk
  // -------------------------------------------------------------------------

  server.tool(
    'archguard_get_change_risk',
    mcpToolDescription('archguard_get_change_risk'),
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      targetType: z
        .enum(['package', 'file'])
        .describe('Whether the target is a package path or a file path.'),
      target: z.string().describe('Package path or file path to query.'),
    },
    async (params) => {
      const root = resolveRoot(params.projectRoot, defaultRoot);
      const archguardDir = path.join(root, '.archguard');

      try {
        const data = await loadHistoryData(archguardDir);
        const query = new HistoryQuery(data);
        const result = query.getChangeRisk(params.targetType, params.target);
        return textResponse(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof GitHistoryNotFoundError) {
          return textResponse(NOT_ANALYZED_MSG);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResponse(`Target "${params.target}" not found in git history data. ${message}`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool 4: archguard_get_ownership
  // -------------------------------------------------------------------------

  server.tool(
    'archguard_get_ownership',
    mcpToolDescription('archguard_get_ownership'),
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      targetType: z
        .enum(['package', 'file'])
        .describe('Whether the target is a package path or a file path.'),
      target: z.string().describe('Package path or file path to query.'),
    },
    async (params) => {
      const root = resolveRoot(params.projectRoot, defaultRoot);
      const archguardDir = path.join(root, '.archguard');

      try {
        const data = await loadHistoryData(archguardDir);
        const query = new HistoryQuery(data);
        const result = query.getOwnership(params.targetType, params.target);
        return textResponse(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof GitHistoryNotFoundError) {
          return textResponse(NOT_ANALYZED_MSG);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResponse(`Target "${params.target}" not found in git history data. ${message}`);
      }
    }
  );
}
