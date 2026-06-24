/**
 * MCP tool: archguard_get_package_metrics
 *
 * Aggregates fan-in, fan-out, and cycle count per package.
 * Works with any language (TypeScript, Go, Java, Python, C++, Kotlin).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'path';
import type { CycleInfo, Relation } from '@/types/index.js';
import { loadEngine } from '../../query/engine-loader.js';
import { resolveRoot } from '../mcp-server.js';

// ── Local helpers ──────────────────────────────────────────────────────────────

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Extract the package name from an entity ID.
 *
 * Entity IDs follow the pattern `<package>.<EntityName>` (for OO languages)
 * or `<package>/<EntityName>` (for Go). We take everything before the last
 * separator. If no separator is present, the entity itself is the package.
 */
function extractPackageName(entityId: string): string {
  // Go-style: pkg/path/TypeName → pkg/path
  const slashIdx = entityId.lastIndexOf('/');
  if (slashIdx > 0) {
    return entityId.slice(0, slashIdx);
  }
  // OO-style: pkg.SubPkg.ClassName → pkg.SubPkg
  const dotIdx = entityId.lastIndexOf('.');
  if (dotIdx > 0) {
    return entityId.slice(0, dotIdx);
  }
  return entityId;
}

export interface PackageMetricsEntry {
  packageName: string;
  fanIn: number;
  fanOut: number;
  cycleCount: number;
  cyclesWith: string[];
}

/**
 * Compute package-level fan-in and fan-out from ArchJSON relations.
 *
 * fanIn[pkg]  = number of cross-package relations whose target entity is in pkg
 * fanOut[pkg] = number of cross-package relations whose source entity is in pkg
 *
 * Only cross-package relations are counted (self-relations ignored).
 */
export function computePackageFanMetricsFromRelations(
  relations: readonly Relation[],
  packageNames: Set<string>
): { fanIn: Map<string, number>; fanOut: Map<string, number> } {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();

  // Initialise all known packages to 0
  for (const pkg of packageNames) {
    fanIn.set(pkg, 0);
    fanOut.set(pkg, 0);
  }

  for (const relation of relations) {
    const srcPkg = extractPackageName(relation.source);
    const tgtPkg = extractPackageName(relation.target);

    // Only count cross-package relations
    if (srcPkg === tgtPkg) continue;

    if (packageNames.has(srcPkg)) {
      fanOut.set(srcPkg, (fanOut.get(srcPkg) ?? 0) + 1);
    }
    if (packageNames.has(tgtPkg)) {
      fanIn.set(tgtPkg, (fanIn.get(tgtPkg) ?? 0) + 1);
    }
  }

  return { fanIn, fanOut };
}

/**
 * Map package names to cycle metrics from CycleInfo[].
 *
 * For each CycleInfo, for every member entity, the package that entity belongs
 * to is considered to participate in that cycle. cycleCount is the number of
 * distinct SCCs the package appears in; cyclesWith collects all memberNames
 * from those SCCs (excluding the package's own members).
 */
export function computeCycleMetrics(
  cycles: CycleInfo[],
  packageNames: Set<string>
): Map<string, { cycleCount: number; cyclesWith: string[] }> {
  const result = new Map<string, { cycleCount: number; cyclesWith: string[] }>(
    Array.from(packageNames).map((pkg) => [pkg, { cycleCount: 0, cyclesWith: [] }])
  );

  for (const cycle of cycles) {
    // Determine which packages participate in this SCC
    const pkgsInCycle = new Set<string>();
    for (const memberId of cycle.members) {
      const pkg = extractPackageName(memberId);
      if (packageNames.has(pkg)) {
        pkgsInCycle.add(pkg);
      }
    }

    if (pkgsInCycle.size === 0) continue;

    for (const pkg of pkgsInCycle) {
      const entry = result.get(pkg)!;
      entry.cycleCount += 1;
      // Add all memberNames from this cycle to cyclesWith (deduped)
      const existingSet = new Set(entry.cyclesWith);
      for (const name of cycle.memberNames) {
        if (!existingSet.has(name)) {
          entry.cyclesWith.push(name);
          existingSet.add(name);
        }
      }
    }
  }

  return result;
}

// ── MCP tool registration ──────────────────────────────────────────────────────

export function registerPackageMetricsTools(server: McpServer, defaultRoot: string): void {
  server.tool(
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
        const msg = e instanceof Error ? e.message : String(e);
        return textResponse(`Error: ${msg}`);
      }
    }
  );
}
