#!/usr/bin/env node
/**
 * ArchGuard CLI Entry Point
 */

import { Command } from 'commander';
import { createAnalyzeCommand } from './commands/analyze.js';
import { createCacheCommand } from './commands/cache.js';
import { createInitCommand } from './commands/init.js';
import { createQueryCommand } from './commands/query.js';
import { createMcpCommand } from './commands/mcp.js';
import { createDiffCommand } from './commands/diff.js';
import { createCheckCommand } from './commands/check.js';
import { createHelpCommand } from './commands/help.js';
import { getCliCommandMetadata } from './metadata/index.js';
import { createRequire } from 'module';

// Read package.json for version
const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

/**
 * Create the main CLI program
 */
export function createCLI(): Command {
  const program = new Command();

  program
    .name('archguard')
    .version(packageJson.version)
    .description('ArchGuard - Multi-Language Architecture Analyzer and Documentation Generator');

  // Add commands
  program.addCommand(withRegistryDescription(createAnalyzeCommand()));
  program.addCommand(withRegistryDescription(createCacheCommand()));
  program.addCommand(withRegistryDescription(createInitCommand()));
  program.addCommand(withRegistryDescription(createQueryCommand()));
  program.addCommand(withRegistryDescription(createMcpCommand()));
  program.addCommand(withRegistryDescription(createDiffCommand()));
  program.addCommand(withRegistryDescription(createCheckCommand()));
  program.addCommand(createHelpCommand());

  return program;
}

function withRegistryDescription(command: Command): Command {
  const metadata = getCliCommandMetadata(command.name());
  return metadata ? command.description(metadata.cli.description) : command;
}

import * as fs from 'fs';
import * as url from 'url';

/**
 * Main CLI entry point (only run when executed directly)
 */
const isMain =
  process.argv[1] && import.meta.url === url.pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isMain) {
  const program = createCLI();
  program.parse(process.argv);
}
