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
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
  it('bundles the feature-developer and project-semantics-discovery skills', () => {
    for (const skill of ['feature-developer', 'project-semantics-discovery']) {
      expect(
        existsSync(path.join(pluginDir, 'skills', skill, 'SKILL.md')),
        `skills/${skill}/SKILL.md missing`
      ).toBe(true);
    }
  });
});
