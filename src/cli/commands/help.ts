import { Command } from 'commander';
import { archGuardMetadataRegistry } from '../metadata/index.js';
import type { AgentGuidance, CliCommandMetadata, CliOptionMetadata } from '../metadata/index.js';

export interface StructuredCliHelpOption {
  flags: string;
  description: string;
  defaultValue?: string | number | boolean;
  allowedValues?: string[];
  mapsToMcpTool?: string;
}

export interface StructuredCliHelpCommand {
  name: string;
  description: string;
  category: string;
  options: StructuredCliHelpOption[];
  agent: AgentGuidance;
  examples: Array<{ command: string; description: string }>;
}

export interface StructuredCliHelp {
  program: 'archguard';
  schemaVersion: 1;
  commands: StructuredCliHelpCommand[];
}

export function createStructuredHelp(): StructuredCliHelp {
  return {
    program: 'archguard',
    schemaVersion: 1,
    commands: archGuardMetadataRegistry.cliCommands.map(toStructuredCommand),
  };
}

export function createHelpCommand(): Command {
  const command = new Command('help')
    .description('Show structured ArchGuard CLI help for agents')
    .argument('[command]', 'Command to show human-readable help for')
    .option('--json', 'Emit structured help as JSON')
    .action((targetCommand: string | undefined, options: { json?: boolean }) => {
      if (!options.json) {
        showHumanHelp(command, targetCommand);
        return;
      }
      if (targetCommand) {
        command.error('too many arguments for structured help. Use: archguard help --json');
        return;
      }
      process.stdout.write(`${JSON.stringify(createStructuredHelp(), null, 2)}\n`);
    });
  return command;
}

function showHumanHelp(command: Command, targetCommand: string | undefined): void {
  const program = command.parent;
  if (!program) {
    command.help();
  }

  if (!targetCommand) {
    program.help();
    return;
  }

  const target = program.commands.find((item) => item.name() === targetCommand);
  if (!target) {
    command.error(`unknown command '${targetCommand}'`);
  }
  target.help();
}

function toStructuredCommand(command: CliCommandMetadata): StructuredCliHelpCommand {
  return {
    name: command.cli.command,
    description: command.cli.description,
    category: command.category,
    options: command.cli.options.map(toStructuredOption),
    agent: command.agent,
    examples: command.examples.map((example) => ({
      command: example.command,
      description: example.description,
    })),
  };
}

function toStructuredOption(option: CliOptionMetadata): StructuredCliHelpOption {
  return {
    flags: option.flags,
    description: option.description,
    ...(option.defaultValue !== undefined ? { defaultValue: option.defaultValue } : {}),
    ...(option.allowedValues !== undefined ? { allowedValues: option.allowedValues } : {}),
    ...(option.mapsToMcpTool !== undefined ? { mapsToMcpTool: option.mapsToMcpTool } : {}),
  };
}
