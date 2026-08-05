/**
 * Human-readable formatting for the architecture drift report (TASK-65 Phase C).
 *
 * Mirrors the CLI output sketch from the proposal: comparing commits, mode,
 * shared-entity counts, per-level entity lists with drift + deltaFanOut/
 * deltaFanIn, and a summary line.
 *
 * @module cli/utils/drift-reporter
 */

import type { DriftLevel, DriftReport } from '@/analysis/jl/types.js';

const LEVEL_LABELS: ReadonlyArray<{ level: DriftLevel; label: string }> = [
  { level: 'critical', label: 'Critical drift (≥ 3.0)' },
  { level: 'significant', label: 'Significant drift (1.5–3.0)' },
  { level: 'moderate', label: 'Moderate drift (0.5–1.5)' },
  { level: 'stable', label: 'Stable drift (< 0.5)' },
];

/**
 * Format a DriftReport as text for the CLI drift gate.
 *
 * @param report - The drift report.
 * @returns Multi-line human-readable report.
 */
export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = ['Architecture Drift Report'];

  const fromRef = report.fromSnapshot.commitSha ?? report.fromSnapshot.timestamp;
  const toRef = report.toSnapshot.commitSha ?? report.toSnapshot.timestamp;
  lines.push(`  Comparing: ${fromRef} → ${toRef}`);
  lines.push(
    `  Mode: ${report.mode.toUpperCase()} (N_union=${report.nUnion}` +
      (report.k !== null ? `, k=${report.k}` : '') +
      ')'
  );
  lines.push(`  Shared entities: ${report.sharedEntityCount} / ${report.nUnion}`);

  for (const { level, label } of LEVEL_LABELS) {
    const entities = report.drifts.filter((d) => d.level === level);
    if (entities.length === 0) continue;
    lines.push('');
    lines.push(`  ${label}:`);
    for (const d of entities) {
      lines.push(
        `    ${d.entityId}   drift=${d.drift.toFixed(2)}  ` +
          `ΔfanOut=${d.deltaFanOut >= 0 ? '+' : ''}${d.deltaFanOut}  ` +
          `ΔfanIn=${d.deltaFanIn >= 0 ? '+' : ''}${d.deltaFanIn}`
      );
    }
  }

  if (report.addedEntities.length > 0) {
    lines.push('');
    lines.push(`  New entities (${report.addedEntities.length}):`);
    for (const id of report.addedEntities.slice(0, 10)) lines.push(`    ${id}`);
    if (report.addedEntities.length > 10)
      lines.push(`    … +${report.addedEntities.length - 10} more`);
  }
  if (report.removedEntities.length > 0) {
    lines.push('');
    lines.push(`  Removed entities (${report.removedEntities.length}):`);
    for (const id of report.removedEntities.slice(0, 10)) lines.push(`    ${id}`);
    if (report.removedEntities.length > 10)
      lines.push(`    … +${report.removedEntities.length - 10} more`);
  }

  const s = report.summary;
  lines.push(
    '',
    `  Summary: ${s.critical} critical, ${s.significant} significant, ` +
      `${s.moderate} moderate, ${s.stable} stable`
  );

  return lines.join('\n');
}
