import { Command } from 'commander';
import {
  createProviderContext,
  outputResults,
  parseScope,
  removeProviderConfig,
  selectedProviders,
  showProviderConfig,
} from './onboarding-shared.js';
import type { OnboardingOptions, ProviderOperationResult } from './onboarding-shared.js';
import { runConfigDoctor } from '../agent/doctor.js';

export function createConfigCommand(): Command {
  const command = new Command('config')
    .description('Show and remove ArchGuard agent configuration')
    .option('--scope <scope>', 'Config scope: user or project', 'user')
    .option('--home <dir>', 'Home directory override for user-scope config')
    .option('--project-root <dir>', 'Project root override for project-scope config')
    .option('--dry-run', 'Show planned removals without writing files')
    .option('--force', 'Required for non-dry-run removal')
    .option('--json', 'Emit config state or operation result as JSON');

  command
    .command('show')
    .description('Show ArchGuard agent configuration state')
    .argument('[provider]', 'Agent provider: claude, codex, or all', 'all')
    .option('--scope <scope>', 'Config scope: user or project', 'user')
    .option('--home <dir>', 'Home directory override for user-scope config')
    .option('--project-root <dir>', 'Project root override for project-scope config')
    .option('--json', 'Emit config state as JSON')
    .action(async (provider: string, options: OnboardingOptions) => {
      const effectiveOptions = mergeParentOptions(command, options);
      const results: ProviderOperationResult[] = [];
      for (const selected of selectedProviders(provider)) {
        results.push(await showProviderConfig(selected, effectiveOptions));
      }
      outputResults(results, effectiveOptions.json);
    });

  command
    .command('remove')
    .description('Remove ArchGuard MCP server entry from agent configuration')
    .argument('[provider]', 'Agent provider: claude, codex, or all', 'all')
    .option('--scope <scope>', 'Config scope: user or project', 'user')
    .option('--home <dir>', 'Home directory override for user-scope config')
    .option('--project-root <dir>', 'Project root override for project-scope config')
    .option('--dry-run', 'Show planned removal without writing files')
    .option('--force', 'Required for non-dry-run removal')
    .option('--json', 'Emit operation result as JSON')
    .action(async (provider: string, options: OnboardingOptions) => {
      const effectiveOptions = mergeParentOptions(command, options);
      if (!effectiveOptions.dryRun && !effectiveOptions.force) {
        throw new Error('config remove requires --force unless --dry-run is used.');
      }

      const results: ProviderOperationResult[] = [];
      for (const selected of selectedProviders(provider)) {
        results.push(await removeProviderConfig(selected, effectiveOptions));
      }
      outputResults(results, effectiveOptions.json);
    });

  command
    .command('doctor')
    .description('Diagnose ArchGuard agent configuration and MCP stdio availability')
    .argument('[provider]', 'Agent provider: claude, codex, or all', 'all')
    .option('--scope <scope>', 'Config scope: user or project', 'user')
    .option('--home <dir>', 'Home directory override for user-scope config')
    .option('--project-root <dir>', 'Project root override for project-scope config')
    .option('--json', 'Emit doctor result as JSON')
    .option('--no-probe', 'Skip independent MCP stdio probe')
    .action(async (provider: string, options: OnboardingOptions & { probe?: boolean }) => {
      const effectiveOptions = mergeParentOptions(command, options);
      const context = createProviderContext(effectiveOptions);
      const result = await runConfigDoctor({
        provider,
        scope: parseScope(effectiveOptions.scope),
        homeDir: context.homeDir,
        projectRoot: context.projectRoot,
        probe: effectiveOptions.probe,
      });
      outputDoctorResult(result, effectiveOptions.json);
      if (!result.ok) process.exitCode = 1;
    });

  return command;
}

function mergeParentOptions(command: Command, options: OnboardingOptions): OnboardingOptions {
  return { ...command.opts<OnboardingOptions>(), ...options };
}

function outputDoctorResult(
  result: Awaited<ReturnType<typeof runConfigDoctor>>,
  json?: boolean
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`ok: ${String(result.ok)}\n`);
  for (const check of result.checks) {
    process.stdout.write(`${check.status}: ${check.id} - ${check.message}\n`);
    if (check.recovery) process.stdout.write(`  recovery: ${check.recovery}\n`);
  }
}
