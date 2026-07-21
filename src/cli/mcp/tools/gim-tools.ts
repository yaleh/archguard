import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { resolveRoot } from '../mcp-server.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { computeDirectionHint } from '@/analysis/gim/direction-hint.js';
import { computeAllLosses } from '@/analysis/gim/gim-loss-evaluator.js';
import { loadEngine } from '../../query/engine-loader.js';
import {
  extractPackageName,
  computePackageFanMetricsFromRelations,
} from '@/analysis/package-metrics-analysis.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

const METHODOLOGY =
  'GIM (Geometric Information Methodology) context. All loss values are proxy approximations ' +
  'derived from MetricVector fields, not full MDL computations. ' +
  'Direction is based on 2-point snapshot comparison (low confidence). ' +
  'Use as qualitative signal, not quantitative measurement.';

export function registerGIMTools(server: McpServer, defaultRoot: string): void {
  // adr-ok: ADR-007 — GIM context is an agent-only LLM reasoning tool; no CLI use case
  server.tool(
    'archguard_get_gim_context',
    'Return a GIM (Geometric Information Methodology) context bundle for LLM architectural reasoning. ' +
      'Includes: evolution direction hint (expansion/contraction/stable) from snapshot comparison, ' +
      'four GIM loss function proxies (feasibility, consistency, description-length, generation-alignment), ' +
      'and top high-influence packages sorted by fan-in. ' +
      'All values are proxy approximations from MetricVector fields. ' +
      'Requires at least one prior archguard analyze run to have generated snapshots.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to MCP server startup cwd.'),
    },
    async ({ projectRoot }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');

        const snapshots = await loadSnapshots(archDir);
        const direction = computeDirectionHint(snapshots);

        // Use latest snapshot's MetricVector for loss computation; fall back to zero-vector
        const latestVector = snapshots.length > 0
          ? snapshots[0].metricVector
          : {
              schemaVersion: 1 as const,
              totalEntities: 0,
              totalRelations: 0,
              inferredRelationRatio: 0,
              sccCount: 0,
              relationTypeBreakdown: {},
              maxInDegree: 0,
              maxOutDegree: 0,
              maxPackageSize: 0,
              giniInDegree: 0,
              giniPackageSize: 0,
              packageCount: 0,
            };

        const losses = computeAllLosses(latestVector);

        // Compute high-influence packages via engine (graceful degradation on failure)
        let highInfluencePackages: Array<{ packageName: string; fanIn: number; fanOut: number }> = [];
        try {
          const { extensionAccessor } = await loadEngine(archDir);
          const entityIds = extensionAccessor.getEntityIds();
          const allPackageNames = new Set(entityIds.map(extractPackageName));
          const relations = extensionAccessor.getRelations();
          const { fanIn, fanOut } = computePackageFanMetricsFromRelations(relations, allPackageNames);

          highInfluencePackages = Array.from(allPackageNames)
            .map((pkg) => ({ packageName: pkg, fanIn: fanIn.get(pkg) ?? 0, fanOut: fanOut.get(pkg) ?? 0 }))
            .sort((a, b) => b.fanIn - a.fanIn)
            .slice(0, 5);
        } catch {
          // Engine unavailable — return empty list
        }

        return textResponse(
          JSON.stringify(
            {
              direction,
              losses,
              highInfluencePackages,
              snapshotCount: snapshots.length,
              methodology: METHODOLOGY,
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
