import { describe, it, expect } from 'vitest';
import { computeDirectionHint } from '@/analysis/gim/direction-hint.js';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';

function makeSnapshot(overrides: Partial<MetricSnapshot['metricVector']> & { timestamp?: string }): MetricSnapshot {
  const { timestamp = '2026-01-01T00:00:00Z', ...vectorOverrides } = overrides;
  return {
    schemaVersion: 1,
    commitSha: 'abc123',
    branch: 'main',
    timestamp,
    archguardVersion: '0.1.0',
    metricVector: {
      schemaVersion: 1,
      totalEntities: 100,
      totalRelations: 200,
      inferredRelationRatio: 0.1,
      sccCount: 0,
      relationTypeBreakdown: {},
      maxInDegree: 10,
      maxOutDegree: 15,
      maxPackageSize: 20,
      giniInDegree: 0.5,
      giniPackageSize: 0.4,
      packageCount: 10,
      ...vectorOverrides,
    },
  };
}

describe('computeDirectionHint', () => {
  it('returns insufficient_data when fewer than 2 snapshots', () => {
    const result = computeDirectionHint([]);
    expect(result.direction).toBe('insufficient_data');
    expect(result.signals).toHaveLength(0);

    const result1 = computeDirectionHint([makeSnapshot({ timestamp: '2026-01-01T00:00:00Z' })]);
    expect(result1.direction).toBe('insufficient_data');
  });

  it('detects expansion when entities and relations grow significantly', () => {
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', totalEntities: 100, totalRelations: 200, packageCount: 10 });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 130, totalRelations: 250, packageCount: 12 });
    const result = computeDirectionHint([newer, older]);
    expect(result.direction).toBe('expansion');
    expect(result.confidence).toBe('low');
  });

  it('detects contraction when entities and relations shrink', () => {
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', totalEntities: 200, totalRelations: 400, packageCount: 15 });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 180, totalRelations: 360, packageCount: 13 });
    const result = computeDirectionHint([newer, older]);
    expect(result.direction).toBe('contraction');
  });

  it('returns stable on mixed signals (2 expansion, 2 contraction, 1 neutral)', () => {
    // totalEntities +30% → expansion, totalRelations +25% → expansion
    // packageCount -10% → contraction, giniInDegree -10% → contraction
    // sccCount: 0→0 → neutral
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', totalEntities: 100, totalRelations: 200, packageCount: 10, giniInDegree: 0.5, sccCount: 0 });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 130, totalRelations: 250, packageCount: 9, giniInDegree: 0.45, sccCount: 0 });
    const result = computeDirectionHint([newer, older]);
    expect(result.direction).toBe('stable');
  });

  it('uses medium confidence with 3+ snapshots', () => {
    const s1 = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', totalEntities: 100 });
    const s2 = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 130 });
    const s3 = makeSnapshot({ timestamp: '2026-01-03T00:00:00Z', totalEntities: 160 });
    const result = computeDirectionHint([s3, s2, s1]);
    expect(result.confidence).toBe('medium');
  });

  it('treats small deltas below 5% threshold as neutral', () => {
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', totalEntities: 100, totalRelations: 200, packageCount: 10, giniInDegree: 0.5, sccCount: 0 });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 102, totalRelations: 203, packageCount: 10, giniInDegree: 0.5, sccCount: 0 });
    const result = computeDirectionHint([newer, older]);
    expect(result.direction).toBe('stable');
  });

  it('always includes a non-empty caveat field', () => {
    const result1 = computeDirectionHint([]);
    expect(result1.caveat).toBeTruthy();
    expect(result1.caveat.length).toBeGreaterThan(0);

    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z' });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 130 });
    const result2 = computeDirectionHint([newer, older]);
    expect(result2.caveat).toBeTruthy();
  });

  it('recommendation matches direction type', () => {
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', totalEntities: 100, totalRelations: 200, packageCount: 10 });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', totalEntities: 130, totalRelations: 250, packageCount: 12 });
    const result = computeDirectionHint([newer, older]);
    expect(result.direction).toBe('expansion');
    expect(result.recommendation.toLowerCase()).toMatch(/contraction|refactor|stabiliz/);
  });

  it('serializes to valid JSON without undefined values', () => {
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z' });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z' });
    const result = computeDirectionHint([newer, older]);
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.direction).toBeDefined();
    expect(parsed.signals).toBeDefined();
    expect(parsed.caveat).toBeDefined();
  });

  it('rising sccCount contributes expansion signal', () => {
    const older = makeSnapshot({ timestamp: '2026-01-01T00:00:00Z', sccCount: 0, giniInDegree: 0.5, totalEntities: 100, totalRelations: 200 });
    const newer = makeSnapshot({ timestamp: '2026-01-02T00:00:00Z', sccCount: 3, giniInDegree: 0.65, totalEntities: 130, totalRelations: 250 });
    const result = computeDirectionHint([newer, older]);
    expect(result.direction).toBe('expansion');
    const sccSignal = result.signals.find(s => s.metric === 'sccCount');
    expect(sccSignal?.direction).toBe('expansion');
  });
});
