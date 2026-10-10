/**
 * MCP tool: archguard_simulate_refactor_slice
 *
 * Thin adapter (ADR-006): the business logic lives in
 * `src/analysis/slice-delta/`; this file only resolves the module graph for the
 * requested scope and injects provenance, then returns the report JSON.
 *
 * The slice is an OBJECT (not a file path): the caller supplies the explicit cut.
 * ArchGuard never invents, ranks, or selects a slice.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import { simulateRefactorSlice } from '@/analysis/slice-delta/index.js';
import type { RefactorSliceDeclaration } from '@/analysis/slice-delta/index.js';
import { readArchguardVersion } from '../../commands/slice-delta.js';
import { errorMessage } from '@/utils/error-message.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

function errorResponse(text: string): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  return { isError: true, content: [{ type: 'text', text }] };
}

export function registerSliceDeltaTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_simulate_refactor_slice',
    "Simulate an explicitly-declared refactor slice against the scope's TypeScript module graph and " +
      'return the deterministic architecture delta (computedDelta / negativeControl / guards). The cut ' +
      'is caller-supplied (`slice` object) — ArchGuard does NOT pick a slice and produces no pass/fail gate. ' +
      'Graph comes from the analysed scope: run archguard_analyze first if it is missing.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe(
          'Query scope key / label fragment. Omit to use manifest.globalScopeKey resolution.'
        ),
      slice: z
        .record(z.string(), z.unknown())
        .describe(
          'The explicit slice declaration object: subject / proposedCut{moves,consumers} / ' +
            'mustNotChange / negativeControl{restoreEdges} / [declaredPrediction].'
        ),
      observed: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Optional posterior reading object; only feeds the comparison section, never the computation.'
        ),
    },
    async ({ projectRoot, scope, slice, observed }) => {
      const root = resolveRoot(projectRoot, defaultRoot);
      const archDir = path.join(root, '.archguard');
      const analyzeHint = `Run archguard_analyze({ projectRoot: "${root}" }) first, then retry.`;

      let ctx;
      try {
        ctx = await loadEngine(archDir, scope);
      } catch (e) {
        return errorResponse(
          `Could not resolve a query scope at ${archDir}/query: ${errorMessage(e)}. ${analyzeHint}`
        );
      }

      const graph = ctx.extensionAccessor.getTsModuleGraph();
      if (!graph) {
        return errorResponse(
          `This scope carries no TypeScript module graph (extensions.tsAnalysis.moduleGraph); ` +
            `the slice-delta simulation only applies to a package-level TS ArchJSON. ${analyzeHint}`
        );
      }

      const archJsonPath = path.join(archDir, 'query', ctx.scopeEntry.key, 'arch.json');
      const sliceProvenance =
        (slice as { provenance?: Record<string, unknown> })?.provenance ?? undefined;
      const provenance = {
        analysis: { source: archJsonPath, workspaceRoot: root },
        slice: { ...(sliceProvenance ?? {}) },
        observed: observed ?? null,
        tool: {
          archguardVersion: readArchguardVersion(),
          command: 'archguard_simulate_refactor_slice',
        },
        provenanceConsistency: {
          status: 'not-checked' as const,
          reason: 'MCP adapter 不做 git 探测；CLI 的 --root 路径会给出 match/mismatch/not-checked',
        },
      };

      const report = simulateRefactorSlice({
        graph,
        slice: slice as unknown as RefactorSliceDeclaration,
        observed: observed ?? null,
        provenance,
      });

      return textResponse(JSON.stringify(report, null, 2));
    }
  );
}
