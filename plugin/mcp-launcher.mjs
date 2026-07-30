#!/usr/bin/env node
/**
 * ArchGuard Claude plugin — MCP launcher (TASK-31).
 *
 * The plugin is installed by Claude Code from its npm-source marketplace
 * entry: `npm install @yalehwang/archguard-claude-plugin` inside the plugin
 * cache. The plugin package depends on an exact @yalehwang/archguard version,
 * so the ArchGuard runtime lives in the plugin's own dependency tree
 * (nested or hoisted — createRequire resolves both). This launcher resolves
 * that CLI entry and execs it as the MCP stdio server.
 *
 * It deliberately does NOT rely on a global `archguard` install, repository
 * parent node_modules, vendored dist/, or NODE_PATH.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let entry;
try {
  entry = require.resolve('@yalehwang/archguard/dist/cli/index.js');
} catch {
  console.error(
    '[archguard] Cannot resolve @yalehwang/archguard/dist/cli/index.js from the plugin dependency tree.'
  );
  console.error(
    '[archguard] The plugin is installed via npm; reinstall it so its dependencies are present.'
  );
  process.exit(1);
}

// Default to the MCP stdio server; allow explicit subcommand passthrough.
const args = process.argv.slice(2);
const child = spawn(process.execPath, [entry, ...(args.length > 0 ? args : ['mcp'])], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    // Propagate the terminating signal to our own process group semantics:
    // exit with the conventional 128 + signal number so parents see it.
    process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`[archguard] Failed to launch the MCP server: ${error.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
