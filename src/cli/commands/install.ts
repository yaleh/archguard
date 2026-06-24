import { Command } from 'commander';
import { installProvider, outputResults, selectedProviders } from './onboarding-shared.js';
import type { OnboardingOptions, ProviderOperationResult } from './onboarding-shared.js';

export function createInstallCommand(): Command {
  return new Command('install')
    .description('Install ArchGuard MCP config and generated instructions for Claude Code or Codex')
    .argument('[provider]', 'Agent provider: claude, codex, or all', 'all')
    .option('--scope <scope>', 'Config scope: user or project', 'user')
    .option('--home <dir>', 'Home directory override for user-scope config')
    .option('--project-root <dir>', 'Project root override for project-scope config')
    .option('--dry-run', 'Show planned changes without writing files')
    .option('--force', 'Overwrite an existing divergent ArchGuard entry')
    .option('--mcp-only', 'Only write MCP server config')
    .option('--instructions-only', 'Only write generated instructions')
    .option('--json', 'Emit operation result as JSON')
    .action(async (provider: string, options: OnboardingOptions) => {
      const results: ProviderOperationResult[] = [];
      for (const selected of selectedProviders(provider)) {
        results.push(await installProvider(selected, options));
      }
      outputResults(results, options.json);
    });
}
