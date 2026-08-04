/**
 * MCP tool: archguard_get_package_metrics
 *
 * Aggregates fan-in, fan-out, and cycle count per package.
 * Works with any language (TypeScript, Go, Java, Python, C++, Kotlin).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';
import {
  extractPackageName,
  computePackageFanMetricsFromRelations,
  computeCycleMetrics,
} from '@/analysis/package-metrics-analysis.js';
import type { PackageMetricsEntry } from '@/analysis/package-metrics-analysis.js';
import { errorMessage } from '@/utils/error-message.js';

// Re-export for backward compatibility with existing tests
export type { PackageMetricsEntry };
export { extractPackageName, computePackageFanMetricsFromRelations, computeCycleMetrics };

// ── Local helpers ──────────────────────────────────────────────────────────────

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

// ── MCP tool registration ──────────────────────────────────────────────────────

export function registerPackageMetricsTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    // adr-ok: ADR-007 — MCP-only package metrics aggregation; no direct CLI equivalent needed
    'archguard_get_package_metrics',
    'Aggregate fan-in, fan-out, and cycle count per package. ' +
      'fan-in = number of incoming cross-package relations; ' +
      'fan-out = number of outgoing cross-package relations; ' +
      'cycleCount = number of SCCs the package participates in; ' +
      'cyclesWith = entity names from co-cycling SCCs. ' +
      'Works for all languages (TypeScript, Go, Java, Python, C++, Kotlin).',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to the MCP server startup cwd.'),
      scope: z
        .string()
        .optional()
        .describe('Query scope key. Omit to use manifest.globalScopeKey.'),
      packageName: z
        .string()
        .optional()
        .describe(
          'Filter results to a single package name. Omit to return metrics for all packages.'
        ),
    },
    async ({ projectRoot, scope, packageName }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');
        const { engine, extensionAccessor } = await loadEngine(archDir, scope);

        // Step 1: derive all package names from entity IDs
        const entityIds = extensionAccessor.getEntityIds();
        const allPackageNames = new Set(entityIds.map(extractPackageName));

        // Step 2: compute fan-in / fan-out from raw relations
        const relations = extensionAccessor.getRelations();
        const { fanIn, fanOut } = computePackageFanMetricsFromRelations(relations, allPackageNames);

        // Step 3: compute cycle metrics
        const cycles = engine.getCycles();
        const cycleMetrics = computeCycleMetrics(cycles, allPackageNames);

        // Step 4: assemble results
        let packages: PackageMetricsEntry[] = Array.from(allPackageNames).map((pkg) => {
          const cm = cycleMetrics.get(pkg) ?? { cycleCount: 0, cyclesWith: [] };
          return {
            packageName: pkg,
            fanIn: fanIn.get(pkg) ?? 0,
            fanOut: fanOut.get(pkg) ?? 0,
            cycleCount: cm.cycleCount,
            cyclesWith: cm.cyclesWith,
          };
        });

        // Step 5: apply optional packageName filter
        if (packageName !== undefined) {
          packages = packages.filter((p) => p.packageName === packageName);
        }

        // Sort by packageName for deterministic output
        packages.sort((a, b) => a.packageName.localeCompare(b.packageName));

        return textResponse(JSON.stringify({ packages }, null, 2));
      } catch (e: unknown) {
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
