import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { appendFIMSnapshot, readFIMHistory } from '@/analysis/fim/fim-snapshot.js';
import type { FIMSnapshot } from '@/analysis/fim/types.js';

const tempDirs: string[] = [];

function makeSnapshot(source: FIMSnapshot['source']): FIMSnapshot {
  return {
    timestamp: '2026-03-30T00:00:00.000Z',
    source,
    fileCount: 3,
    testCount: 4,
    conditionNumber: 2,
    effectiveDimension: 1.5,
    topEigenvalueShares: [0.5, 0.3, 0.2],
    uncoveredFileCount: 1,
  };
}

async function makeOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-fim-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
});

describe('appendFIMSnapshot', () => {
  it('creates a new history file when none exists', async () => {
    const outputDir = await makeOutputDir();

    await appendFIMSnapshot(outputDir, makeSnapshot('import-approximation'));

    const history = await fs.readJson(path.join(outputDir, 'query/fim/fim-history.json'));
    expect(history).toHaveLength(1);
  });

  it('appends snapshots to an existing history file', async () => {
    const outputDir = await makeOutputDir();

    await appendFIMSnapshot(outputDir, makeSnapshot('import-approximation'));
    await appendFIMSnapshot(outputDir, {
      ...makeSnapshot('per-test-coverage'),
      timestamp: '2026-03-31T00:00:00.000Z',
    });

    const history = await readFIMHistory(outputDir);
    expect(history).toHaveLength(2);
  });
});

describe('readFIMHistory', () => {
  it('returns an empty array when the history file does not exist', async () => {
    const outputDir = await makeOutputDir();
    await expect(readFIMHistory(outputDir)).resolves.toEqual([]);
  });

  it('preserves the source field for stored snapshots', async () => {
    const outputDir = await makeOutputDir();
    const snapshot = makeSnapshot('mutation');

    await appendFIMSnapshot(outputDir, snapshot);

    await expect(readFIMHistory(outputDir)).resolves.toEqual([snapshot]);
  });
});

describe('FIMSnapshot filteredTopEigenvalueShares type shape and persistence', () => {
  it('accepts filteredTopEigenvalueShares as an optional field on FIMSnapshot', async () => {
    const outputDir = await makeOutputDir();
    const snapshot: FIMSnapshot = {
      ...makeSnapshot('import-approximation'),
      filteredTopEigenvalueShares: [0.7, 0.3],
    };

    // If FIMSnapshot does not declare filteredTopEigenvalueShares, this assignment
    // will cause a TypeScript compile error, making the test fail at type-check.
    expect(snapshot.filteredTopEigenvalueShares).toEqual([0.7, 0.3]);
  });

  it('persists and retrieves filteredTopEigenvalueShares via appendFIMSnapshot / readFIMHistory', async () => {
    const outputDir = await makeOutputDir();
    const snapshot: FIMSnapshot = {
      ...makeSnapshot('import-approximation'),
      filteredTopEigenvalueShares: [0.7, 0.3],
    };

    await appendFIMSnapshot(outputDir, snapshot);
    const history = await readFIMHistory(outputDir);

    expect(history[0].filteredTopEigenvalueShares).toEqual([0.7, 0.3]);
  });

  it('round-trips a snapshot that has both topEigenvalueShares and filteredTopEigenvalueShares', async () => {
    const outputDir = await makeOutputDir();
    const snapshot: FIMSnapshot = {
      ...makeSnapshot('import-approximation'),
      topEigenvalueShares: [0.6, 0.25, 0.15],
      filteredTopEigenvalueShares: [0.7, 0.3],
    };

    await appendFIMSnapshot(outputDir, snapshot);
    const [retrieved] = await readFIMHistory(outputDir);

    expect(retrieved.topEigenvalueShares).toEqual([0.6, 0.25, 0.15]);
    expect(retrieved.filteredTopEigenvalueShares).toEqual([0.7, 0.3]);
    expect(retrieved.filteredTopEigenvalueShares).not.toEqual(retrieved.topEigenvalueShares);
  });
});
