/**
 * MCP tool: archguard_get_evidence_pack
 *
 * Aggregates risk snapshots for multiple files/packages in a single call.
 * Returns a gate-ready evidence pack with per-target risk entries, top-3
 * hotspots, and targets not found — in dual markdown + JSON format.
 *
 * TASK-23: pre-dispatch risk injection for loop-backlog workers.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { loadHistoryData, GitHistoryNotFoundError } from '../../git-history/history-loader.js';
import { HistoryQuery } from '../../git-history/history-query.js';
import type { EvidencePackResult } from '../../git-history/history-query.js';

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

function formatEvidencePack(pack: EvidencePackResult): string {
  const lines: string[] = [];

  lines.push('## Evidence Pack');
  lines.push('');

  if (pack.results.length === 0 && pack.notFound.length > 0) {
    lines.push('No targets were found in git history data.');
    lines.push('');
  } else {
    lines.push('| target | type | riskScore | riskLevel | topFactor |');
    lines.push('|--------|------|-----------|-----------|-----------|');
    for (const entry of pack.results) {
      lines.push(
        `| ${entry.target} | ${entry.targetType} | ${entry.riskScore.toFixed(3)} | ${entry.riskLevel} | ${entry.topFactor} |`
      );
    }
    lines.push('');
  }

  lines.push('## Hotspots');
  lines.push('');
  if (pack.hotspots.length === 0) {
    lines.push('_No hotspots (no targets resolved)._');
  } else {
    for (let i = 0; i < pack.hotspots.length; i++) {
      const h = pack.hotspots[i];
      lines.push(
        `${i + 1}. **${h.target}** (${h.targetType}) — riskScore: ${h.riskScore.toFixed(3)}, riskLevel: ${h.riskLevel}, topFactor: ${h.topFactor}`
      );
    }
  }
  lines.push('');

  if (pack.notFound.length > 0) {
    lines.push('## Not Found');
    lines.push('');
    for (const nf of pack.notFound) {
      lines.push(`- ${nf.target} (${nf.targetType}): ${nf.reason}`);
    }
    lines.push('');
  }

  lines.push('```json');
  lines.push(JSON.stringify(pack, null, 2));
  lines.push('```');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerEvidencePackTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    // adr-ok: ADR-007 — MCP-only aggregation tool; no direct CLI equivalent needed
    'archguard_get_evidence_pack',
    'Return a gate-ready aggregated risk evidence pack for multiple files or packages. Each target returns riskScore, riskLevel, and topFactor. Response includes per-target details, top-3 hotspots sorted by risk, and any not-found targets. Use before dispatching tasks to inject structural risk context. Requires archguard_analyze_git.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      targets: z
        .array(
          z.object({
            targetType: z
              .enum(['file', 'package'])
              .describe('Whether the target is a file path or a package path.'),
            target: z
              .string()
              .describe(
                'File path or package path to query (e.g. "src/cli/mcp-server.ts" or "src/cli").'
              ),
          })
        )
        .min(1)
        .max(20)
        .describe('List of targets to query (1–20 entries).'),
    },
    async (params) => {
      const root = resolveRoot(params.projectRoot, defaultRoot);
      const archguardDir = path.join(root, '.archguard');

      try {
        const data = await loadHistoryData(archguardDir);
        const query = new HistoryQuery(data);
        const pack = query.getEvidencePack(params.targets);
        return textResponse(formatEvidencePack(pack));
      } catch (err) {
        if (err instanceof GitHistoryNotFoundError) {
          return textResponse(NOT_ANALYZED_MSG);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResponse(`Evidence pack query failed: ${message}`);
      }
    }
  );
}
