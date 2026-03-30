import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  saveSnapshot,
  loadSnapshots,
  pruneSnapshots,
  type MetricSnapshot,
} from '@/analysis/snapshot-store';
import type { MetricVector } from '@/types/metric-vector';

const makeVector = (): MetricVector => ({ schemaVersion: 1 });

const makeSnapshot = (overrides: Partial<MetricSnapshot> = {}): MetricSnapshot => ({
  schemaVersion: 1,
  commitSha: 'abc1234',
  branch: 'main',
  timestamp: new Date().toISOString(),
  archguardVersion: '1.0.0',
  metricVector: makeVector(),
  ...overrides,
});

describe('snapshot-store', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `archguard-snapshot-test-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('saveSnapshot', () => {
    it('creates file at correct path using commitSha and timestamp', async () => {
      const ts = '2024-01-15T12:00:00.000Z';
      const snapshot = makeSnapshot({ commitSha: 'deadbeef', timestamp: ts });

      await saveSnapshot(tmpDir, snapshot);

      const snapshotsDir = path.join(tmpDir, 'snapshots');
      const files = await fs.readdir(snapshotsDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^deadbeef-/);
      expect(files[0]).toMatch(/\.json$/);
    });

    it('creates file with unknown- prefix when commitSha is null', async () => {
      const ts = '2024-01-15T12:00:00.000Z';
      const snapshot = makeSnapshot({ commitSha: null, timestamp: ts });

      await saveSnapshot(tmpDir, snapshot);

      const snapshotsDir = path.join(tmpDir, 'snapshots');
      const files = await fs.readdir(snapshotsDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^unknown-/);
    });

    it('persists snapshot content correctly', async () => {
      const snapshot = makeSnapshot({ commitSha: 'cafe', branch: 'feat/test' });

      await saveSnapshot(tmpDir, snapshot);

      const snapshotsDir = path.join(tmpDir, 'snapshots');
      const files = await fs.readdir(snapshotsDir);
      const content = await fs.readJson(path.join(snapshotsDir, files[0]));
      expect(content.branch).toBe('feat/test');
      expect(content.commitSha).toBe('cafe');
    });

    it('creates the snapshots directory if it does not exist', async () => {
      const freshDir = path.join(tmpDir, 'fresh');
      const snapshot = makeSnapshot();

      await saveSnapshot(freshDir, snapshot);

      const snapshotsDir = path.join(freshDir, 'snapshots');
      expect(await fs.pathExists(snapshotsDir)).toBe(true);
    });
  });

  describe('loadSnapshots', () => {
    it('returns snapshots sorted by timestamp DESC (newest first)', async () => {
      const s1 = makeSnapshot({ commitSha: 'aaa', timestamp: '2024-01-10T00:00:00.000Z' });
      const s2 = makeSnapshot({ commitSha: 'bbb', timestamp: '2024-01-20T00:00:00.000Z' });
      const s3 = makeSnapshot({ commitSha: 'ccc', timestamp: '2024-01-15T00:00:00.000Z' });

      await saveSnapshot(tmpDir, s1);
      await saveSnapshot(tmpDir, s2);
      await saveSnapshot(tmpDir, s3);

      const loaded = await loadSnapshots(tmpDir);
      expect(loaded).toHaveLength(3);
      expect(loaded[0].commitSha).toBe('bbb'); // newest
      expect(loaded[1].commitSha).toBe('ccc');
      expect(loaded[2].commitSha).toBe('aaa'); // oldest
    });

    it('returns empty array when snapshots dir is empty', async () => {
      await fs.ensureDir(path.join(tmpDir, 'snapshots'));

      const loaded = await loadSnapshots(tmpDir);
      expect(loaded).toEqual([]);
    });

    it('returns empty array when snapshots dir does not exist', async () => {
      const nonExistent = path.join(tmpDir, 'no-such-dir');

      const loaded = await loadSnapshots(nonExistent);
      expect(loaded).toEqual([]);
    });

    it('ignores non-json files in snapshots dir', async () => {
      const snapshotsDir = path.join(tmpDir, 'snapshots');
      await fs.ensureDir(snapshotsDir);
      await fs.writeFile(path.join(snapshotsDir, 'README.txt'), 'ignore me');

      const snapshot = makeSnapshot({ commitSha: 'abc' });
      await saveSnapshot(tmpDir, snapshot);

      const loaded = await loadSnapshots(tmpDir);
      expect(loaded).toHaveLength(1);
    });
  });

  describe('pruneSnapshots', () => {
    it('keeps only maxCount most recent snapshots and returns deleted count', async () => {
      const snapshots = [
        makeSnapshot({ commitSha: 'aaa', timestamp: '2024-01-10T00:00:00.000Z' }),
        makeSnapshot({ commitSha: 'bbb', timestamp: '2024-01-20T00:00:00.000Z' }),
        makeSnapshot({ commitSha: 'ccc', timestamp: '2024-01-15T00:00:00.000Z' }),
        makeSnapshot({ commitSha: 'ddd', timestamp: '2024-01-25T00:00:00.000Z' }),
        makeSnapshot({ commitSha: 'eee', timestamp: '2024-01-05T00:00:00.000Z' }),
      ];

      for (const s of snapshots) {
        await saveSnapshot(tmpDir, s);
      }

      const deleted = await pruneSnapshots(tmpDir, 3);

      expect(deleted).toBe(2);

      const remaining = await loadSnapshots(tmpDir);
      expect(remaining).toHaveLength(3);
      // Newest 3 should remain
      const shas = remaining.map((s) => s.commitSha);
      expect(shas).toContain('ddd'); // 2024-01-25
      expect(shas).toContain('bbb'); // 2024-01-20
      expect(shas).toContain('ccc'); // 2024-01-15
    });

    it('returns 0 when snapshot count is within maxCount', async () => {
      await saveSnapshot(tmpDir, makeSnapshot({ commitSha: 'only' }));

      const deleted = await pruneSnapshots(tmpDir, 5);
      expect(deleted).toBe(0);
    });

    it('returns 0 for empty snapshots dir', async () => {
      const deleted = await pruneSnapshots(tmpDir, 10);
      expect(deleted).toBe(0);
    });
  });
});
