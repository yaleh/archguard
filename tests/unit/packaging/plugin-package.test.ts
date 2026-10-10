/**
 * Unit: npm Claude plugin package invariants (TASK-31).
 *
 * ArchGuard ships as a Claude Code plugin whose marketplace source is of type
 * `npm`: Claude Code runs `npm install` of `@yalehwang/archguard-claude-plugin`,
 * which depends on an exact `@yalehwang/archguard` version. These tests pin the
 * static contract between the core package, the plugin package, the plugin
 * manifests, the MCP launch configuration, and the marketplace entry — before
 * any packing or installation is exercised (see
 * tests/integration/plugin-install.test.ts for the end-to-end flow).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const pluginDir = path.join(repoRoot, 'plugin');

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

const corePkg = readJson(path.join(repoRoot, 'package.json'));
const coreVersion = corePkg.version as string;

describe('plugin npm package (plugin/package.json)', () => {
  it('exists and is named @yalehwang/archguard-claude-plugin', () => {
    const pkgPath = path.join(pluginDir, 'package.json');
    expect(existsSync(pkgPath), 'plugin/package.json missing').toBe(true);
    const pkg = readJson(pkgPath);
    expect(pkg.name).toBe('@yalehwang/archguard-claude-plugin');
  });

  it('tracks the core package version exactly', () => {
    const pkg = readJson(path.join(pluginDir, 'package.json'));
    expect(pkg.version, 'plugin version must equal the core package version').toBe(coreVersion);
  });

  it('depends on the exact matching @yalehwang/archguard version (no range)', () => {
    const pkg = readJson(path.join(pluginDir, 'package.json')) as {
      dependencies?: Record<string, string>;
    };
    const dep = pkg.dependencies?.['@yalehwang/archguard'];
    expect(dep, 'plugin must depend on @yalehwang/archguard').toBe(coreVersion);
    expect(dep, 'dependency must be an exact pin, not a semver range').not.toMatch(/^[~^]/);
  });

  it('publishes the plugin manifests, MCP config, launcher, and skills', () => {
    const pkg = readJson(path.join(pluginDir, 'package.json')) as { files?: string[] };
    const files = pkg.files ?? [];
    for (const entry of ['.claude-plugin/', '.mcp.json', 'mcp-launcher.mjs', 'skills/']) {
      expect(files, `plugin files must include ${entry}`).toContain(entry);
    }
  });

  it('does not vendor dist/ or node_modules/ (npm resolves the runtime closure)', () => {
    const pkg = readJson(path.join(pluginDir, 'package.json')) as { files?: string[] };
    const files = pkg.files ?? [];
    expect(files).not.toContain('dist/');
    expect(files).not.toContain('dist');
    expect(files).not.toContain('node_modules/');
  });
});

describe('plugin manifest (plugin/.claude-plugin/plugin.json)', () => {
  it('exists, is named archguard, and matches the plugin package version', () => {
    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
    expect(existsSync(manifestPath), 'plugin.json missing').toBe(true);
    const manifest = readJson(manifestPath);
    expect(manifest.name).toBe('archguard');
    expect(manifest.version).toBe(coreVersion);
  });
});

describe('plugin MCP config (plugin/.mcp.json)', () => {
  it('launches the npm-installed ArchGuard entry through the plugin launcher', () => {
    const mcpPath = path.join(pluginDir, '.mcp.json');
    expect(existsSync(mcpPath), 'plugin/.mcp.json missing').toBe(true);
    const mcp = readJson(mcpPath) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
    };
    const server = mcp.mcpServers?.archguard;
    expect(server, '.mcp.json must define an archguard MCP server').toBeDefined();
    expect(server?.command).toBe('node');
    const args = server?.args ?? [];
    expect(args.length).toBeGreaterThan(0);
    // The launcher resolves @yalehwang/archguard from the plugin's own
    // dependency tree — never a vendored dist/, a global CLI, a repository
    // parent node_modules, or NODE_PATH.
    expect(args[0]).toBe('${CLAUDE_PLUGIN_ROOT}/mcp-launcher.mjs');
    const raw = readFileSync(mcpPath, 'utf8');
    expect(raw).not.toContain('NODE_PATH');
    expect(raw).not.toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}\/dist\//);
  });
});

describe('plugin MCP launcher (plugin/mcp-launcher.mjs)', () => {
  it('exists and resolves the ArchGuard CLI entry from the plugin dependency tree', () => {
    const launcherPath = path.join(pluginDir, 'mcp-launcher.mjs');
    expect(existsSync(launcherPath), 'mcp-launcher.mjs missing').toBe(true);
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).toContain('@yalehwang/archguard/dist/cli/index.js');
    expect(source).toContain('createRequire');
  });
});

describe('marketplace (repo-root .claude-plugin/marketplace.json)', () => {
  it('exists and uses an npm source pinned to the plugin package version', () => {
    const marketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
    expect(existsSync(marketplacePath), 'root marketplace.json missing').toBe(true);
    const marketplace = readJson(marketplacePath) as {
      plugins?: Array<{
        name?: string;
        source?: unknown;
        version?: string;
      }>;
    };
    const entry = marketplace.plugins?.find((p) => p.name === 'archguard');
    expect(entry, 'marketplace must list the archguard plugin').toBeDefined();
    expect(
      entry?.source,
      'marketplace source must be an npm source object, not a relative directory'
    ).toEqual({
      source: 'npm',
      package: '@yalehwang/archguard-claude-plugin',
      version: coreVersion,
    });
  });
});

describe('plugin skills', () => {
  it('bundles the feature-developer, project-semantics-discovery, and arch-layer-review skills', () => {
    for (const skill of ['feature-developer', 'project-semantics-discovery', 'arch-layer-review']) {
      expect(
        existsSync(path.join(pluginDir, 'skills', skill, 'SKILL.md')),
        `skills/${skill}/SKILL.md missing`
      ).toBe(true);
    }
  });
});

/**
 * Regression guard for the seventh version carrier (GOAL-001 / AC-004).
 *
 * The exact-core dependency pin — `plugin/package.json`
 * `.dependencies["@yalehwang/archguard"]` — is a dependency-range string in a nested object, so
 * the six `.version` carriers' enumeration could never see it and it was hand-maintained. On
 * 2026-10-10T05:11 a release lifted the npm side to 0.1.39 while the pin stayed 0.1.38 for
 * ~60-90s; the goal gate sampled the main checkout exactly there and went red with
 * `CAUSE=plugin-core-dependency-not-exact`. These tests reproduce that window tree, pin both
 * failure modes (behind / ranged), and pin that the generator converges it — the same shape the
 * six-carrier guard's regression test (tests/unit/scripts/version-carriers-check.test.ts) uses.
 */
