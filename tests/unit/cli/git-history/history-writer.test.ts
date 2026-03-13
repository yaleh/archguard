/**
 * Unit tests for history-writer.ts
 *
 * Tests artifact writing with a temporary directory.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs-extra';
import { writeHistoryArtifacts } from '@/cli/git-history/history-writer.js';
import type { GitHistoryArtifacts } from '@/types/git-history.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(tmpdir(), `archguard-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSampleArtifacts(): GitHistoryArtifacts {
  return {
    manifest: {
      version: '1',
      generatedAt: '2024-01-15T10:00:00.000Z',
      headRef: 'abc1234',
      analyzedBranch: 'main',
      sinceDays: 90,
      maxCommits: 500,
      totalCommits: 42,
      includeMerges: false,
      granularities: ['package', 'file'],
    },
    packageMetrics: [
      {
        path: 'src',
        commitCount: 20,
        activeDays: 15,
        addedLines: 500,
        deletedLines: 100,
        authorCount: 3,
        primaryOwner: 'alice@x.com',
        primaryOwnerShare: 0.6,
        lastChangedAt: '2024-01-14',
        topCochangeNeighbors: [],
        riskFactors: {
          churn: 0.5,
          authorCount: 0.3,
          ownerConcentration: 0.4,
          cochangeBreadth: 0.1,
          recency: 0.7,
        },
      },
    ],
    fileMetrics: [
      {
        path: 'src/foo.ts',
        packagePath: 'src',
        commitCount: 10,
        activeDays: 8,
        addedLines: 200,
        deletedLines: 50,
        authorCount: 2,
        primaryOwner: 'alice@x.com',
        primaryOwnerShare: 0.7,
        lastChangedAt: '2024-01-14',
        topCochangeNeighbors: [
          { target: 'src/bar.ts', jointChangeCount: 5, strength: 0.8, windowCoverage: 0.5 },
        ],
        riskFactors: {
          churn: 0.4,
          authorCount: 0.2,
          ownerConcentration: 0.3,
          cochangeBreadth: 0.1,
          recency: 0.7,
        },
      },
    ],
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.remove(dir).catch(() => {});
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeHistoryArtifacts', () => {
  it('creates the git-history directory inside query/', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const expectedDir = path.join(archguardDir, 'query', 'git-history');
    expect(await fs.pathExists(expectedDir)).toBe(true);
  });

  it('writes manifest.json', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const manifestPath = path.join(archguardDir, 'query', 'git-history', 'manifest.json');
    expect(await fs.pathExists(manifestPath)).toBe(true);
  });

  it('writes package-metrics.json', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const filePath = path.join(archguardDir, 'query', 'git-history', 'package-metrics.json');
    expect(await fs.pathExists(filePath)).toBe(true);
  });

  it('writes file-metrics.json', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const filePath = path.join(archguardDir, 'query', 'git-history', 'file-metrics.json');
    expect(await fs.pathExists(filePath)).toBe(true);
  });

  it('manifest.json is valid JSON matching the manifest shape', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const manifestPath = path.join(archguardDir, 'query', 'git-history', 'manifest.json');
    const content = await fs.readJson(manifestPath);
    expect(content.version).toBe('1');
    expect(content.headRef).toBe('abc1234');
    expect(content.analyzedBranch).toBe('main');
    expect(content.sinceDays).toBe(90);
    expect(content.totalCommits).toBe(42);
    expect(content.granularities).toEqual(['package', 'file']);
  });

  it('package-metrics.json contains correct data', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const filePath = path.join(archguardDir, 'query', 'git-history', 'package-metrics.json');
    const content = await fs.readJson(filePath);
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].path).toBe('src');
    expect(content[0].commitCount).toBe(20);
  });

  it('file-metrics.json contains correct data including co-change neighbors', async () => {
    const archguardDir = makeTempDir();
    tempDirs.push(archguardDir);
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const filePath = path.join(archguardDir, 'query', 'git-history', 'file-metrics.json');
    const content = await fs.readJson(filePath);
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].path).toBe('src/foo.ts');
    expect(content[0].topCochangeNeighbors).toHaveLength(1);
    expect(content[0].topCochangeNeighbors[0].target).toBe('src/bar.ts');
  });

  it('creates intermediate directories even if archguardDir does not exist yet', async () => {
    const baseDir = makeTempDir();
    tempDirs.push(baseDir);
    // Use a nested path that doesn't exist yet
    const archguardDir = path.join(baseDir, 'new-project', '.archguard');
    const artifacts = makeSampleArtifacts();
    await writeHistoryArtifacts(archguardDir, artifacts);
    const manifestPath = path.join(archguardDir, 'query', 'git-history', 'manifest.json');
    expect(await fs.pathExists(manifestPath)).toBe(true);
  });
});
