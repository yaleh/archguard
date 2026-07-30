/**
 * Integration: user-scope Codex MCP registration installer (TASK-36).
 *
 * Covers scripts/install-codex-user-scope.sh (+ its .mjs implementation):
 *
 * REAL (no simulation):
 * - TOML document editing against temp fixtures: idempotent upsert of exactly
 *   one [mcp_servers.archguard] table, in-place update (never duplicate),
 *   byte-for-byte preservation of unrelated top-level keys and other
 *   [mcp_servers.*] tables, removal of duplicate/archguard subtables, and a
 *   line-preserving parse/serialize round-trip.
 * - Target policy: the registered entry is validated to never point into
 *   Claude's versioned plugin cache (~/.claude/plugins/cache) or the ArchGuard
 *   source checkout; it must be an npm-installed ArchGuard.
 * - End-to-end installer runs against an isolated CODEX_HOME/HOME with a
 *   stateful fake `codex` binary (tests/fixtures/installer/fake-codex.mjs)
 *   that mirrors codex-cli 0.146.0's `mcp list --json` shape and reads the
 *   live config.toml with its OWN independent TOML parser (a cross-check on
 *   what the installer wrote). What is simulated here is ONLY the codex CLI;
 *   the installer's own logic (resolution, TOML upsert, self-verification,
 *   target validation) is the real code.
 * - A boundary run against the REAL codex CLI plus a REAL MCP stdio handshake
 *   (initialize + tools/list + archguard_summary + archguard_analyze) against
 *   the globally npm-installed @yalehwang/archguard, in an isolated config
 *   dir. This is the documented real connection + tool-call evidence.
 *
 * The installer never touches the real user configuration: every run sets
 * HOME and/or CODEX_HOME to temp dirs.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, execFileSync, execFile } from 'node:child_process';
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
  parseDoc,
  serializeDoc,
  normalizeKey,
  upsertArchguardEntry,
  readArchguardEntry,
  removeArchguardEntry,
  countArchguardSections,
  buildEntry,
  renderEntryLines,
  validateEntryTarget,
  resolveCliEntry,
  resolveConfigPath,
  parseTomlValue,
  parseSectionKV,
  SERVER_NAME,
  CORE_PACKAGE,
  CLI_SUBPATH,
  PARSER_RUNTIME_VALUES,
} from '../../scripts/install-codex-user-scope.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../..');
const installerMjs = path.join(repoRoot, 'scripts', 'install-codex-user-scope.mjs');
const installerSh = path.join(repoRoot, 'scripts', 'install-codex-user-scope.sh');
const fakeCodexScript = path.join(repoRoot, 'tests', 'fixtures', 'installer', 'fake-codex.mjs');

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const UNRELATED_CONFIG = `model = "gpt-5-codex"
approval_policy = "never"

[mcp_servers.github]
command = "docker"
args = ["run", "ghcr.io/github/github-mcp-server"]

[sandbox_workspace_write]
network_access = false
`;

// ---------------------------------------------------------------------------
// TOML document model (pure)
// ---------------------------------------------------------------------------

describe('TOML document model', () => {
  it('normalizes dotted and quoted table keys', () => {
    expect(normalizeKey('mcp_servers.archguard')).toBe('mcp_servers.archguard');
    expect(normalizeKey(' mcp_servers.archguard ')).toBe('mcp_servers.archguard');
    expect(normalizeKey('"mcp_servers"."archguard"')).toBe('mcp_servers.archguard');
  });

  it('round-trips an unrelated config byte-for-byte', () => {
    const text = `# top comment
model = "gpt-5"

[mcp_servers.github]
command = "docker" # inline comment
args = [
  "run",
  "ghcr.io/github/github-mcp-server",
]

[[features]]
name = "x"
`;
    expect(serializeDoc(parseDoc(text))).toBe(text);
  });

  it('parses TOML scalars, arrays, and inline tables', () => {
    expect(parseTomlValue('"node"')).toBe('node');
    expect(parseTomlValue('["a", "b"]')).toEqual(['a', 'b']);
    expect(parseTomlValue('30')).toBe(30);
    expect(parseTomlValue('true')).toBe(true);
    expect(parseTomlValue('{ A = "x", B = "y" }')).toEqual({ A: 'x', B: 'y' });
    expect(parseTomlValue('"x" # trailing comment')).toBe('x');
  });

  it('joins multi-line values before parsing a section', () => {
    const kv = parseSectionKV('args = [\n  "a",\n  "b",\n]\ncommand = "node"');
    expect(kv.args).toEqual(['a', 'b']);
    expect(kv.command).toBe('node');
  });
});

// ---------------------------------------------------------------------------
// upsert / read / remove (pure, idempotency + preservation)
// ---------------------------------------------------------------------------

describe('upsertArchguardEntry', () => {
  const ENTRY = buildEntry({ cliEntry: '/opt/ag/dist/cli/index.js', parserRuntime: 'auto' });

  it('appends one table to an unrelated config, preserving everything else', () => {
    const out = upsertArchguardEntry(UNRELATED_CONFIG, ENTRY);
    expect(countArchguardSections(out)).toBe(1);
    expect(out).toContain('[mcp_servers.github]');
    expect(out).toContain('model = "gpt-5-codex"');
    expect(out).toContain('[sandbox_workspace_write]');
    expect(out).toContain('command = "node"');
    // Separated from the preceding table by a blank line.
    expect(out).toContain('network_access = false\n\n[mcp_servers.archguard]');
  });

  it('writes a clean file (no leading blank line) from an empty config', () => {
    const out = upsertArchguardEntry('', ENTRY);
    expect(out.startsWith('[mcp_servers.archguard]')).toBe(true);
    expect(countArchguardSections(out)).toBe(1);
  });

  it('is idempotent: a second identical upsert is byte-identical', () => {
    const once = upsertArchguardEntry(UNRELATED_CONFIG, ENTRY);
    const twice = upsertArchguardEntry(once, ENTRY);
    expect(twice).toBe(once);
    expect(countArchguardSections(twice)).toBe(1);
  });

  it('updates the table in place when the entry changes (no duplicate)', () => {
    const once = upsertArchguardEntry(UNRELATED_CONFIG, ENTRY);
    const changed = buildEntry({ cliEntry: '/opt/ag2/dist/cli/index.js', parserRuntime: 'wasm' });
    const twice = upsertArchguardEntry(once, changed);
    expect(countArchguardSections(twice)).toBe(1);
    expect(twice).not.toContain('/opt/ag/dist/cli/index.js');
    expect(readArchguardEntry(twice)).toMatchObject({
      command: 'node',
      args: ['/opt/ag2/dist/cli/index.js', 'mcp'],
      env: { ARCHGUARD_PARSER_RUNTIME: 'wasm' },
    });
    expect(twice).toContain('[mcp_servers.github]');
  });

  it('collapses duplicate archguard headers and subtables into one table', () => {
    const messy = `[mcp_servers.archguard]
command = "node"
args = ["old"]

[mcp_servers.archguard.env]
ARCHGUARD_PARSER_RUNTIME = "wasm"

[mcp_servers.archguard]
command = "node"
args = ["dup"]
`;
    expect(countArchguardSections(messy)).toBe(2);
    const out = upsertArchguardEntry(messy, ENTRY);
    expect(countArchguardSections(out)).toBe(1);
    expect(out).not.toContain('args = ["dup"]');
    expect(out).not.toContain('[mcp_servers.archguard.env]');
    expect(readArchguardEntry(out)).toMatchObject({ args: ['/opt/ag/dist/cli/index.js', 'mcp'] });
  });
});

describe('readArchguardEntry / removeArchguardEntry', () => {
  it('returns null when no archguard table is present', () => {
    expect(readArchguardEntry(UNRELATED_CONFIG)).toBeNull();
  });

  it('reads back exactly what renderEntryLines wrote', () => {
    const entry = buildEntry({
      cliEntry: '/x/dist/cli/index.js',
      parserRuntime: 'native',
      archDir: '/proj/.archguard',
      startupTimeoutSec: 45,
      toolTimeoutSec: 200,
    });
    const text = upsertArchguardEntry('', entry);
    expect(readArchguardEntry(text)).toEqual({
      command: 'node',
      args: ['/x/dist/cli/index.js', 'mcp', '--arch-dir', '/proj/.archguard'],
      env: { ARCHGUARD_PARSER_RUNTIME: 'native' },
      startupTimeoutSec: 45,
      toolTimeoutSec: 200,
    });
  });

  it('reads the plain `codex mcp add` shape (command + args only)', () => {
    const text = `[mcp_servers.archguard]
command = "archguard"
args = ["mcp"]
`;
    expect(readArchguardEntry(text)).toMatchObject({ command: 'archguard', args: ['mcp'] });
  });

  it('merges a [mcp_servers.archguard.env] subtable into env', () => {
    const text = `[mcp_servers.archguard]
command = "node"
args = ["/x", "mcp"]

[mcp_servers.archguard.env]
ARCHGUARD_PARSER_RUNTIME = "wasm"
`;
    expect(readArchguardEntry(text)?.env).toEqual({ ARCHGUARD_PARSER_RUNTIME: 'wasm' });
  });

  it('removes only the archguard table, preserving the rest', () => {
    const withAg = upsertArchguardEntry(
      UNRELATED_CONFIG,
      buildEntry({ cliEntry: '/x', parserRuntime: 'auto' })
    );
    const removed = removeArchguardEntry(withAg);
    expect(countArchguardSections(removed)).toBe(0);
    expect(readArchguardEntry(removed)).toBeNull();
    expect(removed).toContain('[mcp_servers.github]');
    expect(removed).toContain('model = "gpt-5-codex"');
  });
});

// ---------------------------------------------------------------------------
// Entry construction / target policy / resolution (pure)
// ---------------------------------------------------------------------------

describe('buildEntry', () => {
  it('launches `node <entry> mcp` and forwards the parser runtime', () => {
    const entry = buildEntry({ cliEntry: '/x/dist/cli/index.js', parserRuntime: 'auto' });
    expect(entry.command).toBe('node');
    expect(entry.args).toEqual(['/x/dist/cli/index.js', 'mcp']);
    expect(entry.env).toEqual({ ARCHGUARD_PARSER_RUNTIME: 'auto' });
    expect(entry.startupTimeoutSec).toBe(30);
    expect(entry.toolTimeoutSec).toBe(120);
  });

  it('appends --arch-dir and omits env when no runtime is requested', () => {
    const entry = buildEntry({
      cliEntry: '/x',
      parserRuntime: undefined,
      archDir: '/p/.archguard',
    });
    expect(entry.args).toEqual(['/x', 'mcp', '--arch-dir', '/p/.archguard']);
    expect(entry.env).toBeUndefined();
    expect(renderEntryLines(entry).some((l: string) => l.startsWith('env ='))).toBe(false);
  });

  it('supports every TASK-39 parser-runtime value', () => {
    for (const runtime of PARSER_RUNTIME_VALUES) {
      const entry = buildEntry({ cliEntry: '/x', parserRuntime: runtime });
      expect(entry.env).toEqual({ ARCHGUARD_PARSER_RUNTIME: runtime });
    }
  });
});

describe('validateEntryTarget', () => {
  const home = '/home/u';
  it('rejects an entry inside Claude’s versioned plugin cache', () => {
    const reasons = validateEntryTarget(
      '/home/u/.claude/plugins/cache/archguard/archguard/0.1.31/dist/cli/index.js',
      { repoRoot: '/tmp/wt', home }
    );
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ')).toMatch(/plugin cache/);
  });

  it('rejects an entry inside the source checkout', () => {
    const reasons = validateEntryTarget('/tmp/wt/dist/cli/index.js', {
      repoRoot: '/tmp/wt',
      home,
    });
    expect(reasons.join(' ')).toMatch(/source checkout/);
  });

  it('accepts an npm-installed entry outside the cache and checkout', () => {
    expect(
      validateEntryTarget('/usr/lib/node_modules/@yalehwang/archguard/dist/cli/index.js', {
        repoRoot: '/tmp/wt',
        home,
      })
    ).toEqual([]);
  });
});

describe('resolveCliEntry', () => {
  function makePackageRoot(prefix: string): string {
    const root = makeTempDir(prefix);
    const pkg = path.join(root, 'node_modules', CORE_PACKAGE, 'dist', 'cli');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, 'index.js'), '// stub\n');
    return root;
  }

  it('resolves from an explicit node_modules-style --archguard-root', () => {
    const root = makePackageRoot('archguard-codex-root-');
    const entry = resolveCliEntry({ archguardRoot: path.join(root, 'node_modules'), env: {} });
    expect(entry).toBe(path.join(root, 'node_modules', CORE_PACKAGE, CLI_SUBPATH));
  });

  it('resolves from an explicit package root', () => {
    const root = makeTempDir('archguard-codex-pkg-');
    const cli = path.join(root, 'dist', 'cli');
    mkdirSync(cli, { recursive: true });
    writeFileSync(path.join(cli, 'index.js'), '// stub\n');
    expect(resolveCliEntry({ archguardRoot: root, env: {} })).toBe(path.join(cli, 'index.js'));
  });

  it('honors ARCHGUARD_INSTALL_ROOT', () => {
    const root = makePackageRoot('archguard-codex-envroot-');
    const entry = resolveCliEntry({
      env: { ARCHGUARD_INSTALL_ROOT: path.join(root, 'node_modules') },
    });
    expect(entry).toContain(path.join(CORE_PACKAGE, CLI_SUBPATH));
  });

  it('falls back to the injected global npm root', () => {
    const root = makePackageRoot('archguard-codex-npmroot-');
    const entry = resolveCliEntry({ env: {}, npmRoot: () => path.join(root, 'node_modules') });
    expect(entry).toContain(path.join(CORE_PACKAGE, CLI_SUBPATH));
  });

  it('throws a helpful error when no installation is found', () => {
    expect(() => resolveCliEntry({ env: {}, npmRoot: () => '/nonexistent-root' })).toThrow(
      /npm install -g/
    );
    expect(() => resolveCliEntry({ archguardRoot: '/definitely-missing', env: {} })).toThrow(
      /does not contain/
    );
  });
});

describe('resolveConfigPath', () => {
  it('prefers CODEX_HOME, then HOME, and refuses to guess from cwd', () => {
    expect(resolveConfigPath({ CODEX_HOME: '/c', HOME: '/h' })).toBe(
      path.join('/c', 'config.toml')
    );
    expect(resolveConfigPath({ HOME: '/h' })).toBe(path.join('/h', '.codex', 'config.toml'));
    expect(resolveConfigPath({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Installer end-to-end with the fake codex CLI (isolated config dirs)
// ---------------------------------------------------------------------------

interface FakeEnv {
  home: string;
  codexHome: string;
  binDir: string;
  npmRoot: string;
  logPath: string;
  entry: string;
}

function makeFakeNpmRoot(): { npmRoot: string; entry: string } {
  const npmRoot = makeTempDir('archguard-codex-npm-');
  const cliDir = path.join(npmRoot, CORE_PACKAGE, 'dist', 'cli');
  mkdirSync(cliDir, { recursive: true });
  const entry = path.join(cliDir, 'index.js');
  writeFileSync(entry, '#!/usr/bin/env node\n// npm-installed ArchGuard stub\n');
  return { npmRoot, entry };
}

function makeFakeEnv(): FakeEnv {
  const root = makeTempDir('archguard-codex-test-');
  const home = path.join(root, 'home');
  const codexHome = path.join(root, 'codex-home');
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'codex-calls.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, 'codex');
  writeFileSync(shim, `#!/bin/sh\nexec node "${fakeCodexScript}" "$@"\n`);
  chmodSync(shim, 0o755);
  const { npmRoot, entry } = makeFakeNpmRoot();
  return { home, codexHome, binDir, npmRoot, logPath, entry };
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
  const baseArgs = ['--archguard-root', env.npmRoot];
  const args = viaWrapper
    ? [installerSh, ...baseArgs, ...extraArgs]
    : [installerMjs, ...baseArgs, ...extraArgs];
  const command = viaWrapper ? 'bash' : process.execPath;
  const PATH = `${env.binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin`;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: {
        PATH,
        HOME: env.home,
        CODEX_HOME: env.codexHome,
        FAKE_CODEX_LOG: env.logPath,
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

function configText(env: FakeEnv): string {
  return readFileSync(path.join(env.codexHome, 'config.toml'), 'utf8');
}

function codexCalls(env: FakeEnv): string[][] {
  if (!existsSync(env.logPath)) return [];
  return readFileSync(env.logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function fakeCodexListJson(env: FakeEnv): Promise<Array<Record<string, any>>> {
  const out = execFileSync(path.join(env.binDir, 'codex'), ['mcp', 'list', '--json'], {
    env: { ...process.env, CODEX_HOME: env.codexHome, HOME: env.home },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('installer with fake codex CLI (isolated config)', () => {
  it('clean install writes one valid archguard entry pointing at the npm install', async () => {
    const env = makeFakeEnv();
    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const text = configText(env);
    expect(countArchguardSections(text)).toBe(1);
    const entry = readArchguardEntry(text);
    expect(entry).toMatchObject({
      command: 'node',
      args: [env.entry, 'mcp'],
      env: { ARCHGUARD_PARSER_RUNTIME: 'auto' },
    });
    // Never the source checkout or Claude cache.
    expect(validateEntryTarget(entry!.args[0], { repoRoot, home: env.home })).toEqual([]);
    expect(entry!.args[0]).not.toContain(`${path.sep}.claude${path.sep}`);
    expect(entry!.args[0]).not.toContain(repoRoot);
    // Real user config untouched (isolated HOME had no .codex written).
    expect(existsSync(path.join(env.home, '.codex', 'config.toml'))).toBe(false);
  });

  it('works through the .sh wrapper', async () => {
    const env = makeFakeEnv();
    const result = await runInstaller(env, [], true);
    expect(result.code, result.stderr).toBe(0);
    expect(readArchguardEntry(configText(env))).toMatchObject({ command: 'node' });
  });

  it('running the installer twice succeeds and leaves exactly one table (idempotent)', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env)).code).toBe(0);
    const first = configText(env);
    expect((await runInstaller(env)).code).toBe(0);
    const second = configText(env);
    expect(second).toBe(first);
    expect(countArchguardSections(second)).toBe(1);
  });

  it('preserves unrelated Codex configuration byte-for-byte outside the archguard table', async () => {
    const env = makeFakeEnv();
    writeFileSync(path.join(env.codexHome, 'config.toml'), UNRELATED_CONFIG);
    const result = await runInstaller(env);
    expect(result.code, result.stderr).toBe(0);
    const text = configText(env);
    expect(text).toContain('model = "gpt-5-codex"');
    expect(text).toContain('approval_policy = "never"');
    expect(text).toContain('[mcp_servers.github]');
    expect(text).toContain('args = ["run", "ghcr.io/github/github-mcp-server"]');
    expect(text).toContain('[sandbox_workspace_write]');
    expect(text).toContain('network_access = false');
    expect(countArchguardSections(text)).toBe(1);
  });

  it('updates the parser runtime in place when it changes between runs', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env, ['--parser-runtime', 'auto'])).code).toBe(0);
    expect(readArchguardEntry(configText(env))?.env).toEqual({ ARCHGUARD_PARSER_RUNTIME: 'auto' });
    expect((await runInstaller(env, ['--parser-runtime', 'wasm'])).code).toBe(0);
    const text = configText(env);
    expect(countArchguardSections(text)).toBe(1);
    expect(readArchguardEntry(text)?.env).toEqual({ ARCHGUARD_PARSER_RUNTIME: 'wasm' });
  });

  it('forwards a custom runtime and arch-dir', async () => {
    const env = makeFakeEnv();
    const archDir = path.join(env.home, 'proj', '.archguard');
    const result = await runInstaller(env, ['--parser-runtime', 'native', '--arch-dir', archDir]);
    expect(result.code, result.stderr).toBe(0);
    expect(readArchguardEntry(configText(env))).toMatchObject({
      args: [env.entry, 'mcp', '--arch-dir', archDir],
      env: { ARCHGUARD_PARSER_RUNTIME: 'native' },
    });
  });

  it('the written entry is readable by the independent fake-codex parser (connection smoke)', async () => {
    const env = makeFakeEnv();
    expect((await runInstaller(env)).code).toBe(0);
    // The installer already ran its own smoke check against the fake codex.
    expect(codexCalls(env)).toContainEqual(['mcp', 'list', '--json']);
    // Cross-check with an explicit call: the fake parses config.toml itself.
    const servers = await fakeCodexListJson(env);
    const ag = servers.find((s) => s.name === SERVER_NAME);
    expect(ag).toBeDefined();
    expect(ag!.enabled).toBe(true);
    expect(ag!.transport.command).toBe('node');
    expect(ag!.transport.args).toEqual([env.entry, 'mcp']);
    expect(ag!.transport.env).toEqual({ ARCHGUARD_PARSER_RUNTIME: 'auto' });
  });

  it('refuses to register an entry inside Claude’s plugin cache', async () => {
    const env = makeFakeEnv();
    const cacheRoot = path.join(
      env.home,
      '.claude',
      'plugins',
      'cache',
      'archguard',
      'archguard',
      '0.1.31'
    );
    mkdirSync(path.join(cacheRoot, 'dist', 'cli'), { recursive: true });
    writeFileSync(path.join(cacheRoot, 'dist', 'cli', 'index.js'), '// stub\n');
    const result = await runInstaller(env, ['--archguard-root', cacheRoot]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/plugin cache/);
    expect(existsSync(path.join(env.codexHome, 'config.toml'))).toBe(false);
  });

  it('refuses to register an entry inside the source checkout', async () => {
    const env = makeFakeEnv();
    // Point at the real repo root (which would be the source checkout).
    const result = await runInstaller(env, ['--archguard-root', repoRoot]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/source checkout|does not contain/);
  });

  it('refuses an invalid --parser-runtime', async () => {
    const env = makeFakeEnv();
    const result = await runInstaller(env, ['--parser-runtime', 'turbo']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/invalid --parser-runtime/);
    expect(existsSync(path.join(env.codexHome, 'config.toml'))).toBe(false);
  });

  it('refuses a missing --archguard-root with actionable guidance', async () => {
    const env = makeFakeEnv();
    const result = await runInstaller(env, ['--archguard-root', '/no/such/root']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/does not contain/);
  });

  it('refuses to infer a Codex config when HOME and CODEX_HOME are absent', async () => {
    const env = makeFakeEnv();
    const cwd = makeTempDir('archguard-codex-nohome-');
    mkdirSync(path.join(cwd, '.codex'), { recursive: true });
    let code = 0;
    let stderr = '';
    try {
      await execFileAsync(process.execPath, [installerMjs, '--archguard-root', env.npmRoot], {
        cwd,
        env: { PATH: `${env.binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin` },
      });
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      code = err.code ?? 1;
      stderr = String(err.stderr ?? '');
    }
    expect(code).toBe(1);
    expect(stderr).toMatch(/HOME or CODEX_HOME is required/);
    expect(existsSync(path.join(cwd, '.codex', 'config.toml'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static invariants
// ---------------------------------------------------------------------------

describe('installer static invariants', () => {
  const mjsSource = readFileSync(installerMjs, 'utf8');
  const shSource = readFileSync(installerSh, 'utf8');

  it('launches the server via node + explicit entry, never a global archguard binary', () => {
    const entry = buildEntry({ cliEntry: '/x/dist/cli/index.js', parserRuntime: 'auto' });
    expect(entry.command).toBe('node');
    expect(entry.args[1]).toBe('mcp');
  });

  it('never executes a mutating npm command (read-only `npm root -g` only)', () => {
    for (const source of [mjsSource, shSource]) {
      // Never spawn npm install/pack/publish/etc. (guidance text may mention
      // them, so we assert on the executed command shape, not the prose).
      expect(source).not.toMatch(
        /execFileSync\(\s*['"]npm['"],\s*\[\s*['"](?:install|i|ci|pack|publish|update|uninstall)['"]/
      );
      expect(source).not.toMatch(/node-gyp/);
      expect(source).not.toMatch(/tree-sitter-(go|java|python|cpp|kotlin)/);
    }
    // The sole npm invocation is read-only global-root discovery.
    expect(mjsSource).toMatch(/['"]npm['"],\s*\[\s*['"]root['"],\s*['"]-g['"]/);
  });

  it('treats the plugin cache and source checkout as forbidden targets', () => {
    expect(mjsSource).toMatch(/plugins[\\/]cache|plugins.*cache/);
    expect(mjsSource).toMatch(/source checkout/);
  });

  it('the .sh wrapper never writes a config path itself (executable lines)', () => {
    const executable = shSource
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(executable).not.toContain('config.toml');
    expect(executable).not.toMatch(/>\s*.*\.codex/);
  });
});

// ---------------------------------------------------------------------------
// Real codex CLI + real MCP server boundary (isolated config). Everything here
// is real: the codex CLI parses the installer-written TOML, and the configured
// npm-installed server answers a live MCP handshake + query + analysis.
// ---------------------------------------------------------------------------

describe('real codex CLI boundary (isolated config)', () => {
  const realCodexAvailable = (() => {
    try {
      execFileSync('codex', ['--version'], { stdio: 'pipe', timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  })();

  const globalEntry = (() => {
    try {
      const root = execFileSync('npm', ['root', '-g'], {
        encoding: 'utf8',
        timeout: 30_000,
      }).trim();
      const entry = path.join(root, CORE_PACKAGE, CLI_SUBPATH);
      return existsSync(entry) ? entry : null;
    } catch {
      return null;
    }
  })();

  it.skipIf(!realCodexAvailable || !globalEntry)(
    'registers a valid user-scope entry that real codex lists and the real server serves',
    async () => {
      const root = makeTempDir('archguard-codex-real-');
      const home = path.join(root, 'home');
      const codexHome = path.join(root, 'codex-home');
      mkdirSync(home, { recursive: true });
      mkdirSync(codexHome, { recursive: true });
      // Seed unrelated config to prove preservation against the real codex.
      writeFileSync(path.join(codexHome, 'config.toml'), UNRELATED_CONFIG);

      const npmRoot = path.dirname(path.dirname(path.dirname(globalEntry!))); // .../node_modules
      const result = await runInstallerReal({
        home,
        codexHome,
        npmRoot,
        args: ['--parser-runtime', 'wasm'],
      });
      expect(result.code, result.stderr).toBe(0);

      // Real codex parses the installer-written TOML and lists the server.
      const listRaw = execFileSync('codex', ['mcp', 'list', '--json'], {
        env: { ...process.env, HOME: home, CODEX_HOME: codexHome },
        encoding: 'utf8',
        timeout: 60_000,
      });
      const start = listRaw.indexOf('[');
      const servers = JSON.parse(listRaw.slice(start, listRaw.lastIndexOf(']') + 1));
      const ag = servers.find((s: any) => s.name === SERVER_NAME);
      expect(ag, `archguard not listed by real codex:\n${listRaw}`).toBeDefined();
      expect(ag.enabled).toBe(true);
      expect(ag.transport.command).toBe('node');
      expect(ag.transport.args[0]).toBe(globalEntry);
      expect(ag.transport.args).toContain('mcp');
      expect(ag.transport.env).toMatchObject({ ARCHGUARD_PARSER_RUNTIME: 'wasm' });
      // Unrelated config preserved alongside.
      expect(servers.find((s: any) => s.name === 'github')).toBeDefined();

      // The registered target is the npm install, not the cache or checkout.
      expect(validateEntryTarget(globalEntry!, { repoRoot, home })).toEqual([]);

      // Real MCP handshake + query through exactly the command Codex uses.
      const handshake = await mcpHandshake(globalEntry!, { ARCHGUARD_PARSER_RUNTIME: 'wasm' });
      expect(handshake.toolCount).toBeGreaterThan(0);
      expect(handshake.tools).toContain('archguard_summary');
      expect(handshake.tools).toContain('archguard_analyze');
      expect(handshake.summaryOk).toBe(true); // query-only startup works (no native)
    },
    240_000
  );

  it.skipIf(!realCodexAvailable || !globalEntry)(
    'analysis works through the configured server (WASM baseline)',
    async () => {
      const projectRoot = makeTempDir('archguard-codex-proj-');
      mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
      writeFileSync(
        path.join(projectRoot, 'src', 'a.ts'),
        'export interface Greeter { greet(): string }\n' +
          'export class HelloGreeter implements Greeter { greet() { return "hi"; } }\n' +
          'export function makeGreeter(): Greeter { return new HelloGreeter(); }\n'
      );
      const analysis = await mcpAnalyze(globalEntry!, projectRoot, {
        ARCHGUARD_PARSER_RUNTIME: 'wasm',
      });
      expect(analysis.analyzeOk).toBe(true);
      expect(analysis.entityCount).toBeGreaterThanOrEqual(3);
    },
    240_000
  );
});

// --- helpers for the real boundary runs ------------------------------------

async function runInstallerReal(opts: {
  home: string;
  codexHome: string;
  npmRoot: string;
  args: string[];
}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [installerMjs, '--archguard-root', opts.npmRoot, '--no-verify', ...opts.args],
      {
        env: { PATH: process.env.PATH, HOME: opts.home, CODEX_HOME: opts.codexHome },
        timeout: 120_000,
      }
    );
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

/** Extract the first text item of an MCP tool result and JSON.parse it. */
function toolResultJson(msg: any): any {
  const text = msg?.result?.content?.find?.((c: any) => c?.type === 'text')?.text;
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Minimal stdio MCP client that drives the configured server exactly the way
 * Codex would (spawn `node <entry> mcp`, JSON-RPC over stdio). Cleans up its
 * timers and the child process so it never holds the vitest worker open.
 */
class McpClient {
  private child: ReturnType<typeof spawn>;
  private pending = new Map<number, (msg: any) => void>();
  private timers = new Set<NodeJS.Timeout>();
  private buf = '';
  private nextId = 1;

  constructor(entry: string, extraEnv: Record<string, string>) {
    this.child = spawn(process.execPath, [entry, 'mcp'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, ...extraEnv },
    });
    this.child.stdout!.on('data', (d: Buffer) => this.onData(d));
  }

  private onData(d: Buffer): void {
    this.buf += d.toString('utf8');
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg);
        this.pending.delete(msg.id);
      }
    }
  }

  request(method: string, params: any, timeoutMs = 120_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeoutMs);
      this.timers.add(timer);
      this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method: string, params: any): void {
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'task36', version: '0' },
    });
    this.notify('notifications/initialized', {});
  }

  close(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    try {
      this.child.stdin!.destroy();
    } catch {
      /* already closed */
    }
    this.child.kill('SIGTERM');
    setTimeout(() => this.child.kill('SIGKILL'), 2_000).unref();
  }
}

