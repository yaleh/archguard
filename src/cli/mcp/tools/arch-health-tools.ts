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
import { DriftCalculator } from '@/analysis/jl/drift-calculator.js';
import { reanalyzeCommitSnapshot, resolveDriftSnapshots } from '../../utils/drift-baseline.js';
import { DRIFT_THRESHOLDS, TREND_DELTA_THRESHOLD } from '@/analysis/jl/types.js';
import type { DriftLevel, DriftReport, IntrinsicDimensionResult } from '@/analysis/jl/types.js';

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

/**
 * Register the architecture-drift MCP tool (TASK-65 Phase D).
 */
export function registerArchHealthDriftTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_architecture_drift',
    'Compute per-entity L2 architecture drift between two git snapshots in adjacency-matrix space. ' +
      'Resolves fromCommit/toCommit from .archguard/arch-health-history.json, re-analyzes both ' +
      'commits on demand, and returns { report, hasBreakingDrift, breakingEntities }. ' +
      'Requires at least two prior `analyze --arch-health` runs.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to MCP server startup cwd.'),
      fromCommit: z
        .string()
        .optional()
        .describe('Baseline commit sha. Defaults to the snapshot immediately before toCommit.'),
      toCommit: z
        .string()
        .optional()
        .describe('Comparison commit sha. Defaults to the latest snapshot.'),
      topK: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Return the top-K highest-drift entities (default 10).'),
      minLevel: z
        .enum(['stable', 'moderate', 'significant', 'critical'])
        .optional()
        .describe('Lowest severity level included in report.drifts (default stable).'),
    },
    async ({ projectRoot, fromCommit, toCommit, topK, minLevel }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const history = await readHistoryFile(archDir);

        if (history === null || history.snapshots.length < 2) {
          return textResponse(
            JSON.stringify(
              {
                report: null,
                hasBreakingDrift: false,
                breakingEntities: [],
                message: 'no baseline available',
              },
              null,
              2
            )
          );
        }

        const resolved = await resolveDriftSnapshots(
          fromCommit,
          toCommit,
          history,
          root,
          reanalyzeCommitSnapshot
        );
        if (resolved.kind === 'from-not-found') {
          return textResponse(
            JSON.stringify({ error: `snapshot not found for commit: ${resolved.commit}` }, null, 2)
          );
        }
        if (resolved.kind === 'no-baseline') {
          return textResponse(
            JSON.stringify(
              {
                report: null,
                hasBreakingDrift: false,
                breakingEntities: [],
                message: 'no baseline available',
              },
              null,
              2
            )
          );
        }

        const report = DriftCalculator.compare(resolved.from, resolved.to, {
          threshold: DRIFT_THRESHOLDS.critical,
          topK: topK ?? 10,
          minLevel: (minLevel as DriftLevel | undefined) ?? 'stable',
        });
        return textResponse(JSON.stringify(buildDriftToolResult(report), null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );
}

export interface DriftToolResult {
  report: DriftReport;
  hasBreakingDrift: boolean;
  breakingEntities: string[];
}

/**
 * Shape a DriftReport into the MCP tool payload. An entity is "breaking" when
 * its drift level is critical (≥ 3.0) — the actionable class for CI review.
 */
export function buildDriftToolResult(report: DriftReport): DriftToolResult {
  const breakingEntities = report.drifts
    .filter((d) => d.level === 'critical')
    .map((d) => d.entityId);
  return { report, hasBreakingDrift: breakingEntities.length > 0, breakingEntities };
}
