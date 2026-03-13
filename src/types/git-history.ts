/**
 * Git history artifact type definitions.
 *
 * These interfaces describe the output of git-history analysis —
 * manifest metadata, file/package metrics, co-change edges, and risk scores.
 */

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface GitHistoryManifest {
  version: '1' | '2';
  generatedAt: string; // ISO timestamp
  headRef: string; // analyzed HEAD SHA (short)
  analyzedBranch: string; // branch name or 'HEAD'
  sinceDays: number;
  maxCommits: number;
  totalCommits: number; // actual commits processed
  includeMerges: boolean;
  granularities: ('package' | 'file')[];
  packageDepth?: number; // sub-package depth (1 = first segment, 2 = two segments, etc.)
}

// ---------------------------------------------------------------------------
// Co-change
// ---------------------------------------------------------------------------

export interface CochangeEdge {
  target: string; // file or package path
  jointChangeCount: number; // raw count
  strength: number; // normalized 0..1 (Jaccard)
  windowCoverage: number; // fraction of target's own commits where neighbor also changed
}

// ---------------------------------------------------------------------------
// Risk factors
// ---------------------------------------------------------------------------

export interface RiskFactors {
  churn: number; // 0..1
  authorCount: number; // 0..1
  ownerConcentration: number; // 0..1 (LOW owner share = HIGH risk)
  cochangeBreadth: number; // 0..1
  recency: number; // 0..1 (recent activity = higher risk)
}

// ---------------------------------------------------------------------------
// Contributor summary
// ---------------------------------------------------------------------------

export interface ContributorSummary {
  email: string;
  commitCount: number;
  share: number; // 0..1 fraction of this artifact's total commits
}

// ---------------------------------------------------------------------------
// File metrics
// ---------------------------------------------------------------------------

export interface FileHistoryMetrics {
  path: string;
  packagePath: string; // first path segment
  commitCount: number;
  activeDays: number;
  addedLines: number;
  deletedLines: number;
  authorCount: number;
  primaryOwner: string;
  primaryOwnerShare: number; // 0..1
  lastChangedAt: string; // ISO timestamp (date string) of most recent commit
  topCochangeNeighbors: CochangeEdge[]; // bounded top-10
  riskFactors: RiskFactors;
  commitShas?: string[]; // unique SHA list for this file
  topContributors?: ContributorSummary[]; // top-5 contributors by commit count
  currentlyExists?: boolean; // false when the file path no longer exists in working tree
}

// ---------------------------------------------------------------------------
// Package metrics
// ---------------------------------------------------------------------------

export interface PackageHistoryMetrics {
  path: string; // package path (first dir segment)
  commitCount: number;
  activeDays: number;
  addedLines: number;
  deletedLines: number;
  authorCount: number;
  primaryOwner: string;
  primaryOwnerShare: number; // 0..1
  lastChangedAt: string; // ISO timestamp (date string)
  topCochangeNeighbors: CochangeEdge[];
  riskFactors: RiskFactors;
  topContributors?: ContributorSummary[]; // top-5 contributors by commit count
}

// ---------------------------------------------------------------------------
// Artifact container
// ---------------------------------------------------------------------------

export interface GitHistoryArtifacts {
  manifest: GitHistoryManifest;
  packageMetrics: PackageHistoryMetrics[];
  fileMetrics: FileHistoryMetrics[];
  // co-change index is embedded in each metrics entry
}
