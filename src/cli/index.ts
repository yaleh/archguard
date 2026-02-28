#!/usr/bin/env node
/**
 * ArchGuard CLI Entry Point
 */

import { Command } from 'commander';
import { createAnalyzeCommand } from './commands/analyze.js';
import { createCacheCommand } from './commands/cache.js';
import { createInitCommand } from './commands/init.js';
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
    .description('ArchGuard - TypeScript Architecture Analyzer and Documentation Generator');

  // Add commands
  program.addCommand(createAnalyzeCommand());
  program.addCommand(createCacheCommand());
  program.addCommand(createInitCommand());

  return program;
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
