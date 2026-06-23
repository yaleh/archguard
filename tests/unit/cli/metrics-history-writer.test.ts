/**
 * TDD tests for MetricsHistoryWriter (TASK-21).
 *
 * Tests:
 * - append() creates the file if it doesn't exist and writes the first line
 * - append() appends new lines to an existing file (no overwrite)
 * - Each line is valid JSON containing timestamp and packages array
 * - packages array each item contains name, fanIn, fanOut, cycleCount
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { MetricsHistoryWriter } from '@/cli/metrics-history-writer.js';
import type { PackageMetricsSnapshot } from '@/cli/metrics-history-writer.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePackageSnapshot(name: string): PackageMetricsSnapshot {
  return {
    name,
    fanIn: 2,
    fanOut: 3,
    cycleCount: 0,
    entityCount: 5,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MetricsHistoryWriter', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archguard-metrics-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates the file if it does not exist and writes the first JSONL line', async () => {
    const writer = new MetricsHistoryWriter();
    const packages = [makePackageSnapshot('pkgA'), makePackageSnapshot('pkgB')];

    await writer.append(packages, tmpDir);

    const filePath = path.join(tmpDir, 'metrics-history.jsonl');
    expect(await fs.pathExists(filePath)).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('appends new lines to an existing file without overwriting', async () => {
    const writer = new MetricsHistoryWriter();
    const packages = [makePackageSnapshot('pkgA')];

    // Write twice
    await writer.append(packages, tmpDir);
    await writer.append(packages, tmpDir);

    const filePath = path.join(tmpDir, 'metrics-history.jsonl');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('each line is valid JSON containing timestamp and packages array', async () => {
    const writer = new MetricsHistoryWriter();
    const packages = [makePackageSnapshot('pkgA')];

    await writer.append(packages, tmpDir);

    const filePath = path.join(tmpDir, 'metrics-history.jsonl');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty('timestamp');
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed).toHaveProperty('packages');
    expect(Array.isArray(parsed.packages)).toBe(true);
  });

  it('packages array each item contains name, fanIn, fanOut, cycleCount', async () => {
    const writer = new MetricsHistoryWriter();
    const packages = [
      { name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 4 },
      { name: 'pkgB', fanIn: 3, fanOut: 1, cycleCount: 1, entityCount: 7 },
    ];

    await writer.append(packages, tmpDir);

    const filePath = path.join(tmpDir, 'metrics-history.jsonl');
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content.trim().split('\n')[0]);

    expect(parsed.packages).toHaveLength(2);
    const pkgA = parsed.packages.find((p: PackageMetricsSnapshot) => p.name === 'pkgA');
    expect(pkgA).toBeDefined();
    expect(pkgA.fanIn).toBe(1);
    expect(pkgA.fanOut).toBe(2);
    expect(pkgA.cycleCount).toBe(0);
    expect(pkgA.entityCount).toBe(4);
  });

  it('preserves previously written lines when appending', async () => {
    const writer = new MetricsHistoryWriter();

    await writer.append([{ name: 'pkgA', fanIn: 1, fanOut: 2, cycleCount: 0, entityCount: 3 }], tmpDir);
    await writer.append([{ name: 'pkgB', fanIn: 5, fanOut: 1, cycleCount: 2, entityCount: 8 }], tmpDir);

    const filePath = path.join(tmpDir, 'metrics-history.jsonl');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);

    expect(first.packages[0].name).toBe('pkgA');
    expect(second.packages[0].name).toBe('pkgB');
  });

  it('writes the file to outputDir/metrics-history.jsonl', async () => {
    const writer = new MetricsHistoryWriter();
    await writer.append([makePackageSnapshot('pkg1')], tmpDir);

    const expectedPath = path.join(tmpDir, 'metrics-history.jsonl');
    expect(await fs.pathExists(expectedPath)).toBe(true);
  });
});
