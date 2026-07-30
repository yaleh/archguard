#!/usr/bin/env node
/**
 * install-claude-user-scope.mjs — npm-source Claude Code plugin installer
 * (TASK-35).
 *
 * Registers the ArchGuard marketplace and installs the `archguard@archguard`
 * plugin at user scope using Claude Code's own npm-source marketplace flow
 * (TASK-31). Claude Code fetches `@yalehwang/archguard-claude-plugin` from
 * npm itself, which depends on an exact `@yalehwang/archguard` version — no
 * global `archguard` binary, no global npm installation, and no
 * directory-source plugin registration is involved.
 *
 * Properties:
 * - Idempotent: re-running performs marketplace update + plugin update instead
 *   of duplicating registrations, and leaves exactly one enabled plugin.
 * - Never writes to the deprecated `~/.claude/mcp.json`: the only mutation of
 *   that file is REMOVING a legacy ArchGuard entry (global-binary registration
 *   written by pre-TASK-35 installers) while preserving unrelated MCP servers
 *   and unrelated top-level keys byte-for-byte when there is no residue.
 * - Never installs, builds, or globally mutates native tree-sitter runtime or
 *   grammar packages (the plugin closure is the deterministic WASM baseline;
 *   native acceleration is opt-in at runtime — see
 *   docs/user-guide/parser-runtime.md).
 *
 * Usage:
 *   scripts/install-claude-user-scope.sh [--marketplace-source <src>]
 *
 *   --marketplace-source <src>  Marketplace source for `claude plugin
 *                               marketplace add` (default: this checkout's
 *                               repository root; use `yaleh/archguard` for the
 *                               GitHub source).
 *
 * Environment:
 *   CLAUDE_CONFIG_DIR  Overrides the Claude config directory (default
 *                      ~/.claude). All plugin/mcp state the installer touches
 *                      lives under this directory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKETPLACE_NAME = 'archguard';
export const PLUGIN_ID = 'archguard@archguard';
export const PLUGIN_PACKAGE = '@yalehwang/archguard-claude-plugin';
export const CORE_PACKAGE = '@yalehwang/archguard';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/** Marker text written by the deprecated installer prototype. */
const DEPRECATED_MARKER_PREFIX = 'Deprecated:';

/**
 * A legacy ArchGuard entry is one that invoked the globally installed
 * `archguard` binary (written by the pre-TASK-35 installer as
 * `{command: 'archguard', args: ['mcp']}`). Entries launched any other way
 * (e.g. `node .../mcp-launcher.mjs`) are not legacy residue and are kept.
 */
export function isLegacyArchguardEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const command = value.command;
  const args = value.args;
  if (typeof command !== 'string' || command.length === 0) return false;
  return (
    path.basename(command) === 'archguard' &&
    Array.isArray(args) &&
    args.length === 1 &&
    args[0] === 'mcp'
  );
}

/**
 * Remove the deprecated ArchGuard registration from `~/.claude/mcp.json`
 * (or `$CLAUDE_CONFIG_DIR/mcp.json`) without touching unrelated user
 * configuration. This function never CREATES or REGISTERS anything in the
 * file; its only mutations are deletions of legacy residue.
 *
 * Returns a result object:
 *   { status, removedEntry, removedMarker, deletedFile, warnings }
 * status ∈ 'absent' | 'no-residue' | 'cleaned' | 'skipped-malformed'
 */
export function cleanupDeprecatedMcpJson(filePath) {
  const result = {
    status: 'absent',
    removedEntry: false,
    removedMarker: false,
    deletedFile: false,
    warnings: [],
  };
  if (!existsSync(filePath)) return result;

  const raw = readFileSync(filePath, 'utf8');
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    // Fail safe: never clobber a file we cannot parse.
    result.status = 'skipped-malformed';
    result.warnings.push(`${filePath} is not valid JSON; left untouched`);
    return result;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    result.status = 'skipped-malformed';
    result.warnings.push(`${filePath} is not a JSON object; left untouched`);
    return result;
  }

  const mcpServers =
    doc.mcpServers && typeof doc.mcpServers === 'object' && !Array.isArray(doc.mcpServers)
      ? doc.mcpServers
      : undefined;

  if (mcpServers && Object.prototype.hasOwnProperty.call(mcpServers, 'archguard')) {
    const entry = mcpServers.archguard;
    if (isLegacyArchguardEntry(entry)) {
      delete mcpServers.archguard;
      result.removedEntry = true;
      if (Object.keys(mcpServers).length === 0) delete doc.mcpServers;
    } else {
      result.warnings.push(
        `${filePath}: mcpServers.archguard does not match the legacy global-binary ` +
          `shape (command: ${JSON.stringify(entry?.command)}); left untouched`
      );
    }
  }

  if (
    result.removedEntry &&
    typeof doc._deprecated === 'string' &&
    doc._deprecated.startsWith(DEPRECATED_MARKER_PREFIX)
  ) {
    delete doc._deprecated;
    result.removedMarker = true;
  }

  if (!result.removedEntry && !result.removedMarker) {
    result.status = 'no-residue';
    return result;
  }

  result.status = 'cleaned';
  if (Object.keys(doc).length === 0) {
    rmSync(filePath, { force: true });
    result.deletedFile = true;
  } else {
    writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return result;
}

