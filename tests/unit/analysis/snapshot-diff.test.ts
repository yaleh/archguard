import { describe, it, expect } from 'vitest';
import { diffSnapshots } from '@/analysis/snapshot-diff.js';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    schemaVersion: 1,
    commitSha: 'abc123',
    branch: 'main',
    timestamp: '2024-01-01T00:00:00Z',
    archguardVersion: '1.0.0',
    metricVector: {
      schemaVersion: 1,
      totalEntities: 100,
      totalRelations: 200,
      inferredRelationRatio: 0.1,
      sccCount: 3,
      relationTypeBreakdown: {},
      maxInDegree: 15,
      maxOutDegree: 10,
      maxPackageSize: 20,
      giniInDegree: 0.5,
      giniPackageSize: 0.3,
      packageCount: 5,
      entityCoverageRatio: 0.8,
    },
    ...overrides,
  };
}

describe('diffSnapshots', () => {
  it('test 1: identical snapshots → all deltas = 0, percentChange = 0', () => {
    const snap = makeSnapshot();
    const result = diffSnapshots(snap, snap);

    expect(result.schemaVersionMismatch).toBe(false);
    expect(result.warnings).toHaveLength(0);

    for (const entry of result.entries) {
      expect(entry.delta).toBe(0);
      expect(entry.percentChange).toBe(0);
    }
  });

  it('test 2: known changes: sccCount 3→1 and maxInDegree 15→12 produce correct MetricDiffEntry values', () => {
    const from = makeSnapshot({ commitSha: 'sha-from', timestamp: '2024-01-01T00:00:00Z' });
    const to = makeSnapshot({
      commitSha: 'sha-to',
      timestamp: '2024-02-01T00:00:00Z',
      metricVector: {
        ...from.metricVector,
        sccCount: 1,
        maxInDegree: 12,
      },
    });

    const result = diffSnapshots(from, to);

    expect(result.fromCommit).toBe('sha-from');
    expect(result.toCommit).toBe('sha-to');
    expect(result.fromTimestamp).toBe('2024-01-01T00:00:00Z');
    expect(result.toTimestamp).toBe('2024-02-01T00:00:00Z');

    const sccEntry = result.entries.find((e) => e.metric === 'sccCount');
    expect(sccEntry).toBeDefined();
    expect(sccEntry.from).toBe(3);
    expect(sccEntry.to).toBe(1);
    expect(sccEntry.delta).toBe(-2);
    expect(sccEntry.percentChange).toBeCloseTo(-66.7, 1);

    const inDegEntry = result.entries.find((e) => e.metric === 'maxInDegree');
    expect(inDegEntry).toBeDefined();
    expect(inDegEntry.from).toBe(15);
    expect(inDegEntry.to).toBe(12);
    expect(inDegEntry.delta).toBe(-3);
    expect(inDegEntry.percentChange).toBeCloseTo(-20, 1);
  });

  it('test 3: schema version mismatch → schemaVersionMismatch=true, warnings non-empty', () => {
    const from = makeSnapshot();
    const to = makeSnapshot({
      metricVector: {
        ...makeSnapshot().metricVector,
        schemaVersion: 2 as 1, // force mismatch for test
      },
    });

    const result = diffSnapshots(from, to);

    expect(result.schemaVersionMismatch).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('test 4: from value is 0 → percentChange = null (avoid division by zero)', () => {
    const from = makeSnapshot({
      metricVector: { ...makeSnapshot().metricVector, sccCount: 0 },
    });
    const to = makeSnapshot({
      metricVector: { ...makeSnapshot().metricVector, sccCount: 5 },
    });

    const result = diffSnapshots(from, to);

    const sccEntry = result.entries.find((e) => e.metric === 'sccCount');
    expect(sccEntry).toBeDefined();
    expect(sccEntry.delta).toBe(5);
    expect(sccEntry.percentChange).toBeNull();
  });

  it('test 5: optional field null in from but number in to → delta = null, entry still present', () => {
    const from = makeSnapshot({
      metricVector: { ...makeSnapshot().metricVector, entityCoverageRatio: null },
    });
    const to = makeSnapshot({
      metricVector: { ...makeSnapshot().metricVector, entityCoverageRatio: 0.75 },
    });

    const result = diffSnapshots(from, to);

    const coverageEntry = result.entries.find((e) => e.metric === 'entityCoverageRatio');
    expect(coverageEntry).toBeDefined();
    expect(coverageEntry.from).toBeNull();
    expect(coverageEntry.to).toBe(0.75);
    expect(coverageEntry.delta).toBeNull();
    expect(coverageEntry.percentChange).toBeNull();
  });
});
