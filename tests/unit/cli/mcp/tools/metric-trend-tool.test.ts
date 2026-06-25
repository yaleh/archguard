/**
 * TDD tests for archguard_get_metric_trend MCP tool (TASK-21).
 *
 * Tests:
 * - Returns empty array when no history file exists
 * - Returns time series (array length = number of snapshots) when history file exists
 * - Returns only that package's history when a package name is specified
 * - Returned data contains timestamp and metric values
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMetricTrendTools } from '@/cli/mcp/tools/metric-trend-tools.js';
import type { MetricsHistoryEntry } from '@/cli/metrics-history-writer.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(
  packages: Array<{
    name: string;
    fanIn: number;
    fanOut: number;
    cycleCount: number;
    entityCount: number;
  }>,
  timestamp?: string
): MetricsHistoryEntry {
  return {
    timestamp: timestamp ?? new Date().toISOString(),
    packages,
  };
}

async function writeHistory(projectRoot: string, entries: MetricsHistoryEntry[]): Promise<void> {
  // MCP tool resolves outputDir as <projectRoot>/.archguard
  const archguardDir = path.join(projectRoot, '.archguard');
  await fs.ensureDir(archguardDir);
  const filePath = path.join(archguardDir, 'metrics-history.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(filePath, lines, 'utf-8');
}

function collectTools(server: McpServer, defaultRoot: string): Map<string, Function> {
  const tools = new Map<string, Function>();
  const _original = server.tool.bind(server);
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return server;
  });
  registerMetricTrendTools(server, defaultRoot);
  return tools;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

import { vi } from 'vitest';

describe('archguard_get_metric_trend', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-trend-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('returns empty array when no history file exists', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    const handler = tools.get('archguard_get_metric_trend');

    const result = await handler({ projectRoot: tmpDir });
    const text = result.content[0].text as string;
    const payload = JSON.parse(text);

    expect(Array.isArray(payload.snapshots)).toBe(true);
    expect(payload.snapshots).toHaveLength(0);
  });

  it('returns time series with length equal to number of snapshots', async () => {
    const entry1 = makeEntry(
      [{ name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 3 }],
      '2026-01-01T00:00:00Z'
    );
    const entry2 = makeEntry(
      [{ name: 'pkgA', fanIn: 2, fanOut: 3, cycleCount: 0, entityCount: 4 }],
      '2026-01-02T00:00:00Z'
    );
    await writeHistory(tmpDir, [entry1, entry2]);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    const handler = tools.get('archguard_get_metric_trend');

    const result = await handler({ projectRoot: tmpDir });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.snapshots).toHaveLength(2);
  });

  it('returned data contains timestamp and metric values', async () => {
    const entry = makeEntry(
      [{ name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 3 }],
      '2026-01-01T00:00:00Z'
    );
    await writeHistory(tmpDir, [entry]);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    const handler = tools.get('archguard_get_metric_trend');

    const result = await handler({ projectRoot: tmpDir });
    const payload = JSON.parse(result.content[0].text);

    const snapshot = payload.snapshots[0];
    expect(snapshot).toHaveProperty('timestamp');
    expect(snapshot).toHaveProperty('packages');
    expect(Array.isArray(snapshot.packages)).toBe(true);

    const pkg = snapshot.packages[0];
    expect(pkg).toHaveProperty('name');
    expect(pkg).toHaveProperty('fanIn');
    expect(pkg).toHaveProperty('fanOut');
    expect(pkg).toHaveProperty('cycleCount');
  });

  it('returns only the specified package history when packageName is provided', async () => {
    const entry1 = makeEntry(
      [
        { name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 3 },
        { name: 'pkgB', fanIn: 5, fanOut: 1, cycleCount: 1, entityCount: 8 },
      ],
      '2026-01-01T00:00:00Z'
    );
    const entry2 = makeEntry(
      [
        { name: 'pkgA', fanIn: 2, fanOut: 3, cycleCount: 0, entityCount: 4 },
        { name: 'pkgB', fanIn: 6, fanOut: 2, cycleCount: 1, entityCount: 9 },
      ],
      '2026-01-02T00:00:00Z'
    );
    await writeHistory(tmpDir, [entry1, entry2]);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    const handler = tools.get('archguard_get_metric_trend');

    const result = await handler({ projectRoot: tmpDir, packageName: 'pkgA' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.snapshots).toHaveLength(2);
    for (const snapshot of payload.snapshots) {
      expect(snapshot.packages).toHaveLength(1);
      expect(snapshot.packages[0].name).toBe('pkgA');
    }
  });

  it('excludes snapshots where specified package does not appear', async () => {
    const entry1 = makeEntry(
      [{ name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 3 }],
      '2026-01-01T00:00:00Z'
    );
    const entry2 = makeEntry(
      [{ name: 'pkgB', fanIn: 5, fanOut: 1, cycleCount: 0, entityCount: 8 }],
      '2026-01-02T00:00:00Z'
    );
    await writeHistory(tmpDir, [entry1, entry2]);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    const handler = tools.get('archguard_get_metric_trend');

    const result = await handler({ projectRoot: tmpDir, packageName: 'pkgA' });
    const payload = JSON.parse(result.content[0].text);

    // Only entry1 has pkgA; entry2 does not, so it's filtered out
    expect(payload.snapshots).toHaveLength(1);
    expect(payload.snapshots[0].packages[0].name).toBe('pkgA');
  });

  it('returns empty array when packageName does not match any package in any snapshot', async () => {
    const entry = makeEntry([{ name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 3 }]);
    await writeHistory(tmpDir, [entry]);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    const handler = tools.get('archguard_get_metric_trend');

    const result = await handler({ projectRoot: tmpDir, packageName: 'nonexistent' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.snapshots).toHaveLength(0);
  });

  it('registers the archguard_get_metric_trend tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, tmpDir);
    expect(tools.has('archguard_get_metric_trend')).toBe(true);
  });
});
