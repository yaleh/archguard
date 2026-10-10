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
  // adr-ok: ADR-007 — MCP surface for the top-level `archguard slice-delta` subcommand, not a `query` --flag
  server.tool(
    'archguard_simulate_refactor_slice',
    "Simulate an explicitly-declared refactor slice against the scope's TypeScript module graph and " +
      'return the deterministic architecture delta (computedDelta / negativeControl / guards). The cut ' +
      'is caller-supplied (`slice` object) — ArchGuard does NOT pick a slice and produces no pass/fail gate. ' +
      'Graph comes from the analysed scope: run archguard_analyze first if it is missing.\n\n' +
      'SLICE SCHEMA (complete):\n' +
      '  subject      — an internal dir node id, OR a file path (normalized to its containing dir).\n' +
      '  proposedCut.moves[]   — { file?, from, to, symbols[], note? }: symbols of `from` move to `to`.\n' +
      '                          `from === to` is an ERROR (use `stays`). One symbol in two moves to\n' +
      '                          different dirs is an ERROR.\n' +
      '  proposedCut.stays[]   — { dir, symbols[], note? }: "these names I inspected and they stay in\n' +
      '                          `dir`". This is how a PARTIAL migration is expressed: when one directory\n' +
      "                          edge's importedNames mixes moving and staying symbols, declare the\n" +
      '                          stayers here. An UNDECLARED name is NEVER defaulted to "stays".\n' +
      '  proposedCut.consumers[] — { file?, dir, imports[] }: graph-invisible (same-dir) consumers.\n' +
      '  mustNotChange{forbiddenNewEdges, untouchedDirs} / negativeControl.restoreEdges[] / declaredPrediction.\n\n' +
      'DESTINATION / COVERAGE RULE: every edge whose importedNames contains a moved name is reconciled.\n' +
      'Each name must be accounted for — moved by a move OR declared by a stays — and then goes to its\n' +
      'DECLARED destination. Multiple destinations on ONE edge are legal (an added edge per destination).\n' +
      'A name in neither is fail-closed (not-evaluated, naming the edge and the uncovered names).\n\n' +
      'FAIL-CLOSED (not-evaluated, exit 2): recomputed SCC ≠ moduleGraph.cycles; an edge entering a\n' +
      'moved-from dir with no importedNames; a name covered by no move/stays; an unresolved alias ref\n' +
      'whose `from` dir participates (moved-from / destination / subject); missing negativeControl.\n\n' +
      'READ THE DIAGNOSTICS: `accounting[]` shows per-edge {names, moving:[{name,to}], staying,\n' +
      'unaccounted, destinations, barrel, certainty}. `unknowns` lists cut-related unresolved alias refs,\n' +
      'the unevaluatedDynamicImports count, and barrel/re-export edges — NONE of it feeds computedDelta;\n' +
      'an edge carrying `certainty:"unknown"` is a barrel/re-export the directory graph cannot fully see.',
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
          'The explicit slice declaration object. subject: dir node id OR file path (normalized). ' +
            'proposedCut: { moves:[{file?,from,to,symbols[],note?}], stays?:[{dir,symbols[],note?}], ' +
            'consumers?:[{file?,dir,imports[]}], note? }. `stays` declares symbols that remain in `dir` ' +
            '(the partial-migration vocabulary); an undeclared name is never defaulted to staying. ' +
            '`from===to` moves are rejected (use stays); a symbol in two moves / moved+stayed is a ' +
            'destination conflict. mustNotChange{forbiddenNewEdges,untouchedDirs} / ' +
            'negativeControl{description?,restoreEdges[]} / declaredPrediction. ' +
            'The report adds `accounting[]` (per-edge moving/staying/unaccounted/destinations/barrel) ' +
            'and `unknowns` (cut-related unresolved refs, unevaluatedDynamicImports, barrel edges) — ' +
            'neither feeds computedDelta.'
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
