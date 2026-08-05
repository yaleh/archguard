/**
 * Unit tests for drift-calculator.ts (TASK-65 Phase B).
 *
 * Threshold values (0.5 / 1.5 / 3.0) are asserted against the shared
 * DRIFT_THRESHOLDS constants — never hard-coded inline.
 */

import { describe, it, expect } from 'vitest';
import { DriftCalculator, classifyDrift } from '@/analysis/jl/drift-calculator.js';
import { computeK } from '@/analysis/jl/jl-projector.js';
import { DRIFT_THRESHOLDS, DEFAULT_JL_CONFIG } from '@/analysis/jl/types.js';
import type { DriftSnapshot } from '@/analysis/jl/types.js';

function makeSnapshot(
  entityIndex: string[],
  adjacencyRows: number[][],
  timestamp: string,
  commitSha?: string
): DriftSnapshot {
  return { timestamp, commitSha, entityIndex, adjacencyRows };
}

function zeroMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => Array<number>(n).fill(0));
}

function makeNSnapshot(n: number, timestamp: string, commitSha?: string): DriftSnapshot {
  return {
    timestamp,
    commitSha,
    entityIndex: Array.from({ length: n }, (_, i) => `E${i}`),
    adjacencyRows: zeroMatrix(n),
  };
}

describe('classifyDrift', () => {
  it('uses shared threshold constants for the boundary values', () => {
    expect(classifyDrift(DRIFT_THRESHOLDS.moderate - 0.001)).toBe('stable');
    expect(classifyDrift(DRIFT_THRESHOLDS.moderate)).toBe('moderate');
    expect(classifyDrift(DRIFT_THRESHOLDS.significant - 0.001)).toBe('moderate');
    expect(classifyDrift(DRIFT_THRESHOLDS.significant)).toBe('significant');
    expect(classifyDrift(DRIFT_THRESHOLDS.critical - 0.001)).toBe('significant');
    expect(classifyDrift(DRIFT_THRESHOLDS.critical)).toBe('critical');
    expect(classifyDrift(DRIFT_THRESHOLDS.critical + 1)).toBe('critical');
  });
});

