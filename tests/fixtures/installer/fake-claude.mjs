#!/usr/bin/env node
/**
 * fake-claude.mjs — stateful stand-in for the `claude` CLI used by
 * tests/integration/installer-claude-user-scope.test.ts.
 *
 * Simulates the plugin marketplace/plugin command surface that
 * scripts/install-claude-user-scope.mjs drives, with state stored under
 * $CLAUDE_CONFIG_DIR (isolated temp dir per test) and every invocation
 * appended as a JSON line to $FAKE_CLAUDE_LOG for assertions.
 *
 * Marketplace sources are local directories containing
 * .claude-plugin/marketplace.json (mirroring the real directory-source
 * marketplace the installer registers from a checkout). Plugin versions come
 * from the marketplace manifest's entry, so "upgrades" work by editing the
 * fixture manifest between runs.
 *
 * JSON output shapes mirror claude 2.1.220:
 *   plugin marketplace list --json → [{name, source, path, installLocation}]
 *   plugin list --json             → [{id, version, scope, enabled, installPath, ...}]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const configDir = process.env.CLAUDE_CONFIG_DIR;
if (!configDir) {
  console.error('fake-claude: CLAUDE_CONFIG_DIR is required');
  process.exit(2);
}
const statePath = path.join(configDir, 'fake-claude-state.json');

if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
}

function loadState() {
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath, 'utf8'));
  return { marketplaces: [], plugins: [] };
}

function saveState(state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);

// Strip global flags we accept anywhere, retaining the requested scope so the
// fake can model duplicate ids installed at different scopes.
function takeFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0) args.splice(idx, 1);
  return idx >= 0;
}
const wantJson = takeFlag('--json');
let requestedScope = 'user';
for (const flag of ['--scope', '-s']) {
  let idx = args.indexOf(flag);
  while (idx >= 0) {
    requestedScope = args[idx + 1] ?? requestedScope;
    args.splice(idx, 2);
    idx = args.indexOf(flag);
  }
}

const state = loadState();

function marketplaceManifest(marketplace) {
  const root = marketplace.path ?? process.env.FAKE_GITHUB_MARKETPLACE_DIR;
  const manifestPath = path.join(root, '.claude-plugin', 'marketplace.json');
  if (!existsSync(manifestPath)) fail(`marketplace manifest missing: ${manifestPath}`);
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

if (args[0] === '--version') {
  console.log('2.1.220 (fake-claude)');
} else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const source = args[3];
  const isDirectory = Boolean(
    source && existsSync(path.join(source, '.claude-plugin', 'marketplace.json'))
  );
  const githubRoot = process.env.FAKE_GITHUB_MARKETPLACE_DIR;
  if (!source || (!isDirectory && source !== 'yaleh/archguard')) {
    fail(`unsupported marketplace source: ${source}`);
  }
  const manifestRoot = isDirectory ? source : githubRoot;
  if (!manifestRoot || !existsSync(path.join(manifestRoot, '.claude-plugin', 'marketplace.json'))) {
    fail(`marketplace manifest unavailable for source: ${source}`);
  }
  const manifest = JSON.parse(
    readFileSync(path.join(manifestRoot, '.claude-plugin', 'marketplace.json'), 'utf8')
  );
  const existing = state.marketplaces.find((m) => m.name === manifest.name);
  if (existing) {
    console.log(`Marketplace '${manifest.name}' already on disk — declared in user settings`);
  } else {
    state.marketplaces.push({
      name: manifest.name,
      source: isDirectory ? 'directory' : 'github',
      ...(isDirectory ? { path: source } : { repo: source }),
      installLocation: isDirectory ? source : manifestRoot,
      lastUpdated: new Date().toISOString(),
    });
    saveState(state);
    console.log(`Successfully added marketplace: ${manifest.name} (declared in user settings)`);
  }
} else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') {
  const name = args[3];
  const idx = state.marketplaces.findIndex((m) => m.name === name);
  if (idx < 0) fail(`Marketplace '${name}' not found`);
  state.marketplaces.splice(idx, 1);
  saveState(state);
  console.log(`Removed marketplace: ${name}`);
} else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'update') {
  const name = args[3];
  const targets = name ? state.marketplaces.filter((m) => m.name === name) : state.marketplaces;
  if (name && targets.length === 0) fail(`Marketplace '${name}' not found`);
  for (const m of targets) m.lastUpdated = new Date().toISOString();
  saveState(state);
  console.log(`Updated ${targets.length} marketplace(s)`);
} else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
  if (wantJson) {
    console.log(
      JSON.stringify(
        state.marketplaces.map(({ name, source, path: p, repo, installLocation }) => ({
          name,
          source,
          ...(p ? { path: p } : {}),
          ...(repo ? { repo } : {}),
          installLocation,
        })),
        null,
        2
      )
    );
  } else {
    console.log('Configured marketplaces:\n');
    for (const m of state.marketplaces) {
      console.log(`  ❯ ${m.name}\n    Source: Directory (${m.path})`);
    }
  }
} else if (args[0] === 'plugin' && args[1] === 'install') {
  const id = args[2];
  const [pluginName, marketplaceName] = String(id).split('@');
  const marketplace = state.marketplaces.find((m) => m.name === marketplaceName);
  if (!marketplace) fail(`Marketplace '${marketplaceName}' not found`);
  const manifest = marketplaceManifest(marketplace);
  const entry = (manifest.plugins || []).find((p) => p.name === pluginName);
  if (!entry) fail(`Plugin '${pluginName}' not found in marketplace '${marketplaceName}'`);
  const version = entry.version ?? entry.source?.version;
  if (!version) fail(`Plugin '${pluginName}' in marketplace '${marketplaceName}' has no version`);
  const existing = state.plugins.find((p) => p.id === id && p.scope === requestedScope);
  if (existing) {
    console.log(`Plugin "${id}" is already installed`);
  } else {
    const now = new Date().toISOString();
    state.plugins.push({
      id,
      version,
      scope: requestedScope,
      enabled: true,
      installPath: path.join(configDir, 'plugins', 'cache', marketplaceName, pluginName, version),
      installedAt: now,
      lastUpdated: now,
    });
    saveState(state);
    console.log(`Installed plugin "${id}" v${version} (user scope, enabled)`);
  }
} else if (args[0] === 'plugin' && args[1] === 'update') {
  const id = args[2];
  const [pluginName, marketplaceName] = String(id).split('@');
  const plugin = state.plugins.find((p) => p.id === id && p.scope === requestedScope);
  if (!plugin) fail(`Plugin "${pluginName}" is not installed`);
  const marketplace = state.marketplaces.find((m) => m.name === marketplaceName);
  if (!marketplace) fail(`Marketplace '${marketplaceName}' not found`);
  const manifest = marketplaceManifest(marketplace);
  const entry = (manifest.plugins || []).find((p) => p.name === pluginName);
  const version = entry?.version ?? entry?.source?.version;
  if (!version) fail(`Plugin '${pluginName}' in marketplace '${marketplaceName}' has no version`);
  plugin.version = version;
  plugin.lastUpdated = new Date().toISOString();
  plugin.installPath = path.join(
    configDir,
    'plugins',
    'cache',
    marketplaceName,
    pluginName,
    version
  );
  saveState(state);
  console.log(`Plugin "${id}" updated to v${version}`);
} else if (args[0] === 'plugin' && args[1] === 'list') {
  if (wantJson) {
    console.log(JSON.stringify(state.plugins, null, 2));
  } else if (state.plugins.length === 0) {
    console.log('No plugins installed. Use `claude plugin install` to install a plugin.');
  } else {
    for (const p of state.plugins) {
      console.log(`  ${p.enabled ? '✔' : '✘'} ${p.id} v${p.version} (${p.scope})`);
    }
  }
} else if (args[0] === 'plugin' && args[1] === 'enable') {
  const plugin = state.plugins.find((p) => p.id === args[2]);
  if (!plugin) fail(`Plugin "${args[2]}" is not installed`);
  plugin.enabled = true;
  saveState(state);
  console.log(`Enabled plugin "${args[2]}"`);
} else if (args[0] === 'plugin' && args[1] === 'disable') {
  const plugin = state.plugins.find((p) => p.id === args[2]);
  if (!plugin) fail(`Plugin "${args[2]}" is not installed`);
  plugin.enabled = false;
  saveState(state);
  console.log(`Disabled plugin "${args[2]}"`);
} else if (args[0] === 'plugin' && args[1] === 'uninstall') {
  const idx = state.plugins.findIndex((p) => p.id === args[2]);
  if (idx < 0) fail(`Plugin "${args[2]}" is not installed`);
  state.plugins.splice(idx, 1);
  saveState(state);
  console.log(`Uninstalled plugin "${args[2]}"`);
} else {
  fail(`fake-claude: unsupported command: ${args.join(' ')}`);
}
