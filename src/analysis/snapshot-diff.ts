import type { MetricSnapshot } from './snapshot-store.js';

export interface MetricDiffEntry {
  metric: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  percentChange: number | null;
}

export interface MetricDiffResult {
  fromCommit: string | null;
  toCommit: string | null;
  fromTimestamp: string;
  toTimestamp: string;
  schemaVersionMismatch: boolean;
  entries: MetricDiffEntry[];
  warnings: string[];
}

const NUMERIC_FIELDS: ReadonlyArray<string> = [
  'totalEntities',
  'totalRelations',
  'inferredRelationRatio',
  'sccCount',
  'maxInDegree',
  'maxOutDegree',
  'maxPackageSize',
  'giniInDegree',
  'giniPackageSize',
  'packageCount',
  'entityCoverageRatio',
];

export function diffSnapshots(from: MetricSnapshot, to: MetricSnapshot): MetricDiffResult {
  const warnings: string[] = [];
  const schemaVersionMismatch = from.metricVector.schemaVersion !== to.metricVector.schemaVersion;

  if (schemaVersionMismatch) {
    warnings.push(
      `Schema version mismatch: from=${from.metricVector.schemaVersion}, to=${to.metricVector.schemaVersion}. Comparison may be unreliable.`
    );
  }

  const entries: MetricDiffEntry[] = NUMERIC_FIELDS.map((field) => {
    const fromVal =
      (from.metricVector as unknown as Record<string, number | null | undefined>)[field] ?? null;
    const toVal =
      (to.metricVector as unknown as Record<string, number | null | undefined>)[field] ?? null;

    const fromNum = fromVal !== null && fromVal !== undefined ? fromVal : null;
    const toNum = toVal !== null && toVal !== undefined ? toVal : null;

    let delta: number | null = null;
    let percentChange: number | null = null;

    if (fromNum !== null && toNum !== null) {
      delta = toNum - fromNum;
      if (fromNum === 0) {
        percentChange = null;
      } else {
        percentChange = (delta / fromNum) * 100;
      }
    }

    return {
      metric: field,
      from: fromNum,
      to: toNum,
      delta,
      percentChange,
    };
  });

  return {
    fromCommit: from.commitSha,
    toCommit: to.commitSha,
    fromTimestamp: from.timestamp,
    toTimestamp: to.timestamp,
    schemaVersionMismatch,
    entries,
    warnings,
  };
}
