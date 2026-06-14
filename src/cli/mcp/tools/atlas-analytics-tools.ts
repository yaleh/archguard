/**
 * MCP tools for Atlas Package Analytics (Phase 117-120).
 *
 * Tools:
 * 1. archguard_get_package_fanin  — list packages sorted by fan-in (incoming dependencies)
 * 2. archguard_get_package_fanout — list packages sorted by fan-out (outgoing dependencies)
 * 3. archguard_detect_god_packages — identify packages that violate single-responsibility
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';

// ── Local helpers ──────────────────────────────────────────────────────────────

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

// ── Public pure-function API ───────────────────────────────────────────────────

export interface EnrichedPackageNode extends PackageNode {
  fanIn: number;
  fanOut: number;
}

/**
 * Compute fan-in and fan-out counts for each node in a PackageGraph.
 *
 * fanIn[id]  = number of edges whose target === id
 * fanOut[id] = number of edges whose source === id
 */
export function computePackageFanMetrics(graph: PackageGraph): {
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
} {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();

  for (const edge of graph.edges) {
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
  }

  return { fanIn, fanOut };
}

/**
 * Enrich PackageNode array with computed fanIn/fanOut metrics.
 * Nodes absent from either map receive a default of 0.
 */
export function enrichPackageNodes(
  nodes: PackageNode[],
  fanIn: Map<string, number>,
  fanOut: Map<string, number>
): EnrichedPackageNode[] {
  return nodes.map((node) => ({
    ...node,
    fanIn: fanIn.get(node.id) ?? 0,
    fanOut: fanOut.get(node.id) ?? 0,
  }));
}

// ── MCP tool registration ──────────────────────────────────────────────────────

