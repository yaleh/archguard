import { Command } from 'commander';
import { outputResults, selectedProviders, updateProvider } from './onboarding-shared.js';
import type { OnboardingOptions, ProviderOperationResult } from './onboarding-shared.js';

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Refresh existing ArchGuard agent configuration and generated instructions')
    .argument('[provider]', 'Agent provider: claude, codex, or all', 'all')
    .option('--scope <scope>', 'Config scope: user or project', 'user')
    .option('--home <dir>', 'Home directory override for user-scope config')
    .option('--project-root <dir>', 'Project root override for project-scope config')
    .option('--dry-run', 'Show planned changes without writing files')
    .option('--mcp-only', 'Only refresh MCP server config')
    .option('--instructions-only', 'Only refresh generated instructions')
    .option('--json', 'Emit operation result as JSON')
    .action(async (provider: string, options: OnboardingOptions) => {
      const results: ProviderOperationResult[] = [];
      for (const selected of selectedProviders(provider)) {
        results.push(await updateProvider(selected, options));
      }
      outputResults(results, options.json);
    });
}
