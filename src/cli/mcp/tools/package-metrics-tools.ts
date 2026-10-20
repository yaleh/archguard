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
import type { PackageCyclesResult } from '@/core/query/query-engine.js';
import { errorMessage } from '@/utils/error-message.js';

// Re-export for backward compatibility with existing tests
export type { PackageMetricsEntry };
export { extractPackageName, computePackageFanMetricsFromRelations, computeCycleMetrics };

// ── Local helpers ──────────────────────────────────────────────────────────────

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

const PACKAGE_SORT_KEYS = ['name', 'fanIn', 'fanOut', 'entityCount'] as const;

/** Suffixes that mark an entity package name as a source-file path (TS-style). */
const TS_FILE_SUFFIX = /\.(?:d\.ts|tsx?|jsx?|mjs|cjs)$/;

/**
 * Map an entity-derived package name to the directory-level module id used by
 * the TS module graph. TS entity ids are `<project-root-relative file>.<Entity>`,
 * so the package name is a file path (`src/cli/index.ts`); the module graph
 * keys modules by the file's directory (`src/cli`, root = `''`).
 *
 * Names that do not look like a TS file (Go/Java/Python package ids) are
 * returned unchanged — package cycles are only evaluated for TS scopes anyway.
 */
export function packageNameToModuleId(packageName: string): string {
  if (!TS_FILE_SUFFIX.test(packageName)) return packageName;
  const dir = path.posix.dirname(packageName);
  return dir === '.' ? '' : dir;
}

/** Per-package cycle reading derived from directory-level SCCs. */
export interface PackageCycleMetric {
  cycleCount: number;
  cyclesWith: string[];
}

/**
 * Map module ids in directory-level SCCs to per-module cycle metrics.
 *
 * This is the same SCC source that backs `archguard_detect_cycles`
 * (`outputScope=package`) — the only source that can report TS directory
 * tangles, since class/entity-level SCCs are empty for such projects.
 */
export function computePackageCycleMetrics(
  cycles: PackageCyclesResult['cycles']
): Map<string, PackageCycleMetric> {
  const metrics = new Map<string, PackageCycleMetric>();
  for (const cycle of cycles) {
    for (const moduleId of cycle.modules) {
      const existing = metrics.get(moduleId) ?? { cycleCount: 0, cyclesWith: [] };
      existing.cycleCount += 1;
      for (const other of cycle.modules) {
        if (other === moduleId) continue;
        const displayName = other === '' ? '(root)' : other;
        if (!existing.cyclesWith.includes(displayName)) existing.cyclesWith.push(displayName);
      }
      metrics.set(moduleId, existing);
    }
  }
  return metrics;
}

/** One package row as emitted by the tool (cycleCount is null when not evaluated). */
export interface PackageMetricsToolEntry {
  packageName: string;
  fanIn: number;
  fanOut: number;
  cycleCount: number | null;
  cyclesWith: string[];
}

// ── MCP tool registration ──────────────────────────────────────────────────────

export function registerPackageMetricsTools(server: McpServer, defaultRoot: string): void {
  server.tool(
    // adr-ok: ADR-007 — MCP-only package metrics aggregation; no direct CLI equivalent needed
    'archguard_get_package_metrics',
    'Aggregate fan-in, fan-out, and cycle count per package. ' +
      'fan-in = number of incoming cross-package relations; ' +
      'fan-out = number of outgoing cross-package relations; ' +
      'cycleCount = number of directory-level SCCs the package participates in ' +
      '(same SCC source as archguard_detect_cycles with outputScope="package"); ' +
      'cyclesWith = co-cycling directory module names. ' +
      'cycleEvaluation.evaluated=false means the scope has no directory-level module graph ' +
      '(e.g. non-TypeScript): cycleCount is then null (unknown), never 0. ' +
      'Works for all languages (TypeScript, Go, Java, Python, C++, Kotlin). ' +
      'Default output lists every package sorted by name; use sortBy + topN to get a ranked, bounded list.',
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
      topN: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Return only the first N packages after sorting. Omit to return all packages (default).'
        ),
      sortBy: z
        .enum(PACKAGE_SORT_KEYS)
        .default('name')
        .describe(
          'Sort key: "name" (ascending, default), or "fanIn" / "fanOut" / "entityCount" (descending, ties by name).'
        ),
    },
    async ({ projectRoot, scope, packageName, topN, sortBy: sortByArg }) => {
      const sortBy = sortByArg ?? 'name'; // direct handler calls bypass the zod default
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

        // Step 3: compute package-granularity cycle metrics.
        // Directory-level SCCs (the same source as detect_cycles(outputScope=package))
        // are the only place TS directory tangles exist — entity/class-level SCCs are
        // empty for such projects, which made the previous cycleCount silently 0.
        const packageCycles = engine.getPackageCycles();
        const cycleMetricsByModule = packageCycles.evaluated
          ? computePackageCycleMetrics(packageCycles.cycles)
          : new Map<string, PackageCycleMetric>();
        const cycleEvaluation = packageCycles.evaluated
          ? { evaluated: true as const }
          : {
              evaluated: false as const,
              reason: packageCycles.reason ?? 'package cycles not evaluated for this scope',
            };

        // Step 4: assemble results. An unevaluated scope reports `null`, not a
        // confident 0 — "unknown" must not be read as "no cycles".
        let packages: PackageMetricsToolEntry[] = Array.from(allPackageNames).map((pkg) => {
          const cm = cycleMetricsByModule.get(packageNameToModuleId(pkg));
          return {
            packageName: pkg,
            fanIn: fanIn.get(pkg) ?? 0,
            fanOut: fanOut.get(pkg) ?? 0,
            cycleCount: packageCycles.evaluated ? (cm?.cycleCount ?? 0) : null,
            cyclesWith: packageCycles.evaluated ? (cm?.cyclesWith ?? []) : [],
          };
        });

        // Step 5: apply optional packageName filter
        if (packageName !== undefined) {
          packages = packages.filter((p) => p.packageName === packageName);
        }

        // Sort: name ascending by default (deterministic); ranking keys descending, ties by name
        const entityCounts = new Map<string, number>();
        if (sortBy === 'entityCount') {
          for (const id of entityIds) {
            const pkg = extractPackageName(id);
            entityCounts.set(pkg, (entityCounts.get(pkg) ?? 0) + 1);
          }
        }
        const rank = (p: PackageMetricsToolEntry): number =>
          sortBy === 'fanIn'
            ? p.fanIn
            : sortBy === 'fanOut'
              ? p.fanOut
              : (entityCounts.get(p.packageName) ?? 0);
        packages.sort((a, b) =>
          sortBy === 'name'
            ? a.packageName.localeCompare(b.packageName)
            : rank(b) - rank(a) || a.packageName.localeCompare(b.packageName)
        );

        if (topN === undefined || topN >= packages.length) {
          return textResponse(JSON.stringify({ cycleEvaluation, packages }, null, 2));
        }
        return textResponse(
          JSON.stringify(
            {
              cycleEvaluation,
              packages: packages.slice(0, topN),
              totalPackages: packages.length,
            },
            null,
            2
          )
        );
      } catch (e: unknown) {
        const msg = errorMessage(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
