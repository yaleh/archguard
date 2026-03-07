/**
 * MCP Command — start the ArchGuard MCP server (stdio transport).
 *
 * Usage:
 *   archguard mcp [--arch-dir <dir>] [--scope <key>]
 */

import { Command } from 'commander';
import { resolveArchDir } from '../query/engine-loader.js';

interface McpOptions {
  archDir?: string;
  scope?: string;
}

export function createMcpCommand(): Command {
  return new Command('mcp')
    .description('Start ArchGuard MCP server (stdio transport)')
    .option('--arch-dir <dir>', 'ArchGuard work directory')
    .option('--scope <key>', 'Query scope key')
    .action(async (opts: McpOptions) => {
      try {
        const archDir = resolveArchDir(opts.archDir);
        // Dynamic import to avoid loading MCP SDK unless command is invoked
        const { startMcpServer } = await import('../mcp/mcp-server.js');
        await startMcpServer(archDir, opts.scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
