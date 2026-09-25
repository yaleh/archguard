/**
 * Unit tests for readHistoryEntries (metrics-history-reader).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { readHistoryEntries, UNKNOWN_SCOPE } from '@/analysis/metrics-history-reader.js';
import { MetricsHistoryWriter } from '@/cli/metrics-history-writer.js';

describe('readHistoryEntries', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mhr-test-'));
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  it('returns an empty array when the file does not exist', async () => {
    expect(await readHistoryEntries(dir)).toEqual([]);
  });

  it('reads valid JSONL entries', async () => {
    const file = path.join(dir, MetricsHistoryWriter.FILENAME);
    await fs.writeFile(
      file,
      [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', packages: [{ name: 'a', fanIn: 1 }] }),
        JSON.stringify({ timestamp: '2026-01-02T00:00:00Z', packages: [] }),
      ].join('\n') + '\n',
      'utf-8'
    );
    const entries = await readHistoryEntries(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].packages[0].name).toBe('a');
    expect(entries[1].timestamp).toBe('2026-01-02T00:00:00Z');
  });

  it('skips malformed lines', async () => {
    const file = path.join(dir, MetricsHistoryWriter.FILENAME);
    await fs.writeFile(
      file,
      [
        '{invalid json',
        JSON.stringify({ timestamp: '2026-01-03T00:00:00Z', packages: [] }),
        '',
        '{"timestamp":"2026-01-04T00:00:00Z","packages":[]}',
      ].join('\n'),
      'utf-8'
    );
    const entries = await readHistoryEntries(dir);
    expect(entries).toHaveLength(2);
  });

  it('ignores blank lines', async () => {
    const file = path.join(dir, MetricsHistoryWriter.FILENAME);
    await fs.writeFile(
      file,
      '\n\n' + JSON.stringify({ timestamp: '2026-01-05T00:00:00Z', packages: [] }) + '\n\n',
      'utf-8'
    );
    const entries = await readHistoryEntries(dir);
    expect(entries).toHaveLength(1);
  });

  it('handles an empty file', async () => {
    const file = path.join(dir, MetricsHistoryWriter.FILENAME);
    await fs.writeFile(file, '', 'utf-8');
    expect(await readHistoryEntries(dir)).toEqual([]);
  });

  describe('scope filtering', () => {
    async function seed(): Promise<void> {
      const file = path.join(dir, MetricsHistoryWriter.FILENAME);
      await fs.writeFile(
        file,
        [
          // legacy entry: no scopeKey
          JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', packages: [{ name: 'a' }] }),
          JSON.stringify({ timestamp: '2026-01-02T00:00:00Z', scopeKey: 's1', packages: [] }),
          JSON.stringify({ timestamp: '2026-01-03T00:00:00Z', scopeKey: 's2', packages: [] }),
          JSON.stringify({ timestamp: '2026-01-04T00:00:00Z', scopeKey: 's1', packages: [] }),
        ].join('\n') + '\n',
        'utf-8'
      );
    }

    it('still reads legacy entries without scopeKey when no scope filter is given', async () => {
      await seed();
      const entries = await readHistoryEntries(dir);
      expect(entries).toHaveLength(4);
      expect(entries[0].scopeKey).toBeUndefined();
    });

    it('returns only entries of the requested scope', async () => {
      await seed();
      const entries = await readHistoryEntries(dir, { scope: 's1' });
      expect(entries.map((e) => e.timestamp)).toEqual([
        '2026-01-02T00:00:00Z',
        '2026-01-04T00:00:00Z',
      ]);
    });

    it('groups legacy entries (no scopeKey) under unknown when filtering', async () => {
      await seed();
      const entries = await readHistoryEntries(dir, { scope: UNKNOWN_SCOPE });
      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('returns an empty array for a scope with no entries', async () => {
      await seed();
      expect(await readHistoryEntries(dir, { scope: 'nope' })).toEqual([]);
    });
  });
});
