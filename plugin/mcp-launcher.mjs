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
 * Resolution order:
 *   1. The plugin's own dependency tree (createRequire from this file's
 *      location). Honors NODE_PATH when the caller sets it before startup.
 *   2. Claude Code >= 2.1.222 installs plugin dependencies into a sibling
 *      `npm-cache/node_modules` under the plugins root, outside the upward
 *      walk from the plugin dir. When (1) misses, we discover that sibling
 *      cache by walking up from the plugin root and resolve through it.
 *
 * It deliberately does NOT rely on a global `archguard` install, repository
 * parent node_modules, vendored dist/, or NODE_PATH being set by the caller
 * — the npm-cache sibling is discovered, not assumed.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ENTRY = '@yalehwang/archguard/dist/cli/index.js';

/**
 * Resolve the ArchGuard CLI entry used as the MCP stdio server.
 *
 * 1. Primary — the plugin's own dependency tree (nested or hoisted).
 * 2. Fallback — the Claude Code npm-cache sibling layout: walk up from the
 *    plugin root and resolve through the first `npm-cache/node_modules`
 *    that contains the package.
 *
 * @returns {string|null} absolute entry path, or null when unresolvable.
 */
function resolveArchguardEntry() {
  try {
    return require.resolve(ENTRY);
  } catch {
    // Not in the plugin's own tree — try the npm-cache sibling layout.
  }

  const pluginDir = dirname(fileURLToPath(import.meta.url));
  let dir = pluginDir;
  while (true) {
    const cacheNodeModules = join(dir, 'npm-cache', 'node_modules');
    if (existsSync(cacheNodeModules)) {
      try {
        return createRequire(join(cacheNodeModules, 'index.js')).resolve(ENTRY);
      } catch {
        // This npm-cache does not contain the package; keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

const entry = resolveArchguardEntry();
if (!entry) {
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
