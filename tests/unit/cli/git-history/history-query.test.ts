/**
 * Unit tests for history-query.ts (Stage 2.2 + 2.3)
 *
 * TDD — written before implementation.
 */

import { describe, it, expect } from 'vitest';
import { HistoryQuery } from '@/cli/git-history/history-query.js';
import type { LoadedHistoryData } from '@/cli/git-history/history-loader.js';
import type {
  GitHistoryManifest,
  FileHistoryMetrics,
  PackageHistoryMetrics,
  CochangeEdge,
} from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<GitHistoryManifest> = {}): GitHistoryManifest {
  return {
    version: '1',
    generatedAt: '2025-06-01T00:00:00.000Z',
    headRef: 'abc1234',
    analyzedBranch: 'main',
    sinceDays: 90,
    maxCommits: 500,
    totalCommits: 100,
    includeMerges: false,
    granularities: ['package', 'file'],
    ...overrides,
  };
}

function makeCochange(target: string, strength: number, joint: number = 5): CochangeEdge {
  return {
    target,
    jointChangeCount: joint,
    strength,
    windowCoverage: strength,
  };
}

function makeFileMetric(
  path_: string,
  overrides: Partial<FileHistoryMetrics> = {}
): FileHistoryMetrics {
  return {
    path: path_,
    packagePath: path_.split('/')[0],
    commitCount: 10,
    activeDays: 7,
    addedLines: 200,
    deletedLines: 50,
    authorCount: 3,
    primaryOwner: 'alice@example.com',
    primaryOwnerShare: 0.7,
    lastChangedAt: '2025-05-01',
    topCochangeNeighbors: [],
    riskFactors: {
      churn: 0.5,
      authorCount: 0.4,
      ownerConcentration: 0.3,
      cochangeBreadth: 0.2,
      recency: 0.7,
    },
    ...overrides,
  };
}

function makePackageMetric(
  path_: string,
  overrides: Partial<PackageHistoryMetrics> = {}
): PackageHistoryMetrics {
  return {
    path: path_,
    commitCount: 20,
    activeDays: 15,
    addedLines: 400,
    deletedLines: 100,
    authorCount: 4,
    primaryOwner: 'bob@example.com',
    primaryOwnerShare: 0.6,
    lastChangedAt: '2025-05-15',
    topCochangeNeighbors: [],
    riskFactors: {
      churn: 0.6,
      authorCount: 0.5,
      ownerConcentration: 0.4,
      cochangeBreadth: 0.3,
      recency: 0.8,
    },
    ...overrides,
  };
}

/**
 * Build a LoadedHistoryData fixture with the given file/package metrics.
 */
function makeData(
  files: FileHistoryMetrics[],
  packages: PackageHistoryMetrics[],
  manifestOverrides: Partial<GitHistoryManifest> = {}
): LoadedHistoryData {
  return {
    manifest: makeManifest(manifestOverrides),
    fileMetrics: new Map(files.map((f) => [f.path, f])),
    packageMetrics: new Map(packages.map((p) => [p.path, p])),
  };
}

// ---------------------------------------------------------------------------
// getCochange
// ---------------------------------------------------------------------------

