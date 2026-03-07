/**
 * MCP Command — start the ArchGuard MCP server (stdio transport).
 *
 * Usage:
 *   archguard mcp
 */

import { Command } from 'commander';

export function createMcpCommand(): Command {
  return new Command('mcp')
    .description('Start ArchGuard MCP server (stdio transport)')
    .action(async () => {
      try {
        // Dynamic import to avoid loading MCP SDK unless command is invoked
        const { startMcpServer } = await import('../mcp/mcp-server.js');
        await startMcpServer(process.cwd());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
