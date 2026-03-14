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
  ContributorSummary,
} from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Internal accumulator types
// ---------------------------------------------------------------------------

interface FileAccumulator {
  path: string;
  commits: string[]; // sha list (for counting)
  dates: Set<string>;
  authors: Map<string, number>; // email → commit count
  authorShas: Map<string, Set<string>>; // email → set of unique SHAs
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
 *
 * @param commits   Commit records to aggregate.
 * @param depth     Number of path segments to use for packagePath (default: 1).
 */
export function aggregateFileMetrics(
  commits: CommitRecord[],
  depth: number = 1
): FileHistoryMetrics[] {
  const accMap = new Map<string, FileAccumulator & { shaSet: Set<string> }>();

  for (const commit of commits) {
    for (const fc of commit.files) {
      let acc = accMap.get(fc.path);
      if (!acc) {
        acc = {
          path: fc.path,
          commits: [],
          shaSet: new Set(),
          dates: new Set(),
          authors: new Map(),
          authorShas: new Map(),
          addedLines: 0,
          deletedLines: 0,
          lastDate: commit.date,
        };
        accMap.set(fc.path, acc);
      }
      acc.commits.push(commit.sha);
      acc.shaSet.add(commit.sha);
      acc.dates.add(commit.date);
      acc.authors.set(commit.authorEmail, (acc.authors.get(commit.authorEmail) ?? 0) + 1);
      if (!acc.authorShas.has(commit.authorEmail))
        acc.authorShas.set(commit.authorEmail, new Set());
      acc.authorShas.get(commit.authorEmail).add(commit.sha);
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

    // Build topContributors (top-5 sorted by commit count desc)
    const sortedAuthors = [...acc.authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topContributors: ContributorSummary[] = sortedAuthors.map(([email, count]) => ({
      email,
      commitCount: count,
      share: commitCount > 0 ? count / commitCount : 0,
    }));

    // Build contributorShas: per-author unique SHA record (used for package-level dedup)
    const contributorShas: Record<string, string[]> = {};
    for (const [email, shas] of acc.authorShas) {
      contributorShas[email] = [...shas];
    }

    results.push({
      path: acc.path,
      packagePath: extractPackagePath(acc.path, depth),
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
      commitShas: [...acc.shaSet],
      topContributors,
      contributorShas,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Package metrics
// ---------------------------------------------------------------------------

/**
 * Roll up file metrics to package level.
 *
 * @param fileMetrics  Already-aggregated file metrics (from aggregateFileMetrics).
 * @param depth        Package path depth; used to re-group files by pkg path (default: 1).
 */
export function aggregatePackageMetrics(
  fileMetrics: FileHistoryMetrics[],
  depth: number = 1
): PackageHistoryMetrics[] {
  const pkgMap = new Map<
    string,
    {
      addedLines: number;
      deletedLines: number;
      lastDate: string;
      files: FileHistoryMetrics[];
    }
  >();

  // We need the full commit records to build package-level co-change properly,
  // but here we only have file metrics. We'll aggregate via file metrics.
  for (const fm of fileMetrics) {
    const pkg = extractPackagePath(fm.path, depth);
    let acc = pkgMap.get(pkg);
    if (!acc) {
      acc = {
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

  // Compute deduplicated commit counts per package using commitShas
  const pkgCommitCounts = [...pkgMap.values()].map((a) => {
    const allShas = new Set(a.files.flatMap((f) => f.commitShas ?? []));
    return allShas.size > 0 ? allShas.size : a.files.reduce((s, f) => s + f.commitCount, 0);
  });
  const maxCommitCount = Math.max(...pkgCommitCounts, 1);
  const pkgAuthorCounts = [...pkgMap.values()].map((a) =>
    a.files.reduce((mx, f) => Math.max(mx, f.authorCount), 0)
  );
  const maxAuthorCount = Math.max(...pkgAuthorCounts, 1);

  const results: PackageHistoryMetrics[] = [];

  for (const [pkg, acc] of pkgMap) {
    // Deduplicated commit count via SHA union
    const allShas = new Set(acc.files.flatMap((f) => f.commitShas ?? []));
    const commitCount =
      allShas.size > 0 ? allShas.size : acc.files.reduce((s, f) => s + f.commitCount, 0);

    // Approximate author count: max across files (conservative estimate)
    const authorCount = acc.files.reduce((mx, f) => Math.max(mx, f.authorCount), 0);

    // Primary owner: owner of the file with most commits
    const mostChangedFile = acc.files.reduce(
      (best, f) => (f.commitCount > best.commitCount ? f : best),
      acc.files[0]
    );
    const primaryOwner = mostChangedFile?.primaryOwner ?? '';
    const primaryOwnerShare = mostChangedFile?.primaryOwnerShare ?? 0;

    // Active days: union of dates — approximate as max of file active days
    const activeDays = acc.files.reduce((mx, f) => Math.max(mx, f.activeDays), 0);

    // Package-level co-change: aggregate neighbors across files, deduplicated to other packages
    const neighborPkgCounts = new Map<string, { joint: number; ownCount: number }>();
    for (const fm of acc.files) {
      for (const edge of fm.topCochangeNeighbors) {
        const neighborPkg = extractPackagePath(edge.target, depth);
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

    // Merge per-author SHA sets from all files to compute package-level topContributors
    // This ensures share = authorUniqueShas.size / packageUniqueShas.size (no inflation)
    const pkgAuthorShas = new Map<string, Set<string>>();
    for (const fm of acc.files) {
      if (fm.contributorShas) {
        for (const [email, shas] of Object.entries(fm.contributorShas)) {
          if (!pkgAuthorShas.has(email)) pkgAuthorShas.set(email, new Set());
          const authorSet = pkgAuthorShas.get(email);
          for (const sha of shas) authorSet.add(sha);
        }
      } else {
        // Fallback: no contributorShas available — use topContributors counts (may inflate)
        for (const contributor of fm.topContributors ?? []) {
          pkgAuthorShas.set(
            contributor.email,
            new Set([
              ...(pkgAuthorShas.get(contributor.email) ?? []),
              contributor.email + '_count_' + contributor.commitCount,
            ])
          );
        }
      }
    }
    const sortedPkgAuthors = [...pkgAuthorShas.entries()]
      .map(([email, shas]) => [email, shas.size] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topContributors: ContributorSummary[] = sortedPkgAuthors.map(([email, count]) => ({
      email,
      commitCount: count,
      share: commitCount > 0 ? count / commitCount : 0,
    }));

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
      topContributors,
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
    adjacency.get(a).set(b, joint);
    adjacency.get(b).set(a, joint);
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
  const { commitCount, authorCount, primaryOwnerShare, lastChangedAt, topCochangeNeighbors } =
    input;
  const { maxCommitCount, maxAuthorCount } = norms;

  // Churn: log1p normalized
  const churn = maxCommitCount > 0 ? Math.log1p(commitCount) / Math.log1p(maxCommitCount) : 0;

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
 * Extract the package path from a file path, up to `depth` directory segments.
 * Returns '.' for root-level files.
 *
 * @param filePath  Relative file path (e.g. 'src/mermaid/foo.ts')
 * @param depth     Number of path segments to include (default: 1)
 */
export function extractPackagePath(filePath: string, depth: number = 1): string {
  const parts = filePath.split('/');
  if (parts.length <= 1) return '.';
  return parts.slice(0, depth).join('/') || '.';
}