describe('DriftCalculator.compare', () => {
  it('identical snapshots → every shared drift is 0', () => {
    const from = makeSnapshot(
      ['A', 'B', 'C'],
      [
        [0, 1, 0],
        [0, 0, 1],
        [0, 0, 0],
      ],
      't1'
    );
    const to = makeSnapshot(
      ['A', 'B', 'C'],
      [
        [0, 1, 0],
        [0, 0, 1],
        [0, 0, 0],
      ],
      't2'
    );
    const report = DriftCalculator.compare(from, to);
    expect(report.drifts).toHaveLength(3);
    for (const d of report.drifts) {
      expect(d.drift).toBe(0);
      expect(d.level).toBe('stable');
    }
  });

  it('entity gaining 5 dependency edges → drift ≈ √5 ≈ 2.236', () => {
    const from = makeSnapshot(['A', 'B', 'C', 'D', 'E', 'F'], zeroMatrix(6), 't1');
    // A now depends on B, C, D, E, F (5 weight-1.0 edges).
    const toRows = zeroMatrix(6);
    toRows[0] = [0, 1, 1, 1, 1, 1];
    const to = makeSnapshot(['A', 'B', 'C', 'D', 'E', 'F'], toRows, 't2');

    const report = DriftCalculator.compare(from, to);
    const a = report.drifts.find((d) => d.entityId === 'A');
    expect(a).toBeDefined();
    expect(a.drift).toBeCloseTo(Math.sqrt(5), 3);
    // A's outgoing edges grew by 5.
    expect(a.deltaFanOut).toBe(5);
  });

  it('added/removed entities are excluded from drifts but reported', () => {
    const from = makeSnapshot(['A', 'B'], zeroMatrix(2), 't1');
    const to = makeSnapshot(['B', 'C'], zeroMatrix(2), 't2');
    const report = DriftCalculator.compare(from, to);
    expect(report.drifts.map((d) => d.entityId)).toEqual(['B']);
    expect(report.addedEntities).toEqual(['C']);
    expect(report.removedEntities).toEqual(['A']);
    expect(report.sharedEntityCount).toBe(1);
    expect(report.nUnion).toBe(3);
  });

  it('deltaFanIn/deltaFanOut auxiliary signals reflect column/row sum deltas', () => {
    // from: A→B, A→C
    const from = makeSnapshot(
      ['A', 'B', 'C'],
      [
        [0, 1, 1],
        [0, 0, 0],
        [0, 0, 0],
      ],
      't1'
    );
    // to: A→B, A→C, and B→A (A gains an incoming edge from B)
    const to = makeSnapshot(
      ['A', 'B', 'C'],
      [
        [0, 1, 1],
        [1, 0, 0],
        [0, 0, 0],
      ],
      't2'
    );
    const report = DriftCalculator.compare(from, to);
    const a = report.drifts.find((d) => d.entityId === 'A');
    // A's own row is unchanged → drift 0.
    expect(a.drift).toBe(0);
    // A gained an incoming edge → deltaFanIn +1; row sum unchanged → deltaFanOut 0.
    expect(a.deltaFanIn).toBe(1);
    expect(a.deltaFanOut).toBe(0);
  });

  it('drifts are sorted descending by drift', () => {
    const n = 5;
    const toRows = zeroMatrix(n);
    // entity i has drift = i+1.
    for (let i = 0; i < n; i++) toRows[i] = [i + 1, 0, 0, 0, 0];
    const from = makeNSnapshot(n, 't1');
    const to = makeSnapshot(['E0', 'E1', 'E2', 'E3', 'E4'], toRows, 't2');

    const report = DriftCalculator.compare(from, to);
    for (let i = 1; i < report.drifts.length; i++) {
      expect(report.drifts[i].drift).toBeLessThanOrEqual(report.drifts[i - 1].drift);
    }
    expect(report.drifts[0].entityId).toBe('E4'); // drift 5
  });

  it('uses DIRECT mode for N_union < 1000', () => {
    const from = makeNSnapshot(999, 't1');
    const to = makeNSnapshot(999, 't2');
    const report = DriftCalculator.compare(from, to);
    expect(report.mode).toBe('direct');
    expect(report.k).toBeNull();
    expect(report.nUnion).toBe(999);
  });

  it('uses JL mode for N_union ≥ 1000 with k = ⌈4·ln(N)/0.09⌉', () => {
    const from = makeNSnapshot(1000, 't1');
    const to = makeNSnapshot(1000, 't2');
    const report = DriftCalculator.compare(from, to);
    expect(report.mode).toBe('jl');
    expect(report.k).toBe(computeK(1000, DEFAULT_JL_CONFIG.epsilon));
    expect(report.k).toBe(308);
  });

  it('JL projection is deterministic for the same inputs', () => {
    const from = makeNSnapshot(1000, 't1');
    const to = makeNSnapshot(1000, 't2');
    const report1 = DriftCalculator.compare(from, to);
    const report2 = DriftCalculator.compare(from, to);
    expect(report1).toEqual(report2);
  });

  it('topK truncates and minLevel filters the returned drifts', () => {
    const n = 12;
    const toRows = zeroMatrix(n);
    // entity i has drift = i+1 (drift range 1..12).
    for (let i = 0; i < n; i++) toRows[i] = [i + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const from = makeNSnapshot(n, 't1');
    const to = makeSnapshot(
      Array.from({ length: n }, (_, i) => `E${i}`),
      toRows,
      't2'
    );

    const report = DriftCalculator.compare(from, to, { topK: 3, minLevel: 'moderate' });
    expect(report.drifts).toHaveLength(3);
    // All filtered drifts are ≥ moderate.
    for (const d of report.drifts) {
      expect(['moderate', 'significant', 'critical']).toContain(d.level);
    }
    expect(report.drifts[0].drift).toBe(12);
  });

  it('summary counts cover the full shared set (not the topK slice)', () => {
    const n = 12;
    const toRows = zeroMatrix(n);
    for (let i = 0; i < n; i++) toRows[i] = [i + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const from = makeNSnapshot(n, 't1');
    const to = makeSnapshot(
      Array.from({ length: n }, (_, i) => `E${i}`),
      toRows,
      't2'
    );

    const report = DriftCalculator.compare(from, to, { topK: 3 });
    // drifts sliced to 3, but summary reflects all 12 shared entities.
    expect(report.drifts).toHaveLength(3);
    expect(
      report.summary.critical +
        report.summary.significant +
        report.summary.moderate +
        report.summary.stable
    ).toBe(12);
  });
});
