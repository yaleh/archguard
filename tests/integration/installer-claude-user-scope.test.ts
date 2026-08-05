/**
 * Integration: user-scope npm-source Claude plugin installer (TASK-35).
 *
 * Covers scripts/install-claude-user-scope.sh (+ its .mjs implementation):
 *
 * REAL (no simulation):
 * - Deprecated ~/.claude/mcp.json residue cleanup against temp fixtures:
 *   legacy global-binary archguard entries removed, unrelated MCP servers and
 *   top-level keys preserved, byte-identical no-op when there is no residue,
 *   malformed files never clobbered.
 * - End-to-end installer runs against an isolated CLAUDE_CONFIG_DIR/HOME with
 *   a stateful fake `claude` binary (tests/fixtures/installer/fake-claude.mjs)
 *   that mirrors claude 2.1.220's command surface and --json shapes. What is
 *   simulated here is ONLY the claude CLI itself; the installer's own logic
 *   (planning, idempotency, verification, cleanup) is the real code.
 * - An end-to-end run against the REAL claude CLI in an isolated config dir:
 *   marketplace registration succeeds for real and the published
 *   @yalehwang/archguard-claude-plugin package installs at user scope, so the
 *   full "claude mcp list reports connected" flow for TASK-35 now completes.
 *
 * The installer never touches the real user configuration: every run sets
 * HOME and CLAUDE_CONFIG_DIR to temp dirs.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  cleanupDeprecatedMcpJson,
  planActions,
  isLegacyArchguardEntry,
  findLegacyPlugins,
  marketplaceSourceMatches,
  PLUGIN_ID,
  MARKETPLACE_NAME,
  PLUGIN_PACKAGE,
} from '../../scripts/install-claude-user-scope.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../..');
const installerMjs = path.join(repoRoot, 'scripts', 'install-claude-user-scope.mjs');
const installerSh = path.join(repoRoot, 'scripts', 'install-claude-user-scope.sh');
const fakeClaudeScript = path.join(repoRoot, 'tests', 'fixtures', 'installer', 'fake-claude.mjs');

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Deprecated mcp.json cleanup (pure, fixture-driven)
// ---------------------------------------------------------------------------

describe('cleanupDeprecatedMcpJson', () => {
  const LEGACY_ENTRY = { command: 'archguard', args: ['mcp'] };
  const MARKER =
    'Deprecated: Use .mcp.json at plugin root instead. This file is kept for backwards compatibility with manual installations and will be removed in a future release.';

  function seed(doc: unknown): string {
    const dir = makeTempDir('archguard-mcp-fixture-');
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return file;
  }

  it('reports absent when the file does not exist', () => {
    const file = path.join(makeTempDir('archguard-mcp-fixture-'), 'mcp.json');
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('absent');
    expect(existsSync(file)).toBe(false);
  });

  it('deletes the file when it contained only the legacy archguard entry and marker', () => {
    const file = seed({ mcpServers: { archguard: LEGACY_ENTRY }, _deprecated: MARKER });
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('cleaned');
    expect(result.removedEntry).toBe(true);
    expect(result.removedMarker).toBe(true);
    expect(result.deletedFile).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('removes only the archguard residue and preserves unrelated MCP entries and keys', () => {
    const file = seed({
      mcpServers: {
        archguard: LEGACY_ENTRY,
        github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'] },
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
      },
      _deprecated: MARKER,
      someOtherSetting: { keep: 'me' },
    });
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('cleaned');
    expect(result.deletedFile).toBe(false);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    expect(doc.mcpServers.archguard).toBeUndefined();
    expect(doc._deprecated).toBeUndefined();
    expect(doc.mcpServers.github).toEqual({
      command: 'docker',
      args: ['run', 'ghcr.io/github/github-mcp-server'],
    });
    expect(doc.mcpServers.context7).toEqual({
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
    expect(doc.someOtherSetting).toEqual({ keep: 'me' });
  });

  it('leaves a residue-free file byte-identical', () => {
    const file = seed({ mcpServers: { github: { command: 'docker', args: [] } }, custom: 1 });
    const before = readFileSync(file, 'utf8');
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('no-residue');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('never clobbers malformed JSON', () => {
    const dir = makeTempDir('archguard-mcp-fixture-');
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, '{ this is not json ');
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('skipped-malformed');
    expect(readFileSync(file, 'utf8')).toBe('{ this is not json ');
  });

  it('keeps an archguard entry that is not the legacy global-binary shape', () => {
    const file = seed({
      mcpServers: {
        archguard: { command: 'node', args: ['/opt/plugins/archguard/mcp-launcher.mjs'] },
      },
    });
    const before = readFileSync(file, 'utf8');
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('no-residue');
    expect(result.warnings.length).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('preserves ArchGuard commands that are not MCP registrations', () => {
    for (const entry of [
      { command: '/opt/archguard', args: ['serve'] },
      { command: 'archguard', args: [] },
      { command: 'archguard' },
      { command: 'archguard', args: ['mcp', '--other'] },
    ]) {
      const file = seed({ mcpServers: { archguard: entry }, _deprecated: MARKER });
      const before = readFileSync(file, 'utf8');
      const result = cleanupDeprecatedMcpJson(file);
      expect(result.status).toBe('no-residue');
      expect(result.removedEntry).toBe(false);
      expect(result.removedMarker).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe(before);
    }
  });

  it('keeps an unrelated top-level _deprecated marker unless it removes ArchGuard MCP residue', () => {
    const file = seed({ _deprecated: MARKER, custom: true });
    const before = readFileSync(file, 'utf8');
    const result = cleanupDeprecatedMcpJson(file);
    expect(result.status).toBe('no-residue');
    expect(result.removedMarker).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('is idempotent: a second run finds no residue', () => {
    const file = seed({ mcpServers: { archguard: LEGACY_ENTRY, other: { command: 'x' } } });
    expect(cleanupDeprecatedMcpJson(file).status).toBe('cleaned');
    expect(cleanupDeprecatedMcpJson(file).status).toBe('no-residue');
  });

  it('recognizes absolute-path global-binary entries as legacy', () => {
    expect(isLegacyArchguardEntry({ command: '/usr/local/bin/archguard', args: ['mcp'] })).toBe(
      true
    );
    expect(isLegacyArchguardEntry({ command: 'archguard', args: ['mcp'] })).toBe(true);
    expect(isLegacyArchguardEntry({ command: 'archguard', args: ['serve'] })).toBe(false);
    expect(isLegacyArchguardEntry({ command: 'archguard' })).toBe(false);
    expect(isLegacyArchguardEntry({ command: 'node', args: ['mcp-launcher.mjs'] })).toBe(false);
    expect(isLegacyArchguardEntry('archguard')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Action planning (pure)
// ---------------------------------------------------------------------------

describe('planActions', () => {
  const SRC = '/checkout';

  it('plans marketplace add + plugin install on a clean slate', () => {
    const actions = planActions({ marketplaces: [], plugins: [], marketplaceSource: SRC });
    expect(actions.map((a) => a.kind)).toEqual(['marketplace-add', 'plugin-install']);
    expect(actions[0].args).toEqual(['plugin', 'marketplace', 'add', SRC]);
    expect(actions[1].args).toContain(PLUGIN_ID);
  });

  it('plans marketplace update + plugin update on a second run (idempotency)', () => {
    const actions = planActions({
      marketplaces: [{ name: MARKETPLACE_NAME, source: 'directory', path: SRC }],
      plugins: [{ id: PLUGIN_ID, version: '0.1.31', scope: 'user', enabled: true }],
      marketplaceSource: SRC,
    });
    expect(actions.map((a) => a.kind)).toEqual(['marketplace-update', 'plugin-update']);
  });

  it('installs the plugin when the marketplace exists but the plugin does not', () => {
    const actions = planActions({
      marketplaces: [{ name: MARKETPLACE_NAME, source: 'directory', path: SRC }],
      plugins: [],
      marketplaceSource: SRC,
    });
    expect(actions.map((a) => a.kind)).toEqual(['marketplace-update', 'plugin-install']);
  });

  it('plans remove + add when the requested marketplace source changed', () => {
    const actions = planActions({
      marketplaces: [{ name: MARKETPLACE_NAME, source: 'directory', path: SRC }],
      plugins: [{ id: PLUGIN_ID, scope: 'user', enabled: true }],
      marketplaceSource: 'yaleh/archguard',
    });
    expect(actions.map((a) => a.kind)).toEqual([
      'marketplace-remove',
      'marketplace-add',
      'plugin-update',
    ]);
    expect(actions[1].args).toEqual(['plugin', 'marketplace', 'add', 'yaleh/archguard']);
    expect(marketplaceSourceMatches({ source: 'directory', path: SRC }, SRC)).toBe(true);
    expect(marketplaceSourceMatches({ source: 'github', repo: 'yaleh/archguard' }, SRC)).toBe(
      false
    );
  });

  it('treats only user-scope plugin state as satisfying the installer', () => {
    const actions = planActions({
      marketplaces: [{ name: MARKETPLACE_NAME, source: 'directory', path: SRC }],
      plugins: [{ id: PLUGIN_ID, version: '0.1.31', scope: 'project', enabled: true }],
      marketplaceSource: SRC,
    });
    expect(actions.map((a) => a.kind)).toEqual(['marketplace-update', 'plugin-install']);
    expect(actions[1].args).toEqual(['plugin', 'install', PLUGIN_ID, '--scope', 'user']);
  });

  it('ignores legacy archguard plugins from other marketplaces when planning', () => {
    const actions = planActions({
      marketplaces: [],
      plugins: [{ id: 'archguard@archguard-marketplace', version: '0.1.31', enabled: true }],
      marketplaceSource: SRC,
    });
    expect(actions.map((a) => a.kind)).toEqual(['marketplace-add', 'plugin-install']);
    expect(
      findLegacyPlugins([
        { id: 'archguard@archguard-marketplace' },
        { id: PLUGIN_ID },
        { id: 'quay@quay-marketplace' },
      ]).map((p) => p.id)
    ).toEqual(['archguard@archguard-marketplace']);
  });
});

// ---------------------------------------------------------------------------
// Installer end-to-end with the fake claude CLI (isolated config dirs)
// ---------------------------------------------------------------------------

interface FakeEnv {
  home: string;
  configDir: string;
  binDir: string;
  marketplaceDir: string;
  logPath: string;
  extraEnv?: Record<string, string>;
}

function writeMarketplaceManifest(dir: string, version: string): void {
  mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(dir, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify(
      {
        $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
        name: MARKETPLACE_NAME,
        owner: { name: 'test' },
        plugins: [
          {
            name: 'archguard',
            source: { source: 'npm', package: PLUGIN_PACKAGE, version },
            description: 'fixture',
          },
        ],
      },
      null,
      2
    )}\n`
  );
}

function makeFakeEnv(marketplaceVersion = '0.1.31'): FakeEnv {
  const root = makeTempDir('archguard-installer-test-');
  const home = path.join(root, 'home');
  const configDir = path.join(root, 'claude-config');
  const binDir = path.join(root, 'bin');
  const marketplaceDir = path.join(root, 'marketplace');
  const logPath = path.join(root, 'claude-calls.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeMarketplaceManifest(marketplaceDir, marketplaceVersion);
  const shim = path.join(binDir, 'claude');
  writeFileSync(shim, `#!/bin/sh\nexec node "${fakeClaudeScript}" "$@"\n`);
  chmodSync(shim, 0o755);
  return { home, configDir, binDir, marketplaceDir, logPath };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runInstaller(
  env: FakeEnv,
  extraArgs: string[] = [],
  viaWrapper = false
): Promise<RunResult> {
  const args = viaWrapper
    ? [installerSh, '--marketplace-source', env.marketplaceDir, ...extraArgs]
    : [installerMjs, '--marketplace-source', env.marketplaceDir, ...extraArgs];
  const command = viaWrapper ? 'bash' : process.execPath;
  // PATH: fake claude shim + the node runtime's own dir + system dirs. No
  // `archguard`, no `npm` guarantee needed beyond what system dirs provide.
  const PATH = `${env.binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin`;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: {
        PATH,
        HOME: env.home,
        CLAUDE_CONFIG_DIR: env.configDir,
        FAKE_CLAUDE_LOG: env.logPath,
        ...(env.extraEnv ?? {}),
      },
      timeout: 60_000,
    });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: err.code ?? 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    };
  }
}

function fakeState(env: FakeEnv): {
  marketplaces: unknown[];
  plugins: Array<Record<string, unknown>>;
} {
  return JSON.parse(readFileSync(path.join(env.configDir, 'fake-claude-state.json'), 'utf8'));
}

function claudeCalls(env: FakeEnv): string[][] {
  if (!existsSync(env.logPath)) return [];
  return readFileSync(env.logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('installer with fake claude CLI (isolated config)', () => {
  it('clean install registers the marketplace and installs one enabled plugin', async () => {
    const env = makeFakeEnv();
    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const state = fakeState(env);
    expect(state.marketplaces.length).toBe(1);
    expect(state.plugins.length).toBe(1);
    expect(state.plugins[0]).toMatchObject({
      id: PLUGIN_ID,
      version: '0.1.31',
      enabled: true,
      scope: 'user',
    });
    // The deprecated mcp.json is never created.
    expect(existsSync(path.join(env.configDir, 'mcp.json'))).toBe(false);
    expect(existsSync(path.join(env.home, '.claude'))).toBe(false);
  });

  it('works through the .sh wrapper and requires no archguard binary on PATH', async () => {
    const env = makeFakeEnv();
    // PATH contains only the fake bin dir and system dirs: no `archguard`,
    // no `npm` requirement (the installer must not need either).
    expect(() =>
      execFileSync('env', [`PATH=${env.binDir}:/usr/bin:/bin`, 'which', 'archguard'], {
        stdio: 'pipe',
      })
    ).toThrow();
    const result = await runInstaller(env, [], true);
    expect(result.code, result.stderr).toBe(0);
    expect(fakeState(env).plugins[0]).toMatchObject({ id: PLUGIN_ID, enabled: true });
  });

  it('running the installer twice succeeds and leaves one enabled plugin', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env)).code).toBe(0);
    expect((await runInstaller(env)).code).toBe(0);
    const state = fakeState(env);
    expect(state.marketplaces.length).toBe(1);
    expect(state.plugins.length).toBe(1);
    expect(state.plugins[0]).toMatchObject({ id: PLUGIN_ID, enabled: true });
    // Second run took the update path, not add/install.
    const calls = claudeCalls(env);
    const addCount = calls.filter(
      (c) => c.join(' ') === 'plugin marketplace add ' + env.marketplaceDir
    ).length;
    const updateMarketplace = calls.filter(
      (c) => c.slice(0, 3).join(' ') === 'plugin marketplace update'
    ).length;
    const installCount = calls.filter((c) => c[1] === 'install').length;
    const updatePlugin = calls.filter((c) => c[1] === 'update').length;
    expect(addCount).toBe(1);
    expect(installCount).toBe(1);
    expect(updateMarketplace).toBe(1);
    expect(updatePlugin).toBe(1);
  });

  it('upgrades an older installed plugin version in place', async () => {
    const env = makeFakeEnv('0.1.30');
    expect((await runInstaller(env)).code).toBe(0);
    expect(fakeState(env).plugins[0].version).toBe('0.1.30');
    // Marketplace now serves a newer version; re-running updates the plugin.
    writeMarketplaceManifest(env.marketplaceDir, '0.1.31');
    const second = await runInstaller(env);
    expect(second.code, second.stderr).toBe(0);
    const state = fakeState(env);
    expect(state.plugins.length).toBe(1);
    expect(state.plugins[0]).toMatchObject({ id: PLUGIN_ID, version: '0.1.31', enabled: true });
  });

  it('re-enables a disabled plugin instead of installing a duplicate', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env)).code).toBe(0);
    execFileSync(path.join(env.binDir, 'claude'), ['plugin', 'disable', PLUGIN_ID], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: env.configDir },
    });
    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const state = fakeState(env);
    expect(state.plugins.length).toBe(1);
    expect(state.plugins[0].enabled).toBe(true);
  });

  it('project-enabled/user-disabled re-enables user scope explicitly and does not pass on project state', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env)).code).toBe(0);
    const statePath = path.join(env.configDir, 'fake-claude-state.json');
    const state = fakeState(env);
    state.plugins[0].enabled = false;
    state.plugins.push({
      ...state.plugins[0],
      scope: 'project',
      enabled: true,
      installPath: '/tmp/project-plugin',
    });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const final = fakeState(env).plugins;
    expect(final.find((p) => p.scope === 'user')).toMatchObject({ enabled: true });
    expect(final.find((p) => p.scope === 'project')).toMatchObject({ enabled: true });
    const calls = claudeCalls(env);
    expect(calls).toContainEqual(['plugin', 'enable', PLUGIN_ID, '--scope', 'user']);
    expect(calls).toContainEqual(['plugin', 'update', PLUGIN_ID, '--scope', 'user']);
  });

  it('project-only plugin state installs a separate user-scope instance', async () => {
    const env = makeFakeEnv();
    // Register marketplace first so the project fixture is a valid state.
    execFileSync(
      path.join(env.binDir, 'claude'),
      ['plugin', 'marketplace', 'add', env.marketplaceDir],
      {
        env: { ...process.env, CLAUDE_CONFIG_DIR: env.configDir },
      }
    );
    execFileSync(
      path.join(env.binDir, 'claude'),
      ['plugin', 'install', PLUGIN_ID, '--scope', 'project'],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: env.configDir } }
    );
    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const plugins = fakeState(env).plugins;
    expect(plugins.filter((p) => p.scope === 'user')).toHaveLength(1);
    expect(plugins.filter((p) => p.scope === 'project')).toHaveLength(1);
    expect(claudeCalls(env)).toContainEqual(['plugin', 'install', PLUGIN_ID, '--scope', 'user']);
  });

  it('switches a stale checkout marketplace source to the requested GitHub source', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env)).code).toBe(0);
    env.extraEnv = { FAKE_GITHUB_MARKETPLACE_DIR: env.marketplaceDir };
    const second = await runInstaller(env, ['--marketplace-source', 'yaleh/archguard']);
    expect(second.code, second.stderr).toBe(0);
    expect(fakeState(env).marketplaces).toEqual([
      expect.objectContaining({
        name: MARKETPLACE_NAME,
        source: 'github',
        repo: 'yaleh/archguard',
      }),
    ]);
    const calls = claudeCalls(env);
    expect(calls).toContainEqual(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME]);
    expect(calls).toContainEqual(['plugin', 'marketplace', 'add', 'yaleh/archguard']);
  });

  it('refuses to infer .claude under cwd when HOME and CLAUDE_CONFIG_DIR are absent', async () => {
    const env = makeFakeEnv();
    const cwd = makeTempDir('archguard-no-home-');
    const localClaude = path.join(cwd, '.claude');
    mkdirSync(localClaude, { recursive: true });
    const residue = path.join(localClaude, 'mcp.json');
    writeFileSync(
      residue,
      JSON.stringify({ mcpServers: { archguard: { command: 'archguard', args: ['mcp'] } } })
    );
    let code = 0;
    let stderr = '';
    try {
      await execFileAsync(process.execPath, [installerMjs], {
        cwd,
        env: { PATH: `${env.binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin` },
      });
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      code = err.code ?? 1;
      stderr = String(err.stderr ?? '');
    }
    expect(code).toBe(1);
    expect(stderr).toContain('HOME or CLAUDE_CONFIG_DIR is required');
    expect(existsSync(residue)).toBe(true);
  });

  it('removes deprecated mcp.json residue during install, preserving unrelated entries', async () => {
    const env = makeFakeEnv();
    writeFileSync(
      path.join(env.configDir, 'mcp.json'),
      `${JSON.stringify(
        {
          mcpServers: {
            archguard: { command: 'archguard', args: ['mcp'] },
            github: { command: 'docker', args: ['run', 'github-mcp'] },
          },
          _deprecated: 'Deprecated: Use .mcp.json at plugin root instead.',
          untouched: true,
        },
        null,
        2
      )}\n`
    );
    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const doc = JSON.parse(readFileSync(path.join(env.configDir, 'mcp.json'), 'utf8'));
    expect(doc.mcpServers.archguard).toBeUndefined();
    expect(doc.mcpServers.github).toEqual({ command: 'docker', args: ['run', 'github-mcp'] });
    expect(doc.untouched).toBe(true);
    expect(doc._deprecated).toBeUndefined();
  });

  it('deletes a deprecated mcp.json that held only archguard residue', async () => {
    const env = makeFakeEnv();
    writeFileSync(
      path.join(env.configDir, 'mcp.json'),
      `${JSON.stringify({ mcpServers: { archguard: { command: 'archguard', args: ['mcp'] } } })}\n`
    );
    expect((await runInstaller(env)).code).toBe(0);
    expect(existsSync(path.join(env.configDir, 'mcp.json'))).toBe(false);
  });

  it('fails loudly when the plugin cannot be installed from the marketplace', async () => {
    const env = makeFakeEnv();
    // Break the marketplace: remove the plugin entry.
    writeFileSync(
      path.join(env.marketplaceDir, '.claude-plugin', 'marketplace.json'),
      `${JSON.stringify({ name: MARKETPLACE_NAME, owner: { name: 'test' }, plugins: [] })}\n`
    );
    const result = await runInstaller(env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('plugin install');
  });
});

// ---------------------------------------------------------------------------
// Static invariants: no global install, no native runtime mutation, no
// deprecated-file registration.
// ---------------------------------------------------------------------------

describe('installer static invariants', () => {
  const sources = [installerSh, installerMjs].map((f) => readFileSync(f, 'utf8'));

  it('never invokes npm (no global install, no pack, no native builds)', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/npm\s+(install|i)\s+(-g|--global)/);
      expect(source).not.toMatch(/npm\s+pack/);
      expect(source).not.toMatch(/npm\s+run\s+build/);
      expect(source).not.toMatch(/execFileSync\(\s*['"]npm['"]/);
      expect(source).not.toMatch(/-g\b|--global/);
    }
  });

  it('does not require a global archguard binary', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/command -v archguard/);
    }
  });

  it('never references native tree-sitter package installation', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/tree-sitter-(go|java|python|cpp|kotlin)/);
      expect(source).not.toMatch(/node-gyp/);
    }
  });

  it('the .sh wrapper never touches mcp.json (executable lines only)', () => {
    const wrapper = readFileSync(installerSh, 'utf8');
    const executableLines = wrapper
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(executableLines).not.toContain('mcp.json');
  });
});

// ---------------------------------------------------------------------------
// Real claude CLI end-to-end run (isolated config). Everything is real:
// marketplace registration and install of the published
// @yalehwang/archguard-claude-plugin package at user scope.
// ---------------------------------------------------------------------------

describe('real claude CLI boundary (isolated config)', () => {
  const realClaudeAvailable = (() => {
    try {
      execFileSync('claude', ['--version'], { stdio: 'pipe', timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!realClaudeAvailable)(
    'registers the marketplace for real, cleans residue, and installs the published plugin at user scope (success path)',
    async () => {
      const root = makeTempDir('archguard-installer-real-');
      const home = path.join(root, 'home');
      const configDir = path.join(root, 'claude-config');
      const npmUserConfig = path.join(root, 'empty-npmrc');
      mkdirSync(home, { recursive: true });
      mkdirSync(configDir, { recursive: true });
      writeFileSync(npmUserConfig, 'registry=https://registry.npmjs.org/\nalways-auth=false\n');

      // Start with a deliberately minimal environment: retain only executable
      // lookup/runtime essentials; scrub registry/auth credentials so the
      // install proves the package resolves from the public registry.
      const isolatedEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: home,
        CLAUDE_CONFIG_DIR: configDir,
        NPM_CONFIG_USERCONFIG: npmUserConfig,
        NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
        NPM_CONFIG_ALWAYS_AUTH: 'false',
        NPM_CONFIG_PREFER_OFFLINE: 'true',
        NPM_CONFIG_TOKEN: '',
        NODE_AUTH_TOKEN: '',
      };
      // Deprecated residue is cleaned regardless; the install then succeeds.
      writeFileSync(
        path.join(configDir, 'mcp.json'),
        `${JSON.stringify({
          mcpServers: {
            archguard: { command: 'archguard', args: ['mcp'] },
            github: { command: 'docker', args: ['run', 'github-mcp'] },
          },
        })}\n`
      );

      let code = 0;
      let stdout = '';
      let stderr = '';
      try {
        const out = await execFileAsync(
          process.execPath,
          [installerMjs, '--marketplace-source', repoRoot],
          {
            env: isolatedEnv,
            timeout: 180_000,
          }
        );
        stdout = String(out.stdout);
        stderr = String(out.stderr);
      } catch (error) {
        const err = error as { code?: number; stdout?: string; stderr?: string };
        code = err.code ?? 1;
        stdout = String(err.stdout ?? '');
        stderr = String(err.stderr ?? '');
      }

      const combined = `${stdout}\n${stderr}`;
      // Success path: the published package resolves and installs from the
      // public registry, and the installer reports the enabled user-scope plugin.
      expect(code, `expected a successful install:\n${combined}`).toBe(0);
      expect(combined).toContain(PLUGIN_ID);
      expect(combined).toContain('(enabled, user scope)');
      expect(combined).toContain('done');
      // Guard: a network/auth/npm failure must not be mistaken for success.
      expect(combined).not.toMatch(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|E401|E403|E404/i);

      // Everything in the real flow succeeded:
      const marketplacesJson = execFileSync('claude', ['plugin', 'marketplace', 'list', '--json'], {
        env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configDir },
        encoding: 'utf8',
        timeout: 60_000,
      });
      const marketplaces = JSON.parse(marketplacesJson) as Array<{ name: string }>;
      expect(marketplaces.map((m) => m.name)).toContain(MARKETPLACE_NAME);

      // Residue cleaned, unrelated entry preserved, and the deprecated file
      // was never re-created with a registration.
      const doc = JSON.parse(readFileSync(path.join(configDir, 'mcp.json'), 'utf8'));
      expect(doc.mcpServers.archguard).toBeUndefined();
      expect(doc.mcpServers.github).toEqual({ command: 'docker', args: ['run', 'github-mcp'] });
    },
    240_000
  );
});