export function registerAtlasAnalyticsTools(server: McpServer, defaultRoot: string): void {
  // ── archguard_get_package_fanin ──────────────────────────────────────────────
  server.tool(
    'archguard_get_package_fanin',
    'List Go Atlas packages ranked by fan-in (number of packages that depend on them). ' +
      'High fan-in packages are critical hub packages. Requires an Atlas-mode Go project.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe('Query scope key. Omit to use manifest.globalScopeKey.'),
      minFanIn: z.coerce
        .number()
        .min(0)
        .default(0)
        .optional()
        .describe('Exclude packages with fan-in below this threshold.'),
      limit: z.coerce
        .number()
        .min(1)
        .max(200)
        .default(20)
        .optional()
        .describe('Maximum number of packages to return (default: 20).'),
    },
    async ({ projectRoot, scope, minFanIn, limit }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const engine = await loadEngine(archDir, scope);

        if (!engine.hasAtlasExtension()) {
          return textResponse(
            'No Atlas data found. This tool requires a Go project analyzed with Atlas mode.\n' +
              `Run: archguard_analyze({ projectRoot: "${root}", lang: "go" })`
          );
        }

        const graph = engine.getAtlasLayer('package');
        if (!graph || graph.nodes.length === 0) {
          return textResponse('No package data available in the Atlas package layer.');
        }

        const { fanIn, fanOut } = computePackageFanMetrics(graph);
        let enriched = enrichPackageNodes(graph.nodes, fanIn, fanOut);

        const threshold = minFanIn ?? 0;
        if (threshold > 0) {
          enriched = enriched.filter((n) => n.fanIn >= threshold);
        }

        enriched.sort((a, b) => b.fanIn - a.fanIn);
        enriched = enriched.slice(0, limit ?? 20);

        return textResponse(JSON.stringify({ packages: enriched }, null, 2));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );

  // ── archguard_get_package_fanout ─────────────────────────────────────────────
  server.tool(
    'archguard_get_package_fanout',
    'List Go Atlas packages ranked by fan-out (number of packages they depend on). ' +
      'High fan-out packages have many dependencies and may be fragile. Requires an Atlas-mode Go project.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe('Query scope key. Omit to use manifest.globalScopeKey.'),
      minFanOut: z.coerce
        .number()
        .min(0)
        .default(0)
        .optional()
        .describe('Exclude packages with fan-out below this threshold.'),
      limit: z.coerce
        .number()
        .min(1)
        .max(200)
        .default(20)
        .optional()
        .describe('Maximum number of packages to return (default: 20).'),
    },
    async ({ projectRoot, scope, minFanOut, limit }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const engine = await loadEngine(archDir, scope);

        if (!engine.hasAtlasExtension()) {
          return textResponse(
            'No Atlas data found. This tool requires a Go project analyzed with Atlas mode.\n' +
              `Run: archguard_analyze({ projectRoot: "${root}", lang: "go" })`
          );
        }

        const graph = engine.getAtlasLayer('package');
        if (!graph || graph.nodes.length === 0) {
          return textResponse('No package data available in the Atlas package layer.');
        }

        const { fanIn, fanOut } = computePackageFanMetrics(graph);
        let enriched = enrichPackageNodes(graph.nodes, fanIn, fanOut);

        const threshold = minFanOut ?? 0;
        if (threshold > 0) {
          enriched = enriched.filter((n) => n.fanOut >= threshold);
        }

        enriched.sort((a, b) => b.fanOut - a.fanOut);
        enriched = enriched.slice(0, limit ?? 20);

        return textResponse(JSON.stringify({ packages: enriched }, null, 2));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );

  // ── archguard_detect_god_packages ────────────────────────────────────────────
  server.tool(
    'archguard_detect_god_packages',
    'Detect "god packages" — packages that violate single-responsibility by exceeding size or coupling thresholds. ' +
      'Each flagged package includes a list of violated thresholds (reasons). Requires an Atlas-mode Go project.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe('Query scope key. Omit to use manifest.globalScopeKey.'),
      minFanIn: z.coerce
        .number()
        .min(0)
        .default(5)
        .optional()
        .describe('Fan-in threshold — packages at or above this value are flagged (default: 5).'),
      minStructs: z.coerce
        .number()
        .min(0)
        .default(20)
        .optional()
        .describe('Struct count threshold (default: 20). Ignored when node has no stats.'),
      minFunctions: z.coerce
        .number()
        .min(0)
        .default(50)
        .optional()
        .describe('Function count threshold (default: 50). Ignored when node has no stats.'),
      minFiles: z.coerce
        .number()
        .min(0)
        .default(20)
        .optional()
        .describe('File count threshold (default: 20).'),
    },
    async ({ projectRoot, scope, minFanIn, minStructs, minFunctions, minFiles }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const engine = await loadEngine(archDir, scope);

        if (!engine.hasAtlasExtension()) {
          return textResponse(
            'No Atlas data found. This tool requires a Go project analyzed with Atlas mode.\n' +
              `Run: archguard_analyze({ projectRoot: "${root}", lang: "go" })`
          );
        }

        const graph = engine.getAtlasLayer('package');
        if (!graph || graph.nodes.length === 0) {
          return textResponse('No package data available in the Atlas package layer.');
        }

        const { fanIn, fanOut } = computePackageFanMetrics(graph);
        const enriched = enrichPackageNodes(graph.nodes, fanIn, fanOut);

        const fanInThreshold = minFanIn ?? 5;
        const structsThreshold = minStructs ?? 20;
        const functionsThreshold = minFunctions ?? 50;
        const filesThreshold = minFiles ?? 20;

        const godPackages = enriched
          .map((node) => {
            const reasons: string[] = [];
            if (node.fanIn >= fanInThreshold && fanInThreshold > 0) reasons.push('highFanIn');
            if (node.stats !== undefined) {
              if (node.stats.structs >= structsThreshold && structsThreshold > 0)
                reasons.push('tooManyStructs');
              if (node.stats.functions >= functionsThreshold && functionsThreshold > 0)
                reasons.push('tooManyFunctions');
            }
            if (node.fileCount >= filesThreshold && filesThreshold > 0)
              reasons.push('tooManyFiles');
            return { ...node, reasons };
          })
          .filter((node) => node.reasons.length > 0);

        return textResponse(JSON.stringify({ godPackages }, null, 2));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
