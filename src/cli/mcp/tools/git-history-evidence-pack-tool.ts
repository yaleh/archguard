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
import type { LoadedHistoryData } from '../../git-history/history-loader.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOT_ANALYZED_MSG =
  'No git history data found. Run `archguard_analyze_git` first to collect history artifacts.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

const KEY_SAMPLE_SIZE = 3;

/**
 * Sample real keys from the git history data, preferring keys that share a
 * basename with a requested target (the usual cause of a miss is a path that
 * is not relative to the analyzed source root).
 */
function sampleKeys(
  data: LoadedHistoryData,
  notFound: EvidencePackResult['notFound']
): { file: string[]; package: string[] } {
  const pick = (keys: string[], type: 'file' | 'package'): string[] => {
    const basenames = notFound
      .filter((nf) => nf.targetType === type)
      .map((nf) => nf.target.split('/').filter(Boolean).pop() ?? nf.target);
    const similar = keys.filter((k) => basenames.some((b) => k.endsWith(b)));
    return [...new Set([...similar, ...keys])].slice(0, KEY_SAMPLE_SIZE);
  };
  return {
    file: pick([...data.fileMetrics.keys()], 'file'),
    package: pick([...data.packageMetrics.keys()], 'package'),
  };
}

function formatNotEvaluated(pack: EvidencePackResult, data: LoadedHistoryData): string {
  const sample = sampleKeys(data, pack.notFound);
  const fmt = (keys: string[]): string => (keys.length > 0 ? keys.join(', ') : '(none)');
  return JSON.stringify(
    {
      evaluated: false,
      reason: 'all_targets_not_found',
      hint:
        'None of the requested targets exist in the git history data; this is NOT "no history risk". ' +
        'Keys are relative to the analyzed source root. ' +
        `Example file keys: ${fmt(sample.file)}. Example package keys: ${fmt(sample.package)}.`,
      notFound: pack.notFound,
    },
    null,
    2
  );
}

function formatEvidencePack(pack: EvidencePackResult): string {
  const lines: string[] = [];

  lines.push('## Evidence Pack');
  lines.push('');

  lines.push('| target | type | riskScore | riskLevel | topFactor |');
  lines.push('|--------|------|-----------|-----------|-----------|');
  for (const entry of pack.results) {
    lines.push(
      `| ${entry.target} | ${entry.targetType} | ${entry.riskScore.toFixed(3)} | ${entry.riskLevel} | ${entry.topFactor} |`
    );
  }
  lines.push('');

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
  // evaluated:true mirrors formatNotEvaluated's evaluated:false so `if
  // (!result.evaluated)` can't misfire on a real result (same gap as
  // arch-health-tools.ts's get_intrinsic_dimension, fixed in 0.1.35).
  lines.push(JSON.stringify({ evaluated: true, ...pack }, null, 2));
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
        if (pack.results.length === 0 && pack.notFound.length > 0) {
          return textResponse(formatNotEvaluated(pack, data));
        }
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
