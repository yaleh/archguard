/**
 * Integration tests for archguard_get_metric_trend MCP tool.
 *
 * Uses InMemoryTransport + createMcpServer pattern with tmp fixture dirs.
 */
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/cli/mcp/mcp-server.js';
import type { MetricsHistoryEntry, PackageMetricsSnapshot } from '@/cli/metrics-history-writer.js';

function makeSnapshot(name: string, overrides?: Partial<PackageMetricsSnapshot>): PackageMetricsSnapshot {
  return { name, fanIn: 2, fanOut: 3, cycleCount: 0, entityCount: 10, ...overrides };
}

function makeEntry(timestamp: string, packages: PackageMetricsSnapshot[]): MetricsHistoryEntry {
  return { timestamp, packages };
}

describe('archguard_get_metric_trend — integration', () => {
  let tmpRoot: string;
  let archguardDir: string;
  let client: Client;

  beforeAll(async () => {
    tmpRoot = path.join(os.tmpdir(), `archguard-metric-trend-test-${Math.floor(Math.random() * 1e9)}`);
    archguardDir = path.join(tmpRoot, '.archguard');
    await fs.mkdirp(archguardDir);

    const entry1 = makeEntry('2026-01-01T00:00:00.000Z', [
      makeSnapshot('src/cli', { fanIn: 1, fanOut: 2 }),
      makeSnapshot('src/parser', { fanIn: 3, fanOut: 1 }),
    ]);
    const entry2 = makeEntry('2026-01-02T00:00:00.000Z', [
      makeSnapshot('src/cli', { fanIn: 2, fanOut: 3 }),
      makeSnapshot('src/parser', { fanIn: 4, fanOut: 1 }),
    ]);

    const jsonlPath = path.join(archguardDir, 'metrics-history.jsonl');
    await fs.writeFile(
      jsonlPath,
      [JSON.stringify(entry1), JSON.stringify(entry2)].join('\n') + '\n',
      'utf-8'
    );

    const server = createMcpServer(tmpRoot);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'metric-trend-test', version: '1.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await fs.remove(tmpRoot);
  });

  it('no JSONL file: returns empty snapshots array', async () => {
    const emptyRoot = path.join(os.tmpdir(), `archguard-metric-trend-empty-${Math.floor(Math.random() * 1e9)}`);
    await fs.mkdirp(path.join(emptyRoot, '.archguard'));

    try {
      const server2 = createMcpServer(emptyRoot);
      const [ct2, st2] = InMemoryTransport.createLinkedPair();
      const client2 = new Client({ name: 'metric-trend-empty', version: '1.0.0' });
      await Promise.all([server2.connect(st2), client2.connect(ct2)]);

      const result = await client2.callTool({
        name: 'archguard_get_metric_trend',
        arguments: { projectRoot: emptyRoot },
      });
      const text = result.content[0].text as string;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('snapshots');
      expect(parsed.snapshots).toHaveLength(0);
    } finally {
      await fs.remove(emptyRoot);
    }
  });

  it('2 entries: returns snapshots array of length 2', async () => {
    const result = await client.callTool({
      name: 'archguard_get_metric_trend',
      arguments: { projectRoot: tmpRoot },
    });
    const text = result.content[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed.snapshots).toHaveLength(2);
  });

  it('timestamps are preserved in insertion order', async () => {
    const result = await client.callTool({
      name: 'archguard_get_metric_trend',
      arguments: { projectRoot: tmpRoot },
    });
    const parsed = JSON.parse(result.content[0].text as string);
    const timestamps = parsed.snapshots.map((s: { timestamp: string }) => s.timestamp);
    expect(timestamps[0]).toBe('2026-01-01T00:00:00.000Z');
    expect(timestamps[1]).toBe('2026-01-02T00:00:00.000Z');
  });

  it('packageName filter: each snapshot only contains the specified package', async () => {
    const result = await client.callTool({
      name: 'archguard_get_metric_trend',
      arguments: { projectRoot: tmpRoot, packageName: 'src/cli' },
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.snapshots).toHaveLength(2);
    for (const snap of parsed.snapshots) {
      expect(snap.packages).toHaveLength(1);
      expect(snap.packages[0].name).toBe('src/cli');
    }
  });

  it('packageName filter (absent package): returns empty snapshots', async () => {
    const result = await client.callTool({
      name: 'archguard_get_metric_trend',
      arguments: { projectRoot: tmpRoot, packageName: 'src/nonexistent' },
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.snapshots).toHaveLength(0);
  });

  it('malformed JSONL line: valid lines are still parsed', async () => {
    const corruptRoot = path.join(os.tmpdir(), `archguard-metric-trend-corrupt-${Math.floor(Math.random() * 1e9)}`);
    const corruptArchDir = path.join(corruptRoot, '.archguard');
    await fs.mkdirp(corruptArchDir);

    const goodEntry = makeEntry('2026-02-01T00:00:00.000Z', [makeSnapshot('src/cli')]);
    const jsonlPath = path.join(corruptArchDir, 'metrics-history.jsonl');
    await fs.writeFile(
      jsonlPath,
      [JSON.stringify(goodEntry), 'NOT_VALID_JSON', JSON.stringify(goodEntry)].join('\n') + '\n',
      'utf-8'
    );

    try {
      const server3 = createMcpServer(corruptRoot);
      const [ct3, st3] = InMemoryTransport.createLinkedPair();
      const client3 = new Client({ name: 'metric-trend-corrupt', version: '1.0.0' });
      await Promise.all([server3.connect(st3), client3.connect(ct3)]);

      const result = await client3.callTool({
        name: 'archguard_get_metric_trend',
        arguments: { projectRoot: corruptRoot },
      });
      const parsed = JSON.parse(result.content[0].text as string);
      // 2 valid lines, 1 corrupt line skipped
      expect(parsed.snapshots).toHaveLength(2);
    } finally {
      await fs.remove(corruptRoot);
    }
  });
});
