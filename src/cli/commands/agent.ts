import { Command } from 'commander';
import {
  renderAgentInstructions,
  type AgentProvider,
  type InstructionRenderInput,
} from '../metadata/index.js';

const providers = ['claude', 'codex'] as const;
const formats = ['markdown', 'text'] as const;

export function createAgentCommand(): Command {
  const command = new Command('agent').description('Generate ArchGuard agent instructions');

  command
    .command('instructions')
    .description('Print registry-derived instructions for an agent provider')
    .argument('[provider]', 'Agent provider: claude or codex', 'codex')
    .option('--format <format>', 'Output format: markdown or text', 'markdown')
    .option('--include-catalog', 'Include the full MCP tool catalog')
    .action(
      (
        provider: string,
        options: {
          format?: string;
          includeCatalog?: boolean;
        }
      ) => {
        const input = parseInstructionInput(provider, options);
        const result = renderAgentInstructions(undefined, input);
        process.stdout.write(`${result.content}\n`);
      }
    );

  return command;
}

function parseInstructionInput(
  provider: string,
  options: { format?: string; includeCatalog?: boolean }
): InstructionRenderInput {
  if (!providers.includes(provider as AgentProvider)) {
    throw new Error(`Unsupported agent provider: ${provider}. Expected claude or codex.`);
  }
  const format = options.format ?? 'markdown';
  if (!formats.includes(format as InstructionRenderInput['format'])) {
    throw new Error(`Unsupported instruction format: ${format}. Expected markdown or text.`);
  }
  return {
    provider: provider as AgentProvider,
    format: format as InstructionRenderInput['format'],
    includeCatalog: options.includeCatalog,
  };
}
