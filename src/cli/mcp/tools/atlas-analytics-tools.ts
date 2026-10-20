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
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import {
  computePackageFanMetrics,
  enrichPackageNodes,
  evaluateGodPackages,
} from '@/analysis/atlas-metrics-analysis.js';
import type {
  EnrichedPackageNode,
  GodPackageMetrics,
  GodPackageThresholds,
} from '@/analysis/atlas-metrics-analysis.js';
import {
  computePackageFanMetricsFromRelations,
  extractPackageName,
} from '@/analysis/package-metrics-analysis.js';
import type { ExtensionAccessor } from '@/core/query/extension-accessor.js';
import type { QueryEngine } from '@/cli/query/query-engine.js';
import { errorMessage } from '@/utils/error-message.js';

// Re-export for backward compatibility with existing tests
export type { EnrichedPackageNode, GodPackageMetrics };
export { computePackageFanMetrics, enrichPackageNodes, evaluateGodPackages };

// ── Local helpers ──────────────────────────────────────────────────────────────

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

/**
 * Explicit "not applicable" payload for scopes without Atlas data (any non-Go
 * language, or Go analyzed with --no-atlas), so callers can branch on
 * `applicable` instead of parsing prose.
 */
function notApplicableResponse(
  root: string,
  language: string | undefined
): { content: Array<{ type: 'text'; text: string }> } {
  const lang = language ?? 'unknown';
  const alternative =
    lang === 'go'
      ? `Re-run archguard_analyze({ projectRoot: "${root}", lang: "go" }) with Atlas mode enabled (default; omit --no-atlas).`
      : 'Use archguard_get_package_metrics (all languages) for per-package fan-in/fan-out/cycles, ' +
        'or archguard_get_package_stats for package volume.';
  return textResponse(
    JSON.stringify(
      {
        applicable: false,
        reason:
          `No Atlas data found in this scope (language: ${lang}). ` +
          'This tool requires a Go project analyzed with Atlas mode.',
        alternative,
      },
      null,
      2
    )
  );
}

// ── MCP tool registration ─────────────────────────────────────────────────────

/**
 * Assemble per-package god-package metrics for a non-Atlas TypeScript scope.
 *
 * There is no Atlas package graph on TS scopes, but the two existing
 * all-language instruments carry everything the judgement needs:
 *   - archguard_get_package_metrics → fanIn/fanOut from cross-package relations
 *   - archguard_get_package_stats   → fileCount/entityCount (loc unavailable for TS)
 *
 * Package names are directory-level on both sides: entity IDs are
 * `<dir>/<file>.ts.<Entity>`, so `extractPackageName` yields the directory,
 * matching the module graph node id used by the package-stats path.
 */
function buildTypeScriptGodPackageMetrics(
  engine: QueryEngine,
  extensionAccessor: ExtensionAccessor
): GodPackageMetrics[] {
  const packageNames = new Set(extensionAccessor.getEntityIds().map(extractPackageName));
  const { fanIn, fanOut } = computePackageFanMetricsFromRelations(
    extensionAccessor.getRelations(),
    packageNames
  );

  const stats = engine.getPackageStats();
  const statsByName = new Map(stats.packages.map((entry) => [entry.package, entry]));

  // Prefer the stats package list when available: it is directory-keyed exactly
  // like the module graph, whereas relation-derived names can include a bare
  // root file (`foo.ts`) that the stats path buckets as `(root)`.
  const names = statsByName.size > 0 ? Array.from(statsByName.keys()) : Array.from(packageNames);

  return names.map((packageName) => {
    const stat = statsByName.get(packageName);
    const metrics: GodPackageMetrics = {
      packageName,
      fanIn: fanIn.get(packageName) ?? 0,
      fanOut: fanOut.get(packageName) ?? 0,
      fileCount: stat?.fileCount ?? 0,
      entityCount: stat?.entityCount ?? 0,
    };
    if (stat?.loc !== undefined) metrics.loc = stat.loc;
    return metrics;
  });
}

function isTypeScriptScope(language: string | undefined): boolean {
  return language === 'typescript';
}

export function registerAtlasAnalyticsTools(server: McpServer, defaultRoot: string): void {
  // ── archguard_get_package_fanin ──────────────────────────────────────────────
  server.tool(
    'archguard_get_package_fanin',
    'List Go Atlas packages ranked by fan-in (number of packages that depend on them). ' +
      'High fan-in packages are critical hub packages. Requires an Atlas-mode Go project; ' +
      'on other scopes returns { applicable: false, reason, alternative }.',
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
        const { extensionAccessor, scopeEntry } = await loadEngine(archDir, scope);

        if (!extensionAccessor.hasAtlasExtension()) {
          return notApplicableResponse(root, scopeEntry?.language);
        }

        const graph = extensionAccessor.getAtlasLayer('package');
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
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );

  // ── archguard_get_package_fanout ─────────────────────────────────────────────
  server.tool(
    'archguard_get_package_fanout',
    'List Go Atlas packages ranked by fan-out (number of packages they depend on). ' +
      'High fan-out packages have many dependencies and may be fragile. Requires an Atlas-mode Go project; ' +
      'on other scopes returns { applicable: false, reason, alternative }.',
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
        const { extensionAccessor, scopeEntry } = await loadEngine(archDir, scope);

        if (!extensionAccessor.hasAtlasExtension()) {
          return notApplicableResponse(root, scopeEntry?.language);
        }

        const graph = extensionAccessor.getAtlasLayer('package');
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
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );

  // ── archguard_detect_god_packages ────────────────────────────────────────────
  server.tool(
    'archguard_detect_god_packages',
    'Detect "god packages" — packages that violate single-responsibility by exceeding size or coupling thresholds. ' +
      'Each flagged package includes a list of violated thresholds (reasons). ' +
      'Go Atlas scopes use the package graph (fanIn/structs/functions/files); TypeScript scopes use ' +
      'relation-based fanIn/fanOut plus package file/entity counts, returning { applicable: true, godPackages }. ' +
      'Other scopes return { applicable: false, reason, alternative }.',
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
      minFanOut: z.coerce
        .number()
        .min(0)
        .default(20)
        .optional()
        .describe(
          'Fan-out threshold — packages at or above this value are flagged (default: 20; TypeScript only).'
        ),
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
      minEntities: z.coerce
        .number()
        .min(0)
        .default(50)
        .optional()
        .describe(
          'Entity count threshold — size proxy (default: 50; TypeScript only, loc is unavailable).'
        ),
    },
    async ({
      projectRoot,
      scope,
      minFanIn,
      minFanOut,
      minStructs,
      minFunctions,
      minFiles,
      minEntities,
    }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const { engine, extensionAccessor, scopeEntry } = await loadEngine(archDir, scope);

        if (!extensionAccessor.hasAtlasExtension()) {
          if (!isTypeScriptScope(scopeEntry?.language)) {
            return notApplicableResponse(root, scopeEntry?.language);
          }

          const thresholds: GodPackageThresholds = {
            minFanIn: minFanIn ?? 5,
            minFanOut: minFanOut ?? 20,
            minFiles: minFiles ?? 20,
            minEntities: minEntities ?? 50,
          };
          const godPackages = evaluateGodPackages(
            buildTypeScriptGodPackageMetrics(engine, extensionAccessor),
            thresholds
          );
          return textResponse(JSON.stringify({ applicable: true, godPackages }, null, 2));
        }

        const graph = extensionAccessor.getAtlasLayer('package');
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
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
