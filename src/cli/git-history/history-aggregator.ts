/**
 * History aggregator — takes CommitRecord[] and produces file/package metrics
 * with co-change index and risk factor scores.
 */

import type { CommitRecord } from './git-log-reader.js';
import type {
  FileHistoryMetrics,
  PackageHistoryMetrics,
  CochangeEdge,
  RiskFactors,
} from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Internal accumulator types
// ---------------------------------------------------------------------------

interface FileAccumulator {
  path: string;
  commits: string[]; // sha list (for counting)
  dates: Set<string>;
  authors: Map<string, number>; // email → commit count
  addedLines: number;
  deletedLines: number;
  lastDate: string;
}

// ---------------------------------------------------------------------------
// File metrics
// ---------------------------------------------------------------------------

/**
 * Aggregate per-file metrics from a list of commits.
 *
 * Risk factors are computed after all files are accumulated so that
 * normalization denominators (max commit count, max author count) are known.
 */
export function aggregateFileMetrics(commits: CommitRecord[]): FileHistoryMetrics[] {
  const accMap = new Map<string, FileAccumulator>();

  for (const commit of commits) {
    for (const fc of commit.files) {
      let acc = accMap.get(fc.path);
      if (!acc) {
        acc = {
          path: fc.path,
          commits: [],
          dates: new Set(),
          authors: new Map(),
          addedLines: 0,
          deletedLines: 0,
          lastDate: commit.date,
        };
        accMap.set(fc.path, acc);
      }
      acc.commits.push(commit.sha);
      acc.dates.add(commit.date);
      acc.authors.set(commit.authorEmail, (acc.authors.get(commit.authorEmail) ?? 0) + 1);
      acc.addedLines += fc.added;
      acc.deletedLines += fc.deleted;
      if (commit.date > acc.lastDate) {
        acc.lastDate = commit.date;
      }
    }
  }

  if (accMap.size === 0) return [];

  // Normalization denominators
  const maxCommitCount = Math.max(...[...accMap.values()].map((a) => a.commits.length));
  const maxAuthorCount = Math.max(...[...accMap.values()].map((a) => a.authors.size));

  // Build co-change index
  const cochangeIndex = buildCochangeIndex(commits);

  const results: FileHistoryMetrics[] = [];

  for (const acc of accMap.values()) {
    const commitCount = acc.commits.length;
    const authorCount = acc.authors.size;

    // Primary owner: author with most commits to this file
    let primaryOwner = '';
    let primaryOwnerCommits = 0;
    for (const [email, count] of acc.authors) {
      if (count > primaryOwnerCommits) {
        primaryOwnerCommits = count;
        primaryOwner = email;
      }
    }
    const primaryOwnerShare = commitCount > 0 ? primaryOwnerCommits / commitCount : 0;

    const topCochangeNeighbors = cochangeIndex.get(acc.path) ?? [];

    const riskFactors = computeRiskFactors(
      {
        commitCount,
        authorCount,
        primaryOwnerShare,
        lastChangedAt: acc.lastDate,
        topCochangeNeighbors,
      },
      { maxCommitCount, maxAuthorCount }
    );

    results.push({
      path: acc.path,
      packagePath: extractPackagePath(acc.path),
      commitCount,
      activeDays: acc.dates.size,
      addedLines: acc.addedLines,
      deletedLines: acc.deletedLines,
      authorCount,
      primaryOwner,
      primaryOwnerShare,
      lastChangedAt: acc.lastDate,
      topCochangeNeighbors,
      riskFactors,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Package metrics
// ---------------------------------------------------------------------------

/**
 * Roll up file metrics to package level.
 * Package = first path segment (e.g. 'src' from 'src/utils/foo.ts').
 */
export function aggregatePackageMetrics(fileMetrics: FileHistoryMetrics[]): PackageHistoryMetrics[] {
  const pkgMap = new Map<
    string,
    {
      commitShas: Set<string>;
      dates: Set<string>;
      authors: Set<string>;
      authorCommits: Map<string, number>;
      addedLines: number;
      deletedLines: number;
      lastDate: string;
      files: FileHistoryMetrics[];
    }
  >();

  // We need the full commit records to build package-level co-change properly,
  // but here we only have file metrics. We'll aggregate via file metrics.
  for (const fm of fileMetrics) {
    const pkg = fm.packagePath;
    let acc = pkgMap.get(pkg);
    if (!acc) {
      acc = {
        commitShas: new Set(),
        dates: new Set(),
        authors: new Set(),
        authorCommits: new Map(),
        addedLines: 0,
        deletedLines: 0,
        lastDate: fm.lastChangedAt,
        files: [],
      };
      pkgMap.set(pkg, acc);
    }
    acc.addedLines += fm.addedLines;
    acc.deletedLines += fm.deletedLines;
    acc.files.push(fm);
    if (fm.lastChangedAt > acc.lastDate) acc.lastDate = fm.lastChangedAt;
  }

  if (pkgMap.size === 0) return [];

  // Denominators for risk normalization at package level
  // Approximate: use sum of file commit counts (packages can have higher raw counts)
  const pkgCommitCounts = [...pkgMap.values()].map((a) => a.files.reduce((s, f) => s + f.commitCount, 0));
  const maxCommitCount = Math.max(...pkgCommitCounts, 1);
  const pkgAuthorCounts = [...pkgMap.values()].map((a) => {
    const all = new Set(a.files.flatMap((f) => Array.from({ length: f.authorCount }, (_, i) => `${f.primaryOwner}-${i}`)));
    return a.files.reduce((mx, f) => Math.max(mx, f.authorCount), 0);
  });
  const maxAuthorCount = Math.max(...pkgAuthorCounts, 1);

  const results: PackageHistoryMetrics[] = [];

  for (const [pkg, acc] of pkgMap) {
    const commitCount = acc.files.reduce((s, f) => s + f.commitCount, 0);

    // Approximate author count: max across files (conservative estimate)
    const authorCount = acc.files.reduce((mx, f) => Math.max(mx, f.authorCount), 0);

    // Primary owner: owner of the file with most commits
    const mostChangedFile = acc.files.reduce((best, f) => (f.commitCount > best.commitCount ? f : best), acc.files[0]);
    const primaryOwner = mostChangedFile?.primaryOwner ?? '';
    const primaryOwnerShare = mostChangedFile?.primaryOwnerShare ?? 0;

    // Active days: union of dates — approximate as max of file active days
    const activeDays = acc.files.reduce((mx, f) => Math.max(mx, f.activeDays), 0);

    // Package-level co-change: aggregate neighbors across files, deduplicated to other packages
    const neighborPkgCounts = new Map<string, { joint: number; ownCount: number }>();
    for (const fm of acc.files) {
      for (const edge of fm.topCochangeNeighbors) {
        const neighborPkg = extractPackagePath(edge.target);
        if (neighborPkg === pkg) continue; // same package
        const existing = neighborPkgCounts.get(neighborPkg) ?? { joint: 0, ownCount: 0 };
        existing.joint += edge.jointChangeCount;
        existing.ownCount += fm.commitCount;
        neighborPkgCounts.set(neighborPkg, existing);
      }
    }

    const topCochangeNeighbors: CochangeEdge[] = [...neighborPkgCounts.entries()]
      .map(([target, { joint, ownCount }]) => ({
        target,
        jointChangeCount: joint,
        strength: ownCount > 0 ? Math.min(joint / ownCount, 1) : 0,
        windowCoverage: ownCount > 0 ? Math.min(joint / ownCount, 1) : 0,
      }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);

    const riskFactors = computeRiskFactors(
      {
        commitCount,
        authorCount,
        primaryOwnerShare,
        lastChangedAt: acc.lastDate,
        topCochangeNeighbors,
      },
      { maxCommitCount, maxAuthorCount }
    );

    results.push({
      path: pkg,
      commitCount,
      activeDays,
      addedLines: acc.addedLines,
      deletedLines: acc.deletedLines,
      authorCount,
      primaryOwner,
      primaryOwnerShare,
      lastChangedAt: acc.lastDate,
      topCochangeNeighbors,
      riskFactors,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Co-change index
// ---------------------------------------------------------------------------

/**
 * Build a co-change index from commit records.
 *
 * For each pair of files appearing in the same commit, increment joint count.
 * Strength is Jaccard similarity: joint / (ownCommits + neighborCommits - joint).
 * windowCoverage = joint / ownCommits.
 *
 * Returns a map: filePath → sorted list of top-N co-change edges.
 */
export function buildCochangeIndex(
  commits: CommitRecord[],
  topN: number = 10
): Map<string, CochangeEdge[]> {
  // Count commits per file
  const fileCommitCounts = new Map<string, number>();
  // Count joint occurrences for each file pair
  const pairCounts = new Map<string, number>();

  for (const commit of commits) {
    const paths = commit.files.map((f) => f.path);
    // Update per-file commit counts
    for (const p of paths) {
      fileCommitCounts.set(p, (fileCommitCounts.get(p) ?? 0) + 1);
    }
    // Update pair counts for all pairs in this commit
    if (paths.length < 2) continue;
    const sorted = [...paths].sort();
    for (let a = 0; a < sorted.length; a++) {
      for (let b = a + 1; b < sorted.length; b++) {
        const key = `${sorted[a]}\x00${sorted[b]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // Build adjacency per file
  const adjacency = new Map<string, Map<string, number>>();
  for (const [key, joint] of pairCounts) {
    const sep = key.indexOf('\x00');
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);

    if (!adjacency.has(a)) adjacency.set(a, new Map());
    if (!adjacency.has(b)) adjacency.set(b, new Map());
    adjacency.get(a)!.set(b, joint);
    adjacency.get(b)!.set(a, joint);
  }

  // Convert to CochangeEdge arrays, sort, and limit
  const result = new Map<string, CochangeEdge[]>();

  for (const [file, neighbors] of adjacency) {
    const ownCount = fileCommitCounts.get(file) ?? 1;
    const edges: CochangeEdge[] = [];

    for (const [neighbor, joint] of neighbors) {
      if (neighbor === file) continue;
      const neighborCount = fileCommitCounts.get(neighbor) ?? 1;
      const union = ownCount + neighborCount - joint;
      const strength = union > 0 ? joint / union : 0;
      const windowCoverage = ownCount > 0 ? joint / ownCount : 0;
      edges.push({
        target: neighbor,
        jointChangeCount: joint,
        strength,
        windowCoverage,
      });
    }

    // Sort by strength desc, then limit
    edges.sort((a, b) => b.strength - a.strength);
    result.set(file, edges.slice(0, topN));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Risk factor computation
// ---------------------------------------------------------------------------

export interface RiskInput {
  commitCount: number;
  authorCount: number;
  primaryOwnerShare: number;
  lastChangedAt: string; // YYYY-MM-DD or ISO
  topCochangeNeighbors: CochangeEdge[];
}

export interface RiskNorms {
  maxCommitCount: number;
  maxAuthorCount: number;
}

/**
 * Compute normalized risk factors for a file or package.
 *
 * @param input     Raw metrics for this artifact.
 * @param norms     Normalization denominators (max across all artifacts).
 * @param referenceDate  Reference date for recency calculation (defaults to now).
 */
export function computeRiskFactors(
  input: RiskInput,
  norms: RiskNorms,
  referenceDate: Date = new Date()
): RiskFactors {
  const { commitCount, authorCount, primaryOwnerShare, lastChangedAt, topCochangeNeighbors } = input;
  const { maxCommitCount, maxAuthorCount } = norms;

  // Churn: log1p normalized
  const churn =
    maxCommitCount > 0 ? Math.log1p(commitCount) / Math.log1p(maxCommitCount) : 0;

  // Author count: log1p normalized
  const authorCountRisk =
    maxAuthorCount > 0 ? Math.log1p(authorCount) / Math.log1p(maxAuthorCount) : 0;

  // Owner concentration: low share = high risk
  const ownerConcentration = 1 - primaryOwnerShare;

  // Co-change breadth: fraction of top-10 slots filled
  const cochangeBreadth = Math.min(topCochangeNeighbors.length / 10, 1);

  // Recency: recent activity = higher risk
  const lastDate = new Date(lastChangedAt);
  const daysSinceLastChange = Math.max(
    0,
    Math.floor((referenceDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  let recency: number;
  if (daysSinceLastChange <= 7) {
    recency = 1.0;
  } else if (daysSinceLastChange <= 30) {
    recency = 0.7;
  } else if (daysSinceLastChange <= 90) {
    recency = 0.4;
  } else {
    recency = 0.1;
  }

  return {
    churn,
    authorCount: authorCountRisk,
    ownerConcentration,
    cochangeBreadth,
    recency,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the package path (first directory segment) from a file path.
 * Returns '.' for root-level files.
 */
function extractPackagePath(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 1) return '.';
  return parts[0];
}
