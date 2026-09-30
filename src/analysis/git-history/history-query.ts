/**
 * History query — wraps LoadedHistoryData and exposes four query methods:
 *   - getCochange()
 *   - getOwnership()
 *   - getChangeRisk()
 *   - getChangeContext()
 *
 * Stages 2.2 + 2.3 of Phase 2 (Query Layer).
 */

import type {
  CochangeEdge,
  FileHistoryMetrics,
  PackageHistoryMetrics,
  RiskFactors,
} from '@/types/git-history.js';
import type { LoadedHistoryData } from '@/cli/git-history/history-loader.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AnalyzedWindow {
  sinceDays: number;
  totalCommits: number;
  generatedAt: string;
  /** Earliest commit date actually read (absent in manifests written before TASK-94). */
  windowStart?: string;
  /** Latest commit date actually read (absent in manifests written before TASK-94). */
  windowEnd?: string;
  /** True when maxCommits cut the window short of sinceDays. */
  truncated?: boolean;
  /** Present when truncated is true: explains the window is shorter than sinceDays. */
  note?: string;
}

export interface CochangeResult {
  target: string;
  /** The key actually looked up (repo-relative targets are converted to key-relative). */
  resolvedTarget: string;
  targetType: 'package' | 'file';
  neighbors: CochangeEdge[];
  analyzedWindow: AnalyzedWindow;
  limitation: string;
}

export interface OwnershipContributor {
  email: string;
  commitCount: number;
  share: number;
}

export interface OwnershipResult {
  target: string;
  /** The key actually looked up (repo-relative targets are converted to key-relative). */
  resolvedTarget: string;
  targetType: 'package' | 'file';
  contributors: OwnershipContributor[];
  primaryOwner: string;
  primaryOwnerShare: number;
  activeMaintainers: number;
  busFactor: number;
  analyzedWindow: AnalyzedWindow;
}

export interface ChangeRiskResult {
  target: string;
  /** The key actually looked up (repo-relative targets are converted to key-relative). */
  resolvedTarget: string;
  targetType: 'package' | 'file';
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactors;
  factorExplanations: {
    churn: string;
    authorCount: string;
    ownerConcentration: string;
    cochangeBreadth: number;
    recency: string;
  };
  currentlyExists: boolean;
  limitation: string;
}

export interface EvidencePackEntry {
  target: string;
  resolvedTarget: string;
  targetType: 'package' | 'file';
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  topFactor: string;
}

export interface EvidencePackNotFound {
  target: string;
  targetType: 'package' | 'file';
  reason: string;
  code: HistoryNotFoundCode;
}

export interface EvidencePackResult {
  results: EvidencePackEntry[];
  hotspots: EvidencePackEntry[];
  notFound: EvidencePackNotFound[];
}

export interface ChangeContextResult {
  target: string;
  /** The key actually looked up (repo-relative targets are converted to key-relative). */
  resolvedTarget: string;
  targetType: 'package' | 'file';
  summary: {
    commitCount: number;
    activeDays: number;
    primaryOwner: string;
    lastChangedAt: string;
  };
  recentChurn: { addedLines: number; deletedLines: number; commitCount: number };
  ownerConcentration: { primaryOwner: string; primaryOwnerShare: number };
  topCochangeNeighbors: CochangeEdge[];
  risk: { riskScore: number; riskLevel: string; topFactor: string };
  analyzedWindow: AnalyzedWindow;
  stalePathWarning?: string;
}

// ---------------------------------------------------------------------------
// Not-found classification
// ---------------------------------------------------------------------------

/**
 * Machine-readable reason a target has no git history data:
 *   - outside-analyzed-paths: target is not under any collected directory (`pathFilters`)
 *   - no-commits-in-window:   target is under a collected directory but had no commits in the window
 *   - legacy-manifest:        manifest has no `keyRoot`, so the cause cannot be told apart —
 *                             re-run archguard_analyze_git
 */
export type HistoryNotFoundCode =
  | 'outside-analyzed-paths'
  | 'no-commits-in-window'
  | 'legacy-manifest';

export class HistoryTargetNotFoundError extends Error {
  constructor(
    public readonly code: HistoryNotFoundCode,
    public readonly target: string,
    public readonly targetType: 'package' | 'file',
    public readonly resolvedTarget: string,
    detail: string,
    public readonly analyzedPaths?: string[],
    public readonly window?: { windowStart?: string; windowEnd?: string; sinceDays: number }
  ) {
    super(
      `Target "${target}" (type: ${targetType}) not found in git history data [${code}]. ${detail}`
    );
    this.name = 'HistoryTargetNotFoundError';
  }
}

