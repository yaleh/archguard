/**
 * Unit tests for history-loader.ts (Stage 2.1)
 *
 * TDD — written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { loadHistoryData, GitHistoryNotFoundError } from '@/cli/git-history/history-loader.js';
import type { GitHistoryManifest, FileHistoryMetrics, PackageHistoryMetrics } from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<GitHistoryManifest> = {}): GitHistoryManifest {
  return {
    version: '1',
    generatedAt: '2025-01-01T00:00:00.000Z',
    headRef: 'abc1234',
    analyzedBranch: 'main',
    sinceDays: 90,
    maxCommits: 500,
    totalCommits: 42,
    includeMerges: false,
    granularities: ['package', 'file'],
    ...overrides,
  };
}

function makeFileMetric(path_: string): FileHistoryMetrics {
  return {
    path: path_,
    packagePath: path_.split('/')[0],
    commitCount: 5,
    activeDays: 3,
    addedLines: 100,
    deletedLines: 20,
    authorCount: 2,
    primaryOwner: 'alice@example.com',
    primaryOwnerShare: 0.8,
    lastChangedAt: '2025-01-01',
    topCochangeNeighbors: [],
    riskFactors: {
      churn: 0.5,
      authorCount: 0.4,
      ownerConcentration: 0.2,
      cochangeBreadth: 0.1,
      recency: 0.7,
    },
  };
}

function makePackageMetric(path_: string): PackageHistoryMetrics {
  return {
    path: path_,
    commitCount: 10,
    activeDays: 5,
    addedLines: 200,
    deletedLines: 50,
    authorCount: 3,
    primaryOwner: 'alice@example.com',
    primaryOwnerShare: 0.7,
    lastChangedAt: '2025-01-01',
    topCochangeNeighbors: [],
    riskFactors: {
      churn: 0.6,
      authorCount: 0.5,
      ownerConcentration: 0.3,
      cochangeBreadth: 0.2,
      recency: 0.8,
    },
  };
}

async function setupTmpDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-test-'));
  return tmpDir;
}

async function writeArtifacts(archguardDir: string, opts: {
  manifest?: GitHistoryManifest;
  fileMetrics?: FileHistoryMetrics[];
  packageMetrics?: PackageHistoryMetrics[];
} = {}): Promise<void> {
  const outDir = path.join(archguardDir, 'query', 'git-history');
  await fs.ensureDir(outDir);

  const manifest = opts.manifest ?? makeManifest();
  const fileMetrics = opts.fileMetrics ?? [makeFileMetric('src/utils/foo.ts')];
  const packageMetrics = opts.packageMetrics ?? [makePackageMetric('src')];

  await Promise.all([
    fs.writeJson(path.join(outDir, 'manifest.json'), manifest, { spaces: 2 }),
    fs.writeJson(path.join(outDir, 'file-metrics.json'), fileMetrics, { spaces: 2 }),
    fs.writeJson(path.join(outDir, 'package-metrics.json'), packageMetrics, { spaces: 2 }),
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadHistoryData', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await setupTmpDir();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('throws GitHistoryNotFoundError when directory does not exist', async () => {
    const archguardDir = path.join(tmpDir, '.archguard');
    // directory never created
    await expect(loadHistoryData(archguardDir)).rejects.toThrow(GitHistoryNotFoundError);
    await expect(loadHistoryData(archguardDir)).rejects.toThrow('No git history data found');
  });

  it('throws GitHistoryNotFoundError when manifest.json missing', async () => {
    const archguardDir = path.join(tmpDir, '.archguard');
    // Create dir but do NOT write manifest.json
    await fs.ensureDir(path.join(archguardDir, 'query', 'git-history'));
    await expect(loadHistoryData(archguardDir)).rejects.toThrow(GitHistoryNotFoundError);
  });

  it('loads manifest from manifest.json', async () => {
    const archguardDir = path.join(tmpDir, '.archguard');
    const manifest = makeManifest({ totalCommits: 77, analyzedBranch: 'feat/test' });
    await writeArtifacts(archguardDir, { manifest });

    const data = await loadHistoryData(archguardDir);
    expect(data.manifest.totalCommits).toBe(77);
    expect(data.manifest.analyzedBranch).toBe('feat/test');
    expect(data.manifest.version).toBe('1');
  });

  it('builds packageMetrics Map keyed by path', async () => {
    const archguardDir = path.join(tmpDir, '.archguard');
    const packageMetrics = [
      makePackageMetric('src'),
      makePackageMetric('tests'),
      makePackageMetric('docs'),
    ];
    await writeArtifacts(archguardDir, { packageMetrics });

    const data = await loadHistoryData(archguardDir);
    expect(data.packageMetrics.size).toBe(3);
    expect(data.packageMetrics.has('src')).toBe(true);
    expect(data.packageMetrics.has('tests')).toBe(true);
    expect(data.packageMetrics.has('docs')).toBe(true);
    expect(data.packageMetrics.get('src')?.commitCount).toBe(10);
  });

  it('builds fileMetrics Map keyed by path', async () => {
    const archguardDir = path.join(tmpDir, '.archguard');
    const fileMetrics = [
      makeFileMetric('src/utils/foo.ts'),
      makeFileMetric('src/index.ts'),
    ];
    await writeArtifacts(archguardDir, { fileMetrics });

    const data = await loadHistoryData(archguardDir);
    expect(data.fileMetrics.size).toBe(2);
    expect(data.fileMetrics.has('src/utils/foo.ts')).toBe(true);
    expect(data.fileMetrics.has('src/index.ts')).toBe(true);
    expect(data.fileMetrics.get('src/utils/foo.ts')?.commitCount).toBe(5);
  });

  it('returns empty maps when json arrays are empty', async () => {
    const archguardDir = path.join(tmpDir, '.archguard');
    await writeArtifacts(archguardDir, { fileMetrics: [], packageMetrics: [] });

    const data = await loadHistoryData(archguardDir);
    expect(data.fileMetrics.size).toBe(0);
    expect(data.packageMetrics.size).toBe(0);
  });

  it('error message includes archguardDir path', async () => {
    const archguardDir = path.join(tmpDir, 'custom', '.archguard');
    let err: Error | undefined;
    try {
      await loadHistoryData(archguardDir);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain(archguardDir);
  });
});