async function mcpHandshake(
  entry: string,
  extraEnv: Record<string, string>
): Promise<{ tools: string[]; toolCount: number; summaryOk: boolean }> {
  const client = new McpClient(entry, extraEnv);
  try {
    await client.initialize();
    const toolsMsg = await client.request('tools/list', {});
    const tools = (toolsMsg.result?.tools ?? []).map((t: any) => t.name);
    const sum = await client.request('tools/call', { name: 'archguard_summary', arguments: {} });
    return { tools, toolCount: tools.length, summaryOk: sum.result?.isError !== true };
  } finally {
    client.close();
  }
}

async function mcpAnalyze(
  entry: string,
  projectRoot: string,
  extraEnv: Record<string, string>
): Promise<{ analyzeOk: boolean; entityCount: number }> {
  const client = new McpClient(entry, extraEnv);
  try {
    await client.initialize();
    const an = await client.request('tools/call', {
      name: 'archguard_analyze',
      arguments: { projectRoot, includeTests: false },
    });
    const analyzeOk = an.result?.isError !== true;
    const sum = await client.request('tools/call', {
      name: 'archguard_summary',
      arguments: { projectRoot },
    });
    const parsed = toolResultJson(sum);
    const entityCount = typeof parsed?.entityCount === 'number' ? parsed.entityCount : 0;
    return { analyzeOk, entityCount };
  } finally {
    client.close();
  }
}
