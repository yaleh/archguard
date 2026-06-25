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
import fs from 'fs-extra';
import { MetricsHistoryWriter } from '../../metrics-history-writer.js';
import type { MetricsHistoryEntry, PackageMetricsSnapshot } from '../../metrics-history-writer.js';
import { resolveRoot } from '../mcp-server.js';

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Read all JSONL lines from the metrics-history file.
 * Returns an empty array if the file does not exist.
 */
async function readHistoryEntries(outputDir: string): Promise<MetricsHistoryEntry[]> {
  const filePath = path.join(outputDir, MetricsHistoryWriter.FILENAME);
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const entries: MetricsHistoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as MetricsHistoryEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

export interface TrendSnapshot {
  timestamp: string;
  packages: PackageMetricsSnapshot[];
}

export function registerMetricTrendTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    // adr-ok: ADR-007 — MCP-only trend query; no direct CLI equivalent needed
    'archguard_get_metric_trend',
    'Return the historical time series of package-level structural metrics ' +
      '(fan-in, fan-out, cycle count, entity count) recorded by each analyze run. ' +
      'Each snapshot corresponds to one analyze invocation. ' +
      'Use packageName to focus on a single package trend. ' +
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
    },
    async ({ projectRoot, packageName }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const outputDir = path.join(root, '.archguard');
        const allEntries = await readHistoryEntries(outputDir);

        let snapshots: TrendSnapshot[];

        if (packageName !== undefined) {
          // Filter each entry to only the specified package; omit entries where package is absent
          snapshots = allEntries
            .map((entry) => ({
              timestamp: entry.timestamp,
              packages: entry.packages.filter((p) => p.name === packageName),
            }))
            .filter((s) => s.packages.length > 0);
        } else {
          snapshots = allEntries.map((entry) => ({
            timestamp: entry.timestamp,
            packages: entry.packages,
          }));
        }

        return textResponse(JSON.stringify({ snapshots }, null, 2));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
