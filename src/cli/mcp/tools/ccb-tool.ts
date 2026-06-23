/**
 * MCP tool: archguard_get_ccb
 *
 * Returns a Cognitive Context Bundle (CCB) for a source file.
 * The CCB is assembled from structural ArchJSON data, git history signals,
 * and behavioral meta-cc signals (if available).
 *
 * Bundles are cached on disk in .archguard/cognitive/ and invalidated
 * automatically when the source file's SHA-256 hash changes.
 *
 * Use forceRefresh:true to bypass the cache and always reassemble.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { assembleCcb, filePathToId } from '../../cognitive/ccb-assembler.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerCcbTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_ccb',
    'Return a Cognitive Context Bundle (CCB) for a source file. ' +
      'The CCB combines structural digest (method/field counts, in/out degree), ' +
      'git history signals (risk level, hotspot score), behavioral signals ' +
      '(read/edit counts from agent history), and documentation freshness signals. ' +
      'Bundles are SHA-256-keyed and cached in .archguard/cognitive/; ' +
      'they are invalidated automatically when the source file changes. ' +
      'Call with forceRefresh:true to bypass the cache. ' +
      'DOCUMENTATION SIGNALS: The returned bundle includes a `documentation` field with ' +
      '`docFreshnessGap` (fraction of co-changed files that are docs; null if no data), ' +
      '`docVoid` (true when session history shows edits without doc reads), and ' +
      '`specPrecisionGap` (true when spec docs were not consulted before editing). ' +
      'NOTE: `documentation.deFactoSpec` and `documentation.freshnessWarning` are ' +
      'ALWAYS null in stored CCBs — these are LLM-layer responsibilities. ' +
      'When you receive a CCB with docVoid=true or docFreshnessGap < 0.3, you should ' +
      'generate deFactoSpec by reading the co-changed doc files listed in git.cochangeNeighbors, ' +
      'and generate a freshnessWarning to alert the user that documentation may be stale.',
    {
      filePath: z
        .string()
        .describe('Path to the source file (relative to projectRoot or absolute).'),
      archDir: z
        .string()
        .optional()
        .describe('Path to .archguard directory (default: <projectRoot>/.archguard).'),
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      forceRefresh: z
        .boolean()
        .optional()
        .describe('When true, bypass the CCB cache and reassemble from scratch.'),
    },
    async ({ filePath, archDir, projectRoot, forceRefresh }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const resolvedArchDir = archDir
          ? path.isAbsolute(archDir)
            ? archDir
            : path.resolve(root, archDir)
          : path.join(root, '.archguard');

        // Resolve filePath relative to projectRoot if not absolute
        const resolvedFilePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(root, filePath);

        const fileId = filePathToId(filePath);

        const bundle = await assembleCcb(fileId, resolvedFilePath, resolvedArchDir, {
          forceRefresh,
        });

        return textResponse(JSON.stringify(bundle, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );
}