/** Return true when a configured marketplace already points at the requested source. */
export function marketplaceSourceMatches(marketplace, requestedSource) {
  if (!marketplace || typeof marketplace !== 'object') return false;
  if (marketplace.source === 'directory') {
    const configured = marketplace.path ?? marketplace.installLocation;
    if (typeof configured !== 'string') return false;
    return path.resolve(configured) === path.resolve(requestedSource);
  }
  if (marketplace.source === 'github') {
    const configured = marketplace.repo ?? marketplace.repository;
    return typeof configured === 'string' && configured === requestedSource;
  }
  // Claude versions may return the original source string rather than a
  // source-specific field. Compare it directly, but never infer equality from
  // the marketplace name alone.
  return typeof marketplace.source === 'string' && marketplace.source === requestedSource;
}

/**
 * Pure planning function: given the current marketplace/plugin state (as
 * reported by `claude plugin marketplace list --json` and
 * `claude plugin list --json`), decide which claude CLI invocations are
 * needed. Re-running on the post-install state yields the update path, which
 * is what makes the installer idempotent.
 */
export function planActions({ marketplaces, plugins, marketplaceSource }) {
  const actions = [];
  const marketplace = Array.isArray(marketplaces)
    ? marketplaces.find((m) => m && m.name === MARKETPLACE_NAME)
    : undefined;
  if (!marketplace) {
    actions.push({
      kind: 'marketplace-add',
      args: ['plugin', 'marketplace', 'add', marketplaceSource],
    });
  } else if (!marketplaceSourceMatches(marketplace, marketplaceSource)) {
    actions.push({
      kind: 'marketplace-remove',
      args: ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME],
    });
    actions.push({
      kind: 'marketplace-add',
      args: ['plugin', 'marketplace', 'add', marketplaceSource],
    });
  } else {
    actions.push({
      kind: 'marketplace-update',
      args: ['plugin', 'marketplace', 'update', MARKETPLACE_NAME],
    });
  }

  // Plugin list can contain the same id at multiple scopes. Only a user-scope
  // entry satisfies this user-scope installer; a project/local entry must not
  // suppress user installation or make verification pass.
  const userEntries = Array.isArray(plugins)
    ? plugins.filter((p) => p && p.id === PLUGIN_ID && p.scope === 'user')
    : [];
  if (userEntries.length > 0) {
    actions.push({
      kind: 'plugin-update',
      args: ['plugin', 'update', PLUGIN_ID, '--scope', 'user'],
    });
  } else {
    actions.push({
      kind: 'plugin-install',
      args: ['plugin', 'install', PLUGIN_ID, '--scope', 'user'],
    });
  }
  return actions;
}

/** Installed plugin entries whose name is archguard but from another marketplace. */
export function findLegacyPlugins(plugins) {
  if (!Array.isArray(plugins)) return [];
  return plugins.filter(
    (p) => p && typeof p.id === 'string' && p.id.startsWith('archguard@') && p.id !== PLUGIN_ID
  );
}

function parseJsonOutput(output, description) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`could not parse \`${description}\` output as JSON: ${error.message}`);
  }
}

