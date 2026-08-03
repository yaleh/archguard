/**
 * Unit tests for readHistoryEntries (metrics-history-reader).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { readHistoryEntries } from '@/analysis/metrics-history-reader.js';
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
    await fs.writeFile(file, '\n\n' + JSON.stringify({ timestamp: '2026-01-05T00:00:00Z', packages: [] }) + '\n\n', 'utf-8');
    const entries = await readHistoryEntries(dir);
    expect(entries).toHaveLength(1);
  });

  it('handles an empty file', async () => {
    const file = path.join(dir, MetricsHistoryWriter.FILENAME);
    await fs.writeFile(file, '', 'utf-8');
    expect(await readHistoryEntries(dir)).toEqual([]);
  });
});
