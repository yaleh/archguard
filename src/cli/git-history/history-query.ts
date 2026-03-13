/**
 * History query — wraps LoadedHistoryData and exposes four query methods:
 *   - getCochange()
 *   - getOwnership()
 *   - getChangeRisk()
 *   - getChangeContext()
 *
 * Stages 2.2 + 2.3 of Phase 2 (Query Layer).
 */

import type { CochangeEdge, FileHistoryMetrics, PackageHistoryMetrics, RiskFactors } from '@/types/git-history.js';
import type { LoadedHistoryData } from './history-loader.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CochangeResult {
  target: string;
  targetType: 'package' | 'file';
  neighbors: CochangeEdge[];
  analyzedWindow: { sinceDays: number; totalCommits: number; generatedAt: string };
  limitation: string;
}

export interface OwnershipContributor {
  email: string;
  commitCount: number;
  share: number;
}

export interface OwnershipResult {
  target: string;
  targetType: 'package' | 'file';
  contributors: OwnershipContributor[];
  primaryOwner: string;
  primaryOwnerShare: number;
  activeMaintainers: number;
  busFactor: number;
  analyzedWindow: { sinceDays: number; totalCommits: number; generatedAt: string };
}

export interface ChangeRiskResult {
  target: string;
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
  limitation: string;
}

export interface ChangeContextResult {
  target: string;
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
  analyzedWindow: { sinceDays: number; totalCommits: number; generatedAt: string };
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

  private getMetrics(
    targetType: 'package' | 'file',
    target: string
  ): FileHistoryMetrics | PackageHistoryMetrics {
    const metrics =
      targetType === 'file'
        ? this.data.fileMetrics.get(target)
        : this.data.packageMetrics.get(target);

    if (!metrics) {
      throw new Error(
        `Target "${target}" (type: ${targetType}) not found in git history data. Check the target path matches analyzed data.`
      );
    }
    return metrics;
  }

  private analyzedWindow(): { sinceDays: number; totalCommits: number; generatedAt: string } {
    return {
      sinceDays: this.data.manifest.sinceDays,
      totalCommits: this.data.manifest.totalCommits,
      generatedAt: this.data.manifest.generatedAt,
    };
  }

  // -------------------------------------------------------------------------
  // getCochange
  // -------------------------------------------------------------------------

  getCochange(
    targetType: 'package' | 'file',
    target: string,
    topN: number = 10
  ): CochangeResult {
    const m = this.getMetrics(targetType, target);

    // Sort by strength desc and slice to topN
    const neighbors = [...m.topCochangeNeighbors]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, topN);

    return {
      target,
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
    const m = this.getMetrics(targetType, target);
    const { commitCount, primaryOwner, primaryOwnerShare } = m;

    // Build contributor list from available data (primaryOwner + optional "others")
    const ownerCommitCount = Math.round(commitCount * primaryOwnerShare);
    const othersCommitCount = commitCount - ownerCommitCount;
    const othersShare = 1 - primaryOwnerShare;

    const contributors: OwnershipContributor[] = [
      { email: primaryOwner, commitCount: ownerCommitCount, share: primaryOwnerShare },
    ];
    if (primaryOwnerShare < 1.0) {
      contributors.push({ email: 'others', commitCount: othersCommitCount, share: othersShare });
    }

    // activeMaintainers: 1 when nearly sole owner, 2+ otherwise (approximation)
    const activeMaintainers = primaryOwnerShare >= 0.9 ? 1 : 2;

    // busFactor: 1 if single person covers >=50% of commits, else 2
    const busFactor = primaryOwnerShare >= 0.5 ? 1 : 2;

    return {
      target,
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
    const m = this.getMetrics(targetType, target);
    const rf = m.riskFactors;

    const riskScore = computeRiskScore(rf);
    const riskLevel = classifyRiskLevel(riskScore);

    return {
      target,
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
      limitation:
        'Risk score is a heuristic approximation based on git history patterns.',
    };
  }

  // -------------------------------------------------------------------------
  // getChangeContext
  // -------------------------------------------------------------------------

  getChangeContext(targetType: 'package' | 'file', target: string): ChangeContextResult {
    const m = this.getMetrics(targetType, target);
    const rf = m.riskFactors;
    const riskScore = computeRiskScore(rf);
    const riskLevel = classifyRiskLevel(riskScore);

    return {
      target,
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
    };
  }
}
