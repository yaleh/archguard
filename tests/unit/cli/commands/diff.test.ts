/**
 * Unit tests for the `archguard diff` command.
 * Mocks loadSnapshots and diffSnapshots to avoid filesystem access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';
import type { MetricDiffResult } from '@/analysis/snapshot-diff.js';

// Mock snapshot-store before importing the command
vi.mock('@/analysis/snapshot-store.js', () => ({
  loadSnapshots: vi.fn(),
}));

// Mock snapshot-diff
vi.mock('@/analysis/snapshot-diff.js', () => ({
  diffSnapshots: vi.fn(),
}));

import { createDiffCommand } from '@/cli/commands/diff.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { diffSnapshots } from '@/analysis/snapshot-diff.js';

// -- Helpers --

function makeSnapshot(
  commitSha: string,
  timestamp: string,
  schemaVersion: number = 1,
): MetricSnapshot {
  return {
    schemaVersion,
    commitSha,
    branch: 'main',
    timestamp,
    archguardVersion: '0.1.0',
    metricVector: {
      schemaVersion: 1,
      totalEntities: 10,
      totalRelations: 5,
      inferredRelationRatio: 0.2,
      sccCount: 3,
      relationTypeBreakdown: {},
      maxInDegree: 15,
      maxOutDegree: 8,
      maxPackageSize: 20,
      giniInDegree: 0.4,
      giniPackageSize: 0.3,
      packageCount: 4,
    },
  };
}

function makeDiffResult(overrides: Partial<MetricDiffResult> = {}): MetricDiffResult {
  return {
    fromCommit: 'abc1234def',
    toCommit: 'xyz5678uvw',
    fromTimestamp: '2024-01-01T00:00:00.000Z',
    toTimestamp: '2024-01-02T00:00:00.000Z',
    schemaVersionMismatch: false,
    warnings: [],
    entries: [
      { metric: 'sccCount', from: 3, to: 1, delta: -2, percentChange: -66.7 },
      { metric: 'maxInDegree', from: 15, to: 12, delta: -3, percentChange: -20.0 },
    ],
    ...overrides,
  };
}

// -- Tests --

describe('createDiffCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('prints diff table when two snapshots are available', async () => {
    const snapshots = [
      makeSnapshot('xyz5678uvw', '2024-01-02T00:00:00.000Z'),
      makeSnapshot('abc1234def', '2024-01-01T00:00:00.000Z'),
    ];
    vi.mocked(loadSnapshots).mockResolvedValue(snapshots);
    vi.mocked(diffSnapshots).mockReturnValue(makeDiffResult());

    const cmd = createDiffCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    // Verify loadSnapshots was called
    expect(loadSnapshots).toHaveBeenCalledWith('.archguard');

    // Verify diffSnapshots was called with from=older, to=newer
    expect(diffSnapshots).toHaveBeenCalledWith(snapshots[1], snapshots[0]);

    // Verify output contains table header and metric rows
    const allOutput = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allOutput).toContain('Metric');
    expect(allOutput).toContain('From');
    expect(allOutput).toContain('To');
    expect(allOutput).toContain('Delta');
    expect(allOutput).toContain('sccCount');
    expect(allOutput).toContain('maxInDegree');
  });

  it('prints error message when fewer than 2 snapshots exist', async () => {
    vi.mocked(loadSnapshots).mockResolvedValue([makeSnapshot('abc1234def', '2024-01-01T00:00:00.000Z')]);
    vi.mocked(diffSnapshots).mockReturnValue(makeDiffResult());

    const cmd = createDiffCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    expect(diffSnapshots).not.toHaveBeenCalled();

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const logOutput = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const combinedOutput = errorOutput + logOutput;
    expect(combinedOutput).toContain('Need at least 2 snapshots');
  });

  it('resolves --from snapshot by SHA prefix', async () => {
    const snapshots = [
      makeSnapshot('xyz5678uvw', '2024-01-03T00:00:00.000Z'),
      makeSnapshot('abc1234def', '2024-01-02T00:00:00.000Z'),
      makeSnapshot('old0000aaa', '2024-01-01T00:00:00.000Z'),
    ];
    vi.mocked(loadSnapshots).mockResolvedValue(snapshots);
    vi.mocked(diffSnapshots).mockReturnValue(makeDiffResult());

    const cmd = createDiffCommand();
    // --from abc123 should match 'abc1234def'
    await cmd.parseAsync(['--output-dir', '.archguard', '--from', 'abc123'], { from: 'node' });

    // from = snapshot matching 'abc123' prefix = snapshots[1]
    // to = most recent = snapshots[0]
    expect(diffSnapshots).toHaveBeenCalledWith(snapshots[1], snapshots[0]);
  });

  it('prints warning when schema version mismatch is detected', async () => {
    const snapshots = [
      makeSnapshot('xyz5678uvw', '2024-01-02T00:00:00.000Z', 2),
      makeSnapshot('abc1234def', '2024-01-01T00:00:00.000Z', 1),
    ];
    vi.mocked(loadSnapshots).mockResolvedValue(snapshots);
    vi.mocked(diffSnapshots).mockReturnValue(
      makeDiffResult({
        schemaVersionMismatch: true,
        warnings: ['Schema version mismatch: from=1, to=2. Comparison may be unreliable.'],
      }),
    );

    const cmd = createDiffCommand();
    await cmd.parseAsync(['--output-dir', '.archguard'], { from: 'node' });

    const allOutput = [
      ...consoleLogSpy.mock.calls.map((c) => c.join(' ')),
      ...consoleErrorSpy.mock.calls.map((c) => c.join(' ')),
    ].join('\n');

    expect(allOutput).toContain('Schema version mismatch');
  });
});
