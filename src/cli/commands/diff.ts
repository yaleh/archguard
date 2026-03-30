import { Command } from 'commander';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { diffSnapshots } from '@/analysis/snapshot-diff.js';
import type { MetricSnapshot } from '@/analysis/snapshot-store.js';
import type { MetricDiffEntry } from '@/analysis/snapshot-diff.js';

/**
 * Resolve a snapshot by SHA prefix. Returns undefined if no match.
 */
function resolveByPrefix(snapshots: MetricSnapshot[], prefix: string): MetricSnapshot | undefined {
  return snapshots.find((s) => s.commitSha != null && s.commitSha.startsWith(prefix));
}

/**
 * Format a number for table display (fixed 3 decimal places for ratios, integer otherwise).
 */
function fmtNum(val: number | null): string {
  if (val === null) return 'N/A';
  return Number.isInteger(val) ? String(val) : val.toFixed(3);
}

/**
 * Format percent change for display.
 */
function fmtPct(val: number | null): string {
  if (val === null) return 'N/A';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

/**
 * Print a diff table to stdout.
 */
function printTable(entries: MetricDiffEntry[]): void {
  const COL_METRIC = 20;
  const COL_NUM = 10;

  const header =
    'Metric'.padEnd(COL_METRIC) +
    'From'.padEnd(COL_NUM) +
    'To'.padEnd(COL_NUM) +
    'Delta'.padEnd(COL_NUM) +
    '%Change';

  const separator = '-'.repeat(COL_METRIC + COL_NUM * 3 + 10);

  console.log(header);
  console.log(separator);

  for (const entry of entries) {
    const row =
      entry.metric.padEnd(COL_METRIC) +
      fmtNum(entry.from).padEnd(COL_NUM) +
      fmtNum(entry.to).padEnd(COL_NUM) +
      fmtNum(entry.delta).padEnd(COL_NUM) +
      fmtPct(entry.percentChange);
    console.log(row);
  }
}

export function createDiffCommand(): Command {
  const cmd = new Command('diff');

  cmd
    .description('Compare two architecture metric snapshots')
    .option('--from <sha>', 'Source snapshot (SHA prefix)')
    .option('--to <sha>', 'Target snapshot (SHA prefix)')
    .option('--output-dir <dir>', 'Snapshots directory', '.archguard')
    .action(async (options) => {
      const snapshots = await loadSnapshots(options.outputDir);

      if (snapshots.length < 2) {
        console.error('Need at least 2 snapshots to compare.');
        return;
      }

      // snapshots are sorted DESC (newest first)
      let fromSnapshot: MetricSnapshot | undefined;
      let toSnapshot: MetricSnapshot | undefined;

      if (options.from) {
        fromSnapshot = resolveByPrefix(snapshots, options.from);
        if (!fromSnapshot) {
          console.error(`No snapshot found matching SHA prefix: ${options.from}`);
          return;
        }
      } else {
        // Default: second most recent
        fromSnapshot = snapshots[1];
      }

      if (options.to) {
        toSnapshot = resolveByPrefix(snapshots, options.to);
        if (!toSnapshot) {
          console.error(`No snapshot found matching SHA prefix: ${options.to}`);
          return;
        }
      } else {
        // Default: most recent
        toSnapshot = snapshots[0];
      }

      const result = diffSnapshots(fromSnapshot, toSnapshot);

      // Print header with commit info
      const fromLabel = result.fromCommit ?? 'unknown';
      const toLabel = result.toCommit ?? 'unknown';
      console.log(`Comparing: ${fromLabel.slice(0, 8)} → ${toLabel.slice(0, 8)}`);
      console.log(`From: ${result.fromTimestamp}  To: ${result.toTimestamp}`);
      console.log('');

      printTable(result.entries);

      // Print warnings
      if (result.warnings.length > 0) {
        console.log('');
        for (const warning of result.warnings) {
          console.log(`Warning: ${warning}`);
        }
      }
    });

  return cmd;
}
