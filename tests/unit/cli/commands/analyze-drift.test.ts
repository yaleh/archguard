/**
 * Unit tests for the analyze --drift-base / --drift-threshold CI/CD gate
 * (TASK-65 Phase C).
 *
 * Covers parseDriftOptions, determineDriftExitCode, and the runDriftCheck
 * no-baseline / invalid-commit branches.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/cli/analyze/run-analysis.js', () => ({
  runAnalysis: vi.fn(),
}));

import { createAnalyzeCommand, parseDriftOptions, runDriftCheck } from '@/cli/commands/analyze.js';
import { determineDriftExitCode } from '@/analysis/jl/drift-exit-code.js';
import { classifyDrift } from '@/analysis/jl/drift-calculator.js';
import { DRIFT_THRESHOLDS } from '@/analysis/jl/types.js';
import type { DriftReport, DriftSnapshot } from '@/analysis/jl/types.js';

function makeReport(drifts: Array<{ entityId: string; drift: number }>): DriftReport {
  return {
    fromSnapshot: { timestamp: 't1', commitSha: 'aaa' },
    toSnapshot: { timestamp: 't2', commitSha: 'bbb' },
    mode: 'direct',
    nUnion: 1,
    k: null,
    sharedEntityCount: drifts.length,
    addedEntities: [],
    removedEntities: [],
    drifts: drifts.map((d) => ({
      entityId: d.entityId,
      drift: d.drift,
      level: classifyDrift(d.drift),
      deltaFanIn: 0,
      deltaFanOut: 0,
      deltaCoverage: 0,
    })),
    summary: { critical: 0, significant: 0, moderate: 0, stable: 0 },
  };
}

const currentSnapshot: DriftSnapshot = {
  timestamp: 'now',
  entityIndex: ['A', 'B'],
  adjacencyRows: [
    [0, 0],
    [0, 0],
  ],
};

function makeHistorySnapshot(commitSha: string, timestamp: string) {
  return {
    timestamp,
    commitSha,
    entityCount: 2,
    mode: 'direct' as const,
    featureVersion: '1.0',
    k: null,
    dInt: 1,
    dIntNormalized: 0.5,
    varianceExplained: [1.0],
    epsilon: null,
  };
}

describe('analyze command drift flags', () => {
  it('registers --drift-base and --drift-threshold', () => {
    const command = createAnalyzeCommand();
    const base = command.options.find((o) => o.long === '--drift-base');
    const threshold = command.options.find((o) => o.long === '--drift-threshold');
    expect(base).toBeDefined();
    expect(threshold).toBeDefined();
  });
});

describe('parseDriftOptions', () => {
  it('without flags → base undefined, threshold defaults to 3.0', () => {
    const opts = parseDriftOptions({});
    expect(opts.base).toBeUndefined();
    expect(opts.threshold).toBe(DRIFT_THRESHOLDS.critical);
  });

  it('with flags → base and parsed numeric threshold', () => {
    const opts = parseDriftOptions({ driftBase: 'abc123', driftThreshold: '1.5' });
    expect(opts.base).toBe('abc123');
    expect(opts.threshold).toBe(1.5);
  });

  it('unparseable threshold falls back to the default', () => {
    expect(parseDriftOptions({ driftThreshold: 'nope' }).threshold).toBe(DRIFT_THRESHOLDS.critical);
  });
});

describe('determineDriftExitCode', () => {
  it('no entity breaches the threshold → 0', () => {
    const report = makeReport([{ entityId: 'A', drift: 1.0 }]);
    expect(determineDriftExitCode(report, 3.0)).toBe(0);
  });

  it('one critical breach → 1', () => {
    const report = makeReport([{ entityId: 'A', drift: 4.0 }]);
    expect(determineDriftExitCode(report, 3.0)).toBe(1);
  });

  it('significant drift at a 1.5 threshold → 1', () => {
    const report = makeReport([{ entityId: 'A', drift: 1.5 }]);
    expect(determineDriftExitCode(report, 1.5)).toBe(1);
  });

  it('no baseline (null report) → 0', () => {
    expect(determineDriftExitCode(null, 3.0)).toBe(0);
  });

  it('invalid commit status → 2', () => {
    expect(determineDriftExitCode(null, 3.0, 'invalid-commit')).toBe(2);
  });
});

describe('runDriftCheck', () => {
  it('no history → exit 0 with "no baseline available"', async () => {
    const result = await runDriftCheck(
      '/tmp/proj/.archguard',
      { base: 'abc', threshold: 3.0 },
      currentSnapshot,
      { readHistory: async () => null, root: '/tmp/proj' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain('no baseline available');
  });

  it('empty history → exit 0 with "no baseline available"', async () => {
    const result = await runDriftCheck(
      '/tmp/proj/.archguard',
      { base: 'abc', threshold: 3.0 },
      currentSnapshot,
      {
        readHistory: async () => ({
          schemaVersion: 1,
          language: 'typescript',
          snapshots: [],
        }),
        root: '/tmp/proj',
      }
    );
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain('no baseline available');
  });

  it('invalid drift-base commit → exit 2', async () => {
    const history = {
      schemaVersion: 1,
      language: 'typescript',
      snapshots: [makeHistorySnapshot('aaa', '2026-01-01T00:00:00Z')],
    };
    const result = await runDriftCheck(
      '/tmp/proj/.archguard',
      { base: 'deadbeef', threshold: 3.0 },
      currentSnapshot,
      { readHistory: async () => history, root: '/tmp/proj' }
    );
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('invalid drift-base');
  });
});
