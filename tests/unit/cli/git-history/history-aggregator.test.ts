/**
 * Unit tests for history-aggregator.ts
 *
 * Tests aggregation logic with synthetic commit data — no actual git required.
 */

import { describe, it, expect } from 'vitest';
import type { CommitRecord } from '@/cli/git-history/git-log-reader.js';
import {
  aggregateFileMetrics,
  aggregatePackageMetrics,
  buildCochangeIndex,
  computeRiskFactors,
  extractPackagePath,
} from '@/cli/git-history/history-aggregator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(
  sha: string,
  authorEmail: string,
  date: string,
  files: Array<{ path: string; added?: number; deleted?: number }>
): CommitRecord {
  return {
    sha,
    authorEmail,
    date,
    files: files.map((f) => ({ path: f.path, added: f.added ?? 0, deleted: f.deleted ?? 0 })),
  };
}

// ---------------------------------------------------------------------------
// aggregateFileMetrics
// ---------------------------------------------------------------------------

describe('aggregateFileMetrics', () => {
  it('counts commits per file', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts', added: 10 }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts', added: 5 }]),
      makeCommit('a3', 'alice@x.com', '2024-01-03', [{ path: 'src/bar.ts', added: 2 }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    const bar = metrics.find((m) => m.path === 'src/bar.ts');
    expect(foo.commitCount).toBe(2);
    expect(bar.commitCount).toBe(1);
  });

  it('counts distinct authors', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'bob@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'alice@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.authorCount).toBe(2);
  });

  it('identifies primary owner as the author with most commits', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'bob@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'bob@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.primaryOwner).toBe('bob@x.com');
  });

  it('calculates primaryOwnerShare correctly', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'bob@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
      makeCommit('a4', 'bob@x.com', '2024-01-04', [{ path: 'src/foo.ts' }]),
      makeCommit('a5', 'carol@x.com', '2024-01-05', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    // alice=2, bob=2, carol=1 → max owner is alice or bob with 2/5 = 0.4
    expect(foo.primaryOwnerShare).toBeCloseTo(0.4, 5);
  });

  it('sums added and deleted lines', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [
        { path: 'src/foo.ts', added: 10, deleted: 3 },
      ]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts', added: 5, deleted: 2 }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.addedLines).toBe(15);
    expect(foo.deletedLines).toBe(5);
  });

  it('counts active days as distinct commit dates', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.activeDays).toBe(2);
  });

  it('computes packagePath as first path segment', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/utils/helper.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-01', [{ path: 'tests/foo.test.ts' }]),
      makeCommit('a3', 'alice@x.com', '2024-01-01', [{ path: 'index.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const srcFile = metrics.find((m) => m.path === 'src/utils/helper.ts');
    const testFile = metrics.find((m) => m.path === 'tests/foo.test.ts');
    const rootFile = metrics.find((m) => m.path === 'index.ts');
    expect(srcFile.packagePath).toBe('src');
    expect(testFile.packagePath).toBe('tests');
    expect(rootFile.packagePath).toBe('.');
  });

  it('sets lastChangedAt to the most recent commit date for the file', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-05', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'alice@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.lastChangedAt).toBe('2024-01-05');
  });

  it('returns empty array for empty commits', () => {
    const metrics = aggregateFileMetrics([]);
    expect(metrics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCochangeIndex
// ---------------------------------------------------------------------------

describe('buildCochangeIndex', () => {
  it('co-change strength is 1.0 when files always change together', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
    ];
    const index = buildCochangeIndex(commits);
    const aNeighbors = index.get('src/a.ts');
    const bEdge = aNeighbors.find((e) => e.target === 'src/b.ts');
    // jaccard: 2 / (2 + 2 - 2) = 1.0
    expect(bEdge.strength).toBeCloseTo(1.0, 5);
  });

  it('strength is jaccard: joint / (ownCommits + neighborCommits - joint)', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/a.ts' }]),
      makeCommit('a3', 'alice@x.com', '2024-01-03', [{ path: 'src/b.ts' }]),
    ];
    // a: 2 commits, b: 2 commits, joint: 1
    // jaccard = 1 / (2 + 2 - 1) = 1/3
    const index = buildCochangeIndex(commits);
    const aNeighbors = index.get('src/a.ts');
    const bEdge = aNeighbors.find((e) => e.target === 'src/b.ts');
    expect(bEdge.strength).toBeCloseTo(1 / 3, 5);
  });

  it('windowCoverage is jointCount / ownCommits', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/a.ts' }]),
    ];
    // a has 2 commits, joint with b = 1 → windowCoverage from a's perspective = 1/2
    const index = buildCochangeIndex(commits);
    const aNeighbors = index.get('src/a.ts');
    const bEdge = aNeighbors.find((e) => e.target === 'src/b.ts');
    expect(bEdge.windowCoverage).toBeCloseTo(0.5, 5);
  });

  it('limits to topN neighbors', () => {
    // Create 15 files that all change with 'src/hub.ts'
    const filePaths = Array.from({ length: 15 }, (_, i) => `src/f${i}.ts`);
    const files = [{ path: 'src/hub.ts' }, ...filePaths.map((p) => ({ path: p }))];
    const commits: CommitRecord[] = [makeCommit('a1', 'alice@x.com', '2024-01-01', files)];
    const index = buildCochangeIndex(commits, 10);
    const hubNeighbors = index.get('src/hub.ts');
    expect(hubNeighbors.length).toBeLessThanOrEqual(10);
  });

  it('does not include self as co-change neighbor', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
    ];
    const index = buildCochangeIndex(commits);
    const aNeighbors = index.get('src/a.ts') ?? [];
    const selfEdge = aNeighbors.find((e) => e.target === 'src/a.ts');
    expect(selfEdge).toBeUndefined();
  });

  it('returns empty map for commits with single-file changes', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/a.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/b.ts' }]),
    ];
    const index = buildCochangeIndex(commits);
    // No pairs, so no co-change edges
    const aNeighbors = index.get('src/a.ts') ?? [];
    expect(aNeighbors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// risk factors
// ---------------------------------------------------------------------------

describe('computeRiskFactors', () => {
  it('high churn files have higher churn risk than low churn files', () => {
    const commits: CommitRecord[] = [
      // high churn: 10 commits
      ...Array.from({ length: 10 }, (_, i) =>
        makeCommit(`h${i}`, 'alice@x.com', `2024-01-${String(i + 1).padStart(2, '0')}`, [
          { path: 'src/hot.ts' },
        ])
      ),
      // low churn: 1 commit
      makeCommit('l1', 'alice@x.com', '2024-01-01', [{ path: 'src/cold.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const hot = metrics.find((m) => m.path === 'src/hot.ts');
    const cold = metrics.find((m) => m.path === 'src/cold.ts');
    expect(hot.riskFactors.churn).toBeGreaterThan(cold.riskFactors.churn);
  });

  it('single owner reduces ownerConcentration risk (high share → low risk)', () => {
    // sole owner → primaryOwnerShare=1 → ownerConcentration = 1 - 1 = 0
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/owned.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/owned.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const owned = metrics.find((m) => m.path === 'src/owned.ts');
    expect(owned.riskFactors.ownerConcentration).toBeCloseTo(0, 5);
  });

  it('shared ownership increases ownerConcentration risk', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/shared.ts' }]),
      makeCommit('a2', 'bob@x.com', '2024-01-02', [{ path: 'src/shared.ts' }]),
      makeCommit('a3', 'carol@x.com', '2024-01-03', [{ path: 'src/shared.ts' }]),
      makeCommit('a4', 'dave@x.com', '2024-01-04', [{ path: 'src/shared.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const shared = metrics.find((m) => m.path === 'src/shared.ts');
    // 4 authors each with 1/4 share → ownerConcentration = 1 - 0.25 = 0.75
    expect(shared.riskFactors.ownerConcentration).toBeGreaterThan(0.5);
  });

  it('recent changes increase recency risk (within 7 days = 1.0)', () => {
    // We pass a fixed referenceDate to computeRiskFactors for determinism
    const today = new Date('2024-02-10');
    const recentDate = '2024-02-05'; // 5 days ago → recency = 1
    const oldDate = '2024-01-01'; // 40 days ago → recency = 0.4
    const recent = computeRiskFactors(
      {
        commitCount: 1,
        authorCount: 1,
        primaryOwnerShare: 1,
        lastChangedAt: recentDate,
        topCochangeNeighbors: [],
      },
      { maxCommitCount: 5, maxAuthorCount: 2 },
      today
    );
    const old = computeRiskFactors(
      {
        commitCount: 1,
        authorCount: 1,
        primaryOwnerShare: 1,
        lastChangedAt: oldDate,
        topCochangeNeighbors: [],
      },
      { maxCommitCount: 5, maxAuthorCount: 2 },
      today
    );
    expect(recent.recency).toBeCloseTo(1.0, 5);
    expect(old.recency).toBeCloseTo(0.4, 5);
  });

  it('very old changes have low recency risk (>90 days = 0.1)', () => {
    const today = new Date('2024-06-01');
    const veryOldDate = '2024-01-01'; // ~152 days ago
    const risk = computeRiskFactors(
      {
        commitCount: 1,
        authorCount: 1,
        primaryOwnerShare: 1,
        lastChangedAt: veryOldDate,
        topCochangeNeighbors: [],
      },
      { maxCommitCount: 5, maxAuthorCount: 2 },
      today
    );
    expect(risk.recency).toBeCloseTo(0.1, 5);
  });

  it('cochangeBreadth is capped at 1 even with many neighbors', () => {
    const neighbors = Array.from({ length: 15 }, (_, i) => ({
      target: `src/f${i}.ts`,
      jointChangeCount: 1,
      strength: 0.5,
      windowCoverage: 0.5,
    }));
    const today = new Date('2024-02-10');
    const risk = computeRiskFactors(
      {
        commitCount: 1,
        authorCount: 1,
        primaryOwnerShare: 1,
        lastChangedAt: '2024-02-09',
        topCochangeNeighbors: neighbors,
      },
      { maxCommitCount: 5, maxAuthorCount: 2 },
      today
    );
    expect(risk.cochangeBreadth).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// depth and SHA dedup (Plan 38A)
// ---------------------------------------------------------------------------

describe('extractPackagePath', () => {
  it('depth=2 returns first two segments', () => {
    expect(extractPackagePath('src/mermaid/foo.ts', 2)).toBe('src/mermaid');
  });

  it('depth=1 returns first segment only', () => {
    expect(extractPackagePath('src/mermaid/foo.ts', 1)).toBe('src');
  });

  it('root-level file returns "." regardless of depth', () => {
    expect(extractPackagePath('Makefile', 1)).toBe('.');
  });

  it('depth=2 with only two segments returns both', () => {
    expect(extractPackagePath('src/foo.ts', 2)).toBe('src/foo.ts');
  });
});

describe('aggregateFileMetrics — commitShas', () => {
  it('stores unique SHAs in commitShas', () => {
    const commits: CommitRecord[] = [
      makeCommit('sha1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('sha2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('sha3', 'alice@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.commitShas).toBeDefined();
    expect(foo.commitShas?.sort()).toEqual(['sha1', 'sha2', 'sha3'].sort());
  });

  it('deduplicates SHAs when same commit touches same file twice (edge case)', () => {
    const commits: CommitRecord[] = [
      makeCommit('sha1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('sha1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    // SHA dedup: only 1 unique sha
    expect(foo.commitShas).toHaveLength(1);
  });
});

describe('aggregatePackageMetrics — SHA dedup for commit counts', () => {
  it('package commitCount is deduplicated across files sharing same commit SHA', () => {
    // 3 commits each touching 5 files in same package → package commitCount = 3, not 15
    const shaFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((f) => ({ path: `src/${f}` }));
    const commits: CommitRecord[] = [
      makeCommit('sha1', 'alice@x.com', '2024-01-01', shaFiles),
      makeCommit('sha2', 'alice@x.com', '2024-01-02', shaFiles),
      makeCommit('sha3', 'alice@x.com', '2024-01-03', shaFiles),
    ];
    const fileMetrics = aggregateFileMetrics(commits);
    const packageMetrics = aggregatePackageMetrics(fileMetrics);
    const src = packageMetrics.find((p) => p.path === 'src');
    expect(src.commitCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// topContributors (Plan 38B)
// ---------------------------------------------------------------------------

describe('aggregateFileMetrics — topContributors', () => {
  it('file with 3 commits from 2 authors has 2 topContributors entries', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'bob@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.topContributors).toBeDefined();
    expect(foo.topContributors).toHaveLength(2);
  });

  it('topContributors are sorted desc by commitCount', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'bob@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'alice@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.topContributors[0].email).toBe('alice@x.com');
    expect(foo.topContributors[0].commitCount).toBe(2);
    expect(foo.topContributors[1].email).toBe('bob@x.com');
    expect(foo.topContributors[1].commitCount).toBe(1);
  });

  it('topContributors share sums to ~1.0', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/foo.ts' }]),
      makeCommit('a3', 'bob@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    const totalShare = foo.topContributors.reduce((s, c) => s + c.share, 0);
    expect(totalShare).toBeCloseTo(1.0, 5);
  });

  it('caps topContributors at 5 entries for files with many authors', () => {
    const commits: CommitRecord[] = Array.from({ length: 10 }, (_, i) =>
      makeCommit(`s${i}`, `author${i}@x.com`, `2024-01-${String(i + 1).padStart(2, '0')}`, [
        { path: 'src/foo.ts' },
      ])
    );
    const metrics = aggregateFileMetrics(commits);
    const foo = metrics.find((m) => m.path === 'src/foo.ts');
    expect(foo.topContributors.length).toBeLessThanOrEqual(5);
  });
});

describe('aggregatePackageMetrics — topContributors', () => {
  it('package topContributors merges authors from all files', () => {
    const commits: CommitRecord[] = [
      makeCommit('a1', 'alice@x.com', '2024-01-01', [{ path: 'src/foo.ts' }]),
      makeCommit('a2', 'alice@x.com', '2024-01-02', [{ path: 'src/bar.ts' }]),
      makeCommit('a3', 'bob@x.com', '2024-01-03', [{ path: 'src/foo.ts' }]),
    ];
    const fileMetrics = aggregateFileMetrics(commits);
    const packageMetrics = aggregatePackageMetrics(fileMetrics);
    const src = packageMetrics.find((p) => p.path === 'src');
    expect(src.topContributors).toBeDefined();
    const alice = src.topContributors.find((c) => c.email === 'alice@x.com');
    const bob = src.topContributors.find((c) => c.email === 'bob@x.com');
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// contributor share correctness (Plan 39A)
// ---------------------------------------------------------------------------

describe('aggregatePackageMetrics — contributor share correctness', () => {
  it('share does not exceed 1.0 when one contributor changes many files with same SHAs', () => {
    // Alice makes 10 commits, each touching 5 files in the same package.
    // Per-file count would be 10 each → naively summed = 50, share = 50/10 = 5.0 (wrong).
    // With SHA dedup: alice's unique SHAs = 10, package SHAs = 10 → share = 1.0 (correct).
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((f) => ({ path: `src/${f}` }));
    const commits: CommitRecord[] = Array.from({ length: 10 }, (_, i) =>
      makeCommit(`sha${i}`, 'alice@x.com', `2024-01-${String(i + 1).padStart(2, '0')}`, files)
    );
    const fileMetrics = aggregateFileMetrics(commits);
    const packageMetrics = aggregatePackageMetrics(fileMetrics);
    const src = packageMetrics.find((p) => p.path === 'src');
    const alice = src.topContributors.find((c) => c.email === 'alice@x.com');
    expect(alice).toBeDefined();
    expect(alice.share).toBeLessThanOrEqual(1.0);
    expect(alice.commitCount).toBe(10);
  });

  it('two contributors with disjoint 5-commit sets each have share=0.5', () => {
    // Alice makes commits sha0-sha4 on foo.ts, Bob makes sha5-sha9 on bar.ts.
    // Package has 10 unique SHAs → each contributor has 5 → share = 0.5.
    const aliceCommits: CommitRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeCommit(`sha${i}`, 'alice@x.com', `2024-01-${String(i + 1).padStart(2, '0')}`, [
        { path: 'src/foo.ts' },
      ])
    );
    const bobCommits: CommitRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeCommit(`sha${i + 5}`, 'bob@x.com', `2024-01-${String(i + 6).padStart(2, '0')}`, [
        { path: 'src/bar.ts' },
      ])
    );
    const fileMetrics = aggregateFileMetrics([...aliceCommits, ...bobCommits]);
    const packageMetrics = aggregatePackageMetrics(fileMetrics);
    const src = packageMetrics.find((p) => p.path === 'src');
    expect(src.commitCount).toBe(10);
    const alice = src.topContributors.find((c) => c.email === 'alice@x.com');
    const bob = src.topContributors.find((c) => c.email === 'bob@x.com');
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(alice.share).toBeCloseTo(0.5, 5);
    expect(bob.share).toBeCloseTo(0.5, 5);
  });

  it('busFactor computed correctly from accurate shares: sole contributor = high bus factor risk', () => {
    // Alice makes all 10 commits touching 5 files.
    // Package commitCount = 10, alice share = 1.0, alice is primary owner.
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((f) => ({ path: `src/${f}` }));
    const commits: CommitRecord[] = Array.from({ length: 10 }, (_, i) =>
      makeCommit(`sha${i}`, 'alice@x.com', `2024-01-${String(i + 1).padStart(2, '0')}`, files)
    );
    const fileMetrics = aggregateFileMetrics(commits);
    const packageMetrics = aggregatePackageMetrics(fileMetrics);
    const src = packageMetrics.find((p) => p.path === 'src');
    const alice = src.topContributors.find((c) => c.email === 'alice@x.com');
    // sole contributor: share should be exactly 1.0, and ownerConcentration (bus factor risk) should be low
    expect(alice.share).toBeCloseTo(1.0, 5);
    // ownerConcentration = 1 - primaryOwnerShare; sole owner → ownerConcentration ≈ 0
    expect(src.riskFactors.ownerConcentration).toBeCloseTo(0, 1);
  });
});
