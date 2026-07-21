/**
 * Package-level metric computation from ArchJSON relations and cycle data.
 * Extracted from the MCP tool layer per ADR-006 ("tools should be thin").
 */

import type { CycleInfo, Relation } from '@/types/index.js';

export interface PackageMetricsEntry {
  packageName: string;
  fanIn: number;
  fanOut: number;
  cycleCount: number;
  cyclesWith: string[];
}

/**
 * Extract the package name from an entity ID.
 *
 * Entity IDs follow the pattern `<package>.<EntityName>` (for OO languages)
 * or `<package>/<EntityName>` (for Go). We take everything before the last
 * separator. If no separator is present, the entity itself is the package.
 */
export function extractPackageName(entityId: string): string {
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
      const entry = result.get(pkg);
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
