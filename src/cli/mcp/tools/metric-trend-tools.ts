/**
 * MCP tool: archguard_get_metric_trend
 *
 * Reads the per-analyze metrics history from .archguard/metrics-history.jsonl
 * and returns a time series of package-level structural metrics.
 *
 * Pure data read — no semantic processing, no LLM dependency.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import type { PackageMetricsSnapshot } from '../../metrics-history-writer.js';
import { resolveRoot } from '../mcp-server.js';
import { readHistoryEntries, UNKNOWN_SCOPE } from '@/analysis/metrics-history-reader.js';
import { errorMessage } from '@/utils/error-message.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

export interface TrendSnapshot {
  timestamp: string;
  scopeKey: string;
  packages: PackageMetricsSnapshot[];
}

export function registerMetricTrendTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    // adr-ok: ADR-007 — MCP-only trend query; no direct CLI equivalent needed
    'archguard_get_metric_trend',
    'Return the historical time series of package-level structural metrics ' +
      '(fan-in, fan-out, cycle count, entity count) recorded by each analyze run. ' +
      'Each snapshot corresponds to one analyze invocation. ' +
      'Use packageName to focus on a single package trend, and scope (a query scope key, ' +
      'or "unknown" for legacy snapshots recorded before scope tracking) to restrict to one scope. ' +
      'Data is pure numeric — no semantic annotations or LLM-generated content.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      packageName: z
        .string()
        .optional()
        .describe(
          'Filter to a single package name. Omit to return all packages for each snapshot.'
        ),
      scope: z
        .string()
        .optional()
        .describe(
          'Only return snapshots recorded for this scope key. Legacy snapshots without a scope ' +
            'key match "unknown". Omit to return snapshots of all scopes.'
        ),
    },
    async ({ projectRoot, packageName, scope }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const outputDir = path.join(root, '.archguard');
        const allEntries = await readHistoryEntries(outputDir, { scope });

        let snapshots: TrendSnapshot[];

        if (packageName !== undefined) {
          // Filter each entry to only the specified package; omit entries where package is absent
          snapshots = allEntries
            .map((entry) => ({
              timestamp: entry.timestamp,
              scopeKey: entry.scopeKey ?? UNKNOWN_SCOPE,
              packages: entry.packages.filter((p) => p.name === packageName),
            }))
            .filter((s) => s.packages.length > 0);
        } else {
          snapshots = allEntries.map((entry) => ({
            timestamp: entry.timestamp,
            scopeKey: entry.scopeKey ?? UNKNOWN_SCOPE,
            packages: entry.packages,
          }));
        }

        return textResponse(JSON.stringify({ snapshots }, null, 2));
      } catch (e: unknown) {
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