export function main(
  argv,
  env = process.env,
  io = { stdout: process.stdout, stderr: process.stderr }
) {
  const log = (msg) => io.stdout.write(`[archguard-install] ${msg}\n`);
  const warn = (msg) => io.stderr.write(`[archguard-install] WARNING: ${msg}\n`);
  const fail = (msg) => {
    io.stderr.write(`[archguard-install] ERROR: ${msg}\n`);
    process.exitCode = 1;
  };

  let marketplaceSource = REPO_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--marketplace-source') {
      marketplaceSource = argv[i + 1];
      if (!marketplaceSource) {
        fail('--marketplace-source requires a value');
        return 1;
      }
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      log('usage: install-claude-user-scope.sh [--marketplace-source <src>]');
      return 0;
    } else {
      fail(`unknown argument: ${arg}`);
      return 1;
    }
  }

  let claudeDir;
  if (env.CLAUDE_CONFIG_DIR) {
    claudeDir = env.CLAUDE_CONFIG_DIR;
  } else if (env.HOME) {
    claudeDir = path.join(env.HOME, '.claude');
  } else {
    fail('HOME or CLAUDE_CONFIG_DIR is required; refusing to infer a config path from cwd');
    return 1;
  }
  const deprecatedMcpJson = path.join(claudeDir, 'mcp.json');

  const claude = (args) =>
    execFileSync('claude', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  /** Run a claude command that mutates state; surface stderr on failure. */
  const claudeMutate = (args) => {
    try {
      return claude(args);
    } catch (error) {
      const stderr = error.stderr ? String(error.stderr).trim() : '';
      const stdout = error.stdout ? String(error.stdout).trim() : '';
      throw new Error(
        `claude ${args.join(' ')} failed (exit ${error.status ?? 'unknown'})` +
          (stdout ? `\n${stdout}` : '') +
          (stderr ? `\n${stderr}` : '')
      );
    }
  };

  try {
    claude(['--version']);
  } catch {
    fail('the `claude` CLI (Claude Code) is required but was not found on PATH');
    return 1;
  }

  // Step 1: remove deprecated ~/.claude/mcp.json residue (never create it).
  const cleanup = cleanupDeprecatedMcpJson(deprecatedMcpJson);
  for (const message of cleanup.warnings) warn(message);
  if (cleanup.status === 'cleaned') {
    log(
      cleanup.deletedFile
        ? `removed legacy ArchGuard entry; deleted now-empty deprecated file: ${deprecatedMcpJson}`
        : `removed legacy ArchGuard entry from deprecated file (other entries preserved): ${deprecatedMcpJson}`
    );
  } else if (cleanup.status === 'no-residue' || cleanup.status === 'absent') {
    log(`no deprecated mcp.json residue at ${deprecatedMcpJson}`);
  }

  // Step 2: ensure the marketplace registration (add or update).
  const marketplaces = parseJsonOutput(
    claude(['plugin', 'marketplace', 'list', '--json']),
    'claude plugin marketplace list --json'
  );
  const pluginsBefore = parseJsonOutput(
    claude(['plugin', 'list', '--json']),
    'claude plugin list --json'
  );
  const actions = planActions({ marketplaces, plugins: pluginsBefore, marketplaceSource });
  try {
    for (const action of actions) {
      log(`${action.kind}: claude ${action.args.join(' ')}`);
      claudeMutate(action.args);
    }
  } catch (error) {
    fail(error.message);
    if (String(error.message).includes('E404')) {
      warn(
        `${PLUGIN_PACKAGE} is resolved from the npm registry by Claude Code. ` +
          'If you are installing from an unpublished checkout, publish the plugin/core packages ' +
          'or use a registry that serves them.'
      );
    }
    return 1;
  }

  // Step 3: ensure the plugin is enabled and exactly one instance exists.
  let plugins = parseJsonOutput(claude(['plugin', 'list', '--json']), 'claude plugin list --json');
  let entries = plugins.filter((p) => p && p.id === PLUGIN_ID && p.scope === 'user');
  if (entries.length === 0) {
    fail(`user-scope plugin ${PLUGIN_ID} not installed after install step`);
    return 1;
  }
  if (entries.length > 1) {
    fail(`expected exactly one user-scope ${PLUGIN_ID} instance, found ${entries.length}`);
    return 1;
  }
  if (!entries[0].enabled) {
    log(`enabling plugin: claude plugin enable ${PLUGIN_ID} --scope user`);
    claudeMutate(['plugin', 'enable', PLUGIN_ID, '--scope', 'user']);
    plugins = parseJsonOutput(claude(['plugin', 'list', '--json']), 'claude plugin list --json');
    entries = plugins.filter((p) => p && p.id === PLUGIN_ID && p.scope === 'user');
  }
  const enabled = entries.filter((e) => e.enabled);
  if (enabled.length !== 1) {
    fail(`expected exactly one enabled user-scope ${PLUGIN_ID} instance, found ${enabled.length}`);
    return 1;
  }

  for (const legacy of findLegacyPlugins(plugins)) {
    warn(
      `legacy archguard plugin from another marketplace is still installed: ${legacy.id}. ` +
        `Remove it manually with: claude plugin uninstall ${legacy.id}`
    );
  }

  log('done');
  log(`  marketplace: ${MARKETPLACE_NAME}`);
  log(`  plugin:      ${PLUGIN_ID} v${enabled[0].version} (enabled, ${enabled[0].scope} scope)`);
  log('  restart Claude Code to load the plugin, then verify with: claude mcp list');
  return 0;
}

const isDirectRun = (() => {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return invoked === fileURLToPath(import.meta.url);
})();

if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}
