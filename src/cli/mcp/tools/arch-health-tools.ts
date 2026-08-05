/**
 * MCP tool for the architecture intrinsic dimension (TASK-64).
 *
 * Registers `archguard_get_intrinsic_dimension`, which reads the persisted
 * `.archguard/arch-health-history.json` time series and returns the current
 * snapshot, a slice of recent history, and a monotonic trend label.
 *
 * @module cli/mcp/tools/arch-health-tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { readHistoryFile } from '@/analysis/jl/history-writer.js';
import { TREND_DELTA_THRESHOLD } from '@/analysis/jl/types.js';
import type { IntrinsicDimensionResult } from '@/analysis/jl/types.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

export type TrendLabel = 'rising' | 'decreasing' | 'stable';

/**
 * Compute the trend from the two newest snapshots.
 */
export function computeTrend(snapshots: IntrinsicDimensionResult[]): TrendLabel {
  if (snapshots.length < 2) return 'stable';
  const sorted = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  const delta = latest.dIntNormalized - previous.dIntNormalized;
  if (delta > TREND_DELTA_THRESHOLD) return 'rising';
  if (delta < -TREND_DELTA_THRESHOLD) return 'decreasing';
  return 'stable';
}

/**
 * Serialize a snapshot to the MCP-facing shape.
 */
function toCurrentShape(snapshot: IntrinsicDimensionResult): {
  dInt: number;
  dIntNormalized: number;
  entityCount: number;
  mode: string;
  timestamp: string;
} {
  return {
    dInt: snapshot.dInt,
    dIntNormalized: snapshot.dIntNormalized,
    entityCount: snapshot.entityCount,
    mode: snapshot.mode,
    timestamp: snapshot.timestamp,
  };
}

export function registerArchHealthTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_intrinsic_dimension',
    'Return the architecture intrinsic dimension (d_int) for the project: the current snapshot, ' +
      'a slice of recent history from .archguard/arch-health-history.json, and a monotonic trend ' +
      '(rising/decreasing/stable). Requires at least one prior `analyze --arch-health` run.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to MCP server startup cwd.'),
      snapshotCount: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Maximum number of most-recent snapshots to include in the history array.'),
    },
    async ({ projectRoot, snapshotCount }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const history = await readHistoryFile(archDir);

        if (history === null || history.snapshots.length === 0) {
          return textResponse(
            JSON.stringify({ current: null, history: [], trend: 'stable' }, null, 2)
          );
        }

        const sorted = [...history.snapshots].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );
        const current = sorted[sorted.length - 1];
        const historySlice = snapshotCount !== undefined ? sorted.slice(-snapshotCount) : sorted;

        return textResponse(
          JSON.stringify(
            {
              current: toCurrentShape(current),
              history: historySlice.map(toCurrentShape),
              trend: computeTrend(sorted),
            },
            null,
            2
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );
}
