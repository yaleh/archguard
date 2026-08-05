/**
 * Unit tests for history-writer.ts (TASK-64 Phase D).
 */

import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { appendSnapshot, readHistoryFile, HISTORY_FILENAME } from '@/analysis/jl/history-writer.js';
import { HISTORY_SCHEMA_VERSION, MAX_SNAPSHOTS } from '@/analysis/jl/types.js';
import type { IntrinsicDimensionResult } from '@/analysis/jl/types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jl-history-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeSnapshot(
  dInt: number,
  timestamp: string,
  overrides: Partial<IntrinsicDimensionResult> = {}
): IntrinsicDimensionResult {
  return {
    timestamp,
    entityCount: 100,
    mode: 'direct',
    featureVersion: '1.0',
    k: null,
    dInt,
    dIntNormalized: dInt / 100,
    varianceExplained: [1.0],
    epsilon: null,
    ...overrides,
  };
}

describe('appendSnapshot', () => {
  it('first write creates the file with schemaVersion=1', async () => {
    const dir = makeTempDir();
    const result = await appendSnapshot(dir, 'typescript', makeSnapshot(5, '2026-01-01T00:00:00Z'));

    expect(result.ok).toBe(true);
    expect(result.previous).toBeNull();

    const history = await readHistoryFile(dir);
    expect(history).not.toBeNull();
    expect(history.schemaVersion).toBe(HISTORY_SCHEMA_VERSION);
    expect(history.language).toBe('typescript');
    expect(history.snapshots).toHaveLength(1);
    expect(await fs.pathExists(path.join(dir, HISTORY_FILENAME))).toBe(true);
  });

  it('appends chronologically', async () => {
    const dir = makeTempDir();
    await appendSnapshot(dir, 'typescript', makeSnapshot(5, '2026-01-02T00:00:00Z'));
    // Older timestamp appended second — must still be sorted chronologically.
    const result = await appendSnapshot(dir, 'typescript', makeSnapshot(3, '2026-01-01T00:00:00Z'));

    expect(result.previous?.dInt).toBe(5);

    const history = await readHistoryFile(dir);
    expect(history.snapshots.map((s) => s.timestamp)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-02T00:00:00Z',
    ]);
  });

  it('returns the previous latest snapshot', async () => {
    const dir = makeTempDir();
    await appendSnapshot(dir, 'typescript', makeSnapshot(2, '2026-01-01T00:00:00Z'));
    const result = await appendSnapshot(dir, 'typescript', makeSnapshot(7, '2026-01-02T00:00:00Z'));

    expect(result.ok).toBe(true);
    expect(result.previous?.dInt).toBe(2);
    expect(result.previous?.timestamp).toBe('2026-01-01T00:00:00Z');
  });

  it('evicts oldest snapshots beyond MAX_SNAPSHOTS', async () => {
    const dir = makeTempDir();
    const n = MAX_SNAPSHOTS + 10;
    for (let i = 0; i < n; i++) {
      const day = String(i + 1).padStart(3, '0');
      await appendSnapshot(dir, 'typescript', makeSnapshot(i, `2026-01-${day}T00:00:00Z`));
    }

    const history = await readHistoryFile(dir);
    expect(history.snapshots).toHaveLength(MAX_SNAPSHOTS);
    // The newest snapshot survives.
    expect(history.snapshots[history.snapshots.length - 1].dInt).toBe(n - 1);
    // The oldest 10 were evicted.
    expect(history.snapshots[0].dInt).toBe(10);
  });

  it('is forward-compatible: refuses to write over a newer schemaVersion', async () => {
    const dir = makeTempDir();
    await fs.ensureDir(dir);
    const filePath = path.join(dir, HISTORY_FILENAME);
    await fs.writeJson(filePath, {
      schemaVersion: 99,
      language: 'typescript',
      snapshots: [{ future: 'data' }],
    });

    const result = await appendSnapshot(dir, 'typescript', makeSnapshot(5, '2026-01-01T00:00:00Z'));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('schemaVersion');

    // File left untouched.
    const raw = await fs.readJson(filePath);
    expect(raw.schemaVersion).toBe(99);
    expect(raw.snapshots).toEqual([{ future: 'data' }]);
  });

  it('a featureVersion change does not clear old snapshots', async () => {
    const dir = makeTempDir();
    await appendSnapshot(
      dir,
      'typescript',
      makeSnapshot(5, '2026-01-01T00:00:00Z', { featureVersion: '1.0' })
    );
    await appendSnapshot(
      dir,
      'typescript',
      makeSnapshot(6, '2026-01-02T00:00:00Z', { featureVersion: '2.0' })
    );

    const history = await readHistoryFile(dir);
    expect(history.snapshots).toHaveLength(2);
    expect(history.snapshots[0].featureVersion).toBe('1.0');
    expect(history.snapshots[1].featureVersion).toBe('2.0');
  });
});

describe('readHistoryFile', () => {
  it('returns null when the file is missing', async () => {
    const dir = makeTempDir();
    expect(await readHistoryFile(dir)).toBeNull();
  });

  it('returns null for an incompatible schemaVersion', async () => {
    const dir = makeTempDir();
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, HISTORY_FILENAME), {
      schemaVersion: 2,
      language: 'go',
      snapshots: [],
    });
    expect(await readHistoryFile(dir)).toBeNull();
  });
});
