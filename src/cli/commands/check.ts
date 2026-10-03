import { Command } from 'commander';
import { ConfigLoader } from '@/cli/config-loader.js';
import { loadSnapshots } from '@/analysis/snapshot-store.js';
import { evaluateAllRules } from '@/analysis/fitness/rule-evaluator.js';
import { loadFitnessRelations } from '@/cli/utils/fitness-relations-loader.js';
import type { RuleResult, FitnessRule } from '@/analysis/fitness/rule-types.js';

/** Exit code when a rule is violated and `failOnViolation` is set. */
const EXIT_VIOLATION = 1;
/** Exit code when a rule could not be evaluated (tri-state, A4). */
const EXIT_NOT_EVALUATED = 2;

/**
 * Format a single rule result for console output.
 *
 * PASS           No cyclic dependencies allowed
 * FAIL           No god files (actual: 25, threshold: < 20)
 * NOT-EVALUATED  No parser→cli dependency (no relation data available ...)
 */
function formatResult(result: RuleResult): string {
  const message = result.rule.message;

  if (result.evaluated === false) {
    const reason = result.detail ? ` (${result.detail})` : '';
    return `NOT-EVALUATED  ${message}${reason}`;
  }

  const status = result.passed ? 'PASS' : 'FAIL';

  if (!result.passed && result.actual !== undefined) {
    const rule = result.rule;
    const threshold = 'op' in rule ? `${rule.op} ${rule.value}` : '';
    return `${status}  ${message} (actual: ${String(result.actual)}, threshold: ${threshold})`;
  }

  // Dependency violations carry their evidence in `detail` (the offending edge);
  // printing it is the point — a bare FAIL gives no actionable edge.
  if (!result.passed && result.detail) {
    return `${status}  ${message} — ${result.detail}`;
  }

  return `${status}  ${message}`;
}

export function createCheckCommand(): Command {
  const cmd = new Command('check');

  cmd
    .description('Check architecture fitness rules against current metrics')
    .option('--config <path>', 'Config file path', 'archguard.config.json')
    .option(
      '--output-dir <dir>',
      'Directory holding the analyze snapshots (default: config outputDir)'
    )
    .action(async (options: { config: string; outputDir?: string }) => {
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

      // 3. Load snapshots — use the most recent one. `analyze` writes them to
      //    <outputDir>/snapshots, where outputDir defaults to <workDir>/output;
      //    reading the bare work dir here would never find them.
      const snapshotDir = options.outputDir ?? config.outputDir;
      const snapshots = await loadSnapshots(snapshotDir);
      if (snapshots.length === 0) {
        console.log(`No snapshots found under ${snapshotDir}. Run \`archguard analyze\` first.`);
        return;
      }

      const snapshot = snapshots[0];

      // 4. Relations — load the real edges from the analyze artifacts
      //    (<workDir>/query/<scopeKey>/arch.json).
      //    `null` (no artifact / no edges at this granularity) is surfaced to
      //    the user and turns `no-dependency` rules into NOT-EVALUATED; it is
      //    deliberately not collapsed into an empty graph, which would make
      //    every dependency rule pass vacuously.
      const relationData = await loadFitnessRelations(config.workDir);
      if (relationData.relations === null) {
        console.log(
          `Relation data unavailable: ${relationData.detail}. ` +
            `'no-dependency' rules will be reported as NOT-EVALUATED.`
        );
      }

      // 5. Evaluate rules
      const results = evaluateAllRules(
        fitnessConfig.rules as unknown as FitnessRule[],
        snapshot.metricVector,
        relationData.relations
      );

      // 6. Print results
      for (const result of results) {
        console.log(formatResult(result));
      }

      // 7. Exit 1 on a real violation; exit 2 when something could not be
      //    evaluated — never conflate "unable to check" with "checked, clean".
      const violated = results.some((r) => !r.passed && r.evaluated !== false);
      const notEvaluated = results.some((r) => r.evaluated === false);

      let exitCode = 0;
      if (violated) {
        exitCode = EXIT_VIOLATION;
      } else if (notEvaluated) {
        exitCode = EXIT_NOT_EVALUATED;
      }

      if (exitCode !== 0 && fitnessConfig.failOnViolation) {
        process.exit(exitCode);
      }
    });

  return cmd;
}