const isUnder = (p: string, dir: string): boolean =>
  dir === '' || p === dir || p.startsWith(dir + '/');

/**
 * Normalize a caller-supplied target path so it matches the plain repo-relative
 * keys stored in the metrics maps (which come from `git log`, and never carry a
 * leading "./" or backslashes): strip repeated leading "./" segments, convert
 * backslashes to forward slashes, and drop a trailing slash.
 */
function normalizeTargetPath(target: string): string {
  let p = target.replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
  return p;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Risk score weights — must sum to 1. */
const RISK_WEIGHTS = {
  churn: 0.25,
  authorCount: 0.2,
  ownerConcentration: 0.2,
  cochangeBreadth: 0.15,
  recency: 0.2,
} as const;

function computeRiskScore(rf: RiskFactors): number {
  return (
    rf.churn * RISK_WEIGHTS.churn +
    rf.authorCount * RISK_WEIGHTS.authorCount +
    rf.ownerConcentration * RISK_WEIGHTS.ownerConcentration +
    rf.cochangeBreadth * RISK_WEIGHTS.cochangeBreadth +
    rf.recency * RISK_WEIGHTS.recency
  );
}

function classifyRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score < 0.25) return 'low';
  if (score < 0.5) return 'medium';
  if (score < 0.75) return 'high';
  return 'critical';
}

/** Return the factor name with the highest individual score. */
function topRiskFactor(rf: RiskFactors): string {
  const factors: Array<[keyof RiskFactors, number]> = [
    ['churn', rf.churn],
    ['authorCount', rf.authorCount],
    ['ownerConcentration', rf.ownerConcentration],
    ['cochangeBreadth', rf.cochangeBreadth],
    ['recency', rf.recency],
  ];
  return factors.reduce((best, cur) => (cur[1] > best[1] ? cur : best), factors[0])[0];
}

// ---------------------------------------------------------------------------
// HistoryQuery
// ---------------------------------------------------------------------------

export class HistoryQuery {
  constructor(private data: LoadedHistoryData) {}

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a target written either repo-relative or key-relative to the key used in the
   * metrics maps. A target starting with `keyRoot/` has that prefix stripped; if the
   * stripped key is absent but the literal target exists, the literal wins.
   */
  private resolveKey(targetType: 'package' | 'file', target: string): string {
    const keyRoot = this.data.manifest.keyRoot ?? '';
    const map = targetType === 'file' ? this.data.fileMetrics : this.data.packageMetrics;
    if (keyRoot !== '' && target.startsWith(keyRoot + '/')) {
      const stripped = target.slice(keyRoot.length + 1);
      if (map.has(stripped) || !map.has(target)) return stripped;
    }
    return target;
  }

  private notFoundError(
    targetType: 'package' | 'file',
    target: string,
    resolved: string
  ): HistoryTargetNotFoundError {
    const m = this.data.manifest;
    if (m.keyRoot === undefined) {
      return new HistoryTargetNotFoundError(
        'legacy-manifest',
        target,
        targetType,
        resolved,
        'This git history was generated by an older ArchGuard (manifest has no keyRoot), so a miss cannot be attributed. Re-run archguard_analyze_git.'
      );
    }
    const keyRoot = m.keyRoot;
    const pathFilters = m.pathFilters ?? [keyRoot];
    // The target may be written repo-relative or key-relative; a miss is "outside" only when
    // neither reading falls under a collected directory.
    const candidates = [target, keyRoot ? `${keyRoot}/${resolved}` : resolved];
    const covered = candidates.some((c) => pathFilters.some((f) => isUnder(c, f) || isUnder(f, c)));
    if (!covered) {
      return new HistoryTargetNotFoundError(
        'outside-analyzed-paths',
        target,
        targetType,
        resolved,
        `"${target}" is not under any analyzed directory. Collected directories (relative to git root): ${pathFilters.map((f) => f || '.').join(', ')}.`,
        pathFilters
      );
    }
    const window = {
      ...(m.windowStart !== undefined ? { windowStart: m.windowStart } : {}),
      ...(m.windowEnd !== undefined ? { windowEnd: m.windowEnd } : {}),
      sinceDays: m.sinceDays,
    };
    const span =
      m.windowStart && m.windowEnd
        ? `${m.windowStart} to ${m.windowEnd}`
        : `the last ${m.sinceDays} days`;
    return new HistoryTargetNotFoundError(
      'no-commits-in-window',
      target,
      targetType,
      resolved,
      `The path is within an analyzed directory but has no commits in the analyzed window (${span}).`,
      pathFilters,
      window
    );
  }