describe('HistoryQuery.getCochange', () => {
  it('returns neighbors sorted by strength desc', () => {
    const neighbors = [
      makeCochange('src/b.ts', 0.3),
      makeCochange('src/c.ts', 0.9),
      makeCochange('src/d.ts', 0.1),
    ];
    const file = makeFileMetric('src/a.ts', { topCochangeNeighbors: neighbors });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getCochange('file', 'src/a.ts');
    expect(result.neighbors[0].target).toBe('src/c.ts');
    expect(result.neighbors[1].target).toBe('src/b.ts');
    expect(result.neighbors[2].target).toBe('src/d.ts');
  });

  it('limits to topN', () => {
    const neighbors = Array.from({ length: 15 }, (_, i) =>
      makeCochange(`src/x${i}.ts`, 1 - i * 0.05)
    );
    const file = makeFileMetric('src/a.ts', { topCochangeNeighbors: neighbors });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getCochange('file', 'src/a.ts', 5);
    expect(result.neighbors).toHaveLength(5);
    expect(result.neighbors[0].strength).toBeGreaterThan(result.neighbors[4].strength);
  });

  it('returns empty neighbors for target with no co-changes', () => {
    const file = makeFileMetric('src/lonely.ts', { topCochangeNeighbors: [] });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getCochange('file', 'src/lonely.ts');
    expect(result.neighbors).toHaveLength(0);
  });

  it('throws for unknown target', () => {
    const data = makeData([], []);
    const q = new HistoryQuery(data);

    expect(() => q.getCochange('file', 'src/missing.ts')).toThrow(
      'Target "src/missing.ts" (type: file) not found'
    );
  });

  it('includes limitation message', () => {
    const file = makeFileMetric('src/a.ts');
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getCochange('file', 'src/a.ts');
    expect(result.limitation).toBeTruthy();
    expect(result.limitation).toContain('Co-change');
  });

  it('includes analyzedWindow metadata', () => {
    const file = makeFileMetric('src/a.ts');
    const data = makeData([file], [], { sinceDays: 60, totalCommits: 200 });
    const q = new HistoryQuery(data);

    const result = q.getCochange('file', 'src/a.ts');
    expect(result.analyzedWindow.sinceDays).toBe(60);
    expect(result.analyzedWindow.totalCommits).toBe(200);
    expect(result.analyzedWindow.generatedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('works for package type', () => {
    const neighbors = [makeCochange('tests', 0.8)];
    const pkg = makePackageMetric('src', { topCochangeNeighbors: neighbors });
    const data = makeData([], [pkg]);
    const q = new HistoryQuery(data);

    const result = q.getCochange('package', 'src');
    expect(result.neighbors).toHaveLength(1);
    expect(result.neighbors[0].target).toBe('tests');
    expect(result.targetType).toBe('package');
  });

  it('default topN is 10', () => {
    const neighbors = Array.from({ length: 12 }, (_, i) =>
      makeCochange(`src/x${i}.ts`, 0.9 - i * 0.05)
    );
    const file = makeFileMetric('src/a.ts', { topCochangeNeighbors: neighbors });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getCochange('file', 'src/a.ts'); // no topN arg
    expect(result.neighbors).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// getOwnership
// ---------------------------------------------------------------------------

describe('HistoryQuery.getOwnership', () => {
  it('returns primaryOwner and primaryOwnerShare', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'alice@example.com',
      primaryOwnerShare: 0.8,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.primaryOwner).toBe('alice@example.com');
    expect(result.primaryOwnerShare).toBe(0.8);
  });

  it('computes busFactor = 1 when primaryOwnerShare >= 0.5', () => {
    const file = makeFileMetric('src/a.ts', { primaryOwnerShare: 0.6 });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.busFactor).toBe(1);
  });

  it('computes busFactor = 2 when primaryOwnerShare < 0.5', () => {
    const file = makeFileMetric('src/a.ts', { primaryOwnerShare: 0.4 });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.busFactor).toBe(2);
  });

  it('contributors includes primaryOwner entry', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'alice@example.com',
      primaryOwnerShare: 0.8,
      commitCount: 10,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.contributors.length).toBeGreaterThanOrEqual(1);
    const owner = result.contributors.find((c) => c.email === 'alice@example.com');
    expect(owner).toBeDefined();
    expect(owner?.share).toBe(0.8);
  });

  it('omits "others" entry when primaryOwnerShare is 1.0', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'solo@example.com',
      primaryOwnerShare: 1.0,
      commitCount: 5,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    const others = result.contributors.find((c) => c.email === 'others');
    expect(others).toBeUndefined();
  });

  it('includes "others" entry when primaryOwnerShare < 1.0 and no topContributors', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'alice@example.com',
      primaryOwnerShare: 0.7,
      commitCount: 10,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    const others = result.contributors.find((c) => c.email === 'others');
    expect(others).toBeDefined();
    expect(others?.share).toBeCloseTo(0.3, 5);
  });

  it('returns real contributor emails from topContributors when available', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'alice@example.com',
      primaryOwnerShare: 0.7,
      commitCount: 10,
      topContributors: [
        { email: 'alice@example.com', commitCount: 7, share: 0.7 },
        { email: 'bob@example.com', commitCount: 3, share: 0.3 },
      ],
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.contributors).toHaveLength(2);
    const emails = result.contributors.map((c) => c.email);
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
    // no synthetic "others" entry
    expect(emails).not.toContain('others');
  });

  it('busFactor=1 when single author topContributor has 100% commits', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'alice@example.com',
      primaryOwnerShare: 1.0,
      commitCount: 5,
      topContributors: [{ email: 'alice@example.com', commitCount: 5, share: 1.0 }],
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.busFactor).toBe(1);
  });

  it('busFactor=2 when 2 authors together reach 50% with topContributors', () => {
    // alice=30%, bob=25%, carol=25%, dave=20% — need first 2 (55%) to hit >=50%
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'alice@example.com',
      primaryOwnerShare: 0.3,
      commitCount: 20,
      topContributors: [
        { email: 'alice@example.com', commitCount: 6, share: 0.3 },
        { email: 'bob@example.com', commitCount: 5, share: 0.25 },
        { email: 'carol@example.com', commitCount: 5, share: 0.25 },
        { email: 'dave@example.com', commitCount: 4, share: 0.2 },
      ],
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.busFactor).toBe(2);
  });

  it('throws for unknown target', () => {
    const data = makeData([], []);
    const q = new HistoryQuery(data);

    expect(() => q.getOwnership('file', 'src/missing.ts')).toThrow(
      'Target "src/missing.ts" (type: file) not found'
    );
  });

  it('includes analyzedWindow', () => {
    const file = makeFileMetric('src/a.ts');
    const data = makeData([file], [], { sinceDays: 30 });
    const q = new HistoryQuery(data);

    const result = q.getOwnership('file', 'src/a.ts');
    expect(result.analyzedWindow.sinceDays).toBe(30);
  });

  it('works for package type', () => {
    const pkg = makePackageMetric('src', {
      primaryOwner: 'bob@example.com',
      primaryOwnerShare: 0.9,
    });
    const data = makeData([], [pkg]);
    const q = new HistoryQuery(data);

    const result = q.getOwnership('package', 'src');
    expect(result.primaryOwner).toBe('bob@example.com');
    expect(result.targetType).toBe('package');
  });
});

