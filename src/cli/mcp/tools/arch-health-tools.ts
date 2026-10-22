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
import { compareDrift } from '@/analysis/jl/drift-calculator.js';
import { ClusterBoundaryAnalyzer } from '@/analysis/jl/cluster-boundary-analyzer.js';
import { buildAdjacencyMatrix } from '@/analysis/jl/adjacency-builder.js';
import {
  reanalyzeCommitSnapshot,
  resolveCommitShaOrNull,
  resolveDriftSnapshots,
} from '../../analyze/drift-baseline.js';
import { loadArchJsonForCluster } from '../../utils/cluster-archjson-loader.js';
import { DRIFT_THRESHOLDS, TREND_DELTA_THRESHOLD } from '@/analysis/jl/types.js';
import type {
  ClusterBoundaryOptions,
  ClusterBoundaryReport,
  DriftLevel,
  DriftReport,
  DriftSnapshot,
  IntrinsicDimensionResult,
} from '@/analysis/jl/types.js';
import type { ArchJSON } from '@/types/index.js';

function textResponse(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Unified "could not evaluate" shape: absence of data must not look like a
 * passing result (e.g. `trend: "stable"`).
 */
export interface NotEvaluated {
  evaluated: false;
  reason: string;
  hint: string;
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
          const notEvaluated: NotEvaluated = {
            evaluated: false,
            reason: history === null ? 'no_arch_health_history' : 'arch_health_history_empty',
            hint: `No snapshots in ${path.join(archDir, 'arch-health-history.json')}. Run \`archguard analyze --arch-health\` (at least once; twice for a trend) to record them.`,
          };
          return textResponse(JSON.stringify(notEvaluated, null, 2));
        }

        const sorted = [...history.snapshots].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );
        const current = sorted[sorted.length - 1];
        const historySlice = snapshotCount !== undefined ? sorted.slice(-snapshotCount) : sorted;

        return textResponse(
          JSON.stringify(
            {
              evaluated: true,
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

export type DriftRefResolution =
  | { kind: 'snapshots'; from: DriftSnapshot; to: DriftSnapshot }
  | { kind: 'not-evaluated'; notEvaluated: NotEvaluated };

/**
 * Resolve the two snapshots for the lightweight git-ref drift entry point.
 *
 * Unlike `resolveDriftSnapshots`, this never touches
 * `.archguard/arch-health-history.json`: the caller names the two git refs,
 * each is canonicalized with `git rev-parse`, and the source tree at each
 * commit is re-analyzed into an in-memory `DriftSnapshot` (temporary detached
 * git worktree — the host working tree is never disturbed).
 *
 * A missing or unresolvable ref yields a `NotEvaluated` payload instead of an
 * empty report: "no comparable pair" must not look like "no drift".
 *
 * @param root - Git repository root.
 * @param fromRef - Baseline git ref (branch, tag or sha).
 * @param toRef - Comparison git ref (branch, tag or sha).
 * @param reanalyze - Snapshot reconstruction hook (overridable in tests).
 * @param resolveRef - Ref canonicalization hook (overridable in tests).
 */
export async function resolveDriftByRefs(
  root: string,
  fromRef: string | undefined,
  toRef: string | undefined,
  reanalyze: (root: string, commitSha: string) => Promise<DriftSnapshot> = reanalyzeCommitSnapshot,
  resolveRef: (root: string, ref: string) => Promise<string | null> = resolveCommitShaOrNull
): Promise<DriftRefResolution> {
  const notEvaluated = (reason: string, hint: string): DriftRefResolution => ({
    kind: 'not-evaluated',
    notEvaluated: { evaluated: false, reason, hint },
  });

  if (fromRef === undefined || fromRef.trim().length === 0) {
    return notEvaluated(
      'from_ref_required',
      'Pass both fromRef and toRef to compare two git refs directly (no arch-health history needed).'
    );
  }
  if (toRef === undefined || toRef.trim().length === 0) {
    return notEvaluated(
      'to_ref_required',
      'Pass both fromRef and toRef to compare two git refs directly (no arch-health history needed).'
    );
  }

  const fromSha = await resolveRef(root, fromRef);
  if (fromSha === null) {
    return notEvaluated(
      'from_ref_not_found',
      `Git ref "${fromRef}" does not resolve to a commit in ${root}.`
    );
  }
  const toSha = await resolveRef(root, toRef);
  if (toSha === null) {
    return notEvaluated(
      'to_ref_not_found',
      `Git ref "${toRef}" does not resolve to a commit in ${root}.`
    );
  }

  // Sequential (not Promise.all): concurrent `git worktree add/remove` contends
  // on the repository's worktrees lock.
  const from = await reanalyze(root, fromSha);
  const to = await reanalyze(root, toSha);
  return { kind: 'snapshots', from, to };
}

/**
 * Register the architecture-drift MCP tool (TASK-65 Phase D).
 */
export function registerArchHealthDriftTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_architecture_drift',
    'Compute per-entity L2 architecture drift between two git snapshots in adjacency-matrix space. ' +
      'Two modes: (1) lightweight — pass fromRef + toRef to analyze two git refs directly, with no ' +
      'arch-health history required; (2) snapshot — resolve fromCommit/toCommit via ' +
      '.archguard/arch-health-history.json and re-analyze both commits on demand. Returns ' +
      '{ report, hasBreakingDrift, breakingEntities } (ref mode also sets evaluated: true); a missing ' +
      'or unresolvable ref pair returns { evaluated: false, reason, hint }.',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to MCP server startup cwd.'),
      fromRef: z
        .string()
        .optional()
        .describe(
          'Lightweight mode: baseline git ref (branch, tag, or sha). Requires toRef; bypasses ' +
            '.archguard/arch-health-history.json entirely.'
        ),
      toRef: z
        .string()
        .optional()
        .describe(
          'Lightweight mode: comparison git ref (branch, tag, or sha). Requires fromRef; bypasses ' +
            '.archguard/arch-health-history.json entirely.'
        ),
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
    async ({ projectRoot, fromRef, toRef, fromCommit, toCommit, topK, minLevel }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archDir = path.join(root, '.archguard');

        // Lightweight git-ref mode: both refs are analyzed on demand, so no
        // `.archguard/arch-health-history.json` is read at all.
        if (fromRef !== undefined || toRef !== undefined) {
          const resolvedByRef = await resolveDriftByRefs(root, fromRef, toRef);
          if (resolvedByRef.kind === 'not-evaluated') {
            return textResponse(JSON.stringify(resolvedByRef.notEvaluated, null, 2));
          }
          const report = compareDrift(resolvedByRef.from, resolvedByRef.to, {
            threshold: DRIFT_THRESHOLDS.critical,
            topK: topK ?? 10,
            minLevel: (minLevel as DriftLevel | undefined) ?? 'stable',
          });
          return textResponse(
            JSON.stringify({ evaluated: true, ...buildDriftToolResult(report) }, null, 2)
          );
        }

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

        const report = compareDrift(resolved.from, resolved.to, {
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

// ---------------------------------------------------------------------------
// TASK-66 — cluster boundary (K-Means + Boundary Alignment Score)
// ---------------------------------------------------------------------------

/** Directory of an entity's source file (posix separators). */
function entityDirectory(entity: ArchJSON['entities'][number]): string {
  const file = entity.sourceLocation?.file ?? '';
  const normalized = file.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : '';
}

/**
 * Package key per entity for the cluster-boundary analysis (TASK-96).
 *
 * Dotted entity names (Java `com.foo.Bar`, Go) already carry their package, so
 * `undefined` is returned and the analyzer keeps its name-prefix split. Names
 * without dots (TypeScript: `escapeHtml`) carry no package — every entity would
 * be its own package — so the package is the entity's source directory, made
 * relative to the deepest directory shared by all entities (the source root).
 */
export function derivePackageOf(archJson: ArchJSON): string[] | undefined {
  const entities = archJson.entities;
  const dotted = entities.filter((e) => e.name.includes('.')).length;
  if (dotted * 2 >= entities.length) return undefined;

  const dirs = entities.map(entityDirectory);
  const common = dirs
    .map((d) => d.split('/'))
    .reduce((acc, parts) => {
      let i = 0;
      while (i < acc.length && i < parts.length && acc[i] === parts[i]) i++;
      return acc.slice(0, i);
    });
  const prefixLength = common.length;
  return dirs.map((d) => {
    const rel = d.split('/').slice(prefixLength).join('/');
    return rel.length > 0 ? rel : '.';
  });
}

/**
 * Build a `ClusterBoundaryReport` from ArchJSON in-memory (pure — no I/O).
 *
 * Builds the weighted adjacency matrix (TASK-64's `adjacency-builder`, with
 * name-resolved endpoints so it agrees with `get_dependents`) and runs
 * `ClusterBoundaryAnalyzer.analyze` over entity names, grouping by source
 * directory when names carry no package prefix (see `derivePackageOf`).
 *
 * @param archJson - Parsed architecture JSON.
 * @param options - ClusterBoundaryOptions (minPackageSize, splitThreshold, …).
 */
export function buildClusterBoundaryReport(
  archJson: ArchJSON,
  options: ClusterBoundaryOptions = {}
): ClusterBoundaryReport {
  const matrix = buildAdjacencyMatrix(archJson, { resolveByName: true });
  const entityNames = archJson.entities.map((e) => e.name);
  return new ClusterBoundaryAnalyzer(
    matrix,
    entityNames,
    options,
    derivePackageOf(archJson)
  ).analyze();
}

/**
 * Register the cluster-boundary MCP tool (TASK-66 Phase D).
 *
 * `archguard_get_cluster_boundary` loads the project's global-scope ArchJSON,
 * clusters entities by their structural position (adjacency rows / JL
 * projection), and returns a `ClusterBoundaryReport` comparing geometric
 * clusters to declared package boundaries. Single-snapshot only — nothing is
 * persisted and no ArchJSON schema change.
 */
export function registerClusterBoundaryTool(server: McpServer, defaultRoot: string): void {
  server.tool(
    'archguard_get_cluster_boundary',
    'Cluster entities by their structural position (weighted adjacency rows / JL projection) ' +
      'and compare the geometric clusters to declared package boundaries. Returns a ' +
      'ClusterBoundaryReport: globalBAS, silhouetteScore, per-package purity/coverage/BAS, ' +
      'splitPackages (purity < splitThreshold), crossDomainFusions, orphanEntities and cluster ' +
      'summaries. Requires a prior `analyze` run (query/arch.json).',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('Root directory of the target project. Defaults to MCP server startup cwd.'),
      minPackageSize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Ignore packages with fewer than this many entities (default 3).'),
      splitThreshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Purity below this marks a package as split (default 0.5).'),
      packageDepth: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Dot-separated package-prefix depth (default 2). Ignored when entity names have no dots ' +
            "(e.g. TypeScript): packages are then the entities' source directories."
        ),
      includeOrphans: z
        .boolean()
        .optional()
        .describe('Include orphanEntities (zero adjacency rows) in the report (default true).'),
    },
    async ({ projectRoot, minPackageSize, splitThreshold, packageDepth, includeOrphans }) => {
      try {
        const root = resolveRoot(projectRoot, defaultRoot);
        const archJson = await loadArchJsonForCluster(root);
        if (archJson === null) {
          return textResponse(
            JSON.stringify(
              {
                error: `no ArchJSON found at ${root}/.archguard/query. Run archguard_analyze({ projectRoot: "${root}" }) first.`,
              },
              null,
              2
            )
          );
        }
        if (archJson.entities.length < 2) {
          return textResponse(
            JSON.stringify(
              { error: 'at least 2 entities are required for cluster boundary analysis' },
              null,
              2
            )
          );
        }
        const report = buildClusterBoundaryReport(archJson, {
          minPackageSize,
          splitThreshold,
          packageDepth,
          includeOrphans,
        });
        return textResponse(JSON.stringify(report, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return textResponse(`Error: ${message}`);
      }
    }
  );
}
