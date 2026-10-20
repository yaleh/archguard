/**
 * Atlas package fan-in/fan-out metric computation.
 * Extracted from the MCP tool layer per ADR-006 ("tools should be thin").
 */

import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';

export interface EnrichedPackageNode extends PackageNode {
  fanIn: number;
  fanOut: number;
}

// ── God-package threshold evaluation (language-agnostic) ─────────────────────
//
// Go Atlas scopes feed PackageGraph nodes into the MCP tool, which evaluates
// its own struct/function thresholds. Non-Atlas scopes (TypeScript) have no
// graph but do have per-package fan-in/fan-out (relations) and volume stats
// (fileCount/entityCount), so the same "god package" judgement is expressed
// over the flattened metrics below. Keeping the threshold arithmetic here
// (ADR-006: tools stay thin) also makes it unit-testable without MCP plumbing.

/** Flattened per-package metrics used to evaluate god-package thresholds. */
export interface GodPackageMetrics {
  packageName: string;
  fanIn: number;
  fanOut: number;
  fileCount: number;
  entityCount: number;
  /** Approximate line count. Absent for TypeScript (loc unavailable). */
  loc?: number;
}

export interface GodPackageThresholds {
  /** Flag when fanIn >= this value. 0 disables the check. */
  minFanIn: number;
  /** Flag when fanOut >= this value. 0 disables the check. */
  minFanOut: number;
  /** Flag when fileCount >= this value. 0 disables the check. */
  minFiles: number;
  /** Flag when entityCount >= this value. 0 disables the check. */
  minEntities: number;
}

export interface FlaggedGodPackage extends GodPackageMetrics {
  reasons: string[];
}

/**
 * Apply coupling + volume thresholds, returning only packages with at least
 * one violated threshold. Results are ranked by number of violations, then
 * fan-out, then name, so output is deterministic.
 *
 * Reasons: `highFanIn`, `highFanOut`, `tooManyFiles`, `tooManyEntities`.
 */
export function evaluateGodPackages(
  packages: readonly GodPackageMetrics[],
  thresholds: GodPackageThresholds
): FlaggedGodPackage[] {
  return packages
    .map((pkg) => {
      const reasons: string[] = [];
      if (thresholds.minFanIn > 0 && pkg.fanIn >= thresholds.minFanIn) reasons.push('highFanIn');
      if (thresholds.minFanOut > 0 && pkg.fanOut >= thresholds.minFanOut)
        reasons.push('highFanOut');
      if (thresholds.minFiles > 0 && pkg.fileCount >= thresholds.minFiles)
        reasons.push('tooManyFiles');
      if (thresholds.minEntities > 0 && pkg.entityCount >= thresholds.minEntities)
        reasons.push('tooManyEntities');
      return { ...pkg, reasons };
    })
    .filter((pkg) => pkg.reasons.length > 0)
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        b.fanOut - a.fanOut ||
        a.packageName.localeCompare(b.packageName)
    );
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