  private getMetrics(
    targetType: 'package' | 'file',
    rawTarget: string
  ): { metrics: FileHistoryMetrics | PackageHistoryMetrics; resolvedTarget: string } {
    const target = normalizeTargetPath(rawTarget);
    const resolvedTarget = this.resolveKey(targetType, target);
    const metrics =
      targetType === 'file'
        ? this.data.fileMetrics.get(resolvedTarget)
        : this.data.packageMetrics.get(resolvedTarget);

    if (!metrics) {
      throw this.notFoundError(targetType, target, resolvedTarget);
    }
    return { metrics, resolvedTarget };
  }

  private analyzedWindow(): AnalyzedWindow {
    const m = this.data.manifest;
    const window: AnalyzedWindow = {
      sinceDays: m.sinceDays,
      totalCommits: m.totalCommits,
      generatedAt: m.generatedAt,
    };
    // Optional fields: manifests written before TASK-94 do not carry them.
    if (m.windowStart !== undefined) window.windowStart = m.windowStart;
    if (m.windowEnd !== undefined) window.windowEnd = m.windowEnd;
    if (m.truncated !== undefined) window.truncated = m.truncated;
    if (m.truncated === true) {
      window.note =
        `History was truncated at maxCommits=${m.maxCommits}: the analyzed window` +
        (m.windowStart && m.windowEnd ? ` (${m.windowStart} to ${m.windowEnd})` : '') +
        ` is shorter than sinceDays=${m.sinceDays}. Re-run with a larger max-commits value ` +
        `(gitMaxCommits for archguard_analyze, maxCommits for archguard_analyze_git) to cover the full range.`;
    }
    return window;
  }

  // -------------------------------------------------------------------------
  // getCochange
  // -------------------------------------------------------------------------

  getCochange(targetType: 'package' | 'file', target: string, topN: number = 10): CochangeResult {
    const { metrics: m, resolvedTarget } = this.getMetrics(targetType, target);

    // Sort by strength desc and slice to topN
    const neighbors = [...m.topCochangeNeighbors]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, topN);

