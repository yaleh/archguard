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
import { mcpParamDescription, mcpToolDescription } from '../metadata.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

export function registerCcbTool(server: McpServer, defaultRoot: string): void {
  // adr-ok: ADR-007 — CCB is an agent-only cognitive tool; CLI interface out of scope for v1 (no terminal use case)
  server.tool(
    'archguard_get_ccb',
    mcpToolDescription('archguard_get_ccb'),
    {
      filePath: z
        .string()
        .describe(mcpParamDescription('archguard_get_ccb', 'filePath')),
      archDir: z
        .string()
        .optional()
        .describe(mcpParamDescription('archguard_get_ccb', 'archDir')),
      projectRoot: z
        .string()
        .optional()
        .describe(mcpParamDescription('archguard_get_ccb', 'projectRoot')),
      forceRefresh: z
        .boolean()
        .optional()
        .describe(mcpParamDescription('archguard_get_ccb', 'forceRefresh')),
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