// ---------------------------------------------------------------------------
// getChangeRisk
// ---------------------------------------------------------------------------

describe('HistoryQuery.getChangeRisk', () => {
  it('computes weighted riskScore from riskFactors', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 0.4,
        authorCount: 0.3,
        ownerConcentration: 0.5,
        cochangeBreadth: 0.2,
        recency: 0.6,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    // weights: churn=0.25, authorCount=0.2, ownerConcentration=0.2, cochangeBreadth=0.15, recency=0.2
    const expected = 0.4 * 0.25 + 0.3 * 0.2 + 0.5 * 0.2 + 0.2 * 0.15 + 0.6 * 0.2;
    expect(result.riskScore).toBeCloseTo(expected, 5);
  });

  it('riskLevel low for score < 0.25', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 0.1,
        authorCount: 0.1,
        ownerConcentration: 0.1,
        cochangeBreadth: 0.1,
        recency: 0.1,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.riskLevel).toBe('low');
  });

  it('riskLevel medium for score in [0.25, 0.5)', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 0.3,
        authorCount: 0.3,
        ownerConcentration: 0.3,
        cochangeBreadth: 0.3,
        recency: 0.3,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.riskScore).toBeCloseTo(0.3, 5);
    expect(result.riskLevel).toBe('medium');
  });

  it('riskLevel high for score in [0.5, 0.75)', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 0.7,
        authorCount: 0.6,
        ownerConcentration: 0.6,
        cochangeBreadth: 0.5,
        recency: 0.7,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.riskScore).toBeGreaterThanOrEqual(0.5);
    expect(result.riskScore).toBeLessThan(0.75);
    expect(result.riskLevel).toBe('high');
  });

  it('riskLevel critical for score >= 0.75', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 1.0,
        authorCount: 1.0,
        ownerConcentration: 1.0,
        cochangeBreadth: 1.0,
        recency: 1.0,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.riskScore).toBeCloseTo(1.0, 5);
    expect(result.riskLevel).toBe('critical');
  });

  it('throws for unknown target', () => {
    const data = makeData([], []);
    const q = new HistoryQuery(data);

    expect(() => q.getChangeRisk('file', 'src/missing.ts')).toThrow(
      'Target "src/missing.ts" (type: file) not found'
    );
  });

  it('includes limitation message', () => {
    const file = makeFileMetric('src/a.ts');
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.limitation).toBeTruthy();
    expect(result.limitation).toContain('heuristic');
  });

  it('factors match the riskFactors from stored metrics', () => {
    const rf = {
      churn: 0.5,
      authorCount: 0.4,
      ownerConcentration: 0.3,
      cochangeBreadth: 0.2,
      recency: 0.7,
    };
    const file = makeFileMetric('src/a.ts', { riskFactors: rf });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.factors.churn).toBe(rf.churn);
    expect(result.factors.authorCount).toBe(rf.authorCount);
    expect(result.factors.ownerConcentration).toBe(rf.ownerConcentration);
    expect(result.factors.cochangeBreadth).toBe(rf.cochangeBreadth);
    expect(result.factors.recency).toBe(rf.recency);
  });

  it('works for package type', () => {
    const pkg = makePackageMetric('src');
    const data = makeData([], [pkg]);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('package', 'src');
    expect(result.targetType).toBe('package');
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(1);
  });

  it('returns currentlyExists: true for an existing file', () => {
    const file = makeFileMetric('src/a.ts', { currentlyExists: true });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.currentlyExists).toBe(true);
  });

  it('returns currentlyExists: false for a deleted file', () => {
    const file = makeFileMetric('src/a.ts', { currentlyExists: false });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.currentlyExists).toBe(false);
  });

  it('returns currentlyExists: true when field is undefined (safe default)', () => {
    const file = makeFileMetric('src/a.ts'); // no currentlyExists set
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('file', 'src/a.ts');
    expect(result.currentlyExists).toBe(true);
  });

  it('returns currentlyExists: true for package type (packages have no existence flag)', () => {
    const pkg = makePackageMetric('src');
    const data = makeData([], [pkg]);
    const q = new HistoryQuery(data);

    const result = q.getChangeRisk('package', 'src');
    expect(result.currentlyExists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getChangeContext
// ---------------------------------------------------------------------------

describe('HistoryQuery.getChangeContext', () => {
  it('returns condensed summary with all key fields', () => {
    const file = makeFileMetric('src/a.ts', {
      commitCount: 15,
      activeDays: 10,
      primaryOwner: 'alice@example.com',
      lastChangedAt: '2025-05-20',
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.summary.commitCount).toBe(15);
    expect(result.summary.activeDays).toBe(10);
    expect(result.summary.primaryOwner).toBe('alice@example.com');
    expect(result.summary.lastChangedAt).toBe('2025-05-20');
  });

  it('topCochangeNeighbors limited to 5', () => {
    const neighbors = Array.from({ length: 10 }, (_, i) =>
      makeCochange(`src/x${i}.ts`, 0.9 - i * 0.08)
    );
    const file = makeFileMetric('src/a.ts', { topCochangeNeighbors: neighbors });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.topCochangeNeighbors).toHaveLength(5);
  });

  it('risk includes riskLevel and topFactor', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 0.9,
        authorCount: 0.2,
        ownerConcentration: 0.2,
        cochangeBreadth: 0.2,
        recency: 0.2,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.risk.riskLevel).toBeTruthy();
    expect(result.risk.topFactor).toBeTruthy();
    expect(typeof result.risk.riskScore).toBe('number');
  });

  it('topFactor is the factor with highest score', () => {
    const file = makeFileMetric('src/a.ts', {
      riskFactors: {
        churn: 0.2,
        authorCount: 0.95, // highest
        ownerConcentration: 0.3,
        cochangeBreadth: 0.1,
        recency: 0.4,
      },
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.risk.topFactor).toBe('authorCount');
  });

  it('throws for unknown target', () => {
    const data = makeData([], []);
    const q = new HistoryQuery(data);

    expect(() => q.getChangeContext('file', 'src/missing.ts')).toThrow(
      'Target "src/missing.ts" (type: file) not found'
    );
  });

  it('recentChurn contains addedLines, deletedLines, commitCount', () => {
    const file = makeFileMetric('src/a.ts', {
      addedLines: 300,
      deletedLines: 80,
      commitCount: 12,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.recentChurn.addedLines).toBe(300);
    expect(result.recentChurn.deletedLines).toBe(80);
    expect(result.recentChurn.commitCount).toBe(12);
  });

  it('ownerConcentration contains primaryOwner and share', () => {
    const file = makeFileMetric('src/a.ts', {
      primaryOwner: 'carol@example.com',
      primaryOwnerShare: 0.75,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.ownerConcentration.primaryOwner).toBe('carol@example.com');
    expect(result.ownerConcentration.primaryOwnerShare).toBe(0.75);
  });

  it('includes analyzedWindow', () => {
    const file = makeFileMetric('src/a.ts');
    const data = makeData([file], [], { sinceDays: 45 });
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.analyzedWindow.sinceDays).toBe(45);
  });

  it('works for package type', () => {
    const pkg = makePackageMetric('src');
    const data = makeData([], [pkg]);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('package', 'src');
    expect(result.targetType).toBe('package');
    expect(result.summary.commitCount).toBe(20);
  });

  it('stalePathWarning is undefined when currentlyExists is true', () => {
    const file = makeFileMetric('src/a.ts', { currentlyExists: true });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.stalePathWarning).toBeUndefined();
  });

  it('stalePathWarning is set when currentlyExists is false', () => {
    const file = makeFileMetric('src/a.ts', { currentlyExists: false });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getChangeContext('file', 'src/a.ts');
    expect(result.stalePathWarning).toBeDefined();
    expect(result.stalePathWarning).toContain('no longer exists');
  });
});
