import { Command } from 'commander';
import { ConfigLoader } from '@/cli/config-loader.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { evaluateAllRules } from '@/analysis/fitness/rule-evaluator.js';
import type { RuleResult } from '@/analysis/fitness/rule-types.js';
import type { Relation } from '@/types/index.js';

/**
 * Format a single rule result for console output.
 *
 * PASS  No cyclic dependencies allowed
 * FAIL  No god files (actual: 25, threshold: < 20)
 */
function formatResult(result: RuleResult): string {
  const status = result.passed ? 'PASS' : 'FAIL';
  const message = result.rule.message;

  if (!result.passed && result.actual !== undefined) {
    const rule = result.rule;
    const threshold = 'op' in rule ? `${rule.op} ${rule.value}` : '';
    return `${status}  ${message} (actual: ${String(result.actual)}, threshold: ${threshold})`;
  }

  return `${status}  ${message}`;
}

export function createCheckCommand(): Command {
  const cmd = new Command('check');

  cmd
    .description('Check architecture fitness rules against current metrics')
    .option('--config <path>', 'Config file path', 'archguard.config.json')
    .option('--output-dir <dir>', 'Output directory', '.archguard')
    .action(async (options: { config: string; outputDir: string }) => {
      // 1. Load config — cast to unknown first to access optional `fitness` field
      const loader = new ConfigLoader();
      const config = await loader.load({}, options.config);
      const rawConfig = config as unknown as Record<string, unknown>;

      const fitnessConfig = rawConfig['fitness'] as
        | { rules: unknown[]; failOnViolation: boolean }
        | undefined;

      // 2. Guard: no fitness config
      if (!fitnessConfig?.rules || fitnessConfig.rules.length === 0) {
        console.log('No fitness rules configured.');
        return;
      }

      // 3. Load snapshots — use the most recent one
      const snapshots = await loadSnapshots(options.outputDir);
      if (snapshots.length === 0) {
        console.log('No snapshots found. Run `archguard analyze` first.');
        return;
      }

      const snapshot = snapshots[0];

      // 4. Relations — try to load from ArchJSON; fall back to empty array
      const relations: Relation[] = [];

      // 5. Evaluate rules

      const results = evaluateAllRules(
        fitnessConfig.rules as any[],
        snapshot.metricVector,
        relations
      );

      // 6. Print results
      for (const result of results) {
        console.log(formatResult(result));
      }

      // 7. Exit with code 1 if any failed and failOnViolation is set
      const anyFailed = results.some((r) => !r.passed);
      if (anyFailed && fitnessConfig.failOnViolation) {
        process.exit(1);
      }
    });

  return cmd;
}
