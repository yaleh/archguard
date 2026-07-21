import type { MetricSnapshot } from '@/analysis/snapshot-store.js';
import { diffSnapshots } from '@/analysis/snapshot-diff.js';

export type DirectionType = 'expansion' | 'contraction' | 'stable' | 'insufficient_data';
export type ConfidenceLevel = 'low' | 'medium';

export interface DirectionSignal {
  metric: string;
  direction: 'expansion' | 'contraction' | 'neutral';
  delta: number | null;
  percentChange: number | null;
}

export interface DirectionHint {
  direction: DirectionType;
  confidence: ConfidenceLevel | null;
  signals: DirectionSignal[];
  caveat: string;
  recommendation: string;
}

// Metrics where increase = expansion
const EXPANSION_ON_INCREASE = new Set(['totalEntities', 'totalRelations', 'packageCount', 'sccCount', 'giniInDegree']);
// Threshold: changes below this % are treated as neutral
const THRESHOLD_PCT = 5;

function signalDirection(metric: string, percentChange: number | null, delta: number | null): 'expansion' | 'contraction' | 'neutral' {
  if (delta === null) return 'neutral';

  // sccCount: any increase is expansion, any decrease is contraction (no threshold — even 0→1 matters)
  if (metric === 'sccCount') {
    if (delta > 0) return 'expansion';
    if (delta < 0) return 'contraction';
    return 'neutral';
  }

  if (percentChange === null || Math.abs(percentChange) < THRESHOLD_PCT) return 'neutral';

  const increasing = delta > 0;
  const expansionOnIncrease = EXPANSION_ON_INCREASE.has(metric);
  if (increasing) return expansionOnIncrease ? 'expansion' : 'contraction';
  return expansionOnIncrease ? 'contraction' : 'expansion';
}

const RECOMMENDATION: Record<DirectionType, string> = {
  expansion: 'System is in expansion phase. Consider scheduling contraction/refactor work to prevent structural debt from accumulating.',
  contraction: 'System is in contraction phase. Good time to stabilize interfaces and consolidate responsibilities.',
  stable: 'System is stable. Monitor key metrics (sccCount, giniInDegree) to catch early phase transitions.',
  insufficient_data: 'Not enough snapshots to determine direction. Run archguard analyze to generate a second snapshot.',
};

export function computeDirectionHint(snapshots: MetricSnapshot[]): DirectionHint {
  const CAVEAT = 'Based on 2-point comparison only. Direction may flip between consecutive snapshots. Treat as a weak signal, not a definitive trend.';

  if (snapshots.length < 2) {
    return {
      direction: 'insufficient_data',
      confidence: null,
      signals: [],
      caveat: CAVEAT,
      recommendation: RECOMMENDATION.insufficient_data,
    };
  }

  // snapshots are sorted newest-first (per loadSnapshots contract)
  const newer = snapshots[0];
  const older = snapshots[1];
  const diff = diffSnapshots(older, newer);

  const trackedMetrics = ['totalEntities', 'totalRelations', 'packageCount', 'sccCount', 'giniInDegree'];
  const signals: DirectionSignal[] = trackedMetrics.map((metric) => {
    const entry = diff.entries.find((e) => e.metric === metric);
    const dir = entry
      ? signalDirection(metric, entry.percentChange, entry.delta)
      : 'neutral';
    return {
      metric,
      direction: dir,
      delta: entry?.delta ?? null,
      percentChange: entry?.percentChange ?? null,
    };
  });

  const expansionCount = signals.filter((s) => s.direction === 'expansion').length;
  const contractionCount = signals.filter((s) => s.direction === 'contraction').length;

  let direction: DirectionType;
  if (expansionCount > contractionCount && expansionCount > signals.length / 2) {
    direction = 'expansion';
  } else if (contractionCount > expansionCount && contractionCount > signals.length / 2) {
    direction = 'contraction';
  } else {
    direction = 'stable';
  }

  const confidence: ConfidenceLevel = snapshots.length >= 3 ? 'medium' : 'low';

  return {
    direction,
    confidence,
    signals,
    caveat: CAVEAT,
    recommendation: RECOMMENDATION[direction],
  };
}