    return {
      target,
      resolvedTarget,
      targetType,
      neighbors,
      analyzedWindow: this.analyzedWindow(),
      limitation:
        'Co-change is an evolutionary signal, not proof of direct runtime or static dependency.',
    };
  }

  // -------------------------------------------------------------------------
  // getOwnership
  // -------------------------------------------------------------------------

  getOwnership(targetType: 'package' | 'file', target: string): OwnershipResult {
    const { metrics: m, resolvedTarget } = this.getMetrics(targetType, target);
    const { commitCount, primaryOwner, primaryOwnerShare } = m;

    let contributors: OwnershipContributor[];
    let busFactor: number;

    if (m.topContributors && m.topContributors.length > 0) {
      // Use real contributor data from topContributors
      contributors = m.topContributors.map((c) => ({
        email: c.email,
        commitCount: c.commitCount,
        share: c.share,
      }));

      // busFactor: cumulative contributors needed to reach 50% of commits
      let cumulative = 0;
      busFactor = 0;
      for (const c of m.topContributors) {
        cumulative += c.share;
        busFactor++;
        if (cumulative >= 0.5) break;
      }
      busFactor = Math.max(1, busFactor);
    } else {
      // Fallback: synthesize from primaryOwner + "others"
      const ownerCommitCount = Math.round(commitCount * primaryOwnerShare);
      const othersCommitCount = commitCount - ownerCommitCount;
      const othersShare = 1 - primaryOwnerShare;

      contributors = [
        { email: primaryOwner, commitCount: ownerCommitCount, share: primaryOwnerShare },
      ];
      if (primaryOwnerShare < 1.0) {
        contributors.push({ email: 'others', commitCount: othersCommitCount, share: othersShare });
      }

      // busFactor: 1 if single person covers >=50% of commits, else 2
      busFactor = primaryOwnerShare >= 0.5 ? 1 : 2;
    }

    // activeMaintainers: 1 when nearly sole owner, 2+ otherwise (approximation)
    const activeMaintainers = primaryOwnerShare >= 0.9 ? 1 : 2;

    return {
      target,
      resolvedTarget,
      targetType,
      contributors,
      primaryOwner,
      primaryOwnerShare,
      activeMaintainers,
      busFactor,
      analyzedWindow: this.analyzedWindow(),
    };
  }

  // -------------------------------------------------------------------------
  // getChangeRisk
  // -------------------------------------------------------------------------

  getChangeRisk(targetType: 'package' | 'file', target: string): ChangeRiskResult {
    const { metrics: m, resolvedTarget } = this.getMetrics(targetType, target);
    const rf = m.riskFactors;

    const riskScore = computeRiskScore(rf);
    const riskLevel = classifyRiskLevel(riskScore);

    // Packages have no existence flag; files default to true when unset
    const currentlyExists =
      targetType === 'file'
        ? ((m as import('@/types/git-history.js').FileHistoryMetrics).currentlyExists ?? true)
        : true;

    return {
      target,
      resolvedTarget,
      targetType,
      riskScore,
      riskLevel,
      factors: { ...rf },
      factorExplanations: {
        churn: `Commit churn factor: ${(rf.churn * 100).toFixed(0)}% of max (log-normalized)`,
        authorCount: `Author diversity factor: ${(rf.authorCount * 100).toFixed(0)}% of max (log-normalized)`,
        ownerConcentration: `Owner concentration risk: ${(rf.ownerConcentration * 100).toFixed(0)}% (1 - primaryOwnerShare)`,
        cochangeBreadth: rf.cochangeBreadth,
        recency: `Recency factor: ${(rf.recency * 100).toFixed(0)}% (recent activity = higher risk)`,
      },
      currentlyExists,
      limitation: 'Risk score is a heuristic approximation based on git history patterns.',
    };
  }

  // -------------------------------------------------------------------------
  // getChangeContext
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // getEvidencePack
  // -------------------------------------------------------------------------

  getEvidencePack(
    targets: Array<{ targetType: 'file' | 'package'; target: string }>
  ): EvidencePackResult {
    const results: EvidencePackEntry[] = [];
    const notFound: EvidencePackNotFound[] = [];

    for (const { targetType, target } of targets) {
      try {
        const { metrics: m, resolvedTarget } = this.getMetrics(targetType, target);
        const rf = m.riskFactors;
        const riskScore = computeRiskScore(rf);
        const riskLevel = classifyRiskLevel(riskScore);
        const topFactor = topRiskFactor(rf);
        results.push({ target, resolvedTarget, targetType, riskScore, riskLevel, topFactor });
      } catch (err) {
        if (!(err instanceof HistoryTargetNotFoundError)) throw err;
        notFound.push({ target, targetType, reason: err.message, code: err.code });
      }
    }

    // Top-3 hotspots sorted descending by riskScore
    const hotspots = [...results].sort((a, b) => b.riskScore - a.riskScore).slice(0, 3);

    return { results, hotspots, notFound };
  }

  getChangeContext(targetType: 'package' | 'file', target: string): ChangeContextResult {
    const { metrics: m, resolvedTarget } = this.getMetrics(targetType, target);
    const rf = m.riskFactors;
    const riskScore = computeRiskScore(rf);
    const riskLevel = classifyRiskLevel(riskScore);

    // Stale path warning: only applicable to file-type metrics with currentlyExists=false
    const stalePathWarning =
      targetType === 'file' &&
      (m as import('@/types/git-history.js').FileHistoryMetrics).currentlyExists === false
        ? 'This file path no longer exists in the working tree. It may have been renamed or deleted. History reflects the old path only.'
        : undefined;

    return {
      target,
      resolvedTarget,
      targetType,
      summary: {
        commitCount: m.commitCount,
        activeDays: m.activeDays,
        primaryOwner: m.primaryOwner,
        lastChangedAt: m.lastChangedAt,
      },
      recentChurn: {
        addedLines: m.addedLines,
        deletedLines: m.deletedLines,
        commitCount: m.commitCount,
      },
      ownerConcentration: {
        primaryOwner: m.primaryOwner,
        primaryOwnerShare: m.primaryOwnerShare,
      },
      topCochangeNeighbors: [...m.topCochangeNeighbors]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 5),
      risk: {
        riskScore,
        riskLevel,
        topFactor: topRiskFactor(rf),
      },
      analyzedWindow: this.analyzedWindow(),
      stalePathWarning,
    };
  }
}
