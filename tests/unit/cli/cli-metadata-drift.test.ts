import { describe, expect, it } from 'vitest';
import { createCLI } from '@/cli/index';
import { archGuardMetadataRegistry, cliCommandBaseline } from '@/cli/metadata';
import type { Command } from 'commander';

function optionLongFromFlags(flags: string): string | undefined {
  return flags
    .split(/[ ,|]+/)
    .find((part) => part.startsWith('--'))
    ?.replace(/[<[].*$/, '');
}

function businessCommands(program: Command): Command[] {
  return program.commands.filter((command) => command.name() !== 'help');
}

function runtimeLongOptions(command: Command): Set<string> {
  return new Set(command.options.map((option) => option.long).filter(Boolean));
}

function registryLongOptions(commandName: string): Set<string> {
  const metadata = archGuardMetadataRegistry.cliCommands.find(
    (command) => command.cli.command === commandName
  );
  expect(metadata, commandName).toBeDefined();

  return new Set(
    metadata!.cli.options.map((option) => optionLongFromFlags(option.flags)).filter(Boolean)
  );
}

describe('CLI metadata drift', () => {
  it('keeps Commander business commands covered by registry metadata', () => {
    const program = createCLI();
    const runtimeCommands = businessCommands(program).map((command) => command.name());

    expect(new Set(runtimeCommands)).toEqual(new Set(cliCommandBaseline));
    expect(
      new Set(archGuardMetadataRegistry.cliCommands.map((command) => command.cli.command))
    ).toEqual(new Set(runtimeCommands));
  });

  it('keeps registry descriptions available for each runtime business command', () => {
    const program = createCLI();
    const metadataByCommand = new Map(
      archGuardMetadataRegistry.cliCommands.map((entry) => [entry.cli.command, entry])
    );

    for (const command of businessCommands(program)) {
      const metadata = metadataByCommand.get(command.name());
      expect(metadata, command.name()).toBeDefined();
      expect(metadata?.cli.description.trim()).not.toBe('');
      expect(command.description().trim()).not.toBe('');
    }
  });

  it('keeps Commander options and registry option metadata bidirectionally aligned', () => {
    for (const command of businessCommands(createCLI())) {
      const runtimeOptions = runtimeLongOptions(command);
      const metadataOptions = registryLongOptions(command.name());

      for (const option of command.options) {
        expect(metadataOptions.has(option.long), `${command.name()} ${option.long}`).toBe(true);
      }

      for (const option of metadataOptions) {
        expect(runtimeOptions.has(option), `${command.name()} ${option}`).toBe(true);
      }
    }
  });

  it('keeps mapped query options pointing at registered MCP tools', () => {
    const mcpTools = new Set(archGuardMetadataRegistry.mcpTools.map((tool) => tool.mcp.toolName));
    const queryMetadata = archGuardMetadataRegistry.cliCommands.find(
      (command) => command.cli.command === 'query'
    );

    for (const option of queryMetadata!.cli.options.filter((item) => item.mapsToMcpTool)) {
      expect(mcpTools.has(option.mapsToMcpTool!), option.flags).toBe(true);
    }
  });

  it('keeps query mappings attached to the corresponding query options', () => {
    const queryMetadata = archGuardMetadataRegistry.cliCommands.find(
      (command) => command.cli.command === 'query'
    )!;

    for (const mapping of archGuardMetadataRegistry.queryMappings.filter(
      (item) => item.kind === 'query'
    )) {
      const flag = mapping.cliEquivalent.match(/archguard query\s+(--[^\s<[]+)/)?.[1];
      expect(flag, mapping.cliEquivalent).toBeDefined();

      const option = queryMetadata.cli.options.find(
        (item) => optionLongFromFlags(item.flags) === flag
      );
      expect(option, mapping.cliEquivalent).toBeDefined();
      expect(option?.mapsToMcpTool, mapping.cliEquivalent).toBe(mapping.mcpTool);
    }
  });

  it('detects missing registry metadata for a runtime option', () => {
    const queryCommand = createCLI().commands.find((command) => command.name() === 'query')!;
    const queryMetadata = archGuardMetadataRegistry.cliCommands.find(
      (command) => command.cli.command === 'query'
    )!;
    const metadataLongOptions = new Set(
      queryMetadata.cli.options
        .filter((option) => option.flags !== '--summary')
        .map((option) => optionLongFromFlags(option.flags))
        .filter(Boolean)
    );

    const missing = queryCommand.options
      .map((option) => option.long)
      .filter((long) => !metadataLongOptions.has(long));

    expect(missing).toContain('--summary');
  });
});