describe('exact-core dependency pin is a single-source carrier (GOAL-001 / AC-004)', () => {
  const CHECK = path.join(repoRoot, 'scripts/check-version-carriers.sh');
  const PIN_SCRIPT = path.join(repoRoot, 'scripts/sync-plugin-core-pin.mjs');
  const CORE_DEP = '@yalehwang/archguard';

  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'plugin-core-pin-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeJson(rel: string, doc: unknown): void {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  /**
   * The window tree: all six `.version` carriers and VERSION equal `version`, but the plugin's
   * exact-core pin is `pin` (absent when `pin` is null, e.g. the whole `dependencies` key gone).
   */
  function writeWindowFixture(version: string, pin: string | null): void {
    writeJson('package.json', { name: 'fixture', version });
    writeJson('package-lock.json', {
      name: 'fixture',
      version,
      lockfileVersion: 3,
      packages: { '': { name: 'fixture', version } },
    });
    writeJson('.claude-plugin/marketplace.json', {
      name: 'fixture',
      plugins: [{ name: 'fixture', source: { source: 'npm', package: 'fixture', version } }],
    });
    const pluginPkg: Record<string, unknown> = { name: 'fixture-plugin', version };
    if (pin !== null) pluginPkg.dependencies = { [CORE_DEP]: pin };
    writeJson('plugin/package.json', pluginPkg);
    writeJson('plugin/.claude-plugin/plugin.json', { name: 'fixture-plugin', version });
    writeFileSync(path.join(dir, 'VERSION'), `${version}\n`, 'utf8');
  }

  function runCheck(root = dir) {
    return spawnSync('bash', [CHECK, root], { encoding: 'utf8' });
  }

  function runPin(args: string[]) {
    return spawnSync('node', [PIN_SCRIPT, ...args], { encoding: 'utf8' });
  }

  it('the repository root pin is exact: check-version-carriers.sh and --check both exit 0', () => {
    expect(coreVersion).toBeTruthy();
    const guard = runCheck(repoRoot);
    expect(guard.status).toBe(0);
    expect(guard.stdout).toContain(`all carriers == ${coreVersion}`);

    const pin = runPin(['--check']);
    expect(pin.stderr).toBe('');
    expect(pin.status).toBe(0);
    expect(pin.stdout).toContain(`plugin core pin ok: ${coreVersion}`);
  });

  it('accepts a declared pin that equals the core version', () => {
    writeWindowFixture('0.1.40', '0.1.40');

    const r = runCheck();

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('all carriers == 0.1.40');
    expect(r.stdout).toContain('plugin core pin ok: 0.1.40');
  });

  it('reproduces the 2026-10-10 window: pin behind the core version -> exit 1, names the pin', () => {
    writeWindowFixture('0.1.40', '0.1.39');

    const r = runCheck();

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=plugin-core-dependency-not-exact');
    // "Names the pin": the file, the field, and the drifting value all appear.
    expect(r.stderr).toContain('plugin/package.json');
    expect(r.stderr).toContain(`dependencies['${CORE_DEP}']`);
    expect(r.stderr).toContain("'0.1.39'");
    expect(r.stderr).toContain("core 版本是 '0.1.40'");
  });

  it('rejects a ranged pin (^ / ~) the same way', () => {
    for (const ranged of ['^0.1.40', '~0.1.40']) {
      writeWindowFixture('0.1.40', ranged);

      const r = runCheck();

      expect(r.status, `${ranged} must be rejected`).toBe(1);
      expect(r.stderr).toContain('CAUSE=plugin-core-dependency-not-exact');
      expect(r.stderr).toContain(`'${ranged}'`);
    }
  });

  it('reports a missing dependency: no `dependencies` key -> strict check exit 1', () => {
    writeWindowFixture('0.1.40', null);

    const strict = runPin(['--check', dir]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain('CAUSE=plugin-missing-core-dependency');
  });

  it('reports a missing core pin inside a declared dependency set', () => {
    writeWindowFixture('0.1.40', '0.1.40');
    writeJson('plugin/package.json', {
      name: 'fixture-plugin',
      version: '0.1.40',
      dependencies: { 'some-other-package': '1.0.0' },
    });

    const r = runCheck();

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CAUSE=plugin-missing-core-dependency');
    expect(r.stderr).toContain('plugin/package.json');
  });

  it('converges the window tree and is idempotent (byte-identical second run)', () => {
    writeWindowFixture('0.1.40', '0.1.39');

    // The window is caught before any fix.
    expect(runCheck().status).toBe(1);

    const gen = runPin(['--from-package', dir]);
    expect(gen.status).toBe(0);

    const afterFirst = readFileSync(path.join(dir, 'plugin/package.json'), 'utf8');
    const pin = JSON.parse(afterFirst).dependencies[CORE_DEP];
    expect(pin).toBe('0.1.40');

    // The check now passes, with the pin folded into the same `all carriers` contract.
    const check = runCheck();
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('all carriers == 0.1.40');

    expect(runPin(['--from-package', dir]).status).toBe(0);
    expect(readFileSync(path.join(dir, 'plugin/package.json'), 'utf8')).toBe(afterFirst);
  });

  it('is wired into npm\'s `version` lifecycle right after the six-carrier generator', () => {
    const pkg = readJson(path.join(repoRoot, 'package.json')) as { scripts?: Record<string, string> };
    const versionScript = pkg.scripts?.version ?? '';
    expect(versionScript).toContain('sync-version-carriers');
    expect(versionScript).toContain('sync-plugin-core-pin');
    // The pin must move in the same `npm version` call, before the guard re-checks the tree.
    expect(versionScript.indexOf('sync-plugin-core-pin')).toBeLessThan(
      versionScript.indexOf('check-version-carriers')
    );
  });
});
