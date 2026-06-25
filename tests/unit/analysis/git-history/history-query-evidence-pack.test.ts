/**
 * TDD tests for HistoryQuery.getEvidencePack() (TASK-23).
 *
 * Test cases:
 * - empty input returns empty results, hotspots, notFound
 * - single known file returns correct riskScore/riskLevel/topFactor
 * - multi-target: hotspots sorted desc by riskScore, length ≤ 3
 * - unknown target appears in notFound, results is empty
 * - partial: known + unknown — two results + one notFound entry
 */

import { describe, it, expect } from 'vitest';
import { HistoryQuery } from '@/analysis/git-history/history-query.js';
import type { LoadedHistoryData } from '@/cli/git-history/history-loader.js';
import type {
  GitHistoryManifest,
  FileHistoryMetrics,
  PackageHistoryMetrics,
  RiskFactors,
} from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Fixture helpers (shared with history-query.test.ts pattern)
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

function makeFileMetric(path_: string, riskFactors: Partial<RiskFactors> = {}): FileHistoryMetrics {
  const rf: RiskFactors = {
    churn: 0.3,
    authorCount: 0.3,
    ownerConcentration: 0.3,
    cochangeBreadth: 0.3,
    recency: 0.3,
    ...riskFactors,
  };
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
    riskFactors: rf,
  };
}

function makePackageMetric(
  path_: string,
  riskFactors: Partial<RiskFactors> = {}
): PackageHistoryMetrics {
  const rf: RiskFactors = {
    churn: 0.5,
    authorCount: 0.4,
    ownerConcentration: 0.4,
    cochangeBreadth: 0.3,
    recency: 0.5,
    ...riskFactors,
  };
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
    riskFactors: rf,
  };
}

function makeData(
  files: FileHistoryMetrics[],
  packages: PackageHistoryMetrics[]
): LoadedHistoryData {
  return {
    manifest: makeManifest(),
    fileMetrics: new Map(files.map((f) => [f.path, f])),
    packageMetrics: new Map(packages.map((p) => [p.path, p])),
  };
}

// ---------------------------------------------------------------------------
// getEvidencePack tests
// ---------------------------------------------------------------------------

describe('HistoryQuery.getEvidencePack', () => {
  it('empty input returns empty results, hotspots, and notFound', () => {
    const data = makeData([], []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([]);
    expect(result.results).toHaveLength(0);
    expect(result.hotspots).toHaveLength(0);
    expect(result.notFound).toHaveLength(0);
  });

  it('single known file returns correct riskScore, riskLevel, topFactor', () => {
    // riskFactors: churn=0.9 is highest; expected riskScore > 0.5 → high or critical
    const file = makeFileMetric('src/foo.ts', {
      churn: 0.9,
      authorCount: 0.2,
      ownerConcentration: 0.2,
      cochangeBreadth: 0.2,
      recency: 0.2,
    });
    const data = makeData([file], []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([{ targetType: 'file', target: 'src/foo.ts' }]);

    expect(result.results).toHaveLength(1);
    expect(result.notFound).toHaveLength(0);

    const entry = result.results[0];
    expect(entry.target).toBe('src/foo.ts');
    expect(entry.targetType).toBe('file');
    expect(typeof entry.riskScore).toBe('number');
    expect(entry.riskScore).toBeGreaterThan(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(entry.riskLevel);
    expect(typeof entry.topFactor).toBe('string');
    expect(entry.topFactor).toBe('churn'); // highest individual factor
  });

  it('multi-target: hotspots sorted desc by riskScore, length ≤ 3', () => {
    const lowRiskFile = makeFileMetric('src/low.ts', {
      churn: 0.1,
      authorCount: 0.1,
      ownerConcentration: 0.1,
      cochangeBreadth: 0.1,
      recency: 0.1,
    });
    const midRiskFile = makeFileMetric('src/mid.ts', {
      churn: 0.5,
      authorCount: 0.5,
      ownerConcentration: 0.5,
      cochangeBreadth: 0.5,
      recency: 0.5,
    });
    const highRiskFile = makeFileMetric('src/high.ts', {
      churn: 0.9,
      authorCount: 0.9,
      ownerConcentration: 0.9,
      cochangeBreadth: 0.9,
      recency: 0.9,
    });
    const data = makeData([lowRiskFile, midRiskFile, highRiskFile], []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([
      { targetType: 'file', target: 'src/low.ts' },
      { targetType: 'file', target: 'src/mid.ts' },
      { targetType: 'file', target: 'src/high.ts' },
    ]);

    expect(result.results).toHaveLength(3);
    expect(result.hotspots.length).toBeLessThanOrEqual(3);
    // hotspots sorted desc
    if (result.hotspots.length >= 2) {
      expect(result.hotspots[0].riskScore).toBeGreaterThanOrEqual(result.hotspots[1].riskScore);
    }
    // highest risk file should be first hotspot
    expect(result.hotspots[0].target).toBe('src/high.ts');
  });

  it('unknown target appears in notFound and results is empty', () => {
    const data = makeData([], []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([{ targetType: 'file', target: 'unknown.ts' }]);

    expect(result.results).toHaveLength(0);
    expect(result.notFound).toHaveLength(1);
    expect(result.notFound[0].target).toBe('unknown.ts');
    expect(result.notFound[0].targetType).toBe('file');
  });

  it('partial: known + unknown — two results + one notFound entry', () => {
    const file1 = makeFileMetric('src/a.ts');
    const file2 = makeFileMetric('src/b.ts');
    const data = makeData([file1, file2], []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([
      { targetType: 'file', target: 'src/a.ts' },
      { targetType: 'file', target: 'src/missing.ts' },
      { targetType: 'file', target: 'src/b.ts' },
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.notFound).toHaveLength(1);
    expect(result.notFound[0].target).toBe('src/missing.ts');
  });

  it('hotspots include at most 3 entries even with many targets', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      makeFileMetric(`src/file${i}.ts`, { churn: (i + 1) / 10 })
    );
    const data = makeData(files, []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack(
      files.map((f) => ({ targetType: 'file' as const, target: f.path }))
    );

    expect(result.results).toHaveLength(10);
    expect(result.hotspots).toHaveLength(3);
  });

  it('works with package targetType', () => {
    const pkg = makePackageMetric('src/cli');
    const data = makeData([], [pkg]);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([{ targetType: 'package', target: 'src/cli' }]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].targetType).toBe('package');
    expect(result.notFound).toHaveLength(0);
  });

  it('hotspots from results have correct riskScore ordering', () => {
    const file1 = makeFileMetric('src/a.ts', {
      churn: 0.2,
      authorCount: 0.2,
      ownerConcentration: 0.2,
      cochangeBreadth: 0.2,
      recency: 0.2,
    });
    const file2 = makeFileMetric('src/b.ts', {
      churn: 0.8,
      authorCount: 0.8,
      ownerConcentration: 0.8,
      cochangeBreadth: 0.8,
      recency: 0.8,
    });
    const data = makeData([file1, file2], []);
    const q = new HistoryQuery(data);

    const result = q.getEvidencePack([
      { targetType: 'file', target: 'src/a.ts' },
      { targetType: 'file', target: 'src/b.ts' },
    ]);

    // hotspot[0] should be the higher risk one (src/b.ts)
    expect(result.hotspots[0].target).toBe('src/b.ts');
    expect(result.hotspots[0].riskScore).toBeGreaterThan(result.hotspots[1].riskScore);
  });
});
